// scripts/testAngelHistorical.js — ONE single historical candle call, to
// safely check whether Angel One's historical-API rate-limit cooldown
// (hit 2026-07-31, see services/angelOneHistorical.js's comment) has
// cleared, WITHOUT risking another 403 storm the way running the full
// backfillHistory.js / runCronNow.js would if the block is still active.
//
// Usage: node scripts/testAngelHistorical.js [SYMBOL]   (default NIFTY)

require("dotenv").config();
const { pool } = require("../config/db");
const instrumentMaster = require("../services/instrumentMaster");
const angelHist = require("../services/angelOneHistorical");

async function main() {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const dateStr = instrumentMaster.todayIst();
    const token = instrumentMaster.getIndexToken(symbol);
    if (!token) throw new Error(`No index token for ${symbol}`);

    console.log(`[test] single getCandleData call: ${symbol} (token ${token}) for ${dateStr}...`);
    try {
        const candles = await angelHist.getDayCandles({ exchange: "NSE", symboltoken: token, dateStr });
        console.log(`[test] SUCCESS — ${candles.length} candles returned. The rate-limit cooldown has cleared, safe to run the full backfill now.`);
    } catch (err) {
        console.log(`[test] STILL BLOCKED — ${err.message}`);
        console.log(`[test] Do not run the full backfill yet. Wait longer and re-run this single test again.`);
    }
    await pool.end();
}

main().catch((err) => {
    console.error("[test] fatal:", err.message);
    process.exit(1);
});
