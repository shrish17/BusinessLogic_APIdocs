// adminRoutes.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Helper to get database connection
function getDb() {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Database connection not established');
    }
    return db;
}

// GET /api/admin/rate-limit-config
router.get('/rate-limit-config', async (req, res) => {
    try {
        const db = getDb();
        const config = await db.collection('rate_limit_config').findOne({});
        if (!config) {
            // Return default config representation if not yet seeded
            return res.json({
                windowMs: 1000,
                maxRequests: 10,
                blockDurationMs: 86400000,
                cacheRefreshMs: 10000
            });
        }
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/rate-limit-config
router.put('/rate-limit-config', async (req, res) => {
    try {
        const db = getDb();
        const { windowMs, maxRequests, blockDurationMs, cacheRefreshMs } = req.body;

        // Validation: all fields must be positive numbers if provided
        const fields = { windowMs, maxRequests, blockDurationMs, cacheRefreshMs };
        for (const [key, val] of Object.entries(fields)) {
            if (val !== undefined) {
                const num = Number(val);
                if (isNaN(num) || num <= 0) {
                    return res.status(400).json({ error: `Field '${key}' must be a positive number` });
                }
            }
        }

        // Build update object with only provided fields
        const updateData = {};
        if (windowMs !== undefined) updateData.windowMs = Number(windowMs);
        if (maxRequests !== undefined) updateData.maxRequests = Number(maxRequests);
        if (blockDurationMs !== undefined) updateData.blockDurationMs = Number(blockDurationMs);
        if (cacheRefreshMs !== undefined) updateData.cacheRefreshMs = Number(cacheRefreshMs);

        await db.collection('rate_limit_config').updateOne(
            {},
            { $set: updateData },
            { upsert: true }
        );

        const updatedConfig = await db.collection('rate_limit_config').findOne({});
        res.json(updatedConfig);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/rate-limit-state
router.get('/rate-limit-state', async (req, res) => {
    try {
        const db = getDb();
        // Sort by blocked: true first, i.e. blocked: -1 (true/1 is sorted before false/0 when descending)
        const states = await db.collection('rate_limit_state')
            .find({})
            .sort({ blocked: -1, ip: 1 })
            .toArray();
        res.json(states);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/admin/rate-limit-state/:ip
router.delete('/rate-limit-state/:ip', async (req, res) => {
    try {
        const db = getDb();
        const ip = req.params.ip;
        if (!ip) {
            return res.status(400).json({ error: 'IP parameter is required' });
        }

        const result = await db.collection('rate_limit_state').deleteOne({ ip });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: 'IP state not found' });
        }

        res.json({ message: 'IP block cleared successfully', ip });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/collections
router.get('/collections', async (req, res) => {
    try {
        const db = getDb();
        const collections = await db.collection('schema.json')
            .find({}, { projection: { name: 1, fields: 1, _id: 0 } })
            .toArray();
        res.json(collections);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/blocked-operations
router.get('/blocked-operations', async (req, res) => {
    try {
        const db = getDb();
        const schemas = await db.collection('schema.json').find({}).toArray();
        const storedBlocked = await db.collection('rate_limit_operations').find({}).toArray();

        const blockedMap = new Map();
        storedBlocked.forEach(doc => {
            blockedMap.set(doc.collectionName, doc.blockedOperations);
        });

        // Merge schemas and stored block settings
        const response = schemas.map(schema => {
            const name = schema.name;
            const blockedOps = blockedMap.has(name) 
                ? blockedMap.get(name) 
                : ["create", "read", "update", "delete"];
            return {
                collectionName: name,
                blockedOperations: blockedOps
            };
        });

        res.json(response);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/admin/blocked-operations
router.put('/blocked-operations', async (req, res) => {
    try {
        const db = getDb();
        const { collectionName, blockedOperations } = req.body;

        if (!collectionName) {
            return res.status(400).json({ error: 'collectionName is required' });
        }
        if (!Array.isArray(blockedOperations)) {
            return res.status(400).json({ error: 'blockedOperations must be an array' });
        }

        // Validate each operation in blockedOperations is one of: create, read, update, delete
        const validOps = ['create', 'read', 'update', 'delete'];
        for (const op of blockedOperations) {
            if (!validOps.includes(op)) {
                return res.status(400).json({ error: `Invalid operation '${op}'. Must be one of: create, read, update, delete` });
            }
        }

        await db.collection('rate_limit_operations').updateOne(
            { collectionName },
            { $set: { collectionName, blockedOperations } },
            { upsert: true }
        );

        res.json({ collectionName, blockedOperations });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
