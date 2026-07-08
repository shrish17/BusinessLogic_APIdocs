const mongoose = require('mongoose');
const { normalizeIp } = require('./rateLimiter');

let operationsCache = null;
let lastCacheTime = 0;
let cacheRefreshMs = 10000; // Default to 10 seconds

// Maps HTTP methods to operations: create, read, update, delete
const methodMap = {
    'GET': 'read',
    'POST': 'create',
    'PUT': 'update',
    'DELETE': 'delete'
};

async function refreshCache(db) {
    const now = Date.now();
    if (!operationsCache || (now - lastCacheTime > cacheRefreshMs)) {
        try {
            // Retrieve configuration if available to find custom cacheRefreshMs
            const configDoc = await db.collection('rate_limit_config').findOne({});
            if (configDoc && configDoc.cacheRefreshMs) {
                cacheRefreshMs = configDoc.cacheRefreshMs;
            } else {
                cacheRefreshMs = 10000;
            }

            const docs = await db.collection('rate_limit_operations').find({}).toArray();
            const newCache = new Map();
            docs.forEach(doc => {
                if (doc.collectionName && Array.isArray(doc.blockedOperations)) {
                    newCache.set(doc.collectionName, doc.blockedOperations);
                }
            });
            operationsCache = newCache;
            lastCacheTime = now;
        } catch (err) {
            console.error('Failed to load rate_limit_operations cache:', err.message);
            // Initialize empty cache on first load failure to fail open
            if (!operationsCache) {
                operationsCache = new Map();
            }
        }
    }
}

async function operationBlockMiddleware(req, res, next) {
    try {
        const method = req.method;
        const op = methodMap[method];
        if (!op) {
            return next();
        }

        const db = mongoose.connection.db;
        if (!db) {
            // DB not connected yet, fail open
            return next();
        }

        const collectionName = req.params.collectionName;
        if (!collectionName) {
            return next();
        }

        // 1. Check if the requesting IP is actually blocked in rate_limit_state
        const rawIp = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
        const ip = normalizeIp(rawIp);
        const ipDoc = await db.collection('rate_limit_state').findOne({ ip });

        const isBlocked = ipDoc && ipDoc.blocked && (!ipDoc.blockExpiry || new Date(ipDoc.blockExpiry).getTime() > Date.now());

        if (!isBlocked) {
            // IP is not blocked — allow the request immediately
            return next();
        }

        // 2. IP is blocked — enforce the collection's blockedOperations policy
        await refreshCache(db);

        const blockedOps = operationsCache.get(collectionName) || [];
        if (blockedOps.includes(op)) {
            return res.status(403).json({
                error: "This operation is currently disabled for this collection by admin configuration."
            });
        }

        next();
    } catch (err) {
        console.error('Error in operationBlockMiddleware:', err.message);
        next(); // Fail open on error
    }
}

module.exports = {
    operationBlockMiddleware
};
