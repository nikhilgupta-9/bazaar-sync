// backtest/run.js — backtest-grade F&O history from ICICI Breeze, 2023 → now.
//
// Fills exactly what server/services/backtestEngine.js reads:
//   1. spot     → ohlcv_data           (1-min index/stock price; engine's day list + entry spot)
//   2. options  → option_chain_history (1-min CE/PE LTP, OI, volume, IV, Greeks; ATM ± N strikes, near expiries)
//   3. futures  → futures_history      (1-min OHLC + OI, near + next expiry)
//
// Order: ONE SYMBOL FULLY AT A TIME, oldest month first (NIFTY 2023-01 …
// NIFTY <last month>, then BANKNIFTY …). Inside a month: spot → options →
// futures. Contract selection is in-memory from bhavcopy (planner.js) — no
// placeholder rows are ever written.
//
// Usage (from data-downloader/):
//   node backtest/run.js 2023 2026                        # 7 indices, 2023..2026
//   node backtest/run.js 2023 2026 --symbols=NIFTY        # one symbol
//   node backtest/run.js 2023 2026 --symbols=ALL          # 7 indices, then every F&O stock
//   node backtest/run.js 2023 2023 --symbols=NIFTY --months=1-3
//   node backtest/run.js 2023 2026 --phases=options       # spot is still READ for ATM, just not fetched
//   node backtest/run.js 2023 2026 --plan                 # dry run: bhavcopy only, 0 Breeze calls, prints call estimate
//   node backtest/run.js 2023 2026 --reset                # forget month-level progress (stored rows are still skipped)
//
// Breeze limits: 5,000 calls/day (rateLimiter caps at 4,800), 100/min (capped
// at 90). BREEZE_API_SESSION expires DAILY — paste a fresh one, then re-run
// the SAME command; it resumes where it stopped.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { addDays, todayIst, isWeekend, monthBounds } = require("../lib/dates");
const bhavcopyDay = require("./bhavcopyDay");
const { planMonth, chunkTradingDays, INDEX_SYMBOLS } = require("./planner");

const INDEX_ORDER = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX", "NIFTYNXT50"];
const PROGRESS_PATH = path.join(__dirname, "..", "data", "breeze-backtest-progress.json");
const REPORT_DIR = path.join(__dirname, "..", "data", "breeze-backtest-reports");
// Don't start a new month's options phase with less budget than this — it
// would just stop a few chunks in. (Per-chunk storage makes stopping safe
// either way; this only avoids a pointless partial start.)
const MIN_BUDGET_TO_START_MONTH = Number(process.env.BT_MIN_BUDGET_TO_START || 100);

function parseArgs(argv) {
    const pos = argv.filter((a) => !a.startsWith("--"));
    const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
    const fromYear = Number(pos[0]);
    const toYear = Number(pos[1] || pos[0]);
    if (!fromYear || !toYear || toYear < fromYear) {
        console.error("Usage: node backtest/run.js FROM_YEAR [TO_YEAR] [--symbols=A,B|ALL] [--months=1-12] [--phases=spot,options,futures] [--plan] [--reset]");
        process.exit(1);
    }
    const months = (flag("months") || "1-12").split("-").map(Number);
    return {
        fromYear, toYear,
        symbols: (flag("symbols") || "").toUpperCase(),
        monthFrom: months[0], monthTo: months[1] || months[0],
        phases: new Set((flag("phases") || "spot,options,futures").split(",")),
        plan: argv.includes("--plan"),
        reset: argv.includes("--reset"),
    };
}

function loadProgress() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")); } catch { return { done: {} }; }
}
function saveProgress(p) {
    fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true });
    fs.writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 2));
}

// Progress is tracked per phase set, so a futures-only month is never
// mistaken for a finished options month later. Bare-symbol keys come from
// the first version (always all three phases).
const ALL_PHASES = "futures+options+spot";
function progressKey(phases, symbol) {
    return `${[...phases].sort().join("+")}:${symbol}`;
}
function isDone(progress, phases, symbol, ym) {
    if (progress.done[progressKey(phases, symbol)]?.includes(ym)) return true;
    return progress.done[`${ALL_PHASES}:${symbol}`]?.includes(ym) || progress.done[symbol]?.includes(ym) || false;
}

async function tradingDaysOf(year, month) {
    const { first, last } = monthBounds(year, month);
    const yesterday = addDays(todayIst(), -1);
    const days = [], dayData = new Map();
    for (let d = first; d <= last && d <= yesterday; d = addDays(d, 1)) {
        if (isWeekend(d)) continue;
        const day = await bhavcopyDay.loadDay(d);
        if (!day) continue; // holiday
        days.push(d);
        dayData.set(d, day);
    }
    return { days, dayData };
}

async function resolveSymbols(arg, fromYear, toYear) {
    if (!arg) return INDEX_ORDER;
    if (arg !== "ALL") return arg.split(",").filter(Boolean);
    // 7 indices first, then every stock that had F&O (options or futures) on
    // the first trading day of ANY year in range — so stocks that entered
    // F&O after FROM_YEAR are included too. Months where a stock wasn't in
    // F&O simply plan 0 runs and cost 0 calls.
    const stocks = new Set();
    for (let y = fromYear; y <= toYear; y++) {
        const { days, dayData } = await tradingDaysOf(y, 1);
        const day = dayData.get(days[0]);
        if (!day) continue;
        for (const s of [...day.options.keys(), ...day.futures.keys()]) if (!INDEX_SYMBOLS.has(s)) stocks.add(s);
    }
    return [...INDEX_ORDER, ...[...stocks].sort()];
}

const symbolIsBse = (symbol) => symbol === "SENSEX" || symbol === "BANKEX";

function isStopError(msg) {
    return /daily call budget spent/.test(msg) || /session|unauthor|invalid.*(key|token)|checksum|Missing Breeze credentials/i.test(msg);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const progress = args.reset ? { done: {} } : loadProgress();
    // Option rows are only needed to plan the options phase.
    bhavcopyDay.setKeepOptions(args.phases.has("options"));
    const symbols = await resolveSymbols(args.symbols, args.fromYear, args.toYear);
    const nowYm = todayIst().slice(0, 7);

    // Breeze modules are required lazily so --plan never loads breezeconnect
    // (its require() disables TLS verification process-wide).
    const breezeMods = () => ({
        spot: require("./spot"),
        fetch: require("./fetch"),
        rateLimiter: require("../breeze/rateLimiter"),
    });

    console.log(`[backtest] ${args.plan ? "PLAN (dry run)" : "RUN"} ${args.fromYear}..${args.toYear}, months ${args.monthFrom}-${args.monthTo}, ${symbols.length} symbol(s), phases=${[...args.phases].join(",")}`);
    const totals = { spot: 0, options: 0, futures: 0 };

    const skippedSymbols = [];
    const emptyStreak = {};
    symbolLoop: for (const symbol of symbols) {
        for (let year = args.fromYear; year <= args.toYear; year++) {
            for (let month = args.monthFrom; month <= args.monthTo; month++) {
                const ym = `${year}-${String(month).padStart(2, "0")}`;
                if (ym > nowYm) break;
                if (!args.plan && isDone(progress, args.phases, symbol, ym)) continue;

                let days, dayData;
                try {
                    ({ days, dayData } = await tradingDaysOf(year, month));
                } catch (err) {
                    // NSE throttling/outage (not a holiday) — stop cleanly, month not marked done.
                    console.log(`\n[backtest] STOPPED: ${err.message}`);
                    console.log("[backtest] NSE bhavcopy is unreachable right now. Re-run the SAME command in a while — it resumes here.");
                    await pool.end();
                    process.exit(0);
                }
                if (!days.length) continue;
                if (symbolIsBse(symbol) && days.some((d) => dayData.get(d)?.bseFailed)) {
                    console.warn(`  ⚠ ${symbol} ${ym}: BSE bhavcopy failed for some days — skipping ${symbol} for now (month NOT marked done). Re-run later.`);
                    skippedSymbols.push(symbol);
                    continue symbolLoop;
                }
                const monthFrom = days[0], monthTo = days[days.length - 1];

                if (args.plan) {
                    // Dry run: spot is only read from the DB (whatever exists), parity ATM otherwise.
                    const { byDate } = await readSpotOnly(symbol, days);
                    const plan = planMonth(symbol, days, dayData, byDate);
                    const hasOptions = plan.optionRuns.length > 0;
                    const est = {
                        spot: args.phases.has("spot") ? plan.estCalls.spot : 0,
                        options: args.phases.has("options") ? plan.estCalls.options : 0,
                        futures: args.phases.has("futures") ? plan.estCalls.futures : 0,
                    };
                    for (const k of Object.keys(totals)) totals[k] += est[k];
                    console.log(`[plan] ${symbol} ${ym}: ${days.length} days, ${plan.optionRuns.length} option runs${hasOptions ? "" : " (no options listed)"}, ${plan.futureRuns.length} future runs → ~${est.spot + est.options + est.futures} calls (spot ${est.spot}, options ${est.options}, futures ${est.futures})`);
                    continue;
                }

                const { spot, fetch, rateLimiter } = breezeMods();
                if (rateLimiter.remainingToday() < MIN_BUDGET_TO_START_MONTH) {
                    return stopForToday(rateLimiter, `budget left ${rateLimiter.remainingToday()} < ${MIN_BUDGET_TO_START_MONTH}`);
                }

                const report = { symbol, month: ym, tradingDays: days.length };
                const log = (s) => console.log(s);
                try {
                    console.log(`[backtest] ${symbol} ${ym}: ${days.length} trading days (budget left today: ${rateLimiter.remainingToday()})`);
                    const s = await spot.ensureSpot(symbol, days, chunkTradingDays, { fetch: args.phases.has("spot") });
                    report.spot = { fetchedRows: s.fetched, calls: s.calls, daysWithSpot: [...s.byDate.values()].filter((v) => v.byTime.size >= spot.MIN_ROWS_PER_DAY).length };

                    const plan = planMonth(symbol, days, dayData, s.byDate);
                    report.plan = { optionRuns: plan.optionRuns.length, futureRuns: plan.futureRuns.length, estCalls: plan.estCalls, atmSource: plan.atmSource };
                    console.log(`  plan: ${plan.optionRuns.length} option runs (~${plan.estCalls.options} calls), ${plan.futureRuns.length} future runs (~${plan.estCalls.futures} calls); ATM from spot ${plan.atmSource.spot}d / parity ${plan.atmSource.parity}d`);

                    if (args.phases.has("options")) report.options = await fetch.fetchOptions(symbol, plan, s.byDate, monthFrom, monthTo, log);
                    if (args.phases.has("futures")) report.futures = await fetch.fetchFutures(symbol, plan, s.byDate, monthFrom, monthTo, log);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    writeReport({ ...report, stoppedWith: msg });
                    if (isStopError(msg)) return stopForToday(rateLimiter, msg.split("\n")[0]);
                    throw err;
                }

                report.verify = await verifyMonth(symbol, monthFrom, monthTo);
                writeReport(report);
                console.log(`  ✓ ${symbol} ${ym}: spot days ${report.verify.spotDays}/${days.length}, option rows ${report.verify.optionRows} (${report.verify.optionContracts} contracts), future rows ${report.verify.futureRows}; failed chunks: options ${report.options?.failed ?? 0}, futures ${report.futures?.failed ?? 0}`);

                // Breeze answers a wrong stock code with an empty success, not
                // an error. If every futures/options call for the month came
                // back empty, don't mark it done and don't burn the rest of
                // this symbol's budget — move on and report it at the end.
                // Empty-month handling. Breeze answers a WRONG stock code with an
                // empty success, but a genuinely untraded month is empty too
                // (FINNIFTY futures had no trades in Jan 2023). So: if this
                // symbol has data in ANY other month, an empty month is real
                // and gets marked done; if nothing ever came back, allow up to
                // 3 empty months in a row, then skip the symbol (not marked done).
                const stored = { futures: report.verify.futureRows, options: report.verify.optionRows };
                const emptyPhase = ["futures", "options"].find((ph) => report[ph] && report[ph].calls > 0 && stored[ph] === 0);
                if (emptyPhase) {
                    if (await symbolHasAnyRows(emptyPhase, symbol, args.fromYear, args.toYear)) {
                        console.log(`  · ${symbol} ${ym}: no ${emptyPhase} trades this month (symbol has data elsewhere) — marked done.`);
                    } else {
                        emptyStreak[symbol] = (emptyStreak[symbol] || 0) + 1;
                        console.warn(`  ⚠ ${symbol} ${ym}: ${report[emptyPhase].calls} ${emptyPhase} calls, 0 rows, and no data for this symbol yet (${emptyStreak[symbol]}/3). Month NOT marked done.`);
                        if (emptyStreak[symbol] >= 3) {
                            console.warn(`  ⚠ ${symbol}: 3 empty months with no data at all — likely a wrong Breeze stock code. Skipping ${symbol}.`);
                            skippedSymbols.push(symbol);
                            continue symbolLoop;
                        }
                        continue;
                    }
                } else {
                    emptyStreak[symbol] = 0;
                }

                const key = progressKey(args.phases, symbol);
                progress.done[key] = [...new Set([...(progress.done[key] || []), ym])].sort();
                saveProgress(progress);
            }
        }
    }

    if (args.plan) {
        const all = totals.spot + totals.options + totals.futures;
        const perDay = Number(process.env.BREEZE_DAILY_CALL_LIMIT || 4800);
        console.log(`\n[plan] TOTAL ~${all} Breeze calls (spot ${totals.spot}, options ${totals.options}, futures ${totals.futures}) ≈ ${Math.ceil(all / perDay)} daily sessions at ${perDay}/day (~${Math.ceil(perDay / 90)} min each).`);
        console.log("[plan] Estimates assume nothing is stored yet; already-stored chunks are skipped for free on a real run. Tune with BT_* env vars (see backtest/planner.js).");
    } else {
        console.log("[backtest] all requested symbols/months done.");
        if (skippedSymbols.length) console.log(`[backtest] ⚠ skipped (0 rows from Breeze, check stock code): ${skippedSymbols.join(", ")}`);
    }
    await pool.end();
}

async function readSpotOnly(symbol, days) {
    // Same shape as spot.ensureSpot's byDate, DB-only, without loading Breeze.
    const [rows] = await pool.query(
        `SELECT trade_date, MIN(low) lo, MAX(high) hi, COUNT(*) n FROM ohlcv_data
         WHERE symbol = ? AND trade_date BETWEEN ? AND ? GROUP BY trade_date HAVING n >= 300`,
        [symbol, days[0], days[days.length - 1]]
    );
    return { byDate: new Map(rows.map((r) => [r.trade_date, { low: Number(r.lo), high: Number(r.hi) }])) };
}

// Only rows inside THIS run's year range count — futures_history also holds
// Upstox 2025+ rows for the same symbols, which say nothing about whether the
// Breeze stock code works.
async function symbolHasAnyRows(phase, symbol, fromYear, toYear) {
    const table = phase === "futures" ? "futures_history" : "option_chain_history";
    const [[row]] = await pool.query(
        `SELECT 1 AS ok FROM ${table} WHERE symbol = ? AND trade_date BETWEEN ? AND ? LIMIT 1`,
        [symbol, `${fromYear}-01-01`, `${toYear}-12-31`]
    );
    return Boolean(row);
}

async function verifyMonth(symbol, from, to) {
    const [[spot]] = await pool.query(
        `SELECT COUNT(*) days FROM (SELECT trade_date FROM ohlcv_data WHERE symbol=? AND trade_date BETWEEN ? AND ? GROUP BY trade_date HAVING COUNT(*) >= 300) x`,
        [symbol, from, to]
    );
    const [[opt]] = await pool.query(
        `SELECT COUNT(*) n, COUNT(DISTINCT expiry, strike) k FROM option_chain_history WHERE symbol=? AND trade_date BETWEEN ? AND ?`,
        [symbol, from, to]
    );
    const [[fut]] = await pool.query(
        `SELECT COUNT(*) n FROM futures_history WHERE symbol=? AND trade_date BETWEEN ? AND ?`,
        [symbol, from, to]
    );
    return { spotDays: Number(spot.days), optionRows: Number(opt.n), optionContracts: Number(opt.k), futureRows: Number(fut.n) };
}

function writeReport(report) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `${report.symbol}-${report.month}.json`), JSON.stringify(report, null, 2));
}

async function stopForToday(rateLimiter, reason) {
    console.log(`\n[backtest] STOPPED: ${reason}`);
    console.log(`[backtest] Budget left today: ${rateLimiter.remainingToday()}. Everything fetched so far is saved.`);
    console.log("[backtest] Tomorrow: paste a fresh BREEZE_API_SESSION into data-downloader/.env and re-run the SAME command — it resumes where it stopped.");
    await pool.end();
    process.exit(0);
}

main().catch(async (err) => {
    console.error("[backtest] FAILED:", err instanceof Error ? err.stack : err);
    try { await pool.end(); } catch { /* ignore */ }
    process.exit(1);
});
