// scripts/testBhavcopy.js — one-day sanity check for services/nseBhavcopy.js
// BEFORE running the multi-year backfill. Everything in nseBhavcopy.js (URL,
// CSV column names) was written without being able to reach nseindia.com
// from where it was built — this is the real first test of both.
//
// Run:  cd server && node scripts/testBhavcopy.js [SYMBOL] [DATE]
//   SYMBOL - default NIFTY
//   DATE   - 'YYYY-MM-DD', default last Friday

require("dotenv").config();
const bhavcopy = require("../services/nseBhavcopy");

function lastWeekday() {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
    const d = new Date(istMs);
    d.setUTCDate(d.getUTCDate() - 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

(async () => {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const dateStr = process.argv[3] || lastWeekday();
    console.log(`Fetching ${symbol} bhavcopy rows for ${dateStr}...`);
    try {
        const rows = await bhavcopy.getDayOptionRows(dateStr, symbol);
        console.log(`Got ${rows.length} CE/PE rows.`);
        console.log("Sample (first 5):", rows.slice(0, 5));
        process.exit(0);
    } catch (err) {
        console.error("BHAVCOPY TEST FAILED:", err.message);
        process.exit(1);
    }
})();
