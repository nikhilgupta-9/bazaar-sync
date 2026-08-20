const { pool } = require("../config/db");
const { isInstituteIp } = require("../services/instituteAccessService");

// Gates Strategy Builder save / Backtest save / full history per the hard
// rule: "Free tier users cannot access Strategy Builder save, Backtesting,
// or full history." Re-checks the live DB tier rather than trusting the
// JWT payload — a Pro subscription lapsing (pro_expires_at) shouldn't have
// to wait for the token itself to expire (up to 7 days) to take effect.
// Also passes a logged-in user requesting from an institute-allowlisted IP
// (see instituteAccessService.js) — Pro-equivalent for this request only,
// never written back to users.tier.
async function requirePro(req, res, next) {
    try {
        const [[user]] = await pool.query("SELECT tier, pro_expires_at FROM users WHERE id = ?", [req.user.sub]);
        if (!user) return res.status(401).json({ error: "user not found" });

        const isPro = user.tier === "pro" && (!user.pro_expires_at || new Date(user.pro_expires_at) > new Date());
        if (!isPro && !(await isInstituteIp(req.ip))) {
            return res.status(403).json({ error: "this feature requires a Pro subscription" });
        }
        next();
    } catch (err) {
        console.error("[requirePro]", err);
        res.status(500).json({ error: "failed to verify subscription" });
    }
}

module.exports = { requirePro };
