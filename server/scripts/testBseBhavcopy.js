// scripts/testBseBhavcopy.js — one-day sanity check for services/bseBhavcopy.js
// BEFORE running any real backfill. bseindia.com isn't reachable from where
// this was written — this is the real first test of the URL AND the column
// names (see services/bseBhavcopy.js header for what's confirmed vs guessed).
//
// Run:  cd server && node scripts/testBseBhavcopy.js [SYMBOL] [DATE]
//   SYMBOL - default SENSEX
//   DATE   - 'YYYY-MM-DD', default 2024-12-06 (a real filename for this exact
//            date turned up via web search, so it's the one date we have any
//            actual confirmation exists — override with a recent date once
//            this first run confirms the URL pattern/columns are right)

require("dotenv").config();
const bseBhavcopy = require("../services/bseBhavcopy");

(async () => {
    const symbol = (process.argv[2] || "SENSEX").toUpperCase();
    const dateStr = process.argv[3] || "2024-12-06";
    console.log(`Fetching BSE bhavcopy for ${dateStr} from ${bseBhavcopy.buildBseBhavcopyUrl(dateStr)} ...`);
    try {
        const bySymbol = await bseBhavcopy.getDayRowsBySymbol(dateStr);
        console.log(`Parsed OK. ${bySymbol.size} symbols found in the file.`);
        console.log(`Symbols (first 20): ${[...bySymbol.keys()].slice(0, 20).join(", ")}`);
        const rows = bySymbol.get(symbol) || [];
        console.log(`${symbol}: ${rows.length} CE/PE rows.`);
        console.log("Sample (first 5):", rows.slice(0, 5));
        process.exit(0);
    } catch (err) {
        console.error("BSE BHAVCOPY TEST FAILED:", err.message);
        process.exit(1);
    }
})();
