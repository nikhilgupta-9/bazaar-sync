// server/scripts/upstoxStockOptionChainArchivalRunner.js — Upstox F&O stock option chain → MySQL → Google Drive
//
// Per stock (LUPIN first, then every F&O stock in Upstox's current instrument
// master, A→Z), ONE STOCK FULLY BEFORE THE NEXT:
//   1. Spot: 1-minute equity OHLCV (Upstox v3, month-chunked) → ohlcv_data
//   2. Options: EVERY expiry touching the date range — expired ones via the
//      Expired Instruments API, still-live ones (current/next/far month) via
//      v3 candles on the live NSE_FO instrument keys — CE+PE 1-minute candles
//      for every strike within ±30 strikes of ATM at any point in that
//      expiry's window, with IV/Greeks computed on the same minute's spot
//      → option_chain_history (same upsert as upstox/enrich.js)
//   3. Archive: archivalPipelineService.processBatch for option_chain + ohlcv
//      per year touched (Drive: smart merge with any existing file, older
//      Drive copies deleted, local rows pruned)
//
// No-repeat guarantees:
//   - MySQL: UNIQUE keys + ON DUPLICATE KEY UPDATE (re-fetching never duplicates)
//   - Drive: processBatch merges with the existing <SYM>_<YEAR>_<type>.csv.gz,
//     replacing any trade_date present in the new export, then deletes the old file
//   - Progress file (data-downloader/data/upstox-stock-oc-archival-progress.json):
//     a stock completed through date X is skipped; a later run only fetches X+1..TO
//
// Upstox realities (confirmed live 2026-10-14, LUPIN):
//   - expired-contract candles: one request covers ~95 days fine
//   - v3 live-instrument 1-minute candles: max ~1 calendar month per request
//   - candles only exist for minutes that traded — illiquid far-month/deep
//     strikes have gaps, that is the real data, not a fetch failure
//   - Upstox expiries for stocks reach back to ~2024-10, so 2026-01 is in range
//
// Usage (from repo root or server/):
//   node server/scripts/upstoxStockOptionChainArchivalRunner.js
//        [--symbols=LUPIN,RELIANCE] [--from=2026-01-01] [--to=YYYY-MM-DD]
//        [--start-after=SYMBOL] [--from-letter=L] [--strikes=30] [--keep-local] [--force] [--dry-run]
//        [--spot-only]   only refresh the 1-minute spot OHLCV (+ its Drive file), skip options
//
// Indices: NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50, SENSEX, BANKEX work too when
// passed via --symbols (spot from NSE_INDEX/BSE_INDEX keys, live OPTIDX contracts from Upstox's
// NSE + BSE masters). An index's local ohlcv_data is never pruned (charts read it locally).
//
// Network outages: a "fetch failed"-type error makes the runner wait for Upstox to be
// reachable again and retry the same symbol, instead of marking every remaining symbol failed
// (that's what burned 173 symbols on 2026-10-16).

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const fs = require("fs");

const DD = path.join(__dirname, "..", "..", "data-downloader");
const upstox = require(path.join(DD, "upstox", "historicalService"));
const upstoxInstruments = require(path.join(DD, "upstox", "instrumentMaster"));
const bs = require(path.join(DD, "lib", "blackScholes"));
const { addDays, todayIst } = require(path.join(DD, "lib", "dates"));
const { pool } = require("../config/db");
const archivalPipeline = require("../services/archivalPipelineService");
const archivalLocks = require("../services/archivalLocks");
process.on("exit", () => archivalLocks.releaseAll());

const PROGRESS_FILE = path.join(DD, "data", "upstox-stock-oc-archival-progress.json");
const INDEX_KEYS = upstox.UNDERLYING_KEYS; // NIFTY → "NSE_INDEX|Nifty 50", SENSEX → "BSE_INDEX|SENSEX", …
const isIndex = (s) => Object.prototype.hasOwnProperty.call(INDEX_KEYS, s);
const BSE_INSTRUMENTS_URL = "https://assets.upstox.com/market-quote/instruments/exchange/BSE.csv.gz";
const BSE_CACHE = path.join(DD, "data", "upstox-instruments-bse.csv");
const FIRST_SYMBOL = "LUPIN";
const DEFAULT_FROM = "2026-01-01";
const LOOKBACK_DAYS = 95; // stock contracts list ~3 months before expiry; 95d verified to work in one expired-candle call
const INSERT_BATCH_SIZE = 500;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const OPTSTK_RE = new RegExp(`^(.+?)(\\d{2})(${MONTHS.join("|")})(\\d+(?:\\.\\d+)?)(CE|PE)$`);

// ---------- args / progress ----------

function parseArgs(argv) {
    const flags = {};
    for (const a of argv.slice(2)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return flags;
}

const loadProgress = () => {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return {}; }
};
const saveProgressFor = (symbol, entry) => {
    const latest = loadProgress();
    latest[symbol] = entry;
    saveProgress(latest);
};
const saveProgress = (p) => {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
};

const NETWORK_ERR = /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Block until Upstox answers again (polls every minute, up to ~12h). */
async function waitForNetwork() {
    for (let i = 0; i < 720; i++) {
        try {
            const res = await fetch("https://api.upstox.com/v2/market/holidays", { signal: AbortSignal.timeout(15000) });
            if (res.ok) return true;
        } catch { /* still down */ }
        if (i % 10 === 0) console.warn(`[network] Upstox unreachable — waiting (${i} min so far)…`);
        await sleep(60000);
    }
    return false;
}

/** Last COMPLETE trading day: today after 15:45 IST, else yesterday (plain-string math, Gotcha #12). */
function defaultToDate() {
    const now = new Date(Date.now() + 5.5 * 3600 * 1000);
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    return minutes >= 15 * 60 + 45 ? todayIst() : addDays(todayIst(), -1);
}

/** [from,to] split at calendar-month boundaries — v3 minute candles allow ≤1 month per request. */
function monthChunks(from, to) {
    const chunks = [];
    let cur = from;
    while (cur <= to) {
        const [y, m] = cur.split("-").map(Number);
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        const end = monthEnd < to ? monthEnd : to;
        chunks.push([cur, end]);
        cur = addDays(end, 1);
    }
    return chunks;
}

const inSession = (c) => c.time >= "09:15:00" && c.time <= "15:30:00";
const maxStr = (a, b) => (a > b ? a : b);
const minStr = (a, b) => (a < b ? a : b);

// ---------- instrument master: live F&O stock options ----------

let liveOptionsBySymbol = null;

/** symbol -> [{ key, expiry, strike, type }] for every live OPTSTK contract in Upstox's NSE master. */
async function loadLiveStockOptions() {
    if (liveOptionsBySymbol) return liveOptionsBySymbol;
    const csvPath = await upstoxInstruments.downloadInstruments();
    const lines = fs.readFileSync(csvPath, "utf8").split("\n");
    const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    const col = (n) => header.indexOf(n);
    const iKey = col("instrument_key"), iSym = col("tradingsymbol"), iExp = col("expiry"),
        iStrike = col("strike"), iType = col("instrument_type"), iOpt = col("option_type");
    liveOptionsBySymbol = new Map();
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].includes("OPTSTK")) continue;
        const cells = lines[i].split(",").map((c) => c.replace(/^"(.*)"$/, "$1").trim());
        if (cells[iType] !== "OPTSTK") continue;
        const m = cells[iSym].match(OPTSTK_RE);
        if (!m) continue;
        const sym = m[1].toUpperCase();
        const list = liveOptionsBySymbol.get(sym) || [];
        list.push({ key: cells[iKey], expiry: cells[iExp], strike: Number(cells[iStrike]), type: cells[iOpt] });
        liveOptionsBySymbol.set(sym, list);
    }
    return liveOptionsBySymbol;
}

let liveIndexOptions = null;

/** index -> [{ key, expiry, strike, type }] for live OPTIDX contracts (NSE master + BSE master for SENSEX/BANKEX). */
async function loadLiveIndexOptions() {
    if (liveIndexOptions) return liveIndexOptions;
    const nsePath = await upstoxInstruments.downloadInstruments();
    if (!fs.existsSync(BSE_CACHE) || Date.now() - fs.statSync(BSE_CACHE).mtimeMs > 20 * 3600 * 1000) {
        const res = await fetch(BSE_INSTRUMENTS_URL);
        if (!res.ok) throw new Error(`Upstox BSE instrument master download failed: HTTP ${res.status}`);
        fs.writeFileSync(BSE_CACHE, require("zlib").gunzipSync(Buffer.from(await res.arrayBuffer())));
    }
    liveIndexOptions = new Map();
    for (const file of [nsePath, BSE_CACHE]) {
        const lines = fs.readFileSync(file, "utf8").split("\n");
        const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
        const col = (n) => header.indexOf(n);
        const iKey = col("instrument_key"), iName = col("name"), iExp = col("expiry"),
            iStrike = col("strike"), iType = col("instrument_type"), iOpt = col("option_type");
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].includes("OPTIDX")) continue;
            const cells = lines[i].split(",").map((c) => c.replace(/^"(.*)"$/, "$1").trim());
            const name = (cells[iName] || "").toUpperCase();
            if (cells[iType] !== "OPTIDX" || !isIndex(name)) continue; // `name` is the underlying for OPTIDX rows
            const list = liveIndexOptions.get(name) || [];
            list.push({ key: cells[iKey], expiry: cells[iExp], strike: Number(cells[iStrike]), type: cells[iOpt] });
            liveIndexOptions.set(name, list);
        }
    }
    return liveIndexOptions;
}

async function getUniverse(flags) {
    if (flags.symbols) return String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
    const live = await loadLiveStockOptions();
    let rest = [...live.keys()].filter((s) => s !== FIRST_SYMBOL).sort();
    if (flags["from-letter"]) {
        // rotate: e.g. L→Z first, then A→K, so nothing is skipped
        const l = String(flags["from-letter"]).toUpperCase();
        rest = [...rest.filter((s) => s >= l), ...rest.filter((s) => s < l)];
    }
    let list = [FIRST_SYMBOL, ...rest];
    if (flags["start-after"]) {
        const idx = list.indexOf(String(flags["start-after"]).toUpperCase());
        if (idx !== -1) list = list.slice(idx + 1);
    }
    return list;
}

// ---------- storage ----------

async function storeSpot(symbol, candles) {
    for (let i = 0; i < candles.length; i += INSERT_BATCH_SIZE) {
        const values = candles.slice(i, i + INSERT_BATCH_SIZE)
            .map((c) => [symbol, c.date, c.time, c.open, c.high, c.low, c.close, c.volume]);
        await pool.query(
            `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
             VALUES ?
             ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low),
               close=VALUES(close), volume=VALUES(volume)`,
            [values]
        );
    }
}

// Same column list + upsert as data-downloader/upstox/enrich.js storeOptionChainRows.
// Enforces max ATM ± 30 strikes per minute
async function storeStrikeRows(symbol, expiry, strike, ceRows, peRows, strikesList = null, maxAtmOffset = 30) {
    const byTime = new Map();
    for (const r of ceRows) byTime.set(`${r.date}|${r.time}`, { date: r.date, time: r.time, ce: r });
    for (const r of peRows) {
        const k = `${r.date}|${r.time}`;
        const row = byTime.get(k) || { date: r.date, time: r.time };
        row.pe = r;
        byTime.set(k, row);
    }

    const strikeIdx = strikesList ? strikesList.indexOf(strike) : -1;
    const nearestIdx = (p) => strikesList.reduce((b, s, i) => (Math.abs(s - p) < Math.abs(strikesList[b] - p) ? i : b), 0);

    const rows = [...byTime.values()].filter((r) => {
        if (!strikesList || strikeIdx === -1) return true;
        const s = r.ce?.spot ?? r.pe?.spot;
        if (s == null) return true;
        const atmIdx = nearestIdx(s);
        return Math.abs(strikeIdx - atmIdx) <= maxAtmOffset;
    });

    const values = rows.map((r) => [
        symbol, r.date, r.time, expiry, strike,
        r.ce?.spot ?? r.pe?.spot ?? null,
        r.ce?.close ?? null, r.ce?.oi ?? null, r.ce?.oiChange ?? null, r.ce?.iv ?? null, r.ce?.volume ?? null,
        r.ce?.delta ?? null, r.ce?.gamma ?? null, r.ce?.theta ?? null, r.ce?.vega ?? null,
        r.pe?.close ?? null, r.pe?.oi ?? null, r.pe?.oiChange ?? null, r.pe?.iv ?? null, r.pe?.volume ?? null,
        r.pe?.delta ?? null, r.pe?.gamma ?? null, r.pe?.theta ?? null, r.pe?.vega ?? null,
    ]);
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
        await pool.query(
            `INSERT INTO option_chain_history (
               symbol, trade_date, trade_time, expiry, strike, underlying_price,
               ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
               pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
             ) VALUES ?
             ON DUPLICATE KEY UPDATE
               underlying_price=VALUES(underlying_price),
               ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_oi_change=VALUES(ce_oi_change), ce_iv=VALUES(ce_iv), ce_volume=VALUES(ce_volume),
               ce_delta=VALUES(ce_delta), ce_gamma=VALUES(ce_gamma), ce_theta=VALUES(ce_theta), ce_vega=VALUES(ce_vega),
               pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_oi_change=VALUES(pe_oi_change), pe_iv=VALUES(pe_iv), pe_volume=VALUES(pe_volume),
               pe_delta=VALUES(pe_delta), pe_gamma=VALUES(pe_gamma), pe_theta=VALUES(pe_theta), pe_vega=VALUES(pe_vega)`,
            [values.slice(i, i + INSERT_BATCH_SIZE)]
        );
    }
    return rows.length;
}

// ---------- greeks ----------

function yearsToExpiryAsOf(expiry, date, time) {
    const [ey, em, ed] = expiry.split("-").map(Number);
    const [dy, dm, dd] = date.split("-").map(Number);
    const [hh, mm, ss] = time.split(":").map(Number);
    const ms = Date.UTC(ey, em - 1, ed, 15, 30, 0) - Date.UTC(dy, dm - 1, dd, hh, mm, ss);
    return Math.max(ms / (365 * 24 * 3600 * 1000), 1 / (365 * 24 * 4));
}

function enrich(candles, { strike, right, expiry, spot }) {
    let prevOi = null;
    return candles.map((c) => {
        const s = spot.at(c.date, c.time);
        let iv = null, g = { delta: null, gamma: null, theta: null, vega: null };
        if (s != null && c.close > 0) {
            const t = yearsToExpiryAsOf(expiry, c.date, c.time);
            iv = bs.impliedVolatility({ marketPrice: c.close, spot: s, strike, t, right });
            if (iv != null) g = bs.greeks({ spot: s, strike, t, vol: iv, right });
        }
        const oiChange = prevOi != null ? c.oi - prevOi : null;
        prevOi = c.oi;
        return {
            date: c.date, time: c.time, close: c.close, volume: c.volume, oi: c.oi, oiChange,
            spot: s, iv: iv != null ? iv * 100 : null,
            delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega,
        };
    });
}

/** Minute spot lookup with fallback to the latest earlier minute that day, then the day's close. */
function buildSpotIndex(candles) {
    const byKey = new Map();
    const byDate = new Map();
    for (const c of candles) {
        byKey.set(`${c.date}|${c.time}`, c.close);
        const arr = byDate.get(c.date) || [];
        arr.push(c);
        byDate.set(c.date, arr);
    }
    return {
        at(date, time) {
            const exact = byKey.get(`${date}|${time}`);
            if (exact != null) return exact;
            const day = byDate.get(date);
            if (!day) return null;
            let best = day[0].close;
            for (const c of day) { if (c.time <= time) best = c.close; else break; }
            return best;
        },
        range(from, to) {
            let lo = Infinity, hi = -Infinity;
            for (const [d, arr] of byDate) {
                if (d < from || d > to) continue;
                for (const c of arr) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
            }
            return Number.isFinite(lo) ? { lo, hi } : null;
        },
    };
}

/** Strikes within ±n strikes of ATM at ANY point in the window (ATM moves intraday/over weeks). */
function selectAtmWindow(strikes, lo, hi, n) {
    const nearest = (p) => strikes.reduce((b, s, i) => (Math.abs(s - p) < Math.abs(strikes[b] - p) ? i : b), 0);
    const a = Math.max(0, nearest(lo) - n);
    const b = Math.min(strikes.length - 1, nearest(hi) + n);
    return new Set(strikes.slice(a, b + 1));
}

// ---------- per-symbol fetch ----------

async function fetchSpot(symbol, equityKey, from, to) {
    const all = [];
    for (const [f, t] of monthChunks(from, to)) {
        const c = (await upstox.getCandlesV3(equityKey, { unit: "minutes", interval: 1, fromDate: f, toDate: t })).filter(inSession);
        all.push(...c);
    }
    await storeSpot(symbol, all);
    return all;
}

async function fetchContractCandles(contract, winFrom, winTo) {
    if (contract.expired) {
        const c = await upstox.getExpiredCandles(contract.key, { interval: "1minute", fromDate: winFrom, toDate: winTo });
        return c.filter((x) => inSession(x) && x.date >= winFrom && x.date <= winTo);
    }
    const out = [];
    for (const [f, t] of monthChunks(winFrom, winTo)) {
        out.push(...(await upstox.getCandlesV3(contract.key, { unit: "minutes", interval: 1, fromDate: f, toDate: t })).filter(inSession));
    }
    return out;
}

/** Every expiry (expired + live) whose lifetime overlaps [from, to], with its CE/PE contracts. */
async function listExpiries(symbol, equityKey, from, to) {
    const out = new Map(); // expiry -> [{ key, strike, type, expired }]
    const expired = (await upstox.getExpiries(equityKey)).filter((e) => e >= from && addDays(e, -LOOKBACK_DAYS) <= to);
    for (const e of expired) {
        const contracts = await upstox.getExpiredOptionContracts(equityKey, e);
        out.set(e, contracts.map((c) => ({ key: c.instrument_key, strike: Number(c.strike_price), type: c.instrument_type, expired: true })));
    }
    const live = (isIndex(symbol) ? await loadLiveIndexOptions() : await loadLiveStockOptions()).get(symbol) || [];
    for (const c of live) {
        if (out.has(c.expiry) && out.get(c.expiry)[0]?.expired) continue; // expired API already covers it
        if (c.expiry < from || addDays(c.expiry, -LOOKBACK_DAYS) > to) continue;
        const list = out.get(c.expiry) || [];
        list.push({ key: c.key, strike: c.strike, type: c.type, expired: false });
        out.set(c.expiry, list);
    }
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function processSymbol(symbol, from, to, nStrikes, { spotOnly = false } = {}) {
    const equityKey = isIndex(symbol) ? INDEX_KEYS[symbol] : await upstoxInstruments.resolveInstrumentKey(symbol);
    if (!equityKey) throw new Error(`no Upstox instrument_key for ${symbol}`);

    console.log(`[${symbol}] spot 1-minute ${from}..${to} (${equityKey})`);
    const spotCandles = await fetchSpot(symbol, equityKey, from, to);
    console.log(`[${symbol}] spot: ${spotCandles.length} minute candles stored`);
    if (!spotCandles.length) throw new Error("no spot candles returned — cannot center ATM or compute Greeks");
    if (spotOnly) return { spotRows: spotCandles.length, optionRows: 0, failed: [] };
    const spot = buildSpotIndex(spotCandles);

    const expiries = await listExpiries(symbol, equityKey, from, to);
    console.log(`[${symbol}] ${expiries.length} expiries: ${expiries.map(([e, c]) => `${e}${c[0]?.expired ? "" : "(live)"}`).join(", ")}`);

    let optionRows = 0;
    const failed = [];
    for (const [expiry, contracts] of expiries) {
        const winFrom = maxStr(from, addDays(expiry, -LOOKBACK_DAYS));
        const winTo = minStr(to, expiry);
        const r = spot.range(winFrom, winTo);
        if (!r) { console.warn(`[${symbol}] ${expiry}: no spot in ${winFrom}..${winTo}, skipped`); continue; }

        const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
        const keep = selectAtmWindow(strikes, r.lo, r.hi, nStrikes);
        const byStrike = new Map();
        for (const c of contracts) {
            if (!keep.has(c.strike)) continue;
            const e = byStrike.get(c.strike) || {};
            e[c.type] = c;
            byStrike.set(c.strike, e);
        }

        let rowsThisExpiry = 0;
        for (const [strike, pair] of [...byStrike.entries()].sort((a, b) => a[0] - b[0])) {
            try {
                const ce = pair.CE ? enrich(await fetchContractCandles(pair.CE, winFrom, winTo), { strike, right: "call", expiry, spot }) : [];
                const pe = pair.PE ? enrich(await fetchContractCandles(pair.PE, winFrom, winTo), { strike, right: "put", expiry, spot }) : [];
                rowsThisExpiry += await storeStrikeRows(symbol, expiry, strike, ce, pe, strikes, nStrikes);
            } catch (err) {
                failed.push({ expiry, strike, pair, winFrom, winTo, strikes, error: err.message });
                console.error(`[${symbol}] ${expiry} ${strike}: ${err.message}`);
            }
        }
        optionRows += rowsThisExpiry;
        console.log(`[${symbol}] ${expiry}: ${rowsThisExpiry} rows, ${byStrike.size}/${strikes.length} strikes (spot ${r.lo}-${r.hi}, window ${winFrom}..${winTo})`);
    }

    // one retry pass for anything that failed (network blips, rate-limit exhaustion)
    const stillFailed = [];
    for (const f of failed) {
        try {
            const ce = f.pair.CE ? enrich(await fetchContractCandles(f.pair.CE, f.winFrom, f.winTo), { strike: f.strike, right: "call", expiry: f.expiry, spot }) : [];
            const pe = f.pair.PE ? enrich(await fetchContractCandles(f.pair.PE, f.winFrom, f.winTo), { strike: f.strike, right: "put", expiry: f.expiry, spot }) : [];
            optionRows += await storeStrikeRows(symbol, f.expiry, f.strike, ce, pe, f.strikes, nStrikes);
        } catch (err) {
            stillFailed.push(`${f.expiry}:${f.strike} ${err.message}`);
        }
    }
    return { spotRows: spotCandles.length, optionRows, failed: stillFailed };
}

async function duplicateCheck(symbol, from, to) {
    const [[d]] = await pool.query(
        `SELECT COUNT(*) AS dup FROM (
           SELECT 1 FROM option_chain_history WHERE symbol = ? AND trade_date BETWEEN ? AND ?
           GROUP BY expiry, strike, trade_date, trade_time HAVING COUNT(*) > 1) x`,
        [symbol, from, to]
    );
    return Number(d.dup);
}

// ---------- main ----------

async function main() {
    const flags = parseArgs(process.argv);
    const FROM = flags.from || DEFAULT_FROM;
    const TO = flags.to || defaultToDate();
    const nStrikes = Number(flags.strikes || 30);
    const autoPrune = !flags["keep-local"];
    const symbols = await getUniverse(flags);
    const progress = loadProgress();

    console.log(`\n================================================================`);
    console.log(`UPSTOX STOCK OPTION CHAIN → DRIVE   ${FROM} → ${TO}   ATM ±${nStrikes}`);
    console.log(`Symbols: ${symbols.length} (${symbols.slice(0, 6).join(", ")}${symbols.length > 6 ? ", ..." : ""})`);
    console.log(`Local prune after upload: ${autoPrune}   Dry run: ${!!flags["dry-run"]}`);
    console.log(`================================================================\n`);

    const summary = { done: 0, skipped: 0, partial: 0, errors: 0 };
    const spotOnly = !!flags["spot-only"];
    const networkRetries = {};
    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const prev = progress[symbol];
        let from = FROM;
        if (spotOnly) {
            if (prev && prev.ohlcvTo >= TO && !flags.force) {
                console.log(`[${i + 1}/${symbols.length}] ${symbol}: spot OHLCV already on Drive through ${prev.ohlcvTo} — skipped`);
                summary.skipped++;
                continue;
            }
        } else if (prev && prev.status === "done" && prev.from <= FROM && !flags.force) {
            if (prev.to >= TO) {
                console.log(`[${i + 1}/${symbols.length}] ${symbol}: already on Drive through ${prev.to} — skipped`);
                summary.skipped++;
                continue;
            }
            from = addDays(prev.to, 1); // incremental: only the new days
        }
        console.log(`\n[${i + 1}/${symbols.length}] ${symbol}: fetching ${from}..${TO}`);
        if (flags["dry-run"]) continue;

        const started = Date.now();
        archivalLocks.lock(symbol); // keeps services/autoUploadDaemon.js off this symbol until we've uploaded it
        try {
            const res = await processSymbol(symbol, from, TO, nStrikes, { spotOnly });
            if (!spotOnly) {
                const dups = await duplicateCheck(symbol, from, TO);
                if (dups) throw new Error(`${dups} duplicate (expiry,strike,date,time) groups found — not uploading`);
            }

            const years = [];
            for (let y = Number(from.slice(0, 4)); y <= Number(TO.slice(0, 4)); y++) years.push(y);
            const pruneOhlcv = autoPrune && !isIndex(symbol); // charts read index spot from local ohlcv_data
            for (const year of years) {
                const oh = await archivalPipeline.processBatch({ dataType: "ohlcv", symbol, year, autoPrune: pruneOhlcv });
                if (spotOnly) {
                    console.log(`[${symbol}] Drive ${year}: ohlcv ${oh.status} (${oh.records ?? 0} rows)`);
                    continue;
                }
                const oc = await archivalPipeline.processBatch({ dataType: "option_chain", symbol, year, autoPrune });
                console.log(`[${symbol}] Drive ${year}: option_chain ${oc.status} (${oc.records ?? 0} rows, ${oc.duplicatesMerged ?? 0} replaced) | ohlcv ${oh.status} (${oh.records ?? 0} rows)`);
            }

            if (spotOnly) {
                const entry = { ...(prev || {}), ohlcvTo: TO, ohlcvRows: res.spotRows, ohlcvUpdatedAt: new Date().toISOString() };
                progress[symbol] = entry;
                saveProgressFor(symbol, entry);
                summary.done++;
                console.log(`[${symbol}] ✅ spot OHLCV: ${res.spotRows} rows`);
                continue;
            }

            const status = res.failed.length ? "partial" : "done";
            progress[symbol] = {
                status,
                from: prev && prev.status === "done" && !flags.force ? prev.from : FROM,
                to: TO,
                spotRows: res.spotRows,
                optionRows: res.optionRows,
                failed: res.failed,
                minutes: Math.round((Date.now() - started) / 60000),
                updatedAt: new Date().toISOString(),
            };
            if (status === "partial") {
                // keep the previous completed range so the next run re-fetches this whole slice
                if (prev && prev.status === "done") progress[symbol] = { ...prev, lastPartialAttempt: progress[symbol] };
                summary.partial++;
                console.warn(`[${symbol}] PARTIAL — ${res.failed.length} contracts failed after retry; will be re-fetched next run`);
            } else {
                summary.done++;
            }
            saveProgressFor(symbol, progress[symbol]);
            console.log(`[${symbol}] ✅ ${status}: ${res.optionRows} option rows, ${res.spotRows} spot rows in ${progress[symbol].minutes ?? "?"} min`);
        } catch (err) {
            if (NETWORK_ERR.test(err.message || "") && (networkRetries[symbol] = (networkRetries[symbol] || 0) + 1) <= 3) {
                console.warn(`[${symbol}] network error (${err.message}) — waiting for Upstox, then retrying this symbol`);
                if (await waitForNetwork()) {
                    i--; // same symbol again; upserts make the partial first attempt harmless
                    continue;
                }
            }
            summary.errors++;
            console.error(`[${symbol}] ❌ ${err.message}`);
            if (/401|Unauthorized|token/i.test(err.message)) {
                console.error("Upstox token looks invalid/expired — stopping. Put a fresh UPSTOX_ACCESS_TOKEN in server/.env and re-run (resumes automatically).");
                break;
            }
        } finally {
            archivalLocks.unlock(symbol);
        }
    }

    console.log(`\nDONE — done ${summary.done}, skipped ${summary.skipped}, partial ${summary.partial}, errors ${summary.errors}`);
    console.log(`Progress: ${PROGRESS_FILE}`);
    // a dead MySQL socket made pool.end() hang forever on 2026-10-16 — don't wait on it
    await Promise.race([pool.end().catch(() => {}), sleep(5000)]);
    process.exit(0);
}

main().catch((err) => {
    console.error("[upstox-stock-oc] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
