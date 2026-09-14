// dhan/enrichIndex.js — minute-level spot history for the 7 indices, India
// VIX, and each F&O stock's own equity price, all confirmed working back to
// at least Jan 2023 via /charts/intraday (see historicalService.js header).
// Stores into ohlcv_data — the SAME table Angel One's cron.js and Upstox's
// enrich.js already write to (symbol, trade_date, trade_time unique key), so
// this is additive/upserting, never a second table.

const { pool } = require("../lib/db");
const instrumentMaster = require("./instrumentMaster");
const historicalService = require("./historicalService");

const INSERT_BATCH_SIZE = 500;

async function storeOhlcvRows(symbol, rows) {
    if (!rows.length) return 0;
    const values = rows.map((r) => [symbol, r.date, r.time, r.open, r.high, r.low, r.close, r.volume]);
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
        const batch = values.slice(i, i + INSERT_BATCH_SIZE);
        await pool.query(
            `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
             VALUES ?
             ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)`,
            [batch]
        );
    }
    return values.length;
}

/** One index (or INDIAVIX) for a full year, minute-level. */
async function enrichIndexYear(symbol, year) {
    const securityId = instrumentMaster.INDEX_SECURITY_IDS[symbol.toUpperCase()];
    if (!securityId) {
        console.warn(`[dhan-index] ${symbol}: not one of the 7 indices / INDIAVIX — skipped`);
        return { rowsStored: 0 };
    }
    const rows = await historicalService.getIndexIntradayMinutes(securityId, `${year}-01-01`, `${year}-12-31`);
    const stored = await storeOhlcvRows(symbol.toUpperCase(), rows);
    console.log(`[dhan-index] ${symbol} ${year}: ${stored} minute rows stored`);
    return { rowsStored: stored };
}

/** One F&O stock's own spot price for a full year, minute-level. */
async function enrichEquityYear(symbol, year) {
    const securityId = await instrumentMaster.resolveEquitySecurityId(symbol);
    if (!securityId) {
        console.warn(`[dhan-index] ${symbol}: no Dhan EQUITY securityId found — skipped`);
        return { rowsStored: 0 };
    }
    const rows = await historicalService.getEquityIntradayMinutes(securityId, `${year}-01-01`, `${year}-12-31`);
    const stored = await storeOhlcvRows(symbol.toUpperCase(), rows);
    console.log(`[dhan-index] ${symbol} ${year}: ${stored} minute rows stored (equity spot)`);
    return { rowsStored: stored };
}

module.exports = { enrichIndexYear, enrichEquityYear };
