// services/paperWalletService.js — Paper Trade wallet: trial grant, balance,
// and ledger. Pro-ness itself is NOT tracked here — it's the same
// users.tier/pro_expires_at subscription strategiesController.js /
// requirePro.js already use; see subscriptionService.js for purchasing it.
// See CLAUDE.md Phase 8.2 for the full picture (why there's no
// membership_expires_at here, why balance is never reset, etc). Phase 8.3
// added debit()/credit() for the trading engine (paperPositionService.js).
const { pool } = require("../config/db");
const { TRIAL_DURATION_DAYS, TRIAL_BALANCE, REFILL_GRANT } = require("../config/paperTradeConfig");

// Ensures a wallet row exists, granting the one-time trial balance on first
// touch. user_id is the PRIMARY KEY, so a concurrent double-call simply
// fails the INSERT on the duplicate key and falls through to the re-select
// — no explicit locking needed for this path.
async function getOrCreateWallet(userId) {
    const [[existing]] = await pool.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
    if (existing) return existing;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        try {
            await conn.query(
                `INSERT INTO paper_wallets (user_id, balance, trial_started_at, trial_expires_at)
                 VALUES (?, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
                [userId, TRIAL_BALANCE, TRIAL_DURATION_DAYS]
            );
            await conn.query(
                `INSERT INTO paper_wallet_ledger (user_id, type, amount, balance_after, note)
                 VALUES (?, 'trial_grant', ?, ?, ?)`,
                [userId, TRIAL_BALANCE, TRIAL_BALANCE, `${TRIAL_DURATION_DAYS}-day trial`]
            );
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            // Duplicate key = another request created it concurrently; that's fine.
            if (err.code !== "ER_DUP_ENTRY") throw err;
        }
    } finally {
        conn.release();
    }

    const [[wallet]] = await pool.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
    return wallet;
}

function isProActive(user) {
    return user.tier === "pro" && (!user.pro_expires_at || new Date(user.pro_expires_at) > new Date());
}

// user: the row already fetched by the caller (requireAuth/requirePro-style
// callers already have it) — avoids a second users query here.
async function getWalletStatus(userId, user) {
    const wallet = await getOrCreateWallet(userId);
    const trialActive = wallet.trial_expires_at ? new Date(wallet.trial_expires_at) > new Date() : false;
    const isPro = isProActive(user);

    return {
        balance: Number(wallet.balance),
        trialActive,
        trialExpiresAt: wallet.trial_expires_at,
        isPro,
        proExpiresAt: user.pro_expires_at,
        accessAllowed: trialActive || isPro,
    };
}

async function getRecentLedger(userId, limit = 20) {
    const [rows] = await pool.query(
        "SELECT type, amount, balance_after, note, created_at FROM paper_wallet_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        [userId, limit]
    );
    return rows;
}

// Refills are Pro-only (enforced by requirePro at the route level); this
// just does the crediting once a payment is verified.
async function creditRefill(userId, { razorpayOrderId, razorpayPaymentId }) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[alreadyProcessed]] = await conn.query(
            "SELECT id FROM paper_wallet_ledger WHERE razorpay_payment_id = ?",
            [razorpayPaymentId]
        );
        if (alreadyProcessed) {
            await conn.rollback();
            const [[wallet]] = await pool.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
            return wallet;
        }

        await conn.query("SELECT * FROM paper_wallets WHERE user_id = ? FOR UPDATE", [userId]);
        await conn.query(
            "UPDATE paper_wallets SET balance = balance + ? WHERE user_id = ?",
            [REFILL_GRANT, userId]
        );
        const [[updated]] = await conn.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
        await conn.query(
            `INSERT INTO paper_wallet_ledger (user_id, type, amount, balance_after, razorpay_order_id, razorpay_payment_id, note)
             VALUES (?, 'refill_purchase', ?, ?, ?, ?, ?)`,
            [userId, REFILL_GRANT, updated.balance, razorpayOrderId, razorpayPaymentId, "₹100 paper capital refill"]
        );

        await conn.commit();
        return updated;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// debit/credit both take an already-open, already-in-transaction `conn`
// (from pool.getConnection() + beginTransaction()) rather than managing
// their own — callers (paperPositionService) need the wallet mutation and
// the position insert/update to commit or roll back together atomically.
async function debit(conn, userId, amount, note) {
    const [[wallet]] = await conn.query("SELECT * FROM paper_wallets WHERE user_id = ? FOR UPDATE", [userId]);
    if (!wallet || Number(wallet.balance) < amount) {
        const err = new Error("insufficient paper balance");
        err.status = 400;
        throw err;
    }
    await conn.query("UPDATE paper_wallets SET balance = balance - ? WHERE user_id = ?", [amount, userId]);
    const [[updated]] = await conn.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
    await conn.query(
        `INSERT INTO paper_wallet_ledger (user_id, type, amount, balance_after, note)
         VALUES (?, 'trade_debit', ?, ?, ?)`,
        [userId, -amount, updated.balance, note]
    );
    return updated;
}

// Same as debit() but WITHOUT the insufficient-balance check — balance is
// allowed to go negative. Phase 8.4: used ONLY to buy back a short
// position to close it. Closing an existing position must never be
// blocked by balance (that would trap a user in a losing short with no
// way out); opening a NEW position, long or short, always goes through
// the balance-checked debit() instead.
async function forceDebit(conn, userId, amount, note) {
    await conn.query("SELECT * FROM paper_wallets WHERE user_id = ? FOR UPDATE", [userId]);
    await conn.query("UPDATE paper_wallets SET balance = balance - ? WHERE user_id = ?", [amount, userId]);
    const [[updated]] = await conn.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
    await conn.query(
        `INSERT INTO paper_wallet_ledger (user_id, type, amount, balance_after, note)
         VALUES (?, 'trade_debit', ?, ?, ?)`,
        [userId, -amount, updated.balance, note]
    );
    return updated;
}

async function credit(conn, userId, amount, note) {
    await conn.query("SELECT * FROM paper_wallets WHERE user_id = ? FOR UPDATE", [userId]);
    await conn.query("UPDATE paper_wallets SET balance = balance + ? WHERE user_id = ?", [amount, userId]);
    const [[updated]] = await conn.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
    await conn.query(
        `INSERT INTO paper_wallet_ledger (user_id, type, amount, balance_after, note)
         VALUES (?, 'trade_credit', ?, ?, ?)`,
        [userId, amount, updated.balance, note]
    );
    return updated;
}

module.exports = { getOrCreateWallet, getWalletStatus, getRecentLedger, creditRefill, isProActive, debit, credit, forceDebit };
