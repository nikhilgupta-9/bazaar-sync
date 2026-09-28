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

const paperWalletService = require("../services/paperWalletService");

async function getUserProfile(req, res) {
    try {
        const userId = req.user.sub;
        const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
        if (!user) return res.status(404).json({ error: "user not found" });

        const instituteAccess = await isInstituteIp(req.ip);
        const isPro = Boolean(instituteAccess || (user.tier === "pro" && user.pro_expires_at && new Date(user.pro_expires_at) > new Date()));

        // Pro days remaining
        let proDaysLeft = 0;
        if (user.tier === "pro" && user.pro_expires_at) {
            const ms = new Date(user.pro_expires_at).getTime() - Date.now();
            proDaysLeft = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
        }

        // Get or initialize wallet
        let wallet = null;
        try {
            wallet = await paperWalletService.getWalletStatus(userId, user);
        } catch (err) {
            console.error("[auth:getUserProfile] walletStatus failed:", err.message);
        }

        // Trading performance summary
        const [[stats]] = await pool.query(
            `SELECT
                COUNT(*) AS total_trades,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_trades,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_trades,
                SUM(CASE WHEN status = 'closed' AND realized_pnl > 0 THEN 1 ELSE 0 END) AS win_trades,
                SUM(CASE WHEN status = 'closed' AND realized_pnl < 0 THEN 1 ELSE 0 END) AS loss_trades,
                COALESCE(SUM(CASE WHEN status = 'closed' THEN realized_pnl ELSE 0 END), 0) AS total_realized_pnl,
                COALESCE(MAX(CASE WHEN status = 'closed' THEN realized_pnl ELSE NULL END), 0) AS max_profit,
                COALESCE(MIN(CASE WHEN status = 'closed' THEN realized_pnl ELSE NULL END), 0) AS max_loss
             FROM paper_positions
             WHERE user_id = ?`,
            [userId]
        );

        const totalClosed = Number(stats?.closed_trades || 0);
        const winTrades = Number(stats?.win_trades || 0);
        const winRate = totalClosed > 0 ? Number(((winTrades / totalClosed) * 100).toFixed(1)) : 0;

        // Saved strategies count
        const [[stratRow]] = await pool.query("SELECT COUNT(*) AS count FROM strategies WHERE user_id = ?", [userId]);

        // Payment / Ledger history
        const [payments] = await pool.query(
            `SELECT id, type, amount, balance_after, razorpay_order_id, razorpay_payment_id, note, created_at
             FROM paper_wallet_ledger
             WHERE user_id = ?
             ORDER BY id DESC
             LIMIT 50`,
            [userId]
        );

        // Recent trades
        const [recentTrades] = await pool.query(
            `SELECT id, symbol, expiry, strike, opt_right, side, lots, lot_size, entry_price, margin_blocked, strategy_name, entry_time, status, exit_price, exit_time, realized_pnl, created_at
             FROM paper_positions
             WHERE user_id = ?
             ORDER BY id DESC
             LIMIT 20`,
            [userId]
        );

        // Available active Pro subscription plans
        const [availablePlans] = await pool.query(
            "SELECT id, name, duration_label, days, price_in_paise, badge, sort_order FROM pro_plans WHERE active = 1 ORDER BY sort_order ASC"
        ).catch(() => [[]]);

        res.json({
            user: {
                ...sanitize(user),
                isPro,
                proDaysLeft,
                instituteAccess,
            },
            wallet,
            tradingStats: {
                totalTrades: Number(stats?.total_trades || 0),
                openTrades: Number(stats?.open_trades || 0),
                closedTrades: totalClosed,
                winTrades,
                lossTrades: Number(stats?.loss_trades || 0),
                winRate,
                totalRealizedPnl: Number(stats?.total_realized_pnl || 0),
                maxProfit: Number(stats?.max_profit || 0),
                maxLoss: Number(stats?.max_loss || 0),
                savedStrategiesCount: Number(stratRow?.count || 0),
            },
            payments: payments || [],
            recentTrades: recentTrades || [],
            availablePlans: availablePlans || [],
        });
    } catch (err) {
        console.error("[auth:getUserProfile]", err);
        res.status(500).json({ error: "failed to load user profile" });
    }
}

async function updateUserProfile(req, res) {
    try {
        const userId = req.user.sub;
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: "name is required" });
        }

        await pool.query("UPDATE users SET name = ? WHERE id = ?", [name.trim(), userId]);
        const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
        res.json({ success: true, message: "Profile updated successfully", user: sanitize(user) });
    } catch (err) {
        console.error("[auth:updateUserProfile]", err);
        res.status(500).json({ error: "failed to update profile" });
    }
}

async function changePassword(req, res) {
    try {
        const userId = req.user.sub;
        const { currentPassword, newPassword } = req.body;
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: "new password must be at least 8 characters" });
        }

        const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
        if (!user) return res.status(404).json({ error: "user not found" });

        if (user.password_hash) {
            if (!currentPassword) {
                return res.status(400).json({ error: "current password is required" });
            }
            const valid = await bcrypt.compare(currentPassword, user.password_hash);
            if (!valid) {
                return res.status(400).json({ error: "current password is incorrect" });
            }
        }

        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
        await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, userId]);
        res.json({ success: true, message: "Password updated successfully" });
    } catch (err) {
        console.error("[auth:changePassword]", err);
        res.status(500).json({ error: err.message || "failed to change password" });
    }
}

module.exports = {
    register,
    login,
    me,
    forgotPassword,
    resetPassword,
    getUserProfile,
    updateUserProfile,
    changePassword,
};
