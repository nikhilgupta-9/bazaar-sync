// Multi-symbol version of backfillBhavcopy.js — downloads/parses each day's
// bhavcopy file ONCE (not once per symbol, since NSE ships every symbol in
// one file) and stores EVERY NSE F&O underlying found that day: all index
// options + every stock that had options trading (i.e. the actual current
// F&O-eligible stock universe, discovered from the data itself — no
// hardcoded "210 companies" list needed, and it stays correct automatically
// as NSE's F&O stock list changes over time).
//
// *** IMPORTANT GAP: this only covers NSE-listed underlyings. SENSEX and
// BANKEX trade on BSE and will never appear in an NSE bhavcopy file — if you
// need those two of the commonly-cited "7 indices", that needs a separate
// BSE bhavcopy source, not built here. ***
//
// Usage: node scripts/backfillBhavcopyAll.js [YEARS_BACK] [END_DATE]
//   YEARS_BACK - default 5
//   END_DATE   - 'YYYY-MM-DD', default yesterday (IST)
//
// Strongly recommended: run with a small YEARS_BACK first (e.g. pass a
// recent END_DATE window via testBhavcopy.js, or just try `0.02` for ~1
// week) to see real per-day symbol counts and runtime before committing to
// a full 5-year x 200+ symbol run, which will take hours.
//
// Resumable: ON DUPLICATE KEY UPDATE per row, same as every other backfill
// script here. Each day's zip is cached on disk once and reused.

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const instrumentMaster = require("../services/instrumentMaster");
const bhavcopy = require("../services/nseBhavcopy");
const bs = require("../utils/blackScholes");

const EOD_TIME = "15:30:00";
// 2026-07-20: 800ms was too aggressive — after a few hundred requests in a
// few minutes, NSE started silently stalling every connection (not an
// error, just a hang until our own 25s timeout fired). Slower default gap +
// a real cool-down after a run of consecutive failures, below.
const DAY_GAP_MS = Number(process.env.BHAVCOPY_DAY_GAP_MS || 3000);
const COOLDOWN_AFTER_CONSECUTIVE_FAILS = Number(process.env.BHAVCOPY_COOLDOWN_THRESHOLD || 3);
// Observed live (2026-07-20): a flat 60s cooldown was nowhere near enough
// during a sustained throttle window (~14 minutes, dozens of timeouts, only
// one date actually got through). NSE's block seems to last minutes, not
// seconds. Escalate: 60s, 2min, 4min, 8min, capped at 10min — reset back to
// 60s the moment any date succeeds (a real recovery signal, not a guess).
const COOLDOWN_BASE_MS = Number(process.env.BHAVCOPY_COOLDOWN_MS || 60_000);
const COOLDOWN_MAX_MS = Number(process.env.BHAVCOPY_COOLDOWN_MAX_MS || 10 * 60_000);

function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

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
    const yearsBack = Number(process.argv[2] || 5);
    const endDate = process.argv[3] || addDays(instrumentMaster.todayIst(), -1);
    const startDate = addDays(endDate, -Math.round(yearsBack * 365));

    console.log(`[bhavcopy-all] backfilling ALL NSE F&O symbols, ${startDate} .. ${endDate}`);
    console.log(`[bhavcopy-all] NOTE: SENSEX/BANKEX (BSE) will NOT appear — NSE-only source`);

    // Skip days that already have data — avoids re-hitting NSE (and re-risking
    // the throttle) for dates a previous run already stored successfully.
    const [existingRows] = await pool.query(
        `SELECT DISTINCT trade_date FROM option_chain_history WHERE trade_date BETWEEN ? AND ?`,
        [startDate, endDate]
    );
    const alreadyCovered = new Set(existingRows.map((r) => r.trade_date));
    console.log(`[bhavcopy-all] ${alreadyCovered.size} days already covered in this range — will be skipped`);

    let d = startDate;
    let daysDone = 0, daysFailed = 0, rowsStored = 0;
    let consecutiveFails = 0;
    let cooldownStreak = 0; // how many cooldowns in a row with NO success in between
    const symbolsSeen = new Set();

    while (d <= endDate) {
        const dow = dayOfWeek(d);
        if (dow !== 0 && dow !== 6 && !alreadyCovered.has(d)) {
            try {
                const bySymbol = await bhavcopy.getDayRowsBySymbol(d);
                let dayRows = 0;
                for (const [symbol, rows] of bySymbol) {
                    symbolsSeen.add(symbol);
                    dayRows += await storeSymbolDay(symbol, d, rows);
                }
                rowsStored += dayRows;
                daysDone += 1;
                consecutiveFails = 0;
                cooldownStreak = 0; // a real success — throttle has cleared, back to the short cooldown next time
                console.log(`[bhavcopy-all] ${d}: ${bySymbol.size} symbols, ${dayRows} rows (running total symbols seen: ${symbolsSeen.size})`);
            } catch (err) {
                daysFailed += 1;
                console.error(`[bhavcopy-all] ${d} failed: ${err.message}`);

                // A 404, or a 503 that came back fast, means NSE actively
                // answered "no" — that's a real holiday or (for pre-2024-07-08
                // dates) the old archive genuinely not serving that file
                // anymore, confirmed across several independent fresh runs
                // today. Retrying THAT never helps, so don't count it toward
                // the throttle cooldown or waste time on it.
                const isTimeout = /timed out/.test(err.message);
                if (!isTimeout) {
                    consecutiveFails = 0;
                } else {
                    consecutiveFails += 1;
                    if (consecutiveFails >= COOLDOWN_AFTER_CONSECUTIVE_FAILS) {
                        const cooldownMs = Math.min(COOLDOWN_BASE_MS * 2 ** cooldownStreak, COOLDOWN_MAX_MS);
                        console.warn(
                            `[bhavcopy-all] ${consecutiveFails} timeouts in a row — likely NSE throttling this connection. Cooling down ${Math.round(cooldownMs / 1000)}s before continuing (escalation level ${cooldownStreak}; this date will be retried, nothing skipped).`
                        );
                        await new Promise((r) => setTimeout(r, cooldownMs));
                        consecutiveFails = 0;
                        cooldownStreak += 1; // escalate further if this cooldown ALSO doesn't lead to a success
                        continue; // retry the SAME date instead of advancing past it
                    }
                }
            }
            await new Promise((r) => setTimeout(r, DAY_GAP_MS));
        }
        d = addDays(d, 1);
    }

    const indices = [...symbolsSeen].filter((s) => bhavcopy.NSE_INDEX_SYMBOLS.has(s));
    const stocks = [...symbolsSeen].filter((s) => !bhavcopy.NSE_INDEX_SYMBOLS.has(s));
    console.log(`[bhavcopy-all] done. days ok=${daysDone} failed=${daysFailed}, total rows=${rowsStored}`);
    console.log(`[bhavcopy-all] symbols seen: ${indices.length} indices [${indices.join(", ")}], ${stocks.length} stocks`);
    await pool.end();
}

main().catch((err) => {
    console.error("[bhavcopy-all] fatal:", err.message);
    process.exit(1);
});
