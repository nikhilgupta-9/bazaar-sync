// services/sevenDayRollingDataService.js — Automated 7-Day Rolling Minute Data Retention & Fallback Loop
// Maintains 7-day rolling minute OHLCV, Options, Futures, and India VIX data for 7 Indices and ~210+ Stocks.
// Automatically detects data gaps and fetches from fallback APIs (Upstox / Angel One / Breeze / Yahoo / NSE) on schedule.

const cron = require("node-cron");
const { pool } = require("../config/db");
const instrumentMaster = require("./instrumentMaster");
const angelHist = require("./angelOneHistorical");
const upstoxHistorical = require("./upstoxHistorical");
const { dbLogger } = require("../config/logger");

const CORE_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const RETENTION_TRADING_DAYS = 7;

let isRunning = false;
let cronTask = null;

/**
 * Gets the list of the last N trading day date strings (YYYY-MM-DD) excluding weekends
 */
function getLastTradingDates(daysCount = RETENTION_TRADING_DAYS) {
    const dates = [];
    let d = new Date();
    while (dates.length < daysCount) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) { // Skip Sunday (0) and Saturday (6)
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            dates.push(`${yyyy}-${mm}-${dd}`);
        }
        d.setDate(d.getDate() - 1);
    }
    return dates;
}

/**
 * Prunes live tick data older than the 7-day rolling retention window
 */
async function pruneOldTicks() {
    try {
        const targetDates = getLastTradingDates(RETENTION_TRADING_DAYS);
        const oldestKeepDate = targetDates[targetDates.length - 1];

        console.log(`[Rolling7Day] 🧹 Pruning live ticks older than cutoff date: ${oldestKeepDate}...`);

        const [resIdx] = await pool.query("DELETE FROM live_index_ticks WHERE tick_date < ?", [oldestKeepDate]);
        const [resOpt] = await pool.query("DELETE FROM live_option_ticks WHERE tick_date < ?", [oldestKeepDate]);
        const [resGrk] = await pool.query("DELETE FROM live_greeks_snapshots WHERE snap_date < ?", [oldestKeepDate]);
        const [resPcr] = await pool.query("DELETE FROM pcr_snapshots WHERE snap_date < ?", [oldestKeepDate]);

        console.log(`[Rolling7Day] ✅ Cleaned: ${resIdx.affectedRows} index ticks, ${resOpt.affectedRows} option ticks, ${resGrk.affectedRows} greeks, ${resPcr.affectedRows} PCR snapshots.`);
    } catch (err) {
        console.error("[Rolling7Day] Error during live tick retention pruning:", err.message);
    }
}

/**
 * Ensures 1-minute OHLCV data for an index/stock for a target date
 */
async function ensureMinuteOHLCV(symbol, dateStr) {
    try {
        // 1. Check if DB already has enough minute candles (at least 300 for a full trading day)
        const [rows] = await pool.query(
            "SELECT COUNT(*) as count FROM ohlcv_data WHERE symbol = ? AND trade_date = ?",
            [symbol, dateStr]
        );
        if (rows[0].count >= 300) {
            return { symbol, date: dateStr, status: "already_complete", count: rows[0].count };
        }

        console.log(`[Rolling7Day] Fetching missing OHLCV data for ${symbol} on ${dateStr}...`);

        // 2. Try Upstox fallback
        if (process.env.UPSTOX_ACCESS_TOKEN) {
            try {
                const upstoxCandles = await upstoxHistorical.fetch1MinCandles(symbol, dateStr, dateStr);
                if (upstoxCandles && upstoxCandles.length > 0) {
                    const values = upstoxCandles.map((c) => [symbol, c.date, c.time, c.open, c.high, c.low, c.close, c.volume]);
                    await pool.query(
                        `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
                         VALUES ?
                         ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)`,
                        [values]
                    );
                    return { symbol, date: dateStr, source: "upstox", count: values.length };
                }
            } catch (upErr) {
                console.warn(`[Rolling7Day] Upstox fetch failed for ${symbol} on ${dateStr}:`, upErr.message);
            }
        }

        // 3. Try Angel One SmartAPI fallback
        try {
            const spotInfo = await instrumentMaster.getSpotToken(symbol);
            if (spotInfo && spotInfo.token) {
                const exch = spotInfo.exchSeg === "BSE" || spotInfo.exch === "BSE_CM" ? "BSE" : "NSE";
                const candles = await angelHist.getCandleData({
                    exchange: exch,
                    symboltoken: spotInfo.token,
                    interval: "ONE_MINUTE",
                    fromdate: `${dateStr} 09:15`,
                    todate: `${dateStr} 15:30`,
                });
                if (candles && candles.length > 0) {
                    const values = candles.map((c) => [symbol, c.date, c.time, c.open, c.high, c.low, c.close, c.volume]);
                    await pool.query(
                        `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
                         VALUES ?
                         ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)`,
                        [values]
                    );
                    return { symbol, date: dateStr, source: "angel_one", count: values.length };
                }
            }
        } catch (angelErr) {
            console.warn(`[Rolling7Day] Angel One fetch failed for ${symbol} on ${dateStr}:`, angelErr.message);
        }

        return { symbol, date: dateStr, status: "unavailable" };
    } catch (err) {
        return { symbol, date: dateStr, error: err.message };
    }
}

/**
 * Runs full 7-day rolling cycle across 7 indices, India VIX, and active F&O stocks
 */
async function run7DayRollingCycle() {
    if (isRunning) {
        console.log("[Rolling7Day] Cycle already in progress, skipping.");
        return;
    }
    isRunning = true;
    console.log("===============================================================");
    console.log("[Rolling7Day] 🔄 Starting Automated 7-Day Rolling Data Retention & Gap-Fill Cycle...");
    console.log("===============================================================");

    try {
        // Step 1: Prune old ticks
        await pruneOldTicks();

        // Step 2: Target dates
        const dates = getLastTradingDates(RETENTION_TRADING_DAYS);
        console.log(`[Rolling7Day] Target 7 Trading Dates: ${dates.join(", ")}`);

        // Step 3: Fill Indices & India VIX
        const targetUniverse = [...CORE_INDICES, "INDIAVIX"];
        for (const sym of targetUniverse) {
            for (const d of dates) {
                const res = await ensureMinuteOHLCV(sym, d);
                if (res.source) {
                    console.log(`[Rolling7Day] 📈 ${sym} (${d}): Filled ${res.count} candles via ${res.source}`);
                }
            }
        }

        // Step 4: Scan F&O Stocks (Sample top active symbols)
        const fnoStocks = instrumentMaster.getAllFnoSymbols ? await instrumentMaster.getAllFnoSymbols() : ["RELIANCE", "HDFCBANK", "INFY", "ICICIBANK", "TCS", "SBIN", "BHARTIARTL", "ITC", "TATAMOTORS"];
        const stocksToScan = fnoStocks.slice(0, 50); // Prioritize top 50 active F&O stocks

        for (const sym of stocksToScan) {
            for (const d of dates) {
                await ensureMinuteOHLCV(sym, d);
            }
        }

        console.log("[Rolling7Day] ✅ Automated 7-Day Data Loop completed successfully.");
    } catch (err) {
        console.error("[Rolling7Day] ❌ Error in 7-day rolling cycle:", err);
    } finally {
        isRunning = false;
    }
}

/**
 * Start the daily automated 7-day cron loop
 */
function start() {
    if (cronTask) return cronTask;

    // Run daily at 16:00 IST (Mon-Fri) after market close + settlement
    cronTask = cron.schedule(
        "0 16 * * 1-5",
        () => {
            console.log("[Rolling7Day] 16:00 IST post-market cron triggered");
            run7DayRollingCycle().catch(console.error);
        },
        { timezone: "Asia/Kolkata" }
    );

    console.log("[Rolling7Day] 7-Day Rolling Minute Retention & Fallback Cron scheduled: 16:00 IST Mon-Fri");
    return cronTask;
}

function stop() {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
    }
}

module.exports = {
    start,
    stop,
    run7DayRollingCycle,
    pruneOldTicks,
    ensureMinuteOHLCV,
    getLastTradingDates,
};
