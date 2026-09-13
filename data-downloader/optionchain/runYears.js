// optionchain/runYears.js — loop the option-chain pipeline across MULTIPLE
// years in one command (run.js only takes one year per invocation), plus an
// explicit duplicate-row check after every month.
//
//   node optionchain/runYears.js <FROM_YEAR> <TO_YEAR> [flags]
//
// Same three phases per month as run.js (discovery -> enrich -> verify),
// reusing run.js's own runMonth() so there's exactly one copy of that logic.
// This file only adds: (1) looping straight from FROM_YEAR into TO_YEAR
// within the same process run (no separate command per year), and (2) after
// each month's ingestion, an explicit duplicate check.
//
// On duplicates: option_chain_history's UNIQUE KEY uniq_snapshot(symbol,
// expiry, strike, trade_date, trade_time) already makes a true duplicate
// row impossible to INSERT — every writer in this codebase upserts via
// ON DUPLICATE KEY UPDATE, so a re-run can only refresh an existing row,
// never add a second one for the same key. checkNoDuplicates() below queries
// for it directly anyway, so every run PRINTS visible proof of that instead
// of only relying on "the schema should prevent it" — and would catch it
// immediately if this particular database's unique key were ever missing
// (see CLAUDE.md's open schema-audit item).
//
// RESUMABLE, same model as run.js: progress (year/month/phase) persisted to
// data/breeze-pipeline-years-progress.json (a SEPARATE file from run.js's
// own — run.js's runMonth() still writes its own progress file too as a
// side effect, which is harmless: both always reflect real, accurate state).
// Breeze's daily budget (breeze/rateLimiter.js) will routinely run out
// mid-run; this stops cleanly and tells you to re-run the SAME command —
// it picks up exactly where it stopped, including mid-way through a
// multi-year range.
//
// Flags: same as run.js — --symbols=A,B, --skip-discovery, --skip-enrich,
// --skip-verify, --stop-on-verify-fail, --reset. --from-month applies only
// to FROM_YEAR, --to-month only to TO_YEAR — years in between always run
// their full 12 months (i.e. "FROM_YEAR-from-month through TO_YEAR-to-month").
//
// Usage:
//   node optionchain/runYears.js 2024 2025 --symbols=NIFTY
//   node optionchain/runYears.js 2024 2025                    # all F&O symbols

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst } = require("../lib/dates");
const rateLimiter = require("../breeze/rateLimiter");
const { monthBounds } = require("./monthDiscovery");
const { runMonth } = require("./run");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "breeze-pipeline-years-progress.json");

function parseArgs(argv) {
    const fromYear = Number(argv[2]);
    const toYear = Number(argv[3]);
    const flags = {};
    for (const a of argv.slice(4)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (!m) continue;
        flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return { fromYear, toYear, flags };
}

function loadProgress() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return null; }
}
function saveProgress(p) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}
function clearProgress() {
    try { fs.unlinkSync(PROGRESS_FILE); } catch { /* already gone */ }
}

function ym(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Explicit "no duplicate rows" proof for one month, straight off
 * option_chain_history. A duplicate here would mean two-or-more rows sharing
 * the exact same (symbol, expiry, strike, trade_date, trade_time) key —
 * structurally prevented by the table's UNIQUE KEY, so this should always
 * come back empty. Capped at 20 so a genuine widespread problem can't flood
 * the log.
 */
async function checkNoDuplicates(first, last, onlySymbols) {
    const params = [first, last];
    let symbolFilter = "";
    if (onlySymbols && onlySymbols.size) {
        symbolFilter = " AND symbol IN (?)";
        params.push([...onlySymbols]);
    }
    const [rows] = await pool.query(
        `SELECT symbol, expiry, strike, trade_date, trade_time, COUNT(*) AS c
         FROM option_chain_history
         WHERE trade_date BETWEEN ? AND ?${symbolFilter}
         GROUP BY symbol, expiry, strike, trade_date, trade_time
         HAVING c > 1
         LIMIT 20`,
        params
    );
    return rows;
}

async function main() {
    const { fromYear, toYear, flags } = parseArgs(process.argv);
    if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear < 2015 || toYear < fromYear) {
        console.error("Usage: node optionchain/runYears.js <FROM_YEAR> <TO_YEAR> [--symbols=A,B] [--skip-discovery] [--skip-enrich] [--skip-verify] [--stop-on-verify-fail] [--reset]");
        process.exit(1);
    }
    const onlySymbols = flags.symbols
        ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))
        : null;

    if (flags.reset) clearProgress();
    const progress = loadProgress();

    let startYear = fromYear, startMonth = flags["from-month"] ? Number(flags["from-month"]) : 1, startPhase = "discovery";
    if (!flags.reset && progress && progress.year >= fromYear && progress.year <= toYear && !flags["from-month"]) {
        startYear = progress.year;
        startMonth = progress.month;
        startPhase = progress.phase || "discovery";
        console.log(`[years] resuming from saved progress: ${ym(startYear, startMonth)} · ${startPhase}`);
    }

    const today = todayIst();
    const [curY] = today.split("-").map(Number);

    console.log(`[years] looping ${startYear}..${toYear}${onlySymbols ? `, symbols: ${[...onlySymbols].join(", ")}` : ", all F&O symbols"}`);
    console.log(`[years] Breeze daily budget remaining today: ${rateLimiter.remainingToday()}`);

    for (let year = startYear; year <= toYear; year++) {
        const monthStart = year === startYear ? startMonth : 1;
        const [, curM] = today.split("-").map(Number);
        // --to-month applies only to the LAST year in the range (matching
        // "give me FROM_YEAR-from-month through TO_YEAR-to-month" — years in
        // between always run their full 12 months). --from-month, symmetrically,
        // only ever affects startYear (set above).
        let endMonth = year === toYear && flags["to-month"] ? Number(flags["to-month"]) : 12;
        if (year === curY) endMonth = Math.min(endMonth, curM - 1); // never a month that isn't over yet
        if (year > curY || endMonth < 1) {
            console.log(`[years] ${year} has no completed months yet — stopping the loop here.`);
            break;
        }
        if (monthStart > endMonth) continue; // this year was already fully done in an earlier run

        for (let month = monthStart; month <= endMonth; month++) {
            const phaseForThisMonth = year === startYear && month === monthStart ? startPhase : "discovery";
            const { first, last } = monthBounds(year, month);

            const outcome = await runMonth(year, month, phaseForThisMonth, { onlySymbols, flags });

            if (outcome === "budget-exhausted") {
                saveProgress({ year, month, phase: "enrich" });
                console.log(`[years] stopping — Breeze daily budget spent. Re-run this SAME command tomorrow, it resumes exactly here (${ym(year, month)}).`);
                await pool.end();
                process.exit(0);
            }
            if (outcome === "verify-failed") {
                saveProgress({ year, month, phase: "verify" });
                console.error(`[years] STOPPING at ${ym(year, month)} — verification found failing symbols and --stop-on-verify-fail is set. Fix / re-run, then continue.`);
                await pool.end();
                process.exit(2);
            }

            const dupes = await checkNoDuplicates(first, last, onlySymbols);
            if (dupes.length) {
                console.error(`[years] ⚠ DUPLICATE rows found for ${ym(year, month)} (showing up to 20) — this should be impossible under option_chain_history's UNIQUE KEY; flag this DB for a schema check:`);
                for (const d of dupes) console.error(`  - ${d.symbol} ${d.expiry} strike ${d.strike} ${d.trade_date} ${d.trade_time}: ${d.c} rows`);
            } else {
                console.log(`[verify-dup] ${ym(year, month)}: no duplicate (symbol, expiry, strike, date, time) rows — confirmed clean.`);
            }

            saveProgress({ year, month: month + 1, phase: "discovery" });
        }
    }

    console.log(`\n[years] done — ${startYear}..${toYear} (through the last completed month) processed.`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[years] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
