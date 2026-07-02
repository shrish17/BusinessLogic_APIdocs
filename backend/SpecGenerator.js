// backend/specGenerator.js

/**
 * Generates an OpenAPI 3.0 specification for a given collection schema.
 * @param {Object} collection - The collection document containing name and fields.
 * @returns {Object} OpenAPI spec paths and components.
 */
function generateOpenApiSpec(collection) {
    const pluralName = collection.name;
    const singularName = pluralName.endsWith('s') ? pluralName.slice(0, -1) : pluralName;
    
    const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);
    const modelName = capitalize(singularName);
    const createModelName = `Create${modelName}`;
    const updateModelName = `Update${modelName}`;

    const properties = {};
    const allRequired = [];
    const createProperties = {};
    const createRequired = [];
    const updateProperties = {};

    collection.fields.forEach(field => {
        const fieldName = field.name;
        const fieldType = field.type;
        const isRequired = field.required;

        let fieldSchema = {};
        if (fieldType === 'ObjectId') {
            fieldSchema = { type: 'string', description: 'MongoDB ObjectId' };
        } else if (fieldType === 'integer') {
            fieldSchema = { type: 'integer' };
        } else if (fieldType === 'number') {
            fieldSchema = { type: 'number' };
        } else if (fieldType === 'datetime') {
            fieldSchema = { type: 'string', format: 'date-time' };
        } else if (fieldType === 'array') {
            fieldSchema = { type: 'array', items: { type: 'string' } };
        } else if (fieldType === 'mappedtable') {
            const isReverse = field.relationRole === 'reverse';
            const ref = field.mappedTableRef;
            
            let description = '';
            if (isReverse) {
                description = `Automatically maintained — do not set this field directly; it updates when ${ref} reference this ${singularName}.`;
            } else {
                description = `Must be a valid ${ref} _id. Create the related ${ref} record first and use its returned _id here.`;
            }

            const itemSchema = {
                type: 'string',
                description: description,
                example: '60d21b4667d0d8992e610c85'
            };

            if (field.multipleSelect) {
                fieldSchema = {
                    type: 'array',
                    items: itemSchema
                };
            } else {
                fieldSchema = itemSchema;
            }

            if (isReverse) {
                fieldSchema.readOnly = true;
            }
        } else {
            fieldSchema = { type: 'string' };
            if (fieldName.toLowerCase() === 'email') {
                fieldSchema.format = 'email';
            }
        }

        // Full Model
        properties[fieldName] = fieldSchema;
        if (isRequired) allRequired.push(fieldName);

        // Create Model (excludes _id, created_at, updated_at)
        if (!['_id', 'created_at', 'updated_at'].includes(fieldName)) {
            createProperties[fieldName] = fieldSchema;
            if (isRequired) createRequired.push(fieldName);
        }

        // Update Model (excludes _id, created_at, updated_at, primary seq ID)
        if (!['_id', 'created_at', 'updated_at', `${singularName}_id`].includes(fieldName)) {
            updateProperties[fieldName] = fieldSchema;
        }
    });

    const queryParameters = collection.fields
        .filter(f => f.name !== '_id' && f.type !== 'array')
        .map(f => ({
            name: f.name,
            in: 'query',
            required: false,
            schema: f.type === 'integer' ? { type: 'integer' } : { type: 'string' }
        }));

    const paths = {
        [`/${pluralName}`]: {
            get: {
                summary: `List all ${pluralName}`,
                tags: [pluralName],
                security: [{ bearerAuth: [] }],
                parameters: queryParameters,
                responses: {
                    200: {
                        description: "Successful response",
                        content: {
                            "application/json": {
                                schema: {
                                    type: "array",
                                    items: { $ref: `#/components/schemas/${modelName}` }
                                }
                            }
                        }
                    },
                    401: { description: "Unauthorized" },
                    403: { description: "Forbidden" }
                }
            },
            post: {
                summary: `Create a new ${singularName}`,
                tags: [pluralName],
                security: [{ bearerAuth: [] }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: `#/components/schemas/${createModelName}` }
                        }
                    }
                },
                responses: {
                    201: {
                        description: `${modelName} created`,
                        content: {
                            "application/json": {
                                schema: { $ref: `#/components/schemas/${modelName}` }
                            }
                        }
                    },
                    400: { description: "Bad request" },
                    401: { description: "Unauthorized" },
                    403: { description: "Forbidden" }
                }
            }
        },
        [`/${pluralName}/{id}`]: {
            get: {
                summary: `Get a ${singularName} by ID`,
                tags: [pluralName],
                security: [{ bearerAuth: [] }],
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string" }
                    }
                ],
                responses: {
                    200: {
                        description: "Successful response",
                        content: {
                            "application/json": {
                                schema: { $ref: `#/components/schemas/${modelName}` }
                            }
                        }
                    },
                    401: { description: "Unauthorized" },
                    403: { description: "Forbidden" },
                    404: { description: "Not found" }
                }
            },
            put: {
                summary: `Update a ${singularName}`,
                tags: [pluralName],
                security: [{ bearerAuth: [] }],
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string" }
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: `#/components/schemas/${updateModelName}` }
                        }
                    }
                },
                responses: {
                    200: {
                        description: `${modelName} updated`,
                        content: {
                            "application/json": {
                                schema: { $ref: `#/components/schemas/${modelName}` }
                            }
                        }
                    },
                    400: { description: "Bad request" },
                    401: { description: "Unauthorized" },
                    403: { description: "Forbidden" },
                    404: { description: "Not found" }
                }
            },
            delete: {
                summary: `Delete a ${singularName}`,
                tags: [pluralName],
                security: [{ bearerAuth: [] }],
                parameters: [
                    {
                        name: "id",
                        in: "path",
                        required: true,
                        schema: { type: "string" }
                    }
                ],
                responses: {
                    204: { description: `${modelName} deleted` },
                    401: { description: "Unauthorized" },
                    403: { description: "Forbidden" },
                    404: { description: "Not found" }
                }
            }
        }
    };

    return {
        paths,
        components: {
            schemas: {
                [modelName]: {
                    type: "object",
                    required: allRequired,
                    properties
                },
                [createModelName]: {
                    type: "object",
                    required: createRequired,
                    properties: createProperties
                },
                [updateModelName]: {
                    type: "object",
                    properties: updateProperties
                }
            },
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer"
                }
            }
        }
    };
}

module.exports = { generateOpenApiSpec };