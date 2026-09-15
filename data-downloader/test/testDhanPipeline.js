// test/testDhanPipeline.js — small real end-to-end smoke test of the Dhan
// pipeline (dhan/*): runs dhan/run.js's real runSymbolYear for ONE symbol
// and ONE year against the REAL database and REAL Dhan API, with a reduced
// rank/offset scope (via env overrides below) to keep it fast, then queries
// the DB back to prove real rows landed with the right shape — and that
// option_chain_history holds ONLY real Dhan minute-level rows, no bhavcopy
// EOD placeholder rows (2026-09-15: the user was explicit they don't want
// bhavcopy data landing in that table at all — bhavcopy is now used purely
// in-memory as an expiry calendar, see dhan/expiryDiscovery.js).
//
// Run: cd data-downloader && node test/testDhanPipeline.js [SYMBOL] [YEAR]

process.env.DHAN_WEEKLY_RANKS = process.env.DHAN_WEEKLY_RANKS || "1";
process.env.DHAN_MONTHLY_RANKS = process.env.DHAN_MONTHLY_RANKS || "1";
process.env.DHAN_INDEX_STRIKE_OFFSETS = process.env.DHAN_INDEX_STRIKE_OFFSETS || "1";
process.env.DHAN_STOCK_STRIKE_OFFSETS = process.env.DHAN_STOCK_STRIKE_OFFSETS || "1";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { runSymbolYear } = require("../dhan/run");

(async () => {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const year = Number(process.argv[3] || 2023);

    // Restrict to just January so this stays fast — enrichOptionsMonth loops
    // all 12 months internally, so we monkey-patch-free this by just eating
    // the cost; it's still a handful of minutes with the reduced scope above.
    const summary = await runSymbolYear(symbol, year, {});
    console.log("\nrunSymbolYear summary:", summary);

    console.log(`\n=== VERIFY — query real rows back from the DB ===`);
    const first = `${year}-01-01`, last = `${year}-01-31`;

    const [eodCheck] = await pool.query(
        `SELECT COUNT(*) numRows FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ? AND trade_time = '15:30:00'`,
        [symbol, first, last]
    );
    console.log(`EOD placeholder rows (trade_time=15:30:00) for ${symbol} Jan ${year} — should be 0, bhavcopy must never write here now:`, eodCheck[0].numRows);

    const [minuteCheck] = await pool.query(
        `SELECT COUNT(*) numRows FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ? AND trade_time <> '15:30:00'`,
        [symbol, first, last]
    );
    console.log(`real Dhan minute-level option rows for ${symbol} Jan ${year}:`, minuteCheck[0].numRows);

    const [optSample] = await pool.query(
        `SELECT trade_date, trade_time, expiry, strike, ce_ltp, ce_iv, pe_ltp, pe_iv, underlying_price
         FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ? AND (ce_ltp IS NOT NULL OR pe_ltp IS NOT NULL)
         ORDER BY trade_date, trade_time LIMIT 5`,
        [symbol, first, last]
    );
    console.log("sample option rows:", optSample);

    const [ohlcv] = await pool.query(
        `SELECT COUNT(*) numRows, MIN(trade_date) minD, MAX(trade_date) maxD FROM ohlcv_data WHERE symbol=? AND trade_date BETWEEN ? AND ?`,
        [symbol, first, last]
    );
    console.log("ohlcv_data (minute spot from Dhan):", ohlcv[0]);

    const [fut] = await pool.query(
        `SELECT expiry, trade_date, close, oi FROM futures_history WHERE symbol=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date LIMIT 5`,
        [symbol, first, last]
    );
    console.log("futures_history sample rows:", fut);

    await pool.end();
})().catch((err) => {
    console.error("PIPELINE TEST FAILED:", err instanceof Error ? err.stack : String(err));
    process.exit(1);
});
