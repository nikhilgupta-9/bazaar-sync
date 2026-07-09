// Resumable historical backfill for option_chain_history + ohlcv_data.
//
// Usage: node scripts/backfillHistory.js [SYMBOL] [DAYS]
//   SYMBOL - NIFTY | BANKNIFTY | FINNIFTY (default NIFTY)
//   DAYS   - how many past calendar days to backfill (default 7; weekends
//            are skipped automatically since no ohlcv_data will exist for them)
//
// Real limitation, not a bug: this can only backfill expiries that are still
// live-listed right now (needed to discover their strike range via the live
// snapshot endpoint — Breeze has no historical option-chain-listing API).
// A true multi-year backfill needs the NSE securities master file for
// historical strike discovery, which is separate, heavier work (see CLAUDE.md).
// This script is intentionally scoped to "however far back the *current*
// nearest expiry's data goes" — days/weeks, not years.
//
// Resumable: every insert is ON DUPLICATE KEY UPDATE (see cron.js), so
// re-running this script after an interruption just re-upserts safely.

require("dotenv").config();
const breeze = require("../services/breeze");
const cron = require("../services/cron");
const { addDays } = require("../services/backtestEngine");
const { pool } = require("../config/db");

const REQUEST_GAP_MS = 500; // extra-cautious gap between days, on top of cron.js's per-contract gap

// Day-of-week check on a 'YYYY-MM-DD' string, computed via UTC (safe,
// timezone-independent — see backtestEngine.js's addDays comment for why
// this project doesn't do date arithmetic with local-time `Date` methods).
function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function today() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

async function main() {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const days = Number(process.argv[3] || 7);

    console.log(`[backfill] starting ${symbol}, last ${days} calendar days`);
    await breeze.connect();

    const stockCode = breeze.SYMBOL_CODES[symbol];
    if (!stockCode) throw new Error(`Unknown symbol ${symbol}`);

    const { expiries } = await breeze.discoverChain({ stockCode });
    const nearestExpiryApi = expiries[0]; // display format e.g. "07-Jul-2026"
    const expiryApi = breeze.expiryDisplayToApi(nearestExpiryApi);
    const expirySql = breeze.expiryApiToSql(expiryApi);
    console.log(`[backfill] using nearest live expiry: ${nearestExpiryApi} (${expirySql})`);

    const todayStr = today();
    for (let i = days; i >= 0; i--) {
        const dateStr = addDays(todayStr, -i);
        const dow = dayOfWeek(dateStr);
        if (dow === 0 || dow === 6) continue; // skip weekends

        try {
            await cron.pullOHLCVForDate(symbol, dateStr);
            await cron.pullOptionChainForExpiry(symbol, expiryApi, expirySql, dateStr);
            console.log(`[backfill] done ${symbol} ${dateStr}`);
        } catch (err) {
            console.error(`[backfill] failed ${symbol} ${dateStr}:`, err.message);
        }
        await new Promise((r) => setTimeout(r, REQUEST_GAP_MS));
    }

    console.log("[backfill] complete");
    await pool.end();
}

main().catch((err) => {
    console.error("[backfill] fatal:", err);
    process.exit(1);
});
