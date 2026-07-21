// scripts/testHistoricalRaw.js — diagnostic: print Angel One's RAW getCandleData
// response, bypassing angelOneHistorical.js's silent Array.isArray(body.data)
// fallback (which turns any unexpected shape into "0 candles" with no clue why).
// Run:  cd server && node scripts/testHistoricalRaw.js

require("dotenv").config();
const { securePost } = require("../workers/login");
const { getIndexToken } = require("../services/instrumentMaster");

const dateStr = process.argv[2] || "2026-07-17";

(async () => {
    const token = getIndexToken("NIFTY");
    console.log(`Raw getCandleData request: exchange=NSE symboltoken=${token} date=${dateStr}`);
    try {
        const body = await securePost("/rest/secure/angelbroking/historical/v1/getCandleData", {
            exchange: "NSE",
            symboltoken: String(token),
            interval: "ONE_MINUTE",
            fromdate: `${dateStr} 09:00`,
            todate: `${dateStr} 15:35`,
        });
        console.log("Raw response body:");
        console.log(JSON.stringify(body, null, 2).slice(0, 3000));
        process.exit(0);
    } catch (err) {
        console.error("REQUEST FAILED:", err.message);
        process.exit(1);
    }
})();
