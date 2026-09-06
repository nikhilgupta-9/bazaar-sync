// breeze-historical/symbolMap.js — resolves our NSE-style symbols (as stored
// in option_chain_history, sourced from Bhavcopy/Angel One/Upstox) to
// ICICI's own internal isec_stock_code, which is what Breeze's
// getHistoricalDatav2 actually expects as `stockCode` for NFO contracts.
//
// Confirmed necessary from a real run (2026-08-05): backfillBreezeAll.js
// against 221 real symbols returned "0 rows stored, 0 failed" (Breeze
// returns an empty Success array, NOT an error) for symbols whose NSE
// trading symbol doesn't match ICICI's own code (e.g. 360ONE -> IIFWEA,
// ABCAPITAL -> ADICAP, RELIANCE -> RELIND — confirmed against a real
// scrip master), while symbols that happen to coincide (e.g. ABB, TCS)
// worked with no mapping at all. Silent + no error is what makes this
// dangerous — without this fix, most of the ~210 stocks would burn
// Breeze's daily call budget for weeks and quietly store nothing.
//
// Source + column layout: the same NSE scrip master file breezeconnect's
// own getNames() helper downloads live on every call (breezeConnect.js:1911)
// — column 1 = ShortName (isec_stock_code), column 60 = ExchangeCode (the
// NSE trading symbol we already use everywhere else in this project).
// Verified against a REAL downloaded copy on 2026-08-06 (5,632 rows parsed,
// spot-checked against known symbols) — this part of the design is now
// confirmed correct, not just inferred from breezeconnect's source.
//
// *** Automated download of this file is BLOCKED ***: confirmed 2026-08-06
// that traderweb.icicidirect.com/.../NSEScripMaster.txt resets the TCP
// connection for ANY scripted client — reproduced with native fetch, axios
// (with browser User-Agent headers), AND plain `curl` from a real Mac
// terminal (TLS handshake completes fine, connection resets right after the
// GET is sent). This is not fixable from our code — some WAF/anti-bot layer
// on ICICI's side is blocking non-browser access to this specific host.
// A real browser (or curl against the alternate MotherAppMaster host, see
// LOCAL_FALLBACK_HELP below) can still fetch it — this module tries the live
// download first (in case the block is inconsistent/IP-based and doesn't
// apply everywhere, e.g. a production server on a different IP/network),
// and falls back to a manually-placed local file if that fails. Same shape
// of manual step as Breeze's own daily session paste — occasional, not
// something that needs to run unattended.
//
// Indices are NOT in this cash-equity scrip master and don't go through
// either path: NIFTY already matches ICICI's own code as-is (confirmed
// working in the 2026-08-05 run). BANKNIFTY -> "CNXBAN" and FINNIFTY ->
// "NIFFIN" are widely referenced in the Breeze developer community but were
// never independently confirmed against a real response in this codebase —
// same "unverified, env-overridable" treatment as instrumentMaster.js's
// INDEX_TOKENS.

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const NSE_SCRIP_MASTER_URL = "https://traderweb.icicidirect.com/Content/File/txtFile/ScripFile/NSEScripMaster.txt";
const CACHE_PATH = path.join(__dirname, "../data/breeze-nse-scrip-master.json");
const CACHE_MAX_AGE_MS = 20 * 60 * 60 * 1000; // 20h, same refresh cadence as instrumentMaster.js

// Where a manually-downloaded copy goes if the live download stays blocked.
// Get it via: open https://directlink.icicidirect.com/MotherAppMaster/SecurityMaster.zip
// in a real browser (confirmed working 2026-08-06 when the direct
// traderweb.icicidirect.com URL was not), extract NSEScripMaster.txt from
// the zip, and place it at this exact path.
const LOCAL_FALLBACK_PATH = path.join(__dirname, "../data/NSEScripMaster.txt");
const LOCAL_FALLBACK_HELP =
    `no live download and no local file at ${LOCAL_FALLBACK_PATH} — ` +
    `download https://directlink.icicidirect.com/MotherAppMaster/SecurityMaster.zip in a real browser, ` +
    `extract NSEScripMaster.txt from it, and place it at that path`;

// breezeconnect's own require() sets this process-wide for api.icicidirect.com
// (see CLAUDE.md's Phase 7 gotcha) — set it explicitly here too so this
// module doesn't depend on another file's require order (testSymbolMap.js
// never touches breezeconnect at all otherwise).
if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// UNVERIFIED against a real response — see header comment above.
const INDEX_OVERRIDES = {
    NIFTY: process.env.BREEZE_STOCKCODE_NIFTY || "NIFTY",
    BANKNIFTY: process.env.BREEZE_STOCKCODE_BANKNIFTY || "CNXBAN",
    FINNIFTY: process.env.BREEZE_STOCKCODE_FINNIFTY || "NIFFIN",
};

let cache = null; // Map<nseSymbol, isecStockCode>
let loadPromise = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A reset can be a one-off network hiccup, not just a hard block — retry a few times before giving up. */
async function withDownloadRetry(fn, attempts = 3) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i < attempts) {
                console.warn(`[breeze-symbolmap] download attempt ${i}/${attempts} failed (${err.code || err.message}), retrying...`);
                await sleep(1000 * i);
            }
        }
    }
    throw lastErr;
}

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

function writeDiskCache(map) {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify([...map.entries()]));
}

async function downloadLive() {
    console.log("[breeze-symbolmap] attempting live download of NSE scrip master from ICICI...");
    const res = await withDownloadRetry(() =>
        axios.get(NSE_SCRIP_MASTER_URL, {
            transformResponse: (d) => d,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                Accept: "text/plain,text/csv,*/*",
            },
        })
    );
    const map = parseScripMaster(res.data);
    if (!map.size) throw new Error("parsed 0 rows from downloaded scrip master — column layout may have changed");
    return map;
}

function loadLocalFallback() {
    if (!fs.existsSync(LOCAL_FALLBACK_PATH)) return null;
    const map = parseScripMaster(fs.readFileSync(LOCAL_FALLBACK_PATH, "utf8"));
    return map.size ? map : null;
}

async function ensureLoaded() {
    if (cache) return cache;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        const stat = fs.existsSync(CACHE_PATH) ? fs.statSync(CACHE_PATH) : null;
        if (stat && Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
            cache = new Map(JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")));
            console.log(`[breeze-symbolmap] loaded ${cache.size} NSE->ISEC mappings from disk cache`);
            return cache;
        }

        try {
            cache = await downloadLive();
            writeDiskCache(cache);
            console.log(`[breeze-symbolmap] downloaded and cached ${cache.size} NSE->ISEC mappings`);
            return cache;
        } catch (err) {
            const detail = err.response ? ` (HTTP ${err.response.status})` : err.code ? ` (${err.code})` : "";
            console.warn(`[breeze-symbolmap] live download failed: ${err.message}${detail} — trying local fallback file`);
        }

        const local = loadLocalFallback();
        if (local) {
            cache = local;
            writeDiskCache(cache);
            console.log(`[breeze-symbolmap] loaded ${cache.size} NSE->ISEC mappings from local fallback file (${LOCAL_FALLBACK_PATH})`);
            return cache;
        }

        console.error(`[breeze-symbolmap] ${LOCAL_FALLBACK_HELP} — falling back to identity mapping (symbols sent unchanged, most stocks will store 0 rows)`);
        cache = new Map();
        return cache;
    })();

    return loadPromise;
}

/**
 * Resolves our NSE-style symbol to the isec_stock_code Breeze's
 * getHistoricalDatav2 actually expects. Falls back to the symbol unchanged
 * if not found anywhere (logs a warning rather than silently guessing) —
 * matches this project's existing convention of never quietly swallowing an
 * unmapped case (see instrumentMaster.js).
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

module.exports = { resolveStockCode, INDEX_OVERRIDES, LOCAL_FALLBACK_PATH };
