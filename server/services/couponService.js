// services/couponService.js — coupon codes against the existing PRO_PLANS
// catalog (paperTradeConfig.js), not a second pricing-plan system (user's
// explicit scope choice, 2026-08-20). subscriptionController.js validates a
// coupon at order-creation time (to compute the discounted Razorpay amount)
// and redeems it at verify time (after payment is confirmed) — never the
// other way around, so an abandoned checkout never consumes a redemption.
const { pool } = require("../config/db");

// Throws a user-facing error (err.status = 400) for any invalid/expired/
// exhausted/inactive code — the controller just needs to catch and surface
// err.message. Returns the discounted amount, never mutates state (that's
// redeemCoupon's job, only called after payment succeeds).
async function validateCoupon(code, amountPaise) {
    const [[coupon]] = await pool.query("SELECT * FROM coupons WHERE code = ?", [String(code).trim().toUpperCase()]);
    if (!coupon) {
        const err = new Error("invalid coupon code");
        err.status = 400;
        throw err;
    }
    if (!coupon.active) {
        const err = new Error("this coupon is no longer active");
        err.status = 400;
        throw err;
    }
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        const err = new Error("this coupon has expired");
        err.status = 400;
        throw err;
    }
    if (coupon.max_redemptions != null && coupon.redemption_count >= coupon.max_redemptions) {
        const err = new Error("this coupon has reached its redemption limit");
        err.status = 400;
        throw err;
    }

    const discountPaise = coupon.discount_type === "percent"
        ? Math.round(amountPaise * (Number(coupon.discount_value) / 100))
        : Math.round(Number(coupon.discount_value) * 100);
    const finalAmountPaise = Math.max(0, amountPaise - discountPaise);

    return { coupon, discountPaise: Math.min(discountPaise, amountPaise), finalAmountPaise };
}

// Called only after a payment is verified. Idempotent via the UNIQUE
// razorpay_payment_id on coupon_redemptions — a retried verify call for the
// same payment just no-ops on the duplicate key rather than double-counting.
async function redeemCoupon(couponId, userId, razorpayPaymentId, discountPaise) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        try {
            await conn.query(
                "INSERT INTO coupon_redemptions (coupon_id, user_id, razorpay_payment_id, discount_paise) VALUES (?, ?, ?, ?)",
                [couponId, userId, razorpayPaymentId, discountPaise]
            );
            await conn.query("UPDATE coupons SET redemption_count = redemption_count + 1 WHERE id = ?", [couponId]);
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            if (err.code !== "ER_DUP_ENTRY") throw err;
        }
    } finally {
        conn.release();
    }
}

// Convenience wrapper for verifyProPayment, which only has the code (from
// the order's notes) at hand, not the coupon id.
async function redeemCouponByCode(code, userId, razorpayPaymentId, discountPaise) {
    const [[coupon]] = await pool.query("SELECT id FROM coupons WHERE code = ?", [code]);
    if (!coupon) return;
    await redeemCoupon(coupon.id, userId, razorpayPaymentId, discountPaise);
}

module.exports = { validateCoupon, redeemCoupon, redeemCouponByCode };
