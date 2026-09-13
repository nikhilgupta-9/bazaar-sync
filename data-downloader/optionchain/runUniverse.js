// optionchain/runUniverse.js — ICICI Breeze option-chain, ONE SYMBOL AT A
// TIME, fully sequential: a symbol's whole [FROM_YEAR..TO_YEAR] range
// (month by month, in order — discovery -> enrich -> verify, same phases as
// run.js) finishes completely before moving to the next symbol. Different
// loop order than run.js/runYears.js (those do year -> month -> every
// symbol, so all symbols get partial coverage at once) — this one finishes
// symbol #1 100% first, then symbol #2, etc., across the full universe: the
// 7 indices + every F&O stock. Same "one symbol fully, then the next" shape
// as upstox/runFuturesUniverse.js, for the same reason: it was easy to tell
// EXACTLY which symbols are 100% done vs. not-yet-started, instead of every
// symbol being partially done at once.
//
//   node optionchain/runUniverse.js <FROM_YEAR> <TO_YEAR> [--symbols=A,B] [--reset]
//   (or: npm run option-chain:universe -- <FROM_YEAR> <TO_YEAR>)
//
// Universe = 7 indices (NSE_INDEX_SYMBOLS + BSE_INDEX_SYMBOLS) + every stock
// symbol already discovered in option_chain_history (this dev DB has ~290
// as of 2026-09-13, from earlier bhavcopy discovery runs). If that's
// near-empty, run `npm run option-chain -- <YEAR> --skip-enrich` for at
// least one year first to populate the stock list (free, bhavcopy-only, no
// Breeze calls).
//
// Reuses run.js's own runMonth() (discovery/enrich/verify, unchanged) and
// the same duplicate check runYears.js added — no logic is duplicated here,
// this file only adds the "one symbol fully, then the next" loop order and
// symbol-level resumability.
//
// Breeze's real limit is 5,000 calls/day (breeze/rateLimiter.js, ~4,800
// used here) — covering 7 indices + ~210 stocks × multiple years at
// 1-minute granularity is WAY more than one day's budget. Stops cleanly the
// moment the budget runs out (mid-month, mid-symbol — wherever it happens)
// and tells you to re-run the SAME command tomorrow; it resumes at the
// exact (symbol, year, month, phase) it stopped at, never restarting an
// already-finished symbol. Expect this to take many real days of daily
// re-runs for the full universe — that's ICICI's rate limit, not a bug.
// Run it in the background (e.g. on Windows, a background PowerShell job;
// on macOS/Linux, `nohup npm run option-chain:universe -- 2024 2025 > universe.log 2>&1 &`)
// rather than keeping a terminal open all day.
//
// Flags: --symbols=A,B (restrict the universe to just these, for testing),
// --reset (ignore saved progress, start over from symbol #1).

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst } = require("../lib/dates");
const { NSE_INDEX_SYMBOLS } = require("../lib/nseBhavcopy");
const { BSE_INDEX_SYMBOLS } = require("../lib/bseBhavcopy");
const { monthBounds } = require("./monthDiscovery");
const { runMonth } = require("./run");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "breeze-pipeline-universe-progress.json");

const SEVEN_INDICES = [...NSE_INDEX_SYMBOLS, ...BSE_INDEX_SYMBOLS];

function parseArgs(argv) {
    const fromYear = Number(argv[2]);
    const toYear = Number(argv[3]);
    const flags = {};
    for (const a of argv.slice(4)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return { fromYear, toYear, flags };
}

const loadProgress = () => { try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return null; } };
const saveProgress = (p) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); };
const clearProgress = () => { try { fs.unlinkSync(PROGRESS_FILE); } catch { /* already gone */ } };

function ym(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

/** 7 indices (first) + every F&O stock bhavcopy has ever discovered, de-duped, indices excluded from the stock half. */
async function buildUniverse(onlySymbols) {
    if (onlySymbols) return [...onlySymbols];
    const [rows] = await pool.query(`SELECT DISTINCT symbol FROM option_chain_history ORDER BY symbol`);
    const stocks = rows.map((r) => r.symbol).filter((s) => !SEVEN_INDICES.includes(s));
    if (!stocks.length) {
        console.log(
            "[breeze-universe] option_chain_history has no stock symbols yet (bhavcopy discovery never run) — " +
            "covering only the 7 indices this run. Run `npm run option-chain -- <YEAR> --skip-enrich` first for stock coverage."
        );
    }
    return [...SEVEN_INDICES, ...stocks];
}

/** Same duplicate proof as runYears.js — see that file's header for why this should always come back empty. */
async function checkNoDuplicates(first, last, symbol) {
    const [rows] = await pool.query(
        `SELECT symbol, expiry, strike, trade_date, trade_time, COUNT(*) AS c
         FROM option_chain_history
         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
         GROUP BY symbol, expiry, strike, trade_date, trade_time
         HAVING c > 1
         LIMIT 20`,
        [symbol, first, last]
    );
    return rows;
}

/**
 * One symbol, full [fromYear..toYear] range, month by month, in order —
 * discovery -> enrich -> verify -> duplicate-check per month, exactly like
 * run.js's own single-year loop, just restricted to this one symbol and
 * spanning multiple years without a separate command per year.
 */
async function runOneSymbol(symbol, fromYear, toYear, resumeMonth, resumePhase, flags) {
    const onlySymbols = new Set([symbol]);
    const today = todayIst();
    const [curY, curM] = today.split("-").map(Number);

    for (let year = fromYear; year <= toYear; year++) {
        const monthStart = year === fromYear && resumeMonth ? resumeMonth : 1;
        let endMonth = 12;
        if (year === curY) endMonth = curM - 1; // never a month that isn't over yet
        if (year > curY || endMonth < 1) break;
        if (monthStart > endMonth) continue; // this year already fully done in an earlier run

        for (let month = monthStart; month <= endMonth; month++) {
            const phase = year === fromYear && month === monthStart && resumePhase ? resumePhase : "discovery";
            const { first, last } = monthBounds(year, month);

            const outcome = await runMonth(year, month, phase, { onlySymbols, flags });
            if (outcome === "budget-exhausted") return { status: "budget-exhausted", year, month };
            if (outcome === "verify-failed") return { status: "verify-failed", year, month };

            const dupes = await checkNoDuplicates(first, last, symbol);
            if (dupes.length) {
                console.error(`[breeze-universe] ⚠ DUPLICATE rows for ${symbol} ${ym(year, month)} — should be impossible under the UNIQUE KEY, flag this DB for a schema check:`);
                for (const d of dupes) console.error(`  - ${d.symbol} ${d.expiry} strike ${d.strike} ${d.trade_date} ${d.trade_time}: ${d.c} rows`);
            } else {
                console.log(`[verify-dup] ${symbol} ${ym(year, month)}: no duplicate rows — confirmed clean.`);
            }
        }
        resumeMonth = null; // only the very first year/month of the whole run resumes mid-month
        resumePhase = null;
    }
    return { status: "symbol-complete" };
}

async function main() {
    const { fromYear, toYear, flags } = parseArgs(process.argv);
    if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear < 2015 || toYear < fromYear) {
        console.error("Usage: node optionchain/runUniverse.js <FROM_YEAR> <TO_YEAR> [--symbols=A,B] [--reset]");
        process.exit(1);
    }
    const onlySymbolsOverride = flags.symbols
        ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))
        : null;

    if (flags.reset) clearProgress();
    const universe = await buildUniverse(onlySymbolsOverride);
    console.log(
        `[breeze-universe] universe: ${universe.length} symbols (${SEVEN_INDICES.filter((s) => universe.includes(s)).length} indices + ${universe.length - SEVEN_INDICES.filter((s) => universe.includes(s)).length} stocks), years ${fromYear}..${toYear}`
    );

    let startIdx = 0, resumeMonth = null, resumePhase = null;
    const progress = loadProgress();
    if (!flags.reset && progress && universe.includes(progress.symbol)) {
        startIdx = universe.indexOf(progress.symbol);
        resumeMonth = progress.month || null;
        resumePhase = progress.phase || null;
        console.log(`[breeze-universe] resuming at ${progress.symbol} (#${startIdx + 1}/${universe.length}), ${resumeMonth ? ym(progress.year, resumeMonth) : "from the start"}${resumePhase ? ` · ${resumePhase}` : ""}`);
    }

    for (let i = startIdx; i < universe.length; i++) {
        const symbol = universe[i];
        saveProgress({ symbol, index: i, total: universe.length, year: fromYear, month: resumeMonth || 1, phase: resumePhase || "discovery" });
        console.log(`\n======== [${i + 1}/${universe.length}] ${symbol} ========`);

        const result = await runOneSymbol(symbol, fromYear, toYear, resumeMonth, resumePhase, flags);
        resumeMonth = null;
        resumePhase = null;

        if (result.status === "budget-exhausted") {
            saveProgress({ symbol, index: i, total: universe.length, year: result.year, month: result.month, phase: "enrich" });
            console.log(`\n[breeze-universe] stopping — Breeze daily budget spent, mid-way through ${symbol} (${ym(result.year, result.month)}). Re-run this SAME command tomorrow, it resumes exactly here.`);
            await pool.end();
            process.exit(0);
        }
        if (result.status === "verify-failed") {
            saveProgress({ symbol, index: i, total: universe.length, year: result.year, month: result.month, phase: "verify" });
            console.error(`\n[breeze-universe] STOPPING at ${symbol} ${ym(result.year, result.month)} — verification found failing symbols and --stop-on-verify-fail is set.`);
            await pool.end();
            process.exit(2);
        }
        console.log(`[breeze-universe] ${symbol}: done`);
    }

    console.log(`\n[breeze-universe] universe complete: ${universe.length} symbols, ${fromYear}..${toYear}.`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[breeze-universe] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
