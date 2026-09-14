// dhan/historicalService.js — wraps Dhan's 3 relevant endpoints, each
// confirmed for real against live 2023 data (2026-09-14) before this file
// was written:
//
//   /charts/intraday   — 1-minute OHLC for INDEX or EQUITY, by securityId.
//                         Confirmed working for Jan 2023 dates. Docs say max
//                         90 days per request — chunked below defensively
//                         (not independently confirmed to error past 90d,
//                         chunking is cheap insurance either way).
//   /charts/historical — daily OHLC(+OI). For FUTIDX/FUTSTK this returns a
//                         CONTINUOUS ROLLING futures series (confirmed: a
//                         2026-listed contract's securityId returns real
//                         2015-2023 numbers) — it is NOT that specific
//                         contract's real trading life, there is no way to
//                         address one via Dhan at all. Daily only — minute
//                         intraday for old futures dates comes back empty
//                         (confirmed), so this is the ONLY futures path here.
//   /charts/rollingoption — expired OPTIONS ONLY (OPTIDX/OPTSTK; rejects
//                         FUTIDX/FUTSTK with "strike is required"). Strike is
//                         ATM-relative ("ATM", "ATM+N"/"ATM-N", max ±10 index
//                         / ±3 stock — NOT independently re-confirmed for the
//                         stock cap, per Dhan's own docs), continuously
//                         rolling across real expiries by (expiryFlag,
//                         expiryCode) rank — no explicit expiry field in the
//                         response, see dhan/expiryResolver.js for how the
//                         real calendar expiry is derived from bhavcopy data
//                         this repo already discovers independently.
//                         CAVEAT found empirically: a stock with a stock
//                         split/bonus in its history (RELIANCE, 2024) can
//                         have degraded/partial coverage for dates before the
//                         corporate action — not a bug here, a real Dhan data
//                         gap; the verify phase surfaces low-coverage months
//                         rather than silently accepting them.

const { post } = require("./client");
const { addDays } = require("../lib/dates");

const MAX_INTRADAY_SPAN_DAYS = Number(process.env.DHAN_INTRADAY_CHUNK_DAYS || 80); // stay under Dhan's documented 90-day cap

function chunkDateRange(fromDate, toDate, maxDays) {
    const chunks = [];
    let start = fromDate;
    while (start <= toDate) {
        const end = addDays(start, maxDays - 1) > toDate ? toDate : addDays(start, maxDays - 1);
        chunks.push([start, end]);
        start = addDays(end, 1);
    }
    return chunks;
}

/** epoch seconds (UTC) -> IST wall-clock {date:'YYYY-MM-DD', time:'HH:MM:SS'}, pure UTC arithmetic (Gotcha #12 — never ambient local Date parsing). */
function istPartsFromEpoch(epochSec) {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const d = new Date(epochSec * 1000 + IST_OFFSET_MS);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
    return { date, time };
}

/** Turn a Dhan {open[],high[],low[],close[],volume[],timestamp[],open_interest[]?} column-arrays response into row objects. */
function toRows(data) {
    const n = (data.timestamp || []).length;
    const rows = [];
    for (let i = 0; i < n; i++) {
        const { date, time } = istPartsFromEpoch(data.timestamp[i]);
        rows.push({
            date, time,
            open: data.open?.[i] ?? null, high: data.high?.[i] ?? null, low: data.low?.[i] ?? null, close: data.close?.[i] ?? null,
            volume: data.volume?.[i] ?? 0, oi: data.open_interest?.[i] ?? null,
        });
    }
    return rows;
}

/** 1-minute candles for an INDEX (NIFTY etc. or INDIAVIX), chunked to respect the ~90-day cap. */
async function getIndexIntradayMinutes(securityId, fromDate, toDate) {
    const all = [];
    for (const [from, to] of chunkDateRange(fromDate, toDate, MAX_INTRADAY_SPAN_DAYS)) {
        const data = await post("/charts/intraday", {
            securityId, exchangeSegment: "IDX_I", instrument: "INDEX", interval: "1",
            fromDate: `${from} 09:00:00`, toDate: `${to} 15:35:00`,
        });
        all.push(...toRows(data));
    }
    return all;
}

/** 1-minute candles for an EQUITY (stock spot). */
async function getEquityIntradayMinutes(securityId, fromDate, toDate) {
    const all = [];
    for (const [from, to] of chunkDateRange(fromDate, toDate, MAX_INTRADAY_SPAN_DAYS)) {
        const data = await post("/charts/intraday", {
            securityId, exchangeSegment: "NSE_EQ", instrument: "EQUITY", interval: "1",
            fromDate: `${from} 09:00:00`, toDate: `${to} 15:35:00`,
        });
        all.push(...toRows(data));
    }
    return all;
}

/** Daily continuous-rolling futures series (any live securityId for the underlying works — see file header). */
async function getFuturesDaily(securityId, instrument, fromDate, toDate) {
    const data = await post("/charts/historical", {
        securityId, exchangeSegment: "NSE_FNO", instrument, oi: true, fromDate, toDate,
    });
    return toRows(data);
}

/**
 * One (offset, right) rolling-option series across [fromDate, toDate] for
 * one (expiryFlag, expiryCode) rank. Returns rows with the response's own
 * resolved strike/spot per timestamp (needed since the request only names an
 * ATM-relative offset, not an absolute strike).
 */
async function getRollingOption({ securityId, instrument, expiryFlag, expiryCode, strike, drvOptionType, fromDate, toDate }) {
    const data = await post("/charts/rollingoption", {
        exchangeSegment: "NSE_FNO", interval: "1", securityId, instrument,
        expiryFlag, expiryCode, strike, drvOptionType,
        requiredData: ["open", "high", "low", "close", "volume", "oi", "iv", "strike", "spot"],
        fromDate, toDate,
    });
    const side = data?.data?.ce && drvOptionType === "CALL" ? data.data.ce : data?.data?.pe;
    if (!side || !side.timestamp) return [];
    const n = side.timestamp.length;
    const rows = [];
    for (let i = 0; i < n; i++) {
        const { date, time } = istPartsFromEpoch(side.timestamp[i]);
        rows.push({
            date, time,
            open: side.open?.[i] ?? null, high: side.high?.[i] ?? null, low: side.low?.[i] ?? null, close: side.close?.[i] ?? null,
            volume: side.volume?.[i] ?? 0, oi: side.oi?.[i] ?? null, iv: side.iv?.[i] ?? null,
            strike: side.strike?.[i] ?? null, spot: side.spot?.[i] ?? null,
        });
    }
    return rows;
}

module.exports = { getIndexIntradayMinutes, getEquityIntradayMinutes, getFuturesDaily, getRollingOption, chunkDateRange, istPartsFromEpoch };
