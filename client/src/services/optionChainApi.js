// services/optionChainApi.js
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

/**
 * Fetch option chain data with market awareness
 */
export async function fetchOptionChain(symbol, expiry, forceLive = false) {
    try {
        const url = new URL(`${API_URL}/api/option-chain/${symbol.toLowerCase()}`);
        if (expiry) url.searchParams.set("expiry", expiry);
        if (forceLive) url.searchParams.set("forceLive", "true");

        console.log(`[API] Fetching: ${url.toString()}`);
        
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            // Add timeout
            signal: AbortSignal.timeout(30000)
        });
        
        if (!res.ok) {
            let errorMessage = `Request failed (${res.status})`;
            try {
                const body = await res.json();
                errorMessage = body.error || errorMessage;
            } catch (e) {
                // If response is not JSON
                const text = await res.text();
                errorMessage = text || errorMessage;
            }
            throw new Error(errorMessage);
        }
        
        return await res.json();
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error('Request timeout - server took too long to respond');
        }
        if (err.code === 'ECONNREFUSED' || err.message.includes('Failed to fetch')) {
            throw new Error('Cannot connect to server. Please check if the backend is running on port 5001');
        }
        throw err;
    }
}

/**
 * Every symbol with real data in option_chain_history (indices + stocks),
 * for the Select Asset dropdown — replaces the old hardcoded 3-symbol list
 * now that Bhavcopy/Breeze backfills cover ~280 symbols.
 */
export async function fetchSymbolList() {
    const res = await fetch(`${API_URL}/api/option-chain/symbols/list`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Symbol list fetch failed (${res.status})`);
    return res.json(); // { indices: [...], stocks: [...], liveSymbols: [...] }
}

/**
 * Force refresh and save snapshot
 */
export async function refreshOptionChain(symbol, expiry = null) {
    try {
        const url = new URL(`${API_URL}/api/option-chain/refresh`);
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({ symbol, expiry }),
        });
        
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `Refresh failed (${res.status})`);
        }
        return res.json();
    } catch (err) {
        if (err.message.includes('Failed to fetch')) {
            throw new Error('Cannot connect to server. Please check if the backend is running');
        }
        throw err;
    }
}

/**
 * Fetch LTP history for a single contract (strike + expiry + right), for the
 * hover "view chart" action on the option chain LTP cells.
 */
export async function fetchContractHistory(symbol, { strike, expiry, right }) {
    const url = new URL(`${API_URL}/api/option-chain/${symbol.toLowerCase()}/contract-history`);
    url.searchParams.set("strike", strike);
    url.searchParams.set("expiry", expiry);
    url.searchParams.set("right", right);

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Contract history fetch failed (${res.status})`);
    }
    return res.json();
}

/**
 * Test connection to backend
 */
export async function testConnection() {
    try {
        const res = await fetch(`${API_URL}/health`);
        if (!res.ok) throw new Error(`Health check failed (${res.status})`);
        return await res.json();
    } catch (err) {
        throw new Error(`Cannot connect to server: ${err.message}`);
    }
}

// Live streaming moved to socket.io — see services/liveSocket.js
// (subscribeLiveTicks). The old raw-WebSocket path was removed so there is
// exactly one live-data path in the codebase.