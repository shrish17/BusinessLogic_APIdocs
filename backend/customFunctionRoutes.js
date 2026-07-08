/* backend/customFunctionRoutes.js */
// TODO: gate behind admin RBAC once auth exists

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const templates = require('./customFunctions/templates');

function getDb() {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Database connection not established');
    }
    return db;
}

// GET /api/custom-functions -> list all (functionName, description, updatedAt only)
router.get('/', async (req, res) => {
    try {
        const db = getDb();
        const list = await db.collection('custom_functions')
            .find({}, { projection: { functionName: 1, description: 1, updatedAt: 1 } })
            .toArray();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/custom-functions/templates -> starter templates
router.get('/templates', (req, res) => {
    res.json(templates);
});

// GET /api/custom-functions/:name -> full document
router.get('/:name', async (req, res) => {
    try {
        const db = getDb();
        const func = await db.collection('custom_functions').findOne({ functionName: req.params.name });
        if (!func) {
            return res.status(404).json({ error: "Custom function not found" });
        }
        res.json(func);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/custom-functions/:name/versions -> version history only
router.get('/:name/versions', async (req, res) => {
    try {
        const db = getDb();
        const func = await db.collection('custom_functions').findOne(
            { functionName: req.params.name },
            { projection: { versions: 1 } }
        );
        if (!func) {
            return res.status(404).json({ error: "Custom function not found" });
        }
        res.json(func.versions || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/custom-functions -> create
router.post('/', async (req, res) => {
    try {
        const db = getDb();
        const { functionName, description, code, template } = req.body;

        if (!functionName || !code) {
            return res.status(400).json({ error: "functionName and code are required" });
        }

        const slugRegex = /^[a-zA-Z0-9-_]+$/;
        if (!slugRegex.test(functionName)) {
            return res.status(400).json({ error: "functionName must be a valid URL-safe slug (alphanumeric, dashes, underscores only)" });
        }

        const existing = await db.collection('custom_functions').findOne({ functionName });
        if (existing) {
            return res.status(409).json({ error: "Custom function with this name already exists" });
        }

        const newFunc = {
            functionName,
            description: description || "",
            code,
            template: template || null,
            versions: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('custom_functions').insertOne(newFunc);

        if (global.rebuildFullSpec) {
            await global.rebuildFullSpec();
        }

        res.status(201).json({
            _id: result.insertedId,
            ...newFunc
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/custom-functions/:name -> update
router.put('/:name', async (req, res) => {
    try {
        const db = getDb();
        const { description, code } = req.body;
        const functionName = req.params.name;

        const existing = await db.collection('custom_functions').findOne({ functionName });
        if (!existing) {
            return res.status(404).json({ error: "Custom function not found" });
        }

        const updateDoc = {};
        if (description !== undefined) {
            updateDoc.description = description;
        }

        if (code !== undefined && code !== existing.code) {
            updateDoc.code = code;
            
            const previousVersion = {
                code: existing.code,
                savedAt: existing.updatedAt || existing.createdAt || new Date()
            };
            
            await db.collection('custom_functions').updateOne(
                { functionName },
                { 
                    $set: { ...updateDoc, updatedAt: new Date() },
                    $push: { versions: previousVersion }
                }
            );
        } else if (Object.keys(updateDoc).length > 0) {
            await db.collection('custom_functions').updateOne(
                { functionName },
                { $set: { ...updateDoc, updatedAt: new Date() } }
            );
        }

        const updated = await db.collection('custom_functions').findOne({ functionName });

        if (global.rebuildFullSpec) {
            await global.rebuildFullSpec();
        }

        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/custom-functions/:name -> delete
router.delete('/:name', async (req, res) => {
    try {
        const db = getDb();
        const functionName = req.params.name;

        const result = await db.collection('custom_functions').deleteOne({ functionName });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Custom function not found" });
        }

        if (global.rebuildFullSpec) {
            await global.rebuildFullSpec();
        }

        res.json({ message: "Custom function deleted successfully", functionName });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
