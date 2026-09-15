// dhan/enrichOptions.js — the options half of the Dhan pipeline.
//
// Dhan only exposes expired-options history as ATM-RELATIVE, continuously
// rolling series (dhan/historicalService.js's getRollingOption + its header
// comment) — never an absolute strike, never an explicit expiry. So for
// every (expiry-flag, rank) pair we care about, we pull EVERY offset
// (ATM-N..ATM+N) for BOTH rights across the whole month, and for each
// returned row: (1) trust Dhan's own resolved `strike`/`spot` for that
// timestamp (it already did the ATM math), (2) derive which REAL calendar
// expiry that rank corresponds to on that date via dhan/expiryResolver.js,
// fed by dhan/expiryDiscovery.js's PURE IN-MEMORY bhavcopy lookup (never
// written to option_chain_history — the user was explicit that only real
// Dhan minute data should land in that table, 2026-09-15), (3) compute
// IV/Greeks ourselves via lib/blackScholes.js, because Dhan's own `iv` field
// came back empty in every real test run here (not populated for
// rollingoption, at least for what was tested).
//
// Coverage is intentionally bounded, same honesty convention as this
// project's other "not everything, here's exactly what" notes (e.g.
// CLAUDE.md Gotcha #14 on the live worker's strike window): only
// DHAN_WEEKLY_RANKS ranks of weekly expiries and DHAN_MONTHLY_RANKS ranks of
// monthly expiries get pulled, and only ATM±10 (index) / ATM±3 (stock)
// strikes — deep OTM/ITM strikes and expiries far in the future are simply
// not obtainable from Dhan's API at all (see file-level notes in
// historicalService.js). The expiry list passed in by the caller already
// looks forward well past the current month for exactly this reason (see
// dhan/run.js) — a symbol's very last months of a year can still
// under-cover far-out ranks if the LOOKAHEAD_DAYS window doesn't reach the
// next year's expiries yet.
//
// KNOWN DATA-QUALITY CAVEAT (found empirically, not a bug here): a stock
// with a split/bonus in its history (e.g. RELIANCE, 2024) can have
// degraded/partial rollingoption coverage for dates before that corporate
// action — Dhan's own historical continuity breaks there, not this
// pipeline's logic. The verify phase reports per-month row counts so this
// shows up as a visibly low number, not a silent gap.

const { pool } = require("../lib/db");
const bs = require("../lib/blackScholes");
const instrumentMaster = require("./instrumentMaster");
const historicalService = require("./historicalService");
const expiryResolver = require("./expiryResolver");

const OFFSETS_INDEX = Number(process.env.DHAN_INDEX_STRIKE_OFFSETS || 10); // ATM-10..ATM+10, confirmed max per Dhan docs
const OFFSETS_STOCK = Number(process.env.DHAN_STOCK_STRIKE_OFFSETS || 3); // ATM-3..ATM+3, confirmed max per Dhan docs
const WEEKLY_RANKS = Number(process.env.DHAN_WEEKLY_RANKS || 6);
const MONTHLY_RANKS = Number(process.env.DHAN_MONTHLY_RANKS || 3);
const INSERT_BATCH_SIZE = 500;

function offsetLabels(maxOffset) {
    const labels = ["ATM"];
    for (let i = 1; i <= maxOffset; i++) {
        labels.push(`ATM+${i}`, `ATM-${i}`);
    }
    return labels;
}

function yearsToExpiryAsOf(expirySql, dateStr, timeStr) {
    const [ey, em, ed] = expirySql.split("-").map(Number);
    const [dy, dm, dd] = dateStr.split("-").map(Number);
    const [hh, mm, ss] = (timeStr || "15:30:00").split(":").map(Number);
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const expiryUtcMs = Date.UTC(ey, em - 1, ed, 15, 30, 0) - IST_OFFSET_MS;
    const rowUtcMs = Date.UTC(dy, dm - 1, dd, hh, mm, ss) - IST_OFFSET_MS;
    return Math.max((expiryUtcMs - rowUtcMs) / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4));
}

/** Attach expiry (derived) + IV/Greeks (computed) to every row of one (flag, rank, offset, right) series. Rows whose date has no resolvable real expiry for this rank are dropped. */
function withExpiryAndGreeks(rows, expiriesOfFlagAsc, rank, right) {
    const out = [];
    for (const r of rows) {
        const expiry = expiryResolver.expiryForRank(r.date, expiriesOfFlagAsc, rank);
        if (!expiry || r.strike == null) continue;
        let iv = null, greeks = { delta: null, gamma: null, theta: null, vega: null };
        if (r.spot != null && r.close > 0) {
            const t = yearsToExpiryAsOf(expiry, r.date, r.time);
            const bsRight = right === "CALL" ? "call" : "put";
            iv = bs.impliedVolatility({ marketPrice: r.close, spot: r.spot, strike: r.strike, t, right: bsRight });
            if (iv != null) greeks = bs.greeks({ spot: r.spot, strike: r.strike, t, vol: iv, right: bsRight });
        }
        out.push({ ...r, expiry, iv: iv != null ? iv * 100 : null, greeks });
    }
    return out;
}

/** Upsert one (right) series into option_chain_history. Uses COALESCE on every ce_ and pe_ column — CALL and PUT arrive from SEPARATE Dhan calls, so a CALL-only upsert must never null out an already-stored PUT side (and vice versa), unlike bhavcopy/Upstox which build both sides into one row before inserting. */
async function upsertOptionRows(symbol, right, rows) {
    if (!rows.length) return 0;
    const isCall = right === "CALL";
    const values = rows.map((r) => [
        symbol, r.date, r.time, r.expiry, r.strike, r.spot ?? null,
        isCall ? r.close : null, isCall ? r.oi : null, isCall ? r.volume : null, isCall ? r.iv : null,
        isCall ? r.greeks.delta : null, isCall ? r.greeks.gamma : null, isCall ? r.greeks.theta : null, isCall ? r.greeks.vega : null,
        !isCall ? r.close : null, !isCall ? r.oi : null, !isCall ? r.volume : null, !isCall ? r.iv : null,
        !isCall ? r.greeks.delta : null, !isCall ? r.greeks.gamma : null, !isCall ? r.greeks.theta : null, !isCall ? r.greeks.vega : null,
    ]);
    let stored = 0;
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
        const batch = values.slice(i, i + INSERT_BATCH_SIZE);
        await pool.query(
            `INSERT INTO option_chain_history (
               symbol, trade_date, trade_time, expiry, strike, underlying_price,
               ce_ltp, ce_oi, ce_volume, ce_iv, ce_delta, ce_gamma, ce_theta, ce_vega,
               pe_ltp, pe_oi, pe_volume, pe_iv, pe_delta, pe_gamma, pe_theta, pe_vega
             ) VALUES ?
             ON DUPLICATE KEY UPDATE
               underlying_price=COALESCE(VALUES(underlying_price), underlying_price),
               ce_ltp=COALESCE(VALUES(ce_ltp), ce_ltp), ce_oi=COALESCE(VALUES(ce_oi), ce_oi), ce_volume=COALESCE(VALUES(ce_volume), ce_volume), ce_iv=COALESCE(VALUES(ce_iv), ce_iv),
               ce_delta=COALESCE(VALUES(ce_delta), ce_delta), ce_gamma=COALESCE(VALUES(ce_gamma), ce_gamma), ce_theta=COALESCE(VALUES(ce_theta), ce_theta), ce_vega=COALESCE(VALUES(ce_vega), ce_vega),
               pe_ltp=COALESCE(VALUES(pe_ltp), pe_ltp), pe_oi=COALESCE(VALUES(pe_oi), pe_oi), pe_volume=COALESCE(VALUES(pe_volume), pe_volume), pe_iv=COALESCE(VALUES(pe_iv), pe_iv),
               pe_delta=COALESCE(VALUES(pe_delta), pe_delta), pe_gamma=COALESCE(VALUES(pe_gamma), pe_gamma), pe_theta=COALESCE(VALUES(pe_theta), pe_theta), pe_vega=COALESCE(VALUES(pe_vega), pe_vega)`,
            [batch]
        );
        stored += batch.length;
    }
    return stored;
}

/**
 * One calendar month of options for one symbol. `expiriesAsc` is the
 * symbol's full real expiry list (see dhan/expiryDiscovery.js) — fetched
 * ONCE per year by the caller (dhan/run.js) and passed in here so a
 * 12-month loop doesn't re-walk the same bhavcopy calendar 12 times.
 */
async function enrichOptionsMonth(symbol, year, month, expiriesAsc) {
    const mm = String(month).padStart(2, "0");
    const first = `${year}-${mm}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const last = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

    const underlying = await instrumentMaster.resolveOptionUnderlying(symbol);
    if (!underlying) {
        console.warn(`[dhan-options] ${symbol}: no OPTIDX/OPTSTK underlying resolvable (not an index, not in Dhan's equity master) — skipped`);
        return { rowsStored: 0 };
    }
    const maxOffset = underlying.instrument === "OPTIDX" ? OFFSETS_INDEX : OFFSETS_STOCK;
    const offsets = offsetLabels(maxOffset);

    const { week, month: monthExp } = expiryResolver.classifyExpiries(expiriesAsc);
    if (!week.length && !monthExp.length) {
        console.warn(`[dhan-options] ${symbol} ${year}-${mm}: no real expiries found in NSE/BSE bhavcopy for this range — nothing to enrich`);
        return { rowsStored: 0 };
    }

    let totalRows = 0;
    for (const [flag, list, maxRank] of [["WEEK", week, WEEKLY_RANKS], ["MONTH", monthExp, MONTHLY_RANKS]]) {
        if (!list.length) continue;
        for (let rank = 1; rank <= maxRank; rank++) {
            for (const offset of offsets) {
                for (const right of ["CALL", "PUT"]) {
                    try {
                        const raw = await historicalService.getRollingOption({
                            securityId: underlying.securityId, instrument: underlying.instrument,
                            expiryFlag: flag, expiryCode: rank, strike: offset, drvOptionType: right,
                            fromDate: first, toDate: last,
                        });
                        const withExpiry = withExpiryAndGreeks(raw, list, rank, right);
                        totalRows += await upsertOptionRows(symbol, right, withExpiry);
                    } catch (err) {
                        console.error(`[dhan-options] ${symbol} ${year}-${mm} ${flag}#${rank} ${offset} ${right}: ${err.message}`);
                    }
                }
            }
        }
    }
    console.log(`[dhan-options] ${symbol} ${year}-${mm}: ${totalRows} rows stored (${week.length} weekly + ${monthExp.length} monthly expiries known)`);
    return { rowsStored: totalRows };
}

module.exports = { enrichOptionsMonth, offsetLabels };
