const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

/**
 * Verifies the Authorization: Bearer <token> header, checks JWT signature,
 * and validates that this session has not been superseded by a newer login on another device.
 */
async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing or invalid Authorization header" });

    try {
        const secret = process.env.JWT_SECRET || "bazaar_sync_jwt_secret_dev_key_2026";
        const decoded = jwt.verify(token, secret);

        // Single-device session validation
        if (decoded.sid) {
            const [[user]] = await pool.query(
                "SELECT id, email, tier, role, current_session_id FROM users WHERE id = ?",
                [decoded.sub]
            );

            if (!user) {
                return res.status(401).json({ error: "USER_NOT_FOUND", message: "User account not found." });
            }

            if (user.current_session_id && user.current_session_id !== decoded.sid) {
                return res.status(401).json({
                    error: "SESSION_REVOKED",
                    message: "You have been logged out because your account was logged in on another device.",
                });
            }

            req.user = {
                ...decoded,
                tier: user.tier,
                role: user.role,
            };
        } else {
            req.user = decoded;
        }

        next();
    } catch (err) {
        return res.status(401).json({ error: "invalid or expired token" });
    }
}

module.exports = { requireAuth };
