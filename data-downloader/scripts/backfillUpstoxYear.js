// scripts/backfillUpstoxYear.js — month-by-month, symbol-by-symbol Upstox
// backfill orchestrator for one calendar YEAR (the year is YOUR input).
//
// For each symbol in the universe (7 indices, then ~210 F&O stocks), for
// each month of the year:
//   1. ask Upstox which expiries it has for that month
//   2. if none  -> mark the month "no-data" and move on (Upstox's
//      expired-instruments API only reaches ~6 months back, so for an old
//      year most/all months land here — that's expected, not an error)
//   3. otherwise run the real per-minute backfill for that expiry window
//      (scripts/backfillUpstox.js's backfillOneSymbol, scoped to the month)
//   4. VERIFY against option_chain_history that minute-level rows actually
//      landed; if not, re-fetch (backfillOneSymbol self-heals per-strike
//      gaps on a re-run via ON DUPLICATE KEY UPDATE) up to --attempts times
//   5. record the month's status to a progress file and move to the next
// After a symbol's whole year is done -> next symbol.
//
// Fully resumable: months already "complete" or "no-data" are skipped on a
// re-run (unless --force). The progress file is data/upstox-year-progress.json.
//
// Usage:
//   node scripts/backfillUpstoxYear.js <YEAR> [options]
//
//   <YEAR>                required, e.g. 2023
//   --from-month=N        first month, 1-12 (default 1)
//   --to-month=N          last month, 1-12 (default 12)
//   --only=SYM,SYM        only these symbols (comma list)
//   --start-symbol=SYM    skip every symbol before this one (resume mid-run)
//   --indices-only        only the 7 index underlyings
//   --stocks-only         only the F&O stocks
//   --strikes=N           strikes either side of ATM per expiry
//                         (default 15 for indices, 10 for stocks; the real
//                          backfill still prefers actual traded strikes when
//                          Bhavcopy OI data exists for the expiry)
//   --attempts=N          verify/refetch attempts per month (default 3)
//   --min-minute-rows=N   a month passes verify at >= this many minute-level
//                         rows (default 500 ~= one liquid strike over 2 days)
//   --force              ignore the progress file, redo every month
//   --dry-run            print the plan (universe + months) and exit, no API,
//                         no DB writes
//
// Examples:
//   node scripts/backfillUpstoxYear.js 2026 --from-month=3          # this year, Mar onward
//   node scripts/backfillUpstoxYear.js 2026 --indices-only          # 7 indices, full year
//   node scripts/backfillUpstoxYear.js 2025 --only=NIFTY,BANKNIFTY
//   node scripts/backfillUpstoxYear.js 2026 --start-symbol=RELIANCE # resume from RELIANCE

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const { addDays } = require("../utils/dateStrings");
const upstox = require("../services/upstoxHistorical");
const { backfillOneSymbol, resolveUnderlyingKey } = require("./backfillUpstox");
const { INDICES, getStockUniverse } = require("../config/universe");

const STATE_DIR = path.join(__dirname, "..", "data");
const STATE_FILE = path.join(STATE_DIR, "upstox-year-progress.json");

const TERMINAL_STATUSES = new Set(["complete", "no-data"]);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usageAndExit(msg) {
    if (msg) console.error(`\n${msg}\n`);
    console.error(
        "Usage: node scripts/backfillUpstoxYear.js <YEAR> [--from-month=N] [--to-month=N]\n" +
            "       [--only=SYM,SYM] [--start-symbol=SYM] [--indices-only] [--stocks-only]\n" +
            "       [--strikes=N] [--attempts=N] [--min-minute-rows=N] [--force] [--dry-run]"
    );
    process.exit(1);
}

function parseArgs(argv) {
    const year = Number(argv[2]);
    if (!Number.isInteger(year) || year < 2015 || year > 2100) {
        usageAndExit("First argument must be a 4-digit YEAR (e.g. 2023).");
    }
    const opt = {
        fromMonth: 1,
        toMonth: 12,
        only: null,
        startSymbol: null,
        indicesOnly: false,
        stocksOnly: false,
        strikes: null,
        attempts: 3,
        minMinuteRows: 500,
        force: false,
        dryRun: false,
    };
    for (const a of argv.slice(3)) {
        if (a === "--force") opt.force = true;
        else if (a === "--dry-run") opt.dryRun = true;
        else if (a === "--indices-only") opt.indicesOnly = true;
        else if (a === "--stocks-only") opt.stocksOnly = true;
        else if (a.startsWith("--from-month=")) opt.fromMonth = Number(a.slice(13));
        else if (a.startsWith("--to-month=")) opt.toMonth = Number(a.slice(11));
        else if (a.startsWith("--only=")) opt.only = a.slice(7).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        else if (a.startsWith("--start-symbol=")) opt.startSymbol = a.slice(15).trim().toUpperCase();
        else if (a.startsWith("--strikes=")) opt.strikes = Number(a.slice(10));
        else if (a.startsWith("--attempts=")) opt.attempts = Number(a.slice(11));
        else if (a.startsWith("--min-minute-rows=")) opt.minMinuteRows = Number(a.slice(18));
        else usageAndExit(`Unknown option: ${a}`);
    }
    if (!(opt.fromMonth >= 1 && opt.fromMonth <= 12 && opt.toMonth >= 1 && opt.toMonth <= 12 && opt.fromMonth <= opt.toMonth)) {
        usageAndExit("--from-month / --to-month must be 1-12 and from <= to.");
    }
    if (!(opt.attempts >= 1)) usageAndExit("--attempts must be >= 1.");
    if (opt.indicesOnly && opt.stocksOnly) usageAndExit("--indices-only and --stocks-only are mutually exclusive.");
    return { year, opt };
}

// ---------------------------------------------------------------------------
// Date + state helpers
// ---------------------------------------------------------------------------

function monthWindow(year, month) {
    const mm = String(month).padStart(2, "0");
    const start = `${year}-${mm}-01`;
    const firstOfNext = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const end = addDays(firstOfNext, -1);
    return { start, end, key: `${year}-${mm}` };
}

function nowIso() {
    return new Date().toISOString(); // a log timestamp, not date arithmetic
}

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
        return {};
    }
}

function saveState(state) {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ---------------------------------------------------------------------------
// Verify: what actually landed in option_chain_history for this symbol+month.
// Keyed on `expiry` (not trade_date) so it matches exactly the expiry window
// backfillOneSymbol was told to process — a monthly expiry's data legitimately
// spans the prior calendar month too (35-day lookback).
// ---------------------------------------------------------------------------

async function verifyMonth(symbol, monthStart, monthEnd) {
    const [rows] = await pool.query(
        `SELECT
             COUNT(DISTINCT expiry)     AS expiries,
             COUNT(DISTINCT strike)     AS strikes,
             COUNT(DISTINCT trade_date) AS days,
             SUM(CASE WHEN trade_time <> '15:30:00' THEN 1 ELSE 0 END) AS minuteRows,
             COUNT(*)                   AS totalRows
         FROM option_chain_history
         WHERE symbol = ? AND expiry BETWEEN ? AND ?`,
        [symbol, monthStart, monthEnd]
    );
    const r = rows[0] || {};
    return {
        expiries: Number(r.expiries || 0),
        strikes: Number(r.strikes || 0),
        days: Number(r.days || 0),
        minuteRows: Number(r.minuteRows || 0),
        totalRows: Number(r.totalRows || 0),
    };
}

// ---------------------------------------------------------------------------
// Process one (symbol, month)
// ---------------------------------------------------------------------------

async function processMonth(symbol, year, month, opt, state) {
    const { start, end, key } = monthWindow(year, month);
    const symState = (state[String(year)][symbol] ||= {});
    const prev = symState[key];

    if (!opt.force && prev && TERMINAL_STATUSES.has(prev.status)) {
        console.log(`  ${key}  skip (${prev.status})`);
        return prev.status;
    }

    const strikes = opt.strikes != null ? opt.strikes : INDICES.includes(symbol) ? 15 : 10;

    // 1. resolve the underlying's Upstox instrument_key
    let underlyingKey;
    try {
        underlyingKey = await resolveUnderlyingKey(symbol);
    } catch (err) {
        underlyingKey = null;
        console.warn(`  ${key}  resolveUnderlyingKey error: ${err.message}`);
    }
    if (!underlyingKey) {
        symState[key] = { status: "no-data", reason: "no Upstox instrument_key", updatedAt: nowIso() };
        saveState(state);
        console.log(`  ${key}  no-data (no Upstox instrument_key for ${symbol})`);
        return "no-data";
    }

    // 2. does Upstox actually have expiries in this month?
    let expiriesInMonth = [];
    try {
        const all = await upstox.getExpiries(underlyingKey);
        expiriesInMonth = all.filter((e) => e >= start && e <= end);
    } catch (err) {
        // Auth problems (missing / expired / invalid token) will fail the
        // exact same way for every remaining symbol and month — abort the
        // whole run so the user fixes .env once, not 2500 times.
        if (err.upstoxAuthError) throw err;
        // Anything else here is transient — don't burn the month permanently.
        symState[key] = { status: "error", reason: `getExpiries: ${err.message}`, updatedAt: nowIso() };
        saveState(state);
        console.warn(`  ${key}  error (getExpiries: ${err.message}) — will retry on next run`);
        return "error";
    }
    if (!expiriesInMonth.length) {
        symState[key] = {
            status: "no-data",
            reason: "Upstox returned 0 expiries for this month (older than Upstox's ~6-month expired-instruments window, or index not covered)",
            updatedAt: nowIso(),
        };
        saveState(state);
        console.log(`  ${key}  no-data (Upstox has 0 expiries in this month)`);
        return "no-data";
    }

    // 3 + 4. backfill, verify, re-fetch on gaps
    let stats = null;
    let prevMinuteRows = -1;
    for (let attempt = 1; attempt <= opt.attempts; attempt++) {
        console.log(`  ${key}  attempt ${attempt}/${opt.attempts}  expiries=[${expiriesInMonth.join(", ")}] strikes=±${strikes}`);
        try {
            await backfillOneSymbol(symbol, strikes, start, end);
        } catch (err) {
            console.error(`  ${key}  backfill error: ${err.message}`);
        }

        stats = await verifyMonth(symbol, start, end);
        console.log(
            `  ${key}  verify -> expiries=${stats.expiries}/${expiriesInMonth.length} strikes=${stats.strikes} days=${stats.days} minuteRows=${stats.minuteRows}`
        );

        const pass = stats.expiries >= 1 && stats.minuteRows >= opt.minMinuteRows && stats.days >= 2;
        if (pass) {
            symState[key] = {
                status: "complete",
                expected_expiries: expiriesInMonth.length,
                ...stats,
                attempts: attempt,
                updatedAt: nowIso(),
            };
            saveState(state);
            console.log(`  ${key}  complete`);
            return "complete";
        }

        // No progress between attempts -> retrying won't help (out of range,
        // genuinely illiquid, or a hard Upstox limitation). Stop early.
        if (attempt > 1 && stats.minuteRows === prevMinuteRows) {
            console.log(`  ${key}  no new rows since last attempt — stopping retries`);
            break;
        }
        prevMinuteRows = stats.minuteRows;
    }

    symState[key] = {
        status: "partial",
        expected_expiries: expiriesInMonth.length,
        ...stats,
        attempts: opt.attempts,
        updatedAt: nowIso(),
    };
    saveState(state);
    console.log(`  ${key}  partial (kept ${stats ? stats.minuteRows : 0} minute rows — re-run later to try again)`);
    return "partial";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const { year, opt } = parseArgs(process.argv);

    // Preflight: the whole run is useless without an Upstox token. Fail here
    // with one clear message instead of an "error" status on every month.
    if (!opt.dryRun && !process.env.UPSTOX_ACCESS_TOKEN) {
        console.error(
            "\n✗ UPSTOX_ACCESS_TOKEN is not set.\n\n" +
                "  This machine has no data-downloader/.env, or it has no token in it.\n" +
                "  Fix:\n" +
                "    cd data-downloader\n" +
                "    cp .env.example .env        # if .env doesn't exist yet\n" +
                "    # then edit .env and set:\n" +
                "    #   DB_HOST / DB_USER / DB_PASSWORD / DB_NAME   (the MySQL to write to)\n" +
                "    #   UPSTOX_ACCESS_TOKEN                          (from account.upstox.com/developer/apps, Plus plan)\n" +
                "    #   UPSTOX_CLIENT_ID\n\n" +
                "  Then re-run the same command.\n"
        );
        process.exit(1);
    }

    // Only pull the F&O stock list (a ~34MB Angel scrip-master download) when
    // the run actually needs it — --only and --indices-only don't.
    const idxSet = new Set(INDICES);
    let symbols;
    let stockCount = 0;
    let source;
    if (opt.only) {
        symbols = opt.only;
        source = "--only";
    } else if (opt.indicesOnly) {
        symbols = [...INDICES];
        source = "indices";
    } else {
        const stocks = await getStockUniverse();
        stockCount = stocks.length;
        symbols = opt.stocksOnly ? stocks : [...INDICES, ...stocks];
        source = process.env.UNIVERSE_FILE ? `file:${process.env.UNIVERSE_FILE}` : "angel-scrip-master";
    }
    const uni = {
        indices: symbols.filter((s) => idxSet.has(s)),
        stocks: symbols.filter((s) => !idxSet.has(s)),
        source,
    };
    stockCount = stockCount || uni.stocks.length;

    if (opt.startSymbol) {
        const i = symbols.indexOf(opt.startSymbol);
        if (i === -1) usageAndExit(`--start-symbol=${opt.startSymbol} is not in the selected universe.`);
        symbols = symbols.slice(i);
    }

    const months = [];
    for (let m = opt.fromMonth; m <= opt.toMonth; m++) months.push(m);

    console.log("\n=== Upstox year backfill ===");
    console.log(`Year          : ${year}`);
    console.log(`Months        : ${opt.fromMonth}..${opt.toMonth} (${months.length})`);
    console.log(`Universe      : ${symbols.length} symbols  (source: ${uni.source})`);
    console.log(`              : indices ${uni.indices.join(", ")}`);
    console.log(`              : stocks  ${uni.stocks.length} (${uni.stocks.slice(0, 8).join(", ")}${uni.stocks.length > 8 ? ", …" : ""})`);
    console.log(`Order         : ${symbols.slice(0, 10).join(", ")}${symbols.length > 10 ? ", …" : ""}`);
    console.log(`Attempts/month: ${opt.attempts}   Strikes: ${opt.strikes ?? "15 idx / 10 stk"}   Pass >= ${opt.minMinuteRows} minute rows`);
    console.log(`Progress file : ${STATE_FILE}${opt.force ? "   (--force: ignoring it)" : ""}`);
    console.log(
        "\n⚠  Upstox's expired-instruments API only reaches ~6 months back. Any month\n" +
            `   older than that gets marked \"no-data\" and skipped. For ${year}, that may be\n` +
            "   most or all months. Older years need Breeze (minute) or Bhavcopy (EOD).\n"
    );

    if (opt.dryRun) {
        console.log("(--dry-run: no API calls, no DB writes)\n");
        console.log("Full symbol order:");
        console.log(symbols.join(", "));
        await pool.end();
        return;
    }

    const state = loadState();
    state[String(year)] ||= {};

    const summary = { complete: 0, partial: 0, "no-data": 0, error: 0 };
    const startedAt = Date.now();

    for (let s = 0; s < symbols.length; s++) {
        const symbol = symbols[s];
        console.log(`\n[${s + 1}/${symbols.length}] ${symbol}  ${year}`);
        for (const m of months) {
            let status;
            try {
                status = await processMonth(symbol, year, m, opt, state);
            } catch (err) {
                if (err.upstoxAuthError) {
                    console.error(
                        `\n✗ Upstox rejected the token (${err.message}).\n` +
                            "  Aborting — fix UPSTOX_ACCESS_TOKEN in data-downloader/.env (get a fresh\n" +
                            "  one from account.upstox.com/developer/apps) and re-run. Progress so far\n" +
                            `  is saved in ${STATE_FILE}.\n`
                    );
                    await pool.end();
                    process.exit(1);
                }
                console.error(`  ${year}-${String(m).padStart(2, "0")}  UNEXPECTED: ${err.stack || err.message}`);
                status = "error";
            }
            summary[status] = (summary[status] || 0) + 1;
        }
    }

    const mins = Math.round((Date.now() - startedAt) / 60000);
    console.log("\n=== DONE ===");
    console.log(`Elapsed  : ${mins} min`);
    console.log(`Months   : complete=${summary.complete}  partial=${summary.partial}  no-data=${summary["no-data"]}  error=${summary.error}`);
    console.log(`Progress : ${STATE_FILE}`);
    console.log(`Re-run the same command anytime — complete/no-data months are skipped, partial/error months retried.`);
    console.log(`Report   : node scripts/verifyUpstoxYear.js ${year}`);
    await pool.end();
}

main().catch(async (err) => {
    console.error("[upstox-year] fatal:", err.stack || err.message);
    try {
        await pool.end();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
