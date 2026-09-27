// backtest/bhavcopyDay.js — one trading day's NSE+BSE F&O bhavcopy, read
// PURELY IN MEMORY. Used only as a contract/expiry calendar ("which option
// strikes and futures expiries actually existed on this date") — nothing
// here is ever written to option_chain_history or futures_history. Same rule
// dhan/expiryDiscovery.js follows (user decision 2026-09-15: those tables
// hold ONLY real minute-level data, no bhavcopy EOD placeholder rows).
//
// The zip/CSV itself is disk-cached by lib/{nse,bse}Bhavcopy.js; this adds a
// per-process parse cache so the same day isn't re-parsed for every symbol.
//
// HOLIDAY vs FAILURE: only an HTTP 404 means "no bhavcopy = holiday". A
// timeout / 403 / 503 / network reset is NSE throttling, not a holiday —
// confirmed 2026-09-25: a run silently lost 21-29 Aug 2024 because Node
// fetches timed out while the same URL answered curl in 0.35s. Those are
// retried with backoff and, if still failing, THROWN so the month is never
// marked done with missing days.

const nseBhavcopy = require("../lib/nseBhavcopy");
const bseBhavcopy = require("../lib/bseBhavcopy");

const DAY_GAP_MS = Number(process.env.BHAVCOPY_DAY_GAP_MS || 1200);
// NSE throttling clears on its own after a few minutes (seen 2026-09-25) — wait it out (~19 min total) before giving up.
const RETRY_DELAYS_MS = [15_000, 60_000, 180_000, 300_000, 600_000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errMsg = (err) => (err instanceof Error ? err.message : String(err));
// "No file for this day" signals (holiday, or the exchange simply has no F&O
// file that day). BSE answers a non-existent file with an HTML page instead
// of a 404 (e.g. every day before SENSEX/BANKEX F&O relaunched in May 2023),
// which lib/bseBhavcopy.js reports as "missing expected columns ... <!DOCTYPE".
const isHoliday = (err) => /HTTP 404\b/.test(errMsg(err)) || /missing expected columns[\s\S]*<!DOCTYPE/i.test(errMsg(err));

// NSE trading holidays from 2024-07-08 onward (the UDiFF nsearchives.nseindia.com
// era). That host does NOT 404 a holiday's missing file — the request just
// hangs until timeout, indistinguishable from throttling — so these days are
// recognised up front instead of being retried for ~19 min and then stopping
// the run. (Before 2024-07-08 the old archive host 404s holidays correctly.)
// Each entry checked 2026-09-25: no bhavcopy exists for it.
const NSE_HOLIDAYS_UDIFF = new Set([
    "2024-07-17", "2024-08-15", "2024-10-02", "2024-11-15", "2024-11-20", "2024-12-25",
    "2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14", "2025-04-18",
    "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-22", "2025-11-05", "2025-12-25",
]);

async function withRetry(label, fn) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (isHoliday(err)) throw err;
            if (attempt >= RETRY_DELAYS_MS.length) {
                throw new Error(`${label}: bhavcopy download kept failing (not a holiday): ${err instanceof Error ? err.message : err}`);
            }
            console.warn(`  [bhavcopy] ${label} failed (${(err instanceof Error ? err.message : String(err)).split("\n")[0]}) — retry in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
            await sleep(RETRY_DELAYS_MS[attempt]);
        }
    }
}

function groupBySymbol(rows, into) {
    for (const r of rows) {
        if (!into.has(r.symbol)) into.set(r.symbol, []);
        into.get(r.symbol).push(r);
    }
}

// dateStr -> { options, futures, bseFailed } | null (holiday)
const dayCache = new Map();

// A futures-only run never looks at option rows, and keeping every day's
// full option chain (~50k rows/day) cached crashed a 2-year run at Node's
// 4GB heap limit (2026-09-25). With keepOptions off, only the SET of symbols
// with options is kept (empty arrays), which is all --symbols=ALL needs.
let keepOptions = true;
function setKeepOptions(v) {
    keepOptions = Boolean(v);
}

async function loadDay(dateStr) {
    if (dayCache.has(dateStr)) return dayCache.get(dateStr);
    if (NSE_HOLIDAYS_UDIFF.has(dateStr)) {
        dayCache.set(dateStr, null);
        return null;
    }

    const options = new Map();
    const futures = new Map();
    try {
        groupBySymbol(await withRetry(`NSE ${dateStr}`, () => nseBhavcopy.getDayAllRows(dateStr)), options);
        groupBySymbol(await withRetry(`NSE ${dateStr}`, () => nseBhavcopy.getDayFuturesRows(dateStr)), futures);
    } catch (err) {
        if (!isHoliday(err)) throw err; // throttling/outage — stop, don't lose the day
        dayCache.set(dateStr, null);
        return null;
    }

    // BSE only matters for SENSEX/BANKEX; a persistent BSE failure is
    // recorded (run.js refuses to finish a BSE symbol's month with it)
    // rather than stopping NSE symbols.
    let bseFailed = false;
    try {
        groupBySymbol(await withRetry(`BSE ${dateStr}`, () => bseBhavcopy.getDayAllRows(dateStr)), options);
        groupBySymbol(await withRetry(`BSE ${dateStr}`, () => bseBhavcopy.getDayFuturesRows(dateStr)), futures);
    } catch (err) {
        if (!isHoliday(err)) bseFailed = true;
    }

    if (!keepOptions) for (const k of options.keys()) options.set(k, []);
    const day = { options, futures, bseFailed };
    dayCache.set(dateStr, day);
    await sleep(DAY_GAP_MS);
    return day;
}

/** Every stock symbol with options on this day (for --symbols=ALL). */
function optionSymbols(day) {
    return day ? [...day.options.keys()] : [];
}

module.exports = { loadDay, optionSymbols, setKeepOptions };
