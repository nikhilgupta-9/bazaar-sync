// services/nseBhavcopy.js — NSE's own free daily F&O "Bhavcopy" archive.
//
// This is the ONLY genuinely free, multi-year source for option-chain data
// in this project — NSE publishes one file per trading day, every strike/
// expiry/CE-PE of every symbol traded that day, going back years. The
// tradeoff vs. Angel One/Upstox: it's END-OF-DAY ONLY (one row per contract
// per day — close price, OI, volume), not minute-level. Good enough for a
// daily-granularity backtest mode, not for the existing minute-by-minute
// backtestEngine.js as-is.
//
// VERIFIED (2026-07-19) for the core UDiFF path (post-2024-07-08 dates):
// backfillBhavcopy.js NIFTY 1 ran for real — 245 trading days succeeded, 16
// failed (real market holidays, not a bug), 209,009 rows stored with the
// URL pattern and CSV column names below both correct on the first real run
// (see CLAUDE.md's Phase 7 "Verification status"). What is NOT yet
// reverified after that run: the 503/cookie-refresh handling and fetch
// timeout added 2026-07-20 (hit while testing further back in history), and
// the pre-2024-07-08 old-archive-format fallback (buildBhavcopyUrl's other
// branch) — no old-format date has been backfilled for real yet. If a
// far-back multi-year run stalls or 404s, that fallback branch is the first
// place to check.
//   URL:     https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{yyyymmdd}_F_0000.csv.zip
//   Columns: TckrSymb, FinInstrmTp, XpryDt, StrkPric, OptnTp, ClsPric,
//            OpnIntrst, TtlTradgVol, UndrlygPric
// The parser below is defensive regardless: it reads the actual CSV header
// row at runtime and matches columns by name (not fixed position), and
// throws a clear error printing the real headers if something doesn't
// match — kept as a safety net even though the shape above is now confirmed.
//
// NSE's old bhavcopy format was retired 2024-07-08 in favor of "UDiFF"
// (Unified Distilled File Format) — if this project is picked up much later
// than 2026 and the format changed again, that's the first thing to check.
//
// Requires the `unzip` command on PATH (present by default on macOS and
// most Linux distros) — used via child_process instead of adding a zip
// library as an npm dependency (CLAUDE.md already explains why adm-zip was
// deliberately dropped in Phase 6; no reason to reintroduce a zip dep for
// this one occasional script).

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { dbLogger } = require("../config/logger");

const BASE_URL = process.env.NSE_BHAVCOPY_BASE_URL || "https://nsearchives.nseindia.com/content/fo";
const CACHE_DIR = process.env.BHAVCOPY_CACHE_DIR || path.join(__dirname, "..", "data", "bhavcopy");

// NSE's site is known to reject requests without a browser-like User-Agent —
// and, specifically for archives.nseindia.com (the pre-2024-07-08 archive,
// unlike nsearchives.nseindia.com's newer UDiFF files), without real session
// cookies. A bare User-Agent alone got consistent HTTP 503s in testing
// (2026-07-20) — NSE's WAF appears to soft-block scripted clients that way
// rather than an outright 403. Fix: visit the plain nseindia.com homepage
// first to pick up real cookies, then send those on every archive request.
// This is a well-known, widely-reported requirement for nseindia.com
// specifically (not just this project) — see e.g. nsepy/jugaad-data issues.
const FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
};

// Native fetch has NO default timeout — a stalled NSE connection (soft
// throttling after many requests, a dropped connection, whatever) would hang
// this script forever with no error, exactly what happened in testing
// (2026-07-20, stuck on 2024-08-22 with no progress). Every fetch in this
// file goes through this wrapper so a hang becomes a loud, catchable error
// instead of an infinite wait.
const FETCH_TIMEOUT_MS = Number(process.env.BHAVCOPY_FETCH_TIMEOUT_MS || 25_000);
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

let nseCookieHeader = null;
let nseCookieFetchedAt = 0;
const NSE_COOKIE_MAX_AGE_MS = 15 * 60 * 1000; // refresh periodically during a long multi-hour backfill

async function ensureNseCookies({ force = false } = {}) {
    if (!force && nseCookieHeader && Date.now() - nseCookieFetchedAt < NSE_COOKIE_MAX_AGE_MS) {
        return nseCookieHeader;
    }
    const res = await fetchWithTimeout("https://www.nseindia.com/", {
        headers: { "User-Agent": FETCH_HEADERS["User-Agent"], Accept: "text/html" },
    });
    const setCookie =
        typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    nseCookieHeader = setCookie.map((c) => c.split(";")[0]).join("; ") || null;
    nseCookieFetchedAt = Date.now();
    if (!nseCookieHeader) {
        dbLogger.warn("[bhavcopy] could not obtain NSE session cookies — archive requests may 503");
    }
    return nseCookieHeader;
}

async function nseFetch(url, { retryOn403or503 = true } = {}) {
    const cookie = await ensureNseCookies();
    const res = await fetchWithTimeout(url, { headers: { ...FETCH_HEADERS, ...(cookie ? { Cookie: cookie } : {}) } });
    if ((res.status === 403 || res.status === 503) && retryOn403or503) {
        dbLogger.warn(`[bhavcopy] HTTP ${res.status} on ${url} — refreshing NSE session cookies and retrying once`);
        const freshCookie = await ensureNseCookies({ force: true });
        return fetchWithTimeout(url, { headers: { ...FETCH_HEADERS, ...(freshCookie ? { Cookie: freshCookie } : {}) } });
    }
    return res;
}

function execFileP(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
    });
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD' (plain string manipulation, no Date parsing). */
function toCompactDate(dateStr) {
    return dateStr.replace(/-/g, "");
}

// NSE switched F&O bhavcopy to the "UDiFF" format on 2024-07-08 (NSE Circular
// 62424) — before that date, the file lives at a DIFFERENT domain
// (archives.nseindia.com, not nsearchives.nseindia.com) with a DIFFERENT
// naming/column scheme (old-style SYMBOL/EXPIRY_DT/STRIKE_PR/OPTION_TYP/
// OPEN_INT/CONTRACTS names — already covered as fallback candidates in
// FIELD_CANDIDATES below, so no parser change needed, just routing).
// Confirmed against the `nser` R package's fobhav1() source, 2026-07-20 —
// same kind of "checked against a real, independent source" verification
// this project already applies to broker tokens (see CLAUDE.md Gotcha #13).
const UDIFF_CUTOVER_DATE = "2024-07-08";
const OLD_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function buildBhavcopyUrl(dateStr) {
    const compact = toCompactDate(dateStr);
    if (dateStr >= UDIFF_CUTOVER_DATE) {
        return `${BASE_URL}/BhavCopy_NSE_FO_0_0_0_${compact}_F_0000.csv.zip`;
    }
    const [y, m, d] = dateStr.split("-");
    const mon = OLD_MONTHS[Number(m) - 1];
    return `https://archives.nseindia.com/content/historical/DERIVATIVES/${y}/${mon}/fo${d}${mon}${y}bhav.csv.zip`;
}

async function downloadZip(dateStr) {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const compact = toCompactDate(dateStr);
    const zipPath = path.join(CACHE_DIR, `fo_${compact}.csv.zip`);
    if (fs.existsSync(zipPath)) return zipPath;

    const url = buildBhavcopyUrl(dateStr);
    dbLogger.info(`[bhavcopy] downloading ${url}`);
    const res = await nseFetch(url);
    if (!res.ok) throw new Error(`bhavcopy download HTTP ${res.status} for ${dateStr} (holiday/weekend, or NSE changed the URL — see file header)`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);
    return zipPath;
}

/** Unzip via the system `unzip` binary and return the raw CSV text. */
async function extractCsv(zipPath) {
    const extractDir = zipPath.replace(/\.zip$/, "");
    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });
    await execFileP("unzip", ["-o", zipPath, "-d", extractDir]);
    const files = fs.readdirSync(extractDir).filter((f) => f.toLowerCase().endsWith(".csv"));
    if (!files.length) throw new Error(`No CSV found after unzipping ${zipPath} — NSE may have changed the archive contents`);
    return fs.readFileSync(path.join(extractDir, files[0]), "utf8");
}

// Candidate header names per logical field — matched case-insensitively
// against the CSV's actual header row, first match wins. If NSE's real
// column names differ from all candidates, this throws with the real
// headers printed so the list can be extended.
const FIELD_CANDIDATES = {
    symbol: ["TckrSymb", "SYMBOL"],
    instrumentType: ["FinInstrmTp", "INSTRUMENT"],
    expiry: ["XpryDt", "EXPIRY_DT"],
    strike: ["StrkPric", "STRIKE_PR"],
    optionType: ["OptnTp", "OPTION_TYP"],
    close: ["ClsPric", "CLOSE"],
    openInterest: ["OpnIntrst", "OPEN_INT"],
    volume: ["TtlTradgVol", "CONTRACTS"],
    underlyingPrice: ["UndrlygPric", "UNDRLYG_PRIC"],
};

function buildColumnMap(headerLine) {
    const headers = headerLine.split(",").map((h) => h.trim());
    const lower = headers.map((h) => h.toLowerCase());
    const map = {};
    const missing = [];
    // instrumentType/underlyingPrice aren't strictly required — filtering only
    // needs symbol+optionType (CE/PE presence is itself the futures-vs-option
    // filter), and underlyingPrice just disables Greeks if truly absent.
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
            `Bhavcopy CSV is missing expected columns [${missing.join(", ")}]. ` +
                `Actual headers found: ${headers.join(" | ")}. ` +
                `Update FIELD_CANDIDATES in services/nseBhavcopy.js to match.`
        );
    }
    return map;
}

/** Simple CSV line splitter — NSE's bhavcopy has no quoted/comma-containing fields. */
function splitCsvLine(line) {
    return line.split(",").map((v) => v.trim());
}

/**
 * Parses ONE day's bhavcopy ONCE and returns every CE/PE row for EVERY
 * symbol found in the file (all NSE F&O underlyings that traded options
 * that day — indices AND stocks together, since NSE ships them in one
 * file). This is the efficient entry point for a multi-symbol backfill —
 * call this once per day rather than re-downloading/re-parsing per symbol.
 * Returns [{ symbol, expiry, strike, right, close, oi, volume, underlyingPrice }]
 */
async function getDayAllRows(dateStr) {
    const zipPath = await downloadZip(dateStr);
    const csv = await extractCsv(zipPath);
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

/** Convenience wrapper for a single symbol (used by testBhavcopy.js / backfillBhavcopy.js). */
async function getDayOptionRows(dateStr, symbol) {
    const all = await getDayAllRows(dateStr);
    return all.filter((r) => r.symbol === symbol);
}

// NSE-listed (NSE_FO segment) index names as of 2026-07-19 — the other 2 of
// the commonly-cited "7 indices" (SENSEX, BANKEX) trade on BSE, NOT NSE, and
// so never appear in this file at all — a separate BSE bhavcopy source would
// be needed for those. Used only for classification/logging, not filtering —
// getDayAllRows/getDayRowsBySymbol return every symbol found regardless.
const NSE_INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);

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

module.exports = {
    downloadZip,
    extractCsv,
    getDayOptionRows,
    getDayAllRows,
    getDayRowsBySymbol,
    toCompactDate,
    normalizeExpiry,
    NSE_INDEX_SYMBOLS,
};
