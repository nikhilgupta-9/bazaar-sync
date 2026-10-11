// server/controllers/sampleDataController.js
const sampleDataService = require("../services/sampleDataService");

async function getStats(req, res) {
    try {
        const stats = await sampleDataService.getSampleDataStats();
        res.json(stats);
    } catch (err) {
        console.error("[SampleDataController] Stats Error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch sample data stats" });
    }
}

async function importData(req, res) {
    try {
        const category = req.body?.category || "all";
        const results = await sampleDataService.importAllSampleData(category);
        res.json({
            success: true,
            category,
            results,
            message: "Sample test data imported successfully! System caches refreshed.",
        });
    } catch (err) {
        console.error("[SampleDataController] Import Error:", err);
        res.status(500).json({ error: err.message || "Failed to import sample test data" });
    }
}

async function clearData(req, res) {
    try {
        const category = req.body?.category || "all";
        const results = await sampleDataService.clearSampleData(category);
        res.json({
            success: true,
            category,
            results,
            message: "Sample data cleared successfully.",
        });
    } catch (err) {
        console.error("[SampleDataController] Clear Error:", err);
        res.status(500).json({ error: err.message || "Failed to clear sample data" });
    }
}

module.exports = {
    getStats,
    importData,
    clearData,
};
