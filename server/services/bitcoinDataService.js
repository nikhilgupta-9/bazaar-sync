// services/bitcoinDataService.js — High-Speed Multi-Crypto 1-Minute Historical Downloader & Google Drive Cloud Archiver
// Supports BTC/USDT, ETH/USDT, SOL/USDT, BNB/USDT, and ANY Binance USDT Pair (2023–2026)
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");
const db = require("../config/db");
const gdrive = require("./googleDriveService");

const STAGING_DIR = path.join(__dirname, "../../tmp/bazaar_staging");
if (!fs.existsSync(STAGING_DIR)) {
    fs.mkdirSync(STAGING_DIR, { recursive: true });
}

let activeCryptoJob = {
    isRunning: false,
    jobId: null,
    targetSymbols: ["BTCUSDT"],
    targetYears: [2023, 2024, 2025, 2026],
    currentSymbol: null,
    currentYear: null,
    currentMonth: null,
    progressPct: 0,
    totalCandles: 0,
    uploadedFiles: 0,
    logs: [],
    error: null,
    startTime: null,
    finishedTime: null,
};

function appendLog(msg, level = "info") {
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
    const entry = `[${timestamp}] [${level.toUpperCase()}] ${msg}`;
    activeCryptoJob.logs.push(entry);
    if (activeCryptoJob.logs.length > 500) activeCryptoJob.logs.shift();
    console.log(`[CryptoService] ${entry}`);
}

/**
 * Normalizes symbol to Binance USDT pair format (e.g. "BTC" -> "BTCUSDT", "ETH/USDT" -> "ETHUSDT")
 */
function normalizeCryptoSymbol(sym) {
    if (!sym) return "BTCUSDT";
    let s = String(sym).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s.endsWith("USDT") && !s.endsWith("FDUSD") && !s.endsWith("BUSD") && !s.endsWith("USDC")) {
        s = `${s}USDT`;
    }
    return s;
}

/**
 * Fetch 1-minute klines from Binance public API for a specific time range
 */
async function fetchBinanceKlines(symbol = "BTCUSDT", startTime, endTime, limit = 1000) {
    const cleanSym = normalizeCryptoSymbol(symbol);
    const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSym}&interval=1m&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;

    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000 }, (res) => {
            if (res.statusCode !== 200) {
                let errBody = "";
                res.on("data", (c) => errBody += c);
                res.on("end", () => reject(new Error(`Binance HTTP ${res.statusCode}: ${errBody}`)));
                return;
            }
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                try {
                    const klines = JSON.parse(data);
                    resolve(klines);
                } catch (e) {
                    reject(new Error(`JSON Parse Error: ${e.message}`));
                }
            });
        });

        req.on("error", (e) => reject(e));
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Binance API request timeout"));
        });
    });
}

/**
 * Downloads 1-minute candles for a specific Crypto symbol & Year directly into a compressed CSV.gz
 */
async function downloadAndCompressCryptoYear(symbol, year, onProgress) {
    const cleanSym = normalizeCryptoSymbol(symbol);
    const fileName = `${cleanSym}_${year}_crypto.csv.gz`;
    const outputPath = path.join(STAGING_DIR, fileName);

    const startTs = new Date(`${year}-01-01T00:00:00Z`).getTime();
    const endTs = Math.min(new Date(`${year}-12-31T23:59:59Z`).getTime(), Date.now());

    appendLog(`Downloading 1-Minute ${cleanSym} historical candles for Year ${year}...`);

    const gzip = zlib.createGzip({ level: 9 });
    const writeStream = fs.createWriteStream(outputPath);
    gzip.pipe(writeStream);

    // CSV Header compatible with ohlcv_data
    gzip.write("id,symbol,trade_date,trade_time,open,high,low,close,volume\n");

    let currentStart = startTs;
    let totalCandles = 0;
    const totalSpan = endTs - startTs;
    let virtualId = 1;

    while (currentStart < endTs && activeCryptoJob.isRunning) {
        try {
            const klines = await fetchBinanceKlines(cleanSym, currentStart, endTs, 1000);
            if (!klines || klines.length === 0) {
                // If no klines returned, jump forward 1 day (e.g. coin hadn't launched yet)
                currentStart += 24 * 60 * 60 * 1000;
                continue;
            }

            for (const k of klines) {
                const openTime = new Date(k[0]);
                const tradeDate = openTime.toISOString().split("T")[0];
                const tradeTime = openTime.toISOString().split("T")[1].slice(0, 8);
                const open = parseFloat(k[1]).toFixed(4);
                const high = parseFloat(k[2]).toFixed(4);
                const low = parseFloat(k[3]).toFixed(4);
                const close = parseFloat(k[4]).toFixed(4);
                const volume = parseFloat(k[5]).toFixed(4);

                gzip.write(`${virtualId++},${cleanSym},${tradeDate},${tradeTime},${open},${high},${low},${close},${volume}\n`);
                totalCandles++;
            }

            const lastOpenTime = klines[klines.length - 1][0];
            currentStart = lastOpenTime + 60 * 1000; // Next minute

            const pct = Math.min(100, Math.round(((currentStart - startTs) / totalSpan) * 100));
            if (onProgress) onProgress(pct, totalCandles);

            // Rate limit delay (40ms between requests)
            await new Promise((r) => setTimeout(r, 40));
        } catch (err) {
            appendLog(`Notice for ${cleanSym} ${year} at ${new Date(currentStart).toISOString()}: ${err.message}. Retrying in 2s...`, "warn");
            await new Promise((r) => setTimeout(r, 2000));
        }
    }

    gzip.end();
    await new Promise((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
    });

    const fileSizeBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    appendLog(`✅ Generated ${fileName} (${totalCandles.toLocaleString()} 1-min candles, ${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB compressed)`);

    return {
        outputPath,
        fileName,
        totalCandles,
        fileSizeBytes,
        symbol: cleanSym,
        year,
    };
}

/**
 * Start full multi-crypto historical extraction and Google Drive upload
 */
async function startCryptoPipeline({ symbols = ["BTCUSDT"], years = [2023, 2024, 2025, 2026] } = {}) {
    if (activeCryptoJob.isRunning) {
        throw new Error("A crypto archival pipeline is already currently running.");
    }

    const cleanSymbols = (Array.isArray(symbols) ? symbols : [symbols])
        .map(normalizeCryptoSymbol)
        .filter((v, i, a) => a.indexOf(v) === i);

    const cleanYears = (Array.isArray(years) ? years : [years])
        .map(Number)
        .sort((a, b) => a - b);

    activeCryptoJob = {
        isRunning: true,
        jobId: `crypto_${Date.now()}`,
        targetSymbols: cleanSymbols,
        targetYears: cleanYears,
        currentSymbol: null,
        currentYear: null,
        currentMonth: null,
        progressPct: 0,
        totalCandles: 0,
        uploadedFiles: 0,
        logs: [],
        error: null,
        startTime: new Date().toISOString(),
        finishedTime: null,
    };

    appendLog(`🚀 Starting Multi-Crypto 1-Minute Cloud Pipeline for ${cleanSymbols.length} Symbol(s) [${cleanSymbols.join(", ")}] across Years [${cleanYears.join(", ")}]...`);

    (async () => {
        try {
            // 1. Verify Google Drive connection
            const conn = await gdrive.testConnection();
            if (!conn.connected) {
                throw new Error(`Google Drive not connected: ${conn.error}`);
            }
            appendLog(`Google Drive Connected! Target folder: "${conn.folderName || conn.folderId}"`);

            const totalBatches = cleanSymbols.length * cleanYears.length;
            let batchIndex = 0;

            for (const sym of cleanSymbols) {
                if (!activeCryptoJob.isRunning) break;
                activeCryptoJob.currentSymbol = sym;

                for (const yr of cleanYears) {
                    if (!activeCryptoJob.isRunning) break;
                    activeCryptoJob.currentYear = yr;
                    batchIndex++;

                    appendLog(`\n==================================================`);
                    appendLog(`[${batchIndex}/${totalBatches}] Processing ${sym} - Year ${yr}...`);
                    appendLog(`==================================================`);

                    // 1. Download & compress into CSV.gz
                    const res = await downloadAndCompressCryptoYear(sym, yr, (batchPct, count) => {
                        const overallPct = Math.min(99, Math.round(((batchIndex - 1 + batchPct / 100) / totalBatches) * 100));
                        activeCryptoJob.progressPct = overallPct;
                    });

                    if (res.totalCandles > 0) {
                        activeCryptoJob.totalCandles += res.totalCandles;

                        // 2. Ensure Google Drive Folder Hierarchy: Root -> Crypto -> {symbol} -> {year}
                        const categoryName = sym === "BTCUSDT" ? "bitcoin" : "crypto";
                        appendLog(`Ensuring Google Drive folder hierarchy: ${categoryName} / ${sym} / ${yr}...`);
                        const { targetFolderId } = await gdrive.ensureCategoryYearHierarchy(categoryName, yr, sym);

                        // 3. Upload to Google Drive
                        appendLog(`Uploading ${res.fileName} to Google Drive...`);
                        const uploadRes = await gdrive.uploadFile({
                            filePath: res.outputPath,
                            fileName: res.fileName,
                            parentFolderId: targetFolderId,
                        });

                        activeCryptoJob.uploadedFiles++;
                        appendLog(`✅ Google Drive Upload Complete! File ID: ${uploadRes.fileId} | Link: ${uploadRes.webViewLink}`);

                        // 4. Record in Database
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
                            yr,
                            categoryName,
                            res.totalCandles,
                            res.fileName,
                            uploadRes.sizeBytes,
                            uploadRes.fileId,
                            uploadRes.webViewLink,
                            targetFolderId,
                            uploadRes.checksumSha256,
                        ]);

                        // Clean staging file
                        if (fs.existsSync(res.outputPath)) {
                            fs.unlinkSync(res.outputPath);
                        }
                    } else {
                        appendLog(`No candle data found for ${sym} in ${yr} (possibly pair did not exist yet).`, "warn");
                        if (fs.existsSync(res.outputPath)) {
                            fs.unlinkSync(res.outputPath);
                        }
                    }
                }
            }

            if (activeCryptoJob.isRunning) {
                activeCryptoJob.progressPct = 100;
                activeCryptoJob.finishedTime = new Date().toISOString();
                appendLog(`🎉 Multi-Crypto Cloud Archival Complete! Processed ${cleanSymbols.length} coin(s). Total candles: ${activeCryptoJob.totalCandles.toLocaleString()}`);
            } else {
                appendLog("Crypto pipeline stopped by user.", "warn");
            }
        } catch (err) {
            activeCryptoJob.error = err.message;
            appendLog(`Pipeline error: ${err.message}`, "error");
        } finally {
            activeCryptoJob.isRunning = false;
        }
    })();

    return {
        jobId: activeCryptoJob.jobId,
        started: true,
        symbols: cleanSymbols,
        years: cleanYears,
    };
}

function stopCryptoPipeline() {
    if (activeCryptoJob.isRunning) {
        activeCryptoJob.isRunning = false;
        appendLog("Stopping Crypto pipeline on user request...", "warn");
        return { stopped: true };
    }
    return { stopped: false };
}

function getCryptoPipelineStatus() {
    return { ...activeCryptoJob };
}

async function getCryptoArchiveStatus(symbol = null) {
    let sql = `
        SELECT symbol, year, data_type, record_count, file_name, file_size_bytes, gdrive_file_id, gdrive_web_link, status, checksum_sha256, uploaded_at
        FROM gdrive_archive_records
        WHERE data_type IN ('bitcoin', 'crypto')
    `;
    const params = [];
    if (symbol) {
        sql += ` AND symbol = ?`;
        params.push(normalizeCryptoSymbol(symbol));
    }
    sql += ` ORDER BY symbol ASC, year ASC`;

    const rows = await db.query(sql, params).catch(() => []);
    return rows;
}

// Backward compatibility alias functions
const start3YearBitcoinPipeline = (years) => startCryptoPipeline({ symbols: ["BTCUSDT"], years });
const stopBitcoinPipeline = stopCryptoPipeline;
const getBitcoinPipelineStatus = getCryptoPipelineStatus;
const getBitcoinArchiveStatus = () => getCryptoArchiveStatus("BTCUSDT");

module.exports = {
    startCryptoPipeline,
    stopCryptoPipeline,
    getCryptoPipelineStatus,
    getCryptoArchiveStatus,
    start3YearBitcoinPipeline,
    stopBitcoinPipeline,
    getBitcoinPipelineStatus,
    getBitcoinArchiveStatus,
    normalizeCryptoSymbol,
};
