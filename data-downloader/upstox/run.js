// upstox/run.js — Upstox option-chain enrich, year in / month by month out.
//
//   node upstox/run.js <YEAR> [--from-month=N] [--to-month=N] [--symbols=A,B]
//                      [--strikes-per-side=N] [--skip-verify] [--stop-on-verify-fail] [--reset]
//
// Upstox needs NO separate discovery phase the way Breeze does — its
// Expired Instruments API discovers its own contracts (upstox.getExpiries +
// getExpiredOptionContracts). So each month here is just enrich -> verify.
// Writes to the SAME option_chain_history table the Breeze/bhavcopy pipeline
// uses (ON DUPLICATE KEY UPDATE — a later, more-granular source legitimately
// upgrades an earlier one for the same contract/minute, never a conflict),
// so verify reuses optionchain/verifyMonth.js unchanged.
//
// *** Upstox's own real limit: its expired-instruments API only reaches
// back roughly 6-11 months (confirmed both from Upstox's official docs —
// "up to six months of historical expiries" — and a live getExpiries() call
// on 2026-09-11 that returned expiries back to 2024-10-03, nothing older).
// Months outside that window just log "0 expiries in range — skipped" and
// move on; this is NOT a bug, don't chase it. For 2022 through ~Oct 2024,
// use optionchain/run.js (Breeze) instead — see data-downloader/COMMANDS.md. ***
//
// Full-chain coverage (every liquid strike, not just an ATM window) needs
// bhavcopy OI data already in option_chain_history for the target month —
// enrich.js's getLiquidStrikes reads it. Run (or have already run)
// `npm run option-chain -- <YEAR> --skip-enrich` for the same month first;
// without it, Upstox falls back to a fixed ATM +/- strikes-per-side window
// (logged loudly when that happens).
//
// No daily-session pain here (unlike Breeze) — UPSTOX_ACCESS_TOKEN is a
// long-lived (~1yr) token, so this can run start-to-finish in one sitting.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst, monthBounds } = require("../lib/dates");
const { backfillOneSymbol } = require("./enrich");
const { verifyMonth } = require("../optionchain/verifyMonth");

const DATA_DIR = path.join(__dirname, "..", "data");
const REPORTS_DIR = path.join(DATA_DIR, "upstox-pipeline-reports");
const PROGRESS_FILE = path.join(DATA_DIR, "upstox-pipeline-progress.json");

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
    // Every symbol bhavcopy has ever discovered — Upstox itself will report
    // "0 expiries in range" (cheaply, one call) for any symbol/month outside
    // its real window, so it's safe to just try everything known.
    const [rows] = await pool.query(`SELECT DISTINCT symbol FROM option_chain_history ORDER BY symbol`);
    return rows.map((r) => r.symbol);
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
    const strikesPerSide = Number(flags["strikes-per-side"] || 10);

    saveProgress({ year, month });
    console.log(`\n=== ${ym(year, month)} · Upstox enrich (expiries ${first}..${last}) ===`);
    const symbols = await symbolsForMonth(onlySymbols);
    let symbolsTried = 0, symbolsErrored = 0;
    for (const symbol of symbols) {
        try {
            await backfillOneSymbol(symbol, strikesPerSide, first, last);
            symbolsTried += 1;
        } catch (err) {
            symbolsErrored += 1;
            console.error(`[upstox-run] ${symbol}: ${err instanceof Error ? err.message : err}`);
        }
    }
    console.log(`[upstox-run] ${ym(year, month)}: ${symbolsTried} symbols tried, ${symbolsErrored} errored`);

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
        console.error("Usage: node upstox/run.js <YEAR> [--from-month=N] [--to-month=N] [--symbols=A,B] [--strikes-per-side=N] [--skip-verify] [--stop-on-verify-fail] [--reset]");
        process.exit(1);
    }
    const onlySymbols = flags.symbols ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)) : null;

    if (flags.reset) clearProgress();
    const progress = loadProgress();
    let startMonth = flags["from-month"] ? Number(flags["from-month"]) : 1;
    if (!flags.reset && progress && progress.year === year && !flags["from-month"]) {
        startMonth = progress.month;
        console.log(`[upstox-run] resuming from ${ym(year, startMonth)}`);
    }

    const today = todayIst();
    const [curY, curM] = today.split("-").map(Number);
    let endMonth = flags["to-month"] ? Number(flags["to-month"]) : 12;
    if (year === curY) endMonth = Math.min(endMonth, curM); // Upstox can serve the CURRENT partial month too (unlike bhavcopy-dependent pipelines)
    if (year > curY || endMonth < 1) {
        console.error(`[upstox-run] nothing to do for ${year} (today is ${today}).`);
        await pool.end();
        return;
    }

    console.log(`[upstox-run] year ${year}, months ${startMonth}..${endMonth}${onlySymbols ? `, symbols: ${[...onlySymbols].join(", ")}` : ", all known symbols"}`);
    console.log(`[upstox-run] reminder: Upstox's real window is only the last ~6-11 months — earlier months will report 0 expiries and skip, that's expected.`);

    for (let month = startMonth; month <= endMonth; month++) {
        const outcome = await runMonth(year, month, { onlySymbols, flags });
        if (outcome === "verify-failed") {
            console.error(`[upstox-run] STOPPING at ${ym(year, month)} — verify failed and --stop-on-verify-fail is set.`);
            saveProgress({ year, month });
            await pool.end();
            process.exit(2);
        }
        saveProgress({ year, month: month + 1 });
    }

    console.log(`\n[upstox-run] year ${year} complete for months ${startMonth}..${endMonth}. Reports in ${REPORTS_DIR}`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[upstox-run] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
