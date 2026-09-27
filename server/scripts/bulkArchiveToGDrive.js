// scripts/bulkArchiveToGDrive.js — Bulk Archives existing MySQL historical data to Google Drive & Reclaims Disk Space
// Usage: node scripts/bulkArchiveToGDrive.js [YEAR] [--prune] [--data-type=option_chain]
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { pool } = require("../config/db");
const archivalService = require("../services/archivalPipelineService");
const gdrive = require("../services/googleDriveService");

async function main() {
    const args = process.argv.slice(2);
    const flags = {};
    const positionals = [];
    for (const a of args) {
        if (a.startsWith("--")) {
            const [k, v] = a.slice(2).split("=");
            flags[k] = v === undefined ? true : v;
        } else {
            positionals.push(a);
        }
    }

    console.log("==================================================================");
    console.log("🚀 BAZAAR-SYNC BULK GOOGLE DRIVE ARCHIVAL & DISK RECLAIM TOOL");
    console.log("==================================================================");

    // Verify Google Drive connection
    const status = await gdrive.getStatus();
    if (!status.configured) {
        console.error("❌ Google Drive is not configured! Check server/config/google_oauth.json");
        process.exit(1);
    }
    console.log(`✅ Google Drive connected: ${status.userEmail || "Configured"} (${status.authType})`);
    console.log(`☁️ Root Folder: ${status.rootFolderId || "Root"}`);

    const targetYear = positionals[0] ? Number(positionals[0]) : null;
    const shouldPrune = flags.prune !== false; // default to true to reclaim disk space
    const targetType = flags["data-type"] || flags.dataType || "option_chain";

    console.log(`📦 Target Asset Type: ${targetType.toUpperCase()}`);
    console.log(`📅 Target Year: ${targetYear ? targetYear : "ALL YEARS (2023, 2024, etc.)"}`);
    console.log(`🧹 Auto-Prune Local MySQL Rows: ${shouldPrune ? "YES (Will Free Disk Space)" : "NO"}`);
    console.log("------------------------------------------------------------------");

    // Discover all distinct (symbol, year) combinations in option_chain_history
    let query = `
        SELECT symbol, YEAR(trade_date) as yr, COUNT(*) as cnt
        FROM option_chain_history
        ${targetYear ? `WHERE YEAR(trade_date) = ${targetYear}` : ""}
        GROUP BY symbol, YEAR(trade_date)
        ORDER BY yr, symbol
    `;

    if (targetType === "futures") {
        query = `
            SELECT symbol, YEAR(trade_date) as yr, COUNT(*) as cnt
            FROM futures_history
            ${targetYear ? `WHERE YEAR(trade_date) = ${targetYear}` : ""}
            GROUP BY symbol, YEAR(trade_date)
            ORDER BY yr, symbol
        `;
    }

    console.log("🔍 Scanning local database for existing data...");
    const [rows] = await pool.query(query);

    if (!rows.length) {
        console.log("✨ No records found to archive.");
        process.exit(0);
    }

    const totalRows = rows.reduce((acc, r) => acc + Number(r.cnt), 0);
    console.log(`📊 Found ${rows.length} symbol/year batches (Total ~${totalRows.toLocaleString()} rows).`);
    console.log("------------------------------------------------------------------");

    let processed = 0;
    let successful = 0;
    let failed = 0;

    for (const item of rows) {
        processed++;
        const { symbol, yr, cnt } = item;
        console.log(`\n[${processed}/${rows.length}] Processing ${symbol} (${yr}) — ${Number(cnt).toLocaleString()} rows...`);

        try {
            const result = await archivalService.archiveAndPruneSymbolYear(targetType, symbol, yr, shouldPrune);
            if (result.success) {
                successful++;
                console.log(`✅ Completed ${symbol} (${yr}): Uploaded to GDrive (File ID: ${result.gdriveFileId})`);
                if (shouldPrune) {
                    console.log(`🧹 Pruned local rows & reclaimed local disk space.`);
                }
            } else {
                failed++;
                console.error(`❌ Failed ${symbol} (${yr}): ${result.error}`);
            }
        } catch (err) {
            failed++;
            console.error(`❌ Error archiving ${symbol} (${yr}):`, err.message);
        }
    }

    console.log("\n==================================================================");
    console.log(`🎉 BULK ARCHIVAL FINISHED:`);
    console.log(`- Total Batches Processed: ${processed}`);
    console.log(`- Successful: ${successful}`);
    console.log(`- Failed: ${failed}`);
    console.log(`- Local Disk Space Reclaimed: ${shouldPrune ? "YES" : "NO"}`);
    console.log("==================================================================");

    process.exit(0);
}

main().catch((err) => {
    console.error("Fatal error during bulk archive:", err);
    process.exit(1);
});
