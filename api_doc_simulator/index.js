const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

function buildOpenApiFromSchema(schema) {
    const paths = {};

    const collections = schema.collections || [];
    for (const collection of collections) {
        const name = collection.name;
        const fields = collection.fields || [];

        const properties = {};
        const requiredFields = [];

        for (const field of fields) {
            if (field.name === "_id") {
                continue;
            }
            const fType = field.type;

            if (fType === "integer") {
                properties[field.name] = { type: "integer" };
                if (field.required) {
                    requiredFields.push(field.name);
                }
            } else if (fType === "number") {
                properties[field.name] = { type: "number" };
                if (field.required) {
                    requiredFields.push(field.name);
                }
            } else if (fType === "datetime") {
                properties[field.name] = { type: "string", format: "date-time" };
                if (field.required) {
                    requiredFields.push(field.name);
                }
            } else if (fType === "array") {
                properties[field.name] = { type: "array", items: { type: "string" } };
                if (field.required) {
                    requiredFields.push(field.name);
                }
            } else {
                properties[field.name] = { type: "string" };
                if (field.required) {
                    requiredFields.push(field.name);
                }
            }
        }

        const requestSchema = {
            type: "object",
            required: requiredFields,
            properties: properties
        };

        const singularName = name.endsWith('s') ? name.slice(0, -1) : name;

        // /{collectionName} — list + create
        paths[`/${name}`] = {
            get: {
                summary: `Get all ${name}`,
                parameters: [
                    { name: "page", in: "query", schema: { type: "integer" } },
                    { name: "limit", in: "query", schema: { type: "integer" } }
                ],
                responses: {
                    200: { description: `List of ${name}` },
                    401: { description: "Unauthorized" },
                    403: { description: "Forbidden" }
                }
            },
            post: {
                summary: `Create a ${singularName}`,
                requestBody: {
                    content: {
                        "application/json": {
                            schema: requestSchema
                        }
                    }
                },
                responses: {
                    201: { description: "Created successfully" },
                    400: { description: "Bad request" },
                    401: { description: "Unauthorized" }
                }
            }
        };

        // /{collectionName}/{id} — get, update, delete
        paths[`/${name}/{id}`] = {
            get: {
                summary: `Get a ${singularName} by ID`,
                parameters: [
                    { name: "id", in: "path", required: true, schema: { type: "string" } }
                ],
                responses: {
                    200: { description: "Record found" },
                    404: { description: "Not found" }
                }
            },
            put: {
                summary: `Update a ${singularName}`,
                parameters: [
                    { name: "id", in: "path", required: true, schema: { type: "string" } }
                ],
                requestBody: {
                    content: {
                        "application/json": {
                            schema: requestSchema
                        }
                    }
                },
                responses: {
                    200: { description: "Updated successfully" },
                    404: { description: "Not found" }
                }
            },
            delete: {
                summary: `Delete a ${singularName}`,
                parameters: [
                    { name: "id", in: "path", required: true, schema: { type: "string" } }
                ],
                responses: {
                    200: { description: "Deleted successfully" },
                    403: { description: "Forbidden" },
                    404: { description: "Not found" }
                }
            }
        };
    }

    return {
        openapi: "3.0.0",
        info: {
            title: "API Documentation (Dynamic)",
            version: "1.0.0"
        },
        paths: paths
    };
}

app.get('/', (req, res) => {
    res.json({ status: "running — dynamic mock mode" });
});

app.post('/generate', (req, res) => {
    const schema = req.body.schema || {};
    const openapi = buildOpenApiFromSchema(schema);
    res.json({ openapi: JSON.stringify(openapi) });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Simulator backend running on port ${PORT}`);
});
