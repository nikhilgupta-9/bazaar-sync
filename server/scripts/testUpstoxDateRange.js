// scripts/testUpstoxDateRange.js — diagnostic for a real, suspected bug:
// nearly every backfillUpstox.js run this project has done shows almost
// exactly 375 rows PER STRIKE (375 = one NSE trading session's 1-minute
// bars), no matter how wide the requested [fromDate, toDate] window is
// (LOOKBACK_DAYS=35 by default). That ratio is too consistent across too
// many different symbols/expiries to be organic thin liquidity — this
// script fetches ONE real contract's candles directly via
// upstox.getExpiredCandles with an intentionally wide range and prints the
// actual distinct dates that came back, to confirm (or rule out) that
// Upstox's expired-instruments historical-candle endpoint is silently
// truncating wide date-range requests to a single day.
//
// Run: cd server && node scripts/testUpstoxDateRange.js SYMBOL [STRIKES_PER_SIDE]
//   Picks the nearest available expiry and its ATM-ish strike automatically.

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const upstox = require("../services/upstoxHistorical");
const upstoxInstruments = require("../services/upstoxInstrumentMaster");

const LOOKBACK_DAYS = Number(process.env.UPSTOX_BACKFILL_LOOKBACK_DAYS || 35);

async function resolveUnderlyingKey(symbol) {
    if (upstox.UNDERLYING_KEYS[symbol]) return upstox.UNDERLYING_KEYS[symbol];
    return upstoxInstruments.resolveInstrumentKey(symbol);
}

(async () => {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const underlyingKey = await resolveUnderlyingKey(symbol);
    if (!underlyingKey) {
        console.error(`No Upstox instrument_key found for ${symbol}`);
        process.exit(1);
    }

    const expiries = await upstox.getExpiries(underlyingKey);
    if (!expiries.length) {
        console.error(`No expiries available for ${symbol} (${underlyingKey})`);
        process.exit(1);
    }
    const expirySql = expiries[Math.floor(expiries.length / 2)]; // a middle-of-the-list expiry, not the newest/oldest edge case
    const windowStart = addDays(expirySql, -LOOKBACK_DAYS);

    console.log(`[test] ${symbol} (${underlyingKey}), expiry ${expirySql}, requesting range ${windowStart}..${expirySql} (${LOOKBACK_DAYS} days)`);

    const contracts = await upstox.getExpiredOptionContracts(underlyingKey, expirySql);
    if (!contracts.length) {
        console.error(`No contracts returned for expiry ${expirySql}`);
        process.exit(1);
    }
    // Pick a strike roughly in the middle of the available range — most
    // likely to have real liquidity, avoiding a deep-OTM edge case as the
    // very first test.
    const strikes = [...new Set(contracts.map((c) => c.strike_price))].sort((a, b) => a - b);
    const midStrike = strikes[Math.floor(strikes.length / 2)];
    const ceContract = contracts.find((c) => c.strike_price === midStrike && c.instrument_type === "CE");
    if (!ceContract) {
        console.error(`No CE contract found at strike ${midStrike}`);
        process.exit(1);
    }
    console.log(`[test] strike ${midStrike} CE, instrument_key ${ceContract.instrument_key}`);

    const candles = await upstox.getExpiredCandles(ceContract.instrument_key, {
        interval: "1minute", fromDate: windowStart, toDate: expirySql,
    });

    const distinctDates = [...new Set(candles.map((c) => c.date))].sort();
    console.log(`[test] got ${candles.length} candles across ${distinctDates.length} distinct date(s)`);
    console.log(`[test] distinct dates: ${distinctDates.join(", ")}`);
    console.log(`[test] requested window: ${windowStart} .. ${expirySql} (${LOOKBACK_DAYS} days)`);

    if (distinctDates.length <= 2 && LOOKBACK_DAYS > 5) {
        console.log(
            `[test] CONFIRMED: requested a ${LOOKBACK_DAYS}-day window but got back only ${distinctDates.length} distinct trading day(s) — ` +
            `this strongly suggests Upstox's expired-instruments historical-candle endpoint is truncating wide date-range requests, not a real liquidity gap.`
        );
    } else {
        console.log(`[test] Got ${distinctDates.length} distinct days for a ${LOOKBACK_DAYS}-day window — looks like real multi-day coverage, not truncated.`);
    }

    await pool.end();
})().catch((err) => {
    console.error("[test] fatal:", err.message);
    process.exit(1);
});
