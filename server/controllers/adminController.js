// controllers/adminController.js — admin panel: read-only user list +
// per-user detail (Phase 9), plus site-wide Overview/Payments/Positions/
// Strategies views (Phase 10, for the separate admin app). No write actions
// yet anywhere (no ban/edit/role-change/refund endpoints) — this is the
// "see everything" slice; management actions come in later admin-panel passes.
const { pool } = require("../config/db");
const { getRecentLedger, getOrCreateWallet } = require("../services/paperWalletService");
const { listOpenPositions, listClosedPositions, getLiveContractPrice, getLeaderboard } = require("../services/paperPositionService");
const { PRO_PRICE_PAISE, REFILL_PRICE_PAISE } = require("../config/paperTradeConfig");
const lotSizeHistoryService = require("../services/lotSizeHistoryService");
const proPlanService = require("../services/proPlanService");
const socketBroadcast = require("../services/socketBroadcast");

async function listUsers(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT u.id, u.name, u.email, u.tier, u.pro_expires_at, u.role, u.created_at,
                    pw.balance AS paper_balance
             FROM users u
             LEFT JOIN paper_wallets pw ON pw.user_id = u.id
             ORDER BY u.created_at DESC LIMIT 500`
        );
        res.json({ users: rows });
    } catch (err) {
        console.error("[admin:listUsers]", err);
        res.status(500).json({ error: "failed to load users" });
    }
}

async function getUserDetail(req, res) {
    try {
        const userId = req.params.id;
        const [[user]] = await pool.query(
            "SELECT id, name, email, tier, pro_expires_at, role, created_at FROM users WHERE id = ?",
            [userId]
        );
        if (!user) return res.status(404).json({ error: "user not found" });

        const [strategies] = await pool.query(
            "SELECT id, name, underlying, created_at FROM strategies WHERE user_id = ? ORDER BY created_at DESC",
            [userId]
        );

        // Deliberately a plain SELECT, not paperWalletService.getWalletStatus —
        // that function lazily CREATES a wallet (+ grants the trial balance)
        // on first touch, which is correct for a user's own dashboard but
        // would be a real side effect here: an admin merely viewing a
        // profile should never grant that user a trial. A user who's never
        // touched Paper Trade just shows wallet: null.
        const [[wallet]] = await pool.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
        const ledger = wallet ? await getRecentLedger(userId, 30) : [];
        // Every Pro purchase/renewal grants paper capital as a
        // 'pro_purchase_grant' ledger row (see paperWalletService.js) — the
        // closest thing to a subscription-renewal history that exists today.
        const renewals = ledger.filter((l) => l.type === "pro_purchase_grant");

        const [openPositions, closedPositions] = await Promise.all([
            listOpenPositions(userId),
            listClosedPositions(userId, 30),
        ]);

        res.json({
            user,
            strategies,
            wallet: wallet ? { balance: Number(wallet.balance), trialExpiresAt: wallet.trial_expires_at } : null,
            ledger,
            renewals,
            positions: { open: openPositions, closed: closedPositions },
        });
    } catch (err) {
        console.error("[admin:getUserDetail]", err);
        res.status(500).json({ error: "failed to load user detail" });
    }
}

async function addUserBalance(req, res) {
    try {
        const userId = req.params.id;
        const { amount, note } = req.body || {};
        const parsedAmount = Number(amount);
        if (isNaN(parsedAmount) || parsedAmount === 0) {
            return res.status(400).json({ error: "A valid non-zero amount is required" });
        }

        const [[user]] = await pool.query("SELECT id, name, email FROM users WHERE id = ?", [userId]);
        if (!user) return res.status(404).json({ error: "User not found" });

        // Ensure wallet exists before mutating
        await getOrCreateWallet(userId);

        const ledgerType = parsedAmount >= 0 ? "admin_credit" : "admin_debit";
        const ledgerNote = (note && String(note).trim()) || (parsedAmount >= 0 ? "Admin balance credit" : "Admin balance adjustment");

        const conn = await pool.getConnection();
        let updatedWallet;
        try {
            await conn.beginTransaction();
            await conn.query("SELECT * FROM paper_wallets WHERE user_id = ? FOR UPDATE", [userId]);
            await conn.query("UPDATE paper_wallets SET balance = balance + ? WHERE user_id = ?", [parsedAmount, userId]);
            const [[updated]] = await conn.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
            updatedWallet = updated;

            await conn.query(
                `INSERT INTO paper_wallet_ledger (user_id, type, amount, balance_after, note)
                 VALUES (?, ?, ?, ?, ?)`,
                [userId, ledgerType, parsedAmount, updated.balance, ledgerNote]
            );
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        const ledger = await getRecentLedger(userId, 30);

        socketBroadcast.emitPaperEvent("paper:wallet_updated", {
            userId: Number(userId),
            balance: Number(updatedWallet.balance),
            amount: parsedAmount,
            note: ledgerNote,
            timestamp: new Date().toISOString(),
        });

        res.json({
            success: true,
            message: `Successfully ${parsedAmount >= 0 ? "added" : "deducted"} ₹${Math.abs(parsedAmount).toLocaleString("en-IN")} balance`,
            wallet: {
                balance: Number(updatedWallet.balance),
                trialExpiresAt: updatedWallet.trial_expires_at,
            },
            ledger,
        });
    } catch (err) {
        console.error("[admin:addUserBalance]", err);
        res.status(500).json({ error: "Failed to update user wallet balance" });
    }
}

async function updateUserPlan(req, res) {
    try {
        const userId = req.params.id;
        const { tier, proExpiresAt, daysToAdd, trialExpiresAt, trialDaysToAdd } = req.body || {};

        const [[user]] = await pool.query("SELECT id, name, email, tier, pro_expires_at FROM users WHERE id = ?", [userId]);
        if (!user) return res.status(404).json({ error: "User not found" });

        let newTier = user.tier;
        let newProExpiresAt = user.pro_expires_at;

        if (tier && ["free", "pro"].includes(tier)) {
            newTier = tier;
        }

        // If daysToAdd is specified, calculate extension
        if (daysToAdd !== undefined && daysToAdd !== null && !isNaN(Number(daysToAdd))) {
            const days = Number(daysToAdd);
            const now = new Date();
            const currentExpiry = user.pro_expires_at ? new Date(user.pro_expires_at) : null;
            const baseDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
            newProExpiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
            newTier = "pro"; // Extending pro plan promotes/retains pro tier
        } else if (proExpiresAt !== undefined) {
            if (proExpiresAt === null || proExpiresAt === "") {
                newProExpiresAt = null;
            } else {
                const parsed = new Date(proExpiresAt);
                if (isNaN(parsed.getTime())) {
                    return res.status(400).json({ error: "Invalid pro_expires_at date" });
                }
                newProExpiresAt = parsed;
                newTier = "pro";
            }
        }

        // If downgrading to free without explicit expiry date, clear pro_expires_at
        if (newTier === "free" && proExpiresAt === undefined && daysToAdd === undefined) {
            newProExpiresAt = null;
        }

        await pool.query(
            "UPDATE users SET tier = ?, pro_expires_at = ? WHERE id = ?",
            [newTier, newProExpiresAt, userId]
        );

        // If trial extension was also requested
        let updatedWallet = null;
        if (trialDaysToAdd !== undefined || trialExpiresAt !== undefined) {
            const [[wallet]] = await pool.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
            if (wallet) {
                let newTrialExpiry = wallet.trial_expires_at;
                if (trialDaysToAdd !== undefined && !isNaN(Number(trialDaysToAdd))) {
                    const now = new Date();
                    const currentTrial = wallet.trial_expires_at ? new Date(wallet.trial_expires_at) : null;
                    const baseTrial = currentTrial && currentTrial > now ? currentTrial : now;
                    newTrialExpiry = new Date(baseTrial.getTime() + Number(trialDaysToAdd) * 24 * 60 * 60 * 1000);
                } else if (trialExpiresAt !== undefined) {
                    newTrialExpiry = trialExpiresAt ? new Date(trialExpiresAt) : null;
                }
                await pool.query("UPDATE paper_wallets SET trial_expires_at = ? WHERE user_id = ?", [newTrialExpiry, userId]);
                const [[w]] = await pool.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
                updatedWallet = w ? { balance: Number(w.balance), trialExpiresAt: w.trial_expires_at } : null;
            }
        }

        const [[updatedUser]] = await pool.query(
            "SELECT id, name, email, tier, pro_expires_at, role, created_at FROM users WHERE id = ?",
            [userId]
        );

        socketBroadcast.emitPaperEvent("paper:wallet_updated", {
            userId: Number(userId),
            tier: newTier,
            proExpiresAt: newProExpiresAt,
            wallet: updatedWallet,
            timestamp: new Date().toISOString(),
        });

        res.json({
            success: true,
            message: "User plan updated successfully",
            user: updatedUser,
            wallet: updatedWallet,
        });
    } catch (err) {
        console.error("[admin:updateUserPlan]", err);
        res.status(500).json({ error: "Failed to update user plan" });
    }
}


// Site-wide aggregate stats for the admin app's Overview page. Every number
// here is a real COUNT/SUM from the DB — the one exception is "revenue",
// which is inferred as (purchase count × current price from
// paperTradeConfig.js), NOT a real sum of amounts actually charged (no
// column anywhere stores the real paisa amount Razorpay charged per
// purchase — paper_wallet_ledger.amount is paper-capital granted, not real
// money). Labelled as an estimate in the response, same honesty convention
// as the Sharpe ratio / POP / margin approximations elsewhere in this app —
// see paperTradeConfig.js comment and CLAUDE.md.
async function getOverview(req, res) {
    try {
        const [[userCounts]] = await pool.query(
            `SELECT COUNT(*) AS total,
                    SUM(tier = 'pro' AND (pro_expires_at IS NULL OR pro_expires_at > NOW())) AS proActive,
                    SUM(role = 'admin') AS admins
             FROM users`
        );
        const [[walletTotals]] = await pool.query("SELECT COALESCE(SUM(balance), 0) AS totalBalance, COUNT(*) AS walletCount FROM paper_wallets");
        const [[strategyCount]] = await pool.query("SELECT COUNT(*) AS total FROM strategies");
        const [[positionCounts]] = await pool.query(
            "SELECT SUM(status = 'open') AS open, SUM(status = 'closed') AS closed FROM paper_positions"
        );
        const [[purchaseCounts]] = await pool.query(
            `SELECT SUM(type = 'pro_purchase_grant') AS proPurchases, SUM(type = 'refill_purchase') AS refillPurchases
             FROM paper_wallet_ledger`
        );
        const [signupsByDay] = await pool.query(
            `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM users
             WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             GROUP BY DATE(created_at) ORDER BY day ASC`
        );

        const proPurchases = Number(purchaseCounts.proPurchases) || 0;
        const refillPurchases = Number(purchaseCounts.refillPurchases) || 0;

        res.json({
            users: { total: Number(userCounts.total), proActive: Number(userCounts.proActive) || 0, admins: Number(userCounts.admins) || 0 },
            paperWallets: { totalBalance: Number(walletTotals.totalBalance), walletCount: Number(walletTotals.walletCount) },
            strategies: { total: Number(strategyCount.total) },
            positions: { open: Number(positionCounts.open) || 0, closed: Number(positionCounts.closed) || 0 },
            revenueEstimate: {
                proPurchases,
                refillPurchases,
                totalPaise: proPurchases * PRO_PRICE_PAISE + refillPurchases * REFILL_PRICE_PAISE,
                note: "estimated from purchase counts × current pricing, not a real sum of amounts charged",
            },
            signupsByDay: signupsByDay.map((r) => ({ day: String(r.day).slice(0, 10), count: Number(r.count) })),
        });
    } catch (err) {
        console.error("[admin:getOverview]", err);
        res.status(500).json({ error: "failed to load overview" });
    }
}

// All Pro-purchase/refill ledger rows across every user, newest first —
// the "Subscriptions & Payments" section. Joins in email/name since the
// ledger table only has user_id.
async function listPayments(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT l.id, l.type, l.amount, l.razorpay_order_id, l.razorpay_payment_id, l.note, l.created_at,
                    u.id AS user_id, u.name AS user_name, u.email AS user_email
             FROM paper_wallet_ledger l
             JOIN users u ON u.id = l.user_id
             WHERE l.type IN ('pro_purchase_grant', 'refill_purchase')
             ORDER BY l.created_at DESC LIMIT 200`
        );
        res.json({ payments: rows });
    } catch (err) {
        console.error("[admin:listPayments]", err);
        res.status(500).json({ error: "failed to load payments" });
    }
}

// Every open position across every user (mark-to-market, same "gap not a
// guess" convention as paperPositionService.listOpenPositions) plus the
// most recent closed ones — the "Paper Trade oversight" section.
async function listAllPositions(req, res) {
    try {
        const filterUserId = req.query.userId ? Number(req.query.userId) : null;
        let openSql = `SELECT p.*, u.name AS user_name, u.email AS user_email, u.avatar_url FROM paper_positions p
                       JOIN users u ON u.id = p.user_id WHERE p.status = 'open'`;
        const openParams = [];
        if (filterUserId) {
            openSql += ` AND p.user_id = ?`;
            openParams.push(filterUserId);
        }
        openSql += ` ORDER BY p.entry_time DESC`;

        const [openRows] = await pool.query(openSql, openParams);
        const open = [];
        for (const p of openRows) {
            let livePrice = null;
            let unrealizedPnl = null;
            try {
                const priceData = await getLiveContractPrice(p.symbol, p.expiry, p.opt_right, p.strike);
                livePrice = priceData.ltp;
                const entry = Number(p.entry_price);
                unrealizedPnl = p.side === "long"
                    ? (livePrice - entry) * p.lots * p.lot_size
                    : (entry - livePrice) * p.lots * p.lot_size;
            } catch {
                // leave null — market closed or contract not in cache
            }
            open.push({ ...p, livePrice, unrealizedPnl });
        }

        let closedSql = `SELECT p.*, u.name AS user_name, u.email AS user_email, u.avatar_url FROM paper_positions p
                         JOIN users u ON u.id = p.user_id WHERE p.status = 'closed'`;
        const closedParams = [];
        if (filterUserId) {
            closedSql += ` AND p.user_id = ?`;
            closedParams.push(filterUserId);
        }
        closedSql += ` ORDER BY p.exit_time DESC LIMIT 500`;

        const [closed] = await pool.query(closedSql, closedParams);

        // Fetch Leaderboard
        const leaderboardData = await getLeaderboard();

        // Compute User Summaries
        const [userSummaries] = await pool.query(`
            SELECT 
                u.id AS user_id,
                u.name AS user_name,
                u.email AS user_email,
                u.avatar_url,
                u.trading_style,
                COALESCE(w.balance, 500000) AS balance,
                COUNT(CASE WHEN p.status = 'open' THEN 1 END) AS open_count,
                COUNT(CASE WHEN p.status = 'closed' THEN 1 END) AS closed_count,
                COALESCE(SUM(CASE WHEN p.status = 'closed' THEN p.realized_pnl ELSE 0 END), 0) AS total_realized_pnl,
                MAX(p.entry_time) AS last_trade_time
            FROM users u
            LEFT JOIN paper_wallets w ON w.user_id = u.id
            JOIN paper_positions p ON p.user_id = u.id
            GROUP BY u.id, u.name, u.email, u.avatar_url, u.trading_style, w.balance
            ORDER BY open_count DESC, total_realized_pnl DESC
        `);

        res.json({
            positions: { open, closed },
            leaderboard: leaderboardData.leaderboard,
            userSummaries,
        });
    } catch (err) {
        console.error("[admin:listAllPositions]", err);
        res.status(500).json({ error: "failed to load positions" });
    }
}

// Every saved strategy across every user — the "Strategies oversight" section.
async function listAllStrategies(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT s.id, s.name, s.underlying, s.legs, s.created_at,
                    u.id AS user_id, u.name AS user_name, u.email AS user_email
             FROM strategies s
             JOIN users u ON u.id = s.user_id
             ORDER BY s.created_at DESC LIMIT 200`
        );
        res.json({ strategies: rows });
    } catch (err) {
        console.error("[admin:listAllStrategies]", err);
        res.status(500).json({ error: "failed to load strategies" });
    }
}

// --- Institute Access (IP allowlist) ---

async function listInstituteIps(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT a.id, a.ip_or_cidr, a.label, a.created_at, u.name AS created_by_name
             FROM institute_ip_allowlist a LEFT JOIN users u ON u.id = a.created_by
             ORDER BY a.created_at DESC`
        );
        res.json({ entries: rows });
    } catch (err) {
        console.error("[admin:listInstituteIps]", err);
        res.status(500).json({ error: "failed to load institute IP allowlist" });
    }
}

// Validates the entry shape server-side (not just relying on the DB's plain
// VARCHAR column) since a malformed value would silently never match any
// real request IP in instituteAccessService.js — better to reject it here.
const IP_OR_CIDR_RE = /^((\d{1,3}\.){3}\d{1,3})(\/(\d|[1-2]\d|3[0-2]))?$|^[0-9a-fA-F:]+$/;

async function addInstituteIp(req, res) {
    try {
        const { ipOrCidr, label } = req.body || {};
        if (!ipOrCidr || !IP_OR_CIDR_RE.test(ipOrCidr.trim())) {
            return res.status(400).json({ error: "enter a valid IPv4 address, IPv4 CIDR range, or IPv6 address" });
        }
        const [result] = await pool.query(
            "INSERT INTO institute_ip_allowlist (ip_or_cidr, label, created_by) VALUES (?, ?, ?)",
            [ipOrCidr.trim(), label || null, req.user.sub]
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "this IP/range is already allowlisted" });
        console.error("[admin:addInstituteIp]", err);
        res.status(500).json({ error: "failed to add entry" });
    }
}

async function removeInstituteIp(req, res) {
    try {
        await pool.query("DELETE FROM institute_ip_allowlist WHERE id = ?", [req.params.id]);
        res.status(204).end();
    } catch (err) {
        console.error("[admin:removeInstituteIp]", err);
        res.status(500).json({ error: "failed to remove entry" });
    }
}

// --- Lot Size History (see lotSizeHistoryService.js's header comment for
// why this is admin-entered rather than auto-populated: NSE revises F&O lot
// sizes periodically and none of our historical data sources record it) ---

async function listLotSizeHistoryAdmin(req, res) {
    try {
        const entries = await lotSizeHistoryService.listLotSizeHistory(req.query.symbol);
        res.json({ entries });
    } catch (err) {
        console.error("[admin:listLotSizeHistory]", err);
        res.status(500).json({ error: "failed to load lot size history" });
    }
}

async function addLotSizeHistoryEntry(req, res) {
    try {
        const { symbol, lotSize, effectiveFrom, effectiveTo } = req.body || {};
        const id = await lotSizeHistoryService.addLotSizeEntry({
            symbol,
            lotSize: Number(lotSize),
            effectiveFrom,
            effectiveTo,
            userId: req.user.sub,
        });
        res.status(201).json({ id });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || "failed to add entry" });
    }
}

async function removeLotSizeHistoryEntry(req, res) {
    try {
        await lotSizeHistoryService.deleteLotSizeEntry(req.params.id);
        res.status(204).end();
    } catch (err) {
        console.error("[admin:removeLotSizeHistoryEntry]", err);
        res.status(500).json({ error: "failed to remove entry" });
    }
}

async function bulkImportLotSizeHistory(req, res) {
    try {
        const { rows } = req.body || {};
        const inserted = await lotSizeHistoryService.bulkAddLotSizeEntries(rows, req.user.sub);
        res.status(201).json({ inserted });
    } catch (err) {
        if (err.rowErrors) {
            return res.status(err.status || 400).json({ error: err.message, rowErrors: err.rowErrors });
        }
        console.error("[admin:bulkImportLotSizeHistory]", err);
        res.status(err.status || 500).json({ error: err.message || "failed to import" });
    }
}

// --- Plans & Coupons ---
// Plans (name/duration/price/badge) moved from a fixed in-code constant to
// this admin-managed catalog on 2026-09-13 — see proPlanService.js and
// schema.sql's pro_plans table header for the `id`-stability requirement.

async function listPlansAdmin(req, res) {
    try {
        const plans = await proPlanService.listAllPlansAdmin();
        res.json({ plans });
    } catch (err) {
        console.error("[admin:listPlans]", err);
        res.status(500).json({ error: "failed to load plans" });
    }
}

async function createPlanAdmin(req, res) {
    try {
        const id = await proPlanService.createPlan(req.body || {});
        res.status(201).json({ id });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || "failed to create plan" });
    }
}

async function updatePlanAdmin(req, res) {
    try {
        await proPlanService.updatePlan(req.params.id, req.body || {});
        res.status(204).end();
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || "failed to update plan" });
    }
}

async function setPlanActiveAdmin(req, res) {
    try {
        await proPlanService.setPlanActive(req.params.id, !!req.body?.active);
        res.status(204).end();
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message || "failed to update plan" });
    }
}

async function deletePlanAdmin(req, res) {
    try {
        await proPlanService.deletePlan(req.params.id);
        res.status(204).end();
    } catch (err) {
        console.error("[admin:deletePlan]", err);
        res.status(500).json({ error: "failed to delete plan" });
    }
}

async function listCoupons(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT c.*, u.name AS created_by_name FROM coupons c
             LEFT JOIN users u ON u.id = c.created_by ORDER BY c.created_at DESC`
        );
        res.json({ coupons: rows });
    } catch (err) {
        console.error("[admin:listCoupons]", err);
        res.status(500).json({ error: "failed to load coupons" });
    }
}

async function createCoupon(req, res) {
    try {
        const { code, discountType, discountValue, maxRedemptions, expiresAt } = req.body || {};
        if (!code || !["percent", "flat"].includes(discountType) || !(Number(discountValue) > 0)) {
            return res.status(400).json({ error: "code, discountType (percent/flat) and a positive discountValue are required" });
        }
        if (discountType === "percent" && Number(discountValue) > 100) {
            return res.status(400).json({ error: "a percent discount can't exceed 100" });
        }
        const [result] = await pool.query(
            `INSERT INTO coupons (code, discount_type, discount_value, max_redemptions, expires_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [code.trim().toUpperCase(), discountType, discountValue, maxRedemptions || null, expiresAt || null, req.user.sub]
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "a coupon with this code already exists" });
        console.error("[admin:createCoupon]", err);
        res.status(500).json({ error: "failed to create coupon" });
    }
}

// Only `active` is mutable after creation — changing discount terms on a
// code that may already be in a customer's hands would be confusing; make a
// new code instead.
async function setCouponActive(req, res) {
    try {
        await pool.query("UPDATE coupons SET active = ? WHERE id = ?", [!!req.body?.active, req.params.id]);
        res.status(204).end();
    } catch (err) {
        console.error("[admin:setCouponActive]", err);
        res.status(500).json({ error: "failed to update coupon" });
    }
}

async function deleteCoupon(req, res) {
    try {
        await pool.query("DELETE FROM coupons WHERE id = ?", [req.params.id]);
        res.status(204).end();
    } catch (err) {
        console.error("[admin:deleteCoupon]", err);
        res.status(500).json({ error: "failed to delete coupon" });
    }
}

module.exports = {
    listUsers, getUserDetail, getOverview, listPayments, listAllPositions, listAllStrategies,
    listInstituteIps, addInstituteIp, removeInstituteIp,
    listPlansAdmin, createPlanAdmin, updatePlanAdmin, setPlanActiveAdmin, deletePlanAdmin,
    listCoupons, createCoupon, setCouponActive, deleteCoupon,
    listLotSizeHistoryAdmin, addLotSizeHistoryEntry, bulkImportLotSizeHistory, removeLotSizeHistoryEntry,
    addUserBalance, updateUserPlan,
};
