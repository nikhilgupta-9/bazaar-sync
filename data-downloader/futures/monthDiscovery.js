// futures/monthDiscovery.js — phase 1 of futures/run.js.
//
// The futures counterpart to optionchain/monthDiscovery.js. Breeze can't
// list which futures contracts existed on a past date any more than it can
// for options, so this walks every trading day of one month, pulls NSE + BSE
// bhavcopy FUTURES rows (IDF/STF), and upserts one EOD row per
// (symbol, expiry) into futures_history. futures/enrich.js then upgrades
// those to 1-minute via Breeze.
//
// No strikes, no CE/PE, no Greeks — a future is just one OHLC+OI series per
// (underlying, expiry).

const { pool } = require("../lib/db");
const { addDays, dayOfWeek, monthBounds } = require("../lib/dates");
const nseBhavcopy = require("../lib/nseBhavcopy");
const bseBhavcopy = require("../lib/bseBhavcopy");

const EOD_TIME = "15:30:00";
const DAY_GAP_MS = Number(process.env.BHAVCOPY_DAY_GAP_MS || 2500);
const COOLDOWN_AFTER_CONSECUTIVE_FAILS = Number(process.env.BHAVCOPY_COOLDOWN_THRESHOLD || 3);
const COOLDOWN_BASE_MS = Number(process.env.BHAVCOPY_COOLDOWN_MS || 60_000);
const COOLDOWN_MAX_MS = Number(process.env.BHAVCOPY_COOLDOWN_MAX_MS || 10 * 60_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function storeSymbolDay(symbol, dateStr, rows) {
    if (!rows.length) return 0;
    // One (symbol, expiry) can appear once per day in bhavcopy; if a source
    // ever duplicates, last wins (Map).
    const byExpiry = new Map();
    for (const r of rows) {
        if (!r.expiry) continue;
        byExpiry.set(r.expiry, r);
    }
    const values = [];
    for (const [expiry, r] of byExpiry) {
        values.push([
            symbol, expiry, dateStr, EOD_TIME,
            r.open ?? null, r.high ?? null, r.low ?? null, r.close ?? null,
            r.volume ?? 0, r.oi ?? 0, r.oiChange ?? null, r.underlyingPrice ?? null,
        ]);
    }
    if (!values.length) return 0;

    await pool.query(
        `INSERT INTO futures_history
           (symbol, expiry, trade_date, trade_time, open, high, low, close, volume, oi, oi_change, underlying_price)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close),
           volume=VALUES(volume), oi=VALUES(oi), oi_change=VALUES(oi_change), underlying_price=VALUES(underlying_price)`,
        [values]
    );
    return values.length;
}

async function getDayFuturesBothExchanges(dateStr) {
    const nse = await nseBhavcopy.getDayFuturesBySymbol(dateStr); // throws on real failure
    let bse = new Map();
    try {
        bse = await bseBhavcopy.getDayFuturesBySymbol(dateStr);
    } catch (err) {
        console.warn(`[fut-discovery] ${dateStr}: BSE bhavcopy failed (${err.message}) — NSE only for this day`);
    }
    for (const [symbol, rows] of bse) {
        if (nse.has(symbol)) nse.get(symbol).push(...rows);
        else nse.set(symbol, rows);
    }
    return nse;
}

async function discoverMonth(year, month, { onlySymbols = null } = {}) {
    const { first, last } = monthBounds(year, month);

    const [existing] = await pool.query(
        `SELECT DISTINCT trade_date FROM futures_history WHERE trade_date BETWEEN ? AND ?`,
        [first, last]
    );
    const alreadyCovered = new Set(existing.map((r) => r.trade_date));

    let d = first;
    let daysOk = 0, daysFailed = 0, daysSkipped = 0, rowsStored = 0;
    let consecutiveTimeouts = 0, cooldownStreak = 0;
    const symbolsSeen = new Set();
    const failedDates = [];

    while (d <= last) {
        const dow = dayOfWeek(d);
        if (dow === 0 || dow === 6) { d = addDays(d, 1); continue; }
        if (alreadyCovered.has(d)) { daysSkipped += 1; d = addDays(d, 1); continue; }

        try {
            const bySymbol = await getDayFuturesBothExchanges(d);
            let dayRows = 0;
            for (const [symbol, rows] of bySymbol) {
                if (onlySymbols && !onlySymbols.has(symbol)) continue;
                symbolsSeen.add(symbol);
                dayRows += await storeSymbolDay(symbol, d, rows);
            }
            rowsStored += dayRows;
            daysOk += 1;
            consecutiveTimeouts = 0;
            cooldownStreak = 0;
            console.log(`[fut-discovery] ${d}: ${bySymbol.size} symbols, ${dayRows} futures-rows`);
        } catch (err) {
            const isTimeout = /timed out/i.test(err.message);
            if (isTimeout) {
                consecutiveTimeouts += 1;
                if (consecutiveTimeouts >= COOLDOWN_AFTER_CONSECUTIVE_FAILS) {
                    const cd = Math.min(COOLDOWN_BASE_MS * 2 ** cooldownStreak, COOLDOWN_MAX_MS);
                    console.warn(`[fut-discovery] ${consecutiveTimeouts} timeouts — cooling down ${Math.round(cd / 1000)}s, retrying ${d}`);
                    await sleep(cd);
                    consecutiveTimeouts = 0;
                    cooldownStreak += 1;
                    continue;
                }
            } else {
                consecutiveTimeouts = 0;
            }
            daysFailed += 1;
            failedDates.push(d);
            console.error(`[fut-discovery] ${d} failed: ${err.message}`);
        }

        await sleep(DAY_GAP_MS);
        d = addDays(d, 1);
    }

    return { daysOk, daysFailed, daysSkipped, rowsStored, symbolsSeen, failedDates };
}

module.exports = { discoverMonth, storeSymbolDay };
