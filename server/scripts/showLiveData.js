// scripts/showLiveData.js — quick visibility into whether the market worker
// is ACTUALLY writing to MySQL right now, not just feeding the in-memory
// cache. /health's `liveCache` block only proves the worker→IPC→cache path
// is alive; it says nothing about workers/databaseWriter.js's buffered
// writes actually landing in the 5 Phase 6 live tables. This checks those
// tables directly, for today's date.
//
// Usage: node scripts/showLiveData.js [SYMBOL]   (SYMBOL optional, default NIFTY)

require("dotenv").config();
const { pool } = require("../config/db");

function todayIst() {
    // Same rule as everywhere else (CLAUDE.md Gotcha #12) — no local Date()
    // parsing. IST = UTC+5:30.
    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
}

async function checkTable(label, sql, params) {
    const [rows] = await pool.query(sql, params);
    const r = rows[0];
    const count = Number(r.cnt);
    if (!count) {
        console.log(`${label.padEnd(24)} 0 rows today — nothing written yet`);
        return;
    }
    console.log(
        `${label.padEnd(24)} ${String(count).padStart(6)} rows today` +
            (r.lastTime ? `, latest snapshot: ${r.lastTime}` : "")
    );
}

async function main() {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const today = todayIst();
    console.log(`Checking live_* tables for ${symbol} on ${today} (IST)\n`);

    await checkTable(
        "live_index_ticks",
        `SELECT COUNT(*) AS cnt, MAX(tick_time) AS lastTime FROM live_index_ticks WHERE symbol = ? AND tick_date = ?`,
        [symbol, today]
    );
    await checkTable(
        "live_option_ticks",
        `SELECT COUNT(*) AS cnt, MAX(tick_time) AS lastTime FROM live_option_ticks WHERE underlying = ? AND tick_date = ?`,
        [symbol, today]
    );
    await checkTable(
        "live_greeks_snapshots",
        `SELECT COUNT(*) AS cnt, MAX(snap_time) AS lastTime FROM live_greeks_snapshots WHERE underlying = ? AND snap_date = ?`,
        [symbol, today]
    );
    await checkTable(
        "pcr_snapshots",
        `SELECT COUNT(*) AS cnt, MAX(snap_time) AS lastTime FROM pcr_snapshots WHERE symbol = ? AND snap_date = ?`,
        [symbol, today]
    );
    await checkTable(
        "oi_summary_snapshots",
        `SELECT COUNT(*) AS cnt, MAX(snap_time) AS lastTime FROM oi_summary_snapshots WHERE symbol = ? AND snap_date = ?`,
        [symbol, today]
    );

    console.log(
        `\nIf all 5 show 0, the worker's feed/cache path is alive (per /health) but ` +
            `workers/databaseWriter.js's buffered writes aren't landing — check server/logs/database.log ` +
            `and server/logs/error.log for write failures. If counts are growing on repeat runs, storage is confirmed working.`
    );

    await pool.end();
}

main().catch((err) => {
    console.error("[show-live-data] fatal:", err.message);
    process.exit(1);
});
