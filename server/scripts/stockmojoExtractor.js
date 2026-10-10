// server/scripts/stockmojoExtractor.js — Production StockMojo Historical Option Chain Extractor
// Fetches minute-by-minute Option Chain snapshots directly from StockMojo's data cluster (`data.stockmojo.in`)
// and maps them into BazaarSync MySQL `option_chain_history` & `ohlcv_data` with ATM ±30 strikes filtering.
//
// Usage:
//   node server/scripts/stockmojoExtractor.js [SYMBOL] [FROM_DATE] [TO_DATE] [STRIKES_COUNT]
//
// Example:
//   node server/scripts/stockmojoExtractor.js NIFTY 2026-10-05 2026-10-09 30

require('dotenv').config();
const axios = require('axios');
const { pool } = require('../config/db');
const bs = require('../utils/blackScholes');
const coverageSummary = require('../services/coverageSummaryService');

const STOCKMOJO_DATA_URL = process.env.STOCKMOJO_DATA_URL || 'https://data.stockmojo.in';

const SYMBOL_TO_ID = {
    NIFTY: 1,
    BANKNIFTY: 2,
    FINNIFTY: 3,
    MIDCPNIFTY: 4,
    SENSEX: 5,
    BANKEX: 6,
    NIFTYNXT50: 7
};

const INDEX_STEP_SIZES = {
    NIFTY: 50,
    BANKNIFTY: 100,
    FINNIFTY: 50,
    MIDCPNIFTY: 25,
    SENSEX: 100,
    BANKEX: 100,
    NIFTYNXT50: 100
};

const INSERT_BATCH_SIZE = 500;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const clientHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://stockmojo.in',
    'Referer': 'https://stockmojo.in/simulator'
};

if (process.env.STOCKMOJO_HEADER_T) clientHeaders['T'] = process.env.STOCKMOJO_HEADER_T;
if (process.env.STOCKMOJO_HEADER_J) clientHeaders['J'] = process.env.STOCKMOJO_HEADER_J;
if (process.env.STOCKMOJO_SESSION_COOKIE) clientHeaders['Cookie'] = process.env.STOCKMOJO_SESSION_COOKIE;
if (process.env.STOCKMOJO_AUTH_BEARER) clientHeaders['Authorization'] = process.env.STOCKMOJO_AUTH_BEARER;

const client = axios.create({
    baseURL: STOCKMOJO_DATA_URL,
    timeout: 30000,
    headers: clientHeaders
});

let instrumentsMap = null;

async function loadInstruments() {
    if (instrumentsMap) return instrumentsMap;
    try {
        console.log('[StockMojo] Fetching instrument expiry definitions from StockMojo...');
        const resp = await client.get('/instruments');
        // Structure: { k: { "1": { "11": "2026-12-29", "205": "2026-10-27" } } }
        instrumentsMap = resp.data?.k || {};
        console.log(`[StockMojo] Loaded instruments map with ${Object.keys(instrumentsMap).length} symbols.`);
        return instrumentsMap;
    } catch (err) {
        console.warn(`[StockMojo] Failed to load instruments: ${err.message}. Using fallback expiry resolution.`);
        return {};
    }
}

async function getAvailableTimestamps(symbol, dateStr) {
    // Standard NSE trading minute timestamps: 09:15 to 15:30 (step by 1 minute)
    const timestamps = [];
    let startMin = 9 * 60 + 15;
    const endMin = 15 * 60 + 30;

    for (let m = startMin; m <= endMin; m++) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        timestamps.push(`${dateStr} ${hh}:${mm}:00`);
    }
    return timestamps;
}

function yearsToExpiry(expirySql, dateStr, timeStr) {
    const [ey, em, ed] = expirySql.split('-').map(Number);
    const [dy, dm, dd] = dateStr.split('-').map(Number);
    const [hh, mm, ss] = (timeStr || '15:30:00').split(':').map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const expiryUtcMs = Date.UTC(ey, em - 1, ed, 15, 30, 0) - IST_OFFSET_MS;
    const rowUtcMs = Date.UTC(dy, dm - 1, dd, hh, mm, ss) - IST_OFFSET_MS;
    const ms = expiryUtcMs - rowUtcMs;
    return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4));
}

async function isDateAlreadyInDb(symbol, tradeDate) {
    try {
        const [rows] = await pool.query(
            'SELECT COUNT(1) as cnt FROM option_chain_history WHERE symbol = ? AND trade_date = ? LIMIT 1',
            [symbol, tradeDate]
        );
        return (rows[0]?.cnt || 0) > 5000; // Complete day has ~15k+ records
    } catch (err) {
        return false;
    }
}

async function fetchOcaSnapshot(symbolId, timestampStr) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const resp = await client.post('/simulator/oca', {
                symbol: symbolId,
                ts: timestampStr
            });
            return resp.data;
        } catch (err) {
            if (err.response?.status === 429) {
                console.warn(`[StockMojo] Rate limit at ${timestampStr}. Sleeping 15s...`);
                await sleep(15000);
                continue;
            }
            if (attempt === 3) {
                console.warn(`[StockMojo] Failed to fetch snapshot ${timestampStr}: ${err.message}`);
                return null;
            }
            await sleep(500 * attempt);
        }
    }
    return null;
}

function parseOcaSnapshot(symbol, timestampStr, rawData, expiryMap, strikesCount = 30) {
    if (!Array.isArray(rawData) || !rawData.length) return [];

    const dateStr = timestampStr.substring(0, 10);
    const timeStr = timestampStr.substring(11, 19);
    const step = INDEX_STEP_SIZES[symbol.toUpperCase()] || 50;

    let spotPrice = null;
    let vix = null;

    const ceByStrikeExpiry = new Map(); // key: `${expiry}|${strike}`
    const peByStrikeExpiry = new Map();

    for (const row of rawData) {
        if (!Array.isArray(row) || row.length < 4) continue;
        const tag = row[0];

        // Tag 1: Spot Price / VIX
        if (tag === 1) {
            const subType = row[1];
            const val = row[3];
            if (subType === 1) spotPrice = val;
            else if (subType === 232) vix = val;
        }
        // Tag 3: CALL Options (CE) -> [3, 1, oi, ltp, strike, expiry_id, ts]
        else if (tag === 3) {
            const oi = Number(row[2]) || null;
            const ltp = Number(row[3]) || null;
            const strike = Number(row[4]) || null;
            const expiryId = String(row[5]);
            const expiryDate = expiryMap[expiryId] || dateStr;

            if (strike) {
                ceByStrikeExpiry.set(`${expiryDate}|${strike}`, {
                    expiry: expiryDate,
                    strike,
                    ltp,
                    oi
                });
            }
        }
        // Tag 4: PUT Options (PE) -> [4, 1, oi, ltp, strike, expiry_id, ts]
        else if (tag === 4) {
            const oi = Number(row[2]) || null;
            const ltp = Number(row[3]) || null;
            const strike = Number(row[4]) || null;
            const expiryId = String(row[5]);
            const expiryDate = expiryMap[expiryId] || dateStr;

            if (strike) {
                peByStrikeExpiry.set(`${expiryDate}|${strike}`, {
                    expiry: expiryDate,
                    strike,
                    ltp,
                    oi
                });
            }
        }
    }

    // Determine ATM Bounds
    let atmStrike = null;
    if (spotPrice) {
        atmStrike = Math.round(spotPrice / step) * step;
    }

    const minStrike = atmStrike && strikesCount > 0 ? atmStrike - (strikesCount * step) : 0;
    const maxStrike = atmStrike && strikesCount > 0 ? atmStrike + (strikesCount * step) : Infinity;

    // Merge CE & PE rows by key
    const allKeys = new Set([...ceByStrikeExpiry.keys(), ...peByStrikeExpiry.keys()]);
    const mergedRows = [];

    for (const key of allKeys) {
        const [expiryDate, strikeStr] = key.split('|');
        const strike = Number(strikeStr);

        if (atmStrike && (strike < minStrike || strike > maxStrike)) {
            continue;
        }

        const ce = ceByStrikeExpiry.get(key);
        const pe = peByStrikeExpiry.get(key);

        const ceLtp = ce?.ltp ?? null;
        const ceOi = ce?.oi ?? null;
        const peLtp = pe?.ltp ?? null;
        const peOi = pe?.oi ?? null;

        const t = yearsToExpiry(expiryDate, dateStr, timeStr);

        // Black-Scholes Greeks Fallback
        let ceIv = null, ceDelta = null, ceGamma = null, ceTheta = null, ceVega = null;
        let peIv = null, peDelta = null, peGamma = null, peTheta = null, peVega = null;

        if (spotPrice && ceLtp && ceLtp > 0) {
            const iv = bs.impliedVolatility({ marketPrice: ceLtp, spot: spotPrice, strike, t, right: 'call' });
            if (iv) {
                ceIv = Number((iv * 100).toFixed(2));
                const g = bs.greeks({ spot: spotPrice, strike, t, vol: iv, right: 'call' });
                if (g) {
                    ceDelta = g.delta;
                    ceGamma = g.gamma;
                    ceTheta = g.theta;
                    ceVega = g.vega;
                }
            }
        }

        if (spotPrice && peLtp && peLtp > 0) {
            const iv = bs.impliedVolatility({ marketPrice: peLtp, spot: spotPrice, strike, t, right: 'put' });
            if (iv) {
                peIv = Number((iv * 100).toFixed(2));
                const g = bs.greeks({ spot: spotPrice, strike, t, vol: iv, right: 'put' });
                if (g) {
                    peDelta = g.delta;
                    peGamma = g.gamma;
                    peTheta = g.theta;
                    peVega = g.vega;
                }
            }
        }

        mergedRows.push([
            symbol.toUpperCase(), dateStr, timeStr, expiryDate, strike, spotPrice,
            ceLtp, ceOi, null, ceIv, null, ceDelta, ceGamma, ceTheta, ceVega,
            peLtp, peOi, null, peIv, null, peDelta, peGamma, peTheta, peVega
        ]);
    }

    return mergedRows;
}

async function storeRowsInDb(rows) {
    if (!rows.length) return 0;

    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
        await pool.query(
            `INSERT INTO option_chain_history (
                symbol, trade_date, trade_time, expiry, strike, underlying_price,
                ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
            ) VALUES ?
            ON DUPLICATE KEY UPDATE
                underlying_price=VALUES(underlying_price),
                ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_iv=VALUES(ce_iv),
                ce_delta=VALUES(ce_delta), ce_gamma=VALUES(ce_gamma), ce_theta=VALUES(ce_theta), ce_vega=VALUES(ce_vega),
                pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_iv=VALUES(pe_iv),
                pe_delta=VALUES(pe_delta), pe_gamma=VALUES(pe_gamma), pe_theta=VALUES(pe_theta), pe_vega=VALUES(pe_vega)`,
            [batch]
        );
        await coverageSummary.recordIngestedFromInsertValues(batch).catch(() => {});
        inserted += batch.length;
    }
    return inserted;
}

async function runStockMojoExtractor() {
    const args = process.argv.slice(2);
    const symbol = (args[0] || 'NIFTY').toUpperCase();
    const fromDate = args[1] || new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
    const toDate = args[2] || fromDate;
    const strikesCount = Number(args[3]) || 30;

    const symbolId = SYMBOL_TO_ID[symbol] || 1;

    console.log(`\n======================================================`);
    console.log(`[StockMojo Cluster Extractor] Starting Extraction`);
    console.log(`Symbol:           ${symbol} (ID: ${symbolId})`);
    console.log(`Date Range:       ${fromDate} -> ${toDate}`);
    console.log(`ATM Filter:       ±${strikesCount} strikes`);
    console.log(`======================================================\n`);

    const allInstruments = await loadInstruments();
    const expiryMap = allInstruments[String(symbolId)] || {};

    let curDate = new Date(fromDate);
    const endDate = new Date(toDate);

    let totalSaved = 0;

    while (curDate <= endDate) {
        const dayOfWeek = curDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            curDate.setDate(curDate.getDate() + 1);
            continue;
        }

        const dateStr = curDate.toISOString().split('T')[0];
        const alreadyDone = await isDateAlreadyInDb(symbol, dateStr);

        if (alreadyDone) {
            console.log(`[StockMojo] Skipping ${symbol} ${dateStr} (Already fully populated in MySQL)`);
            curDate.setDate(curDate.getDate() + 1);
            continue;
        }

        console.log(`\n[StockMojo] Processing ${symbol} for trade date ${dateStr}...`);
        const minuteTimestamps = await getAvailableTimestamps(symbol, dateStr);

        let dayRows = [];
        for (let i = 0; i < minuteTimestamps.length; i++) {
            const ts = minuteTimestamps[i];
            const ocaData = await fetchOcaSnapshot(symbolId, ts);

            if (ocaData && ocaData.length > 0) {
                const parsed = parseOcaSnapshot(symbol, ts, ocaData, expiryMap, strikesCount);
                dayRows.push(...parsed);
            }

            // Progress log every 30 minutes
            if ((i + 1) % 30 === 0 || i === minuteTimestamps.length - 1) {
                process.stdout.write(`  [${dateStr}] Fetched ${i + 1}/${minuteTimestamps.length} minutes (${dayRows.length} rows collected)\r`);
            }

            if (dayRows.length >= 2000) {
                const count = await storeRowsInDb(dayRows);
                totalSaved += count;
                dayRows = [];
            }

            await sleep(60); // 60ms polite delay between minute snapshots
        }

        if (dayRows.length > 0) {
            const count = await storeRowsInDb(dayRows);
            totalSaved += count;
        }

        console.log(`\n[StockMojo] Completed date ${dateStr}! Saved ${totalSaved} total rows so far.`);
        curDate.setDate(curDate.getDate() + 1);
    }

    console.log(`\n[StockMojo Extractor] Finished! Total rows upserted to MySQL: ${totalSaved}\n`);
    process.exit(0);
}

if (require.main === module) {
    runStockMojoExtractor().catch((err) => {
        console.error('[StockMojo Extractor Error]', err);
        process.exit(1);
    });
}

module.exports = {
    loadInstruments,
    fetchOcaSnapshot,
    parseOcaSnapshot,
    storeRowsInDb
};
