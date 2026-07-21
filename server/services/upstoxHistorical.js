// services/upstoxHistorical.js — Upstox historical data REST (backfill only).
//
// Two data flavors, both feeding option_chain_history / ohlcv_data:
//   1. Expired-instruments API (Upstox PLUS ONLY) — real option-chain data
//      for contracts that have already expired. Angel One cannot do this at
//      all (its instrument master only lists currently-live contracts).
//      IMPORTANT: Upstox's own docs cap "Get Expiries" at "up to six months
//      of historical expiries" (confirmed against live docs 2026-07-19) —
//      this is NOT a multi-year source. For real multi-year depth, see
//      services/nseBhavcopy.js (daily-only granularity instead).
//   2. Regular historical-candle API — underlying (index) spot OHLC only,
//      no option strikes, no Plus plan needed. Good depth (10yr weekly/
//      monthly, ~1yr daily/30min, ~1mo 1-minute) — used here only to get an
//      approximate spot price per day for centering strikes and computing
//      Greeks, not as a primary data source.
//
// Auth: static Bearer token from UPSTOX_ACCESS_TOKEN. NOT auto-refreshing —
// unlike Angel One's automatic TOTP login, Upstox tokens are minted via a
// one-time OAuth2 browser flow. "Extended" tokens last ~1 year (see the JWT
// payload's `isExtended`/`exp` claims), but when this eventually 401s, a
// human has to log in again and paste a fresh token into .env.
//
// Nothing here is required by Express — safe to run from one-off scripts
// only (server/scripts/backfillUpstox.js). Never called from a request path.
//
// Date handling: same project rule as everywhere else (CLAUDE.md Gotcha #12)
// — dates are plain 'YYYY-MM-DD' strings, candle timestamps are sliced as
// strings, never round-tripped through `new Date(nonISOString)`.

const { dbLogger } = require("../config/logger");

const BASE_URL = process.env.UPSTOX_API_BASE_URL || "https://api.upstox.com/v2";

const REQUEST_GAP_MS = Number(process.env.UPSTOX_REQUEST_GAP_MS || 350);
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
async function withGap(fn) {
    const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
}

async function withRetry(fn, label) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await withGap(fn);
        } catch (err) {
            lastErr = err;
            if (attempt < MAX_ATTEMPTS) {
                const delay = 500 * 2 ** (attempt - 1);
                dbLogger.warn(`${label} failed (attempt ${attempt}): ${err.message} — retrying in ${delay}ms`);
                await sleep(delay);
            }
        }
    }
    throw lastErr;
}

function assertToken() {
    if (!process.env.UPSTOX_ACCESS_TOKEN) {
        throw new Error("Missing UPSTOX_ACCESS_TOKEN in .env — paste a fresh token from account.upstox.com/developer/apps");
    }
}

function authHeaders() {
    assertToken();
    return {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${process.env.UPSTOX_ACCESS_TOKEN}`,
    };
}

async function secureGet(path, label) {
    const res = await fetch(`${BASE_URL}${path}`, { headers: authHeaders() });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.status !== "success") {
        const msg = (body && (body.errors?.[0]?.message || body.message)) || `HTTP ${res.status}`;
        const err = new Error(`${label} failed: ${msg}`);
        err.httpStatus = res.status;
        throw err;
    }
    return body;
}

/** All expiries Upstox has on file for an underlying (capped ~6mo back — Upstox's own limit, not ours). */
async function getExpiries(instrumentKey) {
    const body = await withRetry(
        () => secureGet(`/expired-instruments/expiries?instrument_key=${encodeURIComponent(instrumentKey)}`, "getExpiries"),
        `getExpiries ${instrumentKey}`
    );
    return Array.isArray(body.data) ? body.data.slice().sort() : [];
}

/** All expired CE/PE contracts for one underlying+expiry (strikes, instrument keys, lot size). */
async function getExpiredOptionContracts(instrumentKey, expiryDate) {
    const body = await withRetry(
        () =>
            secureGet(
                `/expired-instruments/option/contract?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${expiryDate}`,
                "getExpiredOptionContracts"
            ),
        `getExpiredOptionContracts ${instrumentKey} ${expiryDate}`
    );
    return Array.isArray(body.data) ? body.data : [];
}

/** "2023-10-01T00:00:00+05:30" -> { date: "2023-10-01", time: "00:00:00" } — string slicing, no Date(). */
function splitCandleTimestamp(ts) {
    return { date: ts.slice(0, 10), time: ts.slice(11, 19) };
}

function mapCandles(rawCandles) {
    // Upstox candle row shape: [timestamp, open, high, low, close, volume, oi]
    return rawCandles
        .map(([ts, open, high, low, close, volume, oi]) => ({
            ...splitCandleTimestamp(String(ts)),
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
            volume: Number(volume) || 0,
            oi: Number(oi) || 0,
        }))
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/**
 * OHLC+OI candles for an EXPIRED option contract, over an arbitrary date
 * range (unlike Angel One's per-day-only calls, Upstox accepts a real
 * from/to range in one request — much cheaper for a multi-week contract).
 */
async function getExpiredCandles(expiredInstrumentKey, { interval = "1minute", fromDate, toDate }) {
    const path = `/expired-instruments/historical-candle/${encodeURIComponent(expiredInstrumentKey)}/${interval}/${toDate}/${fromDate}`;
    const body = await withRetry(() => secureGet(path, "getExpiredCandles"), `getExpiredCandles ${expiredInstrumentKey} ${fromDate}..${toDate}`);
    return mapCandles(body.data?.candles || []);
}

/**
 * OHLC candles for a still-active instrument — used here only to get an
 * approximate underlying spot price history (for strike centering + Greeks
 * inputs), not as the primary data source. Uses the v2 endpoint (marked
 * "Deprecated" in Upstox's docs but still documented/functional as of
 * 2026-07-19); switch to v3 if/when v2 actually stops working.
 */
async function getCandles(instrumentKey, { interval = "day", fromDate, toDate }) {
    const path = `/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${toDate}${fromDate ? `/${fromDate}` : ""}`;
    const body = await withRetry(() => secureGet(path, "getCandles"), `getCandles ${instrumentKey} ${fromDate || "?"}..${toDate}`);
    return mapCandles(body.data?.candles || []);
}

// Best-known Upstox instrument keys for our three underlyings. NIFTY's is
// confirmed from Upstox's own docs examples; BANKNIFTY/FINNIFTY are the
// documented naming convention but NOT yet verified against a real response
// — if either 404s/empties, check the exact string via Upstox's instrument
// master CSV (assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz).
const UNDERLYING_KEYS = {
    NIFTY: "NSE_INDEX|Nifty 50",
    BANKNIFTY: "NSE_INDEX|Nifty Bank",
    FINNIFTY: "NSE_INDEX|Nifty Fin Service",
};

module.exports = {
    getExpiries,
    getExpiredOptionContracts,
    getExpiredCandles,
    getCandles,
    splitCandleTimestamp,
    UNDERLYING_KEYS,
};
