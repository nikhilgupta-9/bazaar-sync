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

async function addLotSizeEntry({ symbol, lotSize, effectiveFrom, effectiveTo, userId }) {
    const displaySymbol = String(symbol || "").toUpperCase();
    if (!displaySymbol) throw badRequest("symbol is required");
    if (!Number.isInteger(lotSize) || lotSize <= 0) throw badRequest("lotSize must be a positive whole number");
    if (!effectiveFrom) throw badRequest("effectiveFrom is required (YYYY-MM-DD)");
    if (effectiveTo && effectiveTo < effectiveFrom) throw badRequest("effectiveTo cannot be before effectiveFrom");

    const [result] = await pool.query(
        `INSERT INTO lot_size_history (symbol, lot_size, effective_from, effective_to, created_by) VALUES (?, ?, ?, ?, ?)`,
        [displaySymbol, lotSize, effectiveFrom, effectiveTo || null, userId || null]
    );
    return result.insertId;
}

async function deleteLotSizeEntry(id) {
    await pool.query(`DELETE FROM lot_size_history WHERE id = ?`, [id]);
}

module.exports = { getLotSizeAsOf, listLotSizeHistory, addLotSizeEntry, deleteLotSizeEntry };
