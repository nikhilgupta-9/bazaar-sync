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

/** The "reference" trading-day count per month, derived as the max across every symbol that month. */
async function getMonthlyReference(dataType) {
    const table = tableFor(dataType);
    return cached(`reference:${dataType}`, async () => {
        const [rows] = await pool.query(
            `SELECT DATE_FORMAT(trade_date, '%Y-%m') AS ym, symbol, COUNT(DISTINCT trade_date) AS days
             FROM ${table}
             WHERE trade_date BETWEEN ? AND ?
             GROUP BY ym, symbol`,
            [COVERAGE_START, todaySql()]
        );
        const best = new Map(); // ym -> max days
        for (const r of rows) {
            const cur = best.get(r.ym) || 0;
            if (Number(r.days) > cur) best.set(r.ym, Number(r.days));
        }
        return best;
    });
}

/** Month-by-month grid for ONE symbol, 2023-01 -> current month. */
async function getCoverageDetail(dataType, symbol) {
    const table = tableFor(dataType);
    const displaySymbol = String(symbol || "").toUpperCase();
    if (!displaySymbol) throw Object.assign(new Error("symbol is required"), { status: 400 });

    const [rows] = await pool.query(
        `SELECT DATE_FORMAT(trade_date, '%Y-%m') AS ym,
                COUNT(*) AS rows_,
                SUM(trade_time <> '15:30:00') AS minuteRows,
                COUNT(DISTINCT trade_date) AS days
         FROM ${table}
         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
         GROUP BY ym`,
        [displaySymbol, COVERAGE_START, todaySql()]
    );
    const bySymbolMonth = new Map(rows.map((r) => [r.ym, r]));
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

// The 7 indices always shown first/pinned on the coverage & expiry pages,
// regardless of whether they currently have rows — a missing index should
// be loudly visible, not silently absent from a "symbols we found" list.
const SEVEN_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];

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

module.exports = {
    COVERAGE_START,
    SEVEN_INDICES,
    getCoverageSummary,
    getCoverageDetail,
    getExpiryStatus,
    getGreeksCoverage,
    invalidateCoverageCache: invalidate,
};
