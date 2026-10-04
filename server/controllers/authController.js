const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { pool } = require("../config/db");
const { isInstituteIp } = require("../services/instituteAccessService");
const { sendPasswordResetEmail } = require("../services/emailService");

const { OAuth2Client } = require("google-auth-library");
const axios = require("axios");

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "7d";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "379208993355-7rpn8k1g5bg4h5k3ie5crm4dmmu11ccf.apps.googleusercontent.com";
const googleOAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function signToken(user, sessionId) {
    const secret = process.env.JWT_SECRET || "bazaar_sync_jwt_secret_dev_key_2026";
    return jwt.sign(
        { sub: user.id, email: user.email, tier: user.tier, role: user.role, sid: sessionId },
        secret,
        { expiresIn: TOKEN_EXPIRY }
    );
}

function sanitize(user) {
    const { password_hash, current_session_id, ...safe } = user;
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

        const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email.trim().toLowerCase()]);
        if (existing.length) {
            return res.status(409).json({ error: "an account with this email already exists" });
        }

        const sessionId = crypto.randomUUID();
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const [result] = await pool.query(
            "INSERT INTO users (name, email, password_hash, tier, current_session_id, last_login_at, last_login_ip) VALUES (?, ?, ?, 'free', ?, NOW(), ?)",
            [name.trim(), email.trim().toLowerCase(), passwordHash, sessionId, req.ip]
        );

        const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [result.insertId]);
        const token = signToken(user, sessionId);
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

        const [[user]] = await pool.query("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
        if (!user || !user.password_hash) {
            return res.status(401).json({ error: "invalid email or password" });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: "invalid email or password" });
        }

        // Single-device security: generate a new unique session_id, invalidating any previous session
        const sessionId = crypto.randomUUID();
        await pool.query(
            "UPDATE users SET current_session_id = ?, last_login_at = NOW(), last_login_ip = ? WHERE id = ?",
            [sessionId, req.ip, user.id]
        );

        const token = signToken(user, sessionId);
        res.json({ token, user: sanitize(user), instituteAccess: await isInstituteIp(req.ip) });
    } catch (err) {
        console.error("[auth:login]", err);
        res.status(500).json({ error: "login failed" });
    }
}

/**
 * Sign in or Register with Google OAuth (ID Token or Access Token)
 */
async function googleAuth(req, res) {
    try {
        const { credential, accessToken } = req.body;
        if (!credential && !accessToken) {
            return res.status(400).json({ error: "Google credential token or accessToken is required." });
        }

        let googleUser = null;

        // Method 1: Verify Google ID Token (Google Identity Services)
        if (credential) {
            try {
                const ticket = await googleOAuthClient.verifyIdToken({
                    idToken: credential,
                    audience: GOOGLE_CLIENT_ID,
                });
                const payload = ticket.getPayload();
                if (payload && payload.email) {
                    googleUser = {
                        sub: payload.sub,
                        email: payload.email.toLowerCase(),
                        name: payload.name || payload.given_name || payload.email.split("@")[0],
                        picture: payload.picture || null,
                    };
                }
            } catch (vErr) {
                console.warn("[auth:googleAuth] ID Token verify fallback to tokeninfo:", vErr.message);
                // Fallback tokeninfo verification
                const { data } = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
                if (data && data.email) {
                    googleUser = {
                        sub: data.sub,
                        email: data.email.toLowerCase(),
                        name: data.name || data.email.split("@")[0],
                        picture: data.picture || null,
                    };
                }
            }
        }

        // Method 2: Verify Google Access Token
        if (!googleUser && accessToken) {
            const { data } = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (data && data.email) {
                googleUser = {
                    sub: data.sub,
                    email: data.email.toLowerCase(),
                    name: data.name || data.given_name || data.email.split("@")[0],
                    picture: data.picture || null,
                };
            }
        }

        if (!googleUser || !googleUser.email) {
            return res.status(401).json({ error: "Google authentication failed. Invalid token." });
        }

        // Check if user exists by email or google_id
        const [[existingUser]] = await pool.query(
            "SELECT * FROM users WHERE email = ? OR (google_id IS NOT NULL AND google_id = ?)",
            [googleUser.email, googleUser.sub]
        );

        const sessionId = crypto.randomUUID();
        let targetUser = null;

        if (existingUser) {
            // Update Google ID, avatar, and single-session tracking
            await pool.query(
                "UPDATE users SET google_id = COALESCE(google_id, ?), avatar_url = COALESCE(avatar_url, ?), current_session_id = ?, last_login_at = NOW(), last_login_ip = ? WHERE id = ?",
                [googleUser.sub, googleUser.picture, sessionId, req.ip, existingUser.id]
            );
            const [[refreshed]] = await pool.query("SELECT * FROM users WHERE id = ?", [existingUser.id]);
            targetUser = refreshed;
        } else {
            // Register new user via Google
            const [insertRes] = await pool.query(
                "INSERT INTO users (name, email, google_id, avatar_url, tier, role, current_session_id, last_login_at, last_login_ip) VALUES (?, ?, ?, ?, 'free', 'user', ?, NOW(), ?)",
                [googleUser.name, googleUser.email, googleUser.sub, googleUser.picture, sessionId, req.ip]
            );
            const [[newUser]] = await pool.query("SELECT * FROM users WHERE id = ?", [insertRes.insertId]);
            targetUser = newUser;
        }

        const token = signToken(targetUser, sessionId);
        res.json({
            token,
            user: sanitize(targetUser),
            instituteAccess: await isInstituteIp(req.ip),
        });
    } catch (err) {
        console.error("[auth:googleAuth]", err);
        res.status(500).json({ error: err.message || "Google authentication failed" });
    }
}

/**
 * Logout and invalidate current session
 */
async function logout(req, res) {
    try {
        if (req.user && req.user.sub) {
            await pool.query("UPDATE users SET current_session_id = NULL WHERE id = ?", [req.user.sub]);
        }
        res.json({ success: true, message: "Logged out successfully" });
    } catch (err) {
        console.error("[auth:logout]", err);
        res.status(500).json({ error: "Logout failed" });
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
        const {
            name,
            avatar_url,
            phone,
            address,
            city,
            state,
            pincode,
            country,
            trading_style,
            preferred_indices,
            trading_experience,
            capital_range,
            default_risk_pct,
            default_stoploss_pct,
            default_target_pct,
            primary_broker,
            default_timeframe,
        } = req.body;

        if (name !== undefined && !name.trim()) {
            return res.status(400).json({ error: "Name cannot be empty" });
        }

        await pool.query(
            `UPDATE users SET
                name = COALESCE(?, name),
                avatar_url = COALESCE(?, avatar_url),
                phone = COALESCE(?, phone),
                address = COALESCE(?, address),
                city = COALESCE(?, city),
                state = COALESCE(?, state),
                pincode = COALESCE(?, pincode),
                country = COALESCE(?, country),
                trading_style = COALESCE(?, trading_style),
                preferred_indices = COALESCE(?, preferred_indices),
                trading_experience = COALESCE(?, trading_experience),
                capital_range = COALESCE(?, capital_range),
                default_risk_pct = COALESCE(?, default_risk_pct),
                default_stoploss_pct = COALESCE(?, default_stoploss_pct),
                default_target_pct = COALESCE(?, default_target_pct),
                primary_broker = COALESCE(?, primary_broker),
                default_timeframe = COALESCE(?, default_timeframe)
             WHERE id = ?`,
            [
                name !== undefined ? name.trim() : null,
                avatar_url !== undefined ? avatar_url : null,
                phone !== undefined ? phone.trim() : null,
                address !== undefined ? address.trim() : null,
                city !== undefined ? city.trim() : null,
                state !== undefined ? state.trim() : null,
                pincode !== undefined ? pincode.trim() : null,
                country !== undefined ? country.trim() : null,
                trading_style !== undefined ? trading_style : null,
                preferred_indices !== undefined ? preferred_indices : null,
                trading_experience !== undefined ? trading_experience : null,
                capital_range !== undefined ? capital_range : null,
                default_risk_pct !== undefined && default_risk_pct !== "" ? Number(default_risk_pct) : null,
                default_stoploss_pct !== undefined && default_stoploss_pct !== "" ? Number(default_stoploss_pct) : null,
                default_target_pct !== undefined && default_target_pct !== "" ? Number(default_target_pct) : null,
                primary_broker !== undefined ? primary_broker : null,
                default_timeframe !== undefined ? default_timeframe : null,
                userId,
            ]
        );

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
    googleAuth,
    logout,
    me,
    forgotPassword,
    resetPassword,
    getUserProfile,
    updateUserProfile,
    changePassword,
};
