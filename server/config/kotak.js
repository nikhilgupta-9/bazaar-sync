// config/kotak.js — Kotak Neo Trade API constants.
//
// Kotak Neo (added 2026-09-10) is a SECOND live market-data source alongside
// Angel One SmartAPI — it does NOT replace it. Angel One still owns the live
// worker / marketCache / socket.io pipeline untouched. The Kotak poller
// (server/kotak/) only writes to MySQL:
//   - option chain snapshots -> option_chain_history   (the existing table)
//   - spot / India VIX / futures -> ohlcv_data          (distinct symbols)
//
// Scope (2026-09-10, per user): 7 F&O indices + the full ~210 F&O stock
// universe, live/current data. HISTORICAL DATA IS NOT AVAILABLE FROM KOTAK
// — their support page states "Historical data is unavailable ... not allowed
// for this platform" and /charts/v1/scrip/history returns 503. Back-history
// stays on the Phase 7 sources (Upstox / Bhavcopy / Breeze). What the Kotak
// poller adds is FORWARD-accumulating minute history: every day it runs it
// appends real snapshots to option_chain_history / ohlcv_data, so a
// self-recorded history builds up from the day it's first switched on.
//
// Every host / path / magic number lives here so a first live login can
// correct anything wrong in ONE place. Values are from Kotak's official
// neo_api_client (v2) Python SDK source + docs/, NOT yet confirmed against a
// live credentialed run.

module.exports = {
    napiBase: process.env.KOTAK_NAPI_BASE || "https://napi.kotaksecurities.com",
    loginBase: process.env.KOTAK_LOGIN_BASE || "https://gw-napi.kotaksecurities.com",
    neoFinKey: process.env.KOTAK_NEO_FIN_KEY || "neotradeapi",

    paths: {
        oauthToken: "/oauth2/token", // POST, Basic base64(key:secret), body grant_type=client_credentials
        totpLogin: "/login/1.0/login/v6/totp/login", // POST -> view token + sid
        totpValidate: "/login/1.0/login/v6/totp/validate", // POST -> trade token + sid
        scripMaster: "/Files/1.0/masterscrip/v2/file-paths", // GET -> { data: { filesPaths: [csv urls] } }
        // Quotes: GET. {neoSymbols} = URL-encoded "seg|token,seg|token".
        // {type} in all | ltp | oi | ohlc.
        quotes: "/apim/quotes/1.0/quotes/neosymbol/{neoSymbols}/{type}",
    },

    ws: {
        url: process.env.KOTAK_WS_URL || "wss://mlhsm.kotaksecurities.com",
    },

    // Kotak exchange-segment codes.
    seg: {
        NSE_CASH: "nse_cm",
        NSE_FNO: "nse_fo",
        BSE_CASH: "bse_cm",
        BSE_FNO: "bse_fo",
    },

    // Kotak's nse_fo/bse_fo scrip master stores pExpiryDate as seconds since a
    // 1980-style epoch; add this to get a real UNIX timestamp.
    scripEpochOffsetSec: 315513000,

    // ── The 7 F&O indices ──────────────────────────────────────────────────
    // key = option_chain_history.symbol. Each carries which cash segment its
    // spot lives in and which F&O segment its options live in (SENSEX/BANKEX
    // are BSE). strikeStep is only a hint — the actual ATM/window is derived
    // from the listed strikes, so it can be wrong without breaking anything.
    indices: {
        NIFTY: { fnoName: "NIFTY", indexName: "Nifty 50", cashSeg: "nse_cm", fnoSeg: "nse_fo", strikeStep: 50 },
        BANKNIFTY: { fnoName: "BANKNIFTY", indexName: "Nifty Bank", cashSeg: "nse_cm", fnoSeg: "nse_fo", strikeStep: 100 },
        FINNIFTY: { fnoName: "FINNIFTY", indexName: "Nifty Fin Service", cashSeg: "nse_cm", fnoSeg: "nse_fo", strikeStep: 50 },
        MIDCPNIFTY: { fnoName: "MIDCPNIFTY", indexName: "NIFTY MID SELECT", cashSeg: "nse_cm", fnoSeg: "nse_fo", strikeStep: 25 },
        NIFTYNXT50: { fnoName: "NIFTYNXT50", indexName: "Nifty Next 50", cashSeg: "nse_cm", fnoSeg: "nse_fo", strikeStep: 100 },
        SENSEX: { fnoName: "SENSEX", indexName: "SENSEX", cashSeg: "bse_cm", fnoSeg: "bse_fo", strikeStep: 100 },
        BANKEX: { fnoName: "BANKEX", indexName: "BANKEX", cashSeg: "bse_cm", fnoSeg: "bse_fo", strikeStep: 100 },
    },

    // ── F&O stock universe (~210) ─────────────────────────────────────────
    // Discovered dynamically from the scrip master (every OPTSTK underlying
    // on nse_fo). Options: bse-listed F&O stocks don't exist, so all stock
    // options are nse_fo / their spot is nse_cm "<SYMBOL>-EQ".
    stocks: {
        // "auto"  -> every OPTSTK underlying found in the scrip master
        // ["A","B"] -> only these
        include: process.env.KOTAK_STOCKS || "auto",
        // symbols to skip even in auto mode (comma-sep in env)
        exclude: (process.env.KOTAK_STOCKS_EXCLUDE || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    },

    // India VIX (nse_cm). Scrip-master name varies; the feed also accepts the
    // literal "INDIA VIX" as an instrument_token.
    vixNameCandidates: ["INDIAVIX", "INDIA VIX", "NIFTY VIX"],
    vixQuoteName: "INDIA VIX",

    // ohlcv_data.symbol values for non-option instruments (no new tables).
    // Namespaced so they can never collide with a real index/stock symbol.
    vixOhlcvSymbol: "INDIAVIX",
    futureOhlcvSymbol: (underlying) => `${underlying}FUT`,

    session: {
        maxAgeMs: 6 * 60 * 60 * 1000, // trade token good for the day; refresh proactively
    },

    quotesChunkSize: Number(process.env.KOTAK_QUOTES_CHUNK || 25),

    // ── Polling tiers ────────────────────────────────────────────────────
    // Indices are cheap (7 chains) -> fast. Stocks are ~210 chains; a full
    // fast sweep would be thousands of REST calls and blow the rate limit,
    // so they run as a slow ROLLING sweep: each pass polls a slice, the whole
    // universe comes around every ~stockSweepTargetMs.
    tiers: {
        index: {
            intervalMs: Number(process.env.KOTAK_INDEX_INTERVAL_MS || 15000),
            strikesPerSide: Number(process.env.KOTAK_INDEX_STRIKES || 20),
        },
        stock: {
            strikesPerSide: Number(process.env.KOTAK_STOCK_STRIKES || 10),
            // target time for one full trip around all stocks
            sweepTargetMs: Number(process.env.KOTAK_STOCK_SWEEP_MS || 5 * 60 * 1000),
            // how many stock chains to poll per sweep step (rate-limit knob)
            perStep: Number(process.env.KOTAK_STOCK_PER_STEP || 6),
        },
    },

    // KOTAK_MODE: "index" | "stock" | "all" (default). Lets you run two
    // processes (one per tier) if you'd rather isolate them.
    mode: (process.env.KOTAK_MODE || "all").toLowerCase(),
};
