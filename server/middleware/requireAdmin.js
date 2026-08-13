const { pool } = require("../config/db");

// Same "re-check the live DB, don't trust the JWT payload" pattern as
// requirePro.js — the JWT doesn't carry role at all, so this always hits
// the DB (no stale-token edge case to reason about here).
async function requireAdmin(req, res, next) {
    try {
        const [[user]] = await pool.query("SELECT role FROM users WHERE id = ?", [req.user.sub]);
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "admin access required" });
        }
        next();
    } catch (err) {
        console.error("[requireAdmin]", err);
        res.status(500).json({ error: "failed to verify admin access" });
    }
}

module.exports = { requireAdmin };
