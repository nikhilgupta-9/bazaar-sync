// breeze-historical/historicalService.js — wraps breezeconnect's
// getHistoricalDatav2 for options, chunked to respect the 1,000-candle/call
// cap and paced via rateLimiter.js.
//
// Response shape CONFIRMED (2026-07-20): testBreeze.js NIFTY returned 375
// real 1-minute candles for a real contract — session/auth/response-shape
// all verified against a live account, so backfillBreeze.js/
// backfillBreezeAll.js are safe to run for real (see CLAUDE.md's Phase 7
// "Verification status"). Originally written from the npm package's
// documented method signature only (Breeze's domain wasn't reachable from
// the sandbox this was first built in); parsing is still kept defensive
// (matches known field-name variants, throws with the actual response keys
// on a miss) as a safety net, not because the shape is still in doubt.
//
// Date/time convention: the documented Node.js example sends fromDate/
// toDate/expiryDate as "YYYY-MM-DDTHH:mm:ss.000Z" strings that appear to
// carry literal IST wall-clock digits with a "Z" suffix (not a real UTC
// conversion — matches how other Indian broker SDKs do it). Built here via
// plain template strings, never `new Date(...).toISOString()` (CLAUDE.md
// Gotcha #12 — that would actually shift the clock).

const { getBreeze } = require("./auth");
const rateLimiter = require("./rateLimiter");
const { addDays } = require("../services/backtestEngine");

const CHUNK_DAYS = Number(process.env.BREEZE_CHUNK_DAYS || 2); // 2 days * 375 1-min candles ≈ 750, safely under 1000

const RIGHT_MAP = { CE: "call", PE: "put" };

function isoIst(dateStr, timeStr) {
    return `${dateStr}T${timeStr}.000Z`;
}

/** Split [fromDateStr, toDateStr] into <=CHUNK_DAYS windows (inclusive), plain string date math. */
function chunkDateRange(fromDateStr, toDateStr) {
    const chunks = [];
    let start = fromDateStr;
    while (start <= toDateStr) {
        let end = addDays(start, CHUNK_DAYS - 1);
        if (end > toDateStr) end = toDateStr;
        chunks.push([start, end]);
        start = addDays(end, 1);
    }
    return chunks;
}

function pickField(row, candidates) {
    const keys = Object.keys(row);
    for (const c of candidates) {
        const hit = keys.find((k) => k.toLowerCase() === c.toLowerCase());
        if (hit !== undefined) return row[hit];
    }
    return undefined;
}

/** Handles both "2025-02-03T09:20:00.000Z" and "2025-02-03 09:20:00" shaped datetime fields. */
function splitDateTime(raw) {
    const s = String(raw);
    const sep = s.includes("T") ? "T" : " ";
    const [date, timePart] = s.split(sep);
    return { date, time: (timePart || "00:00:00").slice(0, 8) };
}

function parseRows(rawRows) {
    if (!rawRows.length) return [];
    const sample = rawRows[0];
    const dtField = ["datetime", "date_time", "date"].find((c) => Object.keys(sample).some((k) => k.toLowerCase() === c));
    if (!dtField) {
        throw new Error(`Breeze historical row has no recognizable datetime field. Actual keys: ${Object.keys(sample).join(", ")}`);
    }

    return rawRows.map((row) => {
        const dtRaw = pickField(row, ["datetime", "date_time", "date"]);
        const { date, time } = splitDateTime(dtRaw);
        return {
            date,
            time,
            open: Number(pickField(row, ["open"])) || null,
            high: Number(pickField(row, ["high"])) || null,
            low: Number(pickField(row, ["low"])) || null,
            close: Number(pickField(row, ["close"])) || null,
            volume: Number(pickField(row, ["volume"])) || 0,
            oi: Number(pickField(row, ["open_interest", "openinterest", "oi"])) || 0,
        };
    });
}

/**
 * 1-minute CE/PE candles for one option contract over an arbitrary date
 * range, chunked internally to respect the 1,000-candle cap, paced via
 * rateLimiter.throttle() to respect the 100/min + 5,000/day caps.
 */
async function getOptionMinuteCandles({ stockCode, expirySql, strike, right, fromDateStr, toDateStr }) {
    const breeze = await getBreeze();
    const breezeRight = RIGHT_MAP[right];
    if (!breezeRight) throw new Error(`Unknown right "${right}", expected CE or PE`);

    const chunks = chunkDateRange(fromDateStr, toDateStr);
    const all = [];
    for (const [chunkFrom, chunkTo] of chunks) {
        await rateLimiter.throttle();
        const resp = await breeze.getHistoricalDatav2({
            interval: "1minute",
            fromDate: isoIst(chunkFrom, "09:15:00"),
            toDate: isoIst(chunkTo, "15:30:00"),
            stockCode,
            exchangeCode: "NFO",
            productType: "options",
            expiryDate: isoIst(expirySql, "07:00:00"), // per documented example's convention, unverified
            right: breezeRight,
            strikePrice: String(strike),
        });

        if (resp?.Error) throw new Error(`Breeze getHistoricalDatav2 error: ${resp.Error}`);
        const rows = Array.isArray(resp?.Success) ? resp.Success : [];
        all.push(...parseRows(rows));
    }
    return all.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

module.exports = { getOptionMinuteCandles, chunkDateRange, isoIst };
