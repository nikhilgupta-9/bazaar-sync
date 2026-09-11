// test/testUpstox.js — confirm the Upstox token works and print exactly how
// far back its expired-instruments API actually goes for one underlying,
// BEFORE running upstox/run.js for real. No daily-session pain here (unlike
// Breeze) — UPSTOX_ACCESS_TOKEN is long-lived — but the token can still
// eventually expire; this is the fast way to check.
//
// Run: cd data-downloader && node test/testUpstox.js [SYMBOL]

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
    if (!expiries.length) { process.exit(0); }

    const contracts = await upstox.getExpiredOptionContracts(underlyingKey, expiries[0]);
    console.log(`Oldest expiry (${expiries[0]}) has ${contracts.length} CE/PE contracts.`);
    if (contracts.length) {
        const sample = contracts[Math.floor(contracts.length / 2)];
        const candles = await upstox.getExpiredCandles(sample.instrument_key, {
            interval: "1minute", fromDate: expiries[0], toDate: expiries[0],
        });
        console.log(`Sample contract (strike ${sample.strike_price} ${sample.instrument_type}): ${candles.length} candles on expiry day.`);
    }
    console.log("\nIf the oldest expiry is much more recent than you expected, that's Upstox's own retention limit — see upstox/run.js's header comment.");
})().catch((err) => {
    console.error("UPSTOX TEST FAILED:", err instanceof Error ? err.message : String(err));
    process.exit(1);
});
