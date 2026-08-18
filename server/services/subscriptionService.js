// services/subscriptionService.js — purchasing/renewing the existing Pro
// tier (users.tier/pro_expires_at). Per Phase 8.2's decision, this is now
// the SAME ₹499/mo subscription as Paper Trade membership: buying/renewing
// Pro also grants paper capital (see paperWalletService), it's not a
// separate product.
const { pool } = require("../config/db");
const { PRO_DURATION_DAYS, PRO_PAPER_GRANT } = require("../config/paperTradeConfig");
const { getOrCreateWallet } = require("./paperWalletService");

const DAY_MS = 24 * 60 * 60 * 1000;

// `days` comes from the caller's resolved plan (see subscriptionController's
// verifyProPayment, which re-fetches the order from Razorpay to learn this
// safely) — falls back to the base PRO_DURATION_DAYS if omitted, so any
// existing caller that only ever bought the single 1-month plan keeps working
// unchanged. The paper-wallet grant (PRO_PAPER_GRANT) intentionally does NOT
// scale with `days` — a 12-month purchase grants the same one-time ₹5,00,000
// as a 1-month purchase, not 12x. A deliberate simplification for this pass,
// not an oversight — revisit if a per-plan grant scale is ever wanted.
async function purchasePro(userId, { razorpayOrderId, razorpayPaymentId, days }) {
    const durationDays = days || PRO_DURATION_DAYS;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[alreadyProcessed]] = await conn.query(
            "SELECT id FROM paper_wallet_ledger WHERE razorpay_payment_id = ?",
            [razorpayPaymentId]
        );
        if (alreadyProcessed) {
            await conn.rollback();
            const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
            return user;
        }

        const [[user]] = await conn.query("SELECT * FROM users WHERE id = ? FOR UPDATE", [userId]);
        if (!user) throw new Error("user not found");

        // Renewal extends remaining time rather than resetting it — plain
        // epoch-ms arithmetic on a DATETIME, not the local-calendar-date
        // class of bug Gotcha #12 warns about (that's about .getDate()/
        // .setDate() on DATE columns).
        const stillActive = user.pro_expires_at && new Date(user.pro_expires_at) > new Date();
        const base = stillActive ? new Date(user.pro_expires_at) : new Date();
        const newExpiry = new Date(base.getTime() + durationDays * DAY_MS);

        await conn.query("UPDATE users SET tier = 'pro', pro_expires_at = ? WHERE id = ?", [newExpiry, userId]);

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }

    // Wallet grant is a separate transaction (its own row lock) — keeping
    // the users-table transaction short avoids holding two row locks at once.
    await getOrCreateWallet(userId);
    const walletConn = await pool.getConnection();
    try {
        await walletConn.beginTransaction();
        await walletConn.query("SELECT * FROM paper_wallets WHERE user_id = ? FOR UPDATE", [userId]);
        await walletConn.query(
            "UPDATE paper_wallets SET balance = balance + ? WHERE user_id = ?",
            [PRO_PAPER_GRANT, userId]
        );
        const [[updatedWallet]] = await walletConn.query("SELECT * FROM paper_wallets WHERE user_id = ?", [userId]);
        await walletConn.query(
            `INSERT INTO paper_wallet_ledger (user_id, type, amount, balance_after, razorpay_order_id, razorpay_payment_id, note)
             VALUES (?, 'pro_purchase_grant', ?, ?, ?, ?, ?)`,
            [userId, PRO_PAPER_GRANT, updatedWallet.balance, razorpayOrderId, razorpayPaymentId, "Pro membership purchase/renewal"]
        );
        await walletConn.commit();
    } catch (err) {
        await walletConn.rollback();
        throw err;
    } finally {
        walletConn.release();
    }

    const [[user]] = await pool.query("SELECT * FROM users WHERE id = ?", [userId]);
    return user;
}

module.exports = { purchasePro };
