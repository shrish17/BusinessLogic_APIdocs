// backend/relationSync.js
const mongoose = require('mongoose');

/**
 * Safely casts string ID, array of IDs, or ObjectId into MongoDB Types.ObjectId.
 * @param {any} val - The value to cast.
 * @returns {mongoose.Types.ObjectId|Array<mongoose.Types.ObjectId>|any}
 */
function castToObjectId(val) {
    if (!val) return null;
    if (Array.isArray(val)) {
        return val.map(v => castToObjectId(v)).filter(Boolean);
    }
    if (mongoose.isValidObjectId(val)) {
        return new mongoose.Types.ObjectId(val);
    }
    return val;
}

/**
 * Resolves reciprocal relationship field configs between two collections.
 * @param {string} collectionName - Source collection name.
 * @param {string} fieldName - Relationship field name.
 * @returns {Promise<{ collection: string, field: Object }|null>}
 */
async function resolvePairedField(collectionName, fieldName) {
    try {
        const db = mongoose.connection.db;
        const schemas = await db.collection('schema.json').find({}).toArray();

        const schemaA = schemas.find(s => s.name === collectionName);
        if (!schemaA) return null;

        const fieldsA = schemaA.fields || [];
        const fieldA = fieldsA.find(f => f.name === fieldName || f.field === fieldName);
        if (!fieldA || fieldA.type !== 'mappedtable') return null;

        const collectionB = fieldA.mappedTableRef;
        const reverseFieldB = fieldA.reverseField;

        const schemaB = schemas.find(s => s.name === collectionB);
        if (!schemaB) {
            console.warn(`[RelationSync Warning] Target collection '${collectionB}' schema not found for field '${fieldName}' in '${collectionName}'.`);
            return null;
        }

        const fieldsB = schemaB.fields || [];
        const fieldB = fieldsB.find(f => f.name === reverseFieldB || f.field === reverseFieldB);
        if (!fieldB) {
            console.warn(`[RelationSync Warning] Reverse field '${reverseFieldB}' in collection '${collectionB}' not found.`);
            return null;
        }

        if (fieldB.type !== 'mappedtable') {
            console.warn(`[RelationSync Warning] Reverse field '${reverseFieldB}' in collection '${collectionB}' is not of type 'mappedtable'.`);
            return null;
        }

        const nameA = fieldA.name || fieldA.field;
        const nameB = fieldB.name || fieldB.field;

        // Verify pairing symmetry
        if (fieldB.mappedTableRef === collectionName && fieldB.reverseField === nameA) {
            return {
                collection: collectionB,
                field: fieldB
            };
        } else {
            console.warn(`[RelationSync Warning] Relationship config mismatch/asymmetry between '${collectionName}.${nameA}' and '${collectionB}.${nameB}'.`);
            return null;
        }
    } catch (err) {
        console.error(`[RelationSync Error] Error resolving paired field for '${collectionName}.${fieldName}':`, err.message);
        return null;
    }
}

/**
 * Normalizes values (singular, array, or null) into string arrays for comparison.
 * @param {any} val - Value to normalize.
 * @returns {Array<string>}
 */
function normalizeIds(val) {
    if (!val) return [];
    if (Array.isArray(val)) {
        return val.map(v => v.toString()).filter(Boolean);
    }
    return [val.toString()];
}

/**
 * Handles relation synchronization after a document is created.
 * @param {Object} db - MongoDB db instance.
 * @param {string} collectionName - Source collection name.
 * @param {mongoose.Types.ObjectId} newId - Newly created document ID.
 * @param {Object} bodyPayload - Request body payload.
 * @returns {Promise<Array<string>>} List of relation warnings (non-fatal errors).
 */
async function handlePostSync(db, collectionName, newId, bodyPayload) {
    const warnings = [];
    try {
        const schemaDoc = await db.collection('schema.json').findOne({ name: collectionName });
        if (!schemaDoc) return warnings;

        const fields = schemaDoc.fields || [];
        const relationFields = fields.filter(f => f.type === 'mappedtable');

        for (const field of relationFields) {
            const fName = field.name || field.field;
            const submittedValue = bodyPayload[fName];

            // If the field is not present or is null/undefined in POST body, skip
            if (submittedValue === undefined || submittedValue === null) continue;

            const paired = await resolvePairedField(collectionName, fName);
            if (!paired) continue;

            const targetIds = normalizeIds(submittedValue);
            const pairedFName = paired.field.name || paired.field.field;

            for (const targetId of targetIds) {
                try {
                    const targetObjectId = castToObjectId(targetId);
                    if (!targetObjectId) continue;

                    if (paired.field.multipleSelect) {
                        await db.collection(paired.collection).updateOne(
                            { _id: targetObjectId },
                            { $addToSet: { [pairedFName]: newId } }
                        );
                    } else {
                        await db.collection(paired.collection).updateOne(
                            { _id: targetObjectId },
                            { $set: { [pairedFName]: newId } }
                        );
                    }
                    console.log(`[RelationSync Success] Linked document '${newId}' in '${collectionName}' to '${targetId}' in '${paired.collection}' (field: ${pairedFName})`);
                } catch (err) {
                    const warnMsg = `Failed to sync relation for ${paired.collection} (${targetId}) field '${pairedFName}'`;
                    console.error(`[RelationSync Error] ${warnMsg} with document '${newId}':`, err.message);
                    warnings.push(warnMsg);
                }
            }
        }
    } catch (err) {
        console.error(`[RelationSync Error] handlePostSync failed for collection '${collectionName}':`, err.message);
        warnings.push(`Relation sync failed: ${err.message}`);
    }
    return warnings;
}

/**
 * Handles relation synchronization diffing and update on PUT.
 * @param {Object} db - MongoDB db instance.
 * @param {string} collectionName - Source collection name.
 * @param {mongoose.Types.ObjectId} docId - The updated document ID.
 * @param {Object} oldDoc - The document state before update.
 * @param {Object} newBodyPayload - Request body payload containing updates.
 * @returns {Promise<Array<string>>} List of relation warnings (non-fatal errors).
 */
async function handlePutSync(db, collectionName, docId, oldDoc, newBodyPayload) {
    const warnings = [];
    try {
        const schemaDoc = await db.collection('schema.json').findOne({ name: collectionName });
        if (!schemaDoc) return warnings;

        const fields = schemaDoc.fields || [];
        const relationFields = fields.filter(f => f.type === 'mappedtable');

        for (const field of relationFields) {
            const fName = field.name || field.field;

            // Only perform diffing/updates if the relation field is present in PUT body
            if (!(fName in newBodyPayload)) continue;

            const oldVal = oldDoc ? oldDoc[fName] : null;
            const newVal = newBodyPayload[fName];

            const oldIds = normalizeIds(oldVal);
            const newIds = normalizeIds(newVal);

            // Compute diff
            const removedIds = oldIds.filter(id => !newIds.includes(id));
            const addedIds = newIds.filter(id => !oldIds.includes(id));

            if (removedIds.length === 0 && addedIds.length === 0) continue;

            const paired = await resolvePairedField(collectionName, fName);
            if (!paired) continue;

            const pairedFName = paired.field.name || paired.field.field;

            // 1. Process Removed IDs (unlink)
            for (const removedId of removedIds) {
                try {
                    const targetObjectId = castToObjectId(removedId);
                    if (!targetObjectId) continue;

                    if (paired.field.multipleSelect) {
                        await db.collection(paired.collection).updateOne(
                            { _id: targetObjectId },
                            { $pull: { [pairedFName]: docId } }
                        );
                    } else {
                        // Singular link: clear reference
                        await db.collection(paired.collection).updateOne(
                            { _id: targetObjectId },
                            { $unset: { [pairedFName]: "" } }
                        );
                    }
                    console.log(`[RelationSync Success] Unlinked document '${docId}' in '${collectionName}' from '${removedId}' in '${paired.collection}' (field: ${pairedFName})`);
                } catch (err) {
                    const warnMsg = `Failed to unlink relation for ${paired.collection} (${removedId}) field '${pairedFName}'`;
                    console.error(`[RelationSync Error] ${warnMsg} with document '${docId}':`, err.message);
                    warnings.push(warnMsg);
                }
            }

            // 2. Process Added IDs (link)
            for (const addedId of addedIds) {
                try {
                    const targetObjectId = castToObjectId(addedId);
                    if (!targetObjectId) continue;

                    if (paired.field.multipleSelect) {
                        await db.collection(paired.collection).updateOne(
                            { _id: targetObjectId },
                            { $addToSet: { [pairedFName]: docId } }
                        );
                    } else {
                        await db.collection(paired.collection).updateOne(
                            { _id: targetObjectId },
                            { $set: { [pairedFName]: docId } }
                        );
                    }
                    console.log(`[RelationSync Success] Linked document '${docId}' in '${collectionName}' to '${addedId}' in '${paired.collection}' (field: ${pairedFName})`);
                } catch (err) {
                    const warnMsg = `Failed to link relation for ${paired.collection} (${addedId}) field '${pairedFName}'`;
                    console.error(`[RelationSync Error] ${warnMsg} with document '${docId}':`, err.message);
                    warnings.push(warnMsg);
                }
            }
        }
    } catch (err) {
        console.error(`[RelationSync Error] handlePutSync failed for collection '${collectionName}':`, err.message);
        warnings.push(`Relation sync failed: ${err.message}`);
    }
    return warnings;
}

/**
 * Handles relation cleanup across all collections when a document is deleted.
 * @param {Object} db - MongoDB db instance.
 * @param {string} collectionName - Name of the collection being deleted from.
 * @param {mongoose.Types.ObjectId|any} deletedId - The deleted document's ID.
 * @returns {Promise<Array<string>>} List of cleanup warnings.
 */
async function handleDeleteSync(db, collectionName, deletedId) {
    const warnings = [];
    try {
        const schemas = await db.collection('schema.json').find({}).toArray();

        // Scan all schemas and check fields that reference this collection
        for (const schemaDoc of schemas) {
            const colName = schemaDoc.name;
            const fields = schemaDoc.fields || [];

            const refFields = fields.filter(f => f.type === 'mappedtable' && f.mappedTableRef === collectionName);

            for (const field of refFields) {
                const refFName = field.name || field.field;
                try {
                    let result;
                    if (field.multipleSelect) {
                        // Array of references: pull the deleted ID
                        result = await db.collection(colName).updateMany(
                            { [refFName]: deletedId },
                            { $pull: { [refFName]: deletedId } }
                        );
                    } else {
                        // Singular reference: unset the reference
                        result = await db.collection(colName).updateMany(
                            { [refFName]: deletedId },
                            { $unset: { [refFName]: "" } }
                        );
                    }
                    if (result.modifiedCount > 0) {
                        console.log(`[RelationSync Cleanup] Cleaned up ${result.modifiedCount} references to '${deletedId}' of '${collectionName}' in collection '${colName}' (field: ${refFName})`);
                    }
                } catch (err) {
                    const warnMsg = `Failed relational cleanup in collection '${colName}' for field '${refFName}' referencing deleted ID '${deletedId}'`;
                    console.error(`[RelationSync Error] ${warnMsg}:`, err.message);
                    warnings.push(warnMsg);
                }
            }
        }
    } catch (err) {
        console.error(`[RelationSync Error] handleDeleteSync failed for '${collectionName}' ID '${deletedId}':`, err.message);
        warnings.push(`Relational cleanup failed: ${err.message}`);
    }
    return warnings;
}

/**
 * Validates that all referenced IDs in mappedtable fields exist in their target collections.
 * @param {Object} db - MongoDB database instance.
 * @param {Object} schemaDoc - Schema configuration document.
 * @param {Object} reqBody - Request payload (POST or PUT body).
 * @returns {Promise<{ isValid: boolean, error?: string }>}
 */
async function validateRelationReferences(db, schemaDoc, reqBody) {
    const fields = schemaDoc.fields || [];
    const relationFields = fields.filter(f => f.type === 'mappedtable');

    for (const field of relationFields) {
        const fName = field.name || field.field;
        
        // Only validate if the field is present in the request body
        if (!(fName in reqBody)) continue;

        const val = reqBody[fName];
        if (val === null || val === undefined) continue;

        const values = Array.isArray(val) ? val : [val];
        const targetColl = field.mappedTableRef;
        const targetSingular = targetColl.endsWith('s') ? targetColl.slice(0, -1) : targetColl;

        for (const v of values) {
            // 1. Check if it is a valid ObjectId format
            if (!mongoose.isValidObjectId(v)) {
                return {
                    isValid: false,
                    error: `Field '${fName}' must be a valid ${targetColl} _id (received '${v}', which is not a valid ObjectId). Did you mean to look up the ${targetSingular}'s _id first?`
                };
            }

            // 2. Check if the document exists in the target collection
            try {
                const targetObjectId = new mongoose.Types.ObjectId(v);
                const docExists = await db.collection(targetColl).findOne({ _id: targetObjectId }, { projection: { _id: 1 } });
                if (!docExists) {
                    return {
                        isValid: false,
                        error: `Field '${fName}' references ${targetColl}/${v}, but no document with that _id exists.`
                    };
                }
            } catch (err) {
                return {
                    isValid: false,
                    error: `Field '${fName}' verification failed: ${err.message}`
                };
            }
        }
    }

    return { isValid: true };
}

module.exports = {
    castToObjectId,
    resolvePairedField,
    handlePostSync,
    handlePutSync,
    handleDeleteSync,
    validateRelationReferences
};
