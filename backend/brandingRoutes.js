/* backend/brandingRoutes.js */
// TODO: gate behind admin RBAC

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Helper to get database connection
function getDb() {
    const db = mongoose.connection.db;
    if (!db) {
        throw new Error('Database connection not established');
    }
    return db;
}

// GET /api/branding/active
router.get('/active', async (req, res) => {
    try {
        const db = getDb();
        const activeProfile = await db.collection('branding_profiles').findOne({ isActive: true });
        
        if (!activeProfile) {
            return res.json({
                companyName: "API Documentation Generator",
                logoUrl: "/assets/logo-default.svg"
            });
        }
        
        res.json({
            companyName: activeProfile.companyName || "API Documentation Generator",
            logoUrl: activeProfile.logoUrl || "/assets/logo-default.svg",
            _id: activeProfile._id,
            isActive: activeProfile.isActive
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/branding/profiles
router.get('/profiles', async (req, res) => {
    try {
        const db = getDb();
        const profiles = await db.collection('branding_profiles').find({}).toArray();
        res.json(profiles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/branding/profiles
router.post('/profiles', async (req, res) => {
    try {
        const db = getDb();
        const { companyName, logoUrl, isActive } = req.body;

        if (!companyName) {
            return res.status(400).json({ error: "companyName is required" });
        }

        const isProfileActive = isActive === true;

        if (isProfileActive) {
            await db.collection('branding_profiles').updateMany({}, { $set: { isActive: false, updatedAt: new Date() } });
        }

        const newProfile = {
            companyName,
            logoUrl: logoUrl || "/assets/logo-default.svg",
            isActive: isProfileActive,
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const result = await db.collection('branding_profiles').insertOne(newProfile);
        
        res.json({
            _id: result.insertedId,
            ...newProfile
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/branding/profiles/:id
router.put('/profiles/:id', async (req, res) => {
    try {
        const db = getDb();
        const id = req.params.id;
        const { companyName, logoUrl } = req.body;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid profile ID format" });
        }

        const updateFields = {};
        if (companyName !== undefined) updateFields.companyName = companyName;
        if (logoUrl !== undefined) updateFields.logoUrl = logoUrl;
        updateFields.updatedAt = new Date();

        const result = await db.collection('branding_profiles').findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(id) },
            { $set: updateFields },
            { returnDocument: 'after' }
        );

        if (!result) {
            return res.status(404).json({ error: "Profile not found" });
        }

        const updatedDoc = result.value !== undefined ? result.value : result;
        res.json(updatedDoc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/branding/profiles/:id/activate
router.put('/profiles/:id/activate', async (req, res) => {
    try {
        const db = getDb();
        const id = req.params.id;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid profile ID format" });
        }

        const targetObjectId = new mongoose.Types.ObjectId(id);

        await db.collection('branding_profiles').updateMany({}, { $set: { isActive: false, updatedAt: new Date() } });

        const result = await db.collection('branding_profiles').findOneAndUpdate(
            { _id: targetObjectId },
            { $set: { isActive: true, updatedAt: new Date() } },
            { returnDocument: 'after' }
        );

        if (!result) {
            return res.status(404).json({ error: "Profile not found" });
        }

        const updatedDoc = result.value !== undefined ? result.value : result;
        res.json(updatedDoc);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/branding/profiles/:id
router.delete('/profiles/:id', async (req, res) => {
    try {
        const db = getDb();
        const id = req.params.id;

        if (!mongoose.isValidObjectId(id)) {
            return res.status(400).json({ error: "Invalid profile ID format" });
        }

        const targetObjectId = new mongoose.Types.ObjectId(id);

        const result = await db.collection('branding_profiles').deleteOne({ _id: targetObjectId });
        if (result.deletedCount === 0) {
            return res.status(404).json({ error: "Profile not found" });
        }

        res.json({ message: "Profile deleted successfully", _id: id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
