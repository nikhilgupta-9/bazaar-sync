// scripts/testHistorical.js — one-off Angel One historical data check.
// Run:  cd server && node scripts/testHistorical.js
//
// Pulls one day of NIFTY index 1-minute candles via services/angelOneHistorical.js.
// This is a REST call against past data — it works any day/any time, market
// open or not. No DB writes, nothing else touched.

require("dotenv").config();
const { getDayCandles } = require("../services/angelOneHistorical");
const { getIndexToken } = require("../services/instrumentMaster");

/** Most recent Mon-Fri date (as 'YYYY-MM-DD'), walking back from yesterday. */
function lastWeekday() {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
    const d = new Date(istMs);
    d.setUTCDate(d.getUTCDate() - 1); // start from yesterday
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
        d.setUTCDate(d.getUTCDate() - 1);
    }
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

(async () => {
    const dateStr = lastWeekday();
    const token = getIndexToken("NIFTY");
    console.log(`Fetching NIFTY (token ${token}) 1-min candles for ${dateStr}...`);
    try {
        const candles = await getDayCandles({ exchange: "NSE", symboltoken: token, dateStr });
        console.log(`Got ${candles.length} candles.`);
        if (candles.length) {
            console.log("First:", candles[0]);
            console.log("Last: ", candles[candles.length - 1]);
        } else {
            console.log("Zero candles — could be a market holiday on this date, try changing dateStr manually.");
        }
        process.exit(0);
    } catch (err) {
        console.error("HISTORICAL FETCH FAILED:", err.message);
        process.exit(1);
    }
})();
