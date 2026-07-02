// backend/validator.js
const mongoose = require('mongoose');

/**
 * Validates a request body against a collection schema.
 * @param {Object} schemaDoc - The schema document from schema.json collection.
 * @param {Object} data - The request payload (req.body).
 * @param {Boolean} isUpdate - True if checking a PUT (update) request.
 * @returns {Object} { isValid: Boolean, errors: Array }
 */
function validatePayload(schemaDoc, data, isUpdate = false) {
    const errors = [];
    const fields = schemaDoc.fields || [];
    
    // Create a map of allowed field names and their configurations
    const fieldMap = {};
    fields.forEach(f => {
        fieldMap[f.name] = f;
    });

    // 1. Check for unknown fields (Strict Schema Mode)
    const submittedKeys = Object.keys(data || {});
    submittedKeys.forEach(key => {
        // Allow MongoDB _id to be passed optionally
        if (key === '_id') return;
        
        if (!fieldMap[key]) {
            errors.push(`Field '${key}' is not allowed in schema for '${schemaDoc.name}'`);
        }
    });

    // 2. Validate fields
    fields.forEach(field => {
        const fieldName = field.name;
        const fieldType = field.type;
        const isRequired = field.required;
        const isSubmitted = data && (fieldName in data);

        // Skip validation for system generated fields (like _id, created_at, updated_at) if not submitted on POST
        if (!isUpdate && !isSubmitted && ['_id', 'created_at', 'updated_at'].includes(fieldName)) {
            return;
        }

        // Required check (Only check required fields for POST/create or if explicitly submitted during update)
        if (isRequired && !isUpdate && !isSubmitted) {
            errors.push(`Field '${fieldName}' is required`);
            return;2
        }

        // Type check if the field is present in the data
        if (isSubmitted) {
            const value = data[fieldName];

            // If a value is null/undefined and not required, it's fine. If required, it shouldn't be null.
            if (value === null || value === undefined) {
                if (isRequired) {
                    errors.push(`Required field '${fieldName}' cannot be null or undefined`);
                }
                return;
            }

            if (fieldType === 'ObjectId') {
                if (!mongoose.isValidObjectId(value)) {
                    errors.push(`Field '${fieldName}' must be a valid MongoDB ObjectId`);
                }
            } else if (fieldType === 'integer') {
                if (!Number.isInteger(value)) {
                    errors.push(`Field '${fieldName}' must be an integer`);
                }
            } else if (fieldType === 'number') {
                if (typeof value !== 'number' || isNaN(value)) {
                    errors.push(`Field '${fieldName}' must be a valid number`);
                }
            } else if (fieldType === 'datetime') {
                if (isNaN(Date.parse(value))) {
                    errors.push(`Field '${fieldName}' must be a valid date/time string`);
                }
            } else if (fieldType === 'array') {
                if (!Array.isArray(value)) {
                    errors.push(`Field '${fieldName}' must be an array`);
                }
            } else if (fieldType === 'string') {
                if (typeof value !== 'string') {
                    errors.push(`Field '${fieldName}' must be a string`);
                } else if (fieldName.toLowerCase() === 'email') {
                    // Simple email format validation
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(value)) {
                        errors.push(`Field '${fieldName}' must be a valid email address`);
                    }
                }
            }
        }
    });

    return {
        isValid: errors.length === 0,
        errors
    };
}

module.exports = { validatePayload };
