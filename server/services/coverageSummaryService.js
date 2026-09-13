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

/**
 * Re-aggregates option_chain_coverage_summary for ONE symbol over a bounded
 * date range straight from option_chain_history — the same GROUP BY
 * scripts/backfillCoverageSummary.js uses, just scoped to a range instead of
 * a symbol's whole history (cheap: bounded to that range's rows via
 * idx_backtest_range, not a full-symbol scan).
 *
 * Needed because data-downloader/ (the standalone app behind the admin Data
 * Extraction "ICICI Breeze/Bhavcopy/Upstox" jobs) writes option_chain_history
 * directly with its own DB pool — it has no dependency on this server/ app,
 * so it can never call recordIngested() above. Without this, the summary
 * table silently drifts stale (still showing 0/old counts) for any month an
 * extraction job just fetched, even though the real data landed correctly —
 * confirmed for real (2026-09-13): a job fetched 13 real days of NIFTY
 * Jan-2024 into option_chain_history, but option_chain_coverage_summary kept
 * showing 0 days for that month until this ran. Called from
 * dataDownloaderRunner.js right after a job's process exits successfully.
 */
async function resyncRange(symbol, dateStart, dateEnd) {
    const [rows] = await pool.query(
        `SELECT expiry, trade_date, COUNT(*) AS row_count, SUM(trade_time <> '15:30:00') AS minute_rows
         FROM option_chain_history USE INDEX (idx_backtest_range)
         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
         GROUP BY expiry, trade_date`,
        [symbol, dateStart, dateEnd]
    );
    if (rows.length) {
        const values = rows.map((r) => [symbol, r.expiry, r.trade_date, Number(r.row_count), Number(r.minute_rows || 0)]);
        for (let i = 0; i < values.length; i += 500) {
            const batch = values.slice(i, i + 500);
            await pool.query(
                `INSERT INTO option_chain_coverage_summary (symbol, expiry_date, trade_date, row_count, minute_rows)
                 VALUES ? ON DUPLICATE KEY UPDATE row_count = VALUES(row_count), minute_rows = VALUES(minute_rows)`,
                [batch]
            );
        }
    }
    try {
        require("./dataCoverageService").invalidateCoverageCache();
    } catch (err) {
        console.error("[coverageSummaryService] cache invalidation failed:", err.message);
    }
    return rows.length;
}

module.exports = { recordIngested, recordIngestedFromInsertValues, keysFromInsertValues, resyncRange };
