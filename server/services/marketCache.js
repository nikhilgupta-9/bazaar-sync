// services/marketCache.js — in-memory live tick cache (Express process).
//
// A Map keyed by instrument token, populated ONLY from the market worker's
// IPC summaries (see services/workerManager.js). Never populated from MySQL
// on a timer — MySQL is the persistence tier, this is the live tier.
//
// Read by services/socketBroadcast.js (socket.io push) and by
// services/optionChainService.js (live REST responses while the market is
// open).

const STALE_MS = Number(process.env.MARKET_CACHE_STALE_MS || 120000); // 2 min

// token -> { kind, underlying, strike, right, expiry, lotSize,
//            ltp, volume, oi, oiChangePercent, timestamp, receivedAt }
const cache = new Map();

let lastUpdateAt = 0;
let feedConnected = false;

function applyTicks(ticks) {
    const now = Date.now();
    for (const t of ticks) {
        cache.set(t.token, { ...t, receivedAt: now });
    }
    lastUpdateAt = now;
}

function setFeedConnected(connected) {
    feedConnected = connected;
}

function clear() {
    cache.clear();
    lastUpdateAt = 0;
}

/** True when the cache has recent data to serve live views from. */
function isFresh() {
    return lastUpdateAt > 0 && Date.now() - lastUpdateAt < STALE_MS;
}

function getStatus() {
    return { feedConnected, lastUpdateAt, entries: cache.size, fresh: isFresh() };
}

function getSpot(underlying) {
    const sym = underlying.toUpperCase();
    for (const [, e] of cache) {
        if (e.kind === "index" && e.underlying === sym) return e;
    }
    return null;
}

/** India VIX entry ({ ltp, timestamp, ... }), or null if not yet ticked. */
function getVix() {
    for (const [, e] of cache) {
        if (e.kind === "vix") return e;
    }
    return null;
}

/** Nearest-future entry for an underlying ({ ltp, expiry, lotSize, ... }), or null. */
function getFuture(underlying) {
    const sym = underlying.toUpperCase();
    for (const [, e] of cache) {
        if (e.kind === "future" && e.underlying === sym) return e;
    }
    return null;
}

/** lotSize for an underlying's option contracts, from any cached option entry. */
function getLotSize(underlying) {
    const sym = underlying.toUpperCase();
    for (const [, e] of cache) {
        if (e.kind === "option" && e.underlying === sym && e.lotSize) return e.lotSize;
    }
    return null;
}

/**
 * All live option entries for an underlying, grouped per strike:
 *   { spot, expiry, rows: [{ strike, ce: {...}|null, pe: {...}|null }] }
 * Returns null when the cache holds nothing usable for the symbol.
 */
function getChain(underlying) {
    const sym = underlying.toUpperCase();
    const spotEntry = getSpot(sym);

    const byStrike = new Map();
    let expiry = null;
    for (const [, e] of cache) {
        if (e.kind !== "option" || e.underlying !== sym) continue;
        expiry = e.expiry; // worker subscribes a single (nearest) expiry per symbol
        let row = byStrike.get(e.strike);
        if (!row) {
            row = { strike: e.strike, ce: null, pe: null };
            byStrike.set(e.strike, row);
        }
        const side = {
            ltp: e.ltp,
            volume: e.volume,
            oi: e.oi,
            oiChangePercent: e.oiChangePercent,
            timestamp: e.timestamp,
        };
        if (e.right === "CE") row.ce = side;
        else if (e.right === "PE") row.pe = side;
    }

    if (byStrike.size === 0 && !spotEntry) return null;

    return {
        spot: spotEntry ? spotEntry.ltp : null,
        spotTimestamp: spotEntry ? spotEntry.timestamp : null,
        expiry,
        rows: [...byStrike.values()].sort((a, b) => a.strike - b.strike),
    };
}

/** Compact per-symbol summary used by the socket.io broadcaster. */
function getBroadcastPayload(underlying) {
    const chain = getChain(underlying);
    if (!chain) return null;
    const vix = getVix();
    const future = getFuture(underlying);
    return {
        symbol: underlying.toUpperCase(),
        spot: chain.spot,
        expiry: chain.expiry,
        vix: vix ? vix.ltp : null,
        futurePrice: future ? future.ltp : null,
        futureExpiry: future ? future.expiry : null,
        ticks: chain.rows.map((r) => ({
            strike: r.strike,
            ceLtp: r.ce ? r.ce.ltp : null,
            ceOi: r.ce ? r.ce.oi : null,
            ceVolume: r.ce ? r.ce.volume : null,
            peLtp: r.pe ? r.pe.ltp : null,
            peOi: r.pe ? r.pe.oi : null,
            peVolume: r.pe ? r.pe.volume : null,
        })),
        timestamp: lastUpdateAt,
    };
}

module.exports = {
    applyTicks,
    setFeedConnected,
    clear,
    isFresh,
    getStatus,
    getSpot,
    getVix,
    getFuture,
    getLotSize,
    getChain,
    getBroadcastPayload,
};
