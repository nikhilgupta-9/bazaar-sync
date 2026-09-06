// scripts/testUpstoxInstrumentMaster.js — sanity check for
// services/upstoxInstrumentMaster.js BEFORE trusting backfillUpstox.js's
// SYMBOL=ALL mode. Confirms: the file downloads, the CSV header matches what
// FIELD_CANDIDATES expects, and a few real stock symbols resolve to a
// plausible-looking instrument_key.
//
// Run: cd server && node scripts/testUpstoxInstrumentMaster.js [SYMBOL...]
//   Defaults to checking RELIANCE, TCS, HDFCBANK if no symbols passed.

require("dotenv").config();
const upstoxInstruments = require("../services/upstoxInstrumentMaster");

(async () => {
    const symbols = process.argv.slice(2).map((s) => s.toUpperCase());
    const toCheck = symbols.length ? symbols : ["RELIANCE", "TCS", "HDFCBANK"];

    console.log("Downloading/parsing Upstox instrument master...");
    const map = await upstoxInstruments.getEquityInstrumentKeyMap({ force: true });
    console.log(`Parsed ${map.size} equity rows. Cached at: ${upstoxInstruments.CACHE_PATH}`);

    for (const symbol of toCheck) {
        const key = map.get(symbol);
        console.log(key ? `${symbol} -> ${key}` : `${symbol} -> NOT FOUND`);
    }
})().catch((err) => {
    console.error("TEST FAILED:", err.message);
    process.exit(1);
});
