// scripts/backfillCoverageSummary.js — ONE-TIME population of
// option_chain_coverage_summary from the existing option_chain_history data.
//
// Why this is needed: services/coverageSummaryService.js keeps the summary
// table in sync going forward (every new ingestion write upserts its own
// (symbol, expiry, trade_date) key), but it has no way to know about rows
// that were already in option_chain_history BEFORE this feature existed —
// that history has to be aggregated once, here, to seed the table.
//
// Deliberately NOT a single ungrouped query. `GROUP BY symbol, expiry,
// trade_date` with no WHERE clause would still have to scan all ~478M index
// entries in one go (confirmed via EXPLAIN — see the PR/commit notes this
// script shipped with). Looping per symbol instead means each query is
// `WHERE symbol = ?` against idx_backtest_range (symbol, expiry, trade_date,
// trade_time) — MySQL can seek straight to that symbol's own index range
// instead of touching every other symbol's rows, AND it makes this
// interruptible/resumable (kill it any time; a re-run just re-upserts
// symbols it already did — safe, since SET row_count=<recomputed count> is
// idempotent, never an increment).
//
// Usage:
//   node scripts/backfillCoverageSummary.js            # every known symbol
//   node scripts/backfillCoverageSummary.js NIFTY       # one symbol only
//
// This is read-heavy on option_chain_history (one indexed range scan per
// symbol) and write-light on the new summary table (a few hundred rows per
// symbol at most) — safe to run alongside normal traffic, but on a table
// this size expect it to take real minutes overall (seconds per liquid
// index symbol, likely longer for symbols with years of minute-level F&O
// stock data). Progress is logged per symbol so it's never a silent black
// box.

require("dotenv").config();
const { pool } = require("../config/db");
const optionChainService = require("../services/optionChainService");

const UPSERT_BATCH = 500;

async function backfillSymbol(symbol) {
    const [rows] = await pool.query(
        `SELECT expiry, trade_date, COUNT(*) AS row_count, SUM(trade_time <> '15:30:00') AS minute_rows
         FROM option_chain_history USE INDEX (idx_backtest_range)
         WHERE symbol = ?
         GROUP BY expiry, trade_date`,
        [symbol]
    );
    if (!rows.length) return 0;

    const values = rows.map((r) => [symbol, r.expiry, r.trade_date, Number(r.row_count), Number(r.minute_rows || 0)]);
    for (let i = 0; i < values.length; i += UPSERT_BATCH) {
        const batch = values.slice(i, i + UPSERT_BATCH);
        await pool.query(
            `INSERT INTO option_chain_coverage_summary (symbol, expiry_date, trade_date, row_count, minute_rows)
             VALUES ?
             ON DUPLICATE KEY UPDATE
               row_count = VALUES(row_count),
               minute_rows = VALUES(minute_rows)`,
            [batch]
        );
    }
    return rows.length;
}

async function main() {
    const onlySymbol = process.argv[2] ? process.argv[2].toUpperCase() : null;
    let symbols;
    if (onlySymbol) {
        symbols = [onlySymbol];
    } else {
        const { indices = [], stocks = [] } = await optionChainService.listSymbols();
        symbols = [...indices, ...stocks];
    }

    console.log(`[backfillCoverageSummary] ${symbols.length} symbol(s) to process`);
    const t0 = Date.now();
    let totalKeys = 0;
    for (const [i, symbol] of symbols.entries()) {
        const st = Date.now();
        const keys = await backfillSymbol(symbol);
        totalKeys += keys;
        console.log(
            `[backfillCoverageSummary] (${i + 1}/${symbols.length}) ${symbol}: ${keys} (expiry, trade_date) rows in ${Date.now() - st}ms`
        );
    }
    console.log(`[backfillCoverageSummary] done — ${totalKeys} summary rows across ${symbols.length} symbols in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await pool.end();
}

main().catch((err) => {
    console.error("[backfillCoverageSummary] failed:", err);
    process.exit(1);
});
