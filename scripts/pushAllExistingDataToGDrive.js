// scripts/pushAllExistingDataToGDrive.js — Push all existing DB data (Futures, OHLCV, Option Chain, VIX, Bitcoin) to Google Drive & auto-prune
const db = require("../server/config/db");
const archival = require("../server/services/archivalPipelineService");
const gdrive = require("../server/services/googleDriveService");

async function main() {
    console.log("==================================================================");
    console.log("  🚀 Google Drive Cloud Archival — Push All Existing Local DB Data");
    console.log("==================================================================\n");

    // 1. Test Google Drive Connection
    console.log("[1/3] Testing Google Drive connection...");
    const conn = await gdrive.testConnection();
    if (!conn.connected) {
        console.error("❌ Google Drive connection failed:", conn.error);
        process.exit(1);
    }
    console.log(`✅ Connected to Google Drive! Target Folder: "${conn.folderName || conn.folderId}" (Free Space: ${(conn.storageQuota.freeBytes / (1024**4)).toFixed(2)} TB)\n`);

    // 2. Discover all distinct symbols and years in local DB using Index Queries
    console.log("[2/3] Scanning local MySQL database for all existing data batches...");

    const tasks = [];
    const YEARS = ["2023", "2024", "2025", "2026"];

    // 2a. Option Chain History
    console.log(" -> Checking Option Chain data...");
    const optSymbols = await db.query(`SELECT DISTINCT symbol FROM option_chain_history`).catch(() => []);
    for (const { symbol } of optSymbols) {
        if (!symbol) continue;
        for (const year of YEARS) {
            const startDate = `${year}-01-01`;
            const endDate = `${year}-12-31`;
            const [c] = await db.query(
                `SELECT COUNT(*) as cnt FROM option_chain_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`,
                [symbol, startDate, endDate]
            ).catch(() => [{ cnt: 0 }]);

            const count = Number(c?.cnt || 0);
            if (count > 0) {
                tasks.push({ dataType: "option_chain", symbol, year, count });
            }
        }
    }

    // 2b. Futures History (251+ symbols)
    console.log(" -> Checking Futures data...");
    const futSymbols = await db.query(`SELECT DISTINCT symbol FROM futures_history`).catch(() => []);
    for (const { symbol } of futSymbols) {
        if (!symbol) continue;
        for (const year of YEARS) {
            const startDate = `${year}-01-01`;
            const endDate = `${year}-12-31`;
            const [c] = await db.query(
                `SELECT COUNT(*) as cnt FROM futures_history WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`,
                [symbol, startDate, endDate]
            ).catch(() => [{ cnt: 0 }]);

            const count = Number(c?.cnt || 0);
            if (count > 0) {
                tasks.push({ dataType: "futures", symbol, year, count });
            }
        }
    }

    // 2c. Stocks OHLCV Minute Data (271+ symbols)
    console.log(" -> Checking Stocks OHLCV minute data...");
    const ohlcvSymbols = await db.query(`SELECT DISTINCT symbol FROM ohlcv_data`).catch(() => []);
    const specialSymbols = ['INDIA VIX', 'INDIAVIX', 'INDIA_VIX', 'VIX', 'BTCUSDT', 'BTC', 'BITCOIN', 'BTC/USDT'];
    for (const { symbol } of ohlcvSymbols) {
        if (!symbol || specialSymbols.includes(symbol.toUpperCase())) continue;
        for (const year of YEARS) {
            const startDate = `${year}-01-01`;
            const endDate = `${year}-12-31`;
            const [c] = await db.query(
                `SELECT COUNT(*) as cnt FROM ohlcv_data WHERE symbol = ? AND trade_date >= ? AND trade_date <= ?`,
                [symbol, startDate, endDate]
            ).catch(() => [{ cnt: 0 }]);

            const count = Number(c?.cnt || 0);
            if (count > 0) {
                tasks.push({ dataType: "ohlcv", symbol, year, count });
            }
        }
    }

    // 2d. India VIX (2015-2026)
    console.log(" -> Checking India VIX data...");
    const VIX_YEARS = ["2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
    for (const year of VIX_YEARS) {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;
        const [vix] = await db.query(
            `SELECT COUNT(*) as cnt FROM ohlcv_data WHERE symbol IN ('INDIA VIX', 'INDIAVIX', 'INDIA_VIX', 'VIX') AND trade_date >= ? AND trade_date <= ?`,
            [startDate, endDate]
        ).catch(() => [{ cnt: 0 }]);

        if (Number(vix?.cnt || 0) > 0) {
            tasks.push({ dataType: "india_vix", symbol: "INDIAVIX", year, count: Number(vix.cnt) });
        }
    }

    // 2e. Bitcoin (2023-2026)
    console.log(" -> Checking Bitcoin data...");
    for (const year of YEARS) {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;
        const [btc] = await db.query(
            `SELECT COUNT(*) as cnt FROM ohlcv_data WHERE symbol IN ('BTCUSDT', 'BTC', 'BITCOIN', 'BTC/USDT') AND trade_date >= ? AND trade_date <= ?`,
            [startDate, endDate]
        ).catch(() => [{ cnt: 0 }]);

        if (Number(btc?.cnt || 0) > 0) {
            tasks.push({ dataType: "bitcoin", symbol: "BTCUSDT", year, count: Number(btc.cnt) });
        }
    }

    const totalRowsToUpload = tasks.reduce((s, t) => s + t.count, 0);
    console.log(`\n✅ Total batches found across all categories: ${tasks.length} (totaling ${totalRowsToUpload.toLocaleString()} records).\n`);

    if (tasks.length === 0) {
        console.log("No pending batches found in local database. Everything is already archived!");
        process.exit(0);
    }

    // 3. Process and push each batch
    console.log(`[3/3] Starting compression, Google Drive upload & auto-prune for ${tasks.length} batches...\n`);

    let successCount = 0;
    let failCount = 0;
    let totalUploadedBytes = 0;

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        console.log(`[${i + 1}/${tasks.length}] Archiving [${task.dataType.toUpperCase()}] ${task.symbol} (${task.year}) [${task.count.toLocaleString()} rows]...`);

        try {
            const res = await archival.processBatch({
                dataType: task.dataType,
                symbol: task.symbol,
                year: task.year,
                autoPrune: true,
            });

            if (res.status === "success") {
                successCount++;
                totalUploadedBytes += res.fileSize || 0;
                console.log(`  ✓ Uploaded to Google Drive! File ID: ${res.gdriveFileId} | Link: ${res.webViewLink}`);
                console.log(`  ✓ Local DB rows pruned & Mac disk space reclaimed.\n`);
            } else {
                console.log(`  ℹ Status: ${res.status}\n`);
            }
        } catch (err) {
            failCount++;
            console.error(`  ❌ Failed to archive ${task.symbol} (${task.year}): ${err.message}\n`);
        }
    }

    console.log("==================================================================");
    console.log(`🎉 Cloud Archival Complete!`);
    console.log(`   - Total Batches Processed: ${tasks.length}`);
    console.log(`   - Successful Uploads: ${successCount}`);
    console.log(`   - Failures: ${failCount}`);
    console.log(`   - Total Compressed Data Uploaded: ${(totalUploadedBytes / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`   - Database marked as 'archived' & 'pruned'`);
    console.log("==================================================================");

    process.exit(0);
}

main().catch((err) => {
    console.error("Fatal error during archival:", err);
    process.exit(1);
});
