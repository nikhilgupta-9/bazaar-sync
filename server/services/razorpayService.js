// services/razorpayService.js — thin wrapper around Razorpay's plain REST
// API. No SDK dependency: order creation is one HTTP Basic-auth POST (axios
// is already a dependency), and payment verification is a documented HMAC
// check (crypto is a Node built-in) — see
// https://razorpay.com/docs/payments/server-integration/nodejs/build-integration/
const axios = require("axios");
const crypto = require("crypto");

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

function credentials() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
        throw new Error("RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are not set in .env");
    }
    return { keyId, keySecret };
}

// amountPaise: integer, smallest currency unit (₹499 => 49900). `notes` is
// Razorpay's arbitrary key-value bag stored on the order server-side at
// creation time — used by the multi-plan Pricing flow to stash which plan
// was purchased (see subscriptionController.js), since it can't be tampered
// with by the client afterward.
async function createOrder({ amountPaise, receipt, notes }) {
    const { keyId, keySecret } = credentials();
    const { data } = await axios.post(
        `${RAZORPAY_API_BASE}/orders`,
        { amount: amountPaise, currency: "INR", receipt, notes },
        { auth: { username: keyId, password: keySecret } }
    );
    return { orderId: data.id, amount: data.amount, currency: data.currency, keyId };
}

// Re-fetches an order directly from Razorpay — the only trustworthy way to
// learn what an order was actually for after the fact (never trust a
// client-supplied plan id at verify time, only what our own server set at
// creation time and Razorpay is now handing back).
async function fetchOrder(orderId) {
    const { keyId, keySecret } = credentials();
    const { data } = await axios.get(`${RAZORPAY_API_BASE}/orders/${orderId}`, {
        auth: { username: keyId, password: keySecret },
    });
    return data;
}

function verifySignature({ orderId, paymentId, signature }) {
    const { keySecret } = credentials();
    const expected = crypto
        .createHmac("sha256", keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest("hex");
    return expected === signature;
}

module.exports = { createOrder, fetchOrder, verifySignature };
