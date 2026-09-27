// backtest/spot.js — 1-minute underlying spot (index or stock cash price)
// from ICICI Breeze, stored in ohlcv_data.
//
// The backtest engine needs this directly: it reads its trading-day list and
// its entry-time spot from ohlcv_data (server/services/backtestEngine.js).
// It is also what picks each day's ATM strike window (backtest/planner.js)
// and feeds per-minute IV/Greeks — 2023-era NSE bhavcopy files carry NO
// underlying-price column, so bhavcopy alone can't supply it.
//
// Confirmed live 2026-09-25: NIFTY and CNXBAN (BANKNIFTY) on exchange "NSE",
// productType "cash", return 375 real candles/day for Jan 2023 (NIFTY closed
// 18,234.8 on 2023-01-03 — matches the real close). The other index codes
// come from breeze/symbolMap.js INDEX_OVERRIDES and are unverified; SENSEX/
// BANKEX use exchange "BSE" by default (override with
// BREEZE_SPOT_EXCHANGE_<SYMBOL>). A wrong code shows up as "0 spot candles"
// in the log and the planner falls back to put-call parity for ATM.
//
// Resumable: only days with too few stored minute rows are fetched again.

const { pool } = require("../lib/db");
const { getBreeze } = require("../breeze/auth");
const rateLimiter = require("../breeze/rateLimiter");
const symbolMap = require("../breeze/symbolMap");
const { isoIst, parseRows, callWithTransientRetry } = require("../breeze/historicalService");

const MIN_ROWS_PER_DAY = 300; // a full session is 375; allow for a few missing minutes
const INSERT_BATCH_SIZE = 500;

function spotExchangeFor(symbol) {
    const override = process.env[`BREEZE_SPOT_EXCHANGE_${symbol}`];
    if (override) return override;
    return symbolMap.BSE_FO_SYMBOLS.has(symbol) ? "BSE" : "NSE";
}

async function loadStored(symbol, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT trade_date, trade_time, low, high, close FROM ohlcv_data
         WHERE symbol = ? AND trade_date BETWEEN ? AND ? AND trade_time <> '00:00:00'
         ORDER BY trade_date, trade_time`,
        [symbol, fromDate, toDate]
    );
    // date -> { low, high, close, byTime: Map<'HH:MM:SS', close> }
    const byDate = new Map();
    for (const r of rows) {
        let d = byDate.get(r.trade_date);
        if (!d) {
            d = { low: Infinity, high: -Infinity, close: null, byTime: new Map() };
            byDate.set(r.trade_date, d);
        }
        const close = Number(r.close);
        d.low = Math.min(d.low, Number(r.low) || close);
        d.high = Math.max(d.high, Number(r.high) || close);
        d.close = close; // rows are time-ordered, so last one wins
        d.byTime.set(r.trade_time, close);
    }
    return byDate;
}

async function storeRows(symbol, candles) {
    const values = candles.map((c) => [symbol, c.date, c.time, c.open, c.high, c.low, c.close, c.volume || 0]);
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
        await pool.query(
            `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
             VALUES ?
             ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)`,
            [values.slice(i, i + INSERT_BATCH_SIZE)]
        );
    }
    return values.length;
}

/**
 * Makes sure ohlcv_data has minute spot for every trading day in `days`
 * (fetching only what's missing), then returns the per-day map from the DB.
 * `chunks` = the same 2-trading-day windows the option fetch uses.
 */
async function ensureSpot(symbol, days, chunkDays, { fetch = true } = {}) {
    if (!days.length) return { byDate: new Map(), fetched: 0, calls: 0 };
    const from = days[0], to = days[days.length - 1];
    let byDate = await loadStored(symbol, from, to);

    const missing = days.filter((d) => (byDate.get(d)?.byTime.size || 0) < MIN_ROWS_PER_DAY);
    if (!missing.length || !fetch) return { byDate, fetched: 0, calls: 0 };

    const breeze = await getBreeze();
    const stockCode = await symbolMap.resolveStockCode(symbol);
    const exchangeCode = spotExchangeFor(symbol);
    let fetched = 0, calls = 0;
    for (const [cFrom, cTo] of chunkDays(missing)) {
        await rateLimiter.throttle();
        calls += 1;
        const resp = await callWithTransientRetry(
            () => breeze.getHistoricalDatav2({
                interval: "1minute",
                fromDate: isoIst(cFrom, "09:15:00"),
                toDate: isoIst(cTo, "15:30:00"),
                stockCode, exchangeCode, productType: "cash",
            }),
            `${symbol} SPOT ${cFrom}..${cTo}`
        );
        if (resp?.Error) throw new Error(`Breeze getHistoricalDatav2 error (spot ${symbol}): ${resp.Error}`);
        const candles = parseRows(Array.isArray(resp?.Success) ? resp.Success : []).filter((c) => c.date && c.time && c.close > 0);
        fetched += await storeRows(symbol, candles);
    }
    if (fetched === 0) {
        console.warn(`[backtest] ${symbol}: 0 spot candles from Breeze (stockCode=${stockCode}, exchange=${exchangeCode}) — ATM falls back to put-call parity, Greeks will be null. Check the stock code / BREEZE_SPOT_EXCHANGE_${symbol}.`);
    }
    byDate = await loadStored(symbol, from, to);
    return { byDate, fetched, calls };
}

module.exports = { ensureSpot, MIN_ROWS_PER_DAY };
