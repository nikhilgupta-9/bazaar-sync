// futures/run.js — futures ("future chain") history, year in, month by month out.
//
//   node futures/run.js <YEAR> [flags]     (or: npm run futures -- <YEAR>)
//
// The futures counterpart to optionchain/run.js. Per calendar month, in order:
//   1. discovery — NSE + BSE bhavcopy FUTURES rows (IDF/STF) → one EOD row per
//      (symbol, expiry) in futures_history (futures/monthDiscovery.js).
//   2. enrich    — for every symbol found, Breeze 1-minute futures candles per
//      contract (futures/enrich.js's backfillSymbol).
//   3. verify    — every discovered contract got minute data? expiries sane?
//      no rows past expiry? → data/futures-pipeline-reports/<ym>.json.
// Then the next month.
//
// Resumable via data/futures-pipeline-progress.json. Far fewer contracts than
// options (one series per (symbol, expiry), no strikes) so a full year of the
// ~215-symbol universe is a fraction of the option-chain call volume — but
// still bounded by Breeze's 5,000/day cap, and still exits 0 / resumes next
// day if the budget runs out mid-month.
//
// Flags: --from-month=N --to-month=N --symbols=A,B --skip-discovery
//        --skip-enrich --skip-verify --stop-on-verify-fail --reset

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst } = require("../lib/dates");
const rateLimiter = require("../breeze/rateLimiter");
const { discoverMonth } = require("./monthDiscovery");
const { backfillSymbol } = require("./enrich");
const { verifyMonth } = require("./verifyMonth");
const { monthBounds } = require("../lib/dates");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "futures-pipeline-progress.json");
const REPORTS_DIR = path.join(DATA_DIR, "futures-pipeline-reports");
const PHASES = ["discovery", "enrich", "verify"];

const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;

function parseArgs(argv) {
    const year = Number(argv[2]);
    const flags = {};
    for (const a of argv.slice(3)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return { year, flags };
}
const loadProgress = () => { try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return null; } };
const saveProgress = (p) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); };
const clearProgress = () => { try { fs.unlinkSync(PROGRESS_FILE); } catch { /* gone */ } };

async function symbolsForMonth(first, last, onlySymbols) {
    const [rows] = await pool.query(
        `SELECT DISTINCT symbol FROM futures_history WHERE trade_date BETWEEN ? AND ? ORDER BY symbol`,
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

function printVerifySummary(report, file) {
    const s = report.summary;
    console.log(`\n[verify] ${ym(report.year, report.month)} — ${report.tradingDaysInMonth} trading days`);
    console.log(`[verify]   symbols: ${s.symbolsPass} pass / ${s.symbolsFail} fail (of ${s.symbolsTotal})`);
    if (s.indicesMissingEntirely.length) console.log(`[verify]   ⚠ indices with NO futures data: ${s.indicesMissingEntirely.join(", ")}`);
    if (s.tradingDaysWithoutAnyIndex.length) console.log(`[verify]   ⚠ trading days with no index-future data: ${s.tradingDaysWithoutAnyIndex.join(", ")}`);
    for (const x of report.symbols.filter((x) => !x.pass).slice(0, 25)) {
        console.log(`[verify]   ✗ ${x.symbol}: ${x.problems.join("; ")} (minute coverage ${x.minuteCoveragePct}%)`);
    }
    const failing = report.symbols.filter((x) => !x.pass).length;
    if (failing > 25) console.log(`[verify]   ...and ${failing - 25} more failing symbols (see report)`);
    console.log(`[verify]   full report: ${file}\n`);
}

async function runMonth(year, month, startPhase, opts) {
    const { first, last } = monthBounds(year, month);
    const { onlySymbols, flags } = opts;
    let phaseIdx = PHASES.indexOf(startPhase);
    if (phaseIdx < 0) phaseIdx = 0;

    if (phaseIdx <= PHASES.indexOf("discovery") && !flags["skip-discovery"]) {
        saveProgress({ year, month, phase: "discovery" });
        console.log(`\n=== ${ym(year, month)} · futures discovery (NSE + BSE bhavcopy, ${first}..${last}) ===`);
        const d = await discoverMonth(year, month, { onlySymbols });
        console.log(
            `[fut-discovery] done: days ok=${d.daysOk} failed=${d.daysFailed} skipped=${d.daysSkipped}, ` +
            `${d.rowsStored} rows, ${d.symbolsSeen.size} symbols` +
            (d.failedDates.length ? `\n[fut-discovery] failed dates (likely holidays): ${d.failedDates.join(", ")}` : "")
        );
    }

    if (phaseIdx <= PHASES.indexOf("enrich") && !flags["skip-enrich"]) {
        saveProgress({ year, month, phase: "enrich" });
        const symbols = await symbolsForMonth(first, last, onlySymbols);
        console.log(`\n=== ${ym(year, month)} · futures enrich · ${symbols.length} symbols · Breeze budget left: ${rateLimiter.remainingToday()} ===`);
        if (rateLimiter.remainingToday() <= 0) {
            console.log("[fut-enrich] Breeze daily budget already spent — re-run tomorrow, resumes here.");
            return "budget-exhausted";
        }
        let totalRows = 0, totalFailed = 0, symbolsEnriched = 0, symbolsAlreadyDone = 0;
        for (const symbol of symbols) {
            try {
                const r = await backfillSymbol(symbol, first, last);
                totalRows += r.rowsStored;
                totalFailed += r.contractsFailed;
                if (!r.contractsTotal || r.contractsSkipped === r.contractsTotal) symbolsAlreadyDone += 1;
                else {
                    symbolsEnriched += 1;
                    console.log(`[fut-enrich] ${symbol}: ${r.contractsTotal} contracts (${r.contractsSkipped} done), ${r.rowsStored} rows, ${r.contractsFailed} failed`);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/daily call budget spent/i.test(msg)) {
                    console.log(`\n[fut-enrich] ${msg}`);
                    console.log(`[fut-enrich] stopping for today — ${symbolsEnriched} symbols enriched, ${totalRows} rows. Re-run tomorrow.`);
                    saveProgress({ year, month, phase: "enrich" });
                    return "budget-exhausted";
                }
                console.error(`[fut-enrich] ${symbol}: unexpected error: ${msg}`);
            }
        }
        console.log(`[fut-enrich] ${ym(year, month)} pass complete: ${symbolsEnriched} enriched, ${symbolsAlreadyDone} already done, ${totalRows} rows, ${totalFailed} failures. Budget left: ${rateLimiter.remainingToday()}`);
    }

    if (phaseIdx <= PHASES.indexOf("verify") && !flags["skip-verify"]) {
        saveProgress({ year, month, phase: "verify" });
        const report = await verifyMonth(year, month, { onlySymbols });
        const file = writeReport(report);
        printVerifySummary(report, file);
        if (flags["stop-on-verify-fail"] && report.summary.symbolsFail > 0) return "verify-failed";
    }
    return "month-complete";
}

async function main() {
    const { year, flags } = parseArgs(process.argv);
    if (!Number.isInteger(year) || year < 2015 || year > 2100) {
        console.error("Usage: node futures/run.js <YEAR> [--from-month=N] [--to-month=N] [--symbols=A,B] [--skip-discovery] [--skip-enrich] [--skip-verify] [--stop-on-verify-fail] [--reset]");
        process.exit(1);
    }
    const onlySymbols = flags.symbols ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)) : null;

    if (flags.reset) clearProgress();
    const progress = loadProgress();
    let startMonth = flags["from-month"] ? Number(flags["from-month"]) : 1;
    let startPhase = "discovery";
    if (!flags.reset && progress && progress.year === year && !flags["from-month"]) {
        startMonth = progress.month;
        startPhase = progress.phase || "discovery";
        console.log(`[fut] resuming from ${ym(year, startMonth)} · ${startPhase}`);
    }

    const today = todayIst();
    const [curY, curM] = today.split("-").map(Number);
    let endMonth = flags["to-month"] ? Number(flags["to-month"]) : 12;
    if (year === curY) endMonth = Math.min(endMonth, curM - 1);
    if (year > curY || endMonth < 1) {
        console.error(`[fut] nothing to do — ${year} has no completed months yet (today is ${today}).`);
        await pool.end();
        return;
    }

    console.log(`[fut] year ${year}, months ${startMonth}..${endMonth}${onlySymbols ? `, symbols: ${[...onlySymbols].join(", ")}` : ", all F&O symbols"}`);
    console.log(`[fut] Breeze daily budget remaining today: ${rateLimiter.remainingToday()}`);

    for (let month = startMonth; month <= endMonth; month++) {
        const phase = month === startMonth ? startPhase : "discovery";
        const outcome = await runMonth(year, month, phase, { onlySymbols, flags });
        if (outcome === "budget-exhausted") { await pool.end(); process.exit(0); }
        if (outcome === "verify-failed") {
            console.error(`[fut] STOPPING at ${ym(year, month)} — verify failed and --stop-on-verify-fail is set.`);
            saveProgress({ year, month, phase: "verify" });
            await pool.end();
            process.exit(2);
        }
        saveProgress({ year, month: month + 1, phase: "discovery" });
    }

    console.log(`\n[fut] year ${year} complete for months ${startMonth}..${endMonth}. Reports in ${REPORTS_DIR}`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[fut] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
