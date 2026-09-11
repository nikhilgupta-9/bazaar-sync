// kotak/instruments.js — Kotak Neo scrip (instrument) master.
//
// Downloads Kotak's per-segment CSV dumps (nse_cm, nse_fo, bse_cm, bse_fo),
// disk-caches them for the day, and resolves for ANY tradeable underlying
// (the 7 F&O indices + the ~210 F&O stocks + India VIX):
//   - spot token + segment       (nse_cm EQ / bse_cm / index rows)
//   - option contracts            (OPTIDX / OPTSTK)
//   - nearest future contract     (FUTIDX / FUTSTK)
//
// Date rule (CLAUDE.md Gotcha #12): expiries are produced as plain
// 'YYYY-MM-DD' strings via explicit UTC getters — never new Date(nonISOString)
// or local-timezone Date methods. (Kotak gives epoch seconds, so building a
// Date from that number and reading UTC parts is fine.)

const fs = require("fs");
const path = require("path");
const cfg = require("../config/kotak");
const { authHeaders } = require("./auth");
const { workerLogger } = require("../config/logger");

const CACHE_DIR = process.env.KOTAK_SCRIP_CACHE_DIR || path.join(__dirname, "..", "data");
const CACHE_MAX_AGE_MS = 20 * 60 * 60 * 1000; // daily, 20h to be safe
const DOWNLOAD_TIMEOUT_MS = 20000;

const SEGMENTS = [cfg.seg.NSE_CASH, cfg.seg.NSE_FNO, cfg.seg.BSE_CASH, cfg.seg.BSE_FNO];

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cells = lines[i].split(",");
        const row = {};
        for (let j = 0; j < headers.length; j++) row[headers[j]] = (cells[j] ?? "").trim();
        rows.push(row);
    }
    return rows;
}

// Column names in the transformed CSV. Fix HERE only if a real download differs.
const COL = {
    token: "pSymbol",
    exchSeg: "pExchSeg",
    symbolName: "pSymbolName", // "NIFTY", "RELIANCE", "INDIAVIX"
    tradingSym: "pTrdSymbol", // "RELIANCE-EQ", "NIFTY25SEP24000CE"
    group: "pGroup", // "EQ" for cash equity
    instType: "pInstType", // "OPTIDX" / "OPTSTK" / "FUTIDX" / "FUTSTK"
    optionType: "pOptionType", // "CE" / "PE" / "XX"
    strike: "dStrikePrice",
    strikeAlt: "dStrikePrice;", // seen in the SDK's own scrip_search
    expiry: "pExpiryDate", // epoch seconds (see epochToSql)
    lotSize: "lLotSize",
};

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function normName(s) {
    return (s || "").toUpperCase().replace(/\s+/g, "");
}

function epochToSql(rawSeconds) {
    const n = Number(rawSeconds);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date((n + cfg.scripEpochOffsetSec) * 1000);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function readStrike(row) {
    const raw = row[COL.strike] !== undefined && row[COL.strike] !== "" ? row[COL.strike] : row[COL.strikeAlt];
    const n = num(raw);
    return n != null ? n / 100 : null; // stored x100
}

function todayIst() {
    const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Download + cache
// ---------------------------------------------------------------------------

let filePathsCache = null;

async function fetchFilePaths() {
    if (filePathsCache) return filePathsCache;
    const res = await fetch(`${cfg.loginBase}${cfg.paths.scripMaster}`, {
        headers: await authHeaders(),
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`scrip-master file-paths HTTP ${res.status}`);
    const json = await res.json();
    const paths = json?.data?.filesPaths || json?.filesPaths || [];
    if (!paths.length) throw new Error(`no filesPaths in scrip-master response`);
    filePathsCache = paths;
    return paths;
}

async function loadSegmentCsv(segment) {
    const cacheFile = path.join(CACHE_DIR, `kotak_${segment}.csv`);
    if (fs.existsSync(cacheFile)) {
        const age = Date.now() - fs.statSync(cacheFile).mtimeMs;
        if (age < CACHE_MAX_AGE_MS) return fs.readFileSync(cacheFile, "utf8");
    }
    try {
        const paths = await fetchFilePaths();
        const url = paths.find((p) => p.toLowerCase().includes(`${segment}.csv`));
        if (!url) throw new Error(`no ${segment} file in scrip master`);
        const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`download ${segment} HTTP ${res.status}`);
        const text = await res.text();
        if (!text.includes(",")) throw new Error(`${segment} response is not CSV`);
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(cacheFile, text);
        workerLogger.info(`[kotak] scrip master ${segment} cached (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
        return text;
    } catch (err) {
        if (fs.existsSync(cacheFile)) {
            workerLogger.warn(`[kotak] ${segment} download failed (${err.message}) — using stale disk cache`);
            return fs.readFileSync(cacheFile, "utf8");
        }
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

let parsed = null;
// {
//   loadedAt,
//   spot: Map<symbol, {token, seg}>,   // indices + stocks
//   vixToken,
//   options: Map<symbol, contract[]>,  // contract: {token, seg, right, strike, expiry, lotSize, tradingSymbol}
//   futures: Map<symbol, contract[]>,
//   stockList: string[],
// }

// scrip-master F&O row -> our symbol key (index key, or the stock symbol), or null
function fnoSymbolKey(name) {
    const n = normName(name);
    const idxKey = Object.keys(cfg.indices).find((k) => normName(cfg.indices[k].fnoName) === n);
    if (idxKey) return idxKey;
    // stocks: the symbol name itself is the key
    return n || null;
}

async function ensureLoaded({ force = false } = {}) {
    if (parsed && !force && Date.now() - parsed.loadedAt < CACHE_MAX_AGE_MS) return parsed;

    const texts = await Promise.all(SEGMENTS.map((s) => loadSegmentCsv(s).catch((e) => {
        workerLogger.warn(`[kotak] segment ${s} unavailable: ${e.message}`);
        return "";
    })));
    const bySeg = {};
    SEGMENTS.forEach((s, i) => (bySeg[s] = texts[i] ? parseCsv(texts[i]) : []));

    const spot = new Map();
    let vixToken = null;
    const options = new Map();
    const futures = new Map();

    // index name -> our key (for cash-segment spot matching)
    const idxNameToKey = new Map();
    for (const [k, m] of Object.entries(cfg.indices)) idxNameToKey.set(normName(m.indexName), k);
    const vixWants = new Set(cfg.vixNameCandidates.map(normName));

    // --- cash segments: index spot tokens, stock EQ tokens, VIX ---
    for (const seg of [cfg.seg.NSE_CASH, cfg.seg.BSE_CASH]) {
        for (const r of bySeg[seg] || []) {
            const a = normName(r[COL.symbolName]);
            const b = normName(r[COL.tradingSym]);
            const group = (r[COL.group] || "").toUpperCase();

            if (idxNameToKey.has(a) && !spot.has(idxNameToKey.get(a))) {
                spot.set(idxNameToKey.get(a), { token: String(r[COL.token]), seg });
            } else if (idxNameToKey.has(b) && !spot.has(idxNameToKey.get(b))) {
                spot.set(idxNameToKey.get(b), { token: String(r[COL.token]), seg });
            }
            if (!vixToken && (vixWants.has(a) || vixWants.has(b))) vixToken = String(r[COL.token]);

            // stock equity: prefer the "-EQ" trading symbol / EQ group on NSE
            if (seg === cfg.seg.NSE_CASH && group === "EQ" && a && !spot.has(a)) {
                spot.set(a, { token: String(r[COL.token]), seg });
            }
        }
    }

    // --- F&O segments: OPTIDX/OPTSTK + FUTIDX/FUTSTK ---
    for (const seg of [cfg.seg.NSE_FNO, cfg.seg.BSE_FNO]) {
        for (const r of bySeg[seg] || []) {
            const key = fnoSymbolKey(r[COL.symbolName]);
            if (!key) continue;
            const instType = (r[COL.instType] || "").toUpperCase();
            const optType = (r[COL.optionType] || "").toUpperCase();
            const expiry = epochToSql(r[COL.expiry]);
            if (!expiry) continue;

            if (instType === "OPTIDX" || instType === "OPTSTK" || optType === "CE" || optType === "PE") {
                const strike = readStrike(r);
                if (!strike || !["CE", "PE"].includes(optType)) continue;
                if (!options.has(key)) options.set(key, []);
                options.get(key).push({
                    token: String(r[COL.token]),
                    seg,
                    tradingSymbol: r[COL.tradingSym] || null,
                    underlying: key,
                    right: optType,
                    strike,
                    expiry,
                    lotSize: num(r[COL.lotSize]),
                });
            } else if (instType === "FUTIDX" || instType === "FUTSTK") {
                if (!futures.has(key)) futures.set(key, []);
                futures.get(key).push({
                    token: String(r[COL.token]),
                    seg,
                    tradingSymbol: r[COL.tradingSym] || null,
                    underlying: key,
                    expiry,
                    lotSize: num(r[COL.lotSize]),
                });
            }
        }
    }

    for (const [, list] of futures) list.sort((a, b) => a.expiry.localeCompare(b.expiry));

    // stock list = every options key that isn't one of the 7 indices
    const stockList = [...options.keys()].filter((k) => !cfg.indices[k]).sort();

    workerLogger.info(
        `[kotak] scrip master: ${Object.keys(cfg.indices).filter((k) => options.has(k)).length}/7 indices, ${stockList.length} F&O stocks, VIX ${vixToken ? "ok" : "MISSING"}`
    );

    parsed = { loadedAt: Date.now(), spot, vixToken, options, futures, stockList };
    return parsed;
}

// ---------------------------------------------------------------------------
// Public lookups
// ---------------------------------------------------------------------------

function isIndex(symbol) {
    return Boolean(cfg.indices[symbol.toUpperCase()]);
}

/** { token, seg } for an underlying's spot, or null. */
async function getSpot(symbol) {
    const { spot } = await ensureLoaded();
    return spot.get(symbol.toUpperCase()) || null;
}

async function getVixToken() {
    const { vixToken } = await ensureLoaded();
    return vixToken;
}

/** Every F&O stock symbol (respects cfg.stocks include/exclude). */
async function listStocks() {
    const { stockList } = await ensureLoaded();
    const inc = cfg.stocks.include;
    let list = stockList;
    if (Array.isArray(inc)) list = list.filter((s) => inc.map((x) => x.toUpperCase()).includes(s));
    else if (typeof inc === "string" && inc !== "auto") {
        const set = new Set(inc.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
        list = list.filter((s) => set.has(s));
    }
    return list.filter((s) => !cfg.stocks.exclude.includes(s));
}

/** All 7 index symbols that actually have contracts in the current master. */
async function listIndices() {
    const { options } = await ensureLoaded();
    return Object.keys(cfg.indices).filter((k) => options.has(k));
}

/** Future expiries (sorted 'YYYY-MM-DD') on/after today for an underlying. */
async function getExpiries(symbol) {
    const { options } = await ensureLoaded();
    const today = todayIst();
    const set = new Set();
    for (const c of options.get(symbol.toUpperCase()) || []) if (c.expiry >= today) set.add(c.expiry);
    return [...set].sort();
}

/**
 * Option contracts for symbol+expiry, optionally trimmed to N strikes either
 * side of a center price. Returns { contracts, atm } — atm is the listed
 * strike closest to centerPrice (works for indices and stocks alike, no
 * strike-step assumption).
 */
async function getOptionContracts(symbol, expirySql, { centerPrice = null, strikesPerSide = null } = {}) {
    const { options } = await ensureLoaded();
    let contracts = (options.get(symbol.toUpperCase()) || []).filter((c) => c.expiry === expirySql);
    const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
    let atm = null;

    if (strikes.length && centerPrice != null) {
        atm = strikes[0];
        for (const s of strikes) if (Math.abs(s - centerPrice) < Math.abs(atm - centerPrice)) atm = s;

        if (strikesPerSide != null) {
            const atmIdx = strikes.indexOf(atm);
            const keep = new Set(strikes.slice(Math.max(0, atmIdx - strikesPerSide), atmIdx + strikesPerSide + 1));
            contracts = contracts.filter((c) => keep.has(c.strike));
        }
    }
    contracts.sort((a, b) => a.strike - b.strike || a.right.localeCompare(b.right));
    return { contracts, atm };
}

/** Nearest (front-month) future contract for an underlying, or null. */
async function getNearestFuture(symbol) {
    const { futures } = await ensureLoaded();
    const today = todayIst();
    const list = (futures.get(symbol.toUpperCase()) || []).filter((f) => f.expiry >= today);
    return list[0] || null;
}

module.exports = {
    ensureLoaded,
    isIndex,
    getSpot,
    getVixToken,
    listStocks,
    listIndices,
    getExpiries,
    getOptionContracts,
    getNearestFuture,
    todayIst,
};
