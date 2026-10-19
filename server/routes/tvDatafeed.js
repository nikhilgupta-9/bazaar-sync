// routes/tvDatafeed.js — a UDF (Universal Data Feed) datafeed for the
// TradingView Charting Library, serving Bazaar Sync's OWN stored ohlcv_data.
//
// The Charting Library (licensed, obtained from TradingView — NOT on npm;
// see client/public/charting_library/README.md) calls these REST endpoints
// through its bundled `Datafeeds.UDFCompatibleDatafeed`, or through
// client/src/lib/tvDatafeed.js here. All the drawing tools / 100+ indicators
// live inside the library itself; this file only feeds it bars.
//
//   GET /api/tv/time                     -> server unix seconds (plain text)
//   GET /api/tv/config                   -> capabilities
//   GET /api/tv/symbols?symbol=NSE:NIFTY -> one symbol's metadata
//   GET /api/tv/search?query=&type=&limit=
//   GET /api/tv/history?symbol=&resolution=&from=&to=&countback=
//
// Data notes:
//   • ohlcv_data holds a MIX of 1-minute and EOD (15:30:00) rows depending
//     on the backfill source. Intraday resolutions use only the real minute
//     rows; a symbol with EOD-only history returns no_data for intraday.
//   • trade_date / trade_time are IST wall-clock strings. Internally bars are
//     built treating the wall-clock digits as UTC; on the way out INTRADAY
//     bars are shifted to true epoch seconds (−5:30) and symbols declare
//     timezone "Asia/Kolkata", so the axis reads 09:15–15:30 whatever
//     timezone the widget displays. Daily/weekly/monthly bars stay at 00:00
//     UTC of their date, which is what the library expects for D/W/M.
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const optionChainService = require("../services/optionChainService");

const INTRADAY_MIN = { 1: 1, 5: 5, 15: 15, 60: 60 };
const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "60", "1D", "1W", "1M"];
const MAX_ROWS = 200000;
const IST_OFFSET_SEC = 5.5 * 3600;

function round2(x) {
    return Math.round(x * 100) / 100;
}
function epochToDateStr(epochSec) {
    return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

// -- /time ------------------------------------------------------------------
router.get("/time", (req, res) => {
    res.set("Content-Type", "text/plain").send(String(Math.floor(Date.now() / 1000)));
});

// -- /config --------------------------------------------------------------
router.get("/config", (req, res) => {
    res.json({
        supported_resolutions: SUPPORTED_RESOLUTIONS,
        supports_search: true,
        supports_group_request: false,
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
        exchanges: [
            { value: "", name: "All", desc: "" },
            { value: "NSE", name: "NSE", desc: "Bazaar Sync stored data" },
        ],
        symbols_types: [
            { name: "All", value: "" },
            { name: "Index", value: "index" },
            { name: "Stock", value: "stock" },
        ],
    });
});

// -- symbol universe (cached) --------------------------------------------
let symbolCache = null;
async function symbolUniverse() {
    if (symbolCache && Date.now() - symbolCache.at < 5 * 60 * 1000) return symbolCache.list;
    const { indices = [], stocks = [] } = await optionChainService.listSymbols();
    const list = [
        ...indices.map((s) => ({ symbol: s, type: "index" })),
        ...stocks.map((s) => ({ symbol: s, type: "stock" })),
    ];
    symbolCache = { list, at: Date.now() };
    return list;
}
// -- option contracts -----------------------------------------------------
// Option Chain / Strategy Builder / Simulator open a contract chart with a
// ticker like NIFTY_20261019_23150_CE (underlying_YYYYMMDD_strike_right).
const OPTION_TICKER_RE = /^([A-Z0-9&-]+)_(\d{4})(\d{2})(\d{2})_(\d+(?:\.\d+)?)_(CE|PE)$/;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseOptionTicker(raw) {
    const m = OPTION_TICKER_RE.exec(String(raw || "").toUpperCase().replace(/^(NFO|BFO|NSE|BSE):/, "").trim());
    if (!m) return null;
    const [, underlying, y, mo, d, strike, right] = m;
    return { ticker: m[0], underlying, expiry: `${y}-${mo}-${d}`, strike: Number(strike), right, label: `${underlying} ${Number(d)} ${MONTH_ABBR[Number(mo) - 1]} ${y} ${strike} ${right}` };
}

// Minute OHLCV for one contract from REAL stored data only:
//   • live_option_ticks — the market worker's ticks (≈ every 2s per contract)
//   • option_chain_history — per-minute snapshots from the backfill sources
// Each stored point is a traded price, so a minute's OHLC is built from the
// points inside it. Volume in both tables is the contract's cumulative day
// volume, so a bar's volume is the increase across it. Ticks outside the
// 09:15–15:30 session (the worker's pre-open/after-close snapshot of the
// previous price) are dropped. Nothing is synthesised: a contract with no
// stored data returns no_data.
const SESSION_START = "09:15:00";
const SESSION_END = "15:30:59";
async function optionMinuteRows(opt, fromDate, toDate) {
    const ltpCol = opt.right === "CE" ? "ce_ltp" : "pe_ltp";
    const volCol = opt.right === "CE" ? "ce_volume" : "pe_volume";
    const [ticks, snaps] = await Promise.all([
        db.query(
            `SELECT tick_date AS d, tick_time AS tm, ltp, volume
             FROM live_option_ticks
             WHERE underlying = ? AND expiry = ? AND strike = ? AND opt_right = ?
               AND tick_date >= ? AND tick_date <= ? AND tick_time BETWEEN ? AND ?
             ORDER BY tick_date ASC, tick_time ASC
             LIMIT ${MAX_ROWS}`,
            [opt.underlying, opt.expiry, opt.strike, opt.right, fromDate, toDate, SESSION_START, SESSION_END]
        ),
        db.query(
            `SELECT trade_date AS d, trade_time AS tm, ${ltpCol} AS ltp, ${volCol} AS volume
             FROM option_chain_history
             WHERE symbol = ? AND expiry = ? AND strike = ? AND trade_date >= ? AND trade_date <= ?
               AND trade_time BETWEEN ? AND ? AND ${ltpCol} IS NOT NULL
             ORDER BY trade_date ASC, trade_time ASC
             LIMIT ${MAX_ROWS}`,
            [opt.underlying, opt.expiry, opt.strike, fromDate, toDate, SESSION_START, SESSION_END]
        ),
    ]);

    const toPoint = (r) => {
        const [y, m, d] = String(r.d).slice(0, 10).split("-").map(Number);
        const [hh, mm, ss] = String(r.tm).split(":").map(Number);
        return {
            t: Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss || 0) / 1000),
            day: String(r.d).slice(0, 10),
            p: +r.ltp,
            cumVol: r.volume != null ? +r.volume : null,
        };
    };
    // Live ticks win for any minute they cover; history fills the rest.
    const tickPts = (ticks || []).map(toPoint).filter((x) => x.p > 0);
    const tickMinutes = new Set(tickPts.map((x) => Math.floor(x.t / 60)));
    const histPts = (snaps || []).map(toPoint).filter((x) => x.p > 0 && !tickMinutes.has(Math.floor(x.t / 60)));
    const pts = [...tickPts, ...histPts].sort((a, b) => a.t - b.t);

    const bars = new Map();
    let prevDay = null;
    let prevCum = null;
    for (const x of pts) {
        if (x.day !== prevDay) {
            prevDay = x.day;
            prevCum = null;
        }
        let dv = 0;
        if (x.cumVol != null) {
            dv = prevCum != null ? Math.max(0, x.cumVol - prevCum) : 0;
            prevCum = x.cumVol;
        }
        const key = Math.floor(x.t / 60) * 60;
        const b = bars.get(key);
        if (!b) bars.set(key, { t: key, tday: Math.floor(Date.UTC(...x.day.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) / 1000), o: x.p, h: x.p, l: x.p, c: x.p, v: dv, isDailyMarker: false });
        else {
            b.h = Math.max(b.h, x.p);
            b.l = Math.min(b.l, x.p);
            b.c = x.p;
            b.v += dv;
        }
    }
    return [...bars.values()];
}

function cleanSymbol(raw) {
    const s = String(raw || "").toUpperCase().replace(/^NSE:/, "").replace(/^BSE:/, "").trim();
    if (s === "MIDCAP" || s === "NIFTY MIDCAP" || s === "NIFTY_MID_SELECT") return "MIDCPNIFTY";
    if (s === "NIFTY 50" || s === "NIFTY50") return "NIFTY";
    if (s === "BANK NIFTY" || s === "NIFTY BANK") return "BANKNIFTY";
    return s;
}

// -- /symbols -----------------------------------------------------------
router.get("/symbols", async (req, res) => {
    try {
        const opt = parseOptionTicker(req.query.symbol);
        if (opt) {
            return res.json({
                name: opt.ticker,
                ticker: opt.ticker,
                full_name: `NFO:${opt.ticker}`,
                description: opt.label,
                "exchange-traded": "NFO",
                "exchange-listed": "NFO",
                exchange: "NFO",
                listed_exchange: "NFO",
                type: "option",
                session: "0915-1530",
                timezone: "Asia/Kolkata",
                minmov: 5,
                pricescale: 100,
                has_intraday: true,
                has_daily: true,
                has_weekly_and_monthly: true,
                intraday_multipliers: ["1", "5", "15", "60"],
                supported_resolutions: SUPPORTED_RESOLUTIONS,
                volume_precision: 0,
                data_status: "streaming",
            });
        }
        const name = cleanSymbol(req.query.symbol);
        const universe = await symbolUniverse();
        const hit = universe.find((s) => s.symbol === name);
        res.json({
            name,
            ticker: name,
            full_name: `NSE:${name}`,
            description: name,
            "exchange-traded": "NSE",
            "exchange-listed": "NSE",
            exchange: "NSE",
            listed_exchange: "NSE",
            type: hit?.type || "stock",
            session: "0900-1600",
            timezone: "Asia/Kolkata",
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_daily: true,
            has_weekly_and_monthly: true,
            intraday_multipliers: ["1", "5", "15", "60"],
            supported_resolutions: SUPPORTED_RESOLUTIONS,
            volume_precision: 0,
            data_status: "streaming",
        });
    } catch (e) {
        res.status(500).json({ s: "error", errmsg: e.message });
    }
});

// -- /search ----------------------------------------------------------
router.get("/search", async (req, res) => {
    try {
        const query = String(req.query.query || "").toUpperCase();
        const type = String(req.query.type || "");
        const limit = Math.min(parseInt(req.query.limit, 10) || 30, 50);
        const universe = await symbolUniverse();
        res.json(
            universe
                .filter((s) => s.symbol.includes(query) && (!type || s.type === type))
                .slice(0, limit)
                .map((s) => ({
                    symbol: s.symbol,
                    full_name: `NSE:${s.symbol}`,
                    description: s.symbol,
                    exchange: "NSE",
                    ticker: s.symbol,
                    type: s.type,
                }))
        );
    } catch (e) {
        res.status(500).json({ s: "error", errmsg: e.message });
    }
});

// Group ascending {t,o,h,l,c,v} rows into buckets keyed by bucketFn(t).
function bucketize(rows, bucketFn) {
    const map = new Map();
    for (const r of rows) {
        const key = bucketFn(r.t);
        const g = map.get(key);
        if (!g) map.set(key, { time: key, open: r.o, high: r.h, low: r.l, close: r.c, volume: r.v || 0 });
        else {
            g.high = Math.max(g.high, r.h);
            g.low = Math.min(g.low, r.l);
            g.close = r.c;
            g.volume += r.v || 0;
        }
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
}

// Index minute bars rebuilt from the market worker's live_index_ticks —
// ohlcv_data is mostly EOD markers, so without this an index's 1m/5m chart
// had nothing for the recent sessions the worker recorded.
async function liveIndexMinuteRows(symbol, fromDate, toDate) {
    const ticks = await db.query(
        `SELECT tick_date AS d, tick_time AS tm, ltp FROM live_index_ticks
         WHERE symbol = ? AND tick_date >= ? AND tick_date <= ? AND tick_time BETWEEN ? AND ?
         ORDER BY tick_date ASC, tick_time ASC
         LIMIT ${MAX_ROWS}`,
        [symbol, fromDate, toDate, SESSION_START, SESSION_END]
    ).catch(() => []);
    const bars = new Map();
    for (const r of ticks || []) {
        const p = +r.ltp;
        if (!(p > 0)) continue;
        const [y, m, d] = String(r.d).slice(0, 10).split("-").map(Number);
        const [hh, mm] = String(r.tm).split(":").map(Number);
        const t = Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 1000);
        const b = bars.get(t);
        if (!b) bars.set(t, { t, tday: Math.floor(Date.UTC(y, m - 1, d) / 1000), day: String(r.d).slice(0, 10), o: p, h: p, l: p, c: p, v: 0, isDailyMarker: false });
        else {
            b.h = Math.max(b.h, p);
            b.l = Math.min(b.l, p);
            b.c = p;
        }
    }
    return [...bars.values()];
}

async function ohlcvRows(symbol, fromDate, toDate, intraday) {
    const [stored, live] = await Promise.all([storedOhlcvRows(symbol, fromDate, toDate), liveIndexMinuteRows(symbol, fromDate, toDate)]);
    if (!live.length) return stored;
    // Live minutes only fill what ohlcv_data lacks. Intraday: any minute
    // without a stored minute bar. Daily: only days with no stored row at
    // all, so a day's EOD candle is never mixed with (or doubled by) ticks.
    let extra;
    if (intraday) {
        const storedMinutes = new Set(stored.filter((r) => !r.isDailyMarker).map((r) => r.t));
        extra = live.filter((r) => !storedMinutes.has(r.t));
    } else {
        const storedDays = new Set(stored.map((r) => r.tday));
        extra = live.filter((r) => !storedDays.has(r.tday));
    }
    return [...stored, ...extra].sort((a, b) => a.t - b.t);
}

async function storedOhlcvRows(symbol, fromDate, toDate) {
    const rows = await db.query(
        `SELECT trade_date, trade_time, open, high, low, close, volume
         FROM ohlcv_data
         WHERE UPPER(symbol) = ? AND trade_date >= ? AND trade_date <= ?
         ORDER BY trade_date ASC, trade_time ASC
         LIMIT ${MAX_ROWS}`,
        [symbol, fromDate, toDate]
    );
    return (rows || [])
        .filter((r) => r.close != null)
        .map((r) => {
            const [y, m, d] = String(r.trade_date).slice(0, 10).split("-").map(Number);
            const timeStr = String(r.trade_time);
            const [hh, mm, ss] = timeStr.split(":").map(Number);
            return {
                t: Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss || 0) / 1000),
                tday: Math.floor(Date.UTC(y, m - 1, d) / 1000),
                // A "daily marker" row is a whole-day EOD candle stored
                // with a placeholder time (Bhavcopy/Angel-cron use
                // 00:00:00 or 15:30:00). Anything else is a real
                // intraday bar. ohlcv_data in practice is mostly daily
                // markers — intraday resolutions return what little real
                // minute data exists, else no_data (TV handles that).
                isDailyMarker: timeStr === "00:00:00" || timeStr === "15:30:00",
                o: +r.open, h: +r.high, l: +r.low, c: +r.close,
                v: r.volume != null ? +r.volume : 0,
            };
        });
}

// Latest stored timestamp before a date — only consulted when the 45-day
// buffer around a window held nothing at all (long gaps in the data).
async function lastBarTimeBefore(opt, symbol, beforeDate) {
    let row;
    if (opt) {
        [row] = await db.query(
            `SELECT tick_date AS d, MAX(tick_time) AS tm FROM live_option_ticks
             WHERE underlying = ? AND expiry = ? AND strike = ? AND opt_right = ? AND tick_date < ?
               AND tick_time BETWEEN ? AND ?
             GROUP BY tick_date ORDER BY tick_date DESC LIMIT 1`,
            [opt.underlying, opt.expiry, opt.strike, opt.right, beforeDate, SESSION_START, SESSION_END]
        );
    } else {
        [row] = await db.query(
            `SELECT trade_date AS d, MAX(trade_time) AS tm FROM ohlcv_data
             WHERE UPPER(symbol) = ? AND trade_date < ?
             GROUP BY trade_date ORDER BY trade_date DESC LIMIT 1`,
            [symbol, beforeDate]
        );
    }
    if (!row?.d) return null;
    const [y, m, d] = String(row.d).slice(0, 10).split("-").map(Number);
    const [hh, mm] = String(row.tm || "00:00:00").split(":").map(Number);
    return {
        day: Math.floor(Date.UTC(y, m - 1, d) / 1000),
        wall: Math.floor(Date.UTC(y, m - 1, d, hh, mm) / 1000),
    };
}

// -- /history ---------------------------------------------------------
router.get("/history", async (req, res) => {
    try {
        const opt = parseOptionTicker(req.query.symbol);
        const symbol = opt ? opt.ticker : cleanSymbol(req.query.symbol);
        const resolution = String(req.query.resolution || "1D");
        const from = parseInt(req.query.from, 10) || 0;
        const to = parseInt(req.query.to, 10) || Math.floor(Date.now() / 1000);
        const intradayMin = INTRADAY_MIN[resolution];

        // Date-bounded pull with a buffer so weekly/monthly rollups near the
        // window edge still have their full source days.
        const fromDate = epochToDateStr(Math.max(0, from - 45 * 86400));
        const toDate = epochToDateStr(to + 2 * 86400);
        const raw = opt ? await optionMinuteRows(opt, fromDate, toDate) : await ohlcvRows(symbol, fromDate, toDate, intradayMin != null);

        let bars;
        if (intradayMin != null) {
            const step = intradayMin * 60;
            const minuteRows = raw.filter((r) => !r.isDailyMarker);
            bars = bucketize(minuteRows, (t) => Math.floor(t / step) * step);
        } else {
            const daily = bucketize(raw.map((r) => ({ ...r, t: r.tday })), (t) => t);
            if (resolution === "1D") {
                bars = daily;
            } else if (resolution === "1W") {
                // bucket by the Monday of each week (UTC)
                bars = bucketize(
                    daily.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, t: b.time })),
                    (t) => t - ((Math.floor(t / 86400) + 3) % 7) * 86400
                );
            } else {
                // monthly — bucket by first-of-month (UTC)
                bars = bucketize(
                    daily.map((b) => ({ o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume, t: b.time })),
                    (t) => {
                        const dt = new Date(t * 1000);
                        return Math.floor(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1) / 1000);
                    }
                );
            }
        }

        // Intraday bars are keyed by IST wall clock; compare/emit in true epoch.
        const shift = intradayMin != null ? IST_OFFSET_SEC : 0;
        if (shift) bars = bars.map((b) => ({ ...b, time: b.time - shift }));
        const win = bars.filter((b) => b.time >= from && b.time <= to);
        if (win.length === 0) {
            // nextTime = the closest bar BEFORE this window, so the library
            // jumps back to it (e.g. a 1-minute chart opened pre-market or on
            // a weekend lands on the last session instead of "No data here").
            let prev = null;
            for (const b of bars) if (b.time < from) prev = b.time;
            if (prev == null && from > 0) {
                const last = await lastBarTimeBefore(opt, symbol, epochToDateStr(from));
                prev = last == null ? null : intradayMin != null ? last.wall - IST_OFFSET_SEC : last.day;
            }
            return res.json(prev != null ? { s: "no_data", nextTime: prev } : { s: "no_data" });
        }
        res.json({
            s: "ok",
            t: win.map((b) => b.time),
            o: win.map((b) => round2(b.open)),
            h: win.map((b) => round2(b.high)),
            l: win.map((b) => round2(b.low)),
            c: win.map((b) => round2(b.close)),
            v: win.map((b) => Math.round(b.volume)),
        });
    } catch (e) {
        console.error("[tv/history]", e);
        res.status(500).json({ s: "error", errmsg: e.message });
    }
});

module.exports = router;
