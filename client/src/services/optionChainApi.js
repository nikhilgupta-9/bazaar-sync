const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

export async function fetchOptionChain(symbol, expiry) {
    const url = new URL(`${API_URL}/api/option-chain/${symbol.toLowerCase()}`);
    if (expiry) url.searchParams.set("expiry", expiry);

    const res = await fetch(url);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
}
