// services/angelOneHistorical.js — Angel One SmartAPI historical data REST.
//
// Used by the nightly cron (services/cron.js) and the backfill script — the
// live path never touches this (live comes from the WebSocket worker), and
// the backtesting engine never touches Angel One at all (MySQL only).
//
// Endpoints (documented SmartAPI shapes):
//   POST /rest/secure/angelbroking/historical/v1/getCandleData
//     { exchange, symboltoken, interval, fromdate: "YYYY-MM-DD HH:mm", todate }
//     -> data: [[ "2026-07-07T09:15:00+05:30", open, high, low, close, volume ], ...]
//   POST /rest/secure/angelbroking/historical/v1/getOIData
//     same request shape -> data: [{ time, oi }, ...]
//
// Rate limit: the historical API allows ~3 req/s — callers must pace
// themselves; withGap() below is the shared helper for that.
//
// Date handling: candle timestamps arrive as ISO strings with the +05:30
// offset. We slice the date/time parts straight off the string (positions
// are fixed) — never `new Date(...)` round-trips (CLAUDE.md Gotcha #12).

const { securePost } = require("../workers/login");
const { dbLogger } = require("../config/logger");

const CANDLE_PATH = "/rest/secure/angelbroking/historical/v1/getCandleData";
const OI_PATH = "/rest/secure/angelbroking/historical/v1/getOIData";

// 400ms (~2.5 req/s) matched Angel One's own documented ~3 req/s limit
// (CLAUDE.md Gotcha #6), but a real run on 2026-07-31 hit a sustained,
// bodyless HTTP 403 wall — including on the plain NSE index call, which
// eventually succeeded on retry, proving this is a rate/infra-level block
// (likely a WAF layer returning 403 instead of 429), NOT a segment/
// permission error (a real permission block never eventually succeeds).
// Also worth noting: this ran WHILE the live worker's own WebSocket session
// was active on the same Angel One account — the two processes may share an
// account-level request budget. Same fix as services/upstoxHistorical.js's
// 2026-07-31 rate-limit fix: slower default pacing + a shared cooldown that
// EVERY call (not just retries of the same request) respects once triggered.
const REQUEST_GAP_MS = Number(process.env.ANGEL_HIST_REQUEST_GAP_MS || 1000);
const MAX_ATTEMPTS = Number(process.env.ANGEL_HIST_MAX_ATTEMPTS || 5);
const RATE_LIMIT_BACKOFF_MS = Number(process.env.ANGEL_HIST_RATE_LIMIT_BACKOFF_MS || 4000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
let blockedUntil = 0;

async function withGap(fn) {
    const blockWait = blockedUntil - Date.now();
    if (blockWait > 0) await sleep(blockWait);
    const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    return fn();
}

// Angel One's historical API doesn't send a Retry-After header and its 403
// carries no JSON body to inspect (confirmed 2026-07-31 — plain infra-level
// block), so unlike Upstox's version of this same fix, there's no signal to
// read beyond "the status code was 403/429". Treat both as rate-limited.
function isRateLimitStatus(err) {
    return /HTTP 403|HTTP 429/.test(err.message || "");
}

async function withRetry(fn, label) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const result = await withGap(fn);
            blockedUntil = 0; // a clean success proves the cooldown has cleared
            return result;
        } catch (err) {
            lastErr = err;
            const isRateLimited = isRateLimitStatus(err);
            if (isRateLimited) {
                const cooldownMs = RATE_LIMIT_BACKOFF_MS * attempt;
                blockedUntil = Math.max(blockedUntil, Date.now() + cooldownMs);
            }
            if (attempt < MAX_ATTEMPTS) {
                const delay = isRateLimited ? Math.max(0, blockedUntil - Date.now()) : 500 * 2 ** (attempt - 1);
                dbLogger.warn(`${label} failed (attempt ${attempt}): ${err.message} — retrying in ${delay}ms${isRateLimited ? " (rate limited, shared cooldown)" : ""}`);
                await sleep(delay);
            }
        }
    }
    throw lastErr;
}

/** "2026-07-07T09:15:00+05:30" -> { date: "2026-07-07", time: "09:15:00" } */
function splitCandleTimestamp(ts) {
    return { date: ts.slice(0, 10), time: ts.slice(11, 19) };
}

/**
 * One-minute candles for a token over one calendar day.
 * @returns [{ date, time, open, high, low, close, volume }]
 */
async function getDayCandles({ exchange, symboltoken, dateStr, interval = "ONE_MINUTE" }) {
    const body = await withRetry(
        () =>
            securePost(CANDLE_PATH, {
                exchange,
                symboltoken: String(symboltoken),
                interval,
                fromdate: `${dateStr} 09:00`,
                todate: `${dateStr} 15:35`,
            }),
        `getCandleData ${exchange}:${symboltoken} ${dateStr}`
    );

    const rows = Array.isArray(body.data) ? body.data : [];
    return rows.map(([ts, open, high, low, close, volume]) => ({
        ...splitCandleTimestamp(String(ts)),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume) || 0,
    }));
}

/**
 * Per-minute open interest for a derivatives token over one calendar day.
 * Returns a Map of "HH:MM:SS" -> oi. Response-field names are handled
 * defensively ({time, oi} per the docs; falls back to array rows).
 */
async function getDayOpenInterest({ exchange, symboltoken, dateStr, interval = "ONE_MINUTE" }) {
    const body = await withRetry(
        () =>
            securePost(OI_PATH, {
                exchange,
                symboltoken: String(symboltoken),
                interval,
                fromdate: `${dateStr} 09:00`,
                todate: `${dateStr} 15:35`,
            }),
        `getOIData ${exchange}:${symboltoken} ${dateStr}`
    );

    const byTime = new Map();
    const rows = Array.isArray(body.data) ? body.data : [];
    for (const row of rows) {
        if (Array.isArray(row)) {
            const { time } = splitCandleTimestamp(String(row[0]));
            byTime.set(time, Number(row[1]) || 0);
        } else if (row && row.time != null) {
            const { time } = splitCandleTimestamp(String(row.time));
            byTime.set(time, Number(row.oi) || 0);
        }
    }
    return byTime;
}

module.exports = { getDayCandles, getDayOpenInterest, splitCandleTimestamp, REQUEST_GAP_MS };
