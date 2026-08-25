const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { pool } = require("../config/db");
const { isInstituteIp } = require("../services/instituteAccessService");
const { sendPasswordResetEmail } = require("../services/emailService");

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "7d";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function signToken(user) {
    return jwt.sign(
        { sub: user.id, email: user.email, tier: user.tier },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );
}

function sanitize(user) {
    const { password_hash, ...safe } = user;
    return safe;
}

async function register(req, res) {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: "name, email and password are required" });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: "password must be at least 8 characters" });
        }

        const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
        if (existing.length) {
            return res.status(409).json({ error: "an account with this email already exists" });
        }

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const [result] = await pool.query(
            "INSERT INTO users (name, email, password_hash, tier) VALUES (?, ?, ?, 'free')",
            [name, email, passwordHash]
        );

        const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
        const token = signToken(user);
        res.status(201).json({ token, user: sanitize(user), instituteAccess: await isInstituteIp(req.ip) });
    } catch (err) {
        console.error("[auth:register]", err);
        res.status(500).json({ error: "registration failed" });
    }
}

async function login(req, res) {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: "email and password are required" });
        }

        const [[user]] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
        // Same generic error whether the email doesn't exist or the password is
        // wrong — don't reveal which, that's a user-enumeration leak.
        if (!user || !user.password_hash) {
            return res.status(401).json({ error: "invalid email or password" });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: "invalid email or password" });
        }

        const token = signToken(user);
        res.json({ token, user: sanitize(user), instituteAccess: await isInstituteIp(req.ip) });
    } catch (err) {
        console.error("[auth:login]", err);
        res.status(500).json({ error: "login failed" });
    }
}

async function me(req, res) {
    try {
        const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [req.user.sub]);
        if (!user) return res.status(404).json({ error: "user not found" });
        // instituteAccess: this request's IP is on the allowlist (see
        // instituteAccessService.js) — Pro-equivalent access, never written
        // to user.tier. The client ORs this into its isPro check so the UI
        // doesn't show "Get Pro" prompts to someone the backend would let
        // through anyway.
        const instituteAccess = await isInstituteIp(req.ip);
        res.json({ user: sanitize(user), instituteAccess });
    } catch (err) {
        console.error("[auth:me]", err);
        res.status(500).json({ error: "failed to load user" });
    }
}

async function forgotPassword(req, res) {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: "email is required" });

        const [[user]] = await pool.query("SELECT id, email, password_hash FROM users WHERE email = ?", [email]);
        // Always the same generic response whether the email doesn't exist,
        // or exists but is Google-only (no password_hash to reset) — don't
        // leak which, same user-enumeration-avoidance convention as login()
        // above. The actual email send only happens in the real case.
        if (user && user.password_hash) {
            const rawToken = crypto.randomBytes(32).toString("hex");
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            await pool.query(
                "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
                [user.id, tokenHash, new Date(Date.now() + RESET_TOKEN_TTL_MS)]
            );
            const resetLink = `${process.env.CLIENT_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
            await sendPasswordResetEmail(user.email, resetLink);
        }
        res.json({ message: "If an account exists for that email, a password reset link has been sent." });
    } catch (err) {
        console.error("[auth:forgotPassword]", err);
        res.status(500).json({ error: err.message || "failed to process request" });
    }
}

async function resetPassword(req, res) {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) {
            return res.status(400).json({ error: "token and newPassword are required" });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: "password must be at least 8 characters" });
        }

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        // expires_at > NOW() compared in SQL, not JS — dateStrings:true means
        // DATETIME columns come back as plain strings (see Gotcha #12), so
        // letting MySQL do the temporal comparison natively avoids parsing
        // one at all rather than risking it.
        const [[row]] = await pool.query(
            "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()",
            [tokenHash]
        );
        if (!row) {
            return res.status(400).json({ error: "this reset link is invalid or has expired" });
        }

        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, row.user_id]);
        // Invalidate every outstanding token for this user, not just the one
        // used — a stale second link (e.g. requested twice) shouldn't still
        // work after the password's already been changed.
        await pool.query(
            "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL",
            [row.user_id]
        );

        res.json({ message: "Password has been reset — you can now log in with your new password." });
    } catch (err) {
        console.error("[auth:resetPassword]", err);
        res.status(500).json({ error: "failed to reset password" });
    }
}

module.exports = { register, login, me, forgotPassword, resetPassword };
