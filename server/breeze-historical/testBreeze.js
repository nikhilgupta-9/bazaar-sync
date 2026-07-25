// breeze-historical/testBreeze.js — one-contract sanity check BEFORE running
// backfillBreeze.js for real. Confirms: session/auth works, the response
// shape historicalService.js expects actually matches reality, and the
// date/time convention (see historicalService.js header comment) round-trips
// sensibly.
//
// Run: cd server && node breeze-historical/testBreeze.js [SYMBOL] [EXPIRY] [STRIKE]
//   If EXPIRY/STRIKE are omitted, picks one real (expiry, strike) already in
//   option_chain_history for SYMBOL (i.e. run backfillBhavcopy.js first).

require("dotenv").config();
const { pool } = require("../config/db");
const historicalService = require("./historicalService");
const { addDays } = require("../services/backtestEngine");
const instrumentMaster = require("../services/instrumentMaster");

(async () => {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    let expiry = process.argv[3];
    let strike = process.argv[4] ? Number(process.argv[4]) : null;

    if (!expiry || !strike) {
        const [rows] = await pool.query(
            `SELECT expiry, strike FROM option_chain_history WHERE symbol = ? ORDER BY trade_date DESC LIMIT 1`,
            [symbol]
        );
        if (!rows.length) {
            console.error(`No existing contracts for ${symbol} in option_chain_history — run scripts/backfillBhavcopy.js first, or pass EXPIRY and STRIKE explicitly.`);
            process.exit(1);
        }
        expiry = expiry || rows[0].expiry;
        strike = strike || Number(rows[0].strike);
    }

    const toDate = instrumentMaster.todayIst() <= expiry ? addDays(instrumentMaster.todayIst(), -1) : expiry;
    const fromDate = addDays(toDate, -2);

    console.log(`Fetching ${symbol} ${strike} CE, expiry ${expiry}, range ${fromDate}..${toDate}...`);
    try {
        const candles = await historicalService.getOptionMinuteCandles({
            stockCode: symbol, expirySql: expiry, strike, right: "CE", fromDateStr: fromDate, toDateStr: toDate,
        });
        console.log(`Got ${candles.length} candles.`);
        console.log("First:", candles[0]);
        console.log("Last: ", candles[candles.length - 1]);
        process.exit(0);
    } catch (err) {
        console.error("BREEZE TEST FAILED:", err.message);
        process.exit(1);
    }
})();
