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
// button does) defaults to the base 1-month plan server-side.
export async function createProOrder(token, planId) {
    const res = await fetch(`${API_URL}/api/subscription/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId }),
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
