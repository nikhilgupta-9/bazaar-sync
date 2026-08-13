const { pool } = require("../config/db");
const paperWalletService = require("../services/paperWalletService");

// Gates actual paper-trade order placement (open/close) — trial-active OR
// Pro, per paperWalletService.getWalletStatus's accessAllowed. Same shape
// as requirePro.js (re-checks the live DB, never trusts the JWT payload).
async function requirePaperAccess(req, res, next) {
    try {
        const [[user]] = await pool.query("SELECT tier, pro_expires_at FROM users WHERE id = ?", [req.user.sub]);
        if (!user) return res.status(401).json({ error: "user not found" });

        const status = await paperWalletService.getWalletStatus(req.user.sub, user);
        if (!status.accessAllowed) {
            return res.status(403).json({ error: "your free trial has ended — get Pro to continue paper trading" });
        }
        next();
    } catch (err) {
        console.error("[requirePaperAccess]", err);
        res.status(500).json({ error: "failed to verify paper trade access" });
    }
}

module.exports = { requirePaperAccess };
