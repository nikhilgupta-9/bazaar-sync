// upstox/runFuturesUniverse.js — Upstox futures, ONE SYMBOL AT A TIME,
// fully sequential: a symbol's whole date range (month by month, in
// chronological order) finishes completely before moving to the next
// symbol. Different loop order than upstox/runFutures.js (which does
// year -> month -> every symbol, so all symbols get partial coverage at
// once) — this one finishes symbol #1 100%, then symbol #2, etc., across
// the full universe: the 7 indices + every F&O stock.
//
//   node upstox/runFuturesUniverse.js <FROM_YEAR> [TO_YEAR] [--symbols=A,B] [--reset]
//   (or: npm run futures:upstox:universe -- <FROM_YEAR> [TO_YEAR])
//
// Universe = the 7 indices (hardcoded, upstox.UNDERLYING_KEYS) + every stock
// symbol already discovered in option_chain_history (the NSE+BSE bhavcopy
// discovery phase of the option-chain pipeline — this dev DB already has
// 290 symbols there as of 2026-09-12). If that's empty, only the 7 indices
// get covered; run `npm run option-chain -- <YEAR> --skip-enrich` first to
// populate the stock symbol list (free, no Upstox/Breeze calls, bhavcopy
// only).
//
// Per symbol: ONE upstox.getExpiries() call for the whole [FROM_YEAR..
// TO_YEAR] range (not one per calendar month — a stock/index only has a
// handful of real futures expiries a year anyway, so refetching monthly
// would just waste calls), then backfillExpiry() per expiry IN CHRONOLOGICAL
// ORDER (getExpiries already returns them sorted) — since a futures contract
// only exists on its own monthly expiry, "one expiry at a time, oldest
// first" already IS "month by month" at the only granularity futures
// actually have.
//
// Resumable at the SYMBOL level via data/upstox-futures-universe-progress.json
// (which symbol index was in progress). Within a symbol, backfillExpiry()
// itself already skips any expiry that has minute data (see
// enrichFutures.js's alreadyEnriched check) — so even a full restart from
// symbol #1 fast-forwards through already-done symbols/expiries rather than
// re-downloading them, the progress file just avoids the cheap re-checks.
//
// This covers the FULL universe (indices + ~200+ stocks) across multiple
// years — expect this to run for HOURS given Upstox's own rate limit
// (~1.2s between requests, see historicalService.js). Run it in the
// background (e.g. `nohup npm run futures:upstox:universe -- 2025 2026 > upstox-universe.log 2>&1 &`
// on Mac/Linux, or a background PowerShell job on Windows) rather than
// keeping a terminal open.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst } = require("../lib/dates");
const upstox = require("./historicalService");
const { backfillExpiry, resolveUnderlyingKey } = require("./enrichFutures");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "upstox-futures-universe-progress.json");

function parseArgs(argv) {
    const fromYear = Number(argv[2]);
    const toYear = Number(argv[3]) && !String(argv[3]).startsWith("--") ? Number(argv[3]) : fromYear;
    const flags = {};
    for (const a of argv.slice(2)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return { fromYear, toYear, flags };
}

const loadProgress = () => { try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return null; } };
const saveProgress = (p) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); };
const clearProgress = () => { try { fs.unlinkSync(PROGRESS_FILE); } catch { /* gone */ } };

/** 7 indices (first) + every F&O stock bhavcopy has ever discovered, de-duped, indices excluded from the stock half. */
async function buildUniverse(onlySymbols) {
    if (onlySymbols) return [...onlySymbols];

    const indices = Object.keys(upstox.UNDERLYING_KEYS);
    const [rows] = await pool.query(`SELECT DISTINCT symbol FROM option_chain_history ORDER BY symbol`);
    const stocks = rows.map((r) => r.symbol).filter((s) => !indices.includes(s));

    if (!stocks.length) {
        console.log(
            `[upstox-fut-universe] option_chain_history has no stock symbols yet (bhavcopy discovery never run) — ` +
            `covering only the 7 indices this run. Run \`npm run option-chain -- <YEAR> --skip-enrich\` first for stock coverage.`
        );
    }
    return [...indices, ...stocks];
}

/** One symbol, whole [fromDate, toDate] range, one expiry (= one month's worth of futures) at a time, oldest first. */
async function runOneSymbol(symbol, fromDate, toDate) {
    const underlyingKey = await resolveUnderlyingKey(symbol);
    if (!underlyingKey) {
        console.log(`[upstox-fut-universe] ${symbol}: no Upstox instrument_key found (not an index, not in the equity instrument master) — skipped`);
        return;
    }

    let expiries = await upstox.getExpiries(underlyingKey);
    expiries = expiries.filter((e) => e >= fromDate && e <= toDate);
    if (!expiries.length) {
        console.log(`[upstox-fut-universe] ${symbol} (${underlyingKey}): 0 expiries in ${fromDate}..${toDate} — skipped`);
        return;
    }
    console.log(`[upstox-fut-universe] ${symbol} (${underlyingKey}): ${expiries.length} expiries in range, oldest first`);

    for (const expirySql of expiries) {
        try {
            await backfillExpiry(symbol, underlyingKey, expirySql);
        } catch (err) {
            console.error(`[upstox-fut-universe] ${symbol} ${expirySql}: ${err instanceof Error ? err.message : err}`);
        }
    }
}

async function main() {
    const { fromYear, toYear, flags } = parseArgs(process.argv);
    if (!Number.isInteger(fromYear) || fromYear < 2015 || fromYear > 2100) {
        console.error("Usage: node upstox/runFuturesUniverse.js <FROM_YEAR> [TO_YEAR] [--symbols=A,B] [--reset]");
        process.exit(1);
    }
    const onlySymbols = flags.symbols
        ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))
        : null;

    const today = todayIst();
    const fromDate = `${fromYear}-01-01`;
    const toDate = toYear >= Number(today.slice(0, 4)) ? today : `${toYear}-12-31`;

    if (flags.reset) clearProgress();
    const universe = await buildUniverse(onlySymbols);
    const indexCount = Object.keys(upstox.UNDERLYING_KEYS).length;
    console.log(
        `[upstox-fut-universe] universe: ${universe.length} symbols ` +
        `(${Math.min(indexCount, universe.length)} indices + ${Math.max(0, universe.length - indexCount)} stocks), ` +
        `range ${fromDate}..${toDate}`
    );

    let startIdx = 0;
    const progress = loadProgress();
    if (!flags.reset && progress && universe.includes(progress.symbol)) {
        startIdx = universe.indexOf(progress.symbol);
        console.log(`[upstox-fut-universe] resuming at ${progress.symbol} (#${startIdx + 1}/${universe.length})`);
    }

    for (let i = startIdx; i < universe.length; i++) {
        const symbol = universe[i];
        saveProgress({ symbol, index: i, total: universe.length });
        console.log(`\n======== [${i + 1}/${universe.length}] ${symbol} ========`);
        try {
            await runOneSymbol(symbol, fromDate, toDate);
        } catch (err) {
            console.error(`[upstox-fut-universe] ${symbol}: unexpected error, moving to next symbol: ${err instanceof Error ? err.message : err}`);
        }
        console.log(`[upstox-fut-universe] ${symbol}: done`);
    }

    console.log(`\n[upstox-fut-universe] universe complete: ${universe.length} symbols, ${fromDate}..${toDate}.`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[upstox-fut-universe] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
