// Rebuild the small admin coverage tables from existing raw data.
// Run outside the request path after creating the summary tables:
//   node scripts/rebuildCoverageSummaries.js option-chain
//   node scripts/rebuildCoverageSummaries.js ohlcv
//   node scripts/rebuildCoverageSummaries.js all
//
// This is intentionally an explicit maintenance command. It may scan a large
// table once, but subsequent admin reads use the compact summary tables.

require("dotenv").config();
const { pool } = require("../config/db");

const mode = process.argv[2] || "all";
if (!["option-chain", "ohlcv", "all"].includes(mode)) {
    console.error("Usage: node scripts/rebuildCoverageSummaries.js option-chain|ohlcv|all");
    process.exit(1);
}

async function rebuildOptionChain() {
    console.log("[coverage] rebuilding option_chain_coverage_summary...");
    const [symbols] = await pool.query("SELECT DISTINCT symbol FROM option_chain_history ORDER BY symbol");
    const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const endYear = today.getUTCFullYear();
    let batches = 0;
    for (const { symbol } of symbols) {
        for (let year = 2023; year <= endYear; year++) {
            for (let month = 1; month <= 12; month++) {
                if (year === endYear && month > today.getUTCMonth() + 1) break;
                const start = `${year}-${String(month).padStart(2, "0")}-01`;
                const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
                await pool.query(
                    `INSERT INTO option_chain_coverage_summary
                       (symbol, expiry_date, trade_date, row_count, minute_rows)
                     SELECT symbol, expiry, trade_date, COUNT(*), SUM(trade_time <> '15:30:00')
                     FROM option_chain_history
                     WHERE symbol = ? AND trade_date >= ? AND trade_date < ?
                     GROUP BY symbol, expiry, trade_date
                     ON DUPLICATE KEY UPDATE
                       row_count = VALUES(row_count), minute_rows = VALUES(minute_rows)`,
                    [symbol, start, nextMonth]
                );
                batches += 1;
            }
        }
        console.log(`[coverage] option-chain summary: ${symbol} complete (${batches} batches)`);
    }
    console.log("[coverage] option-chain summary rebuilt.");
}

async function rebuildOhlcv() {
    console.log("[coverage] rebuilding ohlcv_coverage_summary...");
    await pool.query(
        `INSERT INTO ohlcv_coverage_summary
           (symbol, trade_date, row_count, minute_rows, first_time, last_time)
         SELECT symbol, trade_date, COUNT(*), SUM(trade_time <> '15:30:00'), MIN(trade_time), MAX(trade_time)
         FROM ohlcv_data
         GROUP BY symbol, trade_date
         ON DUPLICATE KEY UPDATE
           row_count = VALUES(row_count), minute_rows = VALUES(minute_rows),
           first_time = VALUES(first_time), last_time = VALUES(last_time)`
    );
    console.log("[coverage] OHLCV summary rebuilt.");
}

(async () => {
    try {
        if (mode === "option-chain" || mode === "all") await rebuildOptionChain();
        if (mode === "ohlcv" || mode === "all") await rebuildOhlcv();
        // This script writes straight to the summary tables from its own
        // process, bypassing the Express admin server entirely — the running
        // server's in-memory admin-coverage cache AND Simulator dates cache
        // have no way to know new rows landed. Without this, both silently
        // serve stale data (up to their 6h TTL) after a rebuild — this is
        // the exact "DB has the data, live API doesn't show it" gap found
        // 2026-09-17 while comparing admin coverage counts against the
        // Simulator's selectable-date rule (BANKNIFTY Jan-Apr 2023).
        try {
            require("../services/dataCoverageService").invalidateCoverageCache();
            require("../controllers/simulatorController").invalidateDatesCache();
            console.log("[coverage] cross-process cache invalidation markers written (admin coverage + simulator dates).");
        } catch (err) {
            console.error("[coverage] cache invalidation failed (rebuilt data itself is fine):", err.message);
        }
    } catch (err) {
        console.error("[coverage] rebuild failed:", err.stack || err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
