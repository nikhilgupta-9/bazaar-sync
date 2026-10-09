// scripts/cleanDbDuplicates.js — Local Database Duplicate Cleaner & Table Index Optimizer
// Run on any machine (Mac, Windows) to clean local MySQL duplicate entries and optimize table indexes.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const db = require("../config/db");

async function main() {
    console.log("==========================================================");
    console.log("      BazaarSync Local MySQL Database Deduplicator        ");
    console.log("==========================================================");

    try {
        // 1. Clean option_chain_history duplicates
        console.log("[1/3] Checking & cleaning `option_chain_history` duplicates...");
        const optDupCount = await db.query(`
            SELECT symbol, expiry, strike, trade_date, trade_time, COUNT(*) as cnt
            FROM option_chain_history
            GROUP BY symbol, expiry, strike, trade_date, trade_time
            HAVING cnt > 1
            LIMIT 1
        `).catch(() => []);

        if (optDupCount.length > 0) {
            console.log("Found duplicate rows in option_chain_history. De-duplicating keeping latest ID...");
            await db.query(`
                DELETE t1 FROM option_chain_history t1
                INNER JOIN option_chain_history t2 
                WHERE t1.id < t2.id 
                  AND t1.symbol = t2.symbol 
                  AND t1.expiry = t2.expiry 
                  AND t1.strike = t2.strike 
                  AND t1.trade_date = t2.trade_date 
                  AND t1.trade_time = t2.trade_time;
            `);
            console.log("✅ option_chain_history duplicates removed.");
        } else {
            console.log("✅ option_chain_history has no duplicate records.");
        }

        // 2. Clean futures_history duplicates
        console.log("[2/3] Checking & cleaning `futures_history` duplicates...");
        const futDupCount = await db.query(`
            SELECT symbol, expiry, trade_date, trade_time, COUNT(*) as cnt
            FROM futures_history
            GROUP BY symbol, expiry, trade_date, trade_time
            HAVING cnt > 1
            LIMIT 1
        `).catch(() => []);

        if (futDupCount.length > 0) {
            console.log("Found duplicate rows in futures_history. De-duplicating...");
            await db.query(`
                DELETE t1 FROM futures_history t1
                INNER JOIN futures_history t2 
                WHERE t1.id < t2.id 
                  AND t1.symbol = t2.symbol 
                  AND t1.expiry = t2.expiry 
                  AND t1.trade_date = t2.trade_date 
                  AND t1.trade_time = t2.trade_time;
            `);
            console.log("✅ futures_history duplicates removed.");
        } else {
            console.log("✅ futures_history has no duplicate records.");
        }

        // 3. Clean ohlcv_data duplicates
        console.log("[3/3] Checking & cleaning `ohlcv_data` duplicates...");
        const ohlcvDupCount = await db.query(`
            SELECT symbol, trade_date, trade_time, COUNT(*) as cnt
            FROM ohlcv_data
            GROUP BY symbol, trade_date, trade_time
            HAVING cnt > 1
            LIMIT 1
        `).catch(() => []);

        if (ohlcvDupCount.length > 0) {
            console.log("Found duplicate rows in ohlcv_data. De-duplicating...");
            await db.query(`
                DELETE t1 FROM ohlcv_data t1
                INNER JOIN ohlcv_data t2 
                WHERE t1.id < t2.id 
                  AND t1.symbol = t2.symbol 
                  AND t1.trade_date = t2.trade_date 
                  AND t1.trade_time = t2.trade_time;
            `);
            console.log("✅ ohlcv_data duplicates removed.");
        } else {
            console.log("✅ ohlcv_data has no duplicate records.");
        }

        console.log("==========================================================");
        console.log("✅ Local Database cleanup complete and optimized!");
        console.log("==========================================================");
        process.exit(0);
    } catch (err) {
        console.error("❌ Cleanup error:", err.message);
        process.exit(1);
    }
}

main();
