// Resumable historical backfill for option_chain_history + ohlcv_data,
// via Angel One SmartAPI's historical candle/OI APIs.
//
// Usage: node scripts/backfillHistory.js [SYMBOL] [DAYS]
//   SYMBOL - NIFTY | BANKNIFTY | FINNIFTY (default NIFTY)
//   DAYS   - how many past calendar days to backfill (default 7; weekends
//            are skipped automatically)
//
// Real limitation, carried over in spirit from the Breeze days: strike/token
// discovery uses Angel One's *current* instrument master, which only lists
// currently-live contracts. So this reaches back only as far as the current
// nearest expiry's lifetime (days/weeks, not years). A true multi-year
// backfill needs an archived instrument/securities master for historical
// token discovery — separate, heavier work (see CLAUDE.md).
//
// Resumable: every insert is ON DUPLICATE KEY UPDATE (see services/cron.js),
// so re-running after an interruption just re-upserts safely.

require("dotenv").config();
const instrumentMaster = require("../services/instrumentMaster");
const cronService = require("../services/cron");
const { addDays } = require("../services/backtestEngine");
const { pool } = require("../config/db");

const DAY_GAP_MS = 500; // breather between days, on top of the per-request gap

// Day-of-week check on a 'YYYY-MM-DD' string, computed via UTC (safe,
// timezone-independent — see CLAUDE.md Gotcha #12 / backtestEngine.addDays).
function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

async function main() {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const days = Number(process.argv[3] || 7);

    console.log(`[backfill] starting ${symbol}, last ${days} calendar days (Angel One SmartAPI)`);

    const expiries = await instrumentMaster.getExpiries(symbol);
    if (!expiries.length) throw new Error(`No live expiries in scrip master for ${symbol}`);
    const expirySql = expiries[0];
    console.log(`[backfill] using nearest live expiry: ${expirySql}`);

    const todayStr = instrumentMaster.todayIst();
    for (let i = days; i >= 0; i--) {
        const dateStr = addDays(todayStr, -i);
        const dow = dayOfWeek(dateStr);
        if (dow === 0 || dow === 6) continue; // skip weekends

        try {
            await cronService.pullOHLCVForDate(symbol, dateStr);
            await cronService.pullOptionChainForExpiry(symbol, expirySql, dateStr);
            await cronService.backfillUnderlyingPrice(symbol, dateStr);
            console.log(`[backfill] done ${symbol} ${dateStr}`);
        } catch (err) {
            console.error(`[backfill] failed ${symbol} ${dateStr}:`, err.message);
        }
        await new Promise((r) => setTimeout(r, DAY_GAP_MS));
    }

    console.log("[backfill] complete");
    await pool.end();
}

main().catch((err) => {
    console.error("[backfill] fatal:", err);
    process.exit(1);
});
