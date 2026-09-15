// dhan/expiryDiscovery.js — learns the REAL calendar expiry dates for a
// symbol from NSE+BSE bhavcopy, PURELY IN MEMORY. Unlike
// optionchain/monthDiscovery.js (which this pipeline used to call), this
// NEVER writes an EOD row into option_chain_history — the user was explicit
// that they want ONLY real Dhan minute-level data in that table, not
// bhavcopy's EOD placeholder rows mixed in (2026-09-15). Dhan's own
// rollingoption response carries no expiry field at all (see
// historicalService.js's header), so SOME real calendar reference is
// unavoidable to know which absolute expiry a given (rank, date) resolves
// to — bhavcopy is the free, no-auth, multi-year source for that, same as
// every other pipeline in this repo already relies on it for. It's just
// used here as a read-only calendar lookup, never as a data source that
// lands in the DB.
//
// The underlying bhavcopy zip/CSV IS disk-cached per calendar day
// (lib/nseBhavcopy.js's downloadZip), but CSV *parsing* is not — without the
// per-process day cache below, discovering expiries for all ~218 universe
// symbols would re-parse the SAME ~250 trading-day CSVs per year once per
// symbol (218x redundant parsing). This cache makes it O(trading days) for
// the whole run instead of O(symbols x trading days): each date's full
// NSE+BSE row set is parsed once and reused for every symbol that asks
// about that date afterward, for the life of the process.

const { addDays, dayOfWeek } = require("../lib/dates");
const nseBhavcopy = require("../lib/nseBhavcopy");
const bseBhavcopy = require("../lib/bseBhavcopy");

const DAY_GAP_MS = Number(process.env.BHAVCOPY_DAY_GAP_MS || 1200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// dateStr -> Map<symbol, expiry[]> (both exchanges merged), or null if that
// date genuinely has no bhavcopy (holiday) — cached so it's not retried
// every time a different symbol asks about the same known-holiday date.
const dayCache = new Map();

async function loadDay(dateStr) {
    if (dayCache.has(dateStr)) return dayCache.get(dateStr);

    const bySymbol = new Map();
    try {
        const nse = await nseBhavcopy.getDayRowsBySymbol(dateStr);
        for (const [symbol, rows] of nse) bySymbol.set(symbol, rows);
    } catch {
        // Holiday / weekend / archive gap — cache as "no data" and move on,
        // same non-fatal treatment monthDiscovery.js gives this.
        dayCache.set(dateStr, null);
        return null;
    }
    try {
        const bse = await bseBhavcopy.getDayRowsBySymbol(dateStr);
        for (const [symbol, rows] of bse) {
            if (bySymbol.has(symbol)) bySymbol.get(symbol).push(...rows);
            else bySymbol.set(symbol, rows);
        }
    } catch {
        // BSE bhavcopy is known-flaky in this repo (see extractionCleanupService
        // notes elsewhere) — NSE-only data for this day is still useful.
    }

    dayCache.set(dateStr, bySymbol);
    await sleep(DAY_GAP_MS);
    return bySymbol;
}

/**
 * Every real expiry date for `symbol` that appears in NSE/BSE bhavcopy
 * anywhere in [fromDate, toDate] — ascending, deduped. Weekends skipped.
 * Nothing is written to any table; this is a read-only calendar lookup.
 */
async function discoverExpiries(symbol, fromDate, toDate) {
    const expiries = new Set();
    let d = fromDate;
    while (d <= toDate) {
        if (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) { d = addDays(d, 1); continue; }
        const bySymbol = await loadDay(d);
        const rows = bySymbol ? bySymbol.get(symbol) : null;
        if (rows) for (const r of rows) expiries.add(r.expiry);
        d = addDays(d, 1);
    }
    return [...expiries].sort();
}

module.exports = { discoverExpiries };
