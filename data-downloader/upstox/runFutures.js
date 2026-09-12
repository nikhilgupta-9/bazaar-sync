// upstox/runFutures.js — Upstox futures enrich, year in / month by month out.
//
//   node upstox/runFutures.js <YEAR> [--from-month=N] [--to-month=N]
//                             [--symbols=A,B] [--skip-verify]
//                             [--stop-on-verify-fail] [--reset]
//
// The futures counterpart to upstox/run.js (options). Upstox needs no
// separate discovery phase — enrichFutures.js's getExpiries +
// getExpiredFutureContracts discover their own contracts — so each month
// here is just enrich -> verify. Writes to futures_history (the SAME table
// futures/run.js's Breeze path uses; ON DUPLICATE KEY UPDATE, never a
// conflict), so verify reuses futures/verifyMonth.js unchanged.
//
// Same real limit as upstox/run.js: Upstox's expired-instruments API only
// reaches back ~6-11 months (confirmed 2026-09-11). Months outside that
// window log "0 expiries in range — skipped" and move on — not a bug.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst, monthBounds } = require("../lib/dates");
const { backfillOneSymbol } = require("./enrichFutures");
const { verifyMonth } = require("../futures/verifyMonth");

const DATA_DIR = path.join(__dirname, "..", "data");
const REPORTS_DIR = path.join(DATA_DIR, "upstox-futures-pipeline-reports");
const PROGRESS_FILE = path.join(DATA_DIR, "upstox-futures-pipeline-progress.json");

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

async function symbolsForMonth(onlySymbols) {
    if (onlySymbols) return [...onlySymbols];
    const [rows] = await pool.query(`SELECT DISTINCT symbol FROM futures_history ORDER BY symbol`);
    const symbols = rows.map((r) => r.symbol);
    if (symbols.length) return symbols;
    // No Breeze discovery has ever run — the 7 indices need none, so at
    // least try those rather than doing nothing.
    const upstox = require("./historicalService");
    return Object.keys(upstox.UNDERLYING_KEYS);
}

function writeReport(report) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const file = path.join(REPORTS_DIR, `${ym(report.year, report.month)}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    return file;
}

async function runMonth(year, month, opts) {
    const { first, last } = monthBounds(year, month);
    const { onlySymbols, flags } = opts;

    saveProgress({ year, month });
    console.log(`\n=== ${ym(year, month)} · Upstox futures enrich (expiries ${first}..${last}) ===`);
    const symbols = await symbolsForMonth(onlySymbols);
    let symbolsTried = 0, symbolsErrored = 0;
    for (const symbol of symbols) {
        try {
            await backfillOneSymbol(symbol, first, last);
            symbolsTried += 1;
        } catch (err) {
            symbolsErrored += 1;
            console.error(`[upstox-fut-run] ${symbol}: ${err instanceof Error ? err.message : err}`);
        }
    }
    console.log(`[upstox-fut-run] ${ym(year, month)}: ${symbolsTried} symbols tried, ${symbolsErrored} errored`);

    if (!flags["skip-verify"]) {
        const report = await verifyMonth(year, month, { onlySymbols });
        const file = writeReport(report);
        console.log(`[verify] ${ym(year, month)}: ${report.summary.symbolsPass} pass / ${report.summary.symbolsFail} fail (of ${report.summary.symbolsTotal}) — report: ${file}`);
        if (flags["stop-on-verify-fail"] && report.summary.symbolsFail > 0) return "verify-failed";
    }
    return "month-complete";
}

async function main() {
    const { year, flags } = parseArgs(process.argv);
    if (!Number.isInteger(year) || year < 2015 || year > 2100) {
        console.error("Usage: node upstox/runFutures.js <YEAR> [--from-month=N] [--to-month=N] [--symbols=A,B] [--skip-verify] [--stop-on-verify-fail] [--reset]");
        process.exit(1);
    }
    const onlySymbols = flags.symbols ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)) : null;

    if (flags.reset) clearProgress();
    const progress = loadProgress();
    let startMonth = flags["from-month"] ? Number(flags["from-month"]) : 1;
    if (!flags.reset && progress && progress.year === year && !flags["from-month"]) {
        startMonth = progress.month;
        console.log(`[upstox-fut-run] resuming from ${ym(year, startMonth)}`);
    }

    const today = todayIst();
    const [curY, curM] = today.split("-").map(Number);
    let endMonth = flags["to-month"] ? Number(flags["to-month"]) : 12;
    if (year === curY) endMonth = Math.min(endMonth, curM); // Upstox can serve the current partial month too
    if (year > curY || endMonth < 1) {
        console.error(`[upstox-fut-run] nothing to do for ${year} (today is ${today}).`);
        await pool.end();
        return;
    }

    console.log(`[upstox-fut-run] year ${year}, months ${startMonth}..${endMonth}${onlySymbols ? `, symbols: ${[...onlySymbols].join(", ")}` : ", all known symbols"}`);
    console.log(`[upstox-fut-run] reminder: Upstox's real window is only the last ~6-11 months — earlier months will report 0 expiries and skip, that's expected.`);

    for (let month = startMonth; month <= endMonth; month++) {
        const outcome = await runMonth(year, month, { onlySymbols, flags });
        if (outcome === "verify-failed") {
            console.error(`[upstox-fut-run] STOPPING at ${ym(year, month)} — verify failed and --stop-on-verify-fail is set.`);
            saveProgress({ year, month });
            await pool.end();
            process.exit(2);
        }
        saveProgress({ year, month: month + 1 });
    }

    console.log(`\n[upstox-fut-run] year ${year} complete for months ${startMonth}..${endMonth}. Reports in ${REPORTS_DIR}`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[upstox-fut-run] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
