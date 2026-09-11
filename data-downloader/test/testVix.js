// test/testVix.js — confirm Breeze returns real India VIX candles BEFORE
// running vix/run.js for a whole year. Prints exactly what came back so a
// wrong stock code / exchange / product-type shows up as "0 candles", not
// silently-wrong data.
//
// Run: cd data-downloader && node test/testVix.js [FROM_DATE] [TO_DATE]
//   Defaults to the last ~3 days.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { addDays, todayIst } = require("../lib/dates");
const { getVixMinuteCandles, VIX_STOCKCODE, VIX_EXCHANGE, VIX_PRODUCT } = require("../vix/vixHistorical");

(async () => {
    const to = process.argv[3] || addDays(todayIst(), -1);
    const from = process.argv[2] || addDays(to, -3);

    console.log(`Breeze India VIX: stockCode="${VIX_STOCKCODE}" exchange="${VIX_EXCHANGE}" product="${VIX_PRODUCT}"`);
    console.log(`Fetching ${from} .. ${to} ...`);
    try {
        const candles = await getVixMinuteCandles({ fromDateStr: from, toDateStr: to });
        console.log(`Got ${candles.length} candles.`);
        if (candles.length) {
            console.log("First:", candles[0]);
            console.log("Last: ", candles[candles.length - 1]);
            const byDay = {};
            for (const c of candles) byDay[c.date] = (byDay[c.date] || 0) + 1;
            console.log("Per day:", byDay);
        } else {
            console.log("\n0 candles — the stock code / exchange / product is probably wrong.");
            console.log("Try overriding in .env: BREEZE_VIX_STOCKCODE, BREEZE_VIX_EXCHANGE, BREEZE_VIX_PRODUCT");
        }
        process.exit(0);
    } catch (err) {
        console.error("VIX TEST FAILED:", err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
})();
