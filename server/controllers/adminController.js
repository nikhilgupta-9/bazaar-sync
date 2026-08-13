// controllers/adminController.js — admin panel: read-only user list +
// per-user detail (Phase 9), plus site-wide Overview/Payments/Positions/
// Strategies views (Phase 10, for the separate admin app). No write actions
// yet anywhere (no ban/edit/role-change/refund endpoints) — this is the
// "see everything" slice; management actions come in later admin-panel passes.
const { pool } = require("../config/db");
const { getRecentLedger } = require("../services/paperWalletService");
const { listOpenPositions, listClosedPositions, getLiveContractPrice } = require("../services/paperPositionService");
const { PRO_PRICE_PAISE, REFILL_PRICE_PAISE } = require("../config/paperTradeConfig");

async function listUsers(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT id, name, email, tier, pro_expires_at, role, created_at
             FROM users ORDER BY created_at DESC LIMIT 500`
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
        const [openRows] = await pool.query(
            `SELECT p.*, u.name AS user_name, u.email AS user_email FROM paper_positions p
             JOIN users u ON u.id = p.user_id
             WHERE p.status = 'open' ORDER BY p.entry_time DESC`
        );
        const open = openRows.map((p) => {
            let livePrice = null;
            let unrealizedPnl = null;
            try {
                livePrice = getLiveContractPrice(p.symbol, p.expiry, p.opt_right, p.strike).ltp;
                unrealizedPnl = p.side === "long"
                    ? (livePrice - Number(p.entry_price)) * p.lots * p.lot_size
                    : (Number(p.entry_price) - livePrice) * p.lots * p.lot_size;
            } catch {
                // leave null — expiry aged out of the live window, see paperPositionService.js
            }
            return { ...p, livePrice, unrealizedPnl };
        });

        const [closed] = await pool.query(
            `SELECT p.*, u.name AS user_name, u.email AS user_email FROM paper_positions p
             JOIN users u ON u.id = p.user_id
             WHERE p.status = 'closed' ORDER BY p.exit_time DESC LIMIT 200`
        );

        res.json({ positions: { open, closed } });
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

module.exports = { listUsers, getUserDetail, getOverview, listPayments, listAllPositions, listAllStrategies };
