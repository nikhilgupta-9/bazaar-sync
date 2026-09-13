// services/dataCoverageService.js — the "how much data do we actually have"
// reporting behind the admin Data Coverage / Expiry Status / Greeks
// Coverage pages. Read-only, never mutates option_chain_history/
// futures_history. Everything here is 2023-01 onward per the project's
// current target window (Next Steps: "2023 se aaj tak").
//
// "Expected days per month" is deliberately NOT a hardcoded NSE holiday
// calendar (nobody has entered one, and a wrong one would silently misreport
// coverage) — it's derived from the data itself: whichever symbol has the
// MOST distinct trade_dates in a given month, that count IS the month's
// trading-day reference. Same "derive from data, never fabricate" instinct
// this codebase already applies elsewhere (see nseBhavcopy.js, verifyMonth.js
// in data-downloader/).

const { pool } = require("../config/db");

const COVERAGE_START = "2023-01-01"; // Next Steps target window
const TABLES = { option_chain: "option_chain_history", futures: "futures_history" };
// Each table's (symbol, trade_date, trade_time) index — named differently
// per table (see schema.sql) — used to force the right index for the
// GROUP BY trade_date queries below; see getCoverageDetail's comment for why
// leaving it to the optimizer isn't safe here.
const SYMBOL_DATE_TIME_INDEX = { option_chain_history: "idx_symbol_date_time", futures_history: "idx_fut_symbol_date_time" };

// The 7 indices always shown first/pinned on the coverage & expiry pages,
// regardless of whether they currently have rows — a missing index should
// be loudly visible, not silently absent from a "symbols we found" list.
// Also used (see getMonthlyReference below) to keep the "expected trading
// days" reference query FAST — filtering to these 7 lets it use the
// existing (symbol, trade_date, ...) indexes instead of a full-table scan.
const SEVEN_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];

function tableFor(dataType) {
    const table = TABLES[dataType];
    if (!table) throw Object.assign(new Error(`unknown dataType "${dataType}" (expected option_chain or futures)`), { status: 400 });
    return table;
}

function todaySql() {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
    const d = new Date(istMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Simple in-memory cache (admin-only traffic, low volume) — these are all
// multi-second full-range scans over tens of millions of rows, not something
// to re-run on every page view. 20 min TTL, refresh() available for a manual
// "Refresh" button.
const cache = new Map(); // key -> { at, data }
const TTL_MS = 20 * 60 * 1000;
async function cached(key, loader) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    const data = await loader();
    cache.set(key, { at: Date.now(), data });
    return data;
}
function invalidate(prefix) {
    for (const key of [...cache.keys()]) if (!prefix || key.startsWith(prefix)) cache.delete(key);
}

/** Per-symbol overall stats: first/last date, total rows, distinct days, distinct months with any data. */
async function getCoverageSummary(dataType) {
    const table = tableFor(dataType);
    return cached(`summary:${dataType}`, async () => {
        const today = todaySql();
        const [rows] = await pool.query(
            `SELECT symbol,
                    MIN(trade_date) AS firstDate,
                    MAX(trade_date) AS lastDate,
                    COUNT(*) AS totalRows,
                    SUM(trade_time <> '15:30:00') AS minuteRows,
                    COUNT(DISTINCT trade_date) AS totalDays,
                    COUNT(DISTINCT DATE_FORMAT(trade_date, '%Y-%m')) AS monthsWithData
             FROM ${table}
             WHERE trade_date BETWEEN ? AND ?
             GROUP BY symbol
             ORDER BY symbol`,
            [COVERAGE_START, today]
        );
        return rows.map((r) => ({
            symbol: r.symbol,
            firstDate: r.firstDate,
            lastDate: r.lastDate,
            totalRows: Number(r.totalRows),
            minuteRows: Number(r.minuteRows || 0),
            totalDays: Number(r.totalDays),
            monthsWithData: Number(r.monthsWithData),
        }));
    });
}

/** Every 'YYYY-MM' from 2023-01 through the current month, inclusive. */
function monthList() {
    const [, endM] = todaySql().split("-");
    const endYear = Number(todaySql().slice(0, 4));
    const endMonth = Number(endM);
    const months = [];
    for (let y = 2023; y <= endYear; y++) {
        const lastM = y === endYear ? endMonth : 12;
        for (let m = 1; m <= lastM; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    return months;
}

// Was previously `GROUP BY DATE_FORMAT(trade_date, '%Y-%m'), symbol` with no
// symbol filter — on option_chain_history's tens of millions of rows that's
// a GROUP BY on a computed expression (can't use any index for grouping) PLUS
// a COUNT(DISTINCT trade_date) inside it, which MySQL can only resolve with a
// big on-disk temp table. Measured taking 30s+, and a real run of the "7
// indices only" attempt at fixing this (below) actually EXHAUSTED THE DISK
// with that temp file ("No space left on device", confirmed 2026-09-13) even
// with the smaller symbol set — proof the query shape itself, not just the
// row count, was the problem. Fixed properly this time: group by the RAW
// indexed columns only (symbol, trade_date — exactly idx_symbol_date_time's
// leading columns), which MySQL can stream straight off the index with NO
// filesort/temp table, then bucket the (small: ~7 symbols x ~700 trading
// days) result into months in JS.
async function getMonthlyReference(dataType) {
    const table = tableFor(dataType);
    return cached(`reference:${dataType}`, async () => {
        const [rows] = await pool.query(
            `SELECT symbol, trade_date
             FROM ${table} USE INDEX (${SYMBOL_DATE_TIME_INDEX[table]})
             WHERE symbol IN (?) AND trade_date BETWEEN ? AND ?
             GROUP BY symbol, trade_date`,
            [SEVEN_INDICES, COVERAGE_START, todaySql()]
        );
        const perSymbolMonth = new Map(); // "symbol|ym" -> day count
        for (const r of rows) {
            const key = `${r.symbol}|${r.trade_date.slice(0, 7)}`;
            perSymbolMonth.set(key, (perSymbolMonth.get(key) || 0) + 1);
        }
        const best = new Map(); // ym -> max days across the 7 indices
        for (const [key, days] of perSymbolMonth) {
            const ym = key.split("|")[1];
            if (days > (best.get(ym) || 0)) best.set(ym, days);
        }
        return best;
    });
}

/**
 * Month-by-month grid for ONE symbol, 2023-01 -> current month. Same fix as
 * getMonthlyReference above: group by the raw `trade_date` column (index-
 * ordered once `symbol` is filtered, so no filesort) instead of a computed
 * month expression, and bucket into months in JS — this is the query a
 * symbol click on the Data Coverage page actually triggers, so this one
 * being slow was reported directly as "select a symbol, wait 30s, nothing
 * happens".
 */
async function getCoverageDetail(dataType, symbol) {
    const table = tableFor(dataType);
    const displaySymbol = String(symbol || "").toUpperCase();
    if (!displaySymbol) throw Object.assign(new Error("symbol is required"), { status: 400 });

    // Still a ~9-10s query even index-only, on a table this size (real
    // measurement, 2026-09-13) — cached per symbol so re-clicking the same
    // symbol (very likely — an admin checking back on one gap) is instant.
    const bySymbolMonth = await cached(`detail:${dataType}:${displaySymbol}`, async () => {
        // USE INDEX forces idx_symbol_date_time — left to its own devices the
        // optimizer picked uniq_snapshot instead (probably favored for being
        // UNIQUE), which sorts by (symbol, expiry, strike, trade_date, ...) and
        // so does NOT keep trade_date contiguous for a fixed symbol, forcing a
        // "Using temporary; Using filesort" even on this single-symbol query
        // (confirmed via EXPLAIN, 2026-09-13). idx_symbol_date_time's (symbol,
        // trade_date, trade_time) order makes this a pure index scan instead.
        const [dayRows] = await pool.query(
            `SELECT trade_date, COUNT(*) AS rows_, SUM(trade_time <> '15:30:00') AS minuteRows
             FROM ${table} USE INDEX (${SYMBOL_DATE_TIME_INDEX[table]})
             WHERE symbol = ? AND trade_date BETWEEN ? AND ?
             GROUP BY trade_date`,
            [displaySymbol, COVERAGE_START, todaySql()]
        );
        const byMonth = new Map();
        for (const r of dayRows) {
            const ym = r.trade_date.slice(0, 7);
            const agg = byMonth.get(ym) || { rows_: 0, minuteRows: 0, days: 0 };
            agg.rows_ += Number(r.rows_);
            agg.minuteRows += Number(r.minuteRows || 0);
            agg.days += 1; // one input row per distinct trade_date, by construction
            byMonth.set(ym, agg);
        }
        return byMonth;
    });
    const reference = await getMonthlyReference(dataType);

    return monthList().map((ym) => {
        const r = bySymbolMonth.get(ym);
        const expectedDays = reference.get(ym) || null;
        const days = r ? Number(r.days) : 0;
        return {
            month: ym,
            days,
            expectedDays,
            missingDays: expectedDays != null ? Math.max(0, expectedDays - days) : null,
            rows: r ? Number(r.rows_) : 0,
            minuteRows: r ? Number(r.minuteRows || 0) : 0,
            coveragePct: expectedDays ? Math.round((days / expectedDays) * 1000) / 10 : (days ? 100 : 0),
        };
    });
}

/**
 * Per symbol: does it have data for its nearest current/upcoming expiry, and
 * how stale is its most recent data? redFlag = true when either is missing/
 * stale enough to be a real gap, not just "market's closed today".
 */
async function getExpiryStatus(dataType) {
    const table = tableFor(dataType);
    return cached(`expiry:${dataType}`, async () => {
        const today = todaySql();
        const [lastRows] = await pool.query(
            `SELECT symbol, MAX(trade_date) AS lastDataDate FROM ${table} GROUP BY symbol`
        );
        const [upcomingRows] = await pool.query(
            `SELECT symbol, MIN(expiry) AS nearestExpiry FROM ${table} WHERE expiry >= ? GROUP BY symbol`,
            [today]
        );
        const lastBySymbol = new Map(lastRows.map((r) => [r.symbol, r.lastDataDate]));
        const upcomingBySymbol = new Map(upcomingRows.map((r) => [r.symbol, r.nearestExpiry]));

        const symbols = new Set([...lastBySymbol.keys(), ...upcomingBySymbol.keys(), ...SEVEN_INDICES]);

        const STALE_DAYS = 5; // calendar days — generous enough to cover a long weekend without a false alarm
        const staleCutoff = addDaysSql(today, -STALE_DAYS);

        return [...symbols].sort().map((symbol) => {
            const lastDataDate = lastBySymbol.get(symbol) || null;
            const nearestExpiry = upcomingBySymbol.get(symbol) || null;
            const isIndex = SEVEN_INDICES.includes(symbol);
            const noData = !lastDataDate;
            const stale = lastDataDate && lastDataDate < staleCutoff;
            const noUpcomingExpiry = !nearestExpiry;
            return {
                symbol,
                isIndex,
                lastDataDate,
                nearestExpiry,
                redFlag: noData || stale || noUpcomingExpiry,
                reason: noData ? "no data at all" : noUpcomingExpiry ? "no current/upcoming expiry in the data" : stale ? `last data is from ${lastDataDate} (>${STALE_DAYS} days old)` : null,
            };
        });
    });
}

function addDaysSql(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Option-chain-only: per symbol, what fraction of recent rows have Greeks computed. Futures never carry Greeks by design. */
async function getGreeksCoverage() {
    return cached("greeks", async () => {
        const since = addDaysSql(todaySql(), -90);
        const [rows] = await pool.query(
            `SELECT symbol,
                    COUNT(*) AS totalRows,
                    SUM(ce_delta IS NOT NULL OR pe_delta IS NOT NULL) AS rowsWithGreeks
             FROM option_chain_history
             WHERE trade_date >= ?
             GROUP BY symbol
             ORDER BY symbol`,
            [since]
        );
        return rows.map((r) => {
            const total = Number(r.totalRows);
            const withGreeks = Number(r.rowsWithGreeks || 0);
            return {
                symbol: r.symbol,
                totalRows: total,
                rowsWithGreeks: withGreeks,
                pct: total ? Math.round((withGreeks / total) * 1000) / 10 : 0,
                redFlag: total > 0 && withGreeks === 0,
            };
        });
    });
}

// Pre-computes every cache this file serves, sequentially (not in parallel —
// these are all expensive full/near-full-table scans; running them at once
// would just contend for the same DB connections/IO and take just as long
// while looking busier). Call once at server boot (see server.js) so the
// FIRST admin to open a Data-section page never eats a cold-cache scan —
// exactly the "30s, nothing happened" complaint this file's getMonthlyReference
// comment above describes. Errors are logged, never thrown — a slow/failed
// warm-up must not block server startup; the page just falls back to its
// normal lazy on-demand load.
async function warmCoverageCache() {
    for (const dataType of Object.keys(TABLES)) {
        try {
            await getCoverageSummary(dataType);
            await getMonthlyReference(dataType);
            await getExpiryStatus(dataType);
        } catch (err) {
            console.error(`[dataCoverageService] warm-up failed for ${dataType}:`, err.message);
        }
    }
    try {
        await getGreeksCoverage();
    } catch (err) {
        console.error("[dataCoverageService] Greeks coverage warm-up failed:", err.message);
    }
}

module.exports = {
    COVERAGE_START,
    SEVEN_INDICES,
    getCoverageSummary,
    getCoverageDetail,
    getExpiryStatus,
    getGreeksCoverage,
    invalidateCoverageCache: invalidate,
    warmCoverageCache,
};
