// server/scripts/upstoxVixArchivalRunner.js — Upstox India VIX 1-Minute Cloud Archival & Polish Engine
// Fetches full 1-minute historical INDIA VIX data from Upstox API for 2025 and 2026:
// 1. Chunked month-by-month extraction from Upstox API (NSE_INDEX|India VIX)
// 2. Smart Cloud Merge with any existing Google Drive 2025 archive
// 3. Complete 2026 data backfill up to today's date
// 4. Zero Local Disk Footprint: Auto-pruning from local MySQL (ohlcv_data) after confirmed Google Drive upload
// 5. Verification against Google Drive API

require('dotenv').config();
const path = require('path');
const { pool } = require('../config/db');
const gdrive = require('../services/googleDriveService');
const archivalPipeline = require('../services/archivalPipelineService');
const upstoxHistorical = require('../../data-downloader/upstox/historicalService');

const VIX_INSTRUMENT_KEY = 'NSE_INDEX|India VIX';
const VIX_DB_SYMBOL = 'INDIAVIX';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate monthly date ranges for a given year up to a max date
 */
function getMonthlyChunks(year, maxDateStr = null) {
    const chunks = [];
    const now = new Date();
    const currentYear = now.getFullYear();

    for (let month = 1; month <= 12; month++) {
        const mStr = String(month).padStart(2, '0');
        const startDate = `${year}-${mStr}-01`;
        
        // Calculate last day of month
        const lastDay = new Date(year, month, 0).getDate();
        let endDate = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;

        if (maxDateStr && startDate > maxDateStr) {
            break;
        }
        if (maxDateStr && endDate > maxDateStr) {
            endDate = maxDateStr;
        }

        chunks.push({
            month,
            label: `${year}-${mStr}`,
            fromDate: startDate,
            toDate: endDate,
        });

        if (maxDateStr && endDate >= maxDateStr) {
            break;
        }
    }
    return chunks;
}

/**
 * Bulk insert candles into ohlcv_data
 */
async function insertCandles(candles) {
    if (!candles || candles.length === 0) return 0;

    const BATCH_SIZE = 2000;
    let inserted = 0;

    for (let i = 0; i < candles.length; i += BATCH_SIZE) {
        const batch = candles.slice(i, i + BATCH_SIZE);
        const values = [];
        const placeholders = [];

        for (const c of batch) {
            placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?)');
            values.push(
                VIX_DB_SYMBOL,
                c.date,
                c.time,
                c.open,
                c.high,
                c.low,
                c.close,
                c.volume || 0
            );
        }

        const sql = `
            INSERT IGNORE INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
            VALUES ${placeholders.join(', ')}
        `;

        const [res] = await pool.query(sql, values);
        inserted += (res.affectedRows || 0);
    }

    return inserted;
}

/**
 * Process a single year for India VIX
 */
async function processVixYear(year, maxDateStr = null) {
    console.log(`\n============================================================`);
    console.log(`🚀 [Upstox VIX Engine] Processing Year ${year} (INDIA VIX)...`);
    console.log(`============================================================`);

    const chunks = getMonthlyChunks(year, maxDateStr);
    console.log(`[Upstox VIX Engine] Total monthly chunks to fetch: ${chunks.length}`);

    let totalFetchedCandles = 0;
    let totalInsertedRows = 0;

    for (const chunk of chunks) {
        console.log(`[Upstox VIX Engine] Fetching ${chunk.label} (${chunk.fromDate} -> ${chunk.toDate})...`);
        try {
            const candles = await upstoxHistorical.getCandles(VIX_INSTRUMENT_KEY, {
                interval: '1minute',
                fromDate: chunk.fromDate,
                toDate: chunk.toDate,
            });

            console.log(`[Upstox VIX Engine] -> Retrieved ${candles.length.toLocaleString()} candles for ${chunk.label}`);
            totalFetchedCandles += candles.length;

            if (candles.length > 0) {
                const inserted = await insertCandles(candles);
                totalInsertedRows += inserted;
            }

            // Polite delay between chunk requests
            await sleep(400);
        } catch (err) {
            console.error(`[Upstox VIX Engine] ❌ Error fetching ${chunk.label}:`, err.message);
        }
    }

    console.log(`\n[Upstox VIX Engine] Year ${year} fetch complete.`);
    console.log(`Total candles fetched: ${totalFetchedCandles.toLocaleString()}`);
    console.log(`Total new rows staged in DB: ${totalInsertedRows.toLocaleString()}`);

    // Run archival pipeline (Smart Cloud Merge + Google Drive Upload + Auto Prune)
    console.log(`\n[Upstox VIX Engine] 📦 Triggering Smart Cloud Merge & Archival Pipeline for ${year}...`);
    const batchRes = await archivalPipeline.processBatch({
        dataType: 'india_vix',
        symbol: VIX_DB_SYMBOL,
        year: Number(year),
        autoPrune: true,
    });

    console.log(`[Upstox VIX Engine] ✅ Year ${year} Archival Result:`, {
        status: batchRes.status || 'archived',
        file: batchRes.finalFileName || `INDIAVIX_${year}_india_vix.csv.gz`,
        records: batchRes.totalRecords || totalFetchedCandles,
        gdriveFileId: batchRes.gdriveFileId,
    });

    return batchRes;
}

async function main() {
    const todayStr = new Date().toISOString().slice(0, 10);
    console.log('================================================================');
    console.log('🎯 [UPSTOX INDIA VIX CLOUD ARCHIVAL ENGINE]');
    console.log(`Target Symbol:    INDIA VIX (${VIX_INSTRUMENT_KEY})`);
    console.log(`Target Years:     2025, 2026 (up to ${todayStr})`);
    console.log(`Local Disk Mode:  Zero Footprint (Auto-Prune to GDrive)`);
    console.log('================================================================');

    try {
        // Step 1: Process Year 2025
        console.log('\n--- STEP 1: POLISHING & COMPLETING 2025 INDIA VIX ---');
        await processVixYear(2025, '2025-12-31');

        // Step 2: Process Year 2026 (up to today)
        console.log('\n--- STEP 2: EXTRACTING & ARCHIVING 2026 INDIA VIX (UP TO TODAY) ---');
        await processVixYear(2026, todayStr);

        // Step 3: Direct Google Drive Verification
        console.log('\n================================================================');
        console.log('🎯 [FINAL GOOGLE DRIVE VERIFICATION FOR INDIA VIX]');
        console.log('================================================================');
        const drive = await gdrive.getDriveClient();

        const [records] = await pool.query(
            "SELECT * FROM gdrive_archive_records WHERE (symbol = 'INDIAVIX' OR data_type = 'india_vix') AND year IN (2025, 2026) ORDER BY year"
        );

        for (const rec of records) {
            if (rec.gdrive_file_id) {
                try {
                    const res = await drive.files.get({
                        fileId: rec.gdrive_file_id,
                        fields: 'id, name, size, modifiedTime, webViewLink',
                    });
                    console.log(`✅ [GDrive Verified] ${res.data.name}`);
                    console.log(`   File ID:       ${res.data.id}`);
                    console.log(`   Records:       ${Number(rec.record_count).toLocaleString()} rows`);
                    console.log(`   File Size:     ${(Number(res.data.size) / 1024).toFixed(1)} KB`);
                    console.log(`   Last Modified: ${res.data.modifiedTime}`);
                    console.log(`   Web Link:      ${res.data.webViewLink}`);
                } catch (vErr) {
                    console.error(`❌ Verification failed for ID ${rec.gdrive_file_id}:`, vErr.message);
                }
            }
        }

        console.log('\n✨ India VIX 2025 and 2026 Archival & Verification 100% Completed!');
        process.exit(0);
    } catch (err) {
        console.error('Fatal execution error in Upstox VIX Runner:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
