// breeze-historical/backfillBreeze.js — fills in 1-minute detail + Greeks for
// the ~6mo-3yr-back window, upgrading the EOD-only rows scripts/backfillBhavcopy.js
// already stored in option_chain_history.
//
// Deliberately does NOT discover its own strikes/expiries via Breeze — reads
// the (expiry, strike) combinations that already exist in option_chain_history
// (put there by backfillBhavcopy.js) within the requested date range, and
// asks Breeze for 1-minute candles on exactly those known contracts. Run the
// Bhavcopy backfill for the target range FIRST.
//
// Usage: node breeze-historical/backfillBreeze.js [SYMBOL] [FROM_DATE] [TO_DATE]
//   SYMBOL    - NIFTY | BANKNIFTY | FINNIFTY (default NIFTY)
//   FROM_DATE - 'YYYY-MM-DD', default ~3 years before TO_DATE
//   TO_DATE   - 'YYYY-MM-DD', default ~6 months ago (Upstox already covers
//               the more recent 6 months at minute-level — no need to spend
//               Breeze's daily call budget re-covering that window)
//
// Resumable: ON DUPLICATE KEY UPDATE per row (same model as every other
// backfill script here). Stops cleanly and tells you to resume tomorrow if
// the daily call budget runs out mid-run (see rateLimiter.js).

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const instrumentMaster = require("../services/instrumentMaster");
const historicalService = require("./historicalService");
const rateLimiter = require("./rateLimiter");
const bs = require("../utils/blackScholes");

function yearsToExpiryAsOf(expirySql, dateStr, timeStr) {
    const [ey, em, ed] = expirySql.split("-").map(Number);
    const [dy, dm, dd] = dateStr.split("-").map(Number);
    const [hh, mm, ss] = (timeStr || "15:30:00").split(":").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const expiryUtcMs = Date.UTC(ey, em - 1, ed, 15, 30, 0) - IST_OFFSET_MS;
    const rowUtcMs = Date.UTC(dy, dm - 1, dd, hh, mm, ss) - IST_OFFSET_MS;
    return Math.max((expiryUtcMs - rowUtcMs) / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4));
}

async function findContracts(symbol, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT DISTINCT expiry, strike FROM option_chain_history
         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
         ORDER BY expiry, strike`,
        [symbol, fromDate, toDate]
    );
    return rows.map((r) => ({ expiry: r.expiry, strike: Number(r.strike) }));
}

async function contractDateRange(symbol, expiry, strike, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT MIN(trade_date) AS minDate, MAX(trade_date) AS maxDate FROM option_chain_history
         WHERE symbol = ? AND expiry = ? AND strike = ? AND trade_date BETWEEN ? AND ?`,
        [symbol, expiry, strike, fromDate, toDate]
    );
    return rows[0]?.minDate && rows[0]?.maxDate ? { from: rows[0].minDate, to: rows[0].maxDate } : null;
}

async function spotForDate(symbol, dateStr) {
    const [rows] = await pool.query(
        `SELECT underlying_price FROM option_chain_history
         WHERE symbol = ? AND trade_date = ? AND underlying_price IS NOT NULL LIMIT 1`,
        [symbol, dateStr]
    );
    return rows.length ? Number(rows[0].underlying_price) : null;
}

function enrichWithGreeks(candles, { strike, right, expirySql, spot }) {
    let prevOi = null;
    return candles.map((c) => {
        const t = yearsToExpiryAsOf(expirySql, c.date, c.time);
        let iv = null, g = { delta: null, gamma: null, theta: null, vega: null };
        if (spot != null && c.close > 0) {
            iv = bs.impliedVolatility({ marketPrice: c.close, spot, strike, t, right });
            if (iv != null) g = bs.greeks({ spot, strike, t, vol: iv, right });
        }
        const oiChange = prevOi != null ? c.oi - prevOi : null;
        prevOi = c.oi;
        return { ...c, spot, iv: iv != null ? iv * 100 : null, oiChange, ...g };
    });
}

async function storeRows(symbol, expirySql, strike, ceRows, peRows) {
    const byTime = new Map();
    for (const r of ceRows) byTime.set(r.date + " " + r.time, { date: r.date, time: r.time, ce: r });
    for (const r of peRows) {
        const key = r.date + " " + r.time;
        const row = byTime.get(key) || { date: r.date, time: r.time };
        row.pe = r;
        byTime.set(key, row);
    }
    const rows = [...byTime.values()];
    if (!rows.length) return 0;

    const values = rows.map((r) => [
        symbol, r.date, r.time, expirySql, strike, r.ce?.spot ?? r.pe?.spot ?? null,
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

// Has Breeze/Upstox already filled minute-level detail for this contract? A
// bhavcopy-only row always lands at exactly trade_time='15:30:00' (see
// backfillBhavcopyAll.js's EOD_TIME) — any row at a different time means some
// minute-granularity source already enriched this contract. Used to skip
// contracts across repeated/resumed backfillBreezeAll.js runs instead of
// re-spending Breeze's daily budget on work already done.
async function isAlreadyEnriched(symbol, expiry, strike, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT 1 FROM option_chain_history
         WHERE symbol = ? AND expiry = ? AND strike = ? AND trade_date BETWEEN ? AND ? AND trade_time <> '15:30:00'
         LIMIT 1`,
        [symbol, expiry, strike, fromDate, toDate]
    );
    return rows.length > 0;
}

/**
 * Runs the full backfill for one symbol over [fromDate, toDate]. Shared by
 * this script's own CLI (below) and backfillBreezeAll.js's multi-symbol loop.
 * Throws (propagates) the rateLimiter "daily call budget spent" error so a
 * multi-symbol caller can stop the whole run cleanly rather than just this
 * symbol.
 */
async function backfillSymbol(symbol, fromDate, toDate) {
    const contracts = await findContracts(symbol, fromDate, toDate);
    if (!contracts.length) {
        return { rowsStored: 0, contractsFailed: 0, contractsSkipped: 0, contractsTotal: 0 };
    }

    let rowsStored = 0, contractsFailed = 0, contractsSkipped = 0;
    for (const { expiry, strike } of contracts) {
        const range = await contractDateRange(symbol, expiry, strike, fromDate, toDate);
        if (!range) continue;
        if (await isAlreadyEnriched(symbol, expiry, strike, range.from, range.to)) {
            contractsSkipped += 1;
            continue;
        }
        try {
            const spot = await spotForDate(symbol, range.to);
            const ceRaw = await historicalService.getOptionMinuteCandles({
                stockCode: symbol, expirySql: expiry, strike, right: "CE", fromDateStr: range.from, toDateStr: range.to,
            });
            const peRaw = await historicalService.getOptionMinuteCandles({
                stockCode: symbol, expirySql: expiry, strike, right: "PE", fromDateStr: range.from, toDateStr: range.to,
            });
            const ce = enrichWithGreeks(ceRaw, { strike, right: "call", expirySql: expiry, spot });
            const pe = enrichWithGreeks(peRaw, { strike, right: "put", expirySql: expiry, spot });
            rowsStored += await storeRows(symbol, expiry, strike, ce, pe);
        } catch (err) {
            contractsFailed += 1;
            console.error(`[breeze] ${symbol} ${expiry} strike ${strike}: ${err.message}`);
            if (/daily call budget spent/.test(err.message)) throw err; // stop this whole symbol AND propagate to caller
        }
    }
    return { rowsStored, contractsFailed, contractsSkipped, contractsTotal: contracts.length };
}

async function main() {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const today = instrumentMaster.todayIst();
    const toDate = process.argv[3] || addDays(today, -180);
    const fromDate = process.argv[4] || addDays(toDate, -365 * 3);

    console.log(`[breeze] ${symbol}: ${fromDate} .. ${toDate} (daily budget remaining today: ${rateLimiter.remainingToday()})`);

    try {
        const result = await backfillSymbol(symbol, fromDate, toDate);
        if (!result.contractsTotal) {
            console.log("[breeze] nothing to do — run scripts/backfillBhavcopy.js for this symbol/range first, it's what populates the contract list this script reads.");
        } else {
            console.log(
                `[breeze] done. contracts=${result.contractsTotal} (skipped already-enriched=${result.contractsSkipped}), rows stored=${result.rowsStored}, contracts failed=${result.contractsFailed}, budget remaining today=${rateLimiter.remainingToday()}`
            );
        }
    } catch (err) {
        if (/daily call budget spent/.test(err.message)) {
            console.log(`[breeze] ${err.message}`);
            console.log("[breeze] stopping early — daily budget spent. Re-run this same command tomorrow, it resumes where it left off.");
        } else {
            throw err;
        }
    }
    await pool.end();
}

module.exports = { backfillSymbol };

if (require.main === module) {
    main().catch((err) => {
        console.error("[breeze] fatal:", err.message);
        process.exit(1);
    });
}
