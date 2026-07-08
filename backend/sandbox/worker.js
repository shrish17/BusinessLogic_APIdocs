/* backend/sandbox/worker.js */
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

const pendingPromises = new Map();
global.pendingPromises = pendingPromises;

parentPort.on('message', (msg) => {
    if (msg.type === 'db_response') {
        const { requestId, result, error } = msg;
        const pending = pendingPromises.get(requestId);
        if (pending) {
            pendingPromises.delete(requestId);
            if (error) {
                pending.reject(new Error(error));
            } else {
                pending.resolve(result);
            }
        }
    }
});

async function run() {
    const { code, reqData } = workerData;

    const helpers = {
        db: {
            get: (collectionName, query) => {
                return new Promise((resolve, reject) => {
                    const requestId = Math.random().toString(36).substring(7);
                    pendingPromises.set(requestId, { resolve, reject });
                    parentPort.postMessage({ type: 'db_get', collectionName, query, requestId });
                });
            },
            create: (collectionName, doc) => {
                return new Promise((resolve, reject) => {
                    const requestId = Math.random().toString(36).substring(7);
                    pendingPromises.set(requestId, { resolve, reject });
                    parentPort.postMessage({ type: 'db_create', collectionName, doc, requestId });
                });
            },
            update: (collectionName, query, update) => {
                return new Promise((resolve, reject) => {
                    const requestId = Math.random().toString(36).substring(7);
                    pendingPromises.set(requestId, { resolve, reject });
                    parentPort.postMessage({ type: 'db_update', collectionName, query, update, requestId });
                });
            },
            delete: (collectionName, query) => {
                return new Promise((resolve, reject) => {
                    const requestId = Math.random().toString(36).substring(7);
                    pendingPromises.set(requestId, { resolve, reject });
                    parentPort.postMessage({ type: 'db_delete', collectionName, query, requestId });
                });
            }
        }
    };

    const sandbox = {
        req: reqData,
        helpers,
        console: {
            log: (...args) => console.log('[Sandbox Log]', ...args),
            error: (...args) => console.error('[Sandbox Error]', ...args)
        }
    };

    vm.createContext(sandbox);

    try {
        const wrappedCode = `
            (async () => {
                ${code}
            })()
        `;
        const result = await vm.runInContext(wrappedCode, sandbox);
        parentPort.postMessage({ type: 'execute_success', result });
    } catch (err) {
        parentPort.postMessage({ type: 'execute_error', error: err.message });
    }
}

run();
