// services/bseBhavcopy.js — BSE's free daily F&O "Bhavcopy" archive. Same
// role as services/nseBhavcopy.js but for the BSE side — the ONLY reason
// this exists is SENSEX and BANKEX, which trade on BSE and can NEVER appear
// in an NSE bhavcopy file (see NSE_INDEX_SYMBOLS comment in nseBhavcopy.js,
// and the "Files" table in CLAUDE.md's Phase 7 section). Whatever other
// BSE-listed F&O stocks show up in the same file are stored too (no reason
// not to), but SENSEX/BANKEX is the actual goal here.
//
// *** UNVERIFIED — READ BEFORE RUNNING ***
// bseindia.com is not reachable from the sandbox this was written in (same
// situation nseBhavcopy.js was in before its first real run). What IS
// confirmed: a real, working example filename surfaced via web search
// (2026-07-20) —
//   https://www.bseindia.com/download/Bhavcopy/Derivative/BhavCopy_BSE_FO_0_0_0_20241206_F_0000.CSV
// — which matches NSE's post-2024-07-08 "UDiFF" (Unified Distilled File
// Format) naming convention almost exactly (`BhavCopy_{EXCH}_FO_0_0_0_{yyyymmdd}_F_0000`),
// just NSE_FO -> BSE_FO and no .zip (BSE serves this one as a plain CSV, not
// zipped — one less step than NSE). UDiFF is a SEBI-mandated unified format
// adopted across exchanges around the same time, so it's likely — NOT
// confirmed — that BSE's column names are identical to NSE's UDiFF columns
// (TckrSymb, XpryDt, StrkPric, OptnTp, ClsPric, OpnIntrst, TtlTradgVol,
// UndrlygPric). FIELD_CANDIDATES below is seeded with those same names for
// that reason. Parsing is defensive either way: reads the actual header at
// runtime, throws with the real headers on a mismatch. Run
// scripts/testBseBhavcopy.js on one real date before trusting a backfill.
//
// No UDiFF-cutover date handling here (unlike nseBhavcopy.js) — BSE's F&O
// bhavcopy history before this format existed is a separate unknown, not
// investigated. If old dates 404, that's the first thing to check.

const fs = require("fs");
const path = require("path");
const { dbLogger } = require("../config/logger");

const BASE_URL = process.env.BSE_BHAVCOPY_BASE_URL || "https://www.bseindia.com/download/Bhavcopy/Derivative";
const CACHE_DIR = process.env.BSE_BHAVCOPY_CACHE_DIR || path.join(__dirname, "..", "data", "bse-bhavcopy");

// Same rationale as nseBhavcopy.js's FETCH_HEADERS — a browser-like
// User-Agent to avoid a bare-bones-client block.
const FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
};

const FETCH_TIMEOUT_MS = Number(process.env.BSE_BHAVCOPY_FETCH_TIMEOUT_MS || 25_000);
async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err.name === "AbortError") throw new Error(`request timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`);
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD' (plain string manipulation, no Date parsing — CLAUDE.md Gotcha #12). */
function toCompactDate(dateStr) {
    return dateStr.replace(/-/g, "");
}

function buildBseBhavcopyUrl(dateStr) {
    return `${BASE_URL}/BhavCopy_BSE_FO_0_0_0_${toCompactDate(dateStr)}_F_0000.CSV`;
}

/** Downloads (and disk-caches) one day's raw CSV text — no unzip step, BSE serves this one uncompressed. */
async function downloadCsv(dateStr) {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const csvPath = path.join(CACHE_DIR, `bse_fo_${toCompactDate(dateStr)}.csv`);
    if (fs.existsSync(csvPath)) return fs.readFileSync(csvPath, "utf8");

    const url = buildBseBhavcopyUrl(dateStr);
    dbLogger.info(`[bse-bhavcopy] downloading ${url}`);
    const res = await fetchWithTimeout(url, { headers: FETCH_HEADERS });
    if (!res.ok) throw new Error(`bse-bhavcopy download HTTP ${res.status} for ${dateStr} (holiday/weekend, or BSE changed the URL — see file header)`);
    const text = await res.text();
    fs.writeFileSync(csvPath, text);
    return text;
}

// Same field-name candidates as nseBhavcopy.js's UDiFF columns, plus the
// classic BSE derivatives-report names as a fallback in case BSE's version
// diverges from NSE's UDiFF naming after all — see file header for why both
// are plausible right now.
const FIELD_CANDIDATES = {
    symbol: ["TckrSymb", "SC_NAME", "SYMBOL"],
    instrumentType: ["FinInstrmTp", "INSTRUMENT"],
    expiry: ["XpryDt", "EXPIRY_DT"],
    strike: ["StrkPric", "STRIKE_PR"],
    optionType: ["OptnTp", "OPTION_TYP"],
    close: ["ClsPric", "CLOSE"],
    openInterest: ["OpnIntrst", "OPEN_INT"],
    volume: ["TtlTradgVol", "NO_OF_CONTRACTS", "CONTRACTS"],
    underlyingPrice: ["UndrlygPric", "UNDRLYG_PRIC"],
};

function buildColumnMap(headerLine) {
    const headers = headerLine.split(",").map((h) => h.trim().replace(/^"(.*)"$/, "$1"));
    const lower = headers.map((h) => h.toLowerCase());
    const map = {};
    const missing = [];
    const OPTIONAL_FIELDS = new Set(["instrumentType", "underlyingPrice"]);
    for (const [field, candidates] of Object.entries(FIELD_CANDIDATES)) {
        const idx = candidates.map((c) => lower.indexOf(c.toLowerCase())).find((i) => i >= 0);
        if (idx === undefined) {
            if (!OPTIONAL_FIELDS.has(field)) missing.push(field);
        } else {
            map[field] = idx;
        }
    }
    if (missing.length) {
        throw new Error(
            `BSE bhavcopy CSV is missing expected columns [${missing.join(", ")}]. ` +
                `Actual headers found: ${headers.join(" | ")}. ` +
                `Update FIELD_CANDIDATES in services/bseBhavcopy.js to match.`
        );
    }
    return map;
}

function splitCsvLine(line) {
    return line.split(",").map((v) => v.trim().replace(/^"(.*)"$/, "$1"));
}

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** Handles both '31-JUL-2026' and '2026-07-31'-style expiry strings, no Date() parsing (Gotcha #12). */
function normalizeExpiry(raw) {
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (m) {
        const mon = MONTHS[m[2].toUpperCase()];
        if (mon) return `${m[3]}-${mon}-${m[1]}`;
    }
    return null;
}

/** Parses ONE day's BSE bhavcopy and returns every CE/PE row for every symbol found (SENSEX/BANKEX + any BSE F&O stocks). */
async function getDayAllRows(dateStr) {
    const csv = await downloadCsv(dateStr);
    const lines = csv.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];

    const col = buildColumnMap(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = splitCsvLine(lines[i]);
        if (cells.length < 5) continue;
        const optType = cells[col.optionType];
        if (optType !== "CE" && optType !== "PE") continue; // skip futures rows

        const expiry = normalizeExpiry(cells[col.expiry]);
        if (!expiry) continue;

        rows.push({
            symbol: cells[col.symbol],
            expiry,
            strike: Number(cells[col.strike]),
            right: optType,
            close: Number(cells[col.close]) || null,
            oi: Number(cells[col.openInterest]) || 0,
            volume: Number(cells[col.volume]) || 0,
            underlyingPrice: col.underlyingPrice !== undefined ? Number(cells[col.underlyingPrice]) || null : null,
        });
    }
    return rows;
}

/** Same as getDayAllRows but pre-grouped: Map<symbol, rows[]>. */
async function getDayRowsBySymbol(dateStr) {
    const all = await getDayAllRows(dateStr);
    const bySymbol = new Map();
    for (const r of all) {
        if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
        bySymbol.get(r.symbol).push(r);
    }
    return bySymbol;
}

// The actual reason this file exists — everything else (any BSE-listed F&O
// stocks in the same file) is a bonus, stored too, but not the goal.
const BSE_INDEX_SYMBOLS = new Set(["SENSEX", "BANKEX"]);

module.exports = {
    downloadCsv,
    getDayAllRows,
    getDayRowsBySymbol,
    toCompactDate,
    normalizeExpiry,
    buildBseBhavcopyUrl,
    BSE_INDEX_SYMBOLS,
};
