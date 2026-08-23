// Resumable historical backfill for option_chain_history + ohlcv_data, via
// Upstox's Expired Instruments API (Upstox Plus required).
//
// This is a SEPARATE, occasional tool — not part of the nightly cron, which
// stays on Angel One (services/cron.js, TOTP-automated). Upstox's own docs
// cap expired-options history at "up to six months of historical expiries"
// (Get Expiries page, confirmed live 2026-07-19), so this only ever fills
// the last ~6 months at minute-level granularity. For real multi-year depth
// at daily granularity, see scripts/backfillBhavcopy.js instead.
//
// Usage: node scripts/backfillUpstox.js [SYMBOL] [STRIKES_PER_SIDE] [FROM_DATE] [TO_DATE]
//   SYMBOL           - a symbol, or ALL (every symbol already in
//                       option_chain_history — see backfillBhavcopyAll.js)
//   STRIKES_PER_SIDE - how many strikes either side of ATM to pull (default 10)
//   FROM_DATE/TO_DATE - 'YYYY-MM-DD', both optional. Restricts which expiries
//                       get processed to this range — WITHOUT this, Upstox's
//                       own expiry list for a symbol can include expiries
//                       over a year old (well past Upstox's actual candle
//                       availability), wasting API calls on expiries that
//                       will just fail/fall back. Pass these to backfill only
//                       a specific window (e.g. just this July+August), not
//                       everything Upstox has ever heard of for that symbol.
//                       Example: node scripts/backfillUpstox.js ALL 10 2026-07-01 2026-08-19
//
// Per expiry: fetch ~35 days of underlying daily candles ending at expiry
// (for strike-centering + a per-day spot to compute Greeks from), fetch that
// expiry's CE/PE contracts, keep only strikes within STRIKES_PER_SIDE of the
// ATM at expiry, then pull each kept contract's full 1-minute history in ONE
// call (Upstox accepts a real date range, unlike Angel One's per-day calls).
//
// Resumable: every insert is ON DUPLICATE KEY UPDATE, same model as
// services/cron.js — re-running after an interruption just re-upserts safely.
// Per-contract failures are logged and skipped, not fatal to the whole run.

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const upstox = require("../services/upstoxHistorical");
const upstoxInstruments = require("../services/upstoxInstrumentMaster");
const instrumentMaster = require("../services/instrumentMaster");
const bs = require("../utils/blackScholes");

const LOOKBACK_DAYS = Number(process.env.UPSTOX_BACKFILL_LOOKBACK_DAYS || 35);

/**
 * Years between (dateStr, timeStr) and expirySql, both treated as IST wall-
 * clock, expiry cutoff 15:30 IST. Pure Date.UTC arithmetic — no parsing of
 * ambiguous strings (CLAUDE.md Gotcha #12).
 */
function yearsToExpiryAsOf(expirySql, dateStr, timeStr) {
    const [ey, em, ed] = expirySql.split("-").map(Number);
    const [dy, dm, dd] = dateStr.split("-").map(Number);
    const [hh, mm, ss] = (timeStr || "15:30:00").split(":").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const expiryUtcMs = Date.UTC(ey, em - 1, ed, 15, 30, 0) - IST_OFFSET_MS;
    const rowUtcMs = Date.UTC(dy, dm - 1, dd, hh, mm, ss) - IST_OFFSET_MS;
    const ms = expiryUtcMs - rowUtcMs;
    return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4)); // floor at 15 min, same as blackScholes.js
}

async function storeUnderlyingDaily(symbol, candles) {
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

// Merge same-minute CE/PE rows (with computed IV/Greeks) into option_chain_history.
//
// Real bug fixed 2026-08-21: this used to key `byTime` on `r.time` alone
// (e.g. "09:15") — since every trading day repeats the same times, rows from
// DIFFERENT DAYS at the SAME time-of-day silently overwrote each other in
// the Map, leaving only the LAST date processed (candles arrive sorted
// date+time ascending, see mapCandles). A 24-trading-day contract collapsed
// to ~1 day's worth of rows (~375, one session's 1-minute bars) — exactly
// what a real backfillUpstox.js run showed (7093 rows / 19 strikes ≈ 373),
// while a direct getExpiredCandles call for the same symbol+expiry proved
// Upstox itself really did return all 24 days (scripts/testUpstoxDateRange.js).
// The key must include the date, not just the time-of-day.
async function storeOptionChainRows(symbol, expirySql, strike, ceRows, peRows) {
    const byTime = new Map();
    for (const r of ceRows) {
        byTime.set(`${r.date}|${r.time}`, { date: r.date, time: r.time, ce: r });
    }
    for (const r of peRows) {
        const key = `${r.date}|${r.time}`;
        const row = byTime.get(key) || { date: r.date, time: r.time };
        row.pe = r;
        byTime.set(key, row);
    }
    const rows = [...byTime.values()];
    if (!rows.length) return 0;

    const values = rows.map((r) => [
        symbol, r.date, r.time, expirySql, strike,
        r.ce?.spot ?? r.pe?.spot ?? null,
        r.ce?.close ?? null, r.ce?.oi ?? null, r.ce?.oiChange ?? null, r.ce?.iv ?? null, r.ce?.volume ?? null,
        r.ce?.delta ?? null, r.ce?.gamma ?? null, r.ce?.theta ?? null, r.ce?.vega ?? null,
        r.pe?.close ?? null, r.pe?.oi ?? null, r.pe?.oiChange ?? null, r.pe?.iv ?? null, r.pe?.volume ?? null,
        r.pe?.delta ?? null, r.pe?.gamma ?? null, r.pe?.theta ?? null, r.pe?.vega ?? null,
    ]);
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
        [values]
    );
    return rows.length;
}

/** Attach spot + IV + Greeks to each raw candle row for one contract. */
function enrichWithGreeks(candles, { strike, right, expirySql, spotByDate }) {
    let prevOi = null;
    return candles.map((c) => {
        const spot = spotByDate.get(c.date) ?? null;
        const t = yearsToExpiryAsOf(expirySql, c.date, c.time);
        let iv = null, greeks = { delta: null, gamma: null, theta: null, vega: null };
        if (spot != null && c.close > 0) {
            iv = bs.impliedVolatility({ marketPrice: c.close, spot, strike, t, right });
            if (iv != null) greeks = bs.greeks({ spot, strike, t, vol: iv, right });
        }
        const oiChange = prevOi != null ? c.oi - prevOi : null;
        prevOi = c.oi;
        return {
            date: c.date, time: c.time, close: c.close, volume: c.volume, oi: c.oi, oiChange,
            spot, iv: iv != null ? iv * 100 : null, // stored as percent, matches schema (ce_iv DECIMAL(6,2))
            delta: greeks.delta, gamma: greeks.gamma, theta: greeks.theta, vega: greeks.vega,
        };
    });
}

// "Real" traded strikes for this (symbol, expiry) — any strike that shows
// non-zero open interest in ANY Bhavcopy-sourced EOD snapshot already stored
// for this expiry (across its whole lifetime, not just one day). OI is a
// solid liquidity proxy: a strike nobody ever opened a position in has
// nothing worth minute-level detail. Falls back to null when Bhavcopy hasn't
// discovered this expiry yet at all, so callers know to use the old ±N
// window instead rather than silently keeping zero strikes.
async function getLiquidStrikes(symbol, expirySql, minOi = 1) {
    const [rows] = await pool.query(
        `SELECT strike, MAX(GREATEST(COALESCE(ce_oi, 0), COALESCE(pe_oi, 0))) AS maxOi
         FROM option_chain_history
         WHERE symbol = ? AND expiry = ?
         GROUP BY strike
         HAVING maxOi >= ?
         ORDER BY strike`,
        [symbol, expirySql, minOi]
    );
    return rows.length ? rows.map((r) => Number(r.strike)) : null;
}

async function backfillExpiry(symbol, underlyingKey, expirySql, strikesPerSide) {
    const windowStart = addDays(expirySql, -LOOKBACK_DAYS);

    const dailyCandles = await upstox.getCandles(underlyingKey, { interval: "day", fromDate: windowStart, toDate: expirySql });
    await storeUnderlyingDaily(symbol, dailyCandles);
    if (!dailyCandles.length) {
        console.warn(`[upstox] ${symbol} ${expirySql}: no underlying daily candles in window, skipping (can't center strikes or compute Greeks)`);
        return;
    }
    const spotByDate = new Map(dailyCandles.map((c) => [c.date, c.close]));
    const centerPrice = dailyCandles[dailyCandles.length - 1].close;

    const contracts = await upstox.getExpiredOptionContracts(underlyingKey, expirySql);
    if (!contracts.length) {
        console.warn(`[upstox] ${symbol} ${expirySql}: no expired option contracts returned`);
        return;
    }

    const strikes = [...new Set(contracts.map((c) => c.strike_price))].sort((a, b) => a - b);

    // Prefer the real traded set (every strike Bhavcopy ever saw with open
    // interest for this expiry) over an artificial ±N window — this is what
    // "give me the full chain, skip the strikes nobody traded" actually
    // means. Only falls back to the fixed window if Bhavcopy hasn't
    // discovered this expiry at all yet (so we have no liquidity signal).
    const liquidStrikes = await getLiquidStrikes(symbol, expirySql);
    let keepStrikes;
    if (liquidStrikes) {
        keepStrikes = new Set(strikes.filter((s) => liquidStrikes.includes(s)));
    } else {
        const atmIdx = strikes.reduce(
            (best, s, i) => (Math.abs(s - centerPrice) < Math.abs(strikes[best] - centerPrice) ? i : best),
            0
        );
        keepStrikes = new Set(strikes.slice(Math.max(0, atmIdx - strikesPerSide), atmIdx + strikesPerSide + 1));
        console.warn(`[upstox] ${symbol} ${expirySql}: no Bhavcopy OI data found for this expiry yet — falling back to ±${strikesPerSide} strikes around expiry-day close. Run backfillBhavcopy(All).js for this range first for full liquid-strike coverage.`);
    }

    const byStrike = new Map();
    for (const c of contracts) {
        if (!keepStrikes.has(c.strike_price)) continue;
        const entry = byStrike.get(c.strike_price) || {};
        entry[c.instrument_type] = c; // CE or PE
        byStrike.set(c.strike_price, entry);
    }

    const fullyEnrichedStrikes = await loadFullyEnrichedStrikes(symbol, expirySql, windowStart, expirySql);

    let totalRows = 0, skippedStrikes = 0;
    for (const [strike, pair] of byStrike) {
        if (fullyEnrichedStrikes.has(strike)) {
            skippedStrikes += 1;
            continue;
        }
        try {
            const ceRaw = pair.CE
                ? await upstox.getExpiredCandles(pair.CE.instrument_key, { interval: "1minute", fromDate: windowStart, toDate: expirySql })
                : [];
            const peRaw = pair.PE
                ? await upstox.getExpiredCandles(pair.PE.instrument_key, { interval: "1minute", fromDate: windowStart, toDate: expirySql })
                : [];
            const ce = enrichWithGreeks(ceRaw, { strike, right: "call", expirySql, spotByDate });
            const pe = enrichWithGreeks(peRaw, { strike, right: "put", expirySql, spotByDate });
            totalRows += await storeOptionChainRows(symbol, expirySql, strike, ce, pe);
        } catch (err) {
            console.error(`[upstox] ${symbol} ${expirySql} strike ${strike}: ${err.message}`);
        }
    }
    console.log(
        `[upstox] ${symbol} ${expirySql}: ${totalRows} rows stored across ${byStrike.size - skippedStrikes} strikes (${skippedStrikes} already enriched, skipped)`
    );
}

// A contract counts as fully enriched only if EVERY trade_date already known
// for it (bhavcopy EOD row, a previous partial run, whatever) also has at
// least one minute-level row. Checking "does ANY minute row exist at all"
// (the original check here) let a contract that only PARTIALLY succeeded —
// e.g. one day's fetch hit a transient network error mid-run — get marked
// done forever, so that specific missing day would never get retried by
// just re-running this script. Confirmed necessary 2026-08-05: a real run
// left scattered day-level gaps inside otherwise-enriched NIFTY contracts
// for exactly this reason. Re-fetching a contract's whole range again when
// only one day was missing is a bit wasteful, but cheap here — Upstox has
// no daily call budget the way Breeze does, and ON DUPLICATE KEY UPDATE
// makes re-writing already-good days harmless.
// Bulk version of the same day-completeness check, one query per EXPIRY
// instead of one query per strike — confirmed as a real slowdown 2026-08-10:
// backfillOneSymbol calls this per strike inside backfillExpiry's loop, and
// with liquid-strike expansion routinely pulling 70-150+ strikes per expiry
// across dozens of expiries per symbol, that's thousands of sequential DB
// round-trips just to figure out what to skip (same class of problem fixed
// in breeze-historical/backfillBreeze.js the same day). The inner query
// computes per (strike, trade_date) whether that day has a minute-level
// row; the outer MIN(...) collapses that to "does EVERY day for this strike
// have one" — same logic the old per-strike loop version had, just batched.
async function loadFullyEnrichedStrikes(symbol, expiry, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT strike, MIN(has_minute) AS fully_enriched FROM (
             SELECT strike, trade_date, MAX(trade_time <> '15:30:00') AS has_minute
             FROM option_chain_history
             WHERE symbol = ? AND expiry = ? AND trade_date BETWEEN ? AND ?
             GROUP BY strike, trade_date
         ) per_day
         GROUP BY strike`,
        [symbol, expiry, fromDate, toDate]
    );
    return new Set(rows.filter((r) => Number(r.fully_enriched) === 1).map((r) => Number(r.strike)));
}

/** Resolve a symbol to its Upstox underlying instrument_key — indices first (hardcoded, confirmed), stocks via the downloaded instrument master. */
async function resolveUnderlyingKey(symbol) {
    if (upstox.UNDERLYING_KEYS[symbol]) return upstox.UNDERLYING_KEYS[symbol];
    return upstoxInstruments.resolveInstrumentKey(symbol);
}

// fromDate/toDate ('YYYY-MM-DD', both optional) restrict WHICH expiries get
// processed. Without this, `upstox.getExpiries()` returns every expiry
// Upstox still has ANY record of for that underlying — for a stock this can
// be a dozen+ expiries stretching back well over a year, most of which are
// past Upstox's actual ~6-month candle-availability window and just waste
// rate-limited API calls failing/falling back (see the "no Bhavcopy OI data
// found" warning in backfillExpiry) instead of ever being skipped. A caller
// who only wants e.g. July-August needs this filter, not "everything Upstox
// has ever heard of for this symbol" — found 2026-08-21 running `ALL` for a
// 2-month window and seeing 360ONE process a 2025-07-31 expiry.
async function backfillOneSymbol(symbol, strikesPerSide, fromDate, toDate) {
    const underlyingKey = await resolveUnderlyingKey(symbol);
    if (!underlyingKey) {
        console.warn(`[upstox] ${symbol}: no Upstox instrument_key found (not an index, not in the equity instrument master) — skipped`);
        return;
    }

    let expiries = await upstox.getExpiries(underlyingKey);
    if (fromDate || toDate) {
        expiries = expiries.filter((e) => (!fromDate || e >= fromDate) && (!toDate || e <= toDate));
    }
    if (!expiries.length) {
        console.log(`[upstox] ${symbol} (${underlyingKey}): 0 expiries in range — skipped`);
        return;
    }
    console.log(`[upstox] ${symbol} (${underlyingKey}): ${expiries.length} expiries in range, ±${strikesPerSide} strikes each`);

    for (const expirySql of expiries) {
        await backfillExpiry(symbol, underlyingKey, expirySql, strikesPerSide);
    }
}

async function main() {
    const symbolArg = (process.argv[2] || "NIFTY").toUpperCase();
    const strikesPerSide = Number(process.argv[3] || 10);
    // Optional — restrict to expiries in [FROM_DATE, TO_DATE] (see
    // backfillOneSymbol's comment above). Omit both for the old
    // "everything Upstox has" behavior.
    const fromDate = process.argv[4] || null;
    const toDate = process.argv[5] || null;

    if (symbolArg !== "ALL") {
        console.log(`[upstox] starting ${symbolArg}, ±${strikesPerSide} strikes per expiry${fromDate || toDate ? ` (expiry range ${fromDate || "-inf"}..${toDate || "+inf"})` : ""}`);
        await backfillOneSymbol(symbolArg, strikesPerSide, fromDate, toDate);
        console.log("[upstox] complete");
        await pool.end();
        return;
    }

    // ALL mode: every symbol already discovered by backfillBhavcopyAll.js
    // within Upstox's usable (last ~6mo) window — indices resolve via the
    // hardcoded UNDERLYING_KEYS, stocks via the downloaded instrument master.
    // Was `new Date().toISOString().slice(0, 10)` — a real CLAUDE.md Gotcha
    // #12 violation (never do date math via ambient local-timezone Date
    // parsing) caught 2026-08-07 before this ALL-mode path was ever run for
    // real. todayIst() is the same IST-string helper every other date
    // computation in this codebase uses.
    //
    // When FROM_DATE is given, symbol discovery scopes to trade_date >=
    // FROM_DATE instead of the fixed 190-day window — a caller who only
    // Bhavcopy'd a narrow recent range (e.g. 2 months) shouldn't have this
    // step silently widen back out to 6 months of symbols.
    const discoverFrom = fromDate || addDays(instrumentMaster.todayIst(), -190);
    const [rows] = await pool.query(
        `SELECT DISTINCT symbol FROM option_chain_history WHERE trade_date >= ? ORDER BY symbol`,
        [discoverFrom]
    );
    const symbols = rows.map((r) => r.symbol);
    console.log(`[upstox-all] ${symbols.length} symbols found (trade_date >= ${discoverFrom}), ±${strikesPerSide} strikes each${fromDate || toDate ? `, expiry range ${fromDate || "-inf"}..${toDate || "+inf"}` : ""}`);
    if (!symbols.length) {
        console.log("[upstox-all] nothing to do — run scripts/backfillBhavcopyAll.js for a recent range first.");
        await pool.end();
        return;
    }

    let done = 0, skipped = 0;
    for (const symbol of symbols) {
        try {
            await backfillOneSymbol(symbol, strikesPerSide, fromDate, toDate);
            done += 1;
        } catch (err) {
            skipped += 1;
            console.error(`[upstox-all] ${symbol}: unexpected error, skipping symbol: ${err.message}`);
        }
    }
    console.log(`[upstox-all] complete. symbols processed=${done}, symbols with errors=${skipped}`);
    await pool.end();
}

main().catch((err) => {
    console.error("[upstox] fatal:", err.message);
    process.exit(1);
});
