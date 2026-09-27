// backtest/fetch.js — executes a planner.js plan against ICICI Breeze.
//
// Options: per planned run, per 2-trading-day chunk, fetch CE + PE 1-minute
// candles, compute IV/Greeks against the SAME minute's spot (from
// ohlcv_data, see spot.js), upsert into option_chain_history via
// breeze/enrich.js's storeRows (same columns + ON DUPLICATE KEY UPDATE as
// every other writer). Stored after EVERY chunk, so when the daily budget
// runs out mid-month at most one chunk's calls are lost.
//
// Futures: same per-chunk loop, 1 call per chunk, into futures_history via
// lib/futuresStorage.js (shared with the older Breeze/Upstox futures paths).
//
// Resume: before fetching, one query per (symbol, month) loads which
// (contract, date) pairs already have minute rows; a chunk whose days are
// all present is skipped with zero Breeze calls.

const { pool } = require("../lib/db");
const historicalService = require("../breeze/historicalService");
const symbolMap = require("../breeze/symbolMap");
const bs = require("../lib/blackScholes");
const { storeRows: storeOptionRows, yearsToExpiryAsOf } = require("../breeze/enrich");
const futuresStorage = require("../lib/futuresStorage");

// Minute rows a futures (expiry, day) needs to count as already downloaded.
// Guards against older DAILY rows (e.g. Dhan's continuous daily futures)
// being mistaken for real minute coverage.
const FUTURE_MIN_ROWS_PER_DAY = 30;

async function existingOptionDays(symbol, from, to) {
    const [rows] = await pool.query(
        `SELECT expiry, strike, trade_date FROM option_chain_history
         WHERE symbol = ? AND trade_date BETWEEN ? AND ? AND trade_time <> '15:30:00'
         GROUP BY expiry, strike, trade_date`,
        [symbol, from, to]
    );
    return new Set(rows.map((r) => `${r.expiry}|${Number(r.strike)}|${r.trade_date}`));
}

async function existingFutureDays(symbol, from, to) {
    const [rows] = await pool.query(
        `SELECT expiry, trade_date FROM futures_history
         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
         GROUP BY expiry, trade_date HAVING COUNT(*) >= ?`,
        [symbol, from, to, FUTURE_MIN_ROWS_PER_DAY]
    );
    return new Set(rows.map((r) => `${r.expiry}|${r.trade_date}`));
}

function daysInChunk([from, to], runDays) {
    return runDays.filter((d) => d >= from && d <= to);
}

function spotAt(spotByDate, date, time) {
    const d = spotByDate.get(date);
    if (!d) return null;
    return d.byTime.get(time) ?? d.close ?? null;
}

function withGreeks(candles, { strike, right, expiry, spotByDate }) {
    let prevOi = null;
    return candles.map((c) => {
        const spot = spotAt(spotByDate, c.date, c.time);
        let iv = null, g = { delta: null, gamma: null, theta: null, vega: null };
        if (spot != null && c.close > 0) {
            const t = yearsToExpiryAsOf(expiry, c.date, c.time);
            iv = bs.impliedVolatility({ marketPrice: c.close, spot, strike, t, right });
            if (iv != null) g = bs.greeks({ spot, strike, t, vol: iv, right });
        }
        const oiChange = prevOi != null ? c.oi - prevOi : null;
        prevOi = c.oi;
        return { ...c, spot, iv: iv != null ? iv * 100 : null, oiChange, ...g };
    });
}

async function fetchOptions(symbol, plan, spotByDate, monthFrom, monthTo, log) {
    const exchangeCode = symbolMap.exchangeCodeFor(symbol);
    const have = await existingOptionDays(symbol, monthFrom, monthTo);
    let rows = 0, calls = 0, skipped = 0, failed = 0, done = 0;

    for (const run of plan.optionRuns) {
        for (const chunk of run.chunks) {
            const chunkDays = daysInChunk(chunk, run.days);
            if (chunkDays.every((d) => have.has(`${run.expiry}|${run.strike}|${d}`))) { skipped += 1; continue; }
            try {
                const args = { stockCode: symbol, expirySql: run.expiry, strike: run.strike, fromDateStr: chunk[0], toDateStr: chunk[1], exchangeCode, chunks: [chunk] };
                calls += 2;
                const ceRaw = await historicalService.getOptionMinuteCandles({ ...args, right: "CE" });
                const peRaw = await historicalService.getOptionMinuteCandles({ ...args, right: "PE" });
                const ce = withGreeks(ceRaw, { strike: run.strike, right: "call", expiry: run.expiry, spotByDate });
                const pe = withGreeks(peRaw, { strike: run.strike, right: "put", expiry: run.expiry, spotByDate });
                rows += await storeOptionRows(symbol, run.expiry, run.strike, ce, pe);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/daily call budget spent/.test(msg)) throw err;
                failed += 1;
                log(`  ! ${symbol} ${run.expiry} ${run.strike} ${chunk[0]}..${chunk[1]}: ${msg.split("\n")[0]}`);
                if (/session|unauthor|invalid.*(key|token)|checksum/i.test(msg)) throw err; // don't burn the list on a dead session
            }
        }
        done += 1;
        if (done % 50 === 0) log(`  options ${done}/${plan.optionRuns.length} runs, ${rows} rows, ${calls} calls, ${skipped} chunks already stored`);
    }
    return { rows, calls, skipped, failed };
}

async function fetchFutures(symbol, plan, spotByDate, monthFrom, monthTo, log) {
    const exchangeCode = symbolMap.exchangeCodeFor(symbol);
    const have = await existingFutureDays(symbol, monthFrom, monthTo);
    const dayClose = new Map([...spotByDate].map(([d, v]) => [d, v.close]));
    let rows = 0, calls = 0, skipped = 0, failed = 0;

    for (const run of plan.futureRuns) {
        for (const chunk of run.chunks) {
            const chunkDays = daysInChunk(chunk, run.days);
            if (chunkDays.every((d) => have.has(`${run.expiry}|${d}`))) { skipped += 1; continue; }
            try {
                calls += 1;
                const candles = await historicalService.getFutureMinuteCandles({
                    stockCode: symbol, expirySql: run.expiry, fromDateStr: chunk[0], toDateStr: chunk[1], exchangeCode, chunks: [chunk],
                });
                rows += await futuresStorage.storeRows(symbol, run.expiry, futuresStorage.withOiChange(candles), dayClose);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/daily call budget spent/.test(msg)) throw err;
                failed += 1;
                log(`  ! ${symbol} FUT ${run.expiry} ${chunk[0]}..${chunk[1]}: ${msg.split("\n")[0]}`);
                if (/session|unauthor|invalid.*(key|token)|checksum/i.test(msg)) throw err;
            }
        }
    }
    return { rows, calls, skipped, failed };
}

module.exports = { fetchOptions, fetchFutures };
