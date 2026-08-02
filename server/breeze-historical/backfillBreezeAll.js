// breeze-historical/backfillBreezeAll.js — multi-symbol wrapper around
// backfillBreeze.js's per-symbol logic. Loops over every symbol already
// discovered by scripts/backfillBhavcopy(All).js (all NSE indices + every
// F&O-eligible stock — the "7 index + 210 companies" universe, whatever it
// actually is on a given day, read from the DB rather than hardcoded).
//
// Breeze's real limit is 5,000 calls/day (rateLimiter.js, 4,800 w/ margin) —
// with ~200+ symbols this WILL take many days to fully enrich a multi-year
// range at minute-level. That's a hard fact of ICICI's own rate limit, not a
// bug here. This script is built to be interrupted and resumed indefinitely:
// - it always processes symbols in the same order (alphabetical), so a run
//   that stops (budget exhausted, or Ctrl+C) picks back up near where it left
//   off next time, since earlier symbols are skipped instantly (already
//   enriched, see isAlreadyEnriched in backfillBreeze.js)
// - the moment rateLimiter signals the daily budget is spent, this script
//   exits cleanly (not a crash) — cron/a shell loop can just re-run it daily
//
// Usage: node breeze-historical/backfillBreezeAll.js [FROM_DATE] [TO_DATE]
//   Same date defaults as backfillBreeze.js (~6mo-3yr back from today).

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const instrumentMaster = require("../services/instrumentMaster");
const rateLimiter = require("./rateLimiter");
const { backfillSymbol } = require("./backfillBreeze");

async function main() {
    const today = instrumentMaster.todayIst();
    // Args are [FROM_DATE] [TO_DATE], matching the header comment above.
    const toDate = process.argv[3] || addDays(today, -180);
    const fromDate = process.argv[2] || addDays(toDate, -365 * 3);

    const [rows] = await pool.query(
        `SELECT DISTINCT symbol FROM option_chain_history WHERE trade_date BETWEEN ? AND ? ORDER BY symbol`,
        [fromDate, toDate]
    );
    const symbols = rows.map((r) => r.symbol);

    console.log(`[breeze-all] ${symbols.length} symbols found in option_chain_history for ${fromDate}..${toDate}`);
    console.log(`[breeze-all] daily budget remaining today: ${rateLimiter.remainingToday()}`);
    if (!symbols.length) {
        console.log("[breeze-all] nothing to do — run scripts/backfillBhavcopyAll.js for this range first.");
        await pool.end();
        return;
    }

    let symbolsDone = 0, symbolsSkipped = 0, totalRows = 0, totalFailed = 0;
    for (const symbol of symbols) {
        try {
            const result = await backfillSymbol(symbol, fromDate, toDate);
            totalRows += result.rowsStored;
            totalFailed += result.contractsFailed;
            if (!result.contractsTotal) {
                symbolsSkipped += 1;
            } else if (result.contractsSkipped === result.contractsTotal) {
                symbolsSkipped += 1;
                console.log(`[breeze-all] ${symbol}: already fully enriched (${result.contractsTotal} contracts) — skipped`);
            } else {
                symbolsDone += 1;
                console.log(
                    `[breeze-all] ${symbol}: ${result.contractsTotal} contracts (${result.contractsSkipped} already done), ${result.rowsStored} rows stored, ${result.contractsFailed} failed`
                );
            }
        } catch (err) {
            if (/daily call budget spent/.test(err.message)) {
                console.log(`[breeze-all] ${err.message}`);
                console.log(
                    `[breeze-all] stopping here — processed ${symbolsDone} symbols this run (${symbolsSkipped} were already done), ${totalRows} rows stored. Re-run this same command tomorrow (or anytime), already-enriched contracts are skipped automatically.`
                );
                await pool.end();
                return;
            }
            console.error(`[breeze-all] ${symbol}: unexpected error: ${err.message}`);
        }
    }

    console.log(`[breeze-all] ALL symbols processed. symbols enriched=${symbolsDone}, already-done=${symbolsSkipped}, total rows stored=${totalRows}, total contract failures=${totalFailed}`);
    console.log(`[breeze-all] budget remaining today: ${rateLimiter.remainingToday()}`);
    await pool.end();
}

main().catch((err) => {
    console.error("[breeze-all] fatal:", err.message);
    process.exit(1);
});
