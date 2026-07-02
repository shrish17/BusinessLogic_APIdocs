function formatPrompt(schema, rbac) {
    return `You are an API documentation generator.

Database collections and fields:
${JSON.stringify(schema, null, 2)}

RBAC configuration:
${JSON.stringify(rbac, null, 2)}

Generate a complete OpenAPI 3.0 JSON specification.

Requirements:
- CRUD endpoints for every collection
- Authentication based on RBAC
- Request schemas
- Response schemas
- Example requests
- Example responses

Return ONLY valid JSON.`;
}

module.exports = { formatPrompt };
