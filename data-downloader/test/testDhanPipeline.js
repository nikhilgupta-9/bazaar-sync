// test/testDhanPipeline.js — small real end-to-end smoke test of the Dhan
// pipeline (dhan/*): runs discovery + index-spot + options + futures for
// ONE symbol and ONE month against the REAL database and REAL Dhan API, with
// a reduced rank/offset scope (via env overrides below) to keep it fast,
// then queries the DB back to prove real rows landed with the right shape.
// Run this before trusting dhan/runUniverse.js on the full universe.
//
// Run: cd data-downloader && node test/testDhanPipeline.js [SYMBOL] [YEAR] [MONTH]

process.env.DHAN_WEEKLY_RANKS = process.env.DHAN_WEEKLY_RANKS || "1";
process.env.DHAN_MONTHLY_RANKS = process.env.DHAN_MONTHLY_RANKS || "1";
process.env.DHAN_INDEX_STRIKE_OFFSETS = process.env.DHAN_INDEX_STRIKE_OFFSETS || "1";
process.env.DHAN_STOCK_STRIKE_OFFSETS = process.env.DHAN_STOCK_STRIKE_OFFSETS || "1";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { discoverMonth } = require("../optionchain/monthDiscovery");
const enrichOptions = require("../dhan/enrichOptions");
const enrichFutures = require("../dhan/enrichFutures");
const historicalService = require("../dhan/historicalService");
const instrumentMaster = require("../dhan/instrumentMaster");

(async () => {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const year = Number(process.argv[3] || 2023);
    const month = Number(process.argv[4] || 1);
    const mm = String(month).padStart(2, "0");
    const first = `${year}-${mm}-01`;
    const last = `${year}-${mm}-28`;

    console.log(`\n=== 1. discovery (bhavcopy) — ${symbol} ${year}-${mm} ===`);
    const d = await discoverMonth(year, month, { onlySymbols: new Set([symbol]) });
    console.log(`discovery: ${d.rowsStored} EOD rows, ${d.daysOk} days ok, ${d.daysFailed} failed`);

    console.log(`\n=== 2. index minute spot — ${symbol} ${first}..${last} ===`);
    const securityId = instrumentMaster.INDEX_SECURITY_IDS[symbol];
    if (securityId) {
        const rows = await historicalService.getIndexIntradayMinutes(securityId, first, last);
        console.log(`fetched ${rows.length} minute candles, sample:`, rows[0], rows[rows.length - 1]);
        const { pool: p } = require("../lib/db");
        const values = rows.map((r) => [symbol, r.date, r.time, r.open, r.high, r.low, r.close, r.volume]);
        for (let i = 0; i < values.length; i += 500) {
            await p.query(
                `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume) VALUES ?
                 ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)`,
                [values.slice(i, i + 500)]
            );
        }
    } else {
        console.log(`${symbol} is not an index — skipping this step in the smoke test (equity path not exercised here)`);
    }

    console.log(`\n=== 3. options (rollingoption, reduced scope: 1 rank, ±1 strike) — ${symbol} ${year}-${mm} ===`);
    const optResult = await enrichOptions.enrichOptionsMonth(symbol, year, month);
    console.log("options result:", optResult);

    console.log(`\n=== 4. futures (daily continuous) — ${symbol} ${year} ===`);
    const futResult = await enrichFutures.enrichFuturesYear(symbol, year);
    console.log("futures result:", futResult);

    console.log(`\n=== 5. VERIFY — query real rows back from the DB ===`);
    const [ohlcvSample] = await pool.query(
        `SELECT trade_date, trade_time, open, high, low, close FROM ohlcv_data WHERE symbol=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date, trade_time LIMIT 3`,
        [symbol, first, last]
    );
    console.log("ohlcv_data sample rows:", ohlcvSample);

    const [optSample] = await pool.query(
        `SELECT trade_date, trade_time, expiry, strike, ce_ltp, ce_iv, pe_ltp, pe_iv, underlying_price
         FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ? AND (ce_ltp IS NOT NULL OR pe_ltp IS NOT NULL)
         AND trade_time <> '15:30:00'
         ORDER BY trade_date, trade_time LIMIT 5`,
        [symbol, first, last]
    );
    console.log("option_chain_history minute-level sample rows (non-EOD, real Dhan-sourced):", optSample);

    const [optCount] = await pool.query(
        `SELECT COUNT(*) AS c FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ? AND trade_time <> '15:30:00'`,
        [symbol, first, last]
    );
    console.log(`total minute-level option rows for ${symbol} ${year}-${mm}: ${optCount[0].c}`);

    const [futSample] = await pool.query(
        `SELECT expiry, trade_date, close, oi FROM futures_history WHERE symbol=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date LIMIT 5`,
        [symbol, first, last]
    );
    console.log("futures_history sample rows:", futSample);

    await pool.end();
})().catch((err) => {
    console.error("PIPELINE TEST FAILED:", err instanceof Error ? err.stack : String(err));
    process.exit(1);
});
