// services/dataImportService.js — High-Resilience Historical Data Ingest Engine
// Supports flexible column ordering, common column aliases, automatic date/time format conversion,
// UTF-8 BOM removal, and streaming CSV / GZIP decompression for option_chain_history, futures_history, and ohlcv_data.
const zlib = require("zlib");
const readline = require("readline");
const { pool } = require("../config/db");
const coverageSummary = require("./coverageSummaryService");

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

// Canonical column schemas
const TABLE_SCHEMAS = {
    option_chain_history: {
        header: [
            "symbol", "trade_date", "trade_time", "expiry", "strike", "underlying_price",
            "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
            "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega",
        ],
        required: ["symbol", "trade_date", "expiry", "strike"],
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
        required: ["symbol", "expiry", "trade_date"],
        insertColumns: ["symbol", "expiry", "trade_date", "trade_time", "open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
        updateColumns: ["open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
    },
    ohlcv_data: {
        header: ["symbol", "trade_date", "trade_time", "open", "high", "low", "close", "volume"],
        required: ["symbol", "trade_date"],
        insertColumns: ["symbol", "trade_date", "trade_time", "open", "high", "low", "close", "volume"],
        updateColumns: ["open", "high", "low", "close", "volume"],
    },
};

// Common column name aliases in Indian financial datasets (NSE, Opstra, Sensibull, Dhan, GDrive)
const COLUMN_ALIASES = {
    symbol: ["symbol", "ticker", "instrument", "underlying_symbol", "stock", "index", "sym", "name", "contract"],
    trade_date: ["trade_date", "date", "timestamp", "tradedate", "trade date", "trade_dt", "datetime", "dt", "candle_date", "time_stamp"],
    trade_time: ["trade_time", "time", "tradetime", "trade time", "time_str", "bar_time", "candle_time"],
    expiry: ["expiry", "expiry_date", "expirydate", "exp_date", "expiry date", "exp_dt", "expdate", "expiration", "exp"],
    strike: ["strike", "strike_price", "strikeprice", "strike price", "str_prc", "strike_prc", "strikeprc"],
    underlying_price: [
        "underlying_price", "underlying", "spot", "spot_price", "spotprice", "spot price",
        "underlying_val", "underlyingvalue", "underlying_value", "underlying_close", "close", "future_price", "fut_price"
    ],
    // Call options
    ce_ltp: ["ce_ltp", "ce_close", "ce_last_price", "ce_price", "call_ltp", "call_close", "call_price", "ce", "call_last", "c_ltp", "ce_last", "call", "c_close"],
    ce_oi: ["ce_oi", "ce_open_interest", "call_oi", "call_open_interest", "c_oi", "ce_open_int", "call_open_int"],
    ce_oi_change: ["ce_oi_change", "ce_change_in_oi", "ce_chg_oi", "ce_oi_chg", "call_oi_change", "call_chg_in_oi", "c_oi_change", "ce_oi_chnge", "call_oi_chg"],
    ce_iv: ["ce_iv", "ce_implied_volatility", "call_iv", "c_iv", "ce_impl_vol", "call_implied_volatility"],
    ce_volume: ["ce_volume", "ce_vol", "ce_total_traded_volume", "call_volume", "call_vol", "c_volume", "c_vol", "ce_traded_vol"],
    ce_delta: ["ce_delta", "call_delta", "c_delta", "delta_ce", "delta_call"],
    ce_gamma: ["ce_gamma", "call_gamma", "c_gamma", "gamma_ce", "gamma_call"],
    ce_theta: ["ce_theta", "call_theta", "c_theta", "theta_ce", "theta_call"],
    ce_vega: ["ce_vega", "call_vega", "c_vega", "vega_ce", "vega_call"],
    // Put options
    pe_ltp: ["pe_ltp", "pe_close", "pe_last_price", "pe_price", "put_ltp", "put_close", "put_price", "pe", "put_last", "p_ltp", "pe_last", "put", "p_close"],
    pe_oi: ["pe_oi", "pe_open_interest", "put_oi", "put_open_interest", "p_oi", "pe_open_int", "put_open_int"],
    pe_oi_change: ["pe_oi_change", "pe_change_in_oi", "pe_chg_oi", "pe_oi_chg", "put_oi_change", "put_chg_in_oi", "p_oi_change", "pe_oi_chnge", "put_oi_chg"],
    pe_iv: ["pe_iv", "pe_implied_volatility", "put_iv", "p_iv", "pe_impl_vol", "put_implied_volatility"],
    pe_volume: ["pe_volume", "pe_vol", "pe_total_traded_volume", "put_volume", "put_vol", "p_volume", "p_vol", "pe_traded_vol"],
    pe_delta: ["pe_delta", "put_delta", "p_delta", "delta_pe", "delta_put"],
    pe_gamma: ["pe_gamma", "put_gamma", "p_gamma", "gamma_pe", "gamma_put"],
    pe_theta: ["pe_theta", "put_theta", "p_theta", "theta_pe", "theta_put"],
    pe_vega: ["pe_vega", "put_vega", "p_vega", "vega_pe", "vega_put"],
    // Futures & OHLCV
    open: ["open", "open_price", "openprice", "o"],
    high: ["high", "high_price", "highprice", "h"],
    low: ["low", "low_price", "lowprice", "l"],
    close: ["close", "close_price", "closeprice", "c", "ltp", "last_price"],
    volume: ["volume", "vol", "traded_volume", "total_volume", "tot_vol", "v"],
    oi: ["oi", "open_interest", "open_int"],
    oi_change: ["oi_change", "change_in_oi", "oi_chg", "chg_oi", "open_interest_change"],
};

const MONTH_MAP = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Normalizes any common Indian date format to standard YYYY-MM-DD
 */
function normalizeDate(val) {
    if (!val) return null;
    let str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

    // ISO DateTime YYYY-MM-DD HH:MM:SS
    const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})[ T]/);
    if (isoMatch) return isoMatch[1];

    // DD-MM-YYYY or DD/MM/YYYY
    const ddmmyyyy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (ddmmyyyy) {
        return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
    }

    // DD-MMM-YYYY (e.g. 25-Jan-2024, 25JAN2024, 25-01-2024)
    const ddmmmyyyy = str.match(/^(\d{1,2})[- ]?([a-zA-Z]{3})[- ]?(\d{4})/);
    if (ddmmmyyyy) {
        const m = MONTH_MAP[ddmmmyyyy[2].toLowerCase()] || "01";
        return `${ddmmmyyyy[3]}-${m}-${ddmmmyyyy[1].padStart(2, "0")}`;
    }

    // YYYYMMDD
    if (/^\d{8}$/.test(str)) {
        return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
    }

    return str;
}

/**
 * Normalizes time string to standard HH:MM:SS
 */
function normalizeTime(val, fallback = "15:30:00") {
    if (!val) return fallback;
    let str = String(val).trim();
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(str)) {
        return str.padStart(8, "0");
    }
    if (/^\d{1,2}:\d{2}$/.test(str)) {
        return `${str.padStart(5, "0")}:00`;
    }
    const timeMatch = str.match(/\d{1,2}:\d{2}(:\d{2})?/);
    if (timeMatch) {
        const t = timeMatch[0];
        return t.length === 5 ? `${t}:00`.padStart(8, "0") : t.padStart(8, "0");
    }
    return fallback;
}

function getSchema(table) {
    const schema = TABLE_SCHEMAS[table];
    if (!schema) throw badRequest(`"${table}" is not importable — expected option_chain_history, futures_history, or ohlcv_data`);
    return schema;
}

/**
 * Checks if the given cells represent a column header row or already contain data.
 */
function isLikelyHeaderRow(cells, schema) {
    if (!cells || cells.length === 0) return false;

    let dateOrTimeCount = 0;
    let numericCount = 0;
    let headerKeywordMatches = 0;

    const allAliases = new Set(
        Object.values(COLUMN_ALIASES).flat().map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, ""))
    );
    Object.values(TABLE_SCHEMAS).forEach((s) => {
        s.header.forEach((h) => allAliases.add(h.toLowerCase().replace(/[^a-z0-9]/g, "")));
    });

    for (let i = 0; i < cells.length; i++) {
        const raw = String(cells[i] || "").replace(/^\uFEFF/, "").replace(/['"]+/g, "").trim();
        if (!raw) continue;
        const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");

        if (allAliases.has(normalized)) {
            headerKeywordMatches++;
        }

        if (normalizeDate(raw) && (raw.includes("-") || raw.includes("/"))) {
            dateOrTimeCount++;
        } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
            dateOrTimeCount++;
        } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
            numericCount++;
        }
    }

    // If there is date/time or mostly numbers, it is a data row (headerless CSV)
    if (dateOrTimeCount >= 1 || (numericCount > 3 && headerKeywordMatches < 2)) {
        return false;
    }

    return headerKeywordMatches >= 2;
}

/**
 * Derives positional mapping for headerless CSV files based on column count and signatures.
 */
function getPositionalMapping(cells, table, schema) {
    const mapping = {};
    const colCount = cells.length;
    const cell0 = String(cells[0] || "").trim();
    const cell1 = String(cells[1] || "").trim();
    const cell2 = String(cells[2] || "").trim();

    // Check if cell0 is an integer ID (e.g. 4867, 1), cell1 is symbol (e.g. nifty), and cell2 is date (e.g. 2023-01-02)
    const cell0IsNum = /^\d+$/.test(cell0) && cell0.length <= 10;
    const cell1IsSymbol = isNaN(cell1) && /^[a-zA-Z0-9_\-& ]+$/.test(cell1);
    const cell2IsDate = /^\d{4}-\d{2}-\d{2}/.test(cell2) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(cell2);

    const firstIsId = (colCount > schema.header.length || cell0IsNum) && cell1IsSymbol && cell2IsDate;
    const offset = firstIsId ? 1 : 0;

    const cols = schema.header;
    for (let i = 0; i < cols.length; i++) {
        if (i + offset < colCount) {
            mapping[cols[i]] = i + offset;
        }
    }

    return mapping;
}

/**
 * Creates dynamic header mapping from raw CSV columns to canonical schema columns
 */
function createHeaderMapping(rawHeader, schema) {
    // Clean raw header: strip BOM (\uFEFF), remove quotes, trim, lowercase
    const cleanHeader = rawHeader.map((h) =>
        String(h || "")
            .replace(/^\uFEFF/, "")
            .replace(/['"]+/g, "")
            .trim()
            .toLowerCase()
    );

    const mapping = {}; // canonicalCol -> rawColIndex

    schema.header.forEach((canonicalCol) => {
        const aliases = COLUMN_ALIASES[canonicalCol] || [canonicalCol];
        for (let i = 0; i < cleanHeader.length; i++) {
            const rawCol = cleanHeader[i];
            if (aliases.includes(rawCol)) {
                mapping[canonicalCol] = i;
                break;
            }
        }
    });

    // Verify all required columns are present in CSV
    const missingRequired = schema.required.filter((reqCol) => mapping[reqCol] === undefined);
    if (missingRequired.length > 0) {
        throw badRequest(
            `Missing required column(s): ${missingRequired.join(", ")}. Found columns in file: ${cleanHeader.join(", ")}`
        );
    }

    return mapping;
}

/**
 * Validates and normalizes one row object against schema
 */
function validateRow(schema, raw) {
    const row = {};

    for (const col of schema.header) {
        let value = raw[col] === undefined || raw[col] === null ? "" : String(raw[col]).trim();

        if (col === "symbol") {
            if (!value) throw badRequest("Symbol is required");
            row.symbol = value.toUpperCase();
            continue;
        }

        if (col === "trade_date") {
            const normalizedDate = normalizeDate(value);
            if (!normalizedDate) throw badRequest("trade_date is required");
            row.trade_date = normalizedDate;
            continue;
        }

        if (col === "expiry") {
            const normalizedExp = normalizeDate(value);
            if (schema.required.includes("expiry") && !normalizedExp) {
                throw badRequest("expiry date is required");
            }
            row.expiry = normalizedExp || null;
            continue;
        }

        if (col === "trade_time") {
            row.trade_time = normalizeTime(value, "15:30:00");
            continue;
        }

        if (col === "strike") {
            if (value === "") {
                if (schema.required.includes("strike")) throw badRequest("strike is required");
                row.strike = 0;
            } else {
                const strikeNum = Number(value);
                if (!Number.isFinite(strikeNum)) throw badRequest(`strike must be a number (got "${value}")`);
                row.strike = strikeNum;
            }
            continue;
        }

        // Numeric fields (optional)
        if (value === "" || value === "-" || value.toLowerCase() === "null") {
            row[col] = null;
            continue;
        }

        const num = Number(value.replace(/,/g, ""));
        if (!Number.isFinite(num)) {
            row[col] = null;
        } else {
            row[col] = num;
        }
    }

    return row;
}

function splitCsvLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            cells.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
}

const MAX_ROWS = 100000;

/**
 * Validates and upserts in-memory parsed rows into database
 */
async function importRows(table, rows) {
    const schema = getSchema(table);
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest("No rows to import");
    if (rows.length > MAX_ROWS) throw badRequest(`Too many rows in one import (max ${MAX_ROWS} — split the file)`);

    const normalized = [];
    const rowErrors = [];

    rows.forEach((raw, idx) => {
        const rowNumber = Number(raw && raw.rowNumber) || idx + 2;
        try {
            normalized.push(validateRow(schema, raw || {}));
        } catch (err) {
            rowErrors.push({ row: rowNumber, message: err.message });
        }
    });

    if (rowErrors.length) {
        const err = badRequest(`Found ${rowErrors.length} validation errors — nothing was imported`);
        err.rowErrors = rowErrors.slice(0, 50);
        throw err;
    }

    const values = normalized.map((r) => schema.insertColumns.map((c) => r[c]));
    const updateClause = schema.updateColumns.map((c) => `${c}=VALUES(${c})`).join(", ");
    const BATCH = 500;
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

    if (table === "option_chain_history") {
        await coverageSummary.recordIngestedFromInsertValues(values).catch(() => {});
    } else if (table === "ohlcv_data") {
        await coverageSummary.recordOhlcvIngested(values).catch(() => {});
    }

    return written;
}

/**
 * Stream-parse and import CSV / CSV.GZ directly from a readable stream
 */
async function importFromStream({ readableStream, fileName, table }) {
    const schema = getSchema(table);
    let inputStream = readableStream;

    const lowerName = (fileName || "").toLowerCase();
    if (lowerName.endsWith(".gz") || lowerName.endsWith(".gzip")) {
        const gunzip = zlib.createGunzip();
        inputStream = readableStream.pipe(gunzip);
    }

    const rl = readline.createInterface({
        input: inputStream,
        crlfDelay: Infinity,
    });

    let isFirstLine = true;
    let headerMapping = null;
    let lineIndex = 0;
    let rowBuffer = [];
    let totalWritten = 0;
    const allIngestedValues = [];
    const rowErrors = [];

    const updateClause = schema.updateColumns.map((c) => `${c}=VALUES(${c})`).join(", ");
    const BATCH_SIZE = 500;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        for await (const line of rl) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            lineIndex++;

            if (isFirstLine) {
                isFirstLine = false;
                const rawCols = splitCsvLine(trimmed);
                if (isLikelyHeaderRow(rawCols, schema)) {
                    headerMapping = createHeaderMapping(rawCols, schema);
                    continue; // Header row consumed
                } else {
                    // Headerless CSV file — positionally map columns and proceed to process line as data
                    headerMapping = getPositionalMapping(rawCols, table, schema);
                }
            }

            const cells = splitCsvLine(trimmed);
            const rawRow = {};

            schema.header.forEach((canonicalCol) => {
                const colIdx = headerMapping[canonicalCol];
                rawRow[canonicalCol] = colIdx !== undefined && colIdx < cells.length ? cells[colIdx] : "";
            });

            try {
                const validated = validateRow(schema, rawRow);
                const rowVals = schema.insertColumns.map((c) => validated[c]);
                rowBuffer.push(rowVals);
                if (table === "option_chain_history" || table === "ohlcv_data") {
                    allIngestedValues.push(rowVals);
                }
            } catch (err) {
                rowErrors.push({ row: lineIndex, message: err.message });
                if (rowErrors.length >= 40) break;
            }

            if (rowBuffer.length >= BATCH_SIZE) {
                await conn.query(
                    `INSERT INTO ${table} (${schema.insertColumns.join(", ")}) VALUES ? ON DUPLICATE KEY UPDATE ${updateClause}`,
                    [rowBuffer]
                );
                totalWritten += rowBuffer.length;
                rowBuffer = [];
            }
        }

        if (rowErrors.length > 0) {
            await conn.rollback();
            const err = badRequest(
                `Found ${rowErrors.length} validation error(s) in CSV rows — nothing was imported.`
            );
            err.rowErrors = rowErrors.slice(0, 50);
            throw err;
        }

        if (rowBuffer.length > 0) {
            await conn.query(
                `INSERT INTO ${table} (${schema.insertColumns.join(", ")}) VALUES ? ON DUPLICATE KEY UPDATE ${updateClause}`,
                [rowBuffer]
            );
            totalWritten += rowBuffer.length;
            rowBuffer = [];
        }

        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }

    if (table === "option_chain_history" && allIngestedValues.length > 0) {
        await coverageSummary.recordIngestedFromInsertValues(allIngestedValues).catch(() => {});
    } else if (table === "ohlcv_data" && allIngestedValues.length > 0) {
        await coverageSummary.recordOhlcvIngested(allIngestedValues).catch(() => {});
    }

    return {
        written: totalWritten,
        fileName,
    };
}

module.exports = {
    importRows,
    importFromStream,
    splitCsvLine,
    normalizeDate,
    normalizeTime,
    isLikelyHeaderRow,
    getPositionalMapping,
    createHeaderMapping,
    validateRow,
    TABLE_SCHEMAS,
    COLUMN_ALIASES,
};
