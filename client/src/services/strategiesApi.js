const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

export async function saveStrategy(token, { name, underlying, legs }) {
    const res = await fetch(`${API_URL}/api/strategies`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, underlying, legs }),
    });
    return handle(res);
}

// Listing/deleting only requires being logged in (not Pro) — see
// strategiesController.js's comment: a lapsed Pro subscriber can still see
// and remove what they already saved, they just can't create new ones.
export async function listStrategies(token) {
    const res = await fetch(`${API_URL}/api/strategies`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}

export async function deleteStrategy(token, id) {
    const res = await fetch(`${API_URL}/api/strategies/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Delete failed (${res.status})`);
    }
}

export async function saveBacktestResult(token, payload) {
    const res = await fetch(`${API_URL}/api/backtest/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    return handle(res);
}
