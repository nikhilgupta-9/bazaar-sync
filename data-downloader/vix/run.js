// vix/run.js — India VIX 1-minute history, year in, month by month out.
//
//   node vix/run.js <YEAR> [--from-month=N] [--to-month=N] [--reset] [--stop-on-verify-fail]
//
// For each calendar month, in order:
//   1. download — Breeze 1-minute India VIX candles for the whole month
//      (vixHistorical.js), upserted into ohlcv_data (symbol = 'INDIAVIX').
//   2. verify   — every expected trading day present? enough candles per day
//      (~375)? no multi-day gaps? Written to
//      data/vix-pipeline-reports/<year>-<month>.json + a printed summary.
// Then the next month.
//
// Trading calendar for the verify step is taken from option_chain_history
// (whatever NIFTY days the option-chain pipeline discovered that month). If
// that pipeline hasn't been run for the month, verify falls back to "every
// weekday" and only the candle-count / gap checks apply.
//
// VIX is cheap on Breeze's budget (~15 calls per month, vs the 5,000/day
// cap) — a full year in one run is fine. Still resumable via
// data/vix-pipeline-progress.json in case it's run the same day as a big
// option-chain enrich that already spent the budget.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");
const { todayIst, monthBounds, addDays, dayOfWeek } = require("../lib/dates");
const rateLimiter = require("../breeze/rateLimiter");
const { getVixMinuteCandles, VIX_STOCKCODE } = require("./vixHistorical");

const SYMBOL = "INDIAVIX";
const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRESS_FILE = path.join(DATA_DIR, "vix-pipeline-progress.json");
const REPORTS_DIR = path.join(DATA_DIR, "vix-pipeline-reports");
const INSERT_BATCH_SIZE = 500;
const MIN_CANDLES_PER_DAY = Number(process.env.VIX_MIN_CANDLES_PER_DAY || 300);

function ym(year, month) {
    return `${year}-${String(month).padStart(2, "0")}`;
}

function parseArgs(argv) {
    const year = Number(argv[2]);
    const flags = {};
    for (const a of argv.slice(3)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return { year, flags };
}

function loadProgress() {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")); } catch { return null; }
}
function saveProgress(p) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}
function clearProgress() {
    try { fs.unlinkSync(PROGRESS_FILE); } catch { /* gone */ }
}

async function storeCandles(candles) {
    if (!candles.length) return 0;
    const values = candles.map((c) => [
        SYMBOL, c.date, c.time,
        c.open ?? null, c.high ?? null, c.low ?? null, c.close ?? null, c.volume ?? 0,
    ]);
    let stored = 0;
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
        const batch = values.slice(i, i + INSERT_BATCH_SIZE);
        await pool.query(
            `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
             VALUES ?
             ON DUPLICATE KEY UPDATE
               open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume)`,
            [batch]
        );
        stored += batch.length;
    }
    return stored;
}

/** Weekdays in [first,last] as 'YYYY-MM-DD'. */
function weekdaysInRange(first, last) {
    const out = [];
    for (let d = first; d <= last; d = addDays(d, 1)) {
        const dow = dayOfWeek(d);
        if (dow !== 0 && dow !== 6) out.push(d);
    }
    return out;
}

async function verifyVixMonth(year, month) {
    const { first, last } = monthBounds(year, month);

    const [dayRows] = await pool.query(
        `SELECT trade_date,
                COUNT(*) AS candles,
                MIN(trade_time) AS firstTime,
                MAX(trade_time) AS lastTime
         FROM ohlcv_data
         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
         GROUP BY trade_date ORDER BY trade_date`,
        [SYMBOL, first, last]
    );
    const gotDays = new Map(dayRows.map((r) => [r.trade_date, r]));

    // Expected trading calendar: NIFTY days in option_chain_history for the
    // month if available, else every weekday.
    const [niftyDays] = await pool.query(
        `SELECT DISTINCT trade_date FROM option_chain_history
         WHERE symbol = 'NIFTY' AND trade_date BETWEEN ? AND ?`,
        [first, last]
    );
    const expectedDays = niftyDays.length
        ? niftyDays.map((r) => r.trade_date).sort()
        : weekdaysInRange(first, last);
    const calendarSource = niftyDays.length ? "option_chain_history NIFTY" : "every weekday (option-chain pipeline not run for this month)";

    const missingDays = expectedDays.filter((d) => !gotDays.has(d));
    const thinDays = [...gotDays.values()]
        .filter((r) => Number(r.candles) < MIN_CANDLES_PER_DAY)
        .map((r) => ({ date: r.trade_date, candles: Number(r.candles) }));

    const totalCandles = dayRows.reduce((s, r) => s + Number(r.candles), 0);
    const problems = [];
    if (!dayRows.length) problems.push("no INDIAVIX rows at all for this month");
    if (missingDays.length) problems.push(`${missingDays.length} expected trading day(s) missing`);
    if (thinDays.length) problems.push(`${thinDays.length} day(s) with < ${MIN_CANDLES_PER_DAY} candles`);

    return {
        symbol: SYMBOL,
        year,
        month,
        range: { first, last },
        generatedAt: new Date().toISOString(),
        pass: problems.length === 0,
        problems,
        calendarSource,
        expectedTradingDays: expectedDays.length,
        daysWithData: dayRows.length,
        totalCandles,
        missingDays,
        thinDays,
        days: dayRows.map((r) => ({ date: r.trade_date, candles: Number(r.candles), firstTime: r.firstTime, lastTime: r.lastTime })),
    };
}

function writeReport(report) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const file = path.join(REPORTS_DIR, `${ym(report.year, report.month)}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    return file;
}

async function runMonth(year, month, startPhase, flags) {
    const { first, last } = monthBounds(year, month);

    if (startPhase === "download") {
        saveProgress({ year, month, phase: "download" });
        if (rateLimiter.remainingToday() <= 0) {
            console.log("[vix] Breeze daily budget already spent — re-run tomorrow, it resumes here.");
            return "budget-exhausted";
        }
        console.log(`\n=== ${ym(year, month)} · download (Breeze India VIX 1-min, code "${VIX_STOCKCODE}", ${first}..${last}) ===`);
        try {
            const candles = await getVixMinuteCandles({ fromDateStr: first, toDateStr: last });
            const stored = await storeCandles(candles);
            const days = new Set(candles.map((c) => c.date)).size;
            console.log(`[vix] ${ym(year, month)}: ${stored} candles over ${days} day(s) stored. Budget left: ${rateLimiter.remainingToday()}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/daily call budget spent/i.test(msg)) {
                console.log(`[vix] ${msg}`);
                return "budget-exhausted";
            }
            throw err;
        }
    }

    // ----- verify -----
    saveProgress({ year, month, phase: "verify" });
    const report = await verifyVixMonth(year, month);
    const file = writeReport(report);
    console.log(`[verify] ${ym(year, month)}: ${report.pass ? "PASS" : "FAIL"} — ${report.daysWithData}/${report.expectedTradingDays} trading days, ${report.totalCandles} candles (calendar: ${report.calendarSource})`);
    if (report.problems.length) console.log(`[verify]   ${report.problems.join("; ")}`);
    if (report.missingDays.length) console.log(`[verify]   missing: ${report.missingDays.join(", ")}`);
    if (report.thinDays.length) console.log(`[verify]   thin: ${report.thinDays.map((d) => `${d.date}(${d.candles})`).join(", ")}`);
    console.log(`[verify]   report: ${file}`);
    if (flags["stop-on-verify-fail"] && !report.pass) return "verify-failed";
    return "month-complete";
}

async function main() {
    const { year, flags } = parseArgs(process.argv);
    if (!Number.isInteger(year) || year < 2010 || year > 2100) {
        console.error("Usage: node vix/run.js <YEAR> [--from-month=N] [--to-month=N] [--reset] [--stop-on-verify-fail]");
        process.exit(1);
    }

    if (flags.reset) clearProgress();
    const progress = loadProgress();

    let startMonth = flags["from-month"] ? Number(flags["from-month"]) : 1;
    let startPhase = "download";
    if (!flags.reset && progress && progress.year === year && !flags["from-month"]) {
        startMonth = progress.month;
        startPhase = progress.phase || "download";
        console.log(`[vix] resuming from ${ym(year, startMonth)} · ${startPhase}`);
    }

    const today = todayIst();
    const [curY, curM] = today.split("-").map(Number);
    let endMonth = flags["to-month"] ? Number(flags["to-month"]) : 12;
    if (year === curY) endMonth = Math.min(endMonth, curM - 1);
    if (year > curY || endMonth < 1) {
        console.error(`[vix] nothing to do — ${year} has no completed months yet (today is ${today}).`);
        await pool.end();
        return;
    }

    console.log(`[vix] year ${year}, months ${startMonth}..${endMonth} · Breeze budget remaining today: ${rateLimiter.remainingToday()}`);

    for (let month = startMonth; month <= endMonth; month++) {
        const phase = month === startMonth ? startPhase : "download";
        const outcome = await runMonth(year, month, phase, flags);
        if (outcome === "budget-exhausted") { await pool.end(); process.exit(0); }
        if (outcome === "verify-failed") {
            console.error(`[vix] STOPPING at ${ym(year, month)} — verify failed and --stop-on-verify-fail is set.`);
            saveProgress({ year, month, phase: "verify" });
            await pool.end();
            process.exit(2);
        }
        saveProgress({ year, month: month + 1, phase: "download" });
    }

    console.log(`\n[vix] year ${year} complete (months ${startMonth}..${endMonth}). Reports in ${REPORTS_DIR}`);
    clearProgress();
    await pool.end();
}

main().catch((err) => {
    console.error("[vix] fatal:", err && err.stack ? err.stack : err);
    process.exit(1);
});
