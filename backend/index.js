const express    = require('express')
const mongoose   = require('mongoose')
const dotenv     = require('dotenv')
const cors       = require('cors')
const http       = require('http')
const { WebSocketServer } = require('ws')

dotenv.config()

const { generateOpenApiSpec } = require('./SpecGenerator');
const { validatePayload } = require('./validator');
const { rateLimiter, seedRateLimitConfig } = require('./rateLimiter');
const { operationBlockMiddleware } = require('./operationBlockMiddleware');
const {
    castToObjectId,
    handlePostSync,
    handlePutSync,
    handleDeleteSync,
    validateRelationReferences
} = require('./relationSync');

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocketServer({ server })

app.use(cors())
app.use(express.json())
app.use(rateLimiter)

let latestOpenApiSpec = null

// ─── WebSocket ────────────────────────────────────────────────────────────────
function broadcastUpdate() {
    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'spec_updated' }))
        }
    })
    console.log('Broadcasted spec_updated to React clients')
}

wss.on('connection', (ws) => {
    console.log('React client connected via WebSocket')
    if (latestOpenApiSpec) {
        ws.send(JSON.stringify({ type: 'spec_updated' }))
    }
})



// ─── Format prompt ────────────────────────────────────────────────────────────
function formatPrompt(collection, rbac) {
    const collectionRbac = {}
    if (rbac && rbac.roles) {
        for (const [role, permissions] of Object.entries(rbac.roles)) {
            if (permissions[collection.name]) {
                collectionRbac[role] = permissions[collection.name]
            }
        }
    }

    return `You are an API documentation generator.

Generate a complete OpenAPI 3.0 JSON specification for ONLY this collection:
${JSON.stringify({ name: collection.name, fields: collection.fields }, null, 2)}

RBAC configuration for this collection:
${JSON.stringify(collectionRbac, null, 2)}

Rules:
- Generate exactly these 5 CRUD endpoints:
  GET /${collection.name}
  POST /${collection.name}
  GET /${collection.name}/{id}
  PUT /${collection.name}/{id}
  DELETE /${collection.name}/{id}
- All parameters structured as arrays
- Authentication and authorization based on RBAC above
- Request and response schemas for each endpoint
- Keep response minimal to avoid truncation
- Use $ref under components/schemas for reusable schemas
- Every $ref you use MUST be defined in the components/schemas section of YOUR response

Return a JSON object with exactly two keys: "paths" and "components".
"paths" contains the 5 CRUD endpoints.
"components" contains ALL schemas referenced by $ref in those paths.
No explanation. No markdown. Just raw JSON like:
{
  "paths": {
    "/${collection.name}": { "get": {...}, "post": {...} },
    "/${collection.name}/{id}": { "get": {...}, "put": {...}, "delete": {...} }
  },
  "components": {
    "schemas": {
      "SomeSchema": { "type": "object", "properties": {...} }
    }
  }
}`
}

// ─── Read RBAC ────────────────────────────────────────────────────────────────
async function readRbac() {
    const db  = mongoose.connection.db
    const doc = await db.collection('rbac.json').findOne({}, { projection: { _id: 0 } })
    return doc || { roles: {} }
}

// ─── Flag helpers ─────────────────────────────────────────────────────────────
async function ensureFlag(collectionName) {
    const db = mongoose.connection.db
    await db.collection('sync_Flags').updateOne(
        { tableName: collectionName },
        { $setOnInsert: { tableName: collectionName, tableStatus: false } },
        { upsert: true }
    )
}

async function setFlagTrue(collectionName) {
    const db = mongoose.connection.db
    await db.collection('sync_Flags').updateOne(
        { tableName: collectionName },
        { $set: { tableStatus: true } },
        { upsert: true }
    )
    console.log(`Flag set TRUE for: ${collectionName}`)
}

async function setFlagFalse(collectionName) {
    const db = mongoose.connection.db
    await db.collection('sync_Flags').updateOne(
        { tableName: collectionName },
        { $set: { tableStatus: false } }
    )
    console.log(`Flag set FALSE for: ${collectionName}`)
}

// ─── Auto RBAC defaults ───────────────────────────────────────────────────────
async function ensureRbacForCollection(collectionName) {
    const db   = mongoose.connection.db
    const rbac = await readRbac()

    let needsUpdate = false
    for (const role of Object.keys(rbac.roles || {})) {
        if (!rbac.roles[role][collectionName]) {
            rbac.roles[role][collectionName] = role === 'Admin'
                ? ['create', 'read', 'update', 'delete']
                : ['read']
            needsUpdate = true
        }
    }

    if (needsUpdate) {
        await db.collection('rbac.json').updateOne(
            {},
            { $set: { roles: rbac.roles } }
        )
        console.log(`Auto-added default RBAC for: ${collectionName}`)
    }
}

// ─── Generate spec for one collection using the local function ────────────────
async function generateForCollection(collectionDoc) {
    console.log(`Generating spec for: ${collectionDoc.name}`);
    try {
        // Call the local generator function instead of Qwen LLM
        const spec = generateOpenApiSpec(collectionDoc);

        const db = mongoose.connection.db;
        await db.collection('schema.json').updateOne(
            { name: collectionDoc.name },
            { $set: { openapi_spec: spec } }
        );

        console.log(`Spec saved for: ${collectionDoc.name}`);
        return true;
    } catch (err) {
        console.error(`Failed to generate spec for ${collectionDoc.name}:`, err.message);
        return false;
    }
}

 
// ─── Rebuild full spec — merge paths AND components from all collections ──────
async function rebuildFullSpec() {
    const db   = mongoose.connection.db
    const docs = await db.collection('schema.json').find({}).toArray()

    let paths      = {}
    let components = { schemas: {} }

    for (const doc of docs) {
        if (doc.openapi_spec) {
            if (doc.openapi_spec.paths) {
                paths = { ...paths, ...doc.openapi_spec.paths }
            }
            if (doc.openapi_spec.components?.schemas) {
                components.schemas = {
                    ...components.schemas,
                    ...doc.openapi_spec.components.schemas
                }
            }
        }
    }

    latestOpenApiSpec = JSON.stringify({
        openapi: "3.0.0",
        info:    { title: "API Documentation (Dynamic)", version: "1.0.0" },
        servers: [{ url: "http://localhost:3001/api" }],
        components,
        paths
    })

    console.log('Full spec rebuilt and ready')
    broadcastUpdate()
}

// ─── Process pending flags ────────────────────────────────────────────────────
async function processPendingFlags() {
    const db    = mongoose.connection.db
    const flags = await db.collection('sync_Flags').find({ tableStatus: true }).toArray()

    if (flags.length === 0) return

    console.log(`Processing ${flags.length} pending flag(s)...`)

    for (const flag of flags) {
        const collectionDoc = await db.collection('schema.json').findOne(
            { name: flag.tableName },
            { projection: { _id: 0 } }
        )

        if (!collectionDoc) {
            console.log(`${flag.tableName} no longer in schema — removing flag`)
            await db.collection('sync_Flags').deleteOne({ tableName: flag.tableName })
            continue
        }

        const success = await generateForCollection(collectionDoc)
        if (success) await setFlagFalse(flag.tableName)
    }

    await rebuildFullSpec()
}

// ─── Seed pilot collections ──────────────────────────────────────────────────
async function seedEmployeesAndDepartmentsSchema(db) {
    const schemaCollection = db.collection('schema.json');
    
    const empExists = await schemaCollection.findOne({ name: 'employees' });
    if (!empExists) {
        await schemaCollection.insertOne({
            name: 'employees',
            fields: [
                { name: '_id', type: 'ObjectId', required: true },
                { name: 'name', type: 'string', required: true },
                {
                    name: 'department',
                    field: 'department',
                    dataType: 'Object',
                    label: 'Department',
                    type: 'mappedtable',
                    inputType: 'mappedTable',
                    mappedTableRef: 'departments',
                    multipleSelect: false,
                    relationRole: 'primary',
                    reverseField: 'employees'
                }
            ]
        });
        console.log('Auto-seeded employees schema in MongoDB.');
    }

    const deptExists = await schemaCollection.findOne({ name: 'departments' });
    if (!deptExists) {
        await schemaCollection.insertOne({
            name: 'departments',
            fields: [
                { name: '_id', type: 'ObjectId', required: true },
                { name: 'name', type: 'string', required: true },
                {
                    name: 'employees',
                    field: 'employees',
                    dataType: 'Object',
                    label: 'Employees',
                    type: 'mappedtable',
                    inputType: 'mappedTable',
                    mappedTableRef: 'employees',
                    multipleSelect: true,
                    relationRole: 'reverse',
                    reverseField: 'department'
                }
            ]
        });
        console.log('Auto-seeded departments schema in MongoDB.');
    }
}

// ─── Initial startup ──────────────────────────────────────────────────────────
async function initialGeneration() {
    const db   = mongoose.connection.db
    const docs = await db.collection('schema.json').find({}).toArray()

    for (const doc of docs) {
        await ensureFlag(doc.name)
        await ensureRbacForCollection(doc.name)
        if (!doc.openapi_spec) {
            console.log(`No spec found for ${doc.name} — flagging for generation`)
            await setFlagTrue(doc.name)
        }
    }

    await rebuildFullSpec()
    await processPendingFlags()
}

// ─── Watch schema.json ────────────────────────────────────────────────────────
async function watchSchemaCollection() {
    const db         = mongoose.connection.db
    const changeStream = db.collection('schema.json').watch()

    changeStream.on('change', async (change) => {
        // ignore our own openapi_spec writes
        if (change.operationType === 'update' && change.updateDescription?.updatedFields) {
            const keys = Object.keys(change.updateDescription.updatedFields)
            if (keys.every(k => k.startsWith('openapi_spec'))) return
        }
        if (change.operationType === 'delete') return

        const doc = await db.collection('schema.json').findOne(
            { _id: change.documentKey._id },
            { projection: { name: 1 } }
        )
        if (!doc) return

        console.log(`schema.json changed for: ${doc.name}`)
        await ensureRbacForCollection(doc.name)
        await setFlagTrue(doc.name)
        await processPendingFlags()
    })

    console.log('Watching schema.json collection...')
}

// ─── Watch rbac.json ──────────────────────────────────────────────────────────
async function watchRbacCollection() {
    const db           = mongoose.connection.db
    let   previousRbac = await readRbac()
    const changeStream = db.collection('rbac.json').watch()

    changeStream.on('change', async () => {
        console.log('rbac.json changed — checking affected collections...')
        const newRbac             = await readRbac()
        const affectedCollections = new Set()

        const allRoles = new Set([
            ...Object.keys(previousRbac.roles || {}),
            ...Object.keys(newRbac.roles || {})
        ])

        for (const role of allRoles) {
            const prevPerms = (previousRbac.roles || {})[role] || {}
            const newPerms  = (newRbac.roles || {})[role] || {}
            const allCols   = new Set([...Object.keys(prevPerms), ...Object.keys(newPerms)])

            for (const col of allCols) {
                if (JSON.stringify(prevPerms[col] || []) !== JSON.stringify(newPerms[col] || [])) {
                    affectedCollections.add(col)
                }
            }
        }

        previousRbac = newRbac

        for (const col of affectedCollections) {
            console.log(`RBAC changed for: ${col}`)
            await setFlagTrue(col)
        }

        if (affectedCollections.size > 0) await processPendingFlags()
    })

    console.log('Watching rbac.json collection...')
}

// ─── Watch sync_Flags ─────────────────────────────────────────────────────────
async function watchFlagsCollection() {
    const db         = mongoose.connection.db
    const changeStream = db.collection('sync_Flags').watch()

    changeStream.on('change', async (change) => {
        if (
            change.operationType === 'update' &&
            change.updateDescription?.updatedFields?.tableStatus === true
        ) {
            await processPendingFlags()
        }
    })

    console.log('Watching sync_Flags collection...')
}

// ─── Startup ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(async () => {
        console.log('MongoDB connected')
        await seedRateLimitConfig(mongoose.connection.db)
        await seedEmployeesAndDepartmentsSchema(mongoose.connection.db)
        await initialGeneration()
        await watchSchemaCollection()
        await watchRbacCollection()
        await watchFlagsCollection()
    })
    .catch(err => console.error('MongoDB connection error:', err))

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/openapi', (req, res) => {
    if (!latestOpenApiSpec) {
        return res.status(503).json({ error: 'Docs not yet generated' })
    }
    res.json({ openapi: latestOpenApiSpec })
})

async function handleDynamicRoute(req, res) {
    const { collectionName, id } = req.params
    try {
        const db         = mongoose.connection.db
        const collection = db.collection(collectionName)

        const getQuery = (idVal) => {
            if (mongoose.isValidObjectId(idVal)) {
                return { _id: new mongoose.Types.ObjectId(idVal) }
            }
            const numId    = Number(idVal)
            const singular = collectionName.endsWith('s')
                ? collectionName.slice(0, -1)
                : collectionName
            return !isNaN(numId) ? { [`${singular}_id`]: numId } : { _id: idVal }
        }

        const schemaDoc = await db.collection('schema.json').findOne({ name: collectionName })
        const fields = schemaDoc ? (schemaDoc.fields || []) : []
        const relationFields = fields.filter(f => f.type === 'mappedtable')

        if (req.method === 'GET') {
            if (relationFields.length > 0) {
                const pipeline = []
                if (id) {
                    pipeline.push({ $match: getQuery(id) })
                }
                
                relationFields.forEach(field => {
                    const fName = field.name || field.field
                    pipeline.push({
                        $lookup: {
                            from: field.mappedTableRef,
                            localField: fName,
                            foreignField: '_id',
                            as: fName
                        }
                    })
                    
                    if (field.multipleSelect === false) {
                        pipeline.push({
                            $unwind: {
                                path: `$${fName}`,
                                preserveNullAndEmptyArrays: true
                            }
                        })
                    }
                })
                
                const results = await collection.aggregate(pipeline).toArray()
                if (id) {
                    if (results.length === 0) return res.status(404).json({ error: 'Record not found' })
                    return res.json(results[0])
                }
                return res.json(results)
            } else {
                if (id) {
                    const item = await collection.findOne(getQuery(id))
                    if (!item) return res.status(404).json({ error: 'Record not found' })
                    return res.json(item)
                }
                return res.json(await collection.find({}).toArray())
            }
        }

        if (req.method === 'POST') {
            if (!schemaDoc) {
                return res.status(404).json({ error: `Schema not found for collection: ${collectionName}` })
            }
            const { isValid, errors } = validatePayload(schemaDoc, req.body, false)
            if (!isValid) {
                return res.status(400).json({ error: 'Validation failed', details: errors })
            }

            const relValidation = await validateRelationReferences(db, schemaDoc, req.body)
            if (!relValidation.isValid) {
                return res.status(400).json({ error: relValidation.error })
            }

            const insertData = { ...req.body }
            const createdAtField = schemaDoc.fields.find(f => f.name === 'created_at')
            if (createdAtField && !insertData.created_at) {
                insertData.created_at = new Date().toISOString()
            }

            // Cast relationship fields in primary document to ObjectId(s)
            relationFields.forEach(field => {
                const fName = field.name || field.field
                if (fName in insertData) {
                    insertData[fName] = castToObjectId(insertData[fName])
                }
            })

            const result = await collection.insertOne(insertData)
            const newId = result.insertedId

            // Sync relation changes in paired collections
            const relationWarnings = await handlePostSync(db, collectionName, newId, req.body)

            const response = { message: 'Created successfully', id: newId }
            if (relationWarnings && relationWarnings.length > 0) {
                response.relationWarnings = relationWarnings
            }
            return res.status(201).json(response)
        }

        if (req.method === 'PUT') {
            if (!id) return res.status(400).json({ error: 'ID required for update' })
            if (!schemaDoc) {
                return res.status(404).json({ error: `Schema not found for collection: ${collectionName}` })
            }
            const { isValid, errors } = validatePayload(schemaDoc, req.body, true)
            if (!isValid) {
                return res.status(400).json({ error: 'Validation failed', details: errors })
            }

            const relValidation = await validateRelationReferences(db, schemaDoc, req.body)
            if (!relValidation.isValid) {
                return res.status(400).json({ error: relValidation.error })
            }

            // Fetch state of the document before update
            const oldDoc = await collection.findOne(getQuery(id))
            if (!oldDoc) return res.status(404).json({ error: 'Record not found' })

            const updateData = { ...req.body }
            delete updateData._id

            // Cast relationship fields in primary document update data to ObjectId(s)
            relationFields.forEach(field => {
                const fName = field.name || field.field
                if (fName in updateData) {
                    updateData[fName] = castToObjectId(updateData[fName])
                }
            })

            const result = await collection.updateOne(getQuery(id), { $set: updateData })
            if (result.matchedCount === 0) return res.status(404).json({ error: 'Record not found' })

            // Sync relation changes in paired collections
            const relationWarnings = await handlePutSync(db, collectionName, oldDoc._id, oldDoc, req.body)

            const response = { message: 'Updated successfully' }
            if (relationWarnings && relationWarnings.length > 0) {
                response.relationWarnings = relationWarnings
            }
            return res.json(response)
        }

        if (req.method === 'DELETE') {
            if (!id) return res.status(400).json({ error: 'ID required for deletion' })

            const targetDoc = await collection.findOne(getQuery(id))
            if (!targetDoc) return res.status(404).json({ error: 'Record not found' })

            // Perform relation cleanup across all collections
            const relationWarnings = await handleDeleteSync(db, collectionName, targetDoc._id)

            const result = await collection.deleteOne(getQuery(id))
            if (result.deletedCount === 0) return res.status(404).json({ error: 'Record not found' })

            const response = { message: 'Deleted successfully' }
            if (relationWarnings && relationWarnings.length > 0) {
                response.relationWarnings = relationWarnings
            }
            return res.json(response)
        }

        res.status(405).json({ error: `Method ${req.method} not allowed` })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

app.use('/api/admin', require('./adminRoutes'))

app.all('/api/:collectionName',     operationBlockMiddleware, handleDynamicRoute)
app.all('/api/:collectionName/:id', operationBlockMiddleware, handleDynamicRoute)

const PORT = process.env.PORT || 3001
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`))


