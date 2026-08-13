const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

export async function fetchWallet(token) {
    const res = await fetch(`${API_URL}/api/paper-trade/wallet`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}

export async function createRefillOrder(token) {
    const res = await fetch(`${API_URL}/api/paper-trade/refill/order`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}

export async function verifyRefillPayment(token, payload) {
    const res = await fetch(`${API_URL}/api/paper-trade/refill/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    return handle(res);
}

export async function fetchPositions(token, status = "open") {
    const res = await fetch(`${API_URL}/api/paper-trade/positions?status=${status}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}

export async function openPosition(token, { symbol, expiry, strike, optRight, lots }) {
    const res = await fetch(`${API_URL}/api/paper-trade/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol, expiry, strike, optRight, lots }),
    });
    return handle(res);
}

export async function closePosition(token, id) {
    const res = await fetch(`${API_URL}/api/paper-trade/positions/${id}/close`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}
