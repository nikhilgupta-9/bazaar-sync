// scripts/backfillBseBhavcopyAll.js — BSE counterpart to
// backfillBhavcopyAll.js. Only real reason this exists: SENSEX and BANKEX
// trade on BSE, not NSE, so NSE's bhavcopy (nseBhavcopy.js) can never see
// them — this closes that specific, known gap (see CLAUDE.md Phase 7 /
// services/bseBhavcopy.js header). Any other BSE-listed F&O stock found in
// the same file gets stored too, same upsert-into-option_chain_history
// pattern as every other source here — no duplication risk (UNIQUE KEY
// (symbol, expiry, strike, trade_date, trade_time) + ON DUPLICATE KEY UPDATE,
// same schema-level guarantee documented in CLAUDE.md).
//
// Run scripts/testBseBhavcopy.js FIRST — this script's URL/column
// assumptions are unverified until that passes on a real date.
//
// Usage: node scripts/backfillBseBhavcopyAll.js [YEARS_BACK] [END_DATE]

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const instrumentMaster = require("../services/instrumentMaster");
const bseBhavcopy = require("../services/bseBhavcopy");
const bs = require("../utils/blackScholes");

const EOD_TIME = "15:30:00";
const DAY_GAP_MS = Number(process.env.BSE_BHAVCOPY_DAY_GAP_MS || 2000);
const COOLDOWN_AFTER_CONSECUTIVE_FAILS = Number(process.env.BSE_BHAVCOPY_COOLDOWN_THRESHOLD || 3);
const COOLDOWN_BASE_MS = Number(process.env.BSE_BHAVCOPY_COOLDOWN_MS || 60_000);
const COOLDOWN_MAX_MS = Number(process.env.BSE_BHAVCOPY_COOLDOWN_MAX_MS || 10 * 60_000);

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
    const yearsBack = Number(process.argv[2] || 2);
    const endDate = process.argv[3] || addDays(instrumentMaster.todayIst(), -1);
    const startDate = addDays(endDate, -Math.round(yearsBack * 365));

    console.log(`[bse-bhavcopy-all] backfilling BSE F&O symbols (SENSEX/BANKEX + any others found), ${startDate} .. ${endDate}`);

    const [existingRows] = await pool.query(
        `SELECT DISTINCT trade_date FROM option_chain_history
         WHERE trade_date BETWEEN ? AND ? AND symbol IN ('SENSEX', 'BANKEX')`,
        [startDate, endDate]
    );
    const alreadyCovered = new Set(existingRows.map((r) => r.trade_date));
    console.log(`[bse-bhavcopy-all] ${alreadyCovered.size} days already covered (SENSEX/BANKEX) in this range — will be skipped`);

    let d = startDate;
    let daysDone = 0, daysFailed = 0, rowsStored = 0;
    let consecutiveFails = 0;
    let cooldownStreak = 0;
    const symbolsSeen = new Set();

    while (d <= endDate) {
        const dow = dayOfWeek(d);
        if (dow !== 0 && dow !== 6 && !alreadyCovered.has(d)) {
            try {
                const bySymbol = await bseBhavcopy.getDayRowsBySymbol(d);
                let dayRows = 0;
                for (const [symbol, rows] of bySymbol) {
                    symbolsSeen.add(symbol);
                    dayRows += await storeSymbolDay(symbol, d, rows);
                }
                rowsStored += dayRows;
                daysDone += 1;
                consecutiveFails = 0;
                cooldownStreak = 0;
                console.log(`[bse-bhavcopy-all] ${d}: ${bySymbol.size} symbols, ${dayRows} rows (running total symbols seen: ${symbolsSeen.size})`);
            } catch (err) {
                daysFailed += 1;
                console.error(`[bse-bhavcopy-all] ${d} failed: ${err.message}`);
                const isTimeout = /timed out/.test(err.message);
                if (!isTimeout) {
                    consecutiveFails = 0;
                } else {
                    consecutiveFails += 1;
                    if (consecutiveFails >= COOLDOWN_AFTER_CONSECUTIVE_FAILS) {
                        const cooldownMs = Math.min(COOLDOWN_BASE_MS * 2 ** cooldownStreak, COOLDOWN_MAX_MS);
                        console.warn(`[bse-bhavcopy-all] ${consecutiveFails} timeouts in a row — cooling down ${Math.round(cooldownMs / 1000)}s (escalation level ${cooldownStreak}; retrying this date, nothing skipped).`);
                        await new Promise((r) => setTimeout(r, cooldownMs));
                        consecutiveFails = 0;
                        cooldownStreak += 1;
                        continue;
                    }
                }
            }
            await new Promise((r) => setTimeout(r, DAY_GAP_MS));
        }
        d = addDays(d, 1);
    }

    const targetSeen = [...symbolsSeen].filter((s) => bseBhavcopy.BSE_INDEX_SYMBOLS.has(s));
    console.log(`[bse-bhavcopy-all] done. days ok=${daysDone} failed=${daysFailed}, total rows=${rowsStored}`);
    console.log(`[bse-bhavcopy-all] target indices seen: ${targetSeen.join(", ") || "NONE — check FIELD_CANDIDATES/column names in services/bseBhavcopy.js"}`);
    console.log(`[bse-bhavcopy-all] all symbols seen (${symbolsSeen.size}): ${[...symbolsSeen].join(", ")}`);
    await pool.end();
}

main().catch((err) => {
    console.error("[bse-bhavcopy-all] fatal:", err.message);
    process.exit(1);
});
