const razorpayService = require("../services/razorpayService");
const subscriptionService = require("../services/subscriptionService");
const { PRO_PRICE_PAISE } = require("../config/paperTradeConfig");

async function createProOrder(req, res) {
    try {
        const order = await razorpayService.createOrder({
            amountPaise: PRO_PRICE_PAISE,
            receipt: `pro_${req.user.sub}_${Date.now()}`,
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

        const user = await subscriptionService.purchasePro(req.user.sub, {
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
        });
        const { password_hash, ...safeUser } = user;
        res.json({ user: safeUser });
    } catch (err) {
        console.error("[subscription:verifyProPayment]", err);
        res.status(500).json({ error: "failed to verify payment" });
    }
}

module.exports = { createProOrder, verifyProPayment };
