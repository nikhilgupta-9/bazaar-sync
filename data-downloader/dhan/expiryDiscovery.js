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

// CONFIRMED FOR REAL (2026-09-20): fetching one trading day's bhavcopy
// (NSE, optionally +BSE) was fully SEQUENTIAL here — a fixed 1200ms courtesy
// sleep after every fresh (non-cached) day, one day at a time. For a single
// month's discovery (this month + a 120-day forward lookahead, ~100+
// trading days, most not yet in dayCache the first time a given date is
// reached) that's 100+ round trips run one after another — and NSE's own
// archive server was separately observed taking anywhere from ~1s to ~25s
// per file (worse for nsearchives.nseindia.com's post-2024-07-08 UDiFF path
// than the older archives.nseindia.com one) — a real user-visible symptom
// was a Dhan universe job looking "stuck" on one month for 20-30 minutes,
// when it was actually just working through this serial discovery queue.
// No rate limit is documented for either archive (these are static file
// downloads, not a metered API, unlike Dhan's endpoints), so a small
// concurrency pool here is a straightforward win — same total requests,
// spread across a few in flight at once instead of one at a time.
const DAY_CONCURRENCY = Number(process.env.BHAVCOPY_DAY_CONCURRENCY || 5);

// dateStr|exchange -> Map<symbol, expiry[]>; NSE symbols do not need a BSE
// download, while SENSEX/BANKEX opt into the BSE supplement below.
//
// CONFIRMED FOR REAL (2026-09-21): this cache was unbounded and never
// cleared — by its own original design ("for the life of the process", see
// the file header) — and a real multi-day dhan/runUniverse.js run (218
// symbols, each pulling a year + 120-day lookahead of NSE+BSE bhavcopy,
// where EVERY unique calendar date's full day (every symbol's rows, not
// just the one being discovered) gets cached forever) crashed with
// "JavaScript heap out of memory" after climbing past 4GB. Bounded to a
// FIFO cap: oldest entries evicted once the cache exceeds DAY_CACHE_MAX_SIZE.
// This still gets the whole point of the cache (avoiding re-parsing the same
// day's CSV for the next few hundred symbols whose lookahead windows
// overlap) without holding every day the entire multi-day job ever touched.
const DAY_CACHE_MAX_SIZE = Number(process.env.BHAVCOPY_DAY_CACHE_MAX_SIZE || 500);
const dayCache = new Map();
function cacheDay(key, value) {
    dayCache.set(key, value);
    if (dayCache.size > DAY_CACHE_MAX_SIZE) {
        const oldestKey = dayCache.keys().next().value; // Map preserves insertion order — FIFO eviction
        dayCache.delete(oldestKey);
    }
}

// In-flight de-dup: if two concurrent pool workers happen to reach the same
// not-yet-cached date (shouldn't normally happen — discoverExpiries below
// only ever gives each date to one worker — but this stays cheap insurance
// against issuing the same download twice if that ever changes).
const inFlight = new Map();

async function loadDay(dateStr, includeBse) {
    const cacheKey = `${dateStr}|${includeBse ? "bse" : "nse"}`;
    if (dayCache.has(cacheKey)) return dayCache.get(cacheKey);
    if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

    const promise = (async () => {
        const bySymbol = new Map();
        try {
            const nse = await nseBhavcopy.getDayRowsBySymbol(dateStr);
            for (const [symbol, rows] of nse) bySymbol.set(symbol, rows);
        } catch {
            // Holiday / weekend / archive gap — cache as "no data" and move on,
            // same non-fatal treatment monthDiscovery.js gives this.
            cacheDay(cacheKey, null);
            return null;
        }
        if (includeBse) {
            try {
                const bse = await bseBhavcopy.getDayRowsBySymbol(dateStr);
                for (const [symbol, rows] of bse) {
                    if (bySymbol.has(symbol)) bySymbol.get(symbol).push(...rows);
                    else bySymbol.set(symbol, rows);
                }
            } catch {
                // BSE is an optional supplement; NSE data remains usable.
            }
        }
        cacheDay(cacheKey, bySymbol);
        return bySymbol;
    })();

    inFlight.set(cacheKey, promise);
    try {
        return await promise;
    } finally {
        inFlight.delete(cacheKey);
    }
}

/** Runs `worker` over `items` with at most `concurrency` in flight at once — same pattern as dhan/enrichOptions.js's asyncPool. */
async function asyncPool(concurrency, items, worker) {
    let cursor = 0;
    async function run() {
        while (cursor < items.length) {
            const i = cursor++;
            await worker(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

/**
 * Every real expiry date for `symbol` that appears in NSE/BSE bhavcopy
 * anywhere in [fromDate, toDate] — ascending, deduped. Weekends skipped.
 * Nothing is written to any table; this is a read-only calendar lookup.
 */
async function discoverExpiries(symbol, fromDate, toDate) {
    const expiries = new Set();
    const includeBse = ["SENSEX", "BANKEX"].includes(symbol.toUpperCase());

    const dates = [];
    for (let d = fromDate; d <= toDate; d = addDays(d, 1)) {
        if (dayOfWeek(d) !== 0 && dayOfWeek(d) !== 6) dates.push(d);
    }

    await asyncPool(DAY_CONCURRENCY, dates, async (d) => {
        const bySymbol = await loadDay(d, includeBse);
        const rows = bySymbol ? bySymbol.get(symbol) : null;
        if (rows) for (const r of rows) expiries.add(r.expiry);
    });

    return [...expiries].sort();
}

module.exports = { discoverExpiries };
