// Multi-year, DAILY-granularity backfill of option_chain_history from NSE's
// own free Bhavcopy archive (services/nseBhavcopy.js).
//
// *** Run testBhavcopy.js for ONE day first — see chat — before pointing
// this at years of history. The URL/column-name mapping in nseBhavcopy.js
// is unverified from where it was written (NSE's domain wasn't reachable);
// the first real run is the actual test. ***
//
// This is intentionally separate from backfillUpstox.js (minute-level, last
// ~6mo) — together they give recent intraday detail + older daily-only
// coverage. One row per contract per day here (trade_time fixed at market
// close, 15:30:00), not minute-by-minute — backtestEngine.js's minute
// simulation will need a daily-aware mode to use this range meaningfully;
// storing it is step one.
//
// Usage: node scripts/backfillBhavcopy.js [SYMBOL] [YEARS_BACK] [END_DATE]
//   SYMBOL     - NIFTY | BANKNIFTY | FINNIFTY (default NIFTY)
//   YEARS_BACK - how many years back from END_DATE to backfill (default 2)
//   END_DATE   - 'YYYY-MM-DD', default yesterday (IST)
//
// Resumable: ON DUPLICATE KEY UPDATE per row, same model as the rest of the
// project. Each day's zip is cached on disk (server/data/bhavcopy/,
// gitignored) so re-running doesn't re-download what's already there.

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const instrumentMaster = require("../services/instrumentMaster");
const bhavcopy = require("../services/nseBhavcopy");
const bs = require("../utils/blackScholes");

const EOD_TIME = "15:30:00";
const DAY_GAP_MS = Number(process.env.BHAVCOPY_DAY_GAP_MS || 800); // be polite to NSE's server

function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Years from (dateStr, 15:30 IST) to expirySql (15:30 IST). Pure Date.UTC math, Gotcha #12 compliant. */
function yearsToExpiryAsOf(expirySql, dateStr) {
    const [ey, em, ed] = expirySql.split("-").map(Number);
    const [dy, dm, dd] = dateStr.split("-").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const expiryUtcMs = Date.UTC(ey, em - 1, ed, 15, 30, 0) - IST_OFFSET_MS;
    const rowUtcMs = Date.UTC(dy, dm - 1, dd, 15, 30, 0) - IST_OFFSET_MS;
    return Math.max((expiryUtcMs - rowUtcMs) / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4));
}

async function storeDay(symbol, dateStr, rows) {
    if (!rows.length) return 0;

    // Merge CE/PE per (expiry, strike) for this one EOD snapshot.
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

async function main() {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const yearsBack = Number(process.argv[3] || 2);
    const endDate = process.argv[4] || addDays(instrumentMaster.todayIst(), -1);
    const startDate = addDays(endDate, -Math.round(yearsBack * 365));

    console.log(`[bhavcopy] ${symbol}: backfilling ${startDate} .. ${endDate} (daily/EOD granularity)`);

    let d = startDate;
    let daysDone = 0, daysFailed = 0, rowsStored = 0;
    while (d <= endDate) {
        const dow = dayOfWeek(d);
        if (dow !== 0 && dow !== 6) {
            try {
                const rows = await bhavcopy.getDayOptionRows(d, symbol);
                const stored = await storeDay(symbol, d, rows);
                rowsStored += stored;
                daysDone += 1;
                if (stored) console.log(`[bhavcopy] ${d}: ${stored} rows`);
            } catch (err) {
                daysFailed += 1;
                console.error(`[bhavcopy] ${d} failed: ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, DAY_GAP_MS));
        }
        d = addDays(d, 1);
    }

    console.log(`[bhavcopy] done. days ok=${daysDone} failed=${daysFailed}, total rows stored=${rowsStored}`);
    await pool.end();
}

main().catch((err) => {
    console.error("[bhavcopy] fatal:", err.message);
    process.exit(1);
});
