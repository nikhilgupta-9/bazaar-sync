// services/simulatorApi.js — talks only to our backend, which reads only
// MySQL (option_chain_history/ohlcv_data) for the Simulator, never Angel One.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
}

export async function fetchSimulatorDates(symbol) {
    const res = await fetch(`${API_URL}/api/simulator/dates/${symbol.toLowerCase()}`, {
        headers: { Accept: "application/json" },
    });
    return handle(res);
}

export async function fetchSimulatorChain(symbol, { date, expiry, time } = {}) {
    const url = new URL(`${API_URL}/api/simulator/chain/${symbol.toLowerCase()}`);
    if (date) url.searchParams.set("date", date);
    if (expiry) url.searchParams.set("expiry", expiry);
    if (time) url.searchParams.set("time", time);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return handle(res);
}

export async function fetchSimulatorCandles(symbol, { date } = {}) {
    const url = new URL(`${API_URL}/api/simulator/candles/${symbol.toLowerCase()}`);
    if (date) url.searchParams.set("date", date);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    return handle(res);
}

export async function runSimulatorReplay(symbol, { date, expiry, legs }) {
    const res = await fetch(`${API_URL}/api/simulator/replay/${symbol.toLowerCase()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ date, expiry, legs }),
    });
    return handle(res);
}
