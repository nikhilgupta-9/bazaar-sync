// services/upstoxInstrumentMaster.js — resolves a plain NSE trading symbol
// (e.g. "RELIANCE", "TCS") to the Upstox "instrument_key" needed as the
// `instrument_key` param for expired-instruments lookups (upstoxHistorical.js
// getExpiries/getExpiredOptionContracts). upstoxHistorical.js's UNDERLYING_KEYS
// only hardcodes the 3 index keys we already know — this covers the other
// ~200+ F&O stocks by downloading Upstox's own public instrument master.
//
// *** UNVERIFIED file format *** — same situation nseBhavcopy.js and
// breeze-historical/historicalService.js were in before their first real
// run: built from Upstox's documented instrument-master file (gzipped CSV,
// assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz), not a
// live download (not reachable from the sandbox this was written in).
// Column-name matching is defensive (same FIELD_CANDIDATES pattern as
// nseBhavcopy.js) and throws with the real header on a mismatch instead of
// silently returning wrong keys. Run scripts/testUpstoxInstrumentMaster.js
// before trusting backfillUpstox.js SYMBOL=ALL.
//
// Cached on disk (server/data/upstox-instruments.csv, gitignored), refreshed
// after 24h — same pattern as instrumentMaster.js's Angel One scrip master.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const INSTRUMENTS_URL =
    process.env.UPSTOX_INSTRUMENTS_URL || "https://assets.upstox.com/market-quote/instruments/exchange/NSE.csv.gz";
const CACHE_PATH = path.join(__dirname, "..", "data", "upstox-instruments.csv");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Defensive header matching — Upstox's documented columns, but exact casing/
// naming not independently confirmed here (see UNVERIFIED note above).
const FIELD_CANDIDATES = {
    instrumentKey: ["instrument_key", "instrumentkey"],
    tradingSymbol: ["tradingsymbol", "trading_symbol", "symbol"],
    name: ["name"],
    instrumentType: ["instrument_type", "instrumenttype"],
    segment: ["segment", "exchange"],
};

function pickCol(header, candidates) {
    const idx = header.findIndex((h) => candidates.includes(h.trim().toLowerCase()));
    return idx;
}

function parseCsvLine(line) {
    // Upstox's instrument master quotes every field (e.g. `"instrument_key"`)
    // even though the columns we read never contain commas themselves — so a
    // plain split + per-cell quote-strip is enough, no need for a real CSV
    // parser. Confirmed against a live download (2026-07-20): header/rows both
    // came back fully double-quoted.
    return line.split(",").map((cell) => cell.trim().replace(/^"(.*)"$/, "$1"));
}

async function downloadInstruments({ force = false } = {}) {
    if (!force && fs.existsSync(CACHE_PATH)) {
        const age = Date.now() - fs.statSync(CACHE_PATH).mtimeMs;
        if (age < CACHE_MAX_AGE_MS) return CACHE_PATH;
    }

    const res = await fetch(INSTRUMENTS_URL);
    if (!res.ok) throw new Error(`Upstox instrument master download failed: HTTP ${res.status}`);
    const gzBuf = Buffer.from(await res.arrayBuffer());
    const csvBuf = zlib.gunzipSync(gzBuf);

    const dataDir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, csvBuf);
    return CACHE_PATH;
}

let cachedMap = null; // in-memory, per-process
let cachedMapBuiltFrom = null;

/** Map of trading symbol ("RELIANCE") -> Upstox equity instrument_key ("NSE_EQ|INE..."). */
async function getEquityInstrumentKeyMap({ force = false } = {}) {
    const csvPath = await downloadInstruments({ force });
    if (cachedMap && cachedMapBuiltFrom === csvPath && !force) return cachedMap;

    const text = fs.readFileSync(csvPath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length);
    if (!lines.length) throw new Error("Upstox instrument master file is empty");

    const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const col = {};
    for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
        col[field] = pickCol(header, candidates);
    }
    if (col.instrumentKey === -1 || col.tradingSymbol === -1) {
        throw new Error(
            `Upstox instrument master CSV has no recognizable instrument_key/tradingsymbol columns. Actual header: ${header.join(", ")}`
        );
    }

    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const instrumentType = col.instrumentType !== -1 ? cells[col.instrumentType]?.trim() : null;
        const segment = col.segment !== -1 ? cells[col.segment]?.trim() : null;
        // Keep only plain-equity rows (skip derivatives/other instrument types
        // that may share the same file) — defensive: if instrumentType/segment
        // columns aren't present, fall back to accepting the row rather than
        // dropping everything.
        if (instrumentType && !/^EQ$/i.test(instrumentType)) continue;
        if (segment && !/NSE_EQ|^NSE$/i.test(segment)) continue;

        const symbol = cells[col.tradingSymbol]?.trim().toUpperCase();
        const instrumentKey = cells[col.instrumentKey]?.trim();
        if (symbol && instrumentKey) map.set(symbol, instrumentKey);
    }

    if (!map.size) {
        throw new Error(
            `Upstox instrument master parsed 0 equity rows — check FIELD_CANDIDATES against the real header: ${header.join(", ")}`
        );
    }

    cachedMap = map;
    cachedMapBuiltFrom = csvPath;
    return map;
}

/** Resolve one symbol to its Upstox instrument_key, or null if not found. */
async function resolveInstrumentKey(symbol) {
    const map = await getEquityInstrumentKeyMap();
    return map.get(symbol.toUpperCase()) || null;
}

module.exports = { downloadInstruments, getEquityInstrumentKeyMap, resolveInstrumentKey, CACHE_PATH };
