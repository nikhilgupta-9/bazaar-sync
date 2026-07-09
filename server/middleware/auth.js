const jwt = require("jsonwebtoken");

// Verifies the Authorization: Bearer <token> header and attaches the decoded
// payload ({ sub, email, tier }) to req.user. Tier here is a snapshot from
// when the token was issued (up to 7 days stale) — requirePro re-checks the
// live DB value for anything that actually gates a paid feature, since a
// downgrade shouldn't wait for the token to expire.
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing or invalid Authorization header" });

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: "invalid or expired token" });
    }
}

module.exports = { requireAuth };
