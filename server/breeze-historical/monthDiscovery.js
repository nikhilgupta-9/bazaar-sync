// breeze-historical/monthDiscovery.js — phase 1 of pipelineYear.js.
//
// Breeze's getHistoricalDatav2 can only fetch a contract you already name
// (stockCode + expiry + strike + right) — it CANNOT list which strikes /
// expiries existed on a past date. So before Breeze can fill in 1-minute
// detail, something has to discover the contract universe for the month.
//
// That's this file: it walks every trading day of one calendar month, pulls
// NSE's + BSE's free daily F&O bhavcopy (services/nseBhavcopy.js,
// services/bseBhavcopy.js), and upserts one EOD row (trade_time 15:30:00)
// per (symbol, expiry, strike) that actually traded, into the same
// option_chain_history table monthEnrich.js then upgrades to minute-level.
//
// EOD-only here is deliberate — the point of this pass is coverage
// (every contract, every symbol, every expiry), not resolution. It's free,
// has no daily call budget, and reaches years back — the exact opposite of
// Breeze's tradeoffs.
//
// Greeks/upsert logic mirrors scripts/backfillBhavcopyAll.js's storeSymbolDay
// (kept as a local copy rather than a shared import so this folder stays
// self-contained per breeze-historical/README.md — "if deleted, nothing
// else breaks").

const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const nseBhavcopy = require("../services/nseBhavcopy");
const bseBhavcopy = require("../services/bseBhavcopy");
const bs = require("../utils/blackScholes");

const EOD_TIME = "15:30:00";
const DAY_GAP_MS = Number(process.env.BHAVCOPY_DAY_GAP_MS || 2500);
const COOLDOWN_AFTER_CONSECUTIVE_FAILS = Number(process.env.BHAVCOPY_COOLDOWN_THRESHOLD || 3);
const COOLDOWN_BASE_MS = Number(process.env.BHAVCOPY_COOLDOWN_MS || 60_000);
const COOLDOWN_MAX_MS = Number(process.env.BHAVCOPY_COOLDOWN_MAX_MS || 10 * 60_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** First and last calendar day of a month as 'YYYY-MM-DD' (no Date parsing of non-ISO strings — Gotcha #12). */
function monthBounds(year, month) {
    const mm = String(month).padStart(2, "0");
    const first = `${year}-${mm}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based; day 0 of next month
    const last = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
    return { first, last };
}

/** Years from (dateStr, 15:30 IST) to (expirySql, 15:30 IST). Pure Date.UTC math. */
function yearsToExpiryAsOf(expirySql, dateStr) {
    const [ey, em, ed] = expirySql.split("-").map(Number);
    const [dy, dm, dd] = dateStr.split("-").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const expiryUtcMs = Date.UTC(ey, em - 1, ed, 15, 30, 0) - IST_OFFSET_MS;
    const rowUtcMs = Date.UTC(dy, dm - 1, dd, 15, 30, 0) - IST_OFFSET_MS;
    return Math.max((expiryUtcMs - rowUtcMs) / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4));
}

async function storeSymbolDay(symbol, dateStr, rows) {
    if (!rows.length) return 0;

    const byKey = new Map();
    for (const r of rows) {
        const key = `${r.expiry}|${r.strike}`;
        const entry = byKey.get(key) || { expiry: r.expiry, strike: r.strike };
        entry[r.right] = r;
        if (r.underlyingPrice != null) entry.underlyingPrice = r.underlyingPrice;
        byKey.set(key, entry);
    }

    const values = [];
    for (const { expiry, strike, CE, PE, underlyingPrice } of byKey.values()) {
        if (!expiry || !Number.isFinite(strike)) continue;
        const t = yearsToExpiryAsOf(expiry, dateStr);
        let ceIv = null, ceG = { delta: null, gamma: null, theta: null, vega: null };
        let peIv = null, peG = { delta: null, gamma: null, theta: null, vega: null };
        if (underlyingPrice != null) {
            if (CE?.close > 0) {
                const iv = bs.impliedVolatility({ marketPrice: CE.close, spot: underlyingPrice, strike, t, right: "call" });
                if (iv != null) { ceIv = iv * 100; ceG = bs.greeks({ spot: underlyingPrice, strike, t, vol: iv, right: "call" }); }
            }
            if (PE?.close > 0) {
                const iv = bs.impliedVolatility({ marketPrice: PE.close, spot: underlyingPrice, strike, t, right: "put" });
                if (iv != null) { peIv = iv * 100; peG = bs.greeks({ spot: underlyingPrice, strike, t, vol: iv, right: "put" }); }
            }
        }
        values.push([
            symbol, dateStr, EOD_TIME, expiry, strike, underlyingPrice ?? null,
            CE?.close ?? null, CE?.oi ?? null, CE?.volume ?? null, ceIv, ceG.delta, ceG.gamma, ceG.theta, ceG.vega,
            PE?.close ?? null, PE?.oi ?? null, PE?.volume ?? null, peIv, peG.delta, peG.gamma, peG.theta, peG.vega,
        ]);
    }
    if (!values.length) return 0;

    await pool.query(
        `INSERT INTO option_chain_history (
           symbol, trade_date, trade_time, expiry, strike, underlying_price,
           ce_ltp, ce_oi, ce_volume, ce_iv, ce_delta, ce_gamma, ce_theta, ce_vega,
           pe_ltp, pe_oi, pe_volume, pe_iv, pe_delta, pe_gamma, pe_theta, pe_vega
         ) VALUES ?
         ON DUPLICATE KEY UPDATE
           underlying_price=VALUES(underlying_price),
           ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_volume=VALUES(ce_volume), ce_iv=VALUES(ce_iv),
           ce_delta=VALUES(ce_delta), ce_gamma=VALUES(ce_gamma), ce_theta=VALUES(ce_theta), ce_vega=VALUES(ce_vega),
           pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_volume=VALUES(pe_volume), pe_iv=VALUES(pe_iv),
           pe_delta=VALUES(pe_delta), pe_gamma=VALUES(pe_gamma), pe_theta=VALUES(pe_theta), pe_vega=VALUES(pe_vega)`,
        [values]
    );
    return values.length;
}

/** Merge NSE + BSE rows for one day into Map<symbol, rows[]>. BSE failure is non-fatal (only SENSEX/BANKEX + BSE stocks lost). */
async function getDayRowsBothExchanges(dateStr) {
    const nse = await nseBhavcopy.getDayRowsBySymbol(dateStr); // throws on real failure — caller handles/retries
    let bse = new Map();
    try {
        bse = await bseBhavcopy.getDayRowsBySymbol(dateStr);
    } catch (err) {
        console.warn(`[discovery] ${dateStr}: BSE bhavcopy failed (${err.message}) — continuing with NSE only for this day`);
    }
    for (const [symbol, rows] of bse) {
        if (nse.has(symbol)) nse.get(symbol).push(...rows);
        else nse.set(symbol, rows);
    }
    return nse;
}

/**
 * Ingest one calendar month of NSE + BSE bhavcopy into option_chain_history.
 * Resumable: days already present in the table (any symbol) are skipped, and
 * ON DUPLICATE KEY UPDATE makes a re-run idempotent regardless.
 *
 * Returns { daysOk, daysFailed, daysSkipped, rowsStored, symbolsSeen:Set, failedDates:[] }.
 */
async function discoverMonth(year, month, { onlySymbols = null } = {}) {
    const { first, last } = monthBounds(year, month);

    const [existing] = await pool.query(
        `SELECT DISTINCT trade_date FROM option_chain_history WHERE trade_date BETWEEN ? AND ?`,
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
            const bySymbol = await getDayRowsBothExchanges(d);
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
            console.log(`[discovery] ${d}: ${bySymbol.size} symbols, ${dayRows} contract-rows stored`);
        } catch (err) {
            const isTimeout = /timed out/i.test(err.message);
            if (isTimeout) {
                consecutiveTimeouts += 1;
                if (consecutiveTimeouts >= COOLDOWN_AFTER_CONSECUTIVE_FAILS) {
                    const cd = Math.min(COOLDOWN_BASE_MS * 2 ** cooldownStreak, COOLDOWN_MAX_MS);
                    console.warn(`[discovery] ${consecutiveTimeouts} timeouts in a row — cooling down ${Math.round(cd / 1000)}s, then retrying ${d}`);
                    await sleep(cd);
                    consecutiveTimeouts = 0;
                    cooldownStreak += 1;
                    continue; // retry same date
                }
            } else {
                // 404 / fast 503 = real holiday or an archive that genuinely
                // isn't served — not worth retrying, just record and move on.
                consecutiveTimeouts = 0;
            }
            daysFailed += 1;
            failedDates.push(d);
            console.error(`[discovery] ${d} failed: ${err.message}`);
        }

        await sleep(DAY_GAP_MS);
        d = addDays(d, 1);
    }

    return { daysOk, daysFailed, daysSkipped, rowsStored, symbolsSeen, failedDates };
}

module.exports = { discoverMonth, monthBounds, storeSymbolDay };
