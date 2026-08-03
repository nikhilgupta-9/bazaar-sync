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
const bs = require("../utils/blackScholes");
const { dbLogger } = require("../config/logger");

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

// Bound the per-night API-call volume: only pull contracts within this many
// strikes of the day's closing spot (each contract = 2 API calls: candles+OI).
const HIST_STRIKES_PER_SIDE = Number(process.env.HIST_STRIKES_PER_SIDE || 20);

// Years between (dateStr, timeStr) and expirySql, both IST wall-clock,
// expiry cutoff 15:30 IST. Same Date.UTC-only approach as
// scripts/backfillUpstox.js's yearsToExpiryAsOf — deliberately NOT
// blackScholes.js's yearsToExpiry(expiryDate, now=new Date()), which
// defaults to the real current time and isn't meant for computing "years
// to expiry as of an arbitrary historical minute" (CLAUDE.md Gotcha #12:
// no ambient/local-timezone Date parsing for historical data).
function yearsToExpiryAsOf(expirySql, dateStr, timeStr) {
    const [ey, em, ed] = expirySql.split("-").map(Number);
    const [dy, dm, dd] = dateStr.split("-").map(Number);
    const [hh, mm, ss] = (timeStr || "15:30:00").split(":").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const expiryUtcMs = Date.UTC(ey, em - 1, ed, 15, 30, 0) - IST_OFFSET_MS;
    const rowUtcMs = Date.UTC(dy, dm - 1, dd, hh, mm, ss) - IST_OFFSET_MS;
    const ms = expiryUtcMs - rowUtcMs;
    return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4)); // floor at 15 min
}

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
// option_chain_history rows. Computes IV/Greeks per minute via
// utils/blackScholes.js using that minute's real index close (from
// ohlcv_data, already pulled earlier in pullSymbolForDate) — same convention
// backfillUpstox.js/backfillBreeze.js already use for their historical rows,
// so option_chain_history's Greeks columns are populated consistently
// regardless of which of the 4 Phase 7 sources wrote a given row. Previously
// these stayed NULL for Angel-One-cron-sourced days (2026-07-31 fix) — the
// live worker's OWN 5-second live_greeks_snapshots table is unaffected and
// still exists separately for today's live/intraday polling use case.
async function storeOptionChainMinutes(symbol, expirySql, strike, ceCandles, ceOi, peCandles, peOi, spotByTime) {
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

    const values = rows.map((r) => {
        const spot = spotByTime ? spotByTime.get(r.time) ?? null : null;
        const t = yearsToExpiryAsOf(expirySql, r.date, r.time);
        let ceGreeks = { iv: null, delta: null, gamma: null, theta: null, vega: null };
        let peGreeks = { iv: null, delta: null, gamma: null, theta: null, vega: null };
        if (spot != null) {
            if (r.ceLtp > 0) {
                const iv = bs.impliedVolatility({ marketPrice: r.ceLtp, spot, strike, t, right: "call" });
                if (iv != null) ceGreeks = { iv: iv * 100, ...bs.greeks({ spot, strike, t, vol: iv, right: "call" }) };
            }
            if (r.peLtp > 0) {
                const iv = bs.impliedVolatility({ marketPrice: r.peLtp, spot, strike, t, right: "put" });
                if (iv != null) peGreeks = { iv: iv * 100, ...bs.greeks({ spot, strike, t, vol: iv, right: "put" }) };
            }
        }
        return [
            symbol, r.date, r.time, expirySql, strike, spot,
            r.ceLtp ?? null, r.ceOi ?? null, r.ceVolume ?? null, ceGreeks.iv, ceGreeks.delta, ceGreeks.gamma, ceGreeks.theta, ceGreeks.vega,
            r.peLtp ?? null, r.peOi ?? null, r.peVolume ?? null, peGreeks.iv, peGreeks.delta, peGreeks.gamma, peGreeks.theta, peGreeks.vega,
        ];
    });
    await pool.query(
        `INSERT INTO option_chain_history (
           symbol, trade_date, trade_time, expiry, strike, underlying_price,
           ce_ltp, ce_oi, ce_volume, ce_iv, ce_delta, ce_gamma, ce_theta, ce_vega,
           pe_ltp, pe_oi, pe_volume, pe_iv, pe_delta, pe_gamma, pe_theta, pe_vega
         ) VALUES ?
         ON DUPLICATE KEY UPDATE
           underlying_price=COALESCE(VALUES(underlying_price), underlying_price),
           ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_volume=VALUES(ce_volume),
           ce_iv=VALUES(ce_iv), ce_delta=VALUES(ce_delta), ce_gamma=VALUES(ce_gamma), ce_theta=VALUES(ce_theta), ce_vega=VALUES(ce_vega),
           pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_volume=VALUES(pe_volume),
           pe_iv=VALUES(pe_iv), pe_delta=VALUES(pe_delta), pe_gamma=VALUES(pe_gamma), pe_theta=VALUES(pe_theta), pe_vega=VALUES(pe_vega)`,
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

// Per-minute index close for the day, keyed by trade_time — queried fresh
// from ohlcv_data (already populated earlier the same run by
// pullOHLCVForDate) rather than threading candle arrays through call sites,
// same defensive style as dayClose(). Feeds storeOptionChainMinutes' per-
// minute Greeks calculation.
async function getSpotByTime(symbol, dateStr) {
    const [rows] = await pool.query(
        `SELECT trade_time, close FROM ohlcv_data WHERE symbol = ? AND trade_date = ?`,
        [symbol, dateStr]
    );
    return new Map(rows.map((r) => [r.trade_time, Number(r.close)]));
}

/**
 * Full-day minute-by-minute option chain (price + OI) for one expiry, by
 * looping every in-window strike and pulling each CE/PE contract's candles
 * and OI series individually (Angel One's historical API is per-token, same
 * per-contract model as Breeze's was).
 */
async function pullOptionChainForExpiry(symbol, expirySql, dateStr) {
    const center = await dayClose(symbol, dateStr);
    const spotByTime = await getSpotByTime(symbol, dateStr);
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

            await storeOptionChainMinutes(symbol, expirySql, strike, ce, ceOi, pe, peOi, spotByTime);
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
