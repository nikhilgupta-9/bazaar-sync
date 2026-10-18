// server/scripts/optimizeOptionChainHistory.js
// Safe indexing and zero-data-loss MySQL Range Partitioning (by Year) for option_chain_history.

const { pool } = require("../config/db");

const PARTITION_SQL = `
ALTER TABLE option_chain_history
PARTITION BY RANGE (YEAR(trade_date)) (
    PARTITION p2020 VALUES LESS THAN (2021),
    PARTITION p2021 VALUES LESS THAN (2022),
    PARTITION p2022 VALUES LESS THAN (2023),
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027),
    PARTITION p2027 VALUES LESS THAN (2028),
    PARTITION p_future VALUES LESS THAN MAXVALUE
);
`;

async function main() {
    const isApply = process.argv.includes("--apply") || process.argv.includes("--execute");

    console.log("==================================================================");
    console.log("  MySQL Optimization & Range Partitioning: option_chain_history   ");
    console.log(`  Mode: ${isApply ? "EXECUTE (APPLYING CHANGES)" : "DRY-RUN (SAFETY CHECK ONLY)"}`);
    console.log("==================================================================\n");

    try {
        // 1. Verify Database Connection and Database Name
        const [[dbRes]] = await pool.query("SELECT DATABASE() AS currentDb");
        const currentDb = dbRes?.currentDb;
        if (!currentDb) {
            console.error("❌ Error: No active database selected in MySQL pool connection.");
            process.exit(1);
        }
        console.log(`[Info] Connected to database: ${currentDb}`);

        // 2. Check if option_chain_history exists
        const [tables] = await pool.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'option_chain_history'",
            [currentDb]
        );
        if (tables.length === 0) {
            console.error("❌ Error: Table 'option_chain_history' does not exist in database:", currentDb);
            process.exit(1);
        }

        const [[countRes]] = await pool.query("SELECT COUNT(*) AS totalRows FROM option_chain_history");
        console.log(`[Info] Table option_chain_history found with ${Number(countRes.totalRows).toLocaleString()} row(s).\n`);

        // 3. Check for composite index idx_sym_exp_date_strike_time
        console.log("[Step 1/3] Checking composite index 'idx_sym_exp_date_strike_time'...");
        const [indexRows] = await pool.query(
            "SHOW INDEX FROM option_chain_history WHERE Key_name = 'idx_sym_exp_date_strike_time'"
        );

        if (indexRows.length > 0) {
            console.log("  ✅ Composite index 'idx_sym_exp_date_strike_time' already exists.");
        } else {
            console.log("  ⚠️ Composite index 'idx_sym_exp_date_strike_time' is missing.");
            if (isApply) {
                console.log("  🚀 Creating composite index 'idx_sym_exp_date_strike_time' (symbol, expiry, trade_date, trade_time, strike)...");
                const startIdx = Date.now();
                await pool.query(
                    "ALTER TABLE option_chain_history ADD INDEX idx_sym_exp_date_strike_time (symbol, expiry, trade_date, trade_time, strike)"
                );
                console.log(`  ✅ Composite index created successfully in ${((Date.now() - startIdx) / 1000).toFixed(2)}s.`);
            } else {
                console.log("  ℹ️ [Dry-Run] SQL: ALTER TABLE option_chain_history ADD INDEX idx_sym_exp_date_strike_time (symbol, expiry, trade_date, trade_time, strike);");
            }
        }

        // 4. Check Partition Status
        console.log("\n[Step 2/3] Checking table partition status...");
        const [partitionRows] = await pool.query(
            `SELECT PARTITION_NAME, PARTITION_ORDINAL_POSITION, TABLE_ROWS
             FROM information_schema.PARTITIONS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'option_chain_history' AND PARTITION_NAME IS NOT NULL`,
            [currentDb]
        );

        if (partitionRows.length > 0) {
            console.log("  ✅ Table is already partitioned into:", partitionRows.map(p => p.PARTITION_NAME).join(", "));
            console.log("  Skipping partition migration.\n");
        } else {
            console.log("  ⚠️ Table is NOT partitioned yet.");

            // Inspect PRIMARY KEY
            console.log("\n[Step 3/3] Inspecting PRIMARY KEY compatibility for Range Partitioning...");
            const [pkRows] = await pool.query(
                `SELECT COLUMN_NAME, ORDINAL_POSITION
                 FROM information_schema.KEY_COLUMN_USAGE
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'option_chain_history' AND CONSTRAINT_NAME = 'PRIMARY'
                 ORDER BY ORDINAL_POSITION ASC`,
                [currentDb]
            );
            const pkColumns = pkRows.map(r => r.COLUMN_NAME);
            console.log(`  Current PRIMARY KEY: (${pkColumns.join(", ")})`);

            const hasTradeDateInPk = pkColumns.includes("trade_date");

            if (!hasTradeDateInPk) {
                console.log("  MySQL Rule: When partitioning by RANGE(YEAR(trade_date)), PRIMARY KEY must include 'trade_date'.");
                if (isApply) {
                    console.log("  🚀 Altering PRIMARY KEY to (id, trade_date)...");
                    const startPk = Date.now();
                    await pool.query("ALTER TABLE option_chain_history DROP PRIMARY KEY, ADD PRIMARY KEY (id, trade_date)");
                    console.log(`  ✅ PRIMARY KEY successfully updated in ${((Date.now() - startPk) / 1000).toFixed(2)}s.`);
                } else {
                    console.log("  ℹ️ [Dry-Run] SQL: ALTER TABLE option_chain_history DROP PRIMARY KEY, ADD PRIMARY KEY (id, trade_date);");
                }
            } else {
                console.log("  ✅ PRIMARY KEY already includes 'trade_date'.");
            }

            if (isApply) {
                console.log("  🚀 Applying Range Partitioning by YEAR(trade_date)...");
                const startPart = Date.now();
                await pool.query(PARTITION_SQL);
                console.log(`  ✅ Partitioning successfully applied in ${((Date.now() - startPart) / 1000).toFixed(2)}s.`);
            } else {
                console.log("  ℹ️ [Dry-Run] SQL to partition:");
                console.log(PARTITION_SQL.trim());
            }
        }

        console.log("\n==================================================================");
        if (isApply) {
            console.log("  🎉 All database optimizations completed successfully!");
        } else {
            console.log("  Dry-Run complete. To apply these migrations to MySQL, run:");
            console.log("  node server/scripts/optimizeOptionChainHistory.js --apply");
        }
        console.log("==================================================================\n");

    } catch (err) {
        console.error("❌ Fatal Error during optimization check:", err.message);
        if (err.sql) console.error("SQL Failed:", err.sql);
    } finally {
        await pool.end();
    }
}

main();
