// services/equityApi.js — Client service for real-time and DB equity data endpoints
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function request(endpoint) {
    const url = `${API_URL}/api/equity${endpoint}`;
    const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            message = body.error || message;
        } catch {
            // non-json
        }
        throw new Error(message);
    }
    return await res.json();
}

export async function fetchMarketMap() {
    return request("/market-map");
}

export async function fetch52WeekHighLow() {
    return request("/52-week-high-low");
}

export async function fetchIndustryMomentum() {
    return request("/industry-momentum");
}

export async function fetchMostActive() {
    return request("/most-active");
}

export async function fetchSectorIndices() {
    return request("/sectors");
}
