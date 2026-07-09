const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

// Backtesting is Pro-only (see server/routes/backtest.js), so every call
// needs the caller's token.
export async function runBacktest(token, params) {
    const res = await fetch(`${API_URL}/api/backtest`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(params),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}
