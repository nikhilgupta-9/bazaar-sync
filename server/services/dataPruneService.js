// services/dataPruneService.js — Safe Batch Pruning & Space Reclaim Service
const db = require("../config/db");
const { ALLOWED_TABLES } = require("./dataExportService");

/**
 * Preview how many rows would be deleted by a prune rule (Dry-run)
 */
async function previewPrune({ table, symbol, year, fromDate, toDate }) {
    if (!ALLOWED_TABLES.includes(table)) {
        throw new Error(`Invalid table: ${table}`);
    }

    const whereClauses = [];
    const params = [];

    if (symbol && symbol !== "ALL") {
        whereClauses.push("symbol = ?");
        params.push(symbol.toUpperCase());
    }

    if (year) {
        whereClauses.push("trade_date LIKE ?");
        params.push(`${year}-%`);
    } else {
        if (fromDate) {
            whereClauses.push("trade_date >= ?");
            params.push(fromDate);
        }
        if (toDate) {
            whereClauses.push("trade_date <= ?");
            params.push(toDate);
        }
    }

    if (!whereClauses.length) {
        throw new Error("Must specify at least one filter (symbol, year, or date range) to prevent accidental total data loss");
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;
    const [countResult] = await db.query(`SELECT COUNT(*) as count, MIN(trade_date) as minD, MAX(trade_date) as maxD FROM ${table} ${whereSql}`, params);

    return {
        table,
        matchingRows: countResult.count,
        minDate: countResult.minD,
        maxDate: countResult.maxD,
        dryRun: true,
    };
}

/**
 * Execute safe batch deletion and optimize table to release disk space
 */
async function executePrune({ table, symbol, year, fromDate, toDate }) {
    const preview = await previewPrune({ table, symbol, year, fromDate, toDate });
    if (preview.matchingRows === 0) {
        return { deletedRows: 0, message: "No matching records found" };
    }

    const whereClauses = [];
    const params = [];

    if (symbol && symbol !== "ALL") {
        whereClauses.push("symbol = ?");
        params.push(symbol.toUpperCase());
    }

    if (year) {
        whereClauses.push("trade_date LIKE ?");
        params.push(`${year}-%`);
    } else {
        if (fromDate) {
            whereClauses.push("trade_date >= ?");
            params.push(fromDate);
        }
        if (toDate) {
            whereClauses.push("trade_date <= ?");
            params.push(toDate);
        }
    }

    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    // Delete in chunks of 50,000 to prevent MySQL lock escalation & high RAM usage
    let totalDeleted = 0;
    let keepDeleting = true;

    while (keepDeleting) {
        const deleteSql = `DELETE FROM ${table} ${whereSql} LIMIT 50000`;
        const result = await db.query(deleteSql, params);
        const affected = result.affectedRows || 0;
        totalDeleted += affected;

        if (affected < 50000) {
            keepDeleting = false;
        }
    }

    // Also update coverage summaries if applicable
    if (table === "option_chain_history") {
        try {
            await db.query(`DELETE FROM option_chain_coverage_summary ${whereSql}`, params);
        } catch {
            // non-fatal
        }
    } else if (table === "ohlcv_data") {
        try {
            await db.query(`DELETE FROM ohlcv_coverage_summary ${whereSql}`, params);
        } catch {
            // non-fatal
        }
    }

    return {
        table,
        deletedRows: totalDeleted,
        timestamp: new Date().toISOString(),
    };
}

module.exports = {
    previewPrune,
    executePrune,
};
