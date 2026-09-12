// test/testUpstoxFutures.js — confirm the futures counterpart of
// upstox/enrichFutures.js actually works BEFORE running it for real. Prints
// the RAW contract JSON from Get Expired Future Contracts so the unverified
// field name (see historicalService.js's resolveExpiredFutureKey header
// comment) can be checked by eye.
//
// Run: cd data-downloader && node test/testUpstoxFutures.js [SYMBOL]

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const upstox = require("../upstox/historicalService");
const upstoxInstruments = require("../upstox/instrumentMaster");

(async () => {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const underlyingKey = upstox.UNDERLYING_KEYS[symbol] || (await upstoxInstruments.resolveInstrumentKey(symbol));
    if (!underlyingKey) {
        console.error(`No Upstox instrument_key found for ${symbol}`);
        process.exit(1);
    }
    console.log(`${symbol} -> ${underlyingKey}`);

    const expiries = await upstox.getExpiries(underlyingKey);
    console.log(`${expiries.length} expiries. Oldest: ${expiries[0]}  Newest: ${expiries[expiries.length - 1]}`);
    if (!expiries.length) process.exit(0);

    // Futures only exist on the MONTHLY expiry (confirmed 2026-09-12) — most
    // of getExpiries()'s weekly options expiries correctly return 0
    // contracts here, so scan backwards from the newest until one hits.
    let latestExpiry = null, contracts = [];
    for (let i = expiries.length - 1; i >= 0 && !contracts.length; i--) {
        latestExpiry = expiries[i];
        contracts = await upstox.getExpiredFutureContracts(underlyingKey, latestExpiry);
    }
    console.log(`\nNearest expiry with a real futures series: ${latestExpiry} (${contracts.length} contract(s))`);
    console.log("Raw contract JSON:", JSON.stringify(contracts, null, 2));

    if (!contracts.length) {
        console.log("\nNo futures contract found on ANY of the expiries checked — double check the endpoint is live for this underlying.");
        process.exit(0);
    }

    const instrumentKey = upstox.resolveExpiredFutureKey(contracts[0]);
    if (!instrumentKey) {
        console.log("\n⚠ Neither `expired_instrument_key` nor `instrument_key` found on the contract above.");
        console.log("  Look at the raw JSON printed above, find the field that looks like an instrument key,");
        console.log("  and add it to resolveExpiredFutureKey() in upstox/historicalService.js before running enrichFutures.js for real.");
        process.exit(1);
    }
    console.log(`\nResolved instrument key: ${instrumentKey}`);

    const candles = await upstox.getExpiredCandles(instrumentKey, { interval: "1minute", fromDate: latestExpiry, toDate: latestExpiry });
    console.log(`Sample candles on expiry day (${latestExpiry}): ${candles.length}`);
    if (candles.length) {
        console.log("first:", candles[0]);
        console.log("last: ", candles[candles.length - 1]);
    }
    console.log("\nIf this all looks right, enrichFutures.js is safe to run for real.");
})().catch((err) => {
    console.error("UPSTOX FUTURES TEST FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
});
