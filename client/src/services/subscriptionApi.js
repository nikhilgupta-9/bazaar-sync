const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

export async function createProOrder(token) {
    const res = await fetch(`${API_URL}/api/subscription/order`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
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
