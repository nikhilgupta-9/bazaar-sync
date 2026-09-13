// services/coverageSummaryService.js — keeps option_chain_coverage_summary
// (schema.sql) in sync with option_chain_history INCREMENTALLY, so
// dataCoverageService.js never has to aggregate the raw ~478M-row table
// again. Every ingestion path (cron.js, backfill*.js, kotak/repo.js,
// dataImportService.js) calls recordIngested() right after its own
// `INSERT INTO option_chain_history ... VALUES ?` — same "read-only vs.
// write" split every other service in this codebase already keeps.
//
// Correctness under re-runs: this deliberately does NOT increment
// row_count by "however many rows this call wrote". A Bhavcopy EOD row
// later upgraded to real Breeze minute data, or the same backfill script
// re-run twice (both explicitly supported/expected elsewhere in this
// codebase — see CLAUDE.md's "no-duplication guarantee" for
// option_chain_history itself), would double-count under a naive
// increment. Instead, for each DISTINCT (symbol, expiry, trade_date) key
// touched in a batch, this re-COUNTs just that key's rows from
// option_chain_history and SETs row_count to the real number — cheap
// (bounded by ~375 rows/day, a point lookup on idx_backtest_range's
// leading 3 columns) and self-correcting no matter how many times
// ingestion re-runs the same day, in any order, from any source.
const { pool } = require("../config/db");

/**
 * values: the exact row arrays already built for
 * `INSERT INTO option_chain_history (...) VALUES ?` — every ingestion path
 * in this codebase builds rows as [symbol, trade_date, trade_time, expiry,
 * strike, ...] (confirmed against cron.js, backfillUpstox.js,
 * backfillBhavcopy(All).js, backfillBseBhavcopyAll.js, kotak/repo.js), so
 * the (symbol, trade_date, expiry) key can be read straight off each row
 * without threading extra parameters through every call site.
 */
function keysFromInsertValues(values) {
    return values.map((row) => ({ symbol: row[0], tradeDate: row[1], expiry: row[3] }));
}

/**
 * keys: [{ symbol, expiry, tradeDate }] (tradeDate/expiry as 'YYYY-MM-DD'
 * strings, per this codebase's Gotcha #12 convention). De-duped internally —
 * a bulk insert of one symbol/expiry/day touches this same key once per
 * strike/minute row, sometimes hundreds of times.
 */
async function recordIngested(keys) {
    if (!keys || !keys.length) return;
    const seen = new Map();
    for (const k of keys) {
        if (!k || !k.symbol || !k.expiry || !k.tradeDate) continue;
        seen.set(`${k.symbol}|${k.expiry}|${k.tradeDate}`, k);
    }
    if (!seen.size) return;

    for (const { symbol, expiry, tradeDate } of seen.values()) {
        await pool.query(
            `INSERT INTO option_chain_coverage_summary (symbol, expiry_date, trade_date, row_count, minute_rows)
             SELECT ?, ?, ?, COUNT(*), SUM(trade_time <> '15:30:00')
             FROM option_chain_history
             WHERE symbol = ? AND expiry = ? AND trade_date = ?
             ON DUPLICATE KEY UPDATE
               row_count = VALUES(row_count),
               minute_rows = VALUES(minute_rows)`,
            [symbol, expiry, tradeDate, symbol, expiry, tradeDate]
        );
    }

    // Invalidate the coverage-page cache lazily (avoids a require cycle —
    // dataCoverageService never needs to import this file back) so the next
    // request re-reads the summary table instead of serving a stale answer
    // for up to the cache's 6h TTL.
    try {
        require("./dataCoverageService").invalidateCoverageCache();
    } catch (err) {
        console.error("[coverageSummaryService] cache invalidation failed:", err.message);
    }
}

/** Convenience for ingestion call sites — records straight off the same `values` array already passed to the INSERT. */
async function recordIngestedFromInsertValues(values) {
    return recordIngested(keysFromInsertValues(values));
}

module.exports = { recordIngested, recordIngestedFromInsertValues, keysFromInsertValues };
