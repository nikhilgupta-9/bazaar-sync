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

export async function openPosition(token, payload) {
    const res = await fetch(`${API_URL}/api/paper-trade/positions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    return handle(res);
}

export async function openStrategyTrade(token, payload) {
    const res = await fetch(`${API_URL}/api/paper-trade/strategy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    return handle(res);
}

export async function closePosition(token, id, payload = {}) {
    const res = await fetch(`${API_URL}/api/paper-trade/positions/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload || {}),
    });
    return handle(res);
}

export async function closeAllPositions(token, symbol = null) {
    const res = await fetch(`${API_URL}/api/paper-trade/positions/close-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol }),
    });
    return handle(res);
}

export async function fetchPaperLeaderboard(token) {
    const res = await fetch(`${API_URL}/api/paper-trade/leaderboard`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}

export async function fetchPaperOrders(token, status = "") {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await fetch(`${API_URL}/api/paper-trade/orders${query}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}

export async function placePaperOrder(token, payload) {
    const res = await fetch(`${API_URL}/api/paper-trade/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    return handle(res);
}

export async function cancelPaperOrder(token, orderId) {
    const res = await fetch(`${API_URL}/api/paper-trade/orders/${orderId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}

export async function updatePositionBracket(token, positionId, { stopLossPrice, targetPrice, trailingSl }) {
    const res = await fetch(`${API_URL}/api/paper-trade/positions/${positionId}/bracket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stopLossPrice, targetPrice, trailingSl }),
    });
    return handle(res);
}
