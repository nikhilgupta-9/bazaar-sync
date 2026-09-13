// services/dataImportService.js — manual CSV import for the two historical
// tables (option_chain_history, futures_history), for the specific case the
// admin Data Coverage page exists to surface: "this month is missing for
// this symbol and none of the automated sources can fill it — someone has a
// CSV of it from somewhere else, let them import it correctly."
//
// Same "all-or-nothing, report every problem row up front" pattern as
// lotSizeHistoryService.js's bulkAddLotSizeEntries — CSV *parsing* happens
// client-side (admin/src/pages/DataImport.jsx), this only validates fields
// against the real table schema and reports exactly which rows/columns
// don't match, never guesses or coerces silently. Writes go through the
// exact same ON DUPLICATE KEY UPDATE upsert every automated pipeline uses,
// so an import can only ever fill a gap or refresh a row — never duplicate.

const { pool } = require("../config/db");
const coverageSummary = require("./coverageSummaryService");

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

// One entry per importable table: the exact CSV header expected (order
// matters — it IS the column order the template/instructions show), which
// columns are required vs optional-numeric, and the INSERT this compiles to.
const TABLE_SCHEMAS = {
    option_chain_history: {
        header: [
            "symbol", "trade_date", "trade_time", "expiry", "strike", "underlying_price",
            "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
            "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega",
        ],
        required: ["symbol", "trade_date", "trade_time", "expiry", "strike"],
        insertColumns: [
            "symbol", "trade_date", "trade_time", "expiry", "strike", "underlying_price",
            "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
            "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega",
        ],
        updateColumns: [
            "underlying_price", "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
            "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega",
        ],
    },
    futures_history: {
        header: ["symbol", "expiry", "trade_date", "trade_time", "open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
        required: ["symbol", "expiry", "trade_date", "trade_time"],
        insertColumns: ["symbol", "expiry", "trade_date", "trade_time", "open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
        updateColumns: ["open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
    },
};

function getSchema(table) {
    const schema = TABLE_SCHEMAS[table];
    if (!schema) throw badRequest(`"${table}" is not importable — expected option_chain_history or futures_history`);
    return schema;
}

/** Validates+normalizes one row object against a table's schema. Throws with a specific field name on the first problem. */
function validateRow(schema, raw) {
    const row = {};
    for (const col of schema.header) {
        const value = raw[col] === undefined || raw[col] === null ? "" : String(raw[col]).trim();

        if (col === "symbol") {
            if (!value) throw badRequest("symbol is required");
            row.symbol = value.toUpperCase();
            continue;
        }
        if (col === "trade_date" || col === "expiry") {
            if (schema.required.includes(col) && !value) throw badRequest(`${col} is required`);
            if (value && !DATE_RE.test(value)) throw badRequest(`${col} must be YYYY-MM-DD (got "${value}")`);
            row[col] = value || null;
            continue;
        }
        if (col === "trade_time") {
            if (!value) throw badRequest("trade_time is required");
            if (!TIME_RE.test(value)) throw badRequest(`trade_time must be HH:MM:SS (got "${value}")`);
            row.trade_time = value;
            continue;
        }
        // Every other column is optional-numeric — blank is a legitimate
        // "no data for this field" (matches every automated pipeline's own
        // convention of writing NULL rather than guessing 0).
        if (value === "") { row[col] = null; continue; }
        const num = Number(value);
        if (!Number.isFinite(num)) throw badRequest(`${col} must be a number or blank (got "${value}")`);
        row[col] = num;
    }
    return row;
}

const MAX_ROWS = 50000;

/**
 * Validates every row against the table schema (all-or-nothing — throws
 * with `.rowErrors` listing every problem row at once, nothing is written
 * if any row fails), then upserts via the same ON DUPLICATE KEY UPDATE
 * pattern the automated pipelines use. Returns the number of rows written.
 */
async function importRows(table, rows) {
    const schema = getSchema(table);
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest("no rows to import");
    if (rows.length > MAX_ROWS) throw badRequest(`too many rows in one import (max ${MAX_ROWS} — split the file)`);

    const normalized = [];
    const rowErrors = [];
    rows.forEach((raw, idx) => {
        const rowNumber = Number(raw && raw.rowNumber) || idx + 2; // header is CSV line 1
        try {
            normalized.push(validateRow(schema, raw || {}));
        } catch (err) {
            rowErrors.push({ row: rowNumber, message: err.message });
        }
    });
    if (rowErrors.length) {
        const err = badRequest("some rows do not match the expected format — fix and re-upload, nothing was imported");
        err.rowErrors = rowErrors;
        throw err;
    }

    const values = normalized.map((r) => schema.insertColumns.map((c) => r[c]));
    const updateClause = schema.updateColumns.map((c) => `${c}=VALUES(${c})`).join(", ");
    const BATCH = 500; // same max_allowed_packet caution every bulk writer in this codebase already applies
    let written = 0;
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        for (let i = 0; i < values.length; i += BATCH) {
            const batch = values.slice(i, i + BATCH);
            await conn.query(
                `INSERT INTO ${table} (${schema.insertColumns.join(", ")}) VALUES ? ON DUPLICATE KEY UPDATE ${updateClause}`,
                [batch]
            );
            written += batch.length;
        }
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
    // Coverage summary only tracks option_chain_history (see schema.sql) —
    // futures_history's insertColumns order (symbol, expiry, trade_date, ...)
    // doesn't match the (symbol, trade_date, ..., expiry) layout
    // keysFromInsertValues expects, so this is intentionally scoped to the
    // one table it actually applies to.
    if (table === "option_chain_history") {
        await coverageSummary.recordIngestedFromInsertValues(values);
    }
    return written;
}

module.exports = { importRows, TABLE_SCHEMAS };
