// services/dataExportService.js — CSV export + delete for the admin Data
// Export page: pick a symbol + year (optionally a month range), download its
// option_chain_history / futures_history / ohlcv_data rows as CSV, then
// optionally delete those same rows from MySQL. This is the "make the data
// portable to a local drive, then reclaim DB space" workflow the user asked
// for (2026-09-21) — export and delete are deliberately SEPARATE actions
// (never combined into one call) so a failed/cancelled download can never
// result in data that's gone from both the DB and the user's disk.
//
// Both streamCsv and deleteRows use KEYSET pagination (WHERE id > lastId
// ORDER BY id LIMIT N), not OFFSET — these tables can hold millions of rows
// per symbol (see CLAUDE.md's own notes on option_chain_history), and an
// OFFSET-based scan gets quadratically slower as it goes. Delete also runs
// in bounded batches for the same reason `cleanBeforeFetch` avoids one giant
// DELETE on a large table: many small transactions instead of one long lock.

const { pool } = require("../config/db");
const { monthRange } = require("./extractionCleanupService");

const CHUNK_SIZE = 20000;
const DELETE_BATCH_SIZE = 10000;

// Explicit column lists (not `SELECT *`) — deliberately excludes `id`
// (an internal auto-increment key, meaningless once exported) and
// `created_at` (ingestion bookkeeping, not market data) from the CSV.
const TABLES = {
    option_chain: {
        table: "option_chain_history",
        label: "Option Chain",
        columns: [
            "symbol", "trade_date", "trade_time", "expiry", "strike", "underlying_price",
            "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
            "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega",
        ],
    },
    futures: {
        table: "futures_history",
        label: "Futures",
        columns: ["symbol", "expiry", "trade_date", "trade_time", "open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
    },
    ohlcv: {
        table: "ohlcv_data",
        label: "OHLCV / Spot",
        columns: ["symbol", "trade_date", "trade_time", "open", "high", "low", "close", "volume"],
    },
};

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function resolveRange({ year, fromMonth, toMonth }) {
    if (!Number.isInteger(Number(year)) || Number(year) < 2000) throw badRequest("a valid year is required");
    return monthRange(Number(year), fromMonth ? Number(fromMonth) : null, toMonth ? Number(toMonth) : null);
}

function resolveTableTypes(dataType) {
    if (dataType === "all") return Object.keys(TABLES);
    if (!TABLES[dataType]) throw badRequest(`unknown dataType "${dataType}" — must be one of: all, ${Object.keys(TABLES).join(", ")}`);
    return [dataType];
}

/** Row counts per table for the given (symbol, year/month-range) — used by the admin UI to show "N rows will be exported/deleted" before either action runs. */
async function countRows({ symbol, dataType, year, fromMonth, toMonth }) {
    if (!symbol) throw badRequest("symbol is required");
    const { start, end } = resolveRange({ year, fromMonth, toMonth });
    const types = resolveTableTypes(dataType);
    const counts = {};
    for (const type of types) {
        const { table } = TABLES[type];
        const [[row]] = await pool.query(`SELECT COUNT(*) AS c FROM ${table} WHERE symbol = ? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
        counts[type] = Number(row.c);
    }
    return { start, end, counts };
}

function csvEscape(value) {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Writes one table's CSV rows for (symbol, start, end) directly to `res` in bounded chunks — never holds the full result set in memory (see file header on why, and CLAUDE.md's own heap-OOM lesson from the Dhan pipeline's unbounded dayCache). Always writes a header line, even for zero rows. */
async function writeTableCsv(res, type, symbol, start, end) {
    const { table, columns } = TABLES[type];
    res.write(columns.join(",") + "\n");
    let lastId = 0;
    for (;;) {
        const [rows] = await pool.query(
            `SELECT id, ${columns.join(", ")} FROM ${table} WHERE symbol = ? AND trade_date BETWEEN ? AND ? AND id > ? ORDER BY id LIMIT ?`,
            [symbol, start, end, lastId, CHUNK_SIZE]
        );
        if (!rows.length) break;
        for (const row of rows) {
            res.write(columns.map((c) => csvEscape(row[c])).join(",") + "\n");
        }
        lastId = rows[rows.length - 1].id;
        if (rows.length < CHUNK_SIZE) break;
    }
}

/**
 * Deletes (symbol, year/month-range) rows for the given table type(s), in
 * bounded batches rather than one giant DELETE. Returns the total deleted
 * per table. Caller (the controller) is responsible for requiring the user
 * already downloaded the export — this function itself has no way to know
 * that and does not attempt to verify it (see file header: export and
 * delete are deliberately separate, trust-the-caller actions).
 */
async function deleteRows({ symbol, dataType, year, fromMonth, toMonth }) {
    if (!symbol) throw badRequest("symbol is required");
    const { start, end } = resolveRange({ year, fromMonth, toMonth });
    const types = resolveTableTypes(dataType);
    const deleted = {};
    for (const type of types) {
        const { table } = TABLES[type];
        let total = 0;
        for (;;) {
            const [result] = await pool.query(
                `DELETE FROM ${table} WHERE symbol = ? AND trade_date BETWEEN ? AND ? LIMIT ?`,
                [symbol, start, end, DELETE_BATCH_SIZE]
            );
            total += result.affectedRows;
            if (result.affectedRows < DELETE_BATCH_SIZE) break;
        }
        deleted[type] = total;
    }
    return { start, end, deleted };
}

module.exports = { TABLES, countRows, writeTableCsv, deleteRows, resolveRange, resolveTableTypes };
