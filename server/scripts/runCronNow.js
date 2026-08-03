// scripts/runCronNow.js — manually trigger services/cron.js's nightly Angel
// One historical pull on demand, instead of waiting for the 23:00 IST
// schedule. Angel One's getCandleData/getOIData work for any date/time range
// up to "now" (not just fully-closed days), so this is safe to run mid-
// session too — it'll just pull whatever candles exist so far today.
//
// Useful for testing the option_chain_history Greeks fix (2026-07-31)
// without waiting for tonight's cron, and generally for backfilling today's
// data on demand if the scheduled run was missed for any reason.
//
// Usage: node scripts/runCronNow.js [SYMBOL ...]   (default: NIFTY BANKNIFTY FINNIFTY)

require("dotenv").config();
const { pool } = require("../config/db");
const cronService = require("../services/cron");
const instrumentMaster = require("../services/instrumentMaster");

async function main() {
    const symbols = process.argv.slice(2).map((s) => s.toUpperCase());
    const targets = symbols.length ? symbols : ["NIFTY", "BANKNIFTY", "FINNIFTY"];
    const dateStr = instrumentMaster.todayIst();

    console.log(`[run-cron-now] pulling ${targets.join(", ")} for ${dateStr} (IST) via Angel One SmartAPI...`);
    for (const symbol of targets) {
        try {
            await cronService.pullSymbolForDate(symbol, dateStr);
            console.log(`[run-cron-now] ${symbol}: done`);
        } catch (err) {
            console.error(`[run-cron-now] ${symbol}: failed — ${err.message}`);
        }
    }
    console.log(`[run-cron-now] complete. Check with: node scripts/showOptionChainHistory.js ${targets[0]} ${dateStr}`);
    await pool.end();
}

main().catch((err) => {
    console.error("[run-cron-now] fatal:", err.message);
    process.exit(1);
});
