// services/liveDayChain.js
//
// Minute-by-minute option chain for a past (or today's) trading day rebuilt
// from the market worker's raw ticks, for days that have no
// option_chain_history snapshots (that table is filled by the nightly cron /
// backfills; the worker's own live_option_ticks are often the only record of
// the last few sessions).
//
// Raw ticks don't line up across contracts — each strike ticks at its own
// seconds — so "the chain at 10:42" is built by carrying every contract's
// LAST tick at or before the end of that minute forward (the price it was
// actually trading at then), the same "nearest earlier snapshot wins"
// convention the Simulator scrubber uses everywhere else. Only ticks inside
// the 09:15–15:30 session are used: the worker records a stale pre-open
// snapshot on start-up (e.g. 06:55 on a Saturday) that must not become a
// tradeable minute.
//
// Spot comes from live_index_ticks the same way (real index LTP per minute).
// Futures and VIX aren't persisted by the worker (CLAUDE.md Gotcha #13), so
// they're left to the caller's existing parity / ATM-IV fallbacks.
const { pool } = require("../config/db");

const SESSION_START = "09:15:00";
const SESSION_END = "15:30:59";
const PAST_DAY_CACHE_MAX = 24;
const TODAY_TTL_MS = 30 * 1000;

const dayCache = new Map(); // key -> { at, value, isToday }

function todayIst() {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    return ist.toISOString().slice(0, 10);
}
function minuteKey(t) {
    return `${String(t).slice(0, 5)}:00`;
}
function minuteToSec(m) {
    const [h, mm] = m.split(":").map(Number);
    return h * 3600 + mm * 60;
}
function secToMinute(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function cached(key, date, loader) {
    const hit = dayCache.get(key);
    const isToday = date >= todayIst();
    if (hit && (!hit.isToday || Date.now() - hit.at < TODAY_TTL_MS)) {
        dayCache.delete(key); // LRU bump
        dayCache.set(key, hit);
        return hit.value;
    }
    const value = loader().catch((err) => {
        dayCache.delete(key);
        throw err;
    });
    dayCache.set(key, { at: Date.now(), value, isToday });
    while (dayCache.size > PAST_DAY_CACHE_MAX) dayCache.delete(dayCache.keys().next().value);
    return value;
}

/** Expiries the worker recorded for this symbol/day (in-session ticks only). */
async function liveExpiries(symbol, date) {
    const [rows] = await pool.query(
        `SELECT DISTINCT expiry FROM live_option_ticks
         WHERE underlying = ? AND tick_date = ? AND tick_time BETWEEN ? AND ?
         ORDER BY expiry ASC`,
        [symbol, date, SESSION_START, SESSION_END]
    );
    return rows.map((r) => r.expiry);
}

/**
 * { times: ['HH:MM:00', …], rowsAt(time) → option_chain_history-shaped rows }
 * Every minute between the first and last in-session tick is present; a
 * strike appears from its first tick onward.
 */
function liveDay(symbol, date, expiry) {
    return cached(`chain|${symbol}|${date}|${expiry}`, date, async () => {
        const [ticks] = await pool.query(
            `SELECT strike, opt_right, tick_time, ltp, volume, oi
             FROM live_option_ticks
             WHERE underlying = ? AND tick_date = ? AND expiry = ? AND tick_time BETWEEN ? AND ?
             ORDER BY tick_time ASC, id ASC`,
            [symbol, date, expiry, SESSION_START, SESSION_END]
        );
        if (!ticks.length) return { times: [], byMinute: new Map() };

        const first = minuteToSec(minuteKey(ticks[0].tick_time));
        const last = minuteToSec(minuteKey(ticks[ticks.length - 1].tick_time));
        const state = new Map(); // strike -> row (mutable, snapshotted per minute)
        const byMinute = new Map();
        const times = [];
        let i = 0;
        for (let s = first; s <= last; s += 60) {
            const minute = secToMinute(s);
            const minuteEnd = `${minute.slice(0, 5)}:59`;
            while (i < ticks.length && String(ticks[i].tick_time) <= minuteEnd) {
                const t = ticks[i++];
                const strike = Number(t.strike);
                let row = state.get(strike);
                if (!row) {
                    row = { strike, underlying_price: null, ce_ltp: null, ce_oi: null, ce_oi_change: null, ce_volume: null, pe_ltp: null, pe_oi: null, pe_oi_change: null, pe_volume: null };
                    state.set(strike, row);
                }
                const side = t.opt_right === "CE" ? "ce" : "pe";
                if (t.ltp != null && Number(t.ltp) > 0) row[`${side}_ltp`] = Number(t.ltp);
                if (t.oi != null) row[`${side}_oi`] = Number(t.oi);
                if (t.volume != null) row[`${side}_volume`] = Number(t.volume);
            }
            times.push(minute);
            byMinute.set(minute, [...state.values()].map((r) => ({ ...r })).sort((a, b) => a.strike - b.strike));
        }
        return { times, byMinute };
    });
}

/**
 * Fast path: returns only the final in-session minute's snapshot { lastTime, rows }
 * without materializing all 375 minutes into memory.
 */
function liveDayLatest(symbol, date, expiry) {
    return cached(`latest|${symbol}|${date}|${expiry}`, date, async () => {
        const [ticks] = await pool.query(
            `SELECT strike, opt_right, tick_time, ltp, volume, oi
             FROM live_option_ticks
             WHERE underlying = ? AND tick_date = ? AND expiry = ? AND tick_time BETWEEN ? AND ?
             ORDER BY tick_time ASC, id ASC`,
            [symbol, date, expiry, SESSION_START, SESSION_END]
        );
        if (!ticks.length) return { lastTime: null, rows: [] };

        const state = new Map();
        let lastTime = ticks[ticks.length - 1].tick_time;
        for (const t of ticks) {
            const strike = Number(t.strike);
            let row = state.get(strike);
            if (!row) {
                row = { strike, underlying_price: null, ce_ltp: null, ce_oi: null, ce_oi_change: null, ce_volume: null, pe_ltp: null, pe_oi: null, pe_oi_change: null, pe_volume: null };
                state.set(strike, row);
            }
            const side = t.opt_right === "CE" ? "ce" : "pe";
            if (t.ltp != null && Number(t.ltp) > 0) row[`${side}_ltp`] = Number(t.ltp);
            if (t.oi != null) row[`${side}_oi`] = Number(t.oi);
            if (t.volume != null) row[`${side}_volume`] = Number(t.volume);
        }
        return { lastTime, rows: [...state.values()].sort((a, b) => a.strike - b.strike) };
    });
}

/** Map 'HH:MM:00' → real index LTP at that minute (carried forward). */
function liveSpot(symbol, date) {
    return cached(`spot|${symbol}|${date}`, date, async () => {
        const [ticks] = await pool.query(
            `SELECT tick_time, ltp FROM live_index_ticks
             WHERE symbol = ? AND tick_date = ? AND tick_time BETWEEN ? AND ?
             ORDER BY tick_time ASC, id ASC`,
            [symbol, date, SESSION_START, SESSION_END]
        );
        const out = new Map();
        if (!ticks.length) return out;
        const first = minuteToSec(minuteKey(ticks[0].tick_time));
        const last = minuteToSec(minuteKey(ticks[ticks.length - 1].tick_time));
        let i = 0;
        let price = null;
        for (let s = first; s <= last; s += 60) {
            const minute = secToMinute(s);
            const minuteEnd = `${minute.slice(0, 5)}:59`;
            while (i < ticks.length && String(ticks[i].tick_time) <= minuteEnd) price = Number(ticks[i++].ltp);
            if (price != null) out.set(minute, price);
        }
        return out;
    });
}

/** Spot at a minute, or the closest earlier one (index ticks can lag option ticks). */
function spotAtOrBefore(spotMap, minute) {
    if (spotMap.has(minute)) return spotMap.get(minute);
    let best = null;
    for (const [m, v] of spotMap) {
        if (m <= minute) best = v;
        else break;
    }
    return best;
}

module.exports = { liveExpiries, liveDay, liveDayLatest, liveSpot, spotAtOrBefore, SESSION_START, SESSION_END };
