// services/lotSizeHistoryService.js — real historical lot size for a
// symbol, as of a specific trade date. NSE revises F&O lot sizes
// periodically (SEBI-driven review, roughly every 6 months) — a multi-year
// Simulator replay or Backtest run must use the lot size that was actually
// in effect on that historical date, not today's (see instrumentMaster.js's
// getLotSize, which only ever has today's scrip-master value).
//
// This table is admin-seeded from NSE's own published lot-size-revision
// circulars (admin/src/pages/LotSizeHistory.jsx) — deliberately NOT
// auto-populated or guessed here. None of Bhavcopy/Breeze/Upstox
// (server/services/nseBhavcopy.js, server/breeze-historical/, upstoxHistorical.js)
// capture historical lot size at all, so there is no free/reliable source to
// backfill this from automatically; a fabricated historical value would be
// worse than an honest gap (same "verify before trusting" principle
// CLAUDE.md states for every other scrip-master-derived constant in this
// codebase). Until an admin enters real coverage for a symbol/date, callers
// fall back to today's scrip-master lot size — no worse than before this
// table existed, just not yet historically accurate for older dates.
const { pool } = require("../config/db");
const instrumentMaster = require("./instrumentMaster");

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

/** Real lot size for `symbol` as of `dateStr` ('YYYY-MM-DD'), or the current scrip-master value if unrecorded. */
async function getLotSizeAsOf(symbol, dateStr) {
    const displaySymbol = String(symbol || "").toUpperCase();
    const [rows] = await pool.query(
        `SELECT lot_size FROM lot_size_history
         WHERE symbol = ? AND effective_from <= ?
           AND (effective_to IS NULL OR effective_to >= ?)
         ORDER BY effective_from DESC LIMIT 1`,
        [displaySymbol, dateStr, dateStr]
    );
    if (rows.length) return Number(rows[0].lot_size);

    try {
        return await instrumentMaster.getLotSize(displaySymbol);
    } catch {
        return null;
    }
}

async function listLotSizeHistory(symbol) {
    const params = [];
    let sql = `SELECT id, symbol, lot_size, effective_from, effective_to, created_at FROM lot_size_history`;
    if (symbol) {
        sql += ` WHERE symbol = ?`;
        params.push(String(symbol).toUpperCase());
    }
    sql += ` ORDER BY symbol ASC, effective_from DESC`;
    const [rows] = await pool.query(sql, params);
    return rows;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shared field validation for both the single-entry form and the CSV bulk import — one
 * source of truth so the two paths can never drift on what counts as a valid row. */
function validateEntryFields({ symbol, lotSize, effectiveFrom, effectiveTo }) {
    const displaySymbol = String(symbol || "").trim().toUpperCase();
    if (!displaySymbol) throw badRequest("symbol is required");

    const lotSizeNum = Number(lotSize);
    if (!Number.isInteger(lotSizeNum) || lotSizeNum <= 0) throw badRequest("lot_size must be a positive whole number");

    const from = String(effectiveFrom || "").trim();
    if (!DATE_RE.test(from)) throw badRequest("effective_from must be a real date in YYYY-MM-DD format");

    const to = String(effectiveTo || "").trim();
    if (to && !DATE_RE.test(to)) throw badRequest("effective_to must be blank or a real date in YYYY-MM-DD format");
    if (to && to < from) throw badRequest("effective_to cannot be before effective_from");

    return { symbol: displaySymbol, lotSize: lotSizeNum, effectiveFrom: from, effectiveTo: to || null };
}

async function addLotSizeEntry({ symbol, lotSize, effectiveFrom, effectiveTo, userId }) {
    const entry = validateEntryFields({ symbol, lotSize, effectiveFrom, effectiveTo });
    const [result] = await pool.query(
        `INSERT INTO lot_size_history (symbol, lot_size, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?)`,
        [entry.symbol, entry.lotSize, entry.effectiveFrom, entry.effectiveTo, userId || null]
    );
    return result.insertId;
}

// Bulk import from the admin's CSV upload (admin/src/pages/LotSizeHistory.jsx). All-or-
// nothing on purpose: if any row doesn't match the expected format, nothing is inserted and
// every row's problem is reported at once (with its original CSV line number) so the admin
// can fix the file in Excel and re-upload, rather than ending up with a half-imported sheet
// and no clear picture of what still needs fixing.
const MAX_BULK_ROWS = 2000;

async function bulkAddLotSizeEntries(rows, userId) {
    if (!Array.isArray(rows) || rows.length === 0) throw badRequest("no rows to import");
    if (rows.length > MAX_BULK_ROWS) throw badRequest(`too many rows in one import (max ${MAX_BULK_ROWS})`);

    const normalized = [];
    const rowErrors = [];
    rows.forEach((raw, idx) => {
        const rowNumber = Number(raw && raw.rowNumber) || idx + 2; // header is line 1
        try {
            const entry = validateEntryFields(raw || {});
            normalized.push(entry);
        } catch (err) {
            rowErrors.push({ row: rowNumber, message: err.message });
        }
    });

    if (rowErrors.length) {
        const err = badRequest("some rows do not match the expected format — fix and re-upload");
        err.rowErrors = rowErrors;
        throw err;
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        for (const entry of normalized) {
            await conn.query(
                `INSERT INTO lot_size_history (symbol, lot_size, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?)`,
                [entry.symbol, entry.lotSize, entry.effectiveFrom, entry.effectiveTo, userId || null]
            );
        }
        await conn.commit();
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
    return normalized.length;
}

async function deleteLotSizeEntry(id) {
    await pool.query(`DELETE FROM lot_size_history WHERE id = ?`, [id]);
}

module.exports = { getLotSizeAsOf, listLotSizeHistory, addLotSizeEntry, bulkAddLotSizeEntries, deleteLotSizeEntry };
