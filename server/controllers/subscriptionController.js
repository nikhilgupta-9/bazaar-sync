const razorpayService = require("../services/razorpayService");
const subscriptionService = require("../services/subscriptionService");
const couponService = require("../services/couponService");
const { PRO_PLANS } = require("../config/paperTradeConfig");

function findPlan(planId) {
    return PRO_PLANS.find((p) => p.id === planId);
}

// Public — the Pricing page needs to show real prices without requiring
// login just to view them.
function listPlans(req, res) {
    res.json({ plans: PRO_PLANS });
}

async function createProOrder(req, res) {
    try {
        const planId = req.body?.planId || "1m";
        const plan = findPlan(planId);
        if (!plan) return res.status(400).json({ error: "invalid plan" });

        let amountPaise = plan.priceInPaise;
        let couponCode = null;
        if (req.body?.couponCode) {
            try {
                const result = await couponService.validateCoupon(req.body.couponCode, plan.priceInPaise);
                amountPaise = result.finalAmountPaise;
                couponCode = result.coupon.code;
            } catch (err) {
                return res.status(err.status || 400).json({ error: err.message });
            }
        }

        const order = await razorpayService.createOrder({
            amountPaise,
            receipt: `pro_${req.user.sub}_${Date.now()}`,
            // Stashed server-side now so verifyProPayment can learn the plan
            // (and which coupon, if any, was actually applied) back from
            // Razorpay itself later, never from client input.
            notes: { planId: plan.id, userId: String(req.user.sub), couponCode: couponCode || "" },
        });
        res.json(order);
    } catch (err) {
        console.error("[subscription:createProOrder]", err);
        res.status(500).json({ error: "failed to create order" });
    }
}

async function verifyProPayment(req, res) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required" });
        }

        const valid = razorpayService.verifySignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });
        if (!valid) return res.status(400).json({ error: "payment verification failed" });

        // Re-fetch the order from Razorpay to learn which plan was actually
        // paid for — the notes we set at createProOrder time are the only
        // trustworthy source, never a client-supplied plan id at this step.
        // Falls back to the base 1-month plan for any order that predates
        // this (no notes.planId).
        const order = await razorpayService.fetchOrder(razorpay_order_id);
        const plan = findPlan(order.notes?.planId) || PRO_PLANS[0];

        const user = await subscriptionService.purchasePro(req.user.sub, {
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            days: plan.days,
        });

        // Redeem the coupon only now that payment is actually confirmed —
        // never at order-creation time, so an abandoned checkout never
        // consumes a redemption. order.amount is what was actually charged
        // (the discounted amount); the discount itself is plan.priceInPaise
        // minus that.
        if (order.notes?.couponCode) {
            try {
                const discountPaise = Math.max(0, plan.priceInPaise - Number(order.amount));
                await couponService.redeemCouponByCode(order.notes.couponCode, req.user.sub, razorpay_payment_id, discountPaise);
            } catch (err) {
                // Payment already succeeded and Pro is already granted — a
                // redemption-bookkeeping failure here shouldn't fail the
                // whole request, just log it for manual follow-up.
                console.error("[subscription:verifyProPayment] coupon redemption failed", err);
            }
        }

        const { password_hash, ...safeUser } = user;
        res.json({ user: safeUser });
    } catch (err) {
        console.error("[subscription:verifyProPayment]", err);
        res.status(500).json({ error: "failed to verify payment" });
    }
}

module.exports = { createProOrder, verifyProPayment, listPlans };
