// server/middleware/requireAdminIp.js — Enforce IP restriction for admin endpoints
const { isIpAllowed, getClientIp } = require("../services/adminSecurityService");

async function requireAdminIp(req, res, next) {
    try {
        const clientIp = getClientIp(req);
        const check = await isIpAllowed(clientIp);

        if (!check.allowed) {
            console.warn(`[Security Alert] Blocked unauthorized admin access attempt from IP: ${clientIp} on ${req.method} ${req.originalUrl}`);
            return res.status(403).json({
                error: `Access Denied: Your IP address (${clientIp}) is not authorized to access the Admin Panel.`,
                clientIp,
                code: "ADMIN_IP_RESTRICTED",
            });
        }

        req.clientIp = clientIp;
        next();
    } catch (err) {
        console.error("[requireAdminIp] Middleware error:", err);
        // Fail-safe: continue on internal error rather than crashing
        next();
    }
}

module.exports = { requireAdminIp };
