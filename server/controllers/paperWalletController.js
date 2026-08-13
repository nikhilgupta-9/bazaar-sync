const { pool } = require("../config/db");
const razorpayService = require("../services/razorpayService");
const paperWalletService = require("../services/paperWalletService");
const { REFILL_PRICE_PAISE } = require("../config/paperTradeConfig");

async function getWallet(req, res) {
    try {
        const [[user]] = await pool.query("SELECT tier, pro_expires_at FROM users WHERE id = ?", [req.user.sub]);
        if (!user) return res.status(404).json({ error: "user not found" });

        const status = await paperWalletService.getWalletStatus(req.user.sub, user);
        const ledger = await paperWalletService.getRecentLedger(req.user.sub);
        res.json({ ...status, ledger });
    } catch (err) {
        console.error("[paperTrade:getWallet]", err);
        res.status(500).json({ error: "failed to load wallet" });
    }
}

// Gated by requirePro at the route level — refills are Pro-only.
async function createRefillOrder(req, res) {
    try {
        const order = await razorpayService.createOrder({
            amountPaise: REFILL_PRICE_PAISE,
            receipt: `refill_${req.user.sub}_${Date.now()}`,
        });
        res.json(order);
    } catch (err) {
        console.error("[paperTrade:createRefillOrder]", err);
        res.status(500).json({ error: "failed to create order" });
    }
}

async function verifyRefillPayment(req, res) {
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

        const wallet = await paperWalletService.creditRefill(req.user.sub, {
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
        });
        res.json({ balance: Number(wallet.balance) });
    } catch (err) {
        console.error("[paperTrade:verifyRefillPayment]", err);
        res.status(500).json({ error: "failed to verify payment" });
    }
}

module.exports = { getWallet, createRefillOrder, verifyRefillPayment };
