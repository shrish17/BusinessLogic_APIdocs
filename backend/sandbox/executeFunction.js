/* backend/sandbox/executeFunction.js */
const { Worker } = require('worker_threads');
const path = require('path');
const mongoose = require('mongoose');

// Helper to cast string ObjectIds recursively
function castObjectIds(val) {
    if (!val) return val;
    if (typeof val === 'string' && mongoose.isValidObjectId(val)) {
        return new mongoose.Types.ObjectId(val);
    }
    if (Array.isArray(val)) {
        return val.map(castObjectIds);
    }
    if (typeof val === 'object') {
        const copy = {};
        for (const k of Object.keys(val)) {
            copy[k] = castObjectIds(val[k]);
        }
        return copy;
    }
    return val;
}

// Helper to serialize ObjectIds to string hex recursively
function serializeObjectIds(val) {
    if (!val) return val;
    if (val instanceof mongoose.Types.ObjectId || (val.constructor && val.constructor.name === 'ObjectId')) {
        return val.toString();
    }
    if (Array.isArray(val)) {
        return val.map(serializeObjectIds);
    }
    if (typeof val === 'object') {
        const copy = {};
        for (const k of Object.keys(val)) {
            copy[k] = serializeObjectIds(val[k]);
        }
        return copy;
    }
    return val;
}

function executeFunction(code, reqData) {
    const timeoutMs = parseInt(process.env.CUSTOM_FUNCTION_TIMEOUT_MS, 10) || 90000;

    return new Promise((resolve, reject) => {
        const workerPath = path.join(__dirname, 'worker.js');
        const worker = new Worker(workerPath, {
            workerData: { code, reqData }
        });

        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            worker.terminate();
            const err = new Error('Execution timeout: Function execution exceeded limit');
            err.isTimeout = true;
            reject(err);
        }, timeoutMs);

        worker.on('message', async (msg) => {
            if (timedOut) return;

            if (msg.type === 'execute_success') {
                clearTimeout(timeout);
                worker.terminate();
                resolve(msg.result);
            } else if (msg.type === 'execute_error') {
                clearTimeout(timeout);
                worker.terminate();
                reject(new Error(msg.error));
            } else if (msg.type.startsWith('db_')) {
                const db = mongoose.connection.db;
                if (!db) {
                    worker.postMessage({
                        type: 'db_response',
                        requestId: msg.requestId,
                        error: 'Database connection not established'
                    });
                    return;
                }

                try {
                    let result;
                    if (msg.type === 'db_get') {
                        const castQuery = castObjectIds(msg.query || {});
                        const docs = await db.collection(msg.collectionName).find(castQuery).toArray();
                        result = serializeObjectIds(docs);
                    } else if (msg.type === 'db_create') {
                        const castDoc = castObjectIds(msg.doc || {});
                        const res = await db.collection(msg.collectionName).insertOne(castDoc);
                        result = { 
                            insertedId: res.insertedId ? res.insertedId.toString() : null, 
                            acknowledged: res.acknowledged 
                        };
                    } else if (msg.type === 'db_update') {
                        const castQuery = castObjectIds(msg.query || {});
                        const castUpdate = castObjectIds(msg.update || {});
                        const res = await db.collection(msg.collectionName).updateMany(castQuery, castUpdate);
                        result = { matchedCount: res.matchedCount, modifiedCount: res.modifiedCount, acknowledged: res.acknowledged };
                    } else if (msg.type === 'db_delete') {
                        const castQuery = castObjectIds(msg.query || {});
                        const res = await db.collection(msg.collectionName).deleteMany(castQuery);
                        result = { deletedCount: res.deletedCount, acknowledged: res.acknowledged };
                    }
                    
                    worker.postMessage({
                        type: 'db_response',
                        requestId: msg.requestId,
                        result
                    });
                } catch (err) {
                    worker.postMessage({
                        type: 'db_response',
                        requestId: msg.requestId,
                        error: err.message
                    });
                }
            }
        });

        worker.on('error', (err) => {
            if (timedOut) return;
            clearTimeout(timeout);
            worker.terminate();
            reject(err);
        });

        worker.on('exit', (code) => {
            if (timedOut) return;
            if (code !== 0) {
                clearTimeout(timeout);
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
    });
}

module.exports = { executeFunction };
