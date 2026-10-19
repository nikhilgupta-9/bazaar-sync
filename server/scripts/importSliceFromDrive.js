// server/scripts/importSliceFromDrive.js
// Streams an option chain archive from Google Drive and imports a specified date range
// into local MySQL table option_chain_history with zero memory leaks and batch speed.
const zlib = require("zlib");
const readline = require("readline");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

const { pool } = require("../config/db");
const gdrive = require("../services/googleDriveService");

function parseArgs() {
    const args = process.argv.slice(2);
    const flags = {};
    for (const a of args) {
        if (a.startsWith("--")) {
            const [k, v] = a.slice(2).split("=");
            flags[k] = v === undefined ? true : v;
        }
    }
    return flags;
}

// Split standard CSV line
function splitLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            } else { cur += c; }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            cells.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    cells.push(cur);
    return cells;
}

const numOrNull = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const strOrNull = (v) => (v === "" || v == null ? null : String(v).trim());

async function run() {
    const flags = parseArgs();
    const symbol = (flags.symbol || "NIFTY").toUpperCase();
    const fromDate = flags.from || "2026-08-01";
    const toDate = flags.to || "2026-10-16";
    const year = fromDate.slice(0, 4);

    console.log(`\n========================================================`);
    console.log(`IMPORTING SLICE FROM GOOGLE DRIVE → MYSQL`);
    console.log(`Symbol: ${symbol} | Range: ${fromDate} to ${toDate}`);
    console.log(`========================================================\n`);

    // 1. Locate file on Google Drive
    const fileId = flags.fileId;
    let targetFile = null;

    if (fileId) {
        targetFile = { id: fileId, name: `${symbol}_${year}_option_chain.csv.gz` };
        console.log(`✅ Using direct Google Drive File ID: ${fileId}`);
    } else {
        const fileName = `${symbol}_${year}_option_chain.csv.gz`;
        console.log(`🔍 Searching Google Drive for "${fileName}"...`);
        const searchRes = await gdrive.listDriveFiles({ query: fileName, pageSize: 5 });
        targetFile = searchRes.files.find(f => f.name === fileName) || searchRes.files[0];

        if (!targetFile) {
            console.error(`❌ Could not find file "${fileName}" on Google Drive.`);
            process.exit(1);
        }
        console.log(`✅ Found "${targetFile.name}" (ID: ${targetFile.id}, Size: ${(targetFile.sizeBytes / (1024 * 1024)).toFixed(2)} MB)`);
    }

    // 2. Open stream
    console.log(`🚀 Connecting readable stream from Google Drive...`);
    const { stream } = await gdrive.getDriveFileStream({ fileId: targetFile.id });
    const gunzip = zlib.createGunzip();
    const rl = readline.createInterface({
        input: stream.pipe(gunzip),
        crlfDelay: Infinity,
    });

    const INSERT_COLS = [
        "symbol", "trade_date", "trade_time", "expiry", "strike", "underlying_price",
        "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
        "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega"
    ];

    const UPDATE_CLAUSE = [
        "underlying_price=VALUES(underlying_price)",
        "ce_ltp=VALUES(ce_ltp)", "ce_oi=VALUES(ce_oi)", "ce_oi_change=VALUES(ce_oi_change)", "ce_iv=VALUES(ce_iv)", "ce_volume=VALUES(ce_volume)",
        "ce_delta=VALUES(ce_delta)", "ce_gamma=VALUES(ce_gamma)", "ce_theta=VALUES(ce_theta)", "ce_vega=VALUES(ce_vega)",
        "pe_ltp=VALUES(pe_ltp)", "pe_oi=VALUES(pe_oi)", "pe_oi_change=VALUES(pe_oi_change)", "pe_iv=VALUES(pe_iv)", "pe_volume=VALUES(pe_volume)",
        "pe_delta=VALUES(pe_delta)", "pe_gamma=VALUES(pe_gamma)", "pe_theta=VALUES(pe_theta)", "pe_vega=VALUES(pe_vega)"
    ].join(", ");

    const SQL = `INSERT INTO option_chain_history (${INSERT_COLS.join(", ")}) VALUES ? ON DUPLICATE KEY UPDATE ${UPDATE_CLAUSE}`;

    let headerConsumed = false;
    let colMap = {};
    let buffer = [];
    let matchedLines = 0;
    let totalScanned = 0;
    let totalInserted = 0;
    const BATCH_SIZE = 1000;
    const startTime = Date.now();

    async function flushBuffer() {
        if (!buffer.length) return;
        const conn = await pool.getConnection();
        try {
            await conn.query(SQL, [buffer]);
            totalInserted += buffer.length;
            buffer = [];
        } finally {
            conn.release();
        }
    }

    for await (const line of rl) {
        totalScanned++;
        if (!line || !line.trim()) continue;

        if (!headerConsumed) {
            headerConsumed = true;
            const cols = splitLine(line).map(c => c.trim().toLowerCase());
            cols.forEach((col, idx) => { colMap[col] = idx; });
            console.log(`📋 Header processed with ${cols.length} columns.`);
            continue;
        }

        const cells = splitLine(line);
        const dateIdx = colMap["trade_date"];
        const rowDate = dateIdx !== undefined ? cells[dateIdx] : null;

        if (!rowDate || rowDate < fromDate || rowDate > toDate) {
            continue; // Skip dates outside our desired testing range
        }

        matchedLines++;

        const rowValues = [
            strOrNull(cells[colMap["symbol"]]) || symbol,
            rowDate,
            strOrNull(cells[colMap["trade_time"]]),
            strOrNull(cells[colMap["expiry"]]),
            numOrNull(cells[colMap["strike"]]),
            numOrNull(cells[colMap["underlying_price"]]),
            // CE
            numOrNull(cells[colMap["ce_ltp"]]),
            numOrNull(cells[colMap["ce_oi"]]),
            numOrNull(cells[colMap["ce_oi_change"]]),
            numOrNull(cells[colMap["ce_iv"]]),
            numOrNull(cells[colMap["ce_volume"]]),
            numOrNull(cells[colMap["ce_delta"]]),
            numOrNull(cells[colMap["ce_gamma"]]),
            numOrNull(cells[colMap["ce_theta"]]),
            numOrNull(cells[colMap["ce_vega"]]),
            // PE
            numOrNull(cells[colMap["pe_ltp"]]),
            numOrNull(cells[colMap["pe_oi"]]),
            numOrNull(cells[colMap["pe_oi_change"]]),
            numOrNull(cells[colMap["pe_iv"]]),
            numOrNull(cells[colMap["pe_volume"]]),
            numOrNull(cells[colMap["pe_delta"]]),
            numOrNull(cells[colMap["pe_gamma"]]),
            numOrNull(cells[colMap["pe_theta"]]),
            numOrNull(cells[colMap["pe_vega"]]),
        ];

        buffer.push(rowValues);

        if (buffer.length >= BATCH_SIZE) {
            await flushBuffer();
            if (totalInserted % 25000 === 0) {
                const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`⚡ Inserted ${totalInserted.toLocaleString()} rows (Scanned: ${totalScanned.toLocaleString()}, Elapsed: ${elapsedSec}s)...`);
            }
        }
    }

    if (buffer.length > 0) {
        await flushBuffer();
    }

    const elapsedTotal = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n========================================================`);
    console.log(`🎉 COMPLETED IN ${elapsedTotal}s!`);
    console.log(`Total scanned lines: ${totalScanned.toLocaleString()}`);
    console.log(`Matched date range (${fromDate}..${toDate}): ${matchedLines.toLocaleString()}`);
    console.log(`Total rows inserted into option_chain_history: ${totalInserted.toLocaleString()}`);
    console.log(`========================================================\n`);

    // Invalidate simulator dates cache
    const invalidationFile = path.join(__dirname, "..", "data", "simulator-dates-cache.invalidated");
    try {
        require("fs").writeFileSync(invalidationFile, String(Date.now()));
        console.log(`🔄 Simulator dates cache invalidated.`);
    } catch (_) {}

    process.exit(0);
}

run().catch(err => {
    console.error("FATAL ERROR in importSliceFromDrive:", err);
    process.exit(1);
});
