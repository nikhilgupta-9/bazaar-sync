// controllers/dataOpsController.js — admin "Data" section: credential
// settings, extraction job requests, coverage/expiry/Greeks reporting, and
// manual CSV import. See services/{envSettingsService,dataDownloaderRunner,
// dataCoverageService,dataImportService}.js for the actual logic — this file
// is just the req/res + error-shape glue, matching adminController.js's
// existing conventions exactly.

const envSettingsService = require("../services/envSettingsService");
const runner = require("../services/dataDownloaderRunner");
const coverage = require("../services/dataCoverageService");
const importService = require("../services/dataImportService");
const db = require("../config/db");

function sendError(res, err, fallback) {
    if (err.rowErrors) return res.status(err.status || 400).json({ error: err.message, rowErrors: err.rowErrors });
    console.error(`[dataOps] ${fallback}:`, err);
    res.status(err.status || 500).json({ error: err.message || fallback });
}

// --- Credentials ---

async function getEnvStatus(req, res) {
    try {
        res.json({ sources: envSettingsService.getStatus() });
    } catch (err) {
        sendError(res, err, "failed to load credential status");
    }
}

async function updateEnvValue(req, res) {
    try {
        const { key, value } = req.body || {};
        const result = envSettingsService.updateValue(key, value);
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to update credential");
    }
}

// --- Extraction jobs ---

async function startExtractionJob(req, res) {
    try {
        const { source, dataType, year, fromMonth, toMonth, date, symbols, extraArgs } = req.body || {};
        const result = await runner.startJob({ source, dataType, year, fromMonth, toMonth, date, symbols, extraArgs, requestedBy: req.user.sub });
        res.status(201).json(result);
    } catch (err) {
        sendError(res, err, "failed to start extraction job");
    }
}

async function listExtractionJobs(req, res) {
    try {
        const jobs = await runner.listJobs({ limit: req.query.limit });
        res.json({ jobs });
    } catch (err) {
        sendError(res, err, "failed to load jobs");
    }
}

async function getExtractionJob(req, res) {
    try {
        const job = await runner.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: "job not found" });
        res.json({ job });
    } catch (err) {
        sendError(res, err, "failed to load job");
    }
}

async function cancelExtractionJob(req, res) {
    try {
        await runner.cancelJob(req.params.id);
        res.status(204).end();
    } catch (err) {
        sendError(res, err, "failed to cancel job");
    }
}

async function failExtractionJob(req, res) {
    try {
        await runner.failJob(req.params.id);
        res.status(204).end();
    } catch (err) {
        sendError(res, err, "failed to mark job as failed");
    }
}

async function deleteExtractionJob(req, res) {
    try {
        await runner.deleteJob(req.params.id);
        res.status(204).end();
    } catch (err) {
        sendError(res, err, "failed to delete job");
    }
}

async function restartExtractionJob(req, res) {
    try {
        const result = await runner.restartJob(req.params.id, req.user.sub);
        res.status(201).json(result);
    } catch (err) {
        sendError(res, err, "failed to restart job");
    }
}

// --- Coverage / Expiry / Greeks ---

async function getCoverageSummary(req, res) {
    try {
        const dataType = req.query.dataType || "option_chain";
        const rows = await coverage.getCoverageSummary(dataType);
        res.json({ dataType, coverageStart: coverage.COVERAGE_START, sevenIndices: coverage.SEVEN_INDICES, symbols: rows });
    } catch (err) {
        sendError(res, err, "failed to load coverage summary");
    }
}

async function getCoverageDetail(req, res) {
    try {
        const dataType = req.query.dataType || "option_chain";
        const symbol = req.query.symbol;
        if (!symbol) return res.status(400).json({ error: "symbol query param is required" });
        const months = await coverage.getCoverageDetail(dataType, symbol);
        res.json({ dataType, symbol: symbol.toUpperCase(), months });
    } catch (err) {
        sendError(res, err, "failed to load coverage detail");
    }
}

async function getCoverageDays(req, res) {
    try {
        const dataType = req.query.dataType || "option_chain";
        const { symbol, month } = req.query;
        if (!symbol) return res.status(400).json({ error: "symbol query param is required" });
        if (!month) return res.status(400).json({ error: "month query param is required (YYYY-MM)" });
        const result = await coverage.getCoverageDays(dataType, symbol, month);
        res.json({ dataType, ...result });
    } catch (err) {
        sendError(res, err, "failed to load day-level coverage");
    }
}

async function getCoverageMinutes(req, res) {
    try {
        const dataType = req.query.dataType || "option_chain";
        const { symbol, date } = req.query;
        if (!symbol || !date) return res.status(400).json({ error: "symbol and date are required" });
        const result = await coverage.getCoverageMinutes(dataType, symbol, date);
        res.json({ dataType, ...result });
    } catch (err) {
        sendError(res, err, "failed to load minute-level coverage");
    }
}

async function getCoverageMinuteRows(req, res) {
    try {
        const dataType = req.query.dataType || "option_chain";
        const { symbol, date, time } = req.query;
        if (!symbol || !date || !time) return res.status(400).json({ error: "symbol, date, and time are required" });
        const result = await coverage.getCoverageMinuteRows(dataType, symbol, date, time);
        res.json({ dataType, ...result });
    } catch (err) {
        sendError(res, err, "failed to load minute option-chain rows");
    }
}

async function getExpiryStatus(req, res) {
    try {
        const dataType = req.query.dataType || "option_chain";
        const symbols = await coverage.getExpiryStatus(dataType);
        res.json({ dataType, symbols });
    } catch (err) {
        sendError(res, err, "failed to load expiry status");
    }
}

async function getGreeksCoverage(req, res) {
    try {
        const symbols = await coverage.getGreeksCoverage();
        res.json({ symbols });
    } catch (err) {
        sendError(res, err, "failed to load Greeks coverage");
    }
}

async function refreshCoverageCache(req, res) {
    coverage.invalidateCoverageCache();
    res.status(204).end();
}

// --- CSV Import ---

async function importData(req, res) {
    try {
        const { table, rows } = req.body || {};
        const written = await importService.importRows(table, rows);
        res.status(201).json({ written });
    } catch (err) {
        sendError(res, err, "failed to import data");
    }
}

// --- Disk Usage & Space Lifecycle (Prune) ---

async function getDiskUsage(req, res) {
    try {
        const allowedTables = ['option_chain_history', 'ohlcv_data', 'futures_history'];
        const sizeRows = await db.query(`
            SELECT 
                table_name AS tableName,
                ROUND(((data_length + index_length) / 1024 / 1024), 2) AS totalSizeMb,
                table_rows AS tableRows
            FROM information_schema.TABLES
            WHERE table_schema = DATABASE()
              AND table_name IN ('option_chain_history', 'ohlcv_data', 'futures_history')
        `);

        const tables = [];
        for (const t of allowedTables) {
            const sizeInfo = (sizeRows && sizeRows.find(r => r.tableName === t)) || { totalSizeMb: "0.00", tableRows: 0 };
            let symbolCount = 0;
            let minDate = "-";
            let maxDate = "-";
            try {
                const stats = await db.query(`
                    SELECT 
                        COUNT(DISTINCT symbol) as symbolCount,
                        MIN(trade_date) as minDate,
                        MAX(trade_date) as maxDate,
                        COUNT(*) as actualRows
                    FROM \`${t}\`
                `);
                if (stats && stats[0]) {
                    symbolCount = stats[0].symbolCount || 0;
                    minDate = stats[0].minDate ? String(stats[0].minDate).slice(0, 10) : "-";
                    maxDate = stats[0].maxDate ? String(stats[0].maxDate).slice(0, 10) : "-";
                    sizeInfo.tableRows = stats[0].actualRows || sizeInfo.tableRows;
                }
            } catch (_) {}

            tables.push({
                tableName: t,
                totalSizeMb: sizeInfo.totalSizeMb,
                tableRows: sizeInfo.tableRows,
                symbolCount,
                minDate,
                maxDate
            });
        }

        res.json({ tables });
    } catch (err) {
        sendError(res, err, "failed to get disk usage");
    }
}

async function previewDataPrune(req, res) {
    try {
        const { table, symbol, year } = req.body || {};
        const allowedTables = ['option_chain_history', 'ohlcv_data', 'futures_history'];
        if (!allowedTables.includes(table)) throw new Error("Invalid table name");

        let sql = `SELECT COUNT(*) as total FROM \`${table}\` WHERE 1=1`;
        const params = [];
        if (symbol && symbol !== 'ALL') {
            sql += ` AND symbol = ?`;
            params.push(symbol);
        }
        if (year && year !== 'ALL') {
            sql += ` AND YEAR(trade_date) = ?`;
            params.push(year);
        }

        const rows = await db.query(sql, params);
        const matchingRows = rows?.[0]?.total || 0;
        res.json({ table, symbol, year, matchingRows });
    } catch (err) {
        sendError(res, err, "failed to preview prune");
    }
}

async function executeDataPrune(req, res) {
    try {
        const { table, symbol, year } = req.body || {};
        const allowedTables = ['option_chain_history', 'ohlcv_data', 'futures_history'];
        if (!allowedTables.includes(table)) throw new Error("Invalid table name");

        let sql = `DELETE FROM \`${table}\` WHERE 1=1`;
        const params = [];
        if (symbol && symbol !== 'ALL') {
            sql += ` AND symbol = ?`;
            params.push(symbol);
        }
        if (year && year !== 'ALL') {
            sql += ` AND YEAR(trade_date) = ?`;
            params.push(year);
        }

        const result = await db.query(sql, params);
        const deletedRows = result?.affectedRows || 0;
        res.json({ table, symbol, year, deletedRows, message: `Successfully pruned ${deletedRows.toLocaleString()} rows.` });
    } catch (err) {
        sendError(res, err, "failed to execute prune");
    }
}

async function exportData(req, res) {
    try {
        const { table, symbol, year } = req.query || {};
        const allowedTables = ['option_chain_history', 'ohlcv_data', 'futures_history'];
        if (!allowedTables.includes(table)) return res.status(400).json({ error: "Invalid table" });

        let sql = `SELECT * FROM \`${table}\` WHERE 1=1`;
        const params = [];
        if (symbol && symbol !== 'ALL') {
            sql += ` AND symbol = ?`;
            params.push(symbol);
        }
        if (year && year !== 'ALL') {
            sql += ` AND YEAR(trade_date) = ?`;
            params.push(year);
        }
        sql += ` LIMIT 100000`;

        const rows = await db.query(sql, params);
        if (!rows || rows.length === 0) {
            return res.status(404).send("No data found for the selected criteria.");
        }

        const filename = `${table}_${symbol || "ALL"}_${year || "ALL"}.csv`;
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

        const headers = Object.keys(rows[0]).join(",") + "\n";
        res.write(headers);
        for (const r of rows) {
            const rowStr = Object.values(r).map(v => (v === null || v === undefined ? "" : `"${String(v).replace(/"/g, '""')}"`)).join(",") + "\n";
            res.write(rowStr);
        }
        res.end();
    } catch (err) {
        sendError(res, err, "failed to export data");
    }
}

module.exports = {
    getEnvStatus, updateEnvValue,
    startExtractionJob, listExtractionJobs, getExtractionJob, cancelExtractionJob, failExtractionJob, deleteExtractionJob, restartExtractionJob,
    getCoverageSummary, getCoverageDetail, getCoverageDays, getCoverageMinutes, getCoverageMinuteRows, getExpiryStatus, getGreeksCoverage, refreshCoverageCache,
    importData,
    getDiskUsage, exportData, previewDataPrune, executeDataPrune,
};

