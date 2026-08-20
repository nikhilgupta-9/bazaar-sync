const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const { isInstituteIp } = require("../services/instituteAccessService");

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "7d";

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

module.exports = { register, login, me };
