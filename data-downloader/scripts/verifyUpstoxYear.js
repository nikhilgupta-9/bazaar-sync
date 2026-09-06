// scripts/verifyUpstoxYear.js — read-only coverage report for one YEAR.
//
// Prints, per symbol, a 12-month grid of what's actually in
// option_chain_history (queried live — does NOT trust the progress file),
// plus the progress file's own status alongside it.
//
//   ✓  minute-level data present (>= --min-minute-rows rows for the month)
//   ~  rows present but EOD-only / thin (below the threshold)
//   ·  nothing
//
// Usage:
//   node scripts/verifyUpstoxYear.js <YEAR> [--only=SYM,SYM] [--missing-only]
//                                           [--min-minute-rows=N] [--indices-only]
//                                           [--stocks-only]

require("dotenv").config();
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/db");
const { getFullUniverse } = require("../config/universe");

const STATE_FILE = path.join(__dirname, "..", "data", "upstox-year-progress.json");

function parseArgs(argv) {
    const year = Number(argv[2]);
    if (!Number.isInteger(year) || year < 2015 || year > 2100) {
        console.error("Usage: node scripts/verifyUpstoxYear.js <YEAR> [--only=SYM,SYM] [--missing-only] [--min-minute-rows=N] [--indices-only] [--stocks-only]");
        process.exit(1);
    }
    const opt = { only: null, missingOnly: false, minMinuteRows: 500, indicesOnly: false, stocksOnly: false };
    for (const a of argv.slice(3)) {
        if (a === "--missing-only") opt.missingOnly = true;
        else if (a === "--indices-only") opt.indicesOnly = true;
        else if (a === "--stocks-only") opt.stocksOnly = true;
        else if (a.startsWith("--only=")) opt.only = a.slice(7).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        else if (a.startsWith("--min-minute-rows=")) opt.minMinuteRows = Number(a.slice(18));
        else {
            console.error(`Unknown option: ${a}`);
            process.exit(1);
        }
    }
    return { year, opt };
}

function loadProgress() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
        return {};
    }
}

/** One row per month for a symbol: { '01': {minuteRows,totalRows,expiries}, ... }. */
async function monthlyCoverage(symbol, year) {
    const [rows] = await pool.query(
        `SELECT DATE_FORMAT(expiry, '%m') AS mm,
                COUNT(DISTINCT expiry) AS expiries,
                SUM(CASE WHEN trade_time <> '15:30:00' THEN 1 ELSE 0 END) AS minuteRows,
                COUNT(*) AS totalRows
         FROM option_chain_history
         WHERE symbol = ? AND expiry BETWEEN ? AND ?
         GROUP BY mm`,
        [symbol, `${year}-01-01`, `${year}-12-31`]
    );
    const by = {};
    for (const r of rows) {
        by[r.mm] = {
            expiries: Number(r.expiries || 0),
            minuteRows: Number(r.minuteRows || 0),
            totalRows: Number(r.totalRows || 0),
        };
    }
    return by;
}

const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

async function main() {
    const { year, opt } = parseArgs(process.argv);
    const uni = await getFullUniverse();
    let symbols;
    if (opt.only) symbols = opt.only;
    else if (opt.indicesOnly) symbols = uni.indices;
    else if (opt.stocksOnly) symbols = uni.stocks;
    else symbols = uni.all;

    const progress = loadProgress()[String(year)] || {};

    console.log(`\nUpstox coverage — ${year}   (✓ = >=${opt.minMinuteRows} minute rows, ~ = thin/EOD, · = none)\n`);
    console.log(`${"SYMBOL".padEnd(14)} ${MONTH_LETTERS.join(" ")}   minuteRows  status`);
    console.log("-".repeat(60));

    const totals = { symbolsWithData: 0, monthsWithMinute: 0 };

    for (const symbol of symbols) {
        const cov = await monthlyCoverage(symbol, year);
        const cells = [];
        let symMinute = 0;
        let symMonthsMinute = 0;
        for (let m = 1; m <= 12; m++) {
            const mm = String(m).padStart(2, "0");
            const c = cov[mm];
            if (!c || c.totalRows === 0) cells.push("·");
            else if (c.minuteRows >= opt.minMinuteRows) {
                cells.push("✓");
                symMonthsMinute++;
            } else cells.push("~");
            if (c) symMinute += c.minuteRows;
        }
        const hasAny = symMinute > 0 || cells.some((x) => x !== "·");
        if (opt.missingOnly && symMonthsMinute === 12) continue;
        if (!hasAny && opt.missingOnly === false && symMinute === 0 && !progress[symbol]) {
            // still print — user wants the full grid unless --missing-only
        }

        if (hasAny) totals.symbolsWithData++;
        totals.monthsWithMinute += symMonthsMinute;

        // Compact per-symbol progress-file summary
        const ps = progress[symbol] || {};
        const counts = {};
        for (const k of Object.keys(ps)) counts[ps[k].status] = (counts[ps[k].status] || 0) + 1;
        const statusStr = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" ") || "-";

        console.log(`${symbol.padEnd(14)} ${cells.join(" ")}   ${String(symMinute).padStart(10)}  ${statusStr}`);
    }

    console.log("-".repeat(60));
    console.log(`Symbols with any data: ${totals.symbolsWithData}/${symbols.length}   month-slots with minute data: ${totals.monthsWithMinute}`);
    console.log(`Progress file: ${STATE_FILE}\n`);
    await pool.end();
}

main().catch(async (err) => {
    console.error("[verify] fatal:", err.stack || err.message);
    try {
        await pool.end();
    } catch {
        /* ignore */
    }
    process.exit(1);
});
