// services/instrumentMaster.js — Angel One instrument (scrip) master.
//
// Angel One publishes a full instrument dump daily as public JSON (no auth):
//   https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json
// It is the ONLY way to map "NIFTY 24000 CE 31-Jul-2026" to the numeric
// symboltoken that both the WebSocket feed and the historical candle API
// require. This module downloads it, caches it on disk for the day (it's
// ~40-80 MB and refreshed daily by Angel One), and answers token lookups.
//
// No Express, no req/res — safe to require from the market worker, cron and
// scripts. Each process keeps its own parsed copy in memory after first load.
//
// Date handling follows the project rule (CLAUDE.md Gotcha #12): expiries in
// the master arrive as "31JUL2026" strings and are converted to plain
// 'YYYY-MM-DD' strings by manual parsing — never `new Date(nonISOString)`.

const fs = require("fs");
const path = require("path");
const { workerLogger } = require("../config/logger");

const MASTER_URL =
    process.env.ANGEL_SCRIP_MASTER_URL ||
    "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

const CACHE_DIR = process.env.SCRIP_MASTER_CACHE_DIR || path.join(__dirname, "..", "data");
const CACHE_FILE = path.join(CACHE_DIR, "OpenAPIScripMaster.json");
const CACHE_MAX_AGE_MS = 20 * 60 * 60 * 1000; // refresh daily (20h to be safe)

// Well-known NSE index tokens (overridable via env). These come from the
// same scrip master (exch_seg NSE, index entries). The original
// "26000/26009/26037" tokens here were wrong — confirmed via a real
// getCandleData call returning status:true, data:[] (no error, just silently
// empty). Angel One's actual index tokens for quote/historical/WS purposes
// are the "999260xx" series — confirmed via Angel One's own SmartAPI forum
// (smartapi.angelone.in/smartapi/forum/topic/5183 and .../topic/2156). If
// live spot/VIX data ever silently stops updating again, check whether Angel
// One has changed the series again before assuming something else broke.
const INDEX_TOKENS = {
    NIFTY: { token: process.env.ANGEL_TOKEN_NIFTY || "99926000", exch: "NSE_CM", exchSeg: "NSE" },
    BANKNIFTY: { token: process.env.ANGEL_TOKEN_BANKNIFTY || "99926009", exch: "NSE_CM", exchSeg: "NSE" },
    FINNIFTY: { token: process.env.ANGEL_TOKEN_FINNIFTY || "99926037", exch: "NSE_CM", exchSeg: "NSE" },
    MIDCPNIFTY: { token: process.env.ANGEL_TOKEN_MIDCPNIFTY || "99926074", exch: "NSE_CM", exchSeg: "NSE" },
    NIFTYNXT50: { token: process.env.ANGEL_TOKEN_NIFTYNXT50 || "99926013", exch: "NSE_CM", exchSeg: "NSE" },
    SENSEX: { token: process.env.ANGEL_TOKEN_SENSEX || "99919000", exch: "BSE_CM", exchSeg: "BSE" },
    BANKEX: { token: process.env.ANGEL_TOKEN_BANKEX || "99919012", exch: "BSE_CM", exchSeg: "BSE" },
    INDIAVIX: { token: process.env.ANGEL_TOKEN_INDIAVIX || "99926017", exch: "NSE_CM", exchSeg: "NSE" },
};

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "31JUL2026" -> "2026-07-31" (plain string parsing, no Date). */
function expiryToSql(raw) {
    if (!raw || raw.length < 8) return null;
    const day = raw.slice(0, 2);
    const mon = MONTHS[raw.slice(2, 5).toUpperCase()];
    const year = raw.slice(5);
    if (!mon || !/^\d{4}$/.test(year) || !/^\d{2}$/.test(day)) return null;
    return `${year}-${mon}-${day}`;
}

/** Today's calendar date in IST as 'YYYY-MM-DD', via explicit UTC arithmetic. */
function todayIst() {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
    const d = new Date(istMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

let parsed = null; // { loadedAt, options: Map<underlying, contracts[]>, futures, spotTokens, lotSizeByUnderlying }

const DOWNLOAD_TIMEOUT_MS = 10000; // fail fast instead of hanging the request that triggered this

async function downloadMaster() {
    workerLogger.info(`Downloading Angel One scrip master from ${MASTER_URL}`);
    const res = await fetch(MASTER_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Scrip master download HTTP ${res.status}`);
    const text = await res.text();
    // Basic sanity check before overwriting the cache
    if (!text.startsWith("[")) throw new Error("Scrip master response is not a JSON array");
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, text);
    workerLogger.info(`Scrip master cached (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
    return text;
}

async function loadRaw() {
    if (fs.existsSync(CACHE_FILE)) {
        const age = Date.now() - fs.statSync(CACHE_FILE).mtimeMs;
        if (age < CACHE_MAX_AGE_MS) {
            return fs.readFileSync(CACHE_FILE, "utf8");
        }
    }
    try {
        return await downloadMaster();
    } catch (err) {
        if (fs.existsSync(CACHE_FILE)) {
            workerLogger.warn(`Scrip master download failed (${err.message}) — using stale disk cache`);
            return fs.readFileSync(CACHE_FILE, "utf8");
        }
        throw err;
    }
}

const LOT_SIZE_TYPES = new Set(["OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK"]);

async function ensureLoaded({ force = false } = {}) {
    if (parsed && !force && Date.now() - parsed.loadedAt < CACHE_MAX_AGE_MS) return parsed;

    const raw = await loadRaw();
    const all = JSON.parse(raw);

    const options = new Map();
    const futures = new Map();
    const spotTokens = new Map();
    const lotSizeByUnderlying = new Map();

    // Populate index spot tokens first
    for (const [sym, info] of Object.entries(INDEX_TOKENS)) {
        spotTokens.set(sym, info);
    }

    for (const row of all) {
        const name = (row.name || "").toUpperCase();
        if (!name) continue;

        // Spot token map for equity (cash market)
        if (row.exch_seg === "NSE" && (row.symbol || "").endsWith("-EQ")) {
            if (!spotTokens.has(name)) {
                spotTokens.set(name, {
                    token: String(row.token),
                    exch: "NSE_CM",
                    exchSeg: "NSE",
                    name,
                    symbol: row.symbol,
                });
            }
        }

        const isNfo = row.exch_seg === "NFO";
        const isBfo = row.exch_seg === "BFO";
        if (!isNfo && !isBfo) continue;

        if (LOT_SIZE_TYPES.has(row.instrumenttype) || isBfo) {
            const lotSize = Number(row.lotsize);
            if (lotSize > 0 && !lotSizeByUnderlying.has(name)) {
                lotSizeByUnderlying.set(name, lotSize);
            }
        }

        const isOpt = row.instrumenttype === "OPTIDX" || row.instrumenttype === "OPTSTK" || (isBfo && ((row.symbol || "").endsWith("CE") || (row.symbol || "").endsWith("PE")));
        const isFut = row.instrumenttype === "FUTIDX" || row.instrumenttype === "FUTSTK" || (isBfo && (row.symbol || "").endsWith("FUT"));

        if (!isOpt && !isFut) continue;

        const expirySql = expiryToSql(row.expiry);
        if (!expirySql) continue;

        if (isOpt) {
            const strike = Number(row.strike) / 100;
            if (!Number.isFinite(strike) || strike <= 0) continue;

            const sym = (row.symbol || "").toUpperCase();
            const right = sym.endsWith("CE") ? "CE" : sym.endsWith("PE") ? "PE" : null;
            if (!right) continue;

            if (!options.has(name)) options.set(name, []);
            options.get(name).push({
                token: String(row.token),
                exchSeg: row.exch_seg,
                underlying: name,
                strike,
                right,
                expiry: expirySql,
                lotSize: Number(row.lotsize) || null,
            });
        } else if (isFut) {
            if (!futures.has(name)) futures.set(name, []);
            futures.get(name).push({
                token: String(row.token),
                exchSeg: row.exch_seg,
                underlying: name,
                expiry: expirySql,
                lotSize: Number(row.lotsize) || null,
            });
        }
    }

    for (const [, list] of futures) {
        list.sort((a, b) => a.expiry.localeCompare(b.expiry));
    }

    workerLogger.info(`Scrip master: indexed ${options.size} option underlyings and ${spotTokens.size} spot tokens`);
    parsed = { loadedAt: Date.now(), options, futures, spotTokens, lotSizeByUnderlying };
    return parsed;
}

/**
 * Lot size for ANY NSE/BSE F&O underlying (index or stock), from the scrip
 * master alone — works regardless of whether the live worker has ever
 * subscribed this symbol. Returns null only if the underlying has no F&O
 * contracts in the current scrip master at all.
 */
async function getLotSize(underlying) {
    const { lotSizeByUnderlying } = await ensureLoaded();
    return lotSizeByUnderlying.get((underlying || "").toUpperCase()) || null;
}

/** All expiries (sorted 'YYYY-MM-DD' strings) on/after today for an underlying. */
async function getExpiries(underlying) {
    const { options } = await ensureLoaded();
    const today = todayIst();
    const set = new Set();
    for (const c of options.get((underlying || "").toUpperCase()) || []) {
        if (c.expiry >= today) set.add(c.expiry);
    }
    return [...set].sort();
}

/**
 * Option contracts for one underlying+expiry, optionally trimmed to N strikes
 * either side of a center price (used to keep WS subscriptions within Angel
 * One's per-connection token quota).
 */
async function getOptionContracts(underlying, expirySql, { centerPrice = null, strikesPerSide = null } = {}) {
    const { options } = await ensureLoaded();
    let contracts = (options.get((underlying || "").toUpperCase()) || []).filter((c) => c.expiry === expirySql);

    if (centerPrice != null && strikesPerSide != null && strikesPerSide > 0) {
        const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
        const atmIdx = strikes.reduce(
            (best, s, i) => (Math.abs(s - centerPrice) < Math.abs(strikes[best] - centerPrice) ? i : best),
            0
        );
        const keep = new Set(strikes.slice(Math.max(0, atmIdx - strikesPerSide), atmIdx + strikesPerSide + 1));
        contracts = contracts.filter((c) => keep.has(c.strike));
    }

    return contracts.sort((a, b) => a.strike - b.strike || a.right.localeCompare(b.right));
}

function getIndexToken(underlying) {
    const entry = INDEX_TOKENS[(underlying || "").toUpperCase()];
    if (!entry) return null;
    return typeof entry === "object" ? entry.token : entry;
}

function getVixToken() {
    const entry = INDEX_TOKENS.INDIAVIX;
    return typeof entry === "object" ? entry.token : entry;
}

/**
 * Get spot instrument info { token, exch, exchSeg } for any index or stock.
 */
async function getSpotToken(underlying) {
    const { spotTokens } = await ensureLoaded();
    const sym = (underlying || "").toUpperCase();
    return spotTokens.get(sym) || INDEX_TOKENS[sym] || null;
}

async function hasOptions(underlying) {
    const { options } = await ensureLoaded();
    const list = options.get((underlying || "").toUpperCase());
    return Boolean(list && list.length > 0);
}

async function getAllSymbols() {
    const { options } = await ensureLoaded();
    return [...options.keys()].sort();
}

/** Nearest (front-month) future contract for an underlying, or null. */
async function getNearestFuture(underlying) {
    const { futures } = await ensureLoaded();
    const today = todayIst();
    const list = (futures.get((underlying || "").toUpperCase()) || []).filter((f) => f.expiry >= today);
    return list[0] || null;
}

module.exports = {
    ensureLoaded,
    getExpiries,
    getOptionContracts,
    getIndexToken,
    getVixToken,
    getSpotToken,
    hasOptions,
    getAllSymbols,
    getNearestFuture,
    getLotSize,
    expiryToSql,
    todayIst,
    INDEX_TOKENS,
};
