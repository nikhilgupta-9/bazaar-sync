// server/scripts/stockmojoExtractor.js — StockMojo historical minute data extractor for BazaarSync
// Fetches historical minute-by-minute option chain from StockMojo and stores directly
// into MySQL `option_chain_history` (and updates coverage summaries).
//
// Usage:
//   node server/scripts/stockmojoExtractor.js [SYMBOL] [FROM_DATE] [TO_DATE] [STRIKES_PER_SIDE]
//
// Example:
//   node server/scripts/stockmojoExtractor.js NIFTY 2024-01-01 2024-01-31 30

require('dotenv').config();
const path = require('path');
const axios = require('axios');
const { pool } = require('../config/db');
const bs = require('../utils/blackScholes');
const coverageSummary = require('../services/coverageSummaryService');

const BASE_URL = process.env.STOCKMOJO_BASE_URL || 'https://user.stockmojo.in/v1/option-chain';
const MARGIN_URL = process.env.STOCKMOJO_MARGIN_URL || 'https://user.stockmojo.in/v1/margin/calculate';
const SESSION_COOKIE = process.env.STOCKMOJO_SESSION_COOKIE || '';
const AUTH_BEARER = process.env.STOCKMOJO_AUTH_BEARER || '';
const API_KEY = process.env.STOCKMOJO_API_KEY || '';

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

function getTradingDays(startDateStr, endDateStr) {
    const days = [];
    let cur = new Date(startDateStr);
    const end = new Date(endDateStr);
    while (cur <= end) {
        const dayOfWeek = cur.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Skip Sat/Sun
            days.push(cur.toISOString().split('T')[0]);
        }
        cur.setDate(cur.getDate() + 1);
    }
    return days;
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
        return (rows[0]?.cnt || 0) > 100;
    } catch (err) {
        return false;
    }
}

async function fetchFromStockMojo(symbol, tradeDate, strikesCount) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://stockmojo.in/historical-chart',
        'Origin': 'https://stockmojo.in'
    };

    if (AUTH_BEARER) {
        headers['Authorization'] = AUTH_BEARER.startsWith('Bearer ') ? AUTH_BEARER : `Bearer ${AUTH_BEARER}`;
    }
    if (API_KEY) {
        headers['x-api-key'] = API_KEY;
    }
    if (SESSION_COOKIE) {
        headers['Cookie'] = SESSION_COOKIE.includes('=') ? SESSION_COOKIE : `session=${SESSION_COOKIE}`;
    }

    const params = {
        symbol,
        date: tradeDate,
        strikes_above: strikesCount,
        strikes_below: strikesCount
    };

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const resp = await axios.get(BASE_URL, {
                params,
                headers,
                timeout: 25000
            });
            return resp.data;
        } catch (err) {
            if (err.response?.status === 429) {
                console.warn(`[StockMojo] Rate limit on ${symbol} ${tradeDate}. Sleeping 30s...`);
                await sleep(30000);
                continue;
            }
            if (err.response?.status === 401 || err.response?.status === 403) {
                console.error(`[StockMojo] Auth failure (HTTP ${err.response.status}). Check STOCKMOJO_SESSION_COOKIE/AUTH_BEARER in .env`);
                return null;
            }
            if (err.response?.status === 404) {
                return null;
            }
            console.warn(`[StockMojo] Request attempt ${attempt}/3 failed for ${symbol} ${tradeDate}: ${err.message}`);
            await sleep(attempt * 3000);
        }
    }
    return null;
}

function parseAndEnrichRows(symbol, tradeDate, rawData, strikesCount) {
    if (!rawData) return [];

    const snapshots = rawData.data || rawData.snapshots || (Array.isArray(rawData) ? rawData : []);
    const list = Array.isArray(snapshots) ? snapshots : [snapshots];
    const step = INDEX_STEP_SIZES[symbol.toUpperCase()] || 50;
    const rows = [];

    for (const snap of list) {
        let tradeTime = snap.time || snap.trade_time || snap.timestamp || '09:15:00';
        if (tradeTime.length === 5) tradeTime = `${tradeTime}:00`;
        else if (tradeTime.includes('T')) tradeTime = tradeTime.split('T')[1].substring(0, 8);
        else tradeTime = tradeTime.substring(0, 8);

        const spot = Number(snap.underlying_price || snap.spot || snap.spot_price || snap.underlying) || null;
        const strikeItems = snap.strikes || snap.data || snap.option_chain || [];

        let atmStrike = null;
        if (spot) {
            atmStrike = Math.round(spot / step) * step;
        }

        for (const item of strikeItems) {
            const strike = Number(item.strike || item.strike_price);
            if (!strike) continue;

            if (atmStrike && strikesCount > 0) {
                const minStrike = atmStrike - (strikesCount * step);
                const maxStrike = atmStrike + (strikesCount * step);
                if (strike < minStrike || strike > maxStrike) continue;
            }

            const expiry = String(item.expiry || item.expiry_date || tradeDate).substring(0, 10);
            const ce = item.CE || item.ce || item.call || {};
            const pe = item.PE || item.pe || item.put || {};

            const t = yearsToExpiry(expiry, tradeDate, tradeTime);

            // CE Calculations
            const ceLtp = Number(ce.ltp ?? ce.close ?? ce.last_price) || null;
            const ceOi = Number(ce.oi ?? ce.open_interest) || null;
            const ceOiChange = Number(ce.oi_change ?? ce.change_in_oi) || null;
            let ceIv = Number(ce.iv ?? ce.implied_volatility) || null;
            const ceVolume = Number(ce.volume ?? ce.vol) || null;
            let ceDelta = Number(ce.delta) || null;
            let ceGamma = Number(ce.gamma) || null;
            let ceTheta = Number(ce.theta) || null;
            let ceVega = Number(ce.vega) || null;

            if (spot && ceLtp && !ceIv) {
                const calcIv = bs.impliedVolatility({ marketPrice: ceLtp, spot, strike, t, right: 'call' });
                if (calcIv) ceIv = Number((calcIv * 100).toFixed(2));
            }
            if (spot && ceIv && (!ceDelta || !ceGamma)) {
                const g = bs.greeks({ spot, strike, t, vol: ceIv / 100, right: 'call' });
                if (g) {
                    ceDelta = ceDelta ?? g.delta;
                    ceGamma = ceGamma ?? g.gamma;
                    ceTheta = ceTheta ?? g.theta;
                    ceVega = ceVega ?? g.vega;
                }
            }

            // PE Calculations
            const peLtp = Number(pe.ltp ?? pe.close ?? pe.last_price) || null;
            const peOi = Number(pe.oi ?? pe.open_interest) || null;
            const peOiChange = Number(pe.oi_change ?? pe.change_in_oi) || null;
            let peIv = Number(pe.iv ?? pe.implied_volatility) || null;
            const peVolume = Number(pe.volume ?? pe.vol) || null;
            let peDelta = Number(pe.delta) || null;
            let peGamma = Number(pe.gamma) || null;
            let peTheta = Number(pe.theta) || null;
            let peVega = Number(pe.vega) || null;

            if (spot && peLtp && !peIv) {
                const calcIv = bs.impliedVolatility({ marketPrice: peLtp, spot, strike, t, right: 'put' });
                if (calcIv) peIv = Number((calcIv * 100).toFixed(2));
            }
            if (spot && peIv && (!peDelta || !peGamma)) {
                const g = bs.greeks({ spot, strike, t, vol: peIv / 100, right: 'put' });
                if (g) {
                    peDelta = peDelta ?? g.delta;
                    peGamma = peGamma ?? g.gamma;
                    peTheta = peTheta ?? g.theta;
                    peVega = peVega ?? g.vega;
                }
            }

            rows.push([
                symbol.toUpperCase(), tradeDate, tradeTime, expiry, strike, spot,
                ceLtp, ceOi, ceOiChange, ceIv, ceVolume, ceDelta, ceGamma, ceTheta, ceVega,
                peLtp, peOi, peOiChange, peIv, peVolume, peDelta, peGamma, peTheta, peVega
            ]);
        }
    }

    return rows;
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
                ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_oi_change=VALUES(ce_oi_change), ce_iv=VALUES(ce_iv), ce_volume=VALUES(ce_volume),
                ce_delta=VALUES(ce_delta), ce_gamma=VALUES(ce_gamma), ce_theta=VALUES(ce_theta), ce_vega=VALUES(ce_vega),
                pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_oi_change=VALUES(pe_oi_change), pe_iv=VALUES(pe_iv), pe_volume=VALUES(pe_volume),
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
    const fromDate = args[1] || new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const toDate = args[2] || new Date().toISOString().split('T')[0];
    const strikesCount = Number(args[3]) || 30;

    console.log(`\n======================================================`);
    console.log(`[StockMojo Extractor] Starting Extraction`);
    console.log(`Symbol:           ${symbol}`);
    console.log(`Date Range:       ${fromDate} -> ${toDate}`);
    console.log(`ATM Strikes:      ±${strikesCount} strikes`);
    console.log(`======================================================\n`);

    const tradingDays = getTradingDays(fromDate, toDate);
    console.log(`[StockMojo] Found ${tradingDays.length} trading days to process.`);

    let totalUpserted = 0;
    for (let idx = 0; idx < tradingDays.length; idx++) {
        const tradeDate = tradingDays[idx];
        const alreadyInDb = await isDateAlreadyInDb(symbol, tradeDate);

        if (alreadyInDb) {
            console.log(`[${idx + 1}/${tradingDays.length}] Skipping ${symbol} ${tradeDate} (Already present in DB)`);
            continue;
        }

        console.log(`[${idx + 1}/${tradingDays.length}] Fetching ${symbol} for ${tradeDate}...`);
        const rawData = await fetchFromStockMojo(symbol, tradeDate, strikesCount);

        if (!rawData) {
            console.log(`[StockMojo] No data returned for ${symbol} on ${tradeDate}.`);
            await sleep(1500);
            continue;
        }

        const rows = parseAndEnrichRows(symbol, tradeDate, rawData, strikesCount);
        console.log(`[StockMojo] Parsed ${rows.length} rows for ${symbol} ${tradeDate}. Saving to MySQL...`);

        if (rows.length > 0) {
            const count = await storeRowsInDb(rows);
            totalUpserted += count;
            console.log(`[StockMojo] Successfully saved ${count} records for ${tradeDate}.`);
        }

        await sleep(1500);
    }

    console.log(`\n[StockMojo Extractor] Finished! Total records upserted: ${totalUpserted}\n`);
    process.exit(0);
}

if (require.main === module) {
    runStockMojoExtractor().catch((err) => {
        console.error('[StockMojo Extractor Error]', err);
        process.exit(1);
    });
}

module.exports = {
    fetchFromStockMojo,
    parseAndEnrichRows,
    storeRowsInDb
};
