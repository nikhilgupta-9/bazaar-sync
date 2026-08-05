// breeze-historical/symbolMap.js — resolves our NSE-style symbols (as stored
// in option_chain_history, sourced from Bhavcopy/Angel One/Upstox) to
// ICICI's own internal isec_stock_code, which is what Breeze's
// getHistoricalDatav2 actually expects as `stockCode` for NFO contracts.
//
// Confirmed necessary from a real run (2026-08-05): backfillBreezeAll.js
// against 221 real symbols returned "0 rows stored, 0 failed" (Breeze
// returns an empty Success array, NOT an error) for symbols whose NSE
// trading symbol doesn't match ICICI's own code (e.g. 360ONE, ABCAPITAL),
// while symbols that happen to coincide (e.g. ABB) worked with no mapping
// at all. Silent + no error is what makes this dangerous — without this
// fix, most of the ~210 stocks would burn Breeze's daily call budget for
// weeks and quietly store nothing.
//
// Source: the same NSE scrip master file breezeconnect's own getNames()
// helper downloads live on every single call (breezeConnect.js:1911) — column
// layout reverse-engineered from that function's own indexing: column 1 =
// isec_stock_code, column 60 = the NSE trading symbol we already use
// everywhere else in this project. Downloaded and disk-cached here ONCE
// instead of paying that per-call download cost for every one of 210+
// symbols the way breezeconnect's own helper would.
//
// Indices are NOT in this cash-equity scrip master and don't go through it:
// NIFTY already matches ICICI's own code as-is (confirmed working in the
// same 2026-08-05 run). BANKNIFTY -> "CNXBAN" and FINNIFTY -> "NIFFIN" are
// widely referenced in the Breeze developer community but were never
// independently confirmed against a real response in this codebase — same
// "unverified, env-overridable" treatment as instrumentMaster.js's
// INDEX_TOKENS. If either 404s/empties here the same way stocks did before
// this fix, check the override env var first.

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const NSE_SCRIP_MASTER_URL = "https://traderweb.icicidirect.com/Content/File/txtFile/ScripFile/NSEScripMaster.txt";
const CACHE_PATH = path.join(__dirname, "../data/breeze-nse-scrip-master.json");
const CACHE_MAX_AGE_MS = 20 * 60 * 60 * 1000; // 20h, same refresh cadence as instrumentMaster.js

// Confirmed 2026-08-06: this traderweb.icicidirect.com domain hits the same
// TLS issue breezeconnect's own require() already papers over process-wide
// for api.icicidirect.com (see CLAUDE.md's Phase 7 gotcha — "breezeconnect's
// own require() sets NODE_TLS_REJECT_UNAUTHORIZED=0 for the whole Node
// process"). In the real backfill flow that's already set by the time this
// file's fetch runs (auth.js requires breezeconnect first), but
// testSymbolMap.js never touches breezeconnect at all and hit a real "fetch
// failed" here as a result — set it explicitly so this module doesn't
// silently depend on some other file's require order. Same accepted-risk
// scope as the rest of breeze-historical/: one-off CLI scripts only, never
// required from Express/the market worker/anything long-lived.
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// UNVERIFIED against a real response — see header comment above.
const INDEX_OVERRIDES = {
    NIFTY: process.env.BREEZE_STOCKCODE_NIFTY || "NIFTY",
    BANKNIFTY: process.env.BREEZE_STOCKCODE_BANKNIFTY || "CNXBAN",
    FINNIFTY: process.env.BREEZE_STOCKCODE_FINNIFTY || "NIFFIN",
};

let cache = null; // Map<nseSymbol, isecStockCode>
let loadPromise = null;

function stripQuotes(v) {
    const m = (v || "").match(/(?:"[^"]*"|^[^"]*$)/);
    return (m ? m[0] : v || "").replace(/"/g, "").trim();
}

function parseScripMaster(csvText) {
    const map = new Map();
    const lines = csvText.split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        const cols = lines[i].split(",");
        if (cols.length < 61) continue;
        const isecCode = stripQuotes(cols[1]);
        const nseSymbol = stripQuotes(cols[60]);
        if (nseSymbol && isecCode) map.set(nseSymbol, isecCode);
    }
    return map;
}

async function ensureLoaded() {
    if (cache) return cache;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const stat = fs.existsSync(CACHE_PATH) ? fs.statSync(CACHE_PATH) : null;
            if (stat && Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
                cache = new Map(JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")));
                console.log(`[breeze-symbolmap] loaded ${cache.size} NSE->ISEC mappings from disk cache`);
                return cache;
            }

            console.log("[breeze-symbolmap] downloading NSE scrip master from ICICI...");
            // Native fetch (undici) hit a real ECONNRESET against this exact
            // domain (confirmed 2026-08-06) — breezeconnect's own getNames()
            // downloads the same file successfully via axios, so use that
            // instead of chasing undici-specific TLS/keep-alive behavior.
            // transformResponse: bypass axios's default JSON-parse attempt so
            // res.data is always the raw CSV string, whatever the content-type.
            const res = await axios.get(NSE_SCRIP_MASTER_URL, { transformResponse: (d) => d });
            cache = parseScripMaster(res.data);
            if (!cache.size) throw new Error("parsed 0 rows from NSE scrip master — column layout may have changed, check stripQuotes/column indices");

            fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
            fs.writeFileSync(CACHE_PATH, JSON.stringify([...cache.entries()]));
            console.log(`[breeze-symbolmap] parsed and cached ${cache.size} NSE->ISEC mappings`);
            return cache;
        } catch (err) {
            // axios error shapes: err.response = server replied with an error
            // status; err.request (no .response) = request went out but got no
            // response (timeout/reset/etc.); neither = something else (e.g. our
            // own "parsed 0 rows" Error above).
            const detail = err.response
                ? ` (HTTP ${err.response.status})`
                : err.code
                ? ` (${err.code})`
                : "";
            console.error(`[breeze-symbolmap] failed to load NSE scrip master: ${err.message}${detail} — falling back to identity mapping (symbols will be sent unchanged, same broken behavior as before this fix)`);
            cache = new Map();
            return cache;
        }
    })();

    return loadPromise;
}

/**
 * Resolves our NSE-style symbol to the isec_stock_code Breeze's
 * getHistoricalDatav2 actually expects. Falls back to the symbol unchanged
 * if not found in the scrip master (logs a warning rather than silently
 * guessing) — matches this project's existing convention of never quietly
 * swallowing an unmapped case (see instrumentMaster.js).
 */
async function resolveStockCode(symbol) {
    if (INDEX_OVERRIDES[symbol]) return INDEX_OVERRIDES[symbol];
    const map = await ensureLoaded();
    const isec = map.get(symbol);
    if (!isec) {
        console.warn(`[breeze-symbolmap] no ISEC stock code found for "${symbol}" — falling back to using the NSE symbol as-is, Breeze will likely return 0 rows for it`);
        return symbol;
    }
    return isec;
}

module.exports = { resolveStockCode, INDEX_OVERRIDES };
