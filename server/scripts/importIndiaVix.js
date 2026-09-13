// scripts/importIndiaVix.js — ONE-TIME bulk load of a real India VIX
// minute-level CSV (vendor format: `date,open,high,low,close,volume` with a
// combined "YYYY-MM-DD HH:MM:SS" date column, no symbol column) into
// ohlcv_data as symbol='INDIAVIX'.
//
// Why not the admin Data Import CSV page: that importer expects the generic
// `symbol,trade_date,trade_time,open,high,low,close,volume` header (split
// date/time, explicit symbol per row) and caps at 50,000 rows per upload —
// this vendor file is a single combined `date` column with ~978k rows
// (2015-01-09 through today), so it needs its own parser and can't go
// through the admin UI's per-row browser upload at all. `volume` in the
// source file is always 0 (VIX is a computed index, not a traded
// instrument — there's nothing to have volume) and is stored as-is, not
// coerced to NULL, since 0 is the vendor's real answer here.
//
// Same upsert-by-construction guarantee as every other pipeline into this
// table: ON DUPLICATE KEY UPDATE on ohlcv_data's uniq_candle
// (symbol, trade_date, trade_time) — safe to interrupt and re-run, can only
// refresh a row, never duplicate.
//
// Usage:
//   node scripts/importIndiaVix.js "/absolute/path/to/INDIA VIX_minute.csv"

require("dotenv").config();
const fs = require("fs");
const readline = require("readline");
const { pool } = require("../config/db");

const BATCH = 1000;

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Usage: node scripts/importIndiaVix.js <path-to-csv>");
        process.exit(1);
    }
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });

    let isHeader = true;
    let batch = [];
    let total = 0;
    let skipped = 0;
    let lineNo = 0;

    async function flush() {
        if (!batch.length) return;
        await pool.query(
            `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
             VALUES ? ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)`,
            [batch]
        );
        total += batch.length;
        batch = [];
        process.stdout.write(`\r${total} rows written (${skipped} skipped)...`);
    }

    for await (const line of rl) {
        lineNo++;
        if (isHeader) { isHeader = false; continue; }
        if (!line.trim()) continue;

        const cells = line.split(",");
        if (cells.length !== 6) { skipped++; continue; }
        const [dateTime, open, high, low, close, volume] = cells;
        const m = dateTime.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
        if (!m) { skipped++; continue; }
        const [, tradeDate, tradeTime] = m;

        batch.push(["INDIAVIX", tradeDate, tradeTime, Number(open), Number(high), Number(low), Number(close), Number(volume) || 0]);
        if (batch.length >= BATCH) await flush();
    }
    await flush();

    console.log(`\nDone. ${total} rows written, ${skipped} lines skipped (${lineNo} lines read).`);
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
