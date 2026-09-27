// optionchain/runUniverse.js — ICICI Breeze option-chain Multi-Symbol Extraction Runner
// Supports: <FROM_YEAR> <TO_YEAR> [--from-letter=Q] [--to-letter=Z] [--symbols=A,B] [--auto-gdrive] [--reset]

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst } = require("../lib/dates");
const { NSE_INDEX_SYMBOLS } = require("../lib/nseBhavcopy");
const { BSE_INDEX_SYMBOLS } = require("../lib/bseBhavcopy");
const instrumentMaster = require("../dhan/instrumentMaster");
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

/** 7 indices (first) + every F&O stock, filtered by letter if requested */
async function buildUniverse(onlySymbols, fromLetter, toLetter) {
    if (onlySymbols) return [...onlySymbols];
    let stocks = [];
    try {
        stocks = await instrumentMaster.listFnoStockSymbols();
    } catch (e) {
        console.warn("[breeze-universe] could not load scrip master, falling back to db:", e.message);
        const [rows] = await pool.query(`SELECT DISTINCT symbol FROM option_chain_history ORDER BY symbol`);
        stocks = rows.map((r) => r.symbol).filter((s) => !SEVEN_INDICES.includes(s));
    }

    if (fromLetter || toLetter) {
        const startCh = (fromLetter || "A").toUpperCase();
        const endCh = (toLetter || "Z").toUpperCase();
        stocks = stocks.filter((s) => {
            const first = s.charAt(0).toUpperCase();
            return first >= startCh && first <= endCh;
        });
        return stocks.sort();
    }

    if (!stocks.length) {
        console.log(
            "[breeze-universe] No stock symbols discovered — covering only indices."
        );
    }
    return [...SEVEN_INDICES, ...stocks];
}

async function autoArchiveToDrive(symbol, year) {
    try {
        const archivalScript = path.join(__dirname, "../../server/services/archivalPipelineService.js");
        if (fs.existsSync(archivalScript)) {
            const archivalService = require(archivalScript);
            console.log(`[breeze-universe] 🚀 Auto-syncing ${symbol} (${year}) to Google Drive and freeing Mac disk space...`);
            await archivalService.archiveAndPruneSymbolYear("option_chain", symbol, year, true);
        }
    } catch (gErr) {
        console.warn(`[breeze-universe] Auto GDrive sync notice for ${symbol} (${year}):`, gErr.message);
    }
}

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

async function runOneSymbol(symbol, fromYear, toYear, resumeMonth, resumePhase, flags) {
    const onlySymbols = new Set([symbol]);
    const today = todayIst();
    const [curY, curM] = today.split("-").map(Number);
    const autoGdrive = Boolean(flags["auto-gdrive"] || flags.autoGdrive || flags["gdrive"]);

    for (let year = fromYear; year <= toYear; year++) {
        const monthStart = year === fromYear && resumeMonth ? resumeMonth : 1;
        let endMonth = 12;
        if (year === curY) endMonth = curM - 1;
        if (year > curY || endMonth < 1) break;
        if (monthStart > endMonth) continue;

        for (let month = monthStart; month <= endMonth; month++) {
            const phase = year === fromYear && month === monthStart && resumePhase ? resumePhase : "discovery";
            const { first, last } = monthBounds(year, month);

            const outcome = await runMonth(year, month, phase, { onlySymbols, flags });
            if (outcome === "budget-exhausted") return { status: "budget-exhausted", year, month };
            if (outcome === "verify-failed") return { status: "verify-failed", year, month };

            const dupes = await checkNoDuplicates(first, last, symbol);
            if (dupes.length) {
                console.error(`[breeze-universe] ⚠ DUPLICATE rows for ${symbol} ${ym(year, month)}:`);
                for (const d of dupes) console.error(`  - ${d.symbol} ${d.expiry} strike ${d.strike} ${d.trade_date} ${d.trade_time}: ${d.c} rows`);
            }
        }

        // Year completed for this symbol — auto upload to GDrive if requested
        if (autoGdrive) {
            await autoArchiveToDrive(symbol, year);
        }

        resumeMonth = null;
        resumePhase = null;
    }
    return { status: "symbol-complete" };
}

async function main() {
    const { fromYear, toYear, flags } = parseArgs(process.argv);
    if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear < 2015 || toYear < fromYear) {
        console.error("Usage: node optionchain/runUniverse.js <FROM_YEAR> <TO_YEAR> [--from-letter=Q] [--to-letter=Z] [--symbols=A,B] [--auto-gdrive] [--reset]");
        process.exit(1);
    }
    const onlySymbolsOverride = flags.symbols
        ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))
        : null;

    const fromLetter = flags["from-letter"] || flags.fromLetter || flags["start-letter"] || flags.startLetter;
    const toLetter = flags["to-letter"] || flags.toLetter || flags["end-letter"] || flags.endLetter;
    const autoGdrive = Boolean(flags["auto-gdrive"] || flags.autoGdrive || flags["gdrive"]);

    if (flags.reset) clearProgress();
    const universe = await buildUniverse(onlySymbolsOverride, fromLetter, toLetter);
    console.log(
        `[breeze-universe] universe: ${universe.length} symbols${fromLetter || toLetter ? ` (Letters ${fromLetter || "A"}..${toLetter || "Z"})` : ""}, years ${fromYear}..${toYear} | Auto GDrive: ${autoGdrive ? "ENABLED" : "OFF"}`
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
            console.error(`\n[breeze-universe] STOPPING at ${symbol} ${ym(result.year, result.month)} — verification found failing symbols.`);
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
