// optionchain/run.js — the CLI the whole folder builds toward.
//
//   node optionchain/run.js <YEAR> [flags]
//
// Walks a calendar year MONTH BY MONTH. For each month, in order:
//   1. discovery — NSE + BSE bhavcopy → every (symbol, expiry, strike) that
//      traded that month, as EOD rows in option_chain_history
//      (monthDiscovery.js). This is the contract/expiry universe.
//   2. enrich    — for every symbol found, ask ICICI Breeze for 1-minute
//      CE/PE candles on each discovered contract + compute Greeks, upserting
//      minute rows over the EOD ones (reuses backfillBreeze.js's backfillSymbol).
//   3. verify    — check every discovered contract actually got minute data,
//      every expiry looks sane, no rows past expiry (verifyMonth.js). Writes
//      a JSON report and prints a summary.
// Then it moves to the next month.
//
// RESUMABLE. Progress (year / month / phase) is persisted to
// data/breeze-pipeline-progress.json. Breeze's real limit is
// 5,000 calls/day (breeze/rateLimiter.js) — a full month of the
// ~215-symbol F&O universe at every-strike / 1-minute is FAR more than one
// day's budget, so the enrich phase will routinely exhaust the budget
// mid-month, save progress, and exit 0 telling you to re-run tomorrow. It
// picks up exactly where it stopped (already-enriched contracts are skipped
// instantly). Expect a full year to take many real days of daily re-runs —
// that is ICICI's rate limit, not a bug here.
//
// Flags:
//   --from-month=N        start at month N (1-12); default: resume point, or 1
//   --to-month=N          stop after month N; default: 12 (or current month if YEAR is the current year)
//   --symbols=A,B,C       restrict every phase to these symbols (testing)
//   --skip-discovery      assume option_chain_history already has the month's contracts
//   --skip-enrich         discovery + verify only (no Breeze calls)
//   --skip-verify         discovery + enrich only
//   --stop-on-verify-fail exit non-zero (and stop advancing) if any symbol fails verification for a month
//   --reset               ignore any saved progress and start fresh from --from-month (or 1)
//
// Standalone — see data-downloader/README.md. Nothing here is on the live path.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst } = require("../lib/dates");
const rateLimiter = require("../breeze/rateLimiter");
const { discoverMonth, monthBounds } = require("./monthDiscovery");
const { backfillSymbol } = require("../breeze/enrich");
const { verifyMonth } = require("./verifyMonth");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "breeze-pipeline-progress.json");
const REPORTS_DIR = path.join(DATA_DIR, "breeze-pipeline-reports");

const PHASES = ["discovery", "enrich", "verify"];

function parseArgs(argv) {
    const year = Number(argv[2]);
    const flags = {};
    for (const a of argv.slice(3)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (!m) continue;
        flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return { year, flags };
}

function loadProgress() {
    try {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    } catch {
        return null;
    }
}

function saveProgress(p) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function clearProgress() {
    try { fs.unlinkSync(PROGRESS_FILE); } catch { /* already gone */ }
}

/** 'YYYY-MM' comparison-safe month key. */
function ym(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

async function symbolsForMonth(first, last, onlySymbols) {
    const [rows] = await pool.query(
        `SELECT DISTINCT symbol FROM option_chain_history WHERE trade_date BETWEEN ? AND ? ORDER BY symbol`,
        [first, last]
    );
    let symbols = rows.map((r) => r.symbol);
    if (onlySymbols) symbols = symbols.filter((s) => onlySymbols.has(s));
    return symbols;
}

function writeReport(report) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const file = path.join(REPORTS_DIR, `${ym(report.year, report.month)}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    return file;
}

function printVerifySummary(report, reportFile) {
    const s = report.summary;
    console.log(`\n[verify] ${ym(report.year, report.month)} — ${report.tradingDaysInMonth} trading days`);
    console.log(`[verify]   symbols: ${s.symbolsPass} pass / ${s.symbolsFail} fail (of ${s.symbolsTotal})`);
    if (s.indicesMissingEntirely.length) console.log(`[verify]   ⚠ indices with NO data at all: ${s.indicesMissingEntirely.join(", ")}`);
    if (s.tradingDaysWithoutAnyIndex.length) console.log(`[verify]   ⚠ trading days with no index data: ${s.tradingDaysWithoutAnyIndex.join(", ")}`);
    const failing = report.symbols.filter((x) => !x.pass);
    for (const x of failing.slice(0, 25)) {
        console.log(`[verify]   ✗ ${x.symbol}: ${x.problems.join("; ")} (minute coverage ${x.minuteCoveragePct}%)`);
    }
    if (failing.length > 25) console.log(`[verify]   ...and ${failing.length - 25} more failing symbols (see report)`);
    console.log(`[verify]   full report: ${reportFile}\n`);
}

async function runMonth(year, month, startPhase, opts) {
    const { first, last } = monthBounds(year, month);
    const { onlySymbols, flags } = opts;
    let phaseIdx = PHASES.indexOf(startPhase);
    if (phaseIdx < 0) phaseIdx = 0;

    // ----- discovery -----
    if (phaseIdx <= PHASES.indexOf("discovery") && !flags["skip-discovery"]) {
        saveProgress({ year, month, phase: "discovery" });
        console.log(`\n=== ${ym(year, month)} · discovery (NSE + BSE bhavcopy, ${first}..${last}) ===`);
        const d = await discoverMonth(year, month, { onlySymbols });
        console.log(
            `[discovery] done: days ok=${d.daysOk} failed=${d.daysFailed} skipped=${d.daysSkipped}, ` +
            `${d.rowsStored} contract-rows, ${d.symbolsSeen.size} distinct symbols` +
            (d.failedDates.length ? `\n[discovery] failed dates (likely holidays): ${d.failedDates.join(", ")}` : "")
        );
    }

    // ----- enrich (Breeze 1-minute) -----
    if (phaseIdx <= PHASES.indexOf("enrich") && !flags["skip-enrich"]) {
        saveProgress({ year, month, phase: "enrich" });
        const symbols = await symbolsForMonth(first, last, onlySymbols);
        console.log(`\n=== ${ym(year, month)} · enrich · ${symbols.length} symbols · Breeze budget left today: ${rateLimiter.remainingToday()} ===`);

        if (rateLimiter.remainingToday() <= 0) {
            console.log("[enrich] Breeze daily call budget already spent. Re-run this same command tomorrow — it resumes here.");
            saveProgress({ year, month, phase: "enrich" });
            return "budget-exhausted";
        }

        let totalRows = 0, totalFailed = 0, symbolsEnriched = 0, symbolsAlreadyDone = 0;
        for (const symbol of symbols) {
            try {
                const r = await backfillSymbol(symbol, first, last);
                totalRows += r.rowsStored;
                totalFailed += r.contractsFailed;
                if (!r.contractsTotal || r.contractsSkipped === r.contractsTotal) {
                    symbolsAlreadyDone += 1;
                } else {
                    symbolsEnriched += 1;
                    console.log(`[enrich] ${symbol}: ${r.contractsTotal} contracts (${r.contractsSkipped} already done), ${r.rowsStored} rows, ${r.contractsFailed} failed`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/daily call budget spent/i.test(msg)) {
                    console.log(`\n[enrich] ${msg}`);
                    console.log(`[enrich] stopping for today — ${symbolsEnriched} symbols enriched this run, ${totalRows} rows stored. Re-run tomorrow, it resumes mid-month.`);
                    saveProgress({ year, month, phase: "enrich" });
                    return "budget-exhausted";
                }
                console.error(`[enrich] ${symbol}: unexpected error: ${msg}`);
            }
        }
        console.log(`[enrich] ${ym(year, month)} enrich pass complete: ${symbolsEnriched} enriched, ${symbolsAlreadyDone} already done, ${totalRows} rows, ${totalFailed} contract failures. Budget left: ${rateLimiter.remainingToday()}`);
    }

    // ----- verify -----
    if (phaseIdx <= PHASES.indexOf("verify") && !flags["skip-verify"]) {
        saveProgress({ year, month, phase: "verify" });
        const report = await verifyMonth(year, month, { onlySymbols });
        const file = writeReport(report);
        printVerifySummary(report, file);
        if (flags["stop-on-verify-fail"] && report.summary.symbolsFail > 0) {
            return "verify-failed";
        }
    }

    return "month-complete";
}

async function main() {
    const { year, flags } = parseArgs(process.argv);
    if (!Number.isInteger(year) || year < 2015 || year > 2100) {
        console.error("Usage: node optionchain/run.js <YEAR> [--from-month=N] [--to-month=N] [--symbols=A,B] [--skip-discovery] [--skip-enrich] [--skip-verify] [--stop-on-verify-fail] [--reset]");
        process.exit(1);
    }

    const onlySymbols = flags.symbols ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)) : null;

    if (flags.reset) clearProgress();
    const progress = loadProgress();

    // Determine start month + phase.
    let startMonth = flags["from-month"] ? Number(flags["from-month"]) : 1;
    let startPhase = "discovery";
    if (!flags.reset && progress && progress.year === year && !flags["from-month"]) {
        startMonth = progress.month;
        startPhase = progress.phase || "discovery";
        console.log(`[pipeline] resuming from saved progress: ${ym(year, startMonth)} · ${startPhase}`);
    }

    // Never process a month that isn't over yet.
    const today = todayIst();
    const [curY, curM] = today.split("-").map(Number);
    let endMonth = flags["to-month"] ? Number(flags["to-month"]) : 12;
    if (year === curY) endMonth = Math.min(endMonth, curM - 1); // last COMPLETE month
    if (year > curY || endMonth < 1) {
        console.error(`[pipeline] nothing to do — ${year} has no completed months yet (today is ${today}).`);
        await pool.end();
        return;
    }

    console.log(`[pipeline] year ${year}, months ${startMonth}..${endMonth}${onlySymbols ? `, symbols: ${[...onlySymbols].join(", ")}` : ", all F&O symbols"}`);
    console.log(`[pipeline] Breeze daily budget remaining today: ${rateLimiter.remainingToday()}`);

    for (let month = startMonth; month <= endMonth; month++) {
        const phaseForThisMonth = month === startMonth ? startPhase : "discovery";
        const outcome = await runMonth(year, month, phaseForThisMonth, { onlySymbols, flags });

        if (outcome === "budget-exhausted") {
            await pool.end();
            process.exit(0);
        }
        if (outcome === "verify-failed") {
            console.error(`[pipeline] STOPPING at ${ym(year, month)} — verification found failing symbols and --stop-on-verify-fail is set. Fix / re-run, then continue.`);
            saveProgress({ year, month, phase: "verify" });
            await pool.end();
            process.exit(2);
        }
        // month done — advance
        saveProgress({ year, month: month + 1, phase: "discovery" });
    }

    console.log(`\n[pipeline] year ${year} complete for months ${startMonth}..${endMonth}. Reports in ${REPORTS_DIR}`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[pipeline] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
