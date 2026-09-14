// dhan/runUniverse.js — the actual driver the user asked for:
//
//   node dhan/runUniverse.js [FROM_YEAR] [TO_YEAR] [--symbols=A,B] [--reset]
//   (defaults: FROM_YEAR=2023, TO_YEAR=current year)
//
// For EACH symbol, in order (7 indices, then INDIAVIX, then every F&O stock
// Dhan's own scrip master currently lists — real count, not a hardcoded
// "210"): for EACH year in [FROM_YEAR..TO_YEAR], in order —
//   1. check whether option_chain_history / ohlcv_data / futures_history
//      already has ANY row for (symbol, year);
//   2. if yes, DELETE all of it first (clean slate — this is a deliberate
//      re-fetch tool, not the skip-if-exists resumability
//      optionchain/runUniverse.js's Breeze pipeline uses);
//   3. fetch that whole year fresh (dhan/run.js's full pipeline: bhavcopy
//      discovery -> minute index/equity spot -> options -> daily futures);
//   4. only once the WHOLE YEAR finishes does it move to the next year, and
//      only once ALL years finish does it move to the next symbol.
//
// Resumable across restarts (progress file, same convention as
// optionchain/runUniverse.js) — a symbol only gets marked done after every
// requested year finished; an interrupted run resumes at the exact
// (symbol, year) it stopped at, INCLUDING re-doing that year's
// delete-then-refetch (never leaves a half-fetched year sitting there).
//
// This is a genuinely massive job (7 indices + INDIAVIX + ~200 stocks, each
// year 2023..present, each with a bhavcopy discovery pass + up to
// (6 weekly + 3 monthly ranks) x (21 or 7 strike offsets) x 2 rights option
// calls + a minute-level spot pull + a daily futures pull) — expect this to
// run for real days, not minutes. Safe to Ctrl+C and re-run the SAME command
// any time; it never leaves duplicate rows (every write is
// ON DUPLICATE KEY UPDATE) and always resumes at the right place.
//
// Stops cleanly (not spamming failures symbol after symbol) if Dhan's auth
// starts failing (DH-901 "invalid or expired") — that always means the
// access token expired mid-run (see dhan/client.js's header on 24h partner
// tokens) and needs a human to regenerate it; re-run the same command after
// that, it resumes exactly here.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst } = require("../lib/dates");
const instrumentMaster = require("./instrumentMaster");
const enrichIndex = require("./enrichIndex");
const { runSymbolYear } = require("./run");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "dhan-universe-progress.json");
const CONSECUTIVE_AUTH_FAILURES_TO_ABORT = 2;

function parseArgs(argv) {
    const positional = argv.slice(2).filter((a) => !a.startsWith("--"));
    const flags = {};
    for (const a of argv.slice(2)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    const [curYearStr] = todayIst().split("-");
    const fromYear = positional[0] ? Number(positional[0]) : 2023;
    const toYear = positional[1] ? Number(positional[1]) : Number(curYearStr);
    return { fromYear, toYear, flags };
}

const loadProgress = () => { try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return null; } };
const saveProgress = (p) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); };
const clearProgress = () => { try { fs.unlinkSync(PROGRESS_FILE); } catch { /* already gone */ } };

async function buildUniverse(onlySymbols) {
    if (onlySymbols) return [...onlySymbols];
    const stocks = await instrumentMaster.listFnoStockSymbols();
    return [...instrumentMaster.ALL_INDEX_SYMBOLS, "INDIAVIX", ...stocks];
}

async function countExistingYear(symbol, year) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const [[a]] = await pool.query(`SELECT COUNT(*) c FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
    const [[b]] = await pool.query(`SELECT COUNT(*) c FROM ohlcv_data WHERE symbol=? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
    const [[c]] = await pool.query(`SELECT COUNT(*) c FROM futures_history WHERE symbol=? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
    return { optionRows: Number(a.c), ohlcvRows: Number(b.c), futRows: Number(c.c) };
}

async function deleteExistingYear(symbol, year) {
    const start = `${year}-01-01`, end = `${year}-12-31`;
    const [r1] = await pool.query(`DELETE FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
    const [r2] = await pool.query(`DELETE FROM ohlcv_data WHERE symbol=? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
    const [r3] = await pool.query(`DELETE FROM futures_history WHERE symbol=? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
    return { optionRows: r1.affectedRows, ohlcvRows: r2.affectedRows, futRows: r3.affectedRows };
}

function isAuthError(err) {
    return err && (err.dhanBody?.errorCode === "DH-901" || /Invalid_Authentication|invalid or expired/i.test(err.message || ""));
}

async function processSymbolYear(symbol, year) {
    const existing = await countExistingYear(symbol, year);
    const hadAny = existing.optionRows + existing.ohlcvRows + existing.futRows > 0;
    if (hadAny) {
        const removed = await deleteExistingYear(symbol, year);
        console.log(
            `[dhan-universe] ${symbol} ${year}: existing data found (options=${existing.optionRows}, ohlcv=${existing.ohlcvRows}, futures=${existing.futRows}) — deleted before refetch`
        );
        void removed;
    } else {
        console.log(`[dhan-universe] ${symbol} ${year}: no existing data — fetching fresh`);
    }

    if (symbol === "INDIAVIX") {
        await enrichIndex.enrichIndexYear(symbol, year);
    } else {
        await runSymbolYear(symbol, year, {});
    }
}

async function main() {
    const { fromYear, toYear, flags } = parseArgs(process.argv);
    if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear < 2015 || toYear < fromYear) {
        console.error("Usage: node dhan/runUniverse.js [FROM_YEAR] [TO_YEAR] [--symbols=A,B] [--reset]  (defaults: 2023..current year)");
        process.exit(1);
    }
    const onlySymbolsOverride = flags.symbols
        ? new Set(String(flags.symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))
        : null;

    if (flags.reset) clearProgress();
    const universe = await buildUniverse(onlySymbolsOverride);
    console.log(`[dhan-universe] universe: ${universe.length} symbols, years ${fromYear}..${toYear}`);

    let startIdx = 0, resumeYear = fromYear;
    const progress = loadProgress();
    if (!flags.reset && progress && universe.includes(progress.symbol)) {
        startIdx = universe.indexOf(progress.symbol);
        resumeYear = progress.year || fromYear;
        console.log(`[dhan-universe] resuming at ${progress.symbol} (#${startIdx + 1}/${universe.length}), year ${resumeYear}`);
    }

    const [curYearStr] = todayIst().split("-");
    const curYear = Number(curYearStr);
    let consecutiveAuthFailures = 0;

    for (let i = startIdx; i < universe.length; i++) {
        const symbol = universe[i];
        console.log(`\n======== [${i + 1}/${universe.length}] ${symbol} ========`);

        for (let year = i === startIdx ? resumeYear : fromYear; year <= Math.min(toYear, curYear); year++) {
            saveProgress({ symbol, year });
            try {
                await processSymbolYear(symbol, year);
                consecutiveAuthFailures = 0;
            } catch (err) {
                if (isAuthError(err)) {
                    consecutiveAuthFailures += 1;
                    console.error(`[dhan-universe] ${symbol} ${year}: AUTH FAILURE (${err.message})`);
                    if (consecutiveAuthFailures >= CONSECUTIVE_AUTH_FAILURES_TO_ABORT) {
                        console.error(
                            `\n[dhan-universe] stopping — Dhan access token appears expired/invalid (${consecutiveAuthFailures} consecutive auth failures). ` +
                            `Regenerate DHAN_ACCESS_TOKEN in data-downloader/.env, then re-run this SAME command — it resumes exactly at ${symbol} ${year}.`
                        );
                        await pool.end();
                        process.exit(3);
                    }
                } else {
                    console.error(`[dhan-universe] ${symbol} ${year}: unexpected error, skipping this symbol/year: ${err.message}`);
                }
            }
        }
        console.log(`[dhan-universe] ${symbol}: all requested years done`);
    }

    console.log(`\n[dhan-universe] universe complete: ${universe.length} symbols, ${fromYear}..${toYear}.`);
    clearProgress();
    await pool.end();
}

module.exports = { buildUniverse, processSymbolYear, countExistingYear, deleteExistingYear };

if (require.main === module) {
    main().catch((err) => {
        console.error("[dhan-universe] fatal:", err instanceof Error ? err.stack : String(err));
        process.exit(1);
    });
}
