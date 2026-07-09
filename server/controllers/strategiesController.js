const { pool } = require("../config/db");

// Saving is Pro-gated per hard rules ("Free tier users cannot access
// Strategy Builder save"); listing/deleting only requires being logged in,
// so a lapsed Pro subscriber can still see and export what they already
// saved — they just can't create new ones.
async function createStrategy(req, res) {
    try {
        const { name, underlying, legs } = req.body;
        if (!name || !underlying || !Array.isArray(legs) || !legs.length || legs.length > 6) {
            return res.status(400).json({ error: "name, underlying and 1-6 legs are required" });
        }
        const [result] = await pool.query(
            "INSERT INTO strategies (user_id, name, underlying, legs) VALUES (?, ?, ?, ?)",
            [req.user.sub, name, underlying, JSON.stringify(legs)]
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) {
        console.error("[strategies:create]", err);
        res.status(500).json({ error: "failed to save strategy" });
    }
}

async function listStrategies(req, res) {
    try {
        const [rows] = await pool.query(
            "SELECT id, name, underlying, legs, created_at FROM strategies WHERE user_id = ? ORDER BY created_at DESC",
            [req.user.sub]
        );
        res.json({ strategies: rows });
    } catch (err) {
        console.error("[strategies:list]", err);
        res.status(500).json({ error: "failed to load strategies" });
    }
}

async function deleteStrategy(req, res) {
    try {
        const [result] = await pool.query(
            "DELETE FROM strategies WHERE id = ? AND user_id = ?",
            [req.params.id, req.user.sub]
        );
        if (!result.affectedRows) return res.status(404).json({ error: "strategy not found" });
        res.status(204).end();
    } catch (err) {
        console.error("[strategies:delete]", err);
        res.status(500).json({ error: "failed to delete strategy" });
    }
}

module.exports = { createStrategy, listStrategies, deleteStrategy };
