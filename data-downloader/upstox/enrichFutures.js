// upstox/enrichFutures.js — Upstox Expired Instruments FUTURES backfill.
//
// The futures counterpart to upstox/enrich.js (which does options). No
// strikes/CE-PE/Greeks here — one series per (symbol, expiry), OHLC+OI only,
// straight into futures_history (same table futures/enrich.js's Breeze path
// already writes to — ON DUPLICATE KEY UPDATE, never a conflict).
//
// Same two things that make Upstox attractive over Breeze for this: a
// long-lived (~1yr) UPSTOX_ACCESS_TOKEN (no daily re-login) and its own
// contract self-discovery (no bhavcopy discovery phase needed first) — but
// also the SAME real limit: Upstox's expired-instruments API only reaches
// back ~6-11 months (confirmed live 2026-09-11 via upstox/enrich.js's own
// header comment). For 2025 H1 or earlier, use futures/run.js (Breeze)
// instead — see data-downloader/COMMANDS.md.
//
// *** UNVERIFIED before a real run: the field name on a Get Expired Future
// Contracts response that carries the tradeable key for getExpiredCandles.
// See historicalService.js's resolveExpiredFutureKey header comment — run
// `npm run test:upstox-futures -- <SYMBOL>` FIRST; it prints the raw
// contract JSON so a shape mismatch is obvious before wasting a real month's
// worth of calls on it. ***
//
// Usage: node upstox/enrichFutures.js [SYMBOL] [FROM_DATE] [TO_DATE]
//   SYMBOL            - a symbol, or ALL (every symbol already in
//                        futures_history from a prior Breeze discovery run —
//                        falls back to just the 7 indices if that's empty,
//                        since indices need no discovery step at all)
//   FROM_DATE/TO_DATE  - 'YYYY-MM-DD', both optional — restricts which
//                        expiries get processed (same reasoning as
//                        upstox/enrich.js: without this, old expiries well
//                        outside Upstox's real window just waste calls)

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { addDays } = require("../lib/dates");
const upstox = require("./historicalService");
const upstoxInstruments = require("./instrumentMaster");
const { storeRows, withOiChange } = require("../lib/futuresStorage");

const LOOKBACK_DAYS = Number(process.env.UPSTOX_FUTURES_BACKFILL_LOOKBACK_DAYS || 95);

async function storeUnderlyingDaily(symbol, candles) {
    if (!candles.length) return new Map();
    const values = candles.map((c) => [symbol, c.date, c.time, c.open, c.high, c.low, c.close, c.volume]);
    await pool.query(
        `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
         VALUES ?
         ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low),
           close=VALUES(close), volume=VALUES(volume)`,
        [values]
    );
    return new Map(candles.map((c) => [c.date, c.close]));
}

// Real bug found 2026-09-12: the original check here was "does ANY row for
// this (symbol, expiry) have a non-EOD trade_time" — if a run got
// interrupted (rate limit, network blip, etc.) after storing just ONE day's
// worth of candles, that single day made the WHOLE contract look "already
// enriched" forever, so the other ~60 real trading days were never fetched
// on any later re-run. Same bug class already fixed in upstox/enrich.js's
// (options) loadFullyEnrichedStrikes — compare against the REAL trading-day
// count instead of "does any row exist at all".
//
// Second attempt (also wrong, caught before shipping): baseline the
// expected-day count from the EARLIEST day we already have minute data for,
// instead of the fixed window start. Broke on a second synthetic test: if
// the leftover partial data happens to be a narrow slice that does NOT
// start from the contract's true earliest day (e.g. just the expiry day
// itself), the check trivially compares that slice against itself and
// always "passes" — self-referential, not a real completeness check.
//
// Fixed: compare against the FULL fixed [windowStart, expirySql] window
// (contract-independent, so it can't be gamed by wherever the existing data
// happens to sit), but as a COVERAGE RATIO rather than a near-exact count —
// a real futures contract is usually only actually LISTED for PART of that
// window (e.g. ~57 real trading days out of a 95-calendar-day lookback,
// confirmed live 2026-09-12 on FINNIFTY), while the underlying INDEX has
// traded every single day of it, so ohlcv_data's full-window count is
// always bigger than any real contract's true depth — an exact-match
// requirement would re-fetch every genuinely-complete contract forever.
// MIN_COVERAGE_RATIO=0.6 comfortably passes a real ~57/65-day contract
// (~88%) while still failing a broken 1-day fetch (~1.5%) or a fetch that
// stopped partway through (e.g. 47/65 ≈ 72% — no, catches down to 60%; a
// worse partial like 20/65 ≈ 31% definitely fails and correctly retries).
async function isFullyEnriched(symbol, expirySql, windowStart) {
    const [dayRows] = await pool.query(
        `SELECT COUNT(DISTINCT trade_date) AS cnt FROM ohlcv_data WHERE symbol = ? AND trade_date BETWEEN ? AND ?`,
        [symbol, windowStart, expirySql]
    );
    const expectedDays = Number(dayRows[0]?.cnt || 0);
    if (!expectedDays) return false; // no real trading-day baseline yet — don't trust the skip

    const [rows] = await pool.query(
        `SELECT COUNT(DISTINCT trade_date) AS cnt FROM futures_history
         WHERE symbol = ? AND expiry = ? AND trade_time <> '15:30:00' AND trade_date BETWEEN ? AND ?`,
        [symbol, expirySql, windowStart, expirySql]
    );
    const actualDays = Number(rows[0]?.cnt || 0);

    const MIN_COVERAGE_RATIO = 0.6;
    return actualDays >= expectedDays * MIN_COVERAGE_RATIO;
}

async function backfillExpiry(symbol, underlyingKey, expirySql) {
    const windowStart = addDays(expirySql, -LOOKBACK_DAYS);

    // Always fetch+store the daily underlying candles first (cheap, one
    // call) — this both gives storeRows its spot-price map AND gives
    // isFullyEnriched a reliable real-trading-day baseline to check against,
    // even for a contract we're about to skip.
    const dailyCandles = await upstox.getCandles(underlyingKey, { interval: "day", fromDate: windowStart, toDate: expirySql });
    const spotByDate = await storeUnderlyingDaily(symbol, dailyCandles);

    if (await isFullyEnriched(symbol, expirySql, windowStart)) {
        console.log(`[upstox-fut] ${symbol} ${expirySql}: already fully enriched (every real trading day has minute data), skipped`);
        return 0;
    }

    // Confirmed live 2026-09-12 (NIFTY): futures only exist on the MONTHLY
    // expiry, not every weekly options expiry getExpiries() also returns —
    // most calls here legitimately come back empty. Not an error, so this
    // logs quietly rather than warning.
    const contracts = await upstox.getExpiredFutureContracts(underlyingKey, expirySql);
    if (!contracts.length) {
        console.log(`[upstox-fut] ${symbol} ${expirySql}: no futures series for this expiry (likely a weekly options-only expiry), skipped`);
        return 0;
    }
    const instrumentKey = upstox.resolveExpiredFutureKey(contracts[0]);
    if (!instrumentKey) {
        console.warn(
            `[upstox-fut] ${symbol} ${expirySql}: contract has neither expired_instrument_key nor instrument_key — ` +
            `response shape unexpected, run test/testUpstoxFutures.js. Raw: ${JSON.stringify(contracts[0])}`
        );
        return 0;
    }

    const candles = await upstox.getExpiredCandles(instrumentKey, { interval: "1minute", fromDate: windowStart, toDate: expirySql });
    if (!candles.length) {
        console.warn(`[upstox-fut] ${symbol} ${expirySql}: 0 candles for ${instrumentKey}`);
        return 0;
    }
    const rows = await storeRows(symbol, expirySql, withOiChange(candles), spotByDate);
    console.log(`[upstox-fut] ${symbol} ${expirySql}: ${rows} rows stored (${instrumentKey})`);
    return rows;
}

/** Resolve a symbol to its Upstox underlying instrument_key — indices first (hardcoded, confirmed), stocks via the downloaded instrument master. */
async function resolveUnderlyingKey(symbol) {
    if (upstox.UNDERLYING_KEYS[symbol]) return upstox.UNDERLYING_KEYS[symbol];
    return upstoxInstruments.resolveInstrumentKey(symbol);
}

async function backfillOneSymbol(symbol, fromDate, toDate) {
    const underlyingKey = await resolveUnderlyingKey(symbol);
    if (!underlyingKey) {
        console.warn(`[upstox-fut] ${symbol}: no Upstox instrument_key found (not an index, not in the equity instrument master) — skipped`);
        return;
    }

    let expiries = await upstox.getExpiries(underlyingKey);
    if (fromDate || toDate) {
        expiries = expiries.filter((e) => (!fromDate || e >= fromDate) && (!toDate || e <= toDate));
    }
    if (!expiries.length) {
        console.log(`[upstox-fut] ${symbol} (${underlyingKey}): 0 expiries in range — skipped`);
        return;
    }
    console.log(`[upstox-fut] ${symbol} (${underlyingKey}): ${expiries.length} expiries in range`);

    for (const expirySql of expiries) {
        try {
            await backfillExpiry(symbol, underlyingKey, expirySql);
        } catch (err) {
            console.error(`[upstox-fut] ${symbol} ${expirySql}: ${err instanceof Error ? err.message : err}`);
        }
    }
}

async function main() {
    const symbolArg = (process.argv[2] || "NIFTY").toUpperCase();
    const fromDate = process.argv[3] || null;
    const toDate = process.argv[4] || null;

    if (symbolArg !== "ALL") {
        console.log(`[upstox-fut] starting ${symbolArg}${fromDate || toDate ? ` (expiry range ${fromDate || "-inf"}..${toDate || "+inf"})` : ""}`);
        await backfillOneSymbol(symbolArg, fromDate, toDate);
        console.log("[upstox-fut] complete");
        await pool.end();
        return;
    }

    // ALL mode: every symbol futures/monthDiscovery.js (Breeze bhavcopy path)
    // has already discovered — but that's an EOD-only discovery step, and
    // the 7 indices need no discovery at all (their instrument_key is
    // hardcoded), so fall back to those if futures_history is still empty.
    const [rows] = await pool.query(`SELECT DISTINCT symbol FROM futures_history ORDER BY symbol`);
    let symbols = rows.map((r) => r.symbol);
    if (!symbols.length) {
        symbols = Object.keys(upstox.UNDERLYING_KEYS);
        console.log(`[upstox-fut-all] futures_history is empty (no discovery run yet) — falling back to the 7 indices: ${symbols.join(", ")}`);
    } else {
        console.log(`[upstox-fut-all] ${symbols.length} symbols found in futures_history`);
    }

    let done = 0, skipped = 0;
    for (const symbol of symbols) {
        try {
            await backfillOneSymbol(symbol, fromDate, toDate);
            done += 1;
        } catch (err) {
            skipped += 1;
            console.error(`[upstox-fut-all] ${symbol}: unexpected error, skipping symbol: ${err.message}`);
        }
    }
    console.log(`[upstox-fut-all] complete. symbols processed=${done}, symbols with errors=${skipped}`);
    await pool.end();
}

module.exports = { backfillOneSymbol, backfillExpiry, resolveUnderlyingKey };

if (require.main === module) {
    main().catch((err) => {
        console.error("[upstox-fut] fatal:", err.message);
        process.exit(1);
    });
}
