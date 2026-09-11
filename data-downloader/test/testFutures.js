// test/testFutures.js — sanity check for the futures pipeline BEFORE a real
// year run. Two parts:
//   1. NSE bhavcopy for one recent day → how many FUTURES rows, sample.
//   2. Breeze 1-minute candles for one real (symbol, expiry) future.
//
// Run: cd data-downloader && node test/testFutures.js [SYMBOL] [BHAVCOPY_DATE]

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { addDays, todayIst } = require("../lib/dates");
const nseBhavcopy = require("../lib/nseBhavcopy");
const historicalService = require("../breeze/historicalService");

(async () => {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const bhavDate = process.argv[3] || addDays(todayIst(), -4);

    console.log(`\n1. NSE bhavcopy futures rows for ${bhavDate} ...`);
    try {
        const bySymbol = await nseBhavcopy.getDayFuturesBySymbol(bhavDate);
        const total = [...bySymbol.values()].reduce((s, r) => s + r.length, 0);
        console.log(`   ${bySymbol.size} symbols, ${total} futures rows`);
        const sample = bySymbol.get(symbol);
        if (sample) console.log(`   ${symbol}:`, sample);
        else console.log(`   (no ${symbol} futures rows that day — try another date/symbol)`);
    } catch (err) {
        console.error(`   bhavcopy failed: ${err.message}`);
    }

    console.log(`\n2. Breeze 1-minute futures candles for ${symbol} ...`);
    const [rows] = await pool.query(
        `SELECT expiry, MIN(trade_date) mn, MAX(trade_date) mx FROM futures_history
         WHERE symbol = ? GROUP BY expiry ORDER BY expiry DESC LIMIT 1`,
        [symbol]
    );
    if (!rows.length) {
        console.log(`   no ${symbol} contracts in futures_history yet — run futures discovery first (npm run futures -- <YEAR> --skip-enrich --symbols=${symbol})`);
        await pool.end();
        process.exit(0);
    }
    const { expiry, mn, mx } = rows[0];
    const from = mn;
    const to = mx <= expiry ? mx : expiry;
    console.log(`   contract: ${symbol} exp ${expiry}, range ${from}..${to}`);
    try {
        const candles = await historicalService.getFutureMinuteCandles({
            stockCode: symbol, expirySql: expiry, fromDateStr: from, toDateStr: to,
        });
        console.log(`   got ${candles.length} candles`);
        if (candles.length) {
            console.log("   first:", candles[0]);
            console.log("   last: ", candles[candles.length - 1]);
        } else {
            console.log("   0 candles — check the Breeze stock code / exchange for this symbol (breeze/symbolMap.js)");
        }
    } catch (err) {
        console.error(`   Breeze futures call failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await pool.end();
})();
