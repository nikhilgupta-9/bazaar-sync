// config/universe.js — the symbol universe the year orchestrator walks:
// the 7 index underlyings + every F&O-eligible stock.
//
// Indices are a fixed list (their Upstox instrument keys live in
// services/upstoxHistorical.js UNDERLYING_KEYS, env-overridable).
//
// The stock list is NOT hardcoded — it's derived at runtime from Angel One's
// public scrip master (services/instrumentMaster.js already downloads and
// parses it, no credentials needed): every NFO underlying with OPTSTK/FUTSTK
// contracts. That keeps the list current as NSE adds/drops F&O names, and is
// ~180-220 symbols on any given day ("210 stocks" in round terms).
//
// Override the whole universe with a plain text file (one symbol per line, #
// comments allowed) via UNIVERSE_FILE=/path/to/symbols.txt if you ever need
// an exact fixed list instead.

const fs = require("fs");
const instrumentMaster = require("../services/instrumentMaster");

// NSE: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50.  BSE: SENSEX, BANKEX.
const INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];

function readUniverseFile(filePath) {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    return lines
        .map((l) => l.replace(/#.*$/, "").trim().toUpperCase())
        .filter(Boolean);
}

/** All F&O stock underlyings (indices removed), sorted, from the Angel scrip master. */
async function getStockUniverse() {
    const { lotSizeByUnderlying } = await instrumentMaster.ensureLoaded();
    const idx = new Set(INDICES);
    return [...lotSizeByUnderlying.keys()]
        .filter((s) => s && !idx.has(s))
        .sort();
}

/**
 * { indices: [...7], stocks: [...~210], all: [indices then stocks] }.
 * If UNIVERSE_FILE is set, `all` is exactly that file's list (in file order)
 * and indices/stocks are split out of it by membership in INDICES.
 */
async function getFullUniverse() {
    if (process.env.UNIVERSE_FILE) {
        const all = readUniverseFile(process.env.UNIVERSE_FILE);
        const idx = new Set(INDICES);
        return {
            indices: all.filter((s) => idx.has(s)),
            stocks: all.filter((s) => !idx.has(s)),
            all,
            source: `file:${process.env.UNIVERSE_FILE}`,
        };
    }
    const stocks = await getStockUniverse();
    return { indices: [...INDICES], stocks, all: [...INDICES, ...stocks], source: "angel-scrip-master" };
}

module.exports = { INDICES, getStockUniverse, getFullUniverse };
