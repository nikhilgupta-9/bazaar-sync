// services/cron.js — nightly historical pull via Angel One SmartAPI.
//
// Runs 23:00 IST Mon-Fri (after close + settlement), never blocking a
// request path. Feeds the SAME two tables the backtesting engine reads
// (option_chain_history + ohlcv_data, unchanged shape) — the engine itself
// still reads only MySQL, never a broker API.
//
// Flow per symbol:
//   1. index 1-minute candles (getCandleData, NSE)          -> ohlcv_data
//   2. nearest-expiry option contracts (instrument master),
//      per contract: 1-minute candles + per-minute OI (NFO) -> option_chain_history
//      (CE/PE merged per strike per minute, like the old Breeze cron did)
//   3. backfill option_chain_history.underlying_price from ohlcv_data
//
// All date math on plain 'YYYY-MM-DD' strings (CLAUDE.md Gotcha #12).

const cron = require("node-cron");
const { pool } = require("../config/db");
const instrumentMaster = require("./instrumentMaster");
const angelHist = require("./angelOneHistorical");
const { dbLogger } = require("../config/logger");

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

// Bound the per-night API-call volume: only pull contracts within this many
// strikes of the day's closing spot (each contract = 2 API calls: candles+OI).
const HIST_STRIKES_PER_SIDE = Number(process.env.HIST_STRIKES_PER_SIDE || 20);

async function storeOHLCV(symbol, candles) {
    if (!candles.length) return;
    const values = candles.map((c) => [symbol, c.date, c.time, c.open, c.high, c.low, c.close, c.volume]);
    await pool.query(
        `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
         VALUES ?
         ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low),
           close=VALUES(close), volume=VALUES(volume)`,
        [values]
    );
}

// Merge same-minute CE/PE candle+OI rows for one strike into
// option_chain_history rows (IV/greeks stay null here — historical greeks
// would need a historical IV series; the live worker persists live greeks
// separately in live_greeks_snapshots).
async function storeOptionChainMinutes(symbol, expirySql, strike, ceCandles, ceOi, peCandles, peOi) {
    const byTime = new Map();
    for (const c of ceCandles) {
        byTime.set(c.time, { date: c.date, time: c.time, ceLtp: c.close, ceVolume: c.volume, ceOi: ceOi.get(c.time) ?? null });
    }
    for (const c of peCandles) {
        const row = byTime.get(c.time) ?? { date: c.date, time: c.time };
        row.peLtp = c.close;
        row.peVolume = c.volume;
        row.peOi = peOi.get(c.time) ?? null;
        byTime.set(c.time, row);
    }
    const rows = [...byTime.values()];
    if (!rows.length) return;

    const values = rows.map((r) => [
        symbol, r.date, r.time, expirySql, strike,
        r.ceLtp ?? null, r.ceOi ?? null, r.ceVolume ?? null,
        r.peLtp ?? null, r.peOi ?? null, r.peVolume ?? null,
    ]);
    await pool.query(
        `INSERT INTO option_chain_history (
           symbol, trade_date, trade_time, expiry, strike,
           ce_ltp, ce_oi, ce_volume, pe_ltp, pe_oi, pe_volume
         ) VALUES ?
         ON DUPLICATE KEY UPDATE
           ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_volume=VALUES(ce_volume),
           pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_volume=VALUES(pe_volume)`,
        [values]
    );
}

async function pullOHLCVForDate(symbol, dateStr) {
    const token = instrumentMaster.getIndexToken(symbol);
    if (!token) throw new Error(`No index token for ${symbol}`);
    const candles = await angelHist.getDayCandles({ exchange: "NSE", symboltoken: token, dateStr });
    await storeOHLCV(symbol, candles);
    dbLogger.info(`[cron] ${symbol} ${dateStr}: ${candles.length} index candles stored`);
    return candles;
}

/** Closing spot for the day from ohlcv_data (used to center the strike window). */
async function dayClose(symbol, dateStr) {
    const [rows] = await pool.query(
        `SELECT close FROM ohlcv_data WHERE symbol = ? AND trade_date = ?
         ORDER BY trade_time DESC LIMIT 1`,
        [symbol, dateStr]
    );
    return rows.length ? Number(rows[0].close) : null;
}

/**
 * Full-day minute-by-minute option chain (price + OI) for one expiry, by
 * looping every in-window strike and pulling each CE/PE contract's candles
 * and OI series individually (Angel One's historical API is per-token, same
 * per-contract model as Breeze's was).
 */
async function pullOptionChainForExpiry(symbol, expirySql, dateStr) {
    const center = await dayClose(symbol, dateStr);
    const contracts = await instrumentMaster.getOptionContracts(symbol, expirySql, {
        centerPrice: center,
        strikesPerSide: center != null ? HIST_STRIKES_PER_SIDE : null,
    });
    if (!contracts.length) {
        dbLogger.warn(`[cron] ${symbol} ${dateStr}: no contracts in scrip master for expiry ${expirySql}`);
        return;
    }

    // Pair CE/PE per strike
    const byStrike = new Map();
    for (const c of contracts) {
        const entry = byStrike.get(c.strike) || {};
        entry[c.right] = c;
        byStrike.set(c.strike, entry);
    }

    let stored = 0;
    for (const [strike, pair] of byStrike) {
        try {
            const ce = pair.CE
                ? await angelHist.getDayCandles({ exchange: "NFO", symboltoken: pair.CE.token, dateStr })
                : [];
            const ceOi = pair.CE
                ? await angelHist.getDayOpenInterest({ exchange: "NFO", symboltoken: pair.CE.token, dateStr })
                : new Map();
            const pe = pair.PE
                ? await angelHist.getDayCandles({ exchange: "NFO", symboltoken: pair.PE.token, dateStr })
                : [];
            const peOi = pair.PE
                ? await angelHist.getDayOpenInterest({ exchange: "NFO", symboltoken: pair.PE.token, dateStr })
                : new Map();

            await storeOptionChainMinutes(symbol, expirySql, strike, ce, ceOi, pe, peOi);
            stored += 1;
        } catch (err) {
            dbLogger.error(`[cron] ${symbol} ${dateStr} strike ${strike}: ${err.message}`);
        }
    }
    dbLogger.info(`[cron] ${symbol} ${dateStr}: option data stored for ${stored}/${byStrike.size} strikes (expiry ${expirySql})`);
}

// option_chain_history has no underlying_price of its own — backfilled from
// ohlcv_data by matching trade_date+trade_time (same as the old Breeze cron).
async function backfillUnderlyingPrice(symbol, dateStr) {
    await pool.query(
        `UPDATE option_chain_history och
         JOIN ohlcv_data ohl
           ON och.symbol = ohl.symbol AND och.trade_date = ohl.trade_date AND och.trade_time = ohl.trade_time
         SET och.underlying_price = ohl.close
         WHERE och.symbol = ? AND och.trade_date = ? AND och.underlying_price IS NULL`,
        [symbol, dateStr]
    );
}

async function pullSymbolForDate(symbol, dateStr, expiries = null) {
    await pullOHLCVForDate(symbol, dateStr);
    const expiryList = expiries && expiries.length ? expiries : (await instrumentMaster.getExpiries(symbol)).slice(0, 1);
    for (const expirySql of expiryList) {
        await pullOptionChainForExpiry(symbol, expirySql, dateStr);
    }
    await backfillUnderlyingPrice(symbol, dateStr);
}

async function runNightlyPull() {
    const dateStr = instrumentMaster.todayIst();
    dbLogger.info(`[cron] nightly pull starting for ${dateStr}`);
    for (const symbol of SYMBOLS) {
        try {
            await pullSymbolForDate(symbol, dateStr);
            dbLogger.info(`[cron] stored ${symbol} data for ${dateStr}`);
        } catch (err) {
            dbLogger.error(`[cron] failed to pull ${symbol} for ${dateStr}: ${err.message}`);
        }
    }
    dbLogger.info(`[cron] nightly pull finished for ${dateStr}`);
}

let task = null;

// Runs 23:00 IST, Mon-Fri, after market close and settlement.
function start() {
    if (task) return;
    task = cron.schedule("0 23 * * 1-5", () => runNightlyPull(), { timezone: "Asia/Kolkata" });
    dbLogger.info("[cron] nightly historical data pull scheduled for 23:00 IST (Mon-Fri)");
}

function stop() {
    if (task) {
        task.stop();
        task = null;
    }
}

module.exports = {
    start,
    stop,
    runNightlyPull,
    pullSymbolForDate,
    pullOHLCVForDate,
    pullOptionChainForExpiry,
    backfillUnderlyingPrice,
};
