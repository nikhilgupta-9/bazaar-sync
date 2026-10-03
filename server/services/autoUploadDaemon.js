// services/autoUploadDaemon.js — Continuous Background Auto-Upload Daemon to Google Drive
// Automatically detects downloaded symbols in MySQL, exports to gzip CSV, uploads to Google Drive, and safely prunes local DB.
const db = require("../config/db");
const archivalPipeline = require("./archivalPipelineService");
const gdrive = require("./googleDriveService");

let isRunning = false;
let isCycleActive = false;
let checkIntervalMs = 60 * 1000; // Check every 60 seconds
let timerId = null;
let lastProcessedSymbol = null;
let totalUploadedInSession = 0;
let lastCycleTime = null;
let currentSettings = {
    enabled: true,
    autoPrune: true,
    targetCategories: ["option_chain", "futures"],
};

/**
 * Scan for symbols & years that have data in local MySQL and have not been archived yet
 */
async function findPendingSymbols() {
    const pending = [];
    const YEARS = ["2023", "2024", "2025", "2026"];

    try {
        // 1. Check Option Chain
        const optSymbols = await db.query(`SELECT DISTINCT symbol FROM option_chain_history`).catch(() => []);
        for (const { symbol } of optSymbols) {
            if (!symbol) continue;
            for (const yr of YEARS) {
                const [c] = await db.query(
                    `SELECT COUNT(*) as cnt FROM option_chain_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`,
                    [symbol, `${yr}-01-01`, `${yr}-12-31`]
                ).catch(() => [{ cnt: 0 }]);
                const count = Number(c?.cnt || 0);
                if (count > 0) {
                    pending.push({ dataType: "option_chain", symbol, year: yr, count });
                }
            }
        }

        // 2. Check Futures
        const futSymbols = await db.query(`SELECT DISTINCT symbol FROM futures_history`).catch(() => []);
        for (const { symbol } of futSymbols) {
            if (!symbol) continue;
            for (const yr of YEARS) {
                const [c] = await db.query(
                    `SELECT COUNT(*) as cnt FROM futures_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`,
                    [symbol, `${yr}-01-01`, `${yr}-12-31`]
                ).catch(() => [{ cnt: 0 }]);
                const count = Number(c?.cnt || 0);
                if (count > 0) {
                    pending.push({ dataType: "futures", symbol, year: yr, count });
                }
            }
        }
    } catch (err) {
        console.error("[AutoUploadDaemon] Error finding pending symbols:", err.message);
    }

    return pending;
}

/**
 * Run a single auto-upload cycle
 */
async function runCycle() {
    if (isCycleActive) return;
    isCycleActive = true;
    lastCycleTime = new Date().toISOString();

    try {
        // Verify Google Drive connection first
        const connTest = await gdrive.testConnection().catch(() => ({ connected: false }));
        if (!connTest.connected) {
            console.warn("[AutoUploadDaemon] Google Drive not connected or token expired. Pausing cycle.");
            return;
        }

        const pending = await findPendingSymbols();
        if (pending.length === 0) {
            return;
        }

        console.log(`[AutoUploadDaemon] Found ${pending.length} pending asset-year batches to upload to Google Drive.`);

        // Process up to 3 batches per cycle to avoid blocking other tasks
        const toProcess = pending.slice(0, 3);
        for (const item of toProcess) {
            console.log(`[AutoUploadDaemon] 🚀 Auto-uploading [${item.dataType.toUpperCase()}] ${item.symbol} (${item.year}) [${item.count.toLocaleString()} rows] to Google Drive...`);
            lastProcessedSymbol = `${item.symbol} (${item.year})`;

            try {
                const result = await archivalPipeline.processBatch({
                    dataType: item.dataType,
                    symbol: item.symbol,
                    year: item.year,
                    autoPrune: currentSettings.autoPrune,
                });

                if (result.status === "success") {
                    totalUploadedInSession += 1;
                    console.log(`[AutoUploadDaemon] ✅ Successfully archived & pruned [${item.dataType}] ${item.symbol} (${item.year}) -> File: ${result.webViewLink || result.gdriveFileId}`);
                }
            } catch (batchErr) {
                console.error(`[AutoUploadDaemon] ❌ Failed to auto-upload ${item.symbol} (${item.year}):`, batchErr.message);
            }
        }
    } catch (err) {
        console.error("[AutoUploadDaemon] Cycle error:", err.message);
    } finally {
        isCycleActive = false;
    }
}

/**
 * Start daemon
 */
function start() {
    if (isRunning) return;
    isRunning = true;
    console.log("[AutoUploadDaemon] Google Drive Auto-Upload Daemon STARTED. Monitoring local DB for new data...");
    
    // Initial cycle after 5 seconds
    setTimeout(() => {
        runCycle();
    }, 5000);

    timerId = setInterval(() => {
        runCycle();
    }, checkIntervalMs);
}

/**
 * Stop daemon
 */
function stop() {
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
    isRunning = false;
    console.log("[AutoUploadDaemon] Google Drive Auto-Upload Daemon STOPPED.");
}

/**
 * Status
 */
function getStatus() {
    return {
        isRunning,
        isCycleActive,
        totalUploadedInSession,
        lastProcessedSymbol,
        lastCycleTime,
        checkIntervalMs,
        settings: currentSettings,
    };
}

module.exports = {
    start,
    stop,
    getStatus,
    runCycle,
};
