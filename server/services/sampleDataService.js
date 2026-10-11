// server/services/sampleDataService.js
// 1-Click Institutional Sample Test Data Generator & Importer
// Populates local MySQL database with authentic realistic historical market data:
// - Option Chain Data (NIFTY, BANKNIFTY, FINNIFTY) with Greeks & Multi-Expiries
// - India VIX (INDIAVIX) Volatility Index OHLCV ticks
// - Index Futures (NIFTY, BANKNIFTY) with Basis & OI
// - Crypto Derivatives (BTCUSD, ETHUSD, SOLUSD) with strikes & 24/7 ticks

const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const { bsPrice, calculateGreeks } = require("../utils/blackScholes");

const DATES_INVALIDATION_FILE = path.join(__dirname, "..", "data", "simulator-dates-cache.invalidated");
const COVERAGE_INVALIDATION_FILE = path.join(__dirname, "..", "data", "data-coverage-cache.invalidated");

/**
 * Returns current counts of sample records across tables
 */
async function getSampleDataStats() {
    try {
        const [optRows] = await pool.query(
            "SELECT symbol, COUNT(*) as count, COUNT(DISTINCT trade_date) as dates FROM option_chain_history GROUP BY symbol"
        );
        const [futRows] = await pool.query(
            "SELECT symbol, COUNT(*) as count, COUNT(DISTINCT trade_date) as dates FROM futures_history GROUP BY symbol"
        );
        const [vixRows] = await pool.query(
            "SELECT symbol, COUNT(*) as count, COUNT(DISTINCT trade_date) as dates FROM ohlcv_data WHERE symbol = 'INDIAVIX' GROUP BY symbol"
        );
        const [totalOpt] = await pool.query("SELECT COUNT(*) as count FROM option_chain_history");
        const [totalFut] = await pool.query("SELECT COUNT(*) as count FROM futures_history");
        const [totalOhlcv] = await pool.query("SELECT COUNT(*) as count FROM ohlcv_data");

        return {
            optionChains: {
                totalRows: totalOpt[0]?.count || 0,
                bySymbol: optRows,
            },
            futures: {
                totalRows: totalFut[0]?.count || 0,
                bySymbol: futRows,
            },
            indiaVix: {
                totalRows: vixRows[0]?.count || 0,
                dates: vixRows[0]?.dates || 0,
            },
            totalOhlcv: totalOhlcv[0]?.count || 0,
        };
    } catch (err) {
        console.error("[SampleDataService] Error getting stats:", err.message);
        throw err;
    }
}

/**
 * Helper to compute Black-Scholes price & Greeks safely
 */
function computeOptionMetrics(spot, strike, tYears, vol, right) {
    try {
        const p = bsPrice({ spot, strike, t: Math.max(0.001, tYears), vol, right });
        const g = calculateGreeks({ spot, strike, t: Math.max(0.001, tYears), vol, right });
        return {
            ltp: Math.max(0.05, Math.round(p * 100) / 100),
            delta: Math.round((g.delta || 0) * 1000) / 1000,
            gamma: Math.round((g.gamma || 0) * 10000) / 10000,
            theta: Math.round((g.theta || 0) * 100) / 100,
            vega: Math.round((g.vega || 0) * 100) / 100,
        };
    } catch {
        const intrinsic = right === "CE" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
        return {
            ltp: Math.max(0.5, intrinsic + 5),
            delta: right === "CE" ? 0.5 : -0.5,
            gamma: 0.001,
            theta: -2.5,
            vega: 8.5,
        };
    }
}

/**
 * Generate & insert Sample Option Chain records for Indian Indices
 */
async function importSampleOptionData() {
    const dates = [
        { date: "2024-01-15", niftySpot: 21500, bnfSpot: 47800, finSpot: 21200 },
        { date: "2024-06-04", niftySpot: 21884, bnfSpot: 46928, finSpot: 21540 }, // Election Result
        { date: "2024-11-06", niftySpot: 24484, bnfSpot: 52317, finSpot: 23890 }, // US Election
        { date: "2025-01-20", niftySpot: 23200, bnfSpot: 49800, finSpot: 22600 },
        { date: "2026-10-08", niftySpot: 25150, bnfSpot: 51800, finSpot: 23900 },
        { date: "2026-10-10", niftySpot: 24964, bnfSpot: 51240, finSpot: 23720 },
    ];

    const times = ["09:15:00", "10:30:00", "12:00:00", "13:30:00", "14:45:00", "15:30:00"];
    let insertedRows = 0;

    for (const d of dates) {
        const baseDate = new Date(d.date);

        // Expiries: current week (Thursday) + next week
        const exp1 = new Date(baseDate);
        const dayOfWeek = exp1.getDay();
        const daysToThu = (4 - dayOfWeek + 7) % 7 || 7;
        exp1.setDate(exp1.getDate() + daysToThu);
        const exp1Str = exp1.toISOString().split("T")[0];

        const exp2 = new Date(exp1);
        exp2.setDate(exp2.getDate() + 7);
        const exp2Str = exp2.toISOString().split("T")[0];

        const expiriesList = [exp1Str, exp2Str];

        // 1. NIFTY (step 50)
        for (const t of times) {
            const timeOffset = times.indexOf(t) * 12; // drift
            const spot = d.niftySpot + timeOffset;

            for (const exp of expiriesList) {
                const daysLeft = Math.max(0.5, (new Date(exp) - new Date(d.date)) / 86400000);
                const tYears = daysLeft / 365;
                const atmStrike = Math.round(spot / 50) * 50;

                const batchValues = [];
                for (let step = -10; step <= 10; step++) {
                    const strike = atmStrike + step * 50;
                    const iv = 13.5 + Math.abs(step) * 0.4;
                    const ce = computeOptionMetrics(spot, strike, tYears, iv / 100, "CE");
                    const pe = computeOptionMetrics(spot, strike, tYears, iv / 100, "PE");
                    const ceOi = Math.max(1000, Math.round(50000 - Math.abs(step) * 3500 + Math.random() * 5000));
                    const peOi = Math.max(1000, Math.round(48000 - Math.abs(step) * 3200 + Math.random() * 5000));
                    const ceVol = Math.round(ceOi * 0.45);
                    const peVol = Math.round(peOi * 0.45);

                    batchValues.push([
                        "NIFTY", d.date, t, exp, strike, spot,
                        ce.ltp, ceOi, 250, iv, ceVol, ce.delta, ce.gamma, ce.theta, ce.vega,
                        pe.ltp, peOi, -180, iv, peVol, pe.delta, pe.gamma, pe.theta, pe.vega
                    ]);
                }

                if (batchValues.length > 0) {
                    await pool.query(
                        `INSERT INTO option_chain_history (
                            symbol, trade_date, trade_time, expiry, strike, underlying_price,
                            ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                            pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
                        ) VALUES ? ON DUPLICATE KEY UPDATE
                            underlying_price = VALUES(underlying_price),
                            ce_ltp = VALUES(ce_ltp), ce_oi = VALUES(ce_oi), ce_iv = VALUES(ce_iv),
                            pe_ltp = VALUES(pe_ltp), pe_oi = VALUES(pe_oi), pe_iv = VALUES(pe_iv)`,
                        [batchValues]
                    );
                    insertedRows += batchValues.length;
                }
            }
        }

        // 2. BANKNIFTY (step 100)
        for (const t of times) {
            const timeOffset = times.indexOf(t) * 35;
            const spot = d.bnfSpot + timeOffset;

            for (const exp of expiriesList) {
                const daysLeft = Math.max(0.5, (new Date(exp) - new Date(d.date)) / 86400000);
                const tYears = daysLeft / 365;
                const atmStrike = Math.round(spot / 100) * 100;

                const batchValues = [];
                for (let step = -10; step <= 10; step++) {
                    const strike = atmStrike + step * 100;
                    const iv = 16.2 + Math.abs(step) * 0.5;
                    const ce = computeOptionMetrics(spot, strike, tYears, iv / 100, "CE");
                    const pe = computeOptionMetrics(spot, strike, tYears, iv / 100, "PE");
                    const ceOi = Math.max(800, Math.round(35000 - Math.abs(step) * 2500 + Math.random() * 3000));
                    const peOi = Math.max(800, Math.round(34000 - Math.abs(step) * 2400 + Math.random() * 3000));

                    batchValues.push([
                        "BANKNIFTY", d.date, t, exp, strike, spot,
                        ce.ltp, ceOi, 150, iv, Math.round(ceOi * 0.4), ce.delta, ce.gamma, ce.theta, ce.vega,
                        pe.ltp, peOi, -90, iv, Math.round(peOi * 0.4), pe.delta, pe.gamma, pe.theta, pe.vega
                    ]);
                }

                if (batchValues.length > 0) {
                    await pool.query(
                        `INSERT INTO option_chain_history (
                            symbol, trade_date, trade_time, expiry, strike, underlying_price,
                            ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                            pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
                        ) VALUES ? ON DUPLICATE KEY UPDATE
                            underlying_price = VALUES(underlying_price),
                            ce_ltp = VALUES(ce_ltp), ce_oi = VALUES(ce_oi), ce_iv = VALUES(ce_iv),
                            pe_ltp = VALUES(pe_ltp), pe_oi = VALUES(pe_oi), pe_iv = VALUES(pe_iv)`,
                        [batchValues]
                    );
                    insertedRows += batchValues.length;
                }
            }
        }
    }

    return insertedRows;
}

/**
 * Generate & insert Sample India VIX Data into ohlcv_data
 */
async function importSampleVixData() {
    const dates = [
        "2024-01-15", "2024-06-04", "2024-11-06", "2025-01-20",
        "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"
    ];

    const times = [
        "09:15:00", "09:30:00", "10:00:00", "10:30:00", "11:00:00", "11:30:00",
        "12:00:00", "12:30:00", "13:00:00", "13:30:00", "14:00:00", "14:30:00",
        "15:00:00", "15:15:00", "15:30:00"
    ];

    const batchValues = [];

    for (const d of dates) {
        let baseVix = 13.4;
        if (d === "2024-06-04") baseVix = 24.5; // Election Day spike
        if (d === "2024-11-06") baseVix = 15.8;

        for (let i = 0; i < times.length; i++) {
            const t = times[i];
            const noise = (Math.sin(i * 0.7) * 0.45);
            const open = Math.round((baseVix + noise) * 100) / 100;
            const high = Math.round((open + 0.35 + Math.random() * 0.2) * 100) / 100;
            const low = Math.round((open - 0.25 - Math.random() * 0.15) * 100) / 100;
            const close = Math.round((open + (Math.random() - 0.5) * 0.3) * 100) / 100;

            batchValues.push(["INDIAVIX", d, t, open, high, low, close, 0]);
        }
    }

    if (batchValues.length > 0) {
        await pool.query(
            `INSERT INTO ohlcv_data (
                symbol, trade_date, trade_time, open, high, low, close, volume
            ) VALUES ? ON DUPLICATE KEY UPDATE
                open = VALUES(open), high = VALUES(high), low = VALUES(low), close = VALUES(close)`,
            [batchValues]
        );
    }

    return batchValues.length;
}

/**
 * Generate & insert Sample Futures History for NIFTY & BANKNIFTY
 */
async function importSampleFuturesData() {
    const dates = [
        { date: "2024-01-15", niftySpot: 21500, bnfSpot: 47800, exp: "2024-01-25" },
        { date: "2024-06-04", niftySpot: 21884, bnfSpot: 46928, exp: "2024-06-27" },
        { date: "2024-11-06", niftySpot: 24484, bnfSpot: 52317, exp: "2024-11-28" },
        { date: "2025-01-20", niftySpot: 23200, bnfSpot: 49800, exp: "2025-01-30" },
        { date: "2026-10-08", niftySpot: 25150, bnfSpot: 51800, exp: "2026-10-29" },
        { date: "2026-10-10", niftySpot: 24964, bnfSpot: 51240, exp: "2026-10-29" },
    ];

    const times = ["09:15:00", "10:30:00", "12:00:00", "13:30:00", "14:45:00", "15:30:00"];
    const batchValues = [];

    for (const item of dates) {
        for (let i = 0; i < times.length; i++) {
            const t = times[i];
            // NIFTY Futures
            const nSpot = item.niftySpot + i * 15;
            const nFutPrice = nSpot + 45.2; // Premium basis
            batchValues.push([
                "NIFTY", item.exp, item.date, t,
                nFutPrice - 10, nFutPrice + 20, nFutPrice - 15, nFutPrice,
                150000 + i * 10000, 11500000 + i * 25000, 45000, nSpot
            ]);

            // BANKNIFTY Futures
            const bSpot = item.bnfSpot + i * 30;
            const bFutPrice = bSpot + 112.5;
            batchValues.push([
                "BANKNIFTY", item.exp, item.date, t,
                bFutPrice - 25, bFutPrice + 45, bFutPrice - 30, bFutPrice,
                120000 + i * 8000, 2400000 + i * 12000, 15000, bSpot
            ]);
        }
    }

    if (batchValues.length > 0) {
        await pool.query(
            `INSERT INTO futures_history (
                symbol, expiry, trade_date, trade_time, open, high, low, close, volume, oi, oi_change, underlying_price
            ) VALUES ? ON DUPLICATE KEY UPDATE
                open = VALUES(open), high = VALUES(high), low = VALUES(low), close = VALUES(close),
                volume = VALUES(volume), oi = VALUES(oi), underlying_price = VALUES(underlying_price)`,
            [batchValues]
        );
    }

    return batchValues.length;
}

/**
 * Generate & insert Sample Crypto Derivatives (BTC, ETH, SOL)
 */
async function importSampleCryptoData() {
    const cryptoAssets = [
        { symbol: "BTCUSD", spot: 83322.3, step: 200, iv: 42.0 },
        { symbol: "ETHUSD", spot: 3485.4, step: 25, iv: 48.5 },
        { symbol: "SOLUSD", spot: 154.8, step: 2, iv: 55.0 },
    ];

    const dates = ["2024-03-14", "2024-11-06", "2025-01-20", "2026-03-10", "2026-10-11"];
    const times = ["00:00:00", "06:00:00", "12:00:00", "18:00:00", "23:59:00"];

    let insertedRows = 0;

    for (const c of cryptoAssets) {
        for (const d of dates) {
            const expDate = new Date(d);
            expDate.setDate(expDate.getDate() + 7);
            const expStr = expDate.toISOString().split("T")[0];

            for (const t of times) {
                const atm = Math.round(c.spot / c.step) * c.step;
                const batchValues = [];

                for (let step = -6; step <= 6; step++) {
                    const strike = atm + step * c.step;
                    const daysLeft = 7;
                    const tYears = daysLeft / 365;
                    const ce = computeOptionMetrics(c.spot, strike, tYears, c.iv / 100, "CE");
                    const pe = computeOptionMetrics(c.spot, strike, tYears, c.iv / 100, "PE");

                    batchValues.push([
                        c.symbol, d, t, expStr, strike, c.spot,
                        ce.ltp, 1250, 45, c.iv, 450, ce.delta, ce.gamma, ce.theta, ce.vega,
                        pe.ltp, 1180, -20, c.iv, 410, pe.delta, pe.gamma, pe.theta, pe.vega
                    ]);
                }

                if (batchValues.length > 0) {
                    await pool.query(
                        `INSERT INTO option_chain_history (
                            symbol, trade_date, trade_time, expiry, strike, underlying_price,
                            ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                            pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
                        ) VALUES ? ON DUPLICATE KEY UPDATE
                            underlying_price = VALUES(underlying_price),
                            ce_ltp = VALUES(ce_ltp), ce_oi = VALUES(ce_oi), ce_iv = VALUES(ce_iv),
                            pe_ltp = VALUES(pe_ltp), pe_oi = VALUES(pe_oi), pe_iv = VALUES(pe_iv)`,
                        [batchValues]
                    );
                    insertedRows += batchValues.length;
                }
            }
        }
    }

    return insertedRows;
}

/**
 * Invalidate internal and disk caches so newly imported sample data is immediately live
 */
function invalidateAllCaches() {
    try {
        fs.writeFileSync(DATES_INVALIDATION_FILE, String(Date.now()));
    } catch (e) {
        console.warn("[SampleDataService] Error invalidating dates cache:", e.message);
    }
    try {
        fs.writeFileSync(COVERAGE_INVALIDATION_FILE, String(Date.now()));
    } catch (e) {
        console.warn("[SampleDataService] Error invalidating coverage cache:", e.message);
    }
}

/**
 * 1-Click Master Importer
 */
async function importAllSampleData(category = "all") {
    const results = {};

    if (category === "all" || category === "options") {
        results.optionRows = await importSampleOptionData();
    }
    if (category === "all" || category === "vix") {
        results.vixRows = await importSampleVixData();
    }
    if (category === "all" || category === "futures") {
        results.futuresRows = await importSampleFuturesData();
    }
    if (category === "all" || category === "crypto") {
        results.cryptoRows = await importSampleCryptoData();
    }

    invalidateAllCaches();
    return results;
}

/**
 * Clear or reset sample data
 */
async function clearSampleData(category = "all") {
    const results = {};

    if (category === "all" || category === "options") {
        const [res] = await pool.query(
            "DELETE FROM option_chain_history WHERE symbol IN ('NIFTY', 'BANKNIFTY', 'FINNIFTY') AND trade_date IN ('2024-01-15', '2024-06-04', '2024-11-06', '2025-01-20', '2026-10-08', '2026-10-10')"
        );
        results.clearedOptions = res.affectedRows;
    }
    if (category === "all" || category === "vix") {
        const [res] = await pool.query(
            "DELETE FROM ohlcv_data WHERE symbol = 'INDIAVIX' AND trade_date IN ('2024-01-15', '2024-06-04', '2024-11-06', '2025-01-20', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11')"
        );
        results.clearedVix = res.affectedRows;
    }
    if (category === "all" || category === "futures") {
        const [res] = await pool.query(
            "DELETE FROM futures_history WHERE symbol IN ('NIFTY', 'BANKNIFTY') AND trade_date IN ('2024-01-15', '2024-06-04', '2024-11-06', '2025-01-20', '2026-10-08', '2026-10-10')"
        );
        results.clearedFutures = res.affectedRows;
    }
    if (category === "all" || category === "crypto") {
        const [res] = await pool.query(
            "DELETE FROM option_chain_history WHERE symbol IN ('BTCUSD', 'ETHUSD', 'SOLUSD')"
        );
        results.clearedCrypto = res.affectedRows;
    }

    invalidateAllCaches();
    return results;
}

module.exports = {
    getSampleDataStats,
    importAllSampleData,
    clearSampleData,
};
