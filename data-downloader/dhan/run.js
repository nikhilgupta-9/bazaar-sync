// dhan/run.js — full Dhan pipeline for ONE symbol, ONE calendar year.
//
//   node dhan/run.js <SYMBOL> <YEAR> [--skip-discovery] [--skip-index] [--skip-options] [--skip-futures]
//
// Phases, in order (same discovery-then-enrich shape as optionchain/run.js):
//   1. discovery — NSE+BSE bhavcopy -> option_chain_history EOD rows for
//      every month of the year (reuses optionchain/monthDiscovery.js
//      UNCHANGED — this is what tells dhan/expiryResolver.js which real
//      expiries exist). Free, no Dhan calls.
//   2. index     — minute-level spot (index/VIX securityId, or the stock's
//      own equity securityId) -> ohlcv_data, whole year in one call
//      (chunked internally to Dhan's ~90-day cap).
//   3. options   — dhan/enrichOptions.js, month by month (rollingoption is
//      queried per month to keep each call's response size reasonable).
//   4. futures   — dhan/enrichFutures.js, whole year in one call (daily-only,
//      continuous rolling series — see its header).
//
// Not resumable at the sub-phase level by itself (see runUniverse.js for the
// "check first, delete if present, then full year" driver this project asked
// for — that's the resumable/idempotent layer; every write in this file is
// ON DUPLICATE KEY UPDATE regardless, so a bare re-run is always safe, just
// not cheap since it re-requests everything from Dhan).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { discoverMonth } = require("../optionchain/monthDiscovery");
const enrichIndex = require("./enrichIndex");
const enrichOptions = require("./enrichOptions");
const enrichFutures = require("./enrichFutures");
const instrumentMaster = require("./instrumentMaster");

function parseFlags(argv) {
    const flags = {};
    for (const a of argv) {
        const m = a.match(/^--([a-z-]+)$/);
        if (m) flags[m[1]] = true;
    }
    return flags;
}

async function isIndexSymbol(symbol) {
    const s = symbol.toUpperCase();
    return Object.prototype.hasOwnProperty.call(instrumentMaster.INDEX_SECURITY_IDS, s) && s !== "INDIAVIX";
}

/** Full pipeline for one symbol, one year. Returns a small summary object. */
async function runSymbolYear(symbol, year, flags = {}) {
    const s = symbol.toUpperCase();
    const summary = { symbol: s, year, discoveryRows: 0, indexRows: 0, optionsRows: 0, futuresRows: 0 };

    if (!flags["skip-discovery"]) {
        console.log(`\n=== ${s} ${year} · discovery (bhavcopy) ===`);
        for (let month = 1; month <= 12; month++) {
            const d = await discoverMonth(year, month, { onlySymbols: new Set([s]) });
            summary.discoveryRows += d.rowsStored;
        }
        console.log(`[dhan-run] ${s} ${year}: discovery done, ${summary.discoveryRows} EOD rows`);
    }

    if (!flags["skip-index"]) {
        console.log(`\n=== ${s} ${year} · index/equity minute spot ===`);
        const isIdx = await isIndexSymbol(s);
        const r = isIdx ? await enrichIndex.enrichIndexYear(s, year) : await enrichIndex.enrichEquityYear(s, year);
        summary.indexRows = r.rowsStored;
    }

    if (!flags["skip-options"]) {
        console.log(`\n=== ${s} ${year} · options (rollingoption, month by month) ===`);
        for (let month = 1; month <= 12; month++) {
            const r = await enrichOptions.enrichOptionsMonth(s, year, month);
            summary.optionsRows += r.rowsStored;
        }
    }

    if (!flags["skip-futures"]) {
        console.log(`\n=== ${s} ${year} · futures (daily continuous) ===`);
        const r = await enrichFutures.enrichFuturesYear(s, year);
        summary.futuresRows = r.rowsStored;
    }

    console.log(
        `\n[dhan-run] ${s} ${year} complete — discovery=${summary.discoveryRows} index=${summary.indexRows} options=${summary.optionsRows} futures=${summary.futuresRows}`
    );
    return summary;
}

async function main() {
    const symbol = process.argv[2];
    const year = Number(process.argv[3]);
    const flags = parseFlags(process.argv.slice(4));
    if (!symbol || !Number.isInteger(year) || year < 2015) {
        console.error("Usage: node dhan/run.js <SYMBOL> <YEAR> [--skip-discovery] [--skip-index] [--skip-options] [--skip-futures]");
        process.exit(1);
    }
    await runSymbolYear(symbol, year, flags);
    await pool.end();
}

module.exports = { runSymbolYear, isIndexSymbol };

if (require.main === module) {
    main().catch((err) => {
        console.error("[dhan-run] fatal:", err instanceof Error ? err.stack : String(err));
        process.exit(1);
    });
}
