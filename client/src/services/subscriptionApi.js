const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

// Public — no token needed, the Pricing page shows real prices to
// logged-out visitors too.
export async function fetchProPlans() {
    const res = await fetch(`${API_URL}/api/subscription/plans`);
    return handle(res);
}

// planId is optional — omitting it (as PaperTrade.jsx's existing "Get Pro"
// button does) defaults to the base 1-month plan server-side. couponCode is
// optional too — validated server-side (order-creation is the only place
// that trusts client input here; the amount actually charged always comes
// back from Razorpay, never re-derived from this call's response alone).
// Public, no order created — lets the Pricing page show the real discounted
// price on every plan card as soon as a coupon is applied, instead of the
// discount only appearing once Razorpay Checkout opens.
export async function validateCoupon(code) {
    const res = await fetch(`${API_URL}/api/subscription/coupon/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
    });
    return handle(res);
}

export async function createProOrder(token, planId, couponCode) {
    const res = await fetch(`${API_URL}/api/subscription/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId, couponCode: couponCode || undefined }),
    });
    return handle(res);
}

export async function verifyProPayment(token, payload) {
    const res = await fetch(`${API_URL}/api/subscription/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    return handle(res);
}
