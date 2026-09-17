// Incremental coverage summaries for the standalone Dhan downloader.
// The admin app reads these compact tables while a long-running Dhan job is
// still active, so progress is visible before the whole year finishes.
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

// This downloader is its own package/app (see lib/db.js's header — it can
// run on a different machine than server/, pointed at the same DB) but in
// the common case it runs on the SAME machine as the Express server, which
// caches admin-coverage and Simulator-dates reads in memory + on disk for up
// to 6h (see dataCoverageService.js / simulatorController.js). Writing
// straight to MySQL from here, as this file does, leaves that server
// process with no way to know new rows landed — it keeps serving stale
// "data available"/"selectable date" answers for up to 6h. Touching these
// marker files (mirrors dataCoverageService.js's own INVALIDATION_FILE
// mechanism) lets the server notice on its next request instead. Best-effort
// only: on a different-machine deployment these paths just don't exist and
// the writes silently no-op, falling back to the plain 6h TTL.
const SERVER_DATA_DIR = path.join(__dirname, "..", "..", "server", "data");
const COVERAGE_MARKER = path.join(SERVER_DATA_DIR, "data-coverage-cache.invalidated");
const SIMULATOR_DATES_MARKER = path.join(SERVER_DATA_DIR, "simulator-dates-cache.invalidated");
// A full universe run calls resyncOptionMonth up to ~12x/symbol/year (only
// for incomplete months) across ~215 symbols x several years — thousands of
// calls. Touching the marker on every single one would force the live
// server to pay its ~3s full-table rescan (see simulatorController.js's
// computeDatesPayload) on almost every Simulator request while a backfill
// is running. Rate-limited so the server still catches up quickly (well
// under its 6h TTL) without being hammered.
const MARKER_MIN_INTERVAL_MS = 60 * 1000;
let lastMarkerTouch = 0;

function touchInvalidationMarkers() {
    const now = Date.now();
    if (now - lastMarkerTouch < MARKER_MIN_INTERVAL_MS) return;
    lastMarkerTouch = now;
    for (const file of [COVERAGE_MARKER, SIMULATOR_DATES_MARKER]) {
        try {
            fs.writeFileSync(file, String(now));
        } catch {
            /* different machine than the server, or server/data/ not present — fine, TTL still applies */
        }
    }
}

function monthBounds(year, month) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    return { start, next };
}

async function resyncOptionMonth(symbol, year, month) {
    const { start, next } = monthBounds(year, month);
    await pool.query(
        `INSERT INTO option_chain_coverage_summary
           (symbol, expiry_date, trade_date, row_count, minute_rows)
         SELECT symbol, expiry, trade_date, COUNT(*), SUM(trade_time <> '15:30:00')
         FROM option_chain_history
         WHERE symbol = ? AND trade_date >= ? AND trade_date < ?
         GROUP BY symbol, expiry, trade_date
         ON DUPLICATE KEY UPDATE row_count = VALUES(row_count), minute_rows = VALUES(minute_rows)`,
        [symbol, start, next]
    );
    touchInvalidationMarkers();
}

async function resyncOhlcvYear(symbol, year) {
    const start = `${year}-01-01`, next = `${year + 1}-01-01`;
    await pool.query(
        `INSERT INTO ohlcv_coverage_summary
           (symbol, trade_date, row_count, minute_rows, first_time, last_time)
         SELECT symbol, trade_date, COUNT(*), SUM(trade_time <> '15:30:00'), MIN(trade_time), MAX(trade_time)
         FROM ohlcv_data
         WHERE symbol = ? AND trade_date >= ? AND trade_date < ?
         GROUP BY symbol, trade_date
         ON DUPLICATE KEY UPDATE row_count = VALUES(row_count), minute_rows = VALUES(minute_rows),
           first_time = VALUES(first_time), last_time = VALUES(last_time)`,
        [symbol, start, next]
    );
    touchInvalidationMarkers();
}

module.exports = { resyncOptionMonth, resyncOhlcvYear };
