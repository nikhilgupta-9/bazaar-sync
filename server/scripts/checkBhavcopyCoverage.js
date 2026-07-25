// scripts/checkBhavcopyCoverage.js — reports which trading days in a range
// already have data in option_chain_history vs which are still missing.
// Run this BEFORE re-running backfillBhavcopyAll.js so we don't waste NSE
// requests (and risk the throttle again) re-fetching what's already stored.
//
// Usage: node scripts/checkBhavcopyCoverage.js [YEARS_BACK] [END_DATE]
//   Same range semantics as backfillBhavcopyAll.js.

require("dotenv").config();
const { pool } = require("../config/db");
const { addDays } = require("../services/backtestEngine");
const instrumentMaster = require("../services/instrumentMaster");

function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

async function main() {
    const yearsBack = Number(process.argv[2] || 2.05);
    const endDate = process.argv[3] || addDays(instrumentMaster.todayIst(), -1);
    const startDate = addDays(endDate, -Math.round(yearsBack * 365));

    console.log(`[coverage] checking ${startDate} .. ${endDate}`);

    const [rows] = await pool.query(
        `SELECT DISTINCT trade_date FROM option_chain_history WHERE trade_date BETWEEN ? AND ?`,
        [startDate, endDate]
    );
    const covered = new Set(rows.map((r) => r.trade_date));

    const missing = [];
    let d = startDate;
    let weekdayCount = 0;
    while (d <= endDate) {
        const dow = dayOfWeek(d);
        if (dow !== 0 && dow !== 6) {
            weekdayCount += 1;
            if (!covered.has(d)) missing.push(d);
        }
        d = addDays(d, 1);
    }

    const [totalRowsResult] = await pool.query(
        `SELECT COUNT(*) AS c, COUNT(DISTINCT symbol) AS symbols FROM option_chain_history WHERE trade_date BETWEEN ? AND ?`,
        [startDate, endDate]
    );

    console.log(`[coverage] weekdays in range: ${weekdayCount}`);
    console.log(`[coverage] already covered: ${covered.size} days (${totalRowsResult[0].c} rows, ${totalRowsResult[0].symbols} distinct symbols)`);
    console.log(`[coverage] MISSING: ${missing.length} days`);
    if (missing.length) {
        console.log(`[coverage] first 10 missing: ${missing.slice(0, 10).join(", ")}`);
        console.log(`[coverage] last 10 missing:  ${missing.slice(-10).join(", ")}`);
    }

    await pool.end();
}

main().catch((err) => {
    console.error("[coverage] fatal:", err.message);
    process.exit(1);
});
