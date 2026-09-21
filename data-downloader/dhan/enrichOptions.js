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
// IV/Greeks ourselves via lib/blackScholes.js — Dhan's own `iv` field IS
// populated on rollingoption (confirmed for real 2026-09-19, superseding an
// earlier note here that it came back empty), but it's only used below to
// detect duplicate/echoed ranks (see dedupeByNearestExpiry), never trusted
// for storage, since our own solver is the one consistent source across
// every data source this pipeline family uses (Breeze, Upstox, bhavcopy).
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
const { addDays, dayOfWeek } = require("../lib/dates");

const OFFSETS_INDEX = Number(process.env.DHAN_INDEX_STRIKE_OFFSETS || 10); // ATM-10..ATM+10, confirmed max per Dhan docs
const OFFSETS_STOCK = Number(process.env.DHAN_STOCK_STRIKE_OFFSETS || 3); // ATM-3..ATM+3, confirmed max per Dhan docs
const WEEKLY_RANKS = Number(process.env.DHAN_WEEKLY_RANKS || 6);
const MONTHLY_RANKS = Number(process.env.DHAN_MONTHLY_RANKS || 3);
const INSERT_BATCH_SIZE = 500;

// A month of options is (ranks × offsets × rights) separate rollingoption
// calls — e.g. an index month is 9 ranks × 21 offsets × 2 rights ≈ 378 calls.
// This worker pool's job is ONLY to keep enough requests in flight that
// network round-trip latency doesn't idle the pipeline — the actual
// dispatch RATE (how many NEW requests start per second) is governed
// separately by client.js's adaptive limiter (getCurrentRate()), which is
// what actually protects against Dhan's rate limit. So this pool can safely
// run wider than the dispatch rate: extra workers just queue inside
// client.js's throttle() instead of idling on `await`, which is exactly
// what was missing before (2026-09-19: concurrency=2 + rate=2/s measured
// far under 2 req/s in practice, because only 2 requests could ever be
// in-flight waiting on 1-3s round trips — the concurrency itself was the
// bottleneck, not the rate limiter). DHAN_OPTIONS_CONCURRENCY only needs to
// be raised further than this if DHAN_MAX_REQ_PER_SEC_CEILING (client.js)
// is also raised well past this default.
// Reduced 8 -> 3 (2026-09-21): with 8 workers, up to 8 requests could be
// in flight and NOT YET rejected before the first 429 came back and set the
// shared cooldown — by the time it did, the other 7 were already committed
// and mostly also 429'd, compounding the backoff. Fewer workers means fewer
// "already in flight, can't be un-sent" requests riding along on a burst
// that turns out to be too fast for Dhan's real (lower than assumed)
// tolerance — see client.js's RATE_FLOOR note for the same finding.
const OPTIONS_CONCURRENCY = Number(process.env.DHAN_OPTIONS_CONCURRENCY || 3);

/** Runs `worker` over `items` with at most `concurrency` in flight at once. */
async function asyncPool(concurrency, items, worker) {
    let cursor = 0;
    async function run() {
        while (cursor < items.length) {
            const i = cursor++;
            await worker(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

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

/** Attach expiry (derived) to every row of one (flag, rank) series. Rows whose date has no resolvable real expiry for this rank are dropped. Cheap — no IV/Greeks math — so it's safe to run on rows that might still get dropped by dedupeByNearestExpiry below before any Black-Scholes solving is wasted on them. */
function resolveExpiry(rows, expiriesOfFlagAsc, rank) {
    const out = [];
    for (const r of rows) {
        const expiry = expiryResolver.expiryForRank(r.date, expiriesOfFlagAsc, rank);
        if (!expiry || r.strike == null) continue;
        out.push({ ...r, expiry });
    }
    return out;
}

/** Compute IV/Greeks ourselves (Dhan's own `iv` field on rollingoption is only used for dedup comparison, see below — never trusted for storage) for rows that survived dedup. */
function attachGreeks(rows, right) {
    return rows.map((r) => {
        let iv = null, greeks = { delta: null, gamma: null, theta: null, vega: null };
        if (r.spot != null && r.close > 0) {
            const t = yearsToExpiryAsOf(r.expiry, r.date, r.time);
            const bsRight = right === "CALL" ? "call" : "put";
            iv = bs.impliedVolatility({ marketPrice: r.close, spot: r.spot, strike: r.strike, t, right: bsRight });
            if (iv != null) greeks = bs.greeks({ spot: r.spot, strike: r.strike, t, vol: iv, right: bsRight });
        }
        return { ...r, iv: iv != null ? iv * 100 : null, greeks };
    });
}

// CONFIRMED FOR REAL (2026-09-19): Dhan's /charts/rollingoption sometimes
// has no real distinct series for a farther-out rank and silently echoes an
// already-known nearer series back instead of an empty result — first
// caught on MIDCPNIFTY (WEEK#1 and MONTH#1 identical all day), then found
// to be broader on NIFTY itself: two DIFFERENT weekly ranks (2023-03-16 and
// 2023-03-29) returned bit-identical close+iv for the same strike/minute,
// with a telltale near-zero iv (0.10%) — a degenerate signature, not a real
// coincidence (two options at different expiries pricing identically is not
// realistic). So this is a general "any rank can echo any other rank"
// problem, not just WEEK-vs-MONTH — dedup below runs across every fetched
// row for a given (offset, right), regardless of which flag/rank it came
// from, keyed by real resolved expiry rather than by which request fetched
// it. Rows are grouped by (date, time); within a group, each distinct
// (close, iv) signature is kept only for the row with the NEAREST expiry —
// Dhan's own data is trustworthy for whichever contract is actually nearest
// to that rank slot, and an identical farther "echo" of it is what gets
// dropped, never stored under the wrong (factually incorrect) expiry.
function dedupeByNearestExpiry(rows) {
    const groups = new Map(); // `${date}|${time}` -> rows[]
    for (const r of rows) {
        const key = `${r.date}|${r.time}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const kept = [];
    let dropped = 0;
    for (const group of groups.values()) {
        group.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
        const seen = new Set();
        for (const r of group) {
            const sig = r.iv != null ? `${r.close}|${r.iv}` : null;
            if (sig != null && seen.has(sig)) {
                dropped += 1;
                continue;
            }
            if (sig != null) seen.add(sig);
            kept.push(r);
        }
    }
    return { kept, dropped };
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
function missingDateRanges(dates) {
    const sorted = [...new Set(dates)].sort();
    const ranges = [];
    for (const date of sorted) {
        const previous = ranges[ranges.length - 1];
        if (!previous || addDays(previous[1], 1) !== date) ranges.push([date, date]);
        else previous[1] = date;
    }
    return ranges;
}

async function enrichOptionsMonth(symbol, year, month, expiriesAsc, missingDates) {
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

    const fetchRanges = missingDates ? missingDateRanges(missingDates) : [[first, last]];
    if (!fetchRanges.length) {
        console.log(`[dhan-options] ${symbol} ${year}-${mm}: all known option dates already exist — skipped`);
        return { rowsStored: 0 };
    }
    // Flatten every (flag, rank, offset, right, date-range) combination into
    // ONE flat task list — single pool, full concurrency (see
    // OPTIONS_CONCURRENCY above). Dedup no longer depends on fetch order
    // (WEEK-before-MONTH); it happens AFTER every fetch, grouped by each
    // row's real resolved expiry (see dedupeByNearestExpiry above), so it
    // generically catches duplication between any two ranks/flags.
    // CONFIRMED FOR REAL (2026-09-21): requesting a rank beyond how many
    // real expiries bhavcopy actually discovered for this symbol/window
    // (e.g. WEEK#4 when only 3 real weekly expiries were found) gets a
    // guaranteed HTTP 400 "Missing required fields, bad values for
    // parameters" from Dhan — not a graceful empty result. This is common
    // for smaller/less-liquid stocks, which often don't have as many
    // forward weekly expiries listed as the index products do. Since
    // resolveExpiry() would drop any row past `list.length` anyway (no real
    // calendar expiry to attach), there's no reason to ever ask Dhan for a
    // rank we already know can't resolve — bounding maxRank by list.length
    // skips a real, observed source of wasted/failing API calls (WEEKLY_RANKS
    // itself stays a per-symbol-agnostic ceiling for symbols that DO have
    // that many real expiries, e.g. NIFTY).
    const tasks = [];
    for (const [flag, list, configuredMaxRank] of [["WEEK", week, WEEKLY_RANKS], ["MONTH", monthExp, MONTHLY_RANKS]]) {
        if (!list.length) continue;
        const maxRank = Math.min(configuredMaxRank, list.length);
        for (let rank = 1; rank <= maxRank; rank++) {
            for (const offset of offsets) {
                for (const right of ["CALL", "PUT"]) {
                    for (const [rangeStart, rangeEnd] of fetchRanges) {
                        tasks.push({ flag, list, rank, offset, right, rangeStart, rangeEnd });
                    }
                }
            }
        }
    }

    // Buffered per (offset, right) — only expiry-resolved (cheap), not yet
    // Greeks-computed, since dedup below may still drop some of these rows
    // and there's no point Black-Scholes-solving IV for a row that gets
    // thrown away.
    const buffers = new Map(); // `${offset}|${right}` -> { right, rows: [] }
    await asyncPool(OPTIONS_CONCURRENCY, tasks, async ({ flag, list, rank, offset, right, rangeStart, rangeEnd }) => {
        try {
            const raw = await historicalService.getRollingOption({
                securityId: underlying.securityId, instrument: underlying.instrument, exchangeSegment: underlying.exchangeSegment,
                expiryFlag: flag, expiryCode: rank, strike: offset, drvOptionType: right,
                fromDate: rangeStart, toDate: rangeEnd,
            });
            const resolved = resolveExpiry(raw, list, rank);
            const key = `${offset}|${right}`;
            if (!buffers.has(key)) buffers.set(key, { right, rows: [] });
            buffers.get(key).rows.push(...resolved);
        } catch (err) {
            console.error(`[dhan-options] ${symbol} ${year}-${mm} ${flag}#${rank} ${offset} ${right}: ${err.message}`);
        }
    });

    let totalDropped = 0;
    const callRows = [];
    const putRows = [];
    for (const { right, rows } of buffers.values()) {
        const { kept, dropped } = dedupeByNearestExpiry(rows);
        totalDropped += dropped;
        const withGreeks = attachGreeks(kept, right);
        (right === "CALL" ? callRows : putRows).push(...withGreeks);
    }

    let totalRows = 0;
    totalRows += await upsertOptionRows(symbol, "CALL", callRows);
    totalRows += await upsertOptionRows(symbol, "PUT", putRows);

    if (totalDropped) {
        console.warn(`[dhan-options] ${symbol} ${year}-${mm}: dropped ${totalDropped} row(s) that exactly duplicated a nearer expiry's data (Dhan returned no real distinct series for that farther rank/flag) — not stored`);
    }
    console.log(`[dhan-options] ${symbol} ${year}-${mm}: ${totalRows} rows stored (${week.length} weekly + ${monthExp.length} monthly expiries known)`);
    return { rowsStored: totalRows, droppedDuplicates: totalDropped };
}

module.exports = { enrichOptionsMonth, offsetLabels, missingDateRanges };
