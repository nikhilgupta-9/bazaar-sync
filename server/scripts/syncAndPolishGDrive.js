// scripts/syncAndPolishGDrive.js — Standalone CLI Tool to Merge, Polish ATM ±30, and Sync Data with Google Drive
// Usage: node server/scripts/syncAndPolishGDrive.js [symbol] [year] [dataType]
// Examples:
//   node server/scripts/syncAndPolishGDrive.js NIFTY 2024 option_chain
//   node server/scripts/syncAndPolishGDrive.js --all
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const archivalPipeline = require("../services/archivalPipelineService");
const gdrive = require("../services/googleDriveService");

async function main() {
    console.log("==========================================================");
    console.log("   BazaarSync Cloud Smart Merge & ATM ±30 Polish Tool     ");
    console.log("==========================================================");

    const args = process.argv.slice(2);
    const isAll = args.includes("--all");

    // 1. Verify Google Drive Connection
    console.log("[1/3] Testing Google Drive cloud connection...");
    const conn = await gdrive.testConnection().catch((err) => ({ connected: false, error: err.message }));
    if (!conn.connected) {
        console.error("❌ Google Drive is not connected! Error:", conn.error);
        console.error("Please connect Google Drive in Admin Settings or provide OAuth credentials.");
        process.exit(1);
    }
    console.log(`✅ Google Drive Connected! Root Folder: ${conn.folderName || conn.folderId}`);

    // 2. Determine target tasks
    if (isAll) {
        console.log("[2/3] Starting full multi-asset pipeline (Option Chain, Futures, VIX, Bitcoin) for 2023-2026...");
        const res = await archivalPipeline.startArchivalPipeline({
            dataTypes: ["option_chain", "futures", "india_vix", "bitcoin"],
            targetYears: ["2023", "2024", "2025", "2026"],
            symbols: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"],
            autoPrune: false, // keep local DB safe during CLI run unless explicitly requested
            source: "cli",
        });
        console.log("Pipeline launched successfully:", res);
        process.exit(0);
    }

    const symbol = (args[0] && !args[0].startsWith("--")) ? args[0].toUpperCase() : "NIFTY";
    const year = (args[1] && !args[1].startsWith("--")) ? parseInt(args[1], 10) : 2024;
    const dataType = (args[2] && !args[2].startsWith("--")) ? args[2] : "option_chain";
    const autoPrune = args.includes("--prune");

    console.log(`[2/3] Target Task: [${dataType.toUpperCase()}] ${symbol} (Year ${year}) [AutoPrune=${autoPrune}]`);
    console.log("[3/3] Running Smart Cloud Merge, Duplicate Elimination & ATM ±30 Polish...");

    try {
        const result = await archivalPipeline.processBatch({
            dataType,
            symbol,
            year,
            autoPrune,
        });

        console.log("==========================================================");
        if (result.status === "success") {
            console.log("✅ SUCCESSFUL SMART MERGE & UPLOAD!");
            console.log(`- Final Total Records: ${result.records.toLocaleString()}`);
            console.log(`- Duplicates Eliminated: ${result.duplicatesMerged.toLocaleString()}`);
            console.log(`- Compressed File Size: ${(result.fileSize / (1024 * 1024)).toFixed(2)} MB`);
            console.log(`- Google Drive File ID: ${result.gdriveFileId}`);
            console.log(`- Web Link: ${result.webViewLink || "N/A"}`);
            if (result.polishStats) {
                console.log(`- ATM ±30 Snapshots Complete: ${result.polishStats.fullAtm30CoverageSnapshots} / ${result.polishStats.totalSnapshots}`);
                console.log(`- Average Strikes / Snapshot: ${result.polishStats.averageStrikesPerSnapshot}`);
            }
        } else {
            console.log("Notice:", result.status);
        }
        console.log("==========================================================");
        process.exit(0);
    } catch (err) {
        console.error("❌ Archival failed:", err);
        process.exit(1);
    }
}

main();
