// dhan/instrumentMaster.js — security-ID resolution for Dhan API calls.
//
// INDEX_SECURITY_IDS below are NOT guessed — every one was confirmed for
// real (2026-09-14) by pulling actual Jan-2023 daily candles from
// /charts/historical with exchangeSegment="IDX_I", instrument="INDEX" and
// checking the numbers landed in the real historical range for that index
// (NIFTY ~18000s, SENSEX ~61000s, BANKEX ~49000s, India VIX ~14-19, etc.).
// Same "verify against one real response before trusting it" rule this
// codebase's CLAUDE.md Gotcha #13 already learned the hard way from Angel
// One's deprecated index tokens. IDs also cross-checked against Dhan's own
// published scrip-master CSV (INSTRUMENT=INDEX rows) — both sources agree.
//
// Equity (stock) securityId is NOT hardcoded — looked up from Dhan's own
// public scrip-master CSV per symbol, same pattern as upstox/instrumentMaster.js.
const IDX_I = "IDX_I"; // confirmed to work for BOTH NSE-listed (NIFTY family) and BSE-listed (SENSEX/BANKEX) indices — Dhan doesn't split exchangeSegment by exchange for INDEX instrument.

const INDEX_SECURITY_IDS = {
    NIFTY: "13",
    BANKNIFTY: "25",
    FINNIFTY: "27",
    MIDCPNIFTY: "442",
    NIFTYNXT50: "38",
    SENSEX: "51",
    BANKEX: "69",
    INDIAVIX: "21",
};

// Which of the 7 indices are OPTIDX-tradable underlyings (all of them except
// NIFTYNXT50, which per NSE has no options contract as of this writing — kept
// here as a single source of truth rather than duplicated per caller).
const OPTION_UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];
const ALL_INDEX_SYMBOLS = Object.keys(INDEX_SECURITY_IDS).filter((s) => s !== "INDIAVIX");

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const MASTER_URL = process.env.DHAN_SCRIP_MASTER_URL || "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";
const CACHE_PATH = path.join(__dirname, "..", "data", "dhan-scrip-master-detailed.csv");
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function downloadMaster({ force = false } = {}) {
    if (!force && fs.existsSync(CACHE_PATH)) {
        const age = Date.now() - fs.statSync(CACHE_PATH).mtimeMs;
        if (age < CACHE_MAX_AGE_MS) return CACHE_PATH;
    }
    const res = await axios.get(MASTER_URL, { responseType: "text", timeout: 60000 });
    const dataDir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, res.data);
    return CACHE_PATH;
}

// Confirmed unquoted, plain comma-separated (2026-09-14 real download) — no
// quoted fields seen in EXCH_ID/SEGMENT/INSTRUMENT/SECURITY_ID/UNDERLYING_SYMBOL.
function parseCsvLine(line) {
    return line.split(",");
}

let cache = null; // { builtFrom, header:{...idx}, rows: string[][] }

async function ensureLoaded({ force = false } = {}) {
    const csvPath = await downloadMaster({ force });
    if (cache && cache.builtFrom === csvPath && !force) return cache;

    const text = fs.readFileSync(csvPath, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length);
    if (!lines.length) throw new Error("Dhan scrip master CSV is empty");

    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const col = {};
    for (const name of ["EXCH_ID", "SEGMENT", "SECURITY_ID", "INSTRUMENT", "UNDERLYING_SYMBOL", "SYMBOL_NAME", "INSTRUMENT_TYPE", "SM_EXPIRY_DATE", "LOT_SIZE"]) {
        col[name] = header.indexOf(name);
    }
    if (col.SECURITY_ID === -1 || col.INSTRUMENT === -1 || col.UNDERLYING_SYMBOL === -1) {
        throw new Error(`Dhan scrip master CSV header missing expected columns. Actual header: ${header.join(", ")}`);
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        if (cells.length < header.length) continue;
        rows.push(cells);
    }

    cache = { builtFrom: csvPath, col, rows };
    return cache;
}

/** Resolve a plain NSE trading symbol ("RELIANCE") to its Dhan EQUITY securityId, or null. */
async function resolveEquitySecurityId(symbol) {
    const { col, rows } = await ensureLoaded();
    const target = symbol.toUpperCase();
    const row = rows.find(
        (r) => r[col.INSTRUMENT] === "EQUITY" && r[col.EXCH_ID] === "NSE" && r[col.UNDERLYING_SYMBOL]?.toUpperCase() === target
    );
    return row ? row[col.SECURITY_ID] : null;
}

/** Every stock symbol currently listed with F&O (OPTSTK) contracts, per Dhan's own master — used to build the ~210-stock universe. */
async function listFnoStockSymbols() {
    const { col, rows } = await ensureLoaded();
    const set = new Set();
    for (const r of rows) {
        if (r[col.INSTRUMENT] === "OPTSTK" && r[col.UNDERLYING_SYMBOL]) set.add(r[col.UNDERLYING_SYMBOL].toUpperCase());
    }
    return [...set].sort();
}

/** Any ONE currently-listed FUTIDX/FUTSTK securityId for an underlying — confirmed (2026-09-14) that /charts/historical returns the SAME continuous rolling series regardless of which live contract's securityId is passed, so "any" is fine, nearest-expiry preferred for freshness. */
async function resolveAnyFutureSecurityId(symbol) {
    const { col, rows } = await ensureLoaded();
    const target = symbol.toUpperCase();
    const isIndex = Object.prototype.hasOwnProperty.call(INDEX_SECURITY_IDS, target) && target !== "INDIAVIX";
    const instrumentType = isIndex ? "FUTIDX" : "FUTSTK";
    const matches = rows.filter((r) => r[col.INSTRUMENT] === instrumentType && r[col.UNDERLYING_SYMBOL]?.toUpperCase() === target);
    if (!matches.length) return null;
    matches.sort((a, b) => (a[col.SM_EXPIRY_DATE] || "").localeCompare(b[col.SM_EXPIRY_DATE] || ""));
    return matches[0][col.SECURITY_ID];
}

/** { securityId, exchangeSegment, instrument } for the OPTIONS underlying of `symbol` — index or stock. */
async function resolveOptionUnderlying(symbol) {
    const target = symbol.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(INDEX_SECURITY_IDS, target) && target !== "INDIAVIX") {
        return { securityId: INDEX_SECURITY_IDS[target], instrument: "OPTIDX" };
    }
    const securityId = await resolveEquitySecurityId(target);
    if (!securityId) return null;
    return { securityId, instrument: "OPTSTK" };
}

module.exports = {
    INDEX_SECURITY_IDS,
    OPTION_UNDERLYINGS,
    ALL_INDEX_SYMBOLS,
    IDX_I,
    downloadMaster,
    ensureLoaded,
    resolveEquitySecurityId,
    listFnoStockSymbols,
    resolveAnyFutureSecurityId,
    resolveOptionUnderlying,
    CACHE_PATH,
};
