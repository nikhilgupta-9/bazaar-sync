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
// Usage: node scripts/backfillUpstox.js [SYMBOL] [STRIKES_PER_SIDE]
//   SYMBOL           - NIFTY | BANKNIFTY | FINNIFTY (default NIFTY)
//   STRIKES_PER_SIDE - how many strikes either side of ATM to pull (default 10)
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
async function storeOptionChainRows(symbol, expirySql, strike, ceRows, peRows) {
    const byTime = new Map();
    for (const r of ceRows) {
        byTime.set(r.time, { date: r.date, time: r.time, ce: r });
    }
    for (const r of peRows) {
        const row = byTime.get(r.time) || { date: r.date, time: r.time };
        row.pe = r;
        byTime.set(r.time, row);
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
    const atmIdx = strikes.reduce(
        (best, s, i) => (Math.abs(s - centerPrice) < Math.abs(strikes[best] - centerPrice) ? i : best),
        0
    );
    const keepStrikes = new Set(strikes.slice(Math.max(0, atmIdx - strikesPerSide), atmIdx + strikesPerSide + 1));

    const byStrike = new Map();
    for (const c of contracts) {
        if (!keepStrikes.has(c.strike_price)) continue;
        const entry = byStrike.get(c.strike_price) || {};
        entry[c.instrument_type] = c; // CE or PE
        byStrike.set(c.strike_price, entry);
    }

    let totalRows = 0, skippedStrikes = 0;
    for (const [strike, pair] of byStrike) {
        if (await isAlreadyEnriched(symbol, expirySql, strike, windowStart, expirySql)) {
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

// Same "already has minute-level data" check as breeze-historical/backfillBreeze.js
// (a bhavcopy-only row always sits at trade_time='15:30:00' exactly) — lets
// SYMBOL=ALL resume runs skip strikes a previous run already filled in,
// instead of re-requesting Upstox for the same contract every time.
async function isAlreadyEnriched(symbol, expiry, strike, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT 1 FROM option_chain_history
         WHERE symbol = ? AND expiry = ? AND strike = ? AND trade_date BETWEEN ? AND ? AND trade_time <> '15:30:00'
         LIMIT 1`,
        [symbol, expiry, strike, fromDate, toDate]
    );
    return rows.length > 0;
}

/** Resolve a symbol to its Upstox underlying instrument_key — indices first (hardcoded, confirmed), stocks via the downloaded instrument master. */
async function resolveUnderlyingKey(symbol) {
    if (upstox.UNDERLYING_KEYS[symbol]) return upstox.UNDERLYING_KEYS[symbol];
    return upstoxInstruments.resolveInstrumentKey(symbol);
}

async function backfillOneSymbol(symbol, strikesPerSide) {
    const underlyingKey = await resolveUnderlyingKey(symbol);
    if (!underlyingKey) {
        console.warn(`[upstox] ${symbol}: no Upstox instrument_key found (not an index, not in the equity instrument master) — skipped`);
        return;
    }

    const expiries = await upstox.getExpiries(underlyingKey);
    if (!expiries.length) {
        console.log(`[upstox] ${symbol} (${underlyingKey}): 0 expiries available in Upstox's ~6-month window — skipped`);
        return;
    }
    console.log(`[upstox] ${symbol} (${underlyingKey}): ${expiries.length} expiries available, ±${strikesPerSide} strikes each`);

    for (const expirySql of expiries) {
        await backfillExpiry(symbol, underlyingKey, expirySql, strikesPerSide);
    }
}

async function main() {
    const symbolArg = (process.argv[2] || "NIFTY").toUpperCase();
    const strikesPerSide = Number(process.argv[3] || 10);

    if (symbolArg !== "ALL") {
        console.log(`[upstox] starting ${symbolArg}, ±${strikesPerSide} strikes per expiry`);
        await backfillOneSymbol(symbolArg, strikesPerSide);
        console.log("[upstox] complete");
        await pool.end();
        return;
    }

    // ALL mode: every symbol already discovered by backfillBhavcopyAll.js
    // within Upstox's usable (last ~6mo) window — indices resolve via the
    // hardcoded UNDERLYING_KEYS, stocks via the downloaded instrument master.
    const sixMonthsAgo = addDays(new Date().toISOString().slice(0, 10), -190);
    const [rows] = await pool.query(
        `SELECT DISTINCT symbol FROM option_chain_history WHERE trade_date >= ? ORDER BY symbol`,
        [sixMonthsAgo]
    );
    const symbols = rows.map((r) => r.symbol);
    console.log(`[upstox-all] ${symbols.length} symbols found (trade_date >= ${sixMonthsAgo}), ±${strikesPerSide} strikes each`);
    if (!symbols.length) {
        console.log("[upstox-all] nothing to do — run scripts/backfillBhavcopyAll.js for a recent range first.");
        await pool.end();
        return;
    }

    let done = 0, skipped = 0;
    for (const symbol of symbols) {
        try {
            await backfillOneSymbol(symbol, strikesPerSide);
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
