const razorpayService = require("../services/razorpayService");
const subscriptionService = require("../services/subscriptionService");
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

        const order = await razorpayService.createOrder({
            amountPaise: plan.priceInPaise,
            receipt: `pro_${req.user.sub}_${Date.now()}`,
            // Stashed server-side now so verifyProPayment can learn the plan
            // back from Razorpay itself later, never from client input.
            notes: { planId: plan.id, userId: String(req.user.sub) },
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
        const { password_hash, ...safeUser } = user;
        res.json({ user: safeUser });
    } catch (err) {
        console.error("[subscription:verifyProPayment]", err);
        res.status(500).json({ error: "failed to verify payment" });
    }
}

module.exports = { createProOrder, verifyProPayment, listPlans };
