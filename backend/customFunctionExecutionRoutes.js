/* backend/customFunctionExecutionRoutes.js */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { executeFunction } = require('./sandbox/executeFunction');

function getDb() {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Database connection not established');
    }
    return db;
}

// POST /api/custom/:functionName -> Execute sandboxed custom function
router.post('/:functionName', async (req, res) => {
    const functionName = req.params.functionName;

    try {
        const db = getDb();
        const func = await db.collection('custom_functions').findOne({ functionName });
        
        if (!func) {
            return res.status(404).json({ error: "Function not found" });
        }

        const reqData = {
            params: req.params || {},
            query: req.query || {},
            body: req.body || {}
        };

        const result = await executeFunction(func.code, reqData);
        res.json(result);
    } catch (err) {
        console.error(`Execution error for custom function '${functionName}':`, err.message);
        
        if (err.isTimeout) {
            return res.status(504).json({
                error: "Function execution failed",
                details: "Execution timeout: Function execution exceeded limit"
            });
        }
        
        res.status(500).json({
            error: "Function execution failed",
            details: err.message
        });
    }
});

module.exports = router;
