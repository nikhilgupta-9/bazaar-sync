// breeze-historical/verifyMonth.js — phase 3 of pipelineYear.js.
//
// After discovery (EOD contract universe) + enrich (Breeze 1-minute detail),
// this checks — per symbol, for one calendar month — whether the data that
// SHOULD be there actually is, with special attention to expiry correctness
// ("verify kare ki sara data aya he ki nhi with their expiry").
//
// It reports, never mutates. pipelineYear.js writes the returned object to
// server/data/breeze-pipeline-reports/<year>-<month>.json and prints a
// summary; a human (or a --stop-on-verify-fail flag) decides what to do
// with a failing month.
//
// What "pass" means per symbol:
//   - at least one expiry was discovered
//   - every discovered (expiry, strike) contract has >= 1 minute-level row
//     (trade_time <> '15:30:00'), i.e. Breeze enrichment actually landed
//   - zero rows dated AFTER their own expiry (a real data-integrity bug)
//   - zero expiries landing on a weekend (smells like an expiry parse error)

const { pool } = require("../config/db");
const { monthBounds } = require("./monthDiscovery");

const INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const EOD_TIME = "15:30:00";

function isWeekend(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return dow === 0 || dow === 6;
}

async function verifyMonth(year, month, { onlySymbols = null } = {}) {
    const { first, last } = monthBounds(year, month);

    // The month's actual trading calendar, inferred from the data: any date
    // that got ANY option row from discovery.
    const [tdRows] = await pool.query(
        `SELECT DISTINCT trade_date FROM option_chain_history WHERE trade_date BETWEEN ? AND ? ORDER BY trade_date`,
        [first, last]
    );
    const tradingDays = tdRows.map((r) => r.trade_date);

    // Per-symbol aggregates in one pass.
    const [agg] = await pool.query(
        `SELECT
             symbol,
             COUNT(*) AS rowCount,
             SUM(trade_time <> ?) AS minuteRowCount,
             COUNT(DISTINCT trade_date) AS daysWithData,
             COUNT(DISTINCT expiry) AS expiryCount,
             COUNT(DISTINCT CONCAT(expiry, ':', strike)) AS contractsDiscovered,
             COUNT(DISTINCT CASE WHEN trade_time <> ? THEN CONCAT(expiry, ':', strike) END) AS contractsWithMinute,
             SUM(trade_date > expiry) AS rowsPastExpiry,
             MIN(trade_time) AS earliestTime,
             MAX(CASE WHEN trade_time <> ? THEN trade_time END) AS latestMinuteTime
         FROM option_chain_history
         WHERE trade_date BETWEEN ? AND ?
         GROUP BY symbol
         ORDER BY symbol`,
        [EOD_TIME, EOD_TIME, EOD_TIME, first, last]
    );

    // Distinct expiries per symbol (for the "with their expiry" listing + weekend check).
    const [expRows] = await pool.query(
        `SELECT symbol, expiry, COUNT(DISTINCT strike) AS strikes,
                COUNT(DISTINCT CASE WHEN trade_time <> ? THEN strike END) AS strikesWithMinute
         FROM option_chain_history
         WHERE trade_date BETWEEN ? AND ?
         GROUP BY symbol, expiry
         ORDER BY symbol, expiry`,
        [EOD_TIME, first, last]
    );
    const expiriesBySymbol = new Map();
    for (const r of expRows) {
        if (!expiriesBySymbol.has(r.symbol)) expiriesBySymbol.set(r.symbol, []);
        expiriesBySymbol.get(r.symbol).push({
            expiry: r.expiry,
            strikes: Number(r.strikes),
            strikesWithMinute: Number(r.strikesWithMinute),
            weekendExpiry: isWeekend(r.expiry),
        });
    }

    const symbols = [];
    let symbolsPass = 0, symbolsFail = 0;
    for (const row of agg) {
        if (onlySymbols && !onlySymbols.has(row.symbol)) continue;
        const contractsDiscovered = Number(row.contractsDiscovered);
        const contractsWithMinute = Number(row.contractsWithMinute);
        const rowsPastExpiry = Number(row.rowsPastExpiry || 0);
        const expiries = expiriesBySymbol.get(row.symbol) || [];
        const weekendExpiries = expiries.filter((e) => e.weekendExpiry).map((e) => e.expiry);
        const contractsMissingMinute = contractsDiscovered - contractsWithMinute;

        const problems = [];
        if (Number(row.expiryCount) === 0) problems.push("no expiries discovered");
        if (contractsMissingMinute > 0) problems.push(`${contractsMissingMinute}/${contractsDiscovered} contracts have no minute data`);
        if (rowsPastExpiry > 0) problems.push(`${rowsPastExpiry} rows dated after their expiry`);
        if (weekendExpiries.length) problems.push(`expiry on a weekend: ${weekendExpiries.join(", ")}`);

        const pass = problems.length === 0;
        pass ? symbolsPass++ : symbolsFail++;

        symbols.push({
            symbol: row.symbol,
            pass,
            problems,
            daysWithData: Number(row.daysWithData),
            expiryCount: Number(row.expiryCount),
            contractsDiscovered,
            contractsWithMinute,
            contractsMissingMinute,
            minuteCoveragePct: contractsDiscovered ? Math.round((contractsWithMinute / contractsDiscovered) * 1000) / 10 : 0,
            rowCount: Number(row.rowCount),
            minuteRowCount: Number(row.minuteRowCount || 0),
            rowsPastExpiry,
            earliestTime: row.earliestTime,
            latestMinuteTime: row.latestMinuteTime,
            expiries,
        });
    }

    // Month-level: trading days on which NONE of the 7 indices have data at all.
    const indexSet = new Set(INDEX_SYMBOLS);
    const [idxDayRows] = await pool.query(
        `SELECT DISTINCT trade_date FROM option_chain_history
         WHERE trade_date BETWEEN ? AND ? AND symbol IN (?)`,
        [first, last, INDEX_SYMBOLS]
    );
    const idxDays = new Set(idxDayRows.map((r) => r.trade_date));
    const tradingDaysWithoutAnyIndex = tradingDays.filter((d) => !idxDays.has(d));

    const seenSymbols = new Set(symbols.map((s) => s.symbol));
    const indicesMissingEntirely = INDEX_SYMBOLS.filter((s) => !seenSymbols.has(s));

    return {
        year,
        month,
        range: { first, last },
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
