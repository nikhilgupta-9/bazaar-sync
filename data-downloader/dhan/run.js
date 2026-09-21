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
// Each phase checks existing dates and requests only missing date ranges.
// Every write is also ON DUPLICATE KEY UPDATE, so an interrupted run is safe
// to resume without deleting or replacing existing rows.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { addDays, dayOfWeek } = require("../lib/dates");
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
        const [optionDates] = await pool.query(
            `SELECT DISTINCT trade_date FROM option_chain_history WHERE symbol = ? AND trade_date >= ? AND trade_date < ? AND trade_time <> '15:30:00' ORDER BY trade_date`,
            [symbol, start, next]
        );
        const [ohlcvDates] = await pool.query(
            `SELECT DISTINCT trade_date FROM ohlcv_data WHERE symbol = ? AND trade_date >= ? AND trade_date < ? AND trade_time <> '15:30:00' ORDER BY trade_date`,
            [symbol, start, next]
        );
        const knownTradingDates = ohlcvDates.length
            ? ohlcvDates.map((row) => row.trade_date)
            : optionDates.map((row) => row.trade_date);
        if (!knownTradingDates.length) {
            for (let date = start; date < next; date = addDays(date, 1)) {
                if (dayOfWeek(date) !== 0 && dayOfWeek(date) !== 6) knownTradingDates.push(date);
            }
        }
        const optionDateSet = new Set(optionDates.map((row) => row.trade_date));
        const missingDates = knownTradingDates.filter((date) => !optionDateSet.has(date));
        return { optionDays, ohlcvDays, combinedDays, missingDates, complete: ohlcvDays > 0 && missingDates.length === 0 && combinedDays >= ohlcvDays };
}

async function missingYearDates(table, symbol, year, minuteOnly = true) {
    const start = `${year}-01-01`;
    const next = `${year + 1}-01-01`;
    const [existing] = await pool.query(
        `SELECT DISTINCT trade_date FROM ${table} WHERE symbol = ? AND trade_date >= ? AND trade_date < ? ${minuteOnly ? "AND trade_time <> '15:30:00'" : ""} ORDER BY trade_date`,
        [symbol, start, next]
    );
    const dates = existing.map((row) => row.trade_date);
    if (!dates.length) {
        for (let date = start; date < next; date = addDays(date, 1)) {
            if (dayOfWeek(date) !== 0 && dayOfWeek(date) !== 6) dates.push(date);
        }
    }
    const existingSet = new Set(existing.map((row) => row.trade_date));
    return dates.filter((date) => !existingSet.has(date));
}

function parseFlags(argv) {
    const flags = {};
    for (const a of argv) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return flags;
}

async function isIndexSymbol(symbol) {
    const s = symbol.toUpperCase();
    return Object.prototype.hasOwnProperty.call(instrumentMaster.INDEX_SECURITY_IDS, s) && s !== "INDIAVIX";
}

/**
 * Full pipeline for one symbol, one year. Returns a small summary object.
 * `flags["from-month"]`/`flags["to-month"]` (1-12, both optional, default
 * the whole year) restrict WHICH months the options loop below processes —
 * the index/equity spot and futures phases are always fetched for the
 * requested date span too (missingYearDates already only fetches what's
 * actually missing, so narrowing to a month range mostly just skips
 * unrelated months' option calls rather than changing what those two
 * phases would have done anyway).
 */
async function runSymbolYear(symbol, year, flags = {}) {
    const s = symbol.toUpperCase();
    const fromMonth = flags["from-month"] ? Number(flags["from-month"]) : 1;
    const toMonth = flags["to-month"] ? Number(flags["to-month"]) : 12;
    const summary = { symbol: s, year, indexRows: 0, optionsRows: 0, futuresRows: 0 };

    if (!flags["skip-index"]) {
        const missingSpotDates = await missingYearDates("ohlcv_data", s, year);
        if (!missingSpotDates.length) {
            console.log(`\n=== ${s} ${year} · index/equity minute spot ===`);
            console.log(`[dhan-run] ${s} ${year}: all OHLCV trading dates already exist — skipping spot fetch`);
        } else {
            console.log(`\n=== ${s} ${year} · index/equity minute spot ===`);
            const isIdx = await isIndexSymbol(s);
            const r = isIdx ? await enrichIndex.enrichIndexYear(s, year, missingSpotDates) : await enrichIndex.enrichEquityYear(s, year, missingSpotDates);
            summary.indexRows = r.rowsStored;
        }
        await coverageSummary.resyncOhlcvYear(s, year);
    }

    if (!flags["skip-options"]) {
        console.log(`\n=== ${s} ${year} · options (rollingoption, month by month${fromMonth !== 1 || toMonth !== 12 ? `, months ${fromMonth}-${toMonth} only` : ""}) ===`);
        for (let month = fromMonth; month <= toMonth; month++) {
            const coverage = await monthMinuteCoverage(s, year, month);
            if (coverage.complete) {
                console.log(`[dhan-run] ${s} ${year}-${String(month).padStart(2, "0")}: option + OHLCV minute data complete (options=${coverage.optionDays} days, combined=${coverage.combinedDays}) — skipping API fetch`);
                // A previous run may have written the raw rows before the
                // compact admin coverage summary was created. Keep the fetch
                // skipped, but repair the summary so Data Coverage shows the
                // month immediately.
                await coverageSummary.resyncOptionMonth(s, year, month);
                continue;
            }
            const mm = String(month).padStart(2, "0");
            const monthStart = `${year}-${mm}-01`;
            const monthEnd = month === 12
                ? `${year}-12-31`
                : `${year}-${String(month + 1).padStart(2, "0")}-01`;

            // SENSEX/BANKEX only: skip months entirely before BSE bhavcopy's
            // real cutover (see instrumentMaster.js's isBeforeBseBhavcopyCutover)
            // instead of running a full discovery+fetch attempt that's
            // guaranteed to end in "no real expiries found" anyway — this was
            // costing several minutes per dead month (many NSE+BSE bhavcopy
            // downloads for the lookahead window) for a known, certain outcome.
            if (instrumentMaster.isBeforeBseBhavcopyCutover(s, monthEnd)) {
                console.log(`[dhan-run] ${s} ${year}-${mm}: skipped — BSE bhavcopy's current format has no real data before ${instrumentMaster.BSE_BHAVCOPY_MIN_DATE} for this symbol (see instrumentMaster.js)`);
                continue;
            }

            // Discover only the current month plus a forward lookahead. The
            // rolling-option API has no calendar-expiry field, but it does
            // not require us to scan the entire year before the first month
            // can be fetched. This lets a fresh run start storing January
            // data immediately and keeps month retries bounded.
            const expiries = await expiryDiscovery.discoverExpiries(s, monthStart, addDays(monthEnd, LOOKAHEAD_DAYS - 1));
            console.log(`[dhan-run] ${s} ${year}-${String(month).padStart(2, "0")}: incomplete minute coverage (options=${coverage.optionDays}, OHLCV=${coverage.ohlcvDays}, combined=${coverage.combinedDays}) — fetching missing option data`);
            const r = await enrichOptions.enrichOptionsMonth(s, year, month, expiries, coverage.missingDates);
            summary.optionsRows += r.rowsStored;
            await coverageSummary.resyncOptionMonth(s, year, month);
        }
    }

    if (!flags["skip-futures"]) {
        console.log(`\n=== ${s} ${year} · futures (daily continuous) ===`);
        let missingFuturesDates = await missingYearDates("futures_history", s, year, false);
        // Same BSE bhavcopy cutover as the options loop above — futures also
        // needs monthly-expiry discovery (enrichFuturesYear shares
        // expiryDiscovery with options), so dates before it would fail the
        // same way. Filtered here rather than inside enrichFuturesYear since
        // this is the one caller that has a whole date LIST to filter
        // (enrichFuturesYear itself just gets a pre-filtered list either way).
        const beforeCutoverCount = missingFuturesDates.filter((d) => instrumentMaster.isBeforeBseBhavcopyCutover(s, d)).length;
        if (beforeCutoverCount) {
            missingFuturesDates = missingFuturesDates.filter((d) => !instrumentMaster.isBeforeBseBhavcopyCutover(s, d));
            console.log(`[dhan-run] ${s} ${year}: skipped ${beforeCutoverCount} date(s) before ${instrumentMaster.BSE_BHAVCOPY_MIN_DATE} (no real BSE bhavcopy data for this symbol that far back)`);
        }
        if (!missingFuturesDates.length) {
            console.log(`[dhan-run] ${s} ${year}: all futures dates already exist — skipping futures fetch`);
        } else {
            // Caught here (not left to bubble up) so one symbol's futures
            // call failing — e.g. Dhan genuinely has no data that far back,
            // a real error seen for real (2026-09-21) — doesn't throw away
            // the index/options work this same call already did for this
            // year, and doesn't read as a fatal error to runUniverse.js's
            // caller (which used to exit(1) the entire multi-symbol run on
            // ANY unexpected error — separately fixed, but this is still the
            // right place to contain a futures-only failure regardless).
            try {
                const r = await enrichFutures.enrichFuturesYear(s, year, missingFuturesDates);
                summary.futuresRows = r.rowsStored;
            } catch (err) {
                console.error(`[dhan-run] ${s} ${year}: futures fetch failed, index/options data above is still saved: ${err.message}`);
            }
        }
    }

    console.log(`\n[dhan-run] ${s} ${year} complete — index=${summary.indexRows} options=${summary.optionsRows} futures=${summary.futuresRows}`);
    return summary;
}

/**
 * Full pipeline for ONE symbol, ONE specific calendar day — e.g. re-fetching
 * a single date that came back gappy without re-scanning its whole month.
 * Unlike runSymbolYear, this does NOT check existing coverage first (no
 * "already complete, skip" short-circuit) — it force-fetches that exact
 * date every time it's called, since the whole point of asking for one
 * specific day is usually "I know something's wrong/missing on this day,
 * get it again." ON DUPLICATE KEY UPDATE (same as everywhere else in this
 * pipeline) means re-fetching an already-good day is harmless, just wasted
 * API calls — cheap for a single day, unlike doing this for a whole year.
 */
async function runSymbolDay(symbol, dateStr, flags = {}) {
    const s = symbol.toUpperCase();
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(5, 7));
    const summary = { symbol: s, date: dateStr, indexRows: 0, optionsRows: 0, futuresRows: 0 };

    if (!flags["skip-index"]) {
        console.log(`\n=== ${s} ${dateStr} · index/equity minute spot ===`);
        const isIdx = await isIndexSymbol(s);
        const r = isIdx ? await enrichIndex.enrichIndexYear(s, year, [dateStr]) : await enrichIndex.enrichEquityYear(s, year, [dateStr]);
        summary.indexRows = r.rowsStored;
    }

    const beforeCutover = instrumentMaster.isBeforeBseBhavcopyCutover(s, dateStr);
    if (beforeCutover) {
        console.log(`\n[dhan-run] ${s} ${dateStr}: options+futures skipped — BSE bhavcopy's current format has no real data before ${instrumentMaster.BSE_BHAVCOPY_MIN_DATE} for this symbol (see instrumentMaster.js)`);
    }

    if (!flags["skip-options"] && !beforeCutover) {
        console.log(`\n=== ${s} ${dateStr} · options (rollingoption) ===`);
        const mm = String(month).padStart(2, "0");
        const monthStart = `${year}-${mm}-01`;
        const monthEnd = month === 12 ? `${year}-12-31` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
        const expiries = await expiryDiscovery.discoverExpiries(s, monthStart, addDays(monthEnd, LOOKAHEAD_DAYS - 1));
        const r = await enrichOptions.enrichOptionsMonth(s, year, month, expiries, [dateStr]);
        summary.optionsRows = r.rowsStored;
        await coverageSummary.resyncOptionMonth(s, year, month);
    }

    if (!flags["skip-futures"] && !beforeCutover) {
        console.log(`\n=== ${s} ${dateStr} · futures (daily continuous) ===`);
        try {
            const r = await enrichFutures.enrichFuturesYear(s, year, [dateStr]);
            summary.futuresRows = r.rowsStored;
        } catch (err) {
            console.error(`[dhan-run] ${s} ${dateStr}: futures fetch failed, index/options data above is still saved: ${err.message}`);
        }
    }

    console.log(`\n[dhan-run] ${s} ${dateStr} complete — index=${summary.indexRows} options=${summary.optionsRows} futures=${summary.futuresRows}`);
    return summary;
}

async function main() {
    const symbol = process.argv[2];
    const flags = parseFlags(process.argv.slice(3));

    if (flags.date) {
        if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(flags.date)) {
            console.error("Usage: node dhan/run.js <SYMBOL> --date=YYYY-MM-DD [--skip-index] [--skip-options] [--skip-futures]");
            process.exit(1);
        }
        await runSymbolDay(symbol, flags.date, flags);
        await pool.end();
        return;
    }

    const year = Number(process.argv[3]);
    if (!symbol || !Number.isInteger(year) || year < 2015) {
        console.error(
            "Usage: node dhan/run.js <SYMBOL> <YEAR> [--from-month=N] [--to-month=N] [--skip-index] [--skip-options] [--skip-futures]\n" +
            "   or: node dhan/run.js <SYMBOL> --date=YYYY-MM-DD [--skip-index] [--skip-options] [--skip-futures]"
        );
        process.exit(1);
    }
    await runSymbolYear(symbol, year, flags);
    await pool.end();
}

module.exports = { runSymbolYear, runSymbolDay, isIndexSymbol };

if (require.main === module) {
    main().catch((err) => {
        console.error("[dhan-run] fatal:", err instanceof Error ? err.stack : String(err));
        process.exit(1);
    });
}
