/* backend/customFunctionSpecMerge.js */
const mongoose = require('mongoose');

async function mergeCustomFunctionPaths(baseSpec) {
    try {
        const db = mongoose.connection.db;
        if (!db) {
            return baseSpec;
        }

        const functions = await db.collection('custom_functions').find({}).toArray();
        if (functions.length === 0) {
            return baseSpec;
        }

        const mergedSpec = {
            ...baseSpec,
            paths: { ...baseSpec.paths }
        };

        functions.forEach(fn => {
            const pathName = `/custom/${fn.functionName}`;
            mergedSpec.paths[pathName] = {
                post: {
                    summary: `Custom Function: ${fn.functionName}`,
                    description: fn.description || "User-authored custom function executed in a secure sandbox.",
                    tags: ["Custom Functions"],
                    requestBody: {
                        description: "Parameters or payload for function execution",
                        content: {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "additionalProperties": true
                                }
                            }
                        }
                    },
                    responses: {
                        "200": {
                            "description": "Successful execution response",
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "additionalProperties": true
                                    }
                                }
                            }
                        },
                        "404": {
                            "description": "Function not found"
                        },
                        "500": {
                            "description": "Runtime execution error or sandboxed function crash"
                        },
                        "504": {
                            "description": "Execution timeout"
                        }
                    }
                }
            };
        });

        return mergedSpec;
    } catch (err) {
        console.error('Failed to merge custom function paths:', err.message);
        return baseSpec;
    }
}

module.exports = { mergeCustomFunctionPaths };
