// dhan/run.js — full Dhan pipeline for ONE symbol, ONE calendar year.
//
//   node dhan/run.js <SYMBOL> <YEAR> [--skip-index] [--skip-options] [--skip-futures]
//
// Phases, in order:
//   1. index    — minute-level spot (index/VIX securityId, or the stock's
//      own equity securityId) -> ohlcv_data, whole year in one call
//      (chunked internally to Dhan's ~90-day cap).
//   2. options  — dhan/enrichOptions.js, month by month (rollingoption is
//      queried per month to keep each call's response size reasonable).
//   3. futures  — dhan/enrichFutures.js, whole year in one call (daily-only,
//      continuous rolling series — see its header).
//
// Every one of the above writes ONLY real Dhan-sourced rows into MySQL.
// Dhan's rollingoption response carries no expiry field (see
// dhan/historicalService.js's header), so knowing the real calendar expiry
// for a given rank still needs SOME reference — that comes from
// dhan/expiryDiscovery.js, which reads NSE+BSE bhavcopy PURELY IN MEMORY
// and never writes anything to option_chain_history (an earlier version of
// this pipeline called optionchain/monthDiscovery.js directly, which DOES
// write bhavcopy EOD placeholder rows — the user was explicit (2026-09-15)
// that they want only real Dhan minute data in that table, so this file no
// longer has a "discovery phase" that touches the DB at all before the real
// Dhan calls start).
//
// LOOKAHEAD_DAYS controls how far past Dec 31 the expiry calendar looks —
// needed so DHAN_WEEKLY_RANKS/DHAN_MONTHLY_RANKS worth of December's later
// ranks can resolve to real (possibly next-year) expiries.
//
// Not resumable at the sub-phase level by itself (see runUniverse.js for the
// "check first, delete if present, then full year" driver this project asked
// for — that's the resumable/idempotent layer; every write in this file is
// ON DUPLICATE KEY UPDATE regardless, so a bare re-run is always safe, just
// not cheap since it re-requests everything from Dhan).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { addDays } = require("../lib/dates");
const enrichIndex = require("./enrichIndex");
const enrichOptions = require("./enrichOptions");
const enrichFutures = require("./enrichFutures");
const expiryDiscovery = require("./expiryDiscovery");
const instrumentMaster = require("./instrumentMaster");
const coverageSummary = require("../lib/coverageSummary");

const LOOKAHEAD_DAYS = Number(process.env.DHAN_EXPIRY_LOOKAHEAD_DAYS || 120);

async function monthMinuteCoverage(symbol, year, month) {
        const mm = String(month).padStart(2, "0");
        const start = `${year}-${mm}-01`;
        const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
        const [[option]] = await pool.query(
                `SELECT COUNT(DISTINCT trade_date) AS days
                 FROM option_chain_history
                 WHERE symbol = ? AND trade_date >= ? AND trade_date < ? AND trade_time <> '15:30:00'`,
                [symbol, start, next]
        );
        const [[ohlcv]] = await pool.query(
                `SELECT COUNT(DISTINCT trade_date) AS days
                 FROM ohlcv_data
                 WHERE symbol = ? AND trade_date >= ? AND trade_date < ? AND trade_time <> '15:30:00'`,
                [symbol, start, next]
        );
        const [[combined]] = await pool.query(
                `SELECT COUNT(*) AS days
                 FROM (
                     SELECT DISTINCT trade_date
                     FROM option_chain_history
                     WHERE symbol = ? AND trade_date >= ? AND trade_date < ? AND trade_time <> '15:30:00'
                 ) options_days
                 INNER JOIN (
                     SELECT DISTINCT trade_date
                     FROM ohlcv_data
                     WHERE symbol = ? AND trade_date >= ? AND trade_date < ? AND trade_time <> '15:30:00'
                 ) spot_days USING (trade_date)`,
                [symbol, start, next, symbol, start, next]
        );
        const optionDays = Number(option.days);
        const ohlcvDays = Number(ohlcv.days);
        const combinedDays = Number(combined.days);
        return { optionDays, ohlcvDays, combinedDays, complete: ohlcvDays > 0 && optionDays >= ohlcvDays && combinedDays >= ohlcvDays };
}

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
    const summary = { symbol: s, year, indexRows: 0, optionsRows: 0, futuresRows: 0 };

    if (!flags["skip-index"]) {
        const [[existingSpot]] = await pool.query(
            `SELECT COUNT(*) AS row_count FROM ohlcv_data WHERE symbol = ? AND trade_date BETWEEN ? AND ? AND trade_time <> '15:30:00'`,
            [s, `${year}-01-01`, `${year}-12-31`]
        );
        if (Number(existingSpot.row_count) > 0) {
            console.log(`\n=== ${s} ${year} · index/equity minute spot ===`);
            console.log(`[dhan-run] ${s} ${year}: existing OHLCV minute data found (${existingSpot.row_count} rows) — skipping spot fetch`);
        } else {
            console.log(`\n=== ${s} ${year} · index/equity minute spot ===`);
            const isIdx = await isIndexSymbol(s);
            const r = isIdx ? await enrichIndex.enrichIndexYear(s, year) : await enrichIndex.enrichEquityYear(s, year);
            summary.indexRows = r.rowsStored;
        }
        await coverageSummary.resyncOhlcvYear(s, year);
    }

    if (!flags["skip-options"]) {
        console.log(`\n=== ${s} ${year} · options (rollingoption, month by month) ===`);
        const expiries = await expiryDiscovery.discoverExpiries(s, `${year}-01-01`, addDays(`${year}-12-31`, LOOKAHEAD_DAYS));
        for (let month = 1; month <= 12; month++) {
            const coverage = await monthMinuteCoverage(s, year, month);
            if (coverage.complete) {
                console.log(`[dhan-run] ${s} ${year}-${String(month).padStart(2, "0")}: option + OHLCV minute data complete (options=${coverage.optionDays} days, combined=${coverage.combinedDays}) — skipping API fetch`);
                continue;
            }
            console.log(`[dhan-run] ${s} ${year}-${String(month).padStart(2, "0")}: incomplete minute coverage (options=${coverage.optionDays}, OHLCV=${coverage.ohlcvDays}, combined=${coverage.combinedDays}) — fetching missing option data`);
            const r = await enrichOptions.enrichOptionsMonth(s, year, month, expiries);
            summary.optionsRows += r.rowsStored;
            await coverageSummary.resyncOptionMonth(s, year, month);
        }
    }

    if (!flags["skip-futures"]) {
        console.log(`\n=== ${s} ${year} · futures (daily continuous) ===`);
        const [[existingFutures]] = await pool.query(
            `SELECT COUNT(*) AS row_count FROM futures_history WHERE symbol = ? AND trade_date BETWEEN ? AND ?`,
            [s, `${year}-01-01`, `${year}-12-31`]
        );
        if (Number(existingFutures.row_count) > 0) {
            console.log(`[dhan-run] ${s} ${year}: existing futures data found (${existingFutures.row_count} rows) — skipping futures fetch`);
        } else {
            const r = await enrichFutures.enrichFuturesYear(s, year);
            summary.futuresRows = r.rowsStored;
        }
    }

    console.log(`\n[dhan-run] ${s} ${year} complete — index=${summary.indexRows} options=${summary.optionsRows} futures=${summary.futuresRows}`);
    return summary;
}

async function main() {
    const symbol = process.argv[2];
    const year = Number(process.argv[3]);
    const flags = parseFlags(process.argv.slice(4));
    if (!symbol || !Number.isInteger(year) || year < 2015) {
        console.error("Usage: node dhan/run.js <SYMBOL> <YEAR> [--skip-index] [--skip-options] [--skip-futures]");
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
