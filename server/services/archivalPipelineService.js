// services/archivalPipelineService.js — Automated Multi-Asset Cloud Archival & Storage Manager
// Manages 4 core asset categories in Google Drive: Option Chain, Futures, India VIX, and Bitcoin.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");
const db = require("../config/db");
const gdrive = require("./googleDriveService");

const STAGING_DIR = path.join(__dirname, "../../tmp/bazaar_staging");
if (!fs.existsSync(STAGING_DIR)) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
}

// In-memory active runner state
let activePipeline = {
    isRunning: false,
    jobId: null,
    dataType: "option_chain", // 'option_chain' | 'futures' | 'india_vix' | 'bitcoin' | 'all'
    targetYears: ["2023", "2024"],
    symbols: [],
    currentSymbol: null,
    currentYear: null,
    currentDataType: null,
    stage: "idle", // 'extracting' | 'exporting_csv' | 'uploading_gdrive' | 'pruning_db' | 'completed' | 'error'
    progressPct: 0,
    totalBatches: 0,
    completedBatches: 0,
    logs: [],
    error: null,
    startTime: null,
    autoPrune: true,
};

function appendLog(message, level = "info") {
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    activePipeline.logs.push(entry);
    if (activePipeline.logs.length > 500) activePipeline.logs.shift();
    console.log(`[ArchivalPipeline] ${entry}`);
}

/**
 * Initializes required MySQL tables
 */
async function initTables() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS gdrive_archive_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(32) NOT NULL,
                year INT NOT NULL,
                month INT DEFAULT NULL,
                data_type VARCHAR(32) NOT NULL DEFAULT 'option_chain',
                record_count BIGINT DEFAULT 0,
                file_name VARCHAR(255) NOT NULL,
                file_size_bytes BIGINT DEFAULT 0,
                gdrive_file_id VARCHAR(128) DEFAULT NULL,
                gdrive_web_link TEXT DEFAULT NULL,
                gdrive_folder_id VARCHAR(128) DEFAULT NULL,
                status ENUM('pending', 'uploading', 'archived', 'pruned', 'error') DEFAULT 'pending',
                checksum_sha256 VARCHAR(64) DEFAULT NULL,
                extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                uploaded_at DATETIME DEFAULT NULL,
                pruned_at DATETIME DEFAULT NULL,
                error_message TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_sym_yr_type_mo (symbol, year, data_type, month)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS gdrive_sync_settings (
                setting_key VARCHAR(64) PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);
    } catch (err) {
        console.error("[ArchivalPipeline] Failed to initialize tables:", err.message);
    }
}

// Auto-run table initialization
initTables();

/**
 * Exports data for a given category, symbol and year into compressed CSV.gz
 */
async function exportToGzipCsv(dataType, symbol, year) {
    const cleanSym = symbol ? symbol.replace(/[^A-Za-z0-9_]/g, "") : dataType.toUpperCase();
    const fileName = `${cleanSym}_${year}_${dataType}.csv.gz`;
    const outputPath = path.join(STAGING_DIR, fileName);

    let countSql = "";
    let countParams = [];
    let rowsSql = "";
    let rowsParams = [];
    let csvHeader = "";

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    if (dataType === "option_chain") {
        countSql = `SELECT COUNT(*) as total FROM option_chain_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`;
        countParams = [symbol, startDate, endDate];
        rowsSql = `
            SELECT id, symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') as trade_date, trade_time,
                   DATE_FORMAT(expiry, '%Y-%m-%d') as expiry, strike, underlying_price,
                   ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                   pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
            FROM option_chain_history
            WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC, trade_time ASC, strike ASC
            LIMIT ? OFFSET ?
        `;
        csvHeader = "id,symbol,trade_date,trade_time,expiry,strike,underlying_price,ce_ltp,ce_oi,ce_oi_change,ce_iv,ce_volume,ce_delta,ce_gamma,ce_theta,ce_vega,pe_ltp,pe_oi,pe_oi_change,pe_iv,pe_volume,pe_delta,pe_gamma,pe_theta,pe_vega\n";
    } else if (dataType === "futures") {
        countSql = `SELECT COUNT(*) as total FROM futures_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`;
        countParams = [symbol, startDate, endDate];
        rowsSql = `
            SELECT id, symbol, DATE_FORMAT(expiry, '%Y-%m-%d') as expiry,
                   DATE_FORMAT(trade_date, '%Y-%m-%d') as trade_date, trade_time,
                   open, high, low, close, volume, oi, oi_change, underlying_price
            FROM futures_history
            WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC, trade_time ASC
            LIMIT ? OFFSET ?
        `;
        csvHeader = "id,symbol,expiry,trade_date,trade_time,open,high,low,close,volume,oi,oi_change,underlying_price\n";
    } else if (dataType === "india_vix") {
        countSql = `
            SELECT COUNT(*) as total FROM ohlcv_data 
            WHERE symbol IN ('INDIA VIX', 'INDIAVIX', 'INDIA_VIX', 'VIX') AND trade_date >= ? AND trade_date <= ?
        `;
        countParams = [startDate, endDate];
        rowsSql = `
            SELECT id, symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') as trade_date, trade_time,
                   open, high, low, close, volume
            FROM ohlcv_data
            WHERE symbol IN ('INDIA VIX', 'INDIAVIX', 'INDIA_VIX', 'VIX') AND trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC, trade_time ASC
            LIMIT ? OFFSET ?
        `;
        csvHeader = "id,symbol,trade_date,trade_time,open,high,low,close,volume\n";
    } else if (dataType === "bitcoin") {
        countSql = `
            SELECT COUNT(*) as total FROM ohlcv_data 
            WHERE symbol IN ('BTCUSDT', 'BTC', 'BITCOIN', 'BTC/USDT') AND trade_date >= ? AND trade_date <= ?
        `;
        countParams = [startDate, endDate];
        rowsSql = `
            SELECT id, symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') as trade_date, trade_time,
                   open, high, low, close, volume
            FROM ohlcv_data
            WHERE symbol IN ('BTCUSDT', 'BTC', 'BITCOIN', 'BTC/USDT') AND trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC, trade_time ASC
            LIMIT ? OFFSET ?
        `;
        csvHeader = "id,symbol,trade_date,trade_time,open,high,low,close,volume\n";
    } else if (dataType === "ohlcv" || dataType === "stock_ohlcv") {
        countSql = `SELECT COUNT(*) as total FROM ohlcv_data WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`;
        countParams = [symbol, startDate, endDate];
        rowsSql = `
            SELECT id, symbol, DATE_FORMAT(trade_date, '%Y-%m-%d') as trade_date, trade_time,
                   open, high, low, close, volume
            FROM ohlcv_data
            WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?
            ORDER BY trade_date ASC, trade_time ASC
            LIMIT ? OFFSET ?
        `;
        csvHeader = "id,symbol,trade_date,trade_time,open,high,low,close,volume\n";
    } else {
        throw new Error(`Unsupported dataType: ${dataType}`);
    }

    const countRes = await db.query(countSql, countParams);
    const totalRecords = countRes[0]?.total || 0;

    if (totalRecords === 0) {
        return { totalRecords: 0, outputPath: null, fileName };
    }

    appendLog(`Exporting ${totalRecords.toLocaleString()} rows for ${symbol || dataType} (${year}) [${dataType}] to compressed CSV...`);

    const gzip = zlib.createGzip({ level: 9 });
    const writeStream = fs.createWriteStream(outputPath);
    
    let streamError = null;
    gzip.on("error", (err) => { streamError = err; });
    writeStream.on("error", (err) => { streamError = err; });
    gzip.pipe(writeStream);

    gzip.write(csvHeader);

    // Stream query in chunks of 15,000 rows
    const chunkSize = 15000;
    let offset = 0;

    while (offset < totalRecords) {
        if (streamError) throw streamError;

        const queryParams = dataType === "india_vix" || dataType === "bitcoin" 
            ? [startDate, endDate, chunkSize, offset]
            : [symbol, startDate, endDate, chunkSize, offset];

        const rows = await db.query(rowsSql, queryParams);
        if (!rows || rows.length === 0) break;

        for (const r of rows) {
            let line = "";
            if (dataType === "option_chain") {
                line = `${r.id},${r.symbol},${r.trade_date},${r.trade_time || ""},${r.expiry},${r.strike},${r.underlying_price || ""},${r.ce_ltp || ""},${r.ce_oi || ""},${r.ce_oi_change || ""},${r.ce_iv || ""},${r.ce_volume || ""},${r.ce_delta || ""},${r.ce_gamma || ""},${r.ce_theta || ""},${r.ce_vega || ""},${r.pe_ltp || ""},${r.pe_oi || ""},${r.pe_oi_change || ""},${r.pe_iv || ""},${r.pe_volume || ""},${r.pe_delta || ""},${r.pe_gamma || ""},${r.pe_theta || ""},${r.pe_vega || ""}\n`;
            } else if (dataType === "futures") {
                line = `${r.id},${r.symbol},${r.expiry || ""},${r.trade_date},${r.trade_time || ""},${r.open || 0},${r.high || 0},${r.low || 0},${r.close || 0},${r.volume || 0},${r.oi || 0},${r.oi_change || 0},${r.underlying_price || ""}\n`;
            } else {
                line = `${r.id},${r.symbol},${r.trade_date},${r.trade_time || ""},${r.open || 0},${r.high || 0},${r.low || 0},${r.close || 0},${r.volume || 0}\n`;
            }
            gzip.write(line);
        }

        offset += rows.length;
    }

    gzip.end();

    await new Promise((resolve, reject) => {
        if (streamError) return reject(streamError);
        writeStream.on("finish", () => {
            if (streamError) reject(streamError);
            else resolve();
        });
        writeStream.on("error", reject);
    });

    const fileSizeBytes = fs.statSync(outputPath).size;
    appendLog(`Created ${fileName} (${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB compressed)`);

    return {
        totalRecords,
        outputPath,
        fileName,
        fileSizeBytes,
    };
}

/**
 * Prunes local database rows after confirmed Google Drive upload to reclaim disk space
 */
async function pruneLocalDb(dataType, symbol, year) {
    appendLog(`Reclaiming Mac disk space: Pruning ${symbol || dataType} (${year}) [${dataType}] from local DB...`);
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    let deleteSql = "";
    let deleteParams = [];
    let tableName = "";

    if (dataType === "option_chain") {
        tableName = "option_chain_history";
        deleteSql = `DELETE FROM option_chain_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`;
        deleteParams = [symbol, startDate, endDate];
    } else if (dataType === "futures") {
        tableName = "futures_history";
        deleteSql = `DELETE FROM futures_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`;
        deleteParams = [symbol, startDate, endDate];
    } else if (dataType === "india_vix") {
        tableName = "ohlcv_data";
        deleteSql = `DELETE FROM ohlcv_data WHERE symbol IN ('INDIA VIX', 'INDIAVIX', 'INDIA_VIX', 'VIX') AND trade_date >= ? AND trade_date <= ?`;
        deleteParams = [startDate, endDate];
    } else if (dataType === "bitcoin") {
        tableName = "ohlcv_data";
        deleteSql = `DELETE FROM ohlcv_data WHERE symbol IN ('BTCUSDT', 'BTC', 'BITCOIN', 'BTC/USDT') AND trade_date >= ? AND trade_date <= ?`;
        deleteParams = [startDate, endDate];
    } else if (dataType === "ohlcv" || dataType === "stock_ohlcv") {
        tableName = "ohlcv_data";
        deleteSql = `DELETE FROM ohlcv_data WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`;
        deleteParams = [symbol, startDate, endDate];
    }

    const deleteRes = await db.query(deleteSql, deleteParams);
    const deletedCount = deleteRes?.affectedRows || 0;

    appendLog(`✅ Pruned ${deletedCount.toLocaleString()} local DB rows for ${symbol || dataType} (${year}). Disk space reclaimed.`);
    return deletedCount;
}

/**
 * Runs a single Category + Symbol + Year Archival Unit
 */
async function processBatch({ dataType = "option_chain", symbol, year, folderId = gdrive.DEFAULT_ROOT_FOLDER_ID, autoPrune = true }) {
    const sym = symbol || (dataType === "india_vix" ? "INDIAVIX" : dataType === "bitcoin" ? "BTCUSDT" : "ALL");
    appendLog(`Starting archival batch: [${dataType.toUpperCase()}] ${sym} - Year ${year}...`);

    // 1. Export from local DB to gzip CSV
    const exportResult = await exportToGzipCsv(dataType, sym, year);

    if (exportResult.totalRecords === 0) {
        appendLog(`No data in local DB for [${dataType}] ${sym} (${year}). Skipping upload.`);
        return { status: "no_data", dataType, symbol: sym, year };
    }

    // 2. Ensure Google Drive Folder Hierarchy: Root -> Category -> Year -> (Symbol)
    appendLog(`Ensuring Google Drive folder hierarchy: ${dataType} / ${year} / ${sym}...`);
    const { targetFolderId } = await gdrive.ensureCategoryYearHierarchy(dataType, year, sym, folderId);

    // 3. Upload to Google Drive
    appendLog(`Uploading ${exportResult.fileName} to Google Drive...`);
    const uploadRes = await gdrive.uploadFile({
        filePath: exportResult.outputPath,
        fileName: exportResult.fileName,
        parentFolderId: targetFolderId,
    });

    appendLog(`✅ Google Drive Upload Complete! File ID: ${uploadRes.fileId}`);

    // 4. Update Database Archive Registry
    await db.query(`
        INSERT INTO gdrive_archive_records
        (symbol, year, data_type, record_count, file_name, file_size_bytes, gdrive_file_id, gdrive_web_link, gdrive_folder_id, status, checksum_sha256, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'archived', ?, NOW())
        ON DUPLICATE KEY UPDATE
        record_count = VALUES(record_count),
        file_name = VALUES(file_name),
        file_size_bytes = VALUES(file_size_bytes),
        gdrive_file_id = VALUES(gdrive_file_id),
        gdrive_web_link = VALUES(gdrive_web_link),
        gdrive_folder_id = VALUES(gdrive_folder_id),
        status = 'archived',
        checksum_sha256 = VALUES(checksum_sha256),
        uploaded_at = NOW(),
        updated_at = NOW()
    `, [
        sym,
        year,
        dataType,
        exportResult.totalRecords,
        exportResult.fileName,
        uploadRes.sizeBytes,
        uploadRes.fileId,
        uploadRes.webViewLink,
        targetFolderId,
        uploadRes.checksumSha256,
    ]);

    // 5. Auto-Prune Local Database if enabled
    if (autoPrune) {
        await pruneLocalDb(dataType, sym, year);
        await db.query(`
            UPDATE gdrive_archive_records
            SET status = 'pruned', pruned_at = NOW()
            WHERE symbol = ? AND year = ? AND data_type = ?
        `, [sym, year, dataType]);
    }

    // Clean up temporary local staging file
    if (fs.existsSync(exportResult.outputPath)) {
        fs.unlinkSync(exportResult.outputPath);
    }

    invalidateMatrixCache();

    return {
        status: "success",
        dataType,
        symbol: sym,
        year,
        records: exportResult.totalRecords,
        fileSize: uploadRes.sizeBytes,
        gdriveFileId: uploadRes.fileId,
        webViewLink: uploadRes.webViewLink,
        pruned: autoPrune,
    };
}

/**
 * Start archival pipeline across selected categories, years, and symbols
 */
async function startArchivalPipeline({
    dataTypes = ["option_chain", "futures", "india_vix", "bitcoin"],
    targetYears = ["2023", "2024"],
    symbols = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "ZYDUSLIFE"],
    autoPrune = true,
    source = "manual",
}) {
    if (activePipeline.isRunning) {
        throw new Error("Archival pipeline is already running.");
    }

    const categories = Array.isArray(dataTypes) ? dataTypes : [dataTypes];
    const years = Array.isArray(targetYears) ? targetYears : [targetYears];
    const symList = Array.isArray(symbols) && symbols.length > 0 ? symbols : ["NIFTY", "BANKNIFTY", "ZYDUSLIFE"];

    // Build execution batches
    const batchList = [];
    for (const cat of categories) {
        for (const yr of years) {
            if (cat === "india_vix") {
                batchList.push({ dataType: "india_vix", symbol: "INDIAVIX", year: parseInt(yr) });
            } else if (cat === "bitcoin") {
                batchList.push({ dataType: "bitcoin", symbol: "BTCUSDT", year: parseInt(yr) });
            } else {
                for (const sym of symList) {
                    batchList.push({ dataType: cat, symbol: sym, year: parseInt(yr) });
                }
            }
        }
    }

    activePipeline = {
        isRunning: true,
        jobId: `archival_${Date.now()}`,
        dataTypes: categories,
        targetYears: years,
        symbols: symList,
        currentSymbol: null,
        currentYear: null,
        currentDataType: null,
        stage: "starting",
        progressPct: 0,
        totalBatches: batchList.length,
        completedBatches: 0,
        logs: [],
        error: null,
        startTime: new Date().toISOString(),
        autoPrune,
    };

    appendLog(`Archival Pipeline started via ${source.toUpperCase()} (${batchList.length} total tasks)...`);

    // Run asynchronously
    (async () => {
        try {
            // Ensure 4 parent category folders exist in Google Drive
            appendLog("Pre-initializing Google Drive folders (Option Chain, Futures, India VIX, Bitcoin)...");
            await gdrive.initAllCategoryFolders().catch((err) => {
                appendLog(`Folder pre-creation notice: ${err.message}`, "warn");
            });

            for (let i = 0; i < batchList.length; i++) {
                if (!activePipeline.isRunning) {
                    appendLog("Pipeline cancelled by admin.", "warn");
                    break;
                }

                const batch = batchList[i];
                activePipeline.currentDataType = batch.dataType;
                activePipeline.currentSymbol = batch.symbol;
                activePipeline.currentYear = batch.year;
                activePipeline.stage = `processing_${batch.dataType}`;

                try {
                    await processBatch({
                        dataType: batch.dataType,
                        symbol: batch.symbol,
                        year: batch.year,
                        autoPrune,
                    });
                } catch (bErr) {
                    appendLog(`Batch failed for [${batch.dataType}] ${batch.symbol} (${batch.year}): ${bErr.message}`, "error");
                }

                activePipeline.completedBatches = i + 1;
                activePipeline.progressPct = Math.round(((i + 1) / batchList.length) * 100);
            }

            activePipeline.stage = "completed";
            appendLog("🎉 All archival tasks finished successfully!");
        } catch (err) {
            activePipeline.stage = "error";
            activePipeline.error = err.message;
            appendLog(`Pipeline error: ${err.message}`, "error");
        } finally {
            activePipeline.isRunning = false;
        }
    })();

    return {
        jobId: activePipeline.jobId,
        started: true,
        totalBatches: batchList.length,
    };
}

function stopPipeline() {
    if (activePipeline.isRunning) {
        activePipeline.isRunning = false;
        activePipeline.stage = "stopped";
        appendLog("Stopping pipeline on user request...", "warn");
        return { stopped: true };
    }
    return { stopped: false, message: "Pipeline was not running." };
}

function getPipelineStatus() {
    return { ...activePipeline };
}

let cachedCoverageMatrix = null;
let matrixCacheExpiresAt = 0;
let isRefreshingMatrix = false;
const MATRIX_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

function invalidateMatrixCache() {
    cachedCoverageMatrix = null;
    matrixCacheExpiresAt = 0;
}

/**
 * Computes the coverage matrix from summary tables & records
 */
async function computeCoverageMatrix() {
    // 1. Fetch Google Drive Archive records (fast)
    const gdriveRows = await db.query(`
        SELECT symbol, year, data_type, record_count, file_name, file_size_bytes, gdrive_file_id, gdrive_web_link, status, checksum_sha256, uploaded_at, pruned_at
        FROM gdrive_archive_records
    `).catch(() => []);

    const gdriveMap = new Map();
    gdriveRows.forEach((r) => {
        gdriveMap.set(`${r.data_type}_${r.symbol}_${r.year}`, {
            fileId: r.gdrive_file_id,
            webLink: r.gdrive_web_link,
            fileName: r.file_name,
            sizeBytes: Number(r.file_size_bytes || 0),
            recordCount: Number(r.record_count || 0),
            status: r.status,
            uploadedAt: r.uploaded_at,
            prunedAt: r.pruned_at,
        });
    });

    // 2. Fetch local DB counts using ultra-fast pre-aggregated summary tables
    let optRows = await db.query(`
        SELECT symbol, YEAR(trade_date) as year, SUM(row_count) as count
        FROM option_chain_coverage_summary 
        WHERE trade_date >= '2023-01-01'
        GROUP BY symbol, YEAR(trade_date)
    `).catch(() => []);

    if (!optRows || optRows.length === 0) {
        optRows = await db.query(`
            SELECT symbol, YEAR(trade_date) as year, COUNT(*) as count
            FROM option_chain_history 
            WHERE trade_date >= '2023-01-01'
            GROUP BY symbol, YEAR(trade_date)
        `).catch(() => []);
    }

    let ohlcvRows = await db.query(`
        SELECT symbol, YEAR(trade_date) as year, SUM(row_count) as count
        FROM ohlcv_coverage_summary 
        WHERE trade_date >= '2023-01-01'
        GROUP BY symbol, YEAR(trade_date)
    `).catch(() => []);

    if (!ohlcvRows || ohlcvRows.length === 0) {
        ohlcvRows = await db.query(`
            SELECT symbol, YEAR(trade_date) as year, COUNT(*) as count
            FROM ohlcv_data 
            WHERE trade_date >= '2023-01-01'
            GROUP BY symbol, YEAR(trade_date)
        `).catch(() => []);
    }

    let futRows = await db.query(`
        SELECT symbol, year, count
        FROM futures_year_coverage
    `).catch(() => []);

    const futDistinct = (!futRows || futRows.length === 0) ? await db.query(`
        SELECT DISTINCT symbol FROM futures_history
    `).catch(() => []) : [];

    const dbMap = new Map();
    const allSymbolStats = new Map();

    function recordSymbolStat(sym, cat, count, isCloud = false) {
        if (!sym) return;
        const s = String(sym).toUpperCase().trim();
        if (!allSymbolStats.has(s)) {
            const isIndex = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"].includes(s);
            const isVol = ["INDIAVIX", "INDIA VIX", "INDIA_VIX", "VIX"].includes(s);
            const isCrypto = ["BTCUSDT", "BTC", "BITCOIN", "BTC/USDT"].includes(s);
            const type = isIndex ? "index" : isVol ? "volatility" : isCrypto ? "crypto" : "stock";
            allSymbolStats.set(s, {
                symbol: s,
                name: s,
                type,
                categories: new Set(),
                localTotal: 0,
                cloudTotal: 0,
            });
        }
        const st = allSymbolStats.get(s);
        st.categories.add(cat);
        if (isCloud) st.cloudTotal += count;
        else st.localTotal += count;
    }

    optRows.forEach((r) => {
        dbMap.set(`option_chain_${r.symbol}_${r.year}`, Number(r.count));
        recordSymbolStat(r.symbol, "option_chain", Number(r.count), false);
    });

    futRows.forEach((r) => {
        dbMap.set(`futures_${r.symbol}_${r.year}`, Number(r.count));
        recordSymbolStat(r.symbol, "futures", Number(r.count), false);
    });

    if (futDistinct && futDistinct.length > 0) {
        futDistinct.forEach((r) => {
            const sym = r.symbol.toUpperCase();
            [2023, 2024, 2025, 2026].forEach((yr) => {
                if (!dbMap.has(`futures_${sym}_${yr}`)) {
                    dbMap.set(`futures_${sym}_${yr}`, 1);
                }
            });
            recordSymbolStat(sym, "futures", 1, false);
        });
    }

    ohlcvRows.forEach((r) => {
        const s = String(r.symbol).toUpperCase();
        if (['INDIA VIX', 'INDIAVIX', 'INDIA_VIX', 'VIX'].includes(s)) {
            const current = dbMap.get(`india_vix_INDIAVIX_${r.year}`) || 0;
            dbMap.set(`india_vix_INDIAVIX_${r.year}`, current + Number(r.count));
            recordSymbolStat("INDIAVIX", "india_vix", Number(r.count), false);
        } else if (['BTCUSDT', 'BTC', 'BITCOIN', 'BTC/USDT'].includes(s)) {
            const current = dbMap.get(`bitcoin_BTCUSDT_${r.year}`) || 0;
            dbMap.set(`bitcoin_BTCUSDT_${r.year}`, current + Number(r.count));
            recordSymbolStat("BTCUSDT", "bitcoin", Number(r.count), false);
        } else {
            const current = dbMap.get(`ohlcv_${s}_${r.year}`) || 0;
            dbMap.set(`ohlcv_${s}_${r.year}`, current + Number(r.count));
            recordSymbolStat(s, "ohlcv", Number(r.count), false);
        }
    });

    gdriveRows.forEach((r) => {
        recordSymbolStat(r.symbol, r.data_type, Number(r.record_count || 0), true);
    });

    const CORE_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
    CORE_INDICES.forEach((idx) => {
        if (!allSymbolStats.has(idx)) {
            allSymbolStats.set(idx, {
                symbol: idx,
                name: idx,
                type: "index",
                categories: new Set(["option_chain", "futures", "ohlcv"]),
                localTotal: 0,
                cloudTotal: 0,
            });
        }
    });

    // Build allAssets list dynamically across all available categories
    const allAssets = [];

    // 1. Option Chain Assets
    const optionSymbols = new Set([...CORE_INDICES]);
    optRows.forEach(r => optionSymbols.add(r.symbol.toUpperCase()));
    gdriveRows.filter(r => r.data_type === "option_chain").forEach(r => optionSymbols.add(r.symbol.toUpperCase()));

    Array.from(optionSymbols).sort((a, b) => {
        const aIdx = CORE_INDICES.includes(a);
        const bIdx = CORE_INDICES.includes(b);
        if (aIdx && !bIdx) return -1;
        if (!aIdx && bIdx) return 1;
        return a.localeCompare(b);
    }).forEach((sym) => {
        allAssets.push({
            category: "option_chain",
            categoryName: "Option Chain",
            symbol: sym,
            name: `${sym} Option Chain`,
            type: CORE_INDICES.includes(sym) ? "index" : "stock",
        });
    });

    // 2. Futures Assets (all 271+ from futRows, futDistinct & CORE_INDICES)
    const futuresSymbols = new Set([...CORE_INDICES]);
    futRows.forEach(r => futuresSymbols.add(r.symbol.toUpperCase()));
    if (futDistinct) futDistinct.forEach(r => futuresSymbols.add(r.symbol.toUpperCase()));
    gdriveRows.filter(r => r.data_type === "futures").forEach(r => futuresSymbols.add(r.symbol.toUpperCase()));

    Array.from(futuresSymbols).sort((a, b) => {
        const aIdx = CORE_INDICES.includes(a);
        const bIdx = CORE_INDICES.includes(b);
        if (aIdx && !bIdx) return -1;
        if (!aIdx && bIdx) return 1;
        return a.localeCompare(b);
    }).forEach((sym) => {
        allAssets.push({
            category: "futures",
            categoryName: "Futures",
            symbol: sym,
            name: `${sym} Futures`,
            type: CORE_INDICES.includes(sym) ? "index" : "futures",
        });
    });

    // 3. Stocks OHLCV Assets
    const ohlcvSymbols = new Set([...CORE_INDICES]);
    ohlcvRows.forEach(r => {
        const s = r.symbol.toUpperCase();
        if (!['INDIA VIX', 'INDIAVIX', 'INDIA_VIX', 'VIX', 'BTCUSDT', 'BTC', 'BITCOIN', 'BTC/USDT'].includes(s)) {
            ohlcvSymbols.add(s);
        }
    });
    gdriveRows.filter(r => r.data_type === "ohlcv" || r.data_type === "stock_ohlcv").forEach(r => ohlcvSymbols.add(r.symbol.toUpperCase()));

    Array.from(ohlcvSymbols).sort((a, b) => {
        const aIdx = CORE_INDICES.includes(a);
        const bIdx = CORE_INDICES.includes(b);
        if (aIdx && !bIdx) return -1;
        if (!aIdx && bIdx) return 1;
        return a.localeCompare(b);
    }).forEach((sym) => {
        allAssets.push({
            category: "ohlcv",
            categoryName: "Stocks OHLCV",
            symbol: sym,
            name: `${sym} 1-Min OHLCV`,
            type: CORE_INDICES.includes(sym) ? "index" : "stock",
        });
    });

    // 4. India VIX
    allAssets.push({
        category: "india_vix",
        categoryName: "India VIX",
        symbol: "INDIAVIX",
        name: "India Volatility Index",
        type: "volatility",
    });

    // 5. Bitcoin
    allAssets.push({
        category: "bitcoin",
        categoryName: "Bitcoin",
        symbol: "BTCUSDT",
        name: "Bitcoin / USDT",
        type: "crypto",
    });

    const years = [2023, 2024, 2025, 2026];

    const matrix = allAssets.map((asset) => {
        const yearData = {};

        years.forEach((yr) => {
            const key = `${asset.category}_${asset.symbol}_${yr}`;
            const localCount = dbMap.get(key) || 0;
            const cloud = gdriveMap.get(key) || null;

            let status = "pending";
            if (cloud?.status === "pruned" || cloud?.status === "archived") {
                status = "gdrive_archived";
            } else if (localCount > 0) {
                status = "local_db";
            }

            yearData[yr] = {
                status,
                localCount,
                cloudRecords: cloud?.recordCount || 0,
                cloudFileId: cloud?.fileId || null,
                cloudWebLink: cloud?.webLink || null,
                cloudSizeBytes: cloud?.sizeBytes || 0,
                uploadedAt: cloud?.uploadedAt || null,
            };
        });

        return {
            category: asset.category,
            categoryName: asset.categoryName,
            symbol: asset.symbol,
            name: asset.name,
            type: asset.type,
            years: yearData,
        };
    });

    // Available symbols list for UI filter & selection
    const availableSymbols = Array.from(allSymbolStats.values()).map(st => ({
        symbol: st.symbol,
        name: st.name,
        type: st.type,
        categories: Array.from(st.categories),
        hasLocalData: st.localTotal > 0,
        hasCloudData: st.cloudTotal > 0,
        localTotal: st.localTotal,
        cloudTotal: st.cloudTotal,
    })).sort((a, b) => {
        const aIdx = CORE_INDICES.includes(a.symbol);
        const bIdx = CORE_INDICES.includes(b.symbol);
        if (aIdx && !bIdx) return -1;
        if (!aIdx && bIdx) return 1;
        if (a.hasLocalData && !b.hasLocalData) return -1;
        if (!a.hasLocalData && b.hasLocalData) return 1;
        return a.symbol.localeCompare(b.symbol);
    });

    const result = {
        timestamp: new Date().toISOString(),
        categories: [
            { key: "option_chain", name: "Option Chain", folder: "Option Chain" },
            { key: "futures", name: "Futures", folder: "Futures" },
            { key: "ohlcv", name: "Stocks OHLCV", folder: "Stocks OHLCV" },
            { key: "india_vix", name: "India VIX", folder: "India VIX" },
            { key: "bitcoin", name: "Bitcoin", folder: "Bitcoin" },
        ],
        years,
        availableSymbols,
        matrix,
    };

    cachedCoverageMatrix = result;
    matrixCacheExpiresAt = Date.now() + MATRIX_CACHE_TTL_MS;
    return result;
}

/**
 * Returns multi-asset Year-wise Cloud Archive & Local DB Matrix instantly from memory cache
 */
async function getCloudCoverageMatrix(selectedCategory = "all", forceRefresh = false) {
    if (cachedCoverageMatrix && !forceRefresh) {
        // Stale-while-revalidate: if cache is expired, trigger background recalculation
        if (Date.now() >= matrixCacheExpiresAt && !isRefreshingMatrix) {
            isRefreshingMatrix = true;
            computeCoverageMatrix()
                .catch((e) => console.error("[CoverageMatrix] Background refresh error:", e.message))
                .finally(() => { isRefreshingMatrix = false; });
        }
        return cachedCoverageMatrix;
    }

    // First cold run or forceRefresh
    isRefreshingMatrix = true;
    try {
        const res = await computeCoverageMatrix();
        return res;
    } finally {
        isRefreshingMatrix = false;
    }
}

// Background eager pre-warm
setTimeout(() => {
    computeCoverageMatrix().catch((e) => console.log("[CoverageMatrix] Pre-warm notice:", e.message));
}, 1500);

async function archiveAndPruneSymbolYear(dataType, symbol, year, autoPrune = true) {
    try {
        console.log(`[AutoGDrive] Archiving & Pruning ${symbol} (${year}) [${dataType}] to Google Drive...`);
        const res = await processBatch({
            dataType,
            symbol,
            year: Number(year),
            autoPrune: Boolean(autoPrune),
        });
        console.log(`[AutoGDrive] ✅ Successfully archived & freed disk for ${symbol} (${year}) [${dataType}]! File ID: ${res.gdriveFileId}`);
        return res;
    } catch (err) {
        console.error(`[AutoGDrive] ❌ Failed to archive ${symbol} (${year}) to Google Drive:`, err.message);
        return { status: "error", error: err.message };
    }
}

module.exports = {
    startArchivalPipeline,
    stopPipeline,
    getPipelineStatus,
    getCloudCoverageMatrix,
    processBatch,
    archiveAndPruneSymbolYear,
    exportToGzipCsv,
    pruneLocalDb,
    initTables,
};

if (require.main === module) {
    const [dataType, symbol, year] = process.argv.slice(2);
    if (!dataType || !symbol || !year) {
        console.error("Usage: node archivalPipelineService.js <dataType> <symbol> <year> [autoPrune]");
        process.exit(1);
    }
    archiveAndPruneSymbolYear(dataType, symbol, year, true).then(() => process.exit(0)).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
