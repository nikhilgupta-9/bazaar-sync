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
//   • trade_date / trade_time are IST wall-clock strings. Bars are emitted
//     treating the wall-clock digits as UTC (same convention as
//     optionChain.js's /underlying-history and CandlestickChart's
//     toEpochSeconds), paired with timezone "Etc/UTC" in the symbol info so
//     the axis shows the real IST clock without a further shift.
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const optionChainService = require("../services/optionChainService");

const INTRADAY_MIN = { 1: 1, 5: 5, 15: 15, 60: 60 };
const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "60", "1D", "1W", "1M"];
const MAX_ROWS = 200000;

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
function cleanSymbol(raw) {
    return String(raw || "").toUpperCase().replace(/^NSE:/, "").trim();
}

// -- /symbols -----------------------------------------------------------
router.get("/symbols", async (req, res) => {
    try {
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
            timezone: "Etc/UTC",
            minmov: 1,
            pricescale: 100,
            has_intraday: true,
            has_daily: true,
            has_weekly_and_monthly: true,
            supported_resolutions: SUPPORTED_RESOLUTIONS,
            volume_precision: 0,
            data_status: "endofday",
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

// -- /history ---------------------------------------------------------
router.get("/history", async (req, res) => {
    try {
        const symbol = cleanSymbol(req.query.symbol);
        const resolution = String(req.query.resolution || "1D");
        const from = parseInt(req.query.from, 10) || 0;
        const to = parseInt(req.query.to, 10) || Math.floor(Date.now() / 1000);
        const intradayMin = INTRADAY_MIN[resolution];

        // Date-bounded pull with a buffer so weekly/monthly rollups near the
        // window edge still have their full source days.
        const fromDate = epochToDateStr(Math.max(0, from - 45 * 86400));
        const toDate = epochToDateStr(to + 2 * 86400);
        const rows = await db.query(
            `SELECT trade_date, trade_time, open, high, low, close, volume
             FROM ohlcv_data
             WHERE UPPER(symbol) = ? AND trade_date >= ? AND trade_date <= ?
             ORDER BY trade_date ASC, trade_time ASC
             LIMIT ${MAX_ROWS}`,
            [symbol, fromDate, toDate]
        );

        const raw = (rows || [])
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

        const win = bars.filter((b) => b.time >= from && b.time <= to);
        if (win.length === 0) {
            const earliest = bars[0]?.time;
            return res.json(earliest && earliest > to ? { s: "no_data", nextTime: earliest } : { s: "no_data" });
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
