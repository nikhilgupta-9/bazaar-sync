// futures/verifyMonth.js — phase 3 of futures/run.js.
//
// Per symbol, for one month: did every discovered (symbol, expiry) contract
// get 1-minute data, are the expiries sane, no rows past their own expiry.
// Reports, never mutates.

const { pool } = require("../lib/db");
const { monthBounds, isWeekend } = require("../lib/dates");

const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const EOD_TIME = "15:30:00";

async function verifyMonth(year, month, { onlySymbols = null } = {}) {
    const { first, last } = monthBounds(year, month);

    const [tdRows] = await pool.query(
        `SELECT DISTINCT trade_date FROM futures_history WHERE trade_date BETWEEN ? AND ? ORDER BY trade_date`,
        [first, last]
    );
    const tradingDays = tdRows.map((r) => r.trade_date);

    const [agg] = await pool.query(
        `SELECT symbol,
                COUNT(*) AS rowCount,
                SUM(trade_time <> ?) AS minuteRowCount,
                COUNT(DISTINCT trade_date) AS daysWithData,
                COUNT(DISTINCT expiry) AS expiryCount,
                COUNT(DISTINCT CASE WHEN trade_time <> ? THEN expiry END) AS expiriesWithMinute,
                SUM(trade_date > expiry) AS rowsPastExpiry,
                MIN(trade_time) AS earliestTime,
                MAX(CASE WHEN trade_time <> ? THEN trade_time END) AS latestMinuteTime
         FROM futures_history
         WHERE trade_date BETWEEN ? AND ?
         GROUP BY symbol ORDER BY symbol`,
        [EOD_TIME, EOD_TIME, EOD_TIME, first, last]
    );

    const [expRows] = await pool.query(
        `SELECT symbol, expiry,
                MAX(trade_time <> ?) AS hasMinute,
                COUNT(*) AS rowsForExpiry
         FROM futures_history
         WHERE trade_date BETWEEN ? AND ?
         GROUP BY symbol, expiry ORDER BY symbol, expiry`,
        [EOD_TIME, first, last]
    );
    const expiriesBySymbol = new Map();
    for (const r of expRows) {
        if (!expiriesBySymbol.has(r.symbol)) expiriesBySymbol.set(r.symbol, []);
        expiriesBySymbol.get(r.symbol).push({
            expiry: r.expiry,
            hasMinuteData: Number(r.hasMinute) === 1,
            rows: Number(r.rowsForExpiry),
            weekendExpiry: isWeekend(r.expiry),
        });
    }

    const symbols = [];
    let symbolsPass = 0, symbolsFail = 0;
    for (const row of agg) {
        if (onlySymbols && !onlySymbols.has(row.symbol)) continue;
        const expiryCount = Number(row.expiryCount);
        const expiriesWithMinute = Number(row.expiriesWithMinute);
        const rowsPastExpiry = Number(row.rowsPastExpiry || 0);
        const expiries = expiriesBySymbol.get(row.symbol) || [];
        const weekendExpiries = expiries.filter((e) => e.weekendExpiry).map((e) => e.expiry);
        const contractsMissingMinute = expiryCount - expiriesWithMinute;

        const problems = [];
        if (expiryCount === 0) problems.push("no expiries discovered");
        if (contractsMissingMinute > 0) problems.push(`${contractsMissingMinute}/${expiryCount} expiries have no minute data`);
        if (rowsPastExpiry > 0) problems.push(`${rowsPastExpiry} rows dated after their expiry`);
        if (weekendExpiries.length) problems.push(`expiry on a weekend: ${weekendExpiries.join(", ")}`);

        const pass = problems.length === 0;
        pass ? symbolsPass++ : symbolsFail++;

        symbols.push({
            symbol: row.symbol,
            pass,
            problems,
            daysWithData: Number(row.daysWithData),
            expiryCount,
            expiriesWithMinute,
            contractsMissingMinute,
            minuteCoveragePct: expiryCount ? Math.round((expiriesWithMinute / expiryCount) * 1000) / 10 : 0,
            rowCount: Number(row.rowCount),
            minuteRowCount: Number(row.minuteRowCount || 0),
            rowsPastExpiry,
            earliestTime: row.earliestTime,
            latestMinuteTime: row.latestMinuteTime,
            expiries,
        });
    }

    const [idxDayRows] = await pool.query(
        `SELECT DISTINCT trade_date FROM futures_history
         WHERE trade_date BETWEEN ? AND ? AND symbol IN (?)`,
        [first, last, INDEX_SYMBOLS]
    );
    const idxDays = new Set(idxDayRows.map((r) => r.trade_date));
    const tradingDaysWithoutAnyIndex = tradingDays.filter((d) => !idxDays.has(d));
    const seenSymbols = new Set(symbols.map((s) => s.symbol));
    const indicesMissingEntirely = INDEX_SYMBOLS.filter((s) => !seenSymbols.has(s));

    return {
        year, month, range: { first, last },
        generatedAt: new Date().toISOString(),
        tradingDaysInMonth: tradingDays.length,
        tradingDays,
        summary: {
            symbolsTotal: symbols.length,
            symbolsPass,
            symbolsFail,
            indicesMissingEntirely,
            tradingDaysWithoutAnyIndex,
        },
        symbols,
    };
}

module.exports = { verifyMonth, INDEX_SYMBOLS };
