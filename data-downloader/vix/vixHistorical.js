// vix/vixHistorical.js — India VIX 1-minute candles from ICICI Breeze.
//
// India VIX is a plain index time series — no strikes, no expiries, no
// CE/PE — so this is far simpler than the option-chain path: one Breeze
// getHistoricalDatav2 call per date-chunk, interval "1minute", no
// expiry/right/strike params.
//
// The Breeze stock code / exchange / product-type for India VIX is NOT
// independently confirmed here — the documented value is "INDIAVIX" on
// exchangeCode "NSE" as a "cash" product, but Breeze's index-symbol naming
// has bitten this project before (see the parent repo's CLAUDE.md Gotcha
// #13 about Angel One's deprecated index tokens). All three are
// env-overridable; test/testVix.js prints exactly what came back so a wrong
// code shows up as "0 candles", not silently-wrong data.
//
// Rows land in ohlcv_data (symbol = 'INDIAVIX'), which already has
// UNIQUE (symbol, trade_date, trade_time) — re-runs upsert, never duplicate.

const { getBreeze } = require("../breeze/auth");
const rateLimiter = require("../breeze/rateLimiter");
const { chunkDateRange, isoIst, parseRows, callWithTransientRetry } = require("../breeze/historicalService");

const VIX_STOCKCODE = process.env.BREEZE_VIX_STOCKCODE || "INDIAVIX";
const VIX_EXCHANGE = process.env.BREEZE_VIX_EXCHANGE || "NSE";
const VIX_PRODUCT = process.env.BREEZE_VIX_PRODUCT || "cash";

/**
 * 1-minute India VIX candles over [fromDateStr, toDateStr] (inclusive),
 * chunked internally to respect Breeze's 1,000-candle cap and paced via
 * rateLimiter.throttle() for the 100/min + 5,000/day caps.
 *
 * Returns rows: { date, time, open, high, low, close, volume, oi }
 * (oi is always 0 for an index — kept for parseRows shape compatibility).
 */
async function getVixMinuteCandles({ fromDateStr, toDateStr }) {
    const breeze = await getBreeze();
    const chunks = chunkDateRange(fromDateStr, toDateStr);
    const all = [];

    for (const [chunkFrom, chunkTo] of chunks) {
        await rateLimiter.throttle();
        const resp = await callWithTransientRetry(
            () =>
                breeze.getHistoricalDatav2({
                    interval: "1minute",
                    fromDate: isoIst(chunkFrom, "09:15:00"),
                    toDate: isoIst(chunkTo, "15:30:00"),
                    stockCode: VIX_STOCKCODE,
                    exchangeCode: VIX_EXCHANGE,
                    productType: VIX_PRODUCT,
                }),
            `INDIAVIX ${chunkFrom}..${chunkTo}`
        );

        if (resp?.Error) throw new Error(`Breeze getHistoricalDatav2 error (INDIAVIX): ${resp.Error}`);
        const rows = Array.isArray(resp?.Success) ? resp.Success : [];
        all.push(...parseRows(rows));
    }

    return all
        .filter((r) => r.date && r.time)
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

module.exports = { getVixMinuteCandles, VIX_STOCKCODE, VIX_EXCHANGE, VIX_PRODUCT };
