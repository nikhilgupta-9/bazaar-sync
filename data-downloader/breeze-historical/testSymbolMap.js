// breeze-historical/testSymbolMap.js — sanity check for symbolMap.js BEFORE
// re-running backfillBreezeAll.js at scale. Confirms the NSE scrip master
// downloads/parses correctly and resolves known-good/known-bad symbols.
//
// Run: cd server && node breeze-historical/testSymbolMap.js [SYMBOL...]
//   Defaults to a mix observed in the real 2026-08-05 run: ABB (worked with
//   no mapping — NSE symbol happened to equal ICICI's code), 360ONE and
//   ABCAPITAL (returned 0 rows with no mapping — the reason this file
//   exists), plus the three indices and one more common stock.

require("dotenv").config();
const symbolMap = require("./symbolMap");

(async () => {
    const symbols = process.argv.slice(2).length
        ? process.argv.slice(2)
        : ["NIFTY", "BANKNIFTY", "FINNIFTY", "ABB", "360ONE", "ABCAPITAL", "RELIANCE"];

    console.log(`Resolving ${symbols.length} symbol(s)...\n`);
    for (const sym of symbols) {
        const isec = await symbolMap.resolveStockCode(sym);
        const changed = isec !== sym ? "" : "  (unchanged from NSE symbol)";
        console.log(`  ${sym.padEnd(12)} -> ${isec}${changed}`);
    }
    console.log(
        "\nIf any stock shows '(unchanged from NSE symbol)' AND that symbol " +
            "previously returned 0 rows in a real backfillBreezeAll.js run, the " +
            "scrip master genuinely has no entry for it — check the NSE symbol " +
            "spelling against ICICI's site by hand."
    );
})();
