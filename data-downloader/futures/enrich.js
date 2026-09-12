// futures/enrich.js — phase 2 of futures/run.js (also runnable standalone).
//
// The futures counterpart to breeze/enrich.js. Reads the (symbol, expiry)
// contracts monthDiscovery.js already put in futures_history for the date
// range, and for each one that has no 1-minute row yet, pulls Breeze
// 1-minute candles and upserts them. No Greeks (futures have no IV).
//
// Usage: node futures/enrich.js [SYMBOL] [FROM_DATE] [TO_DATE]
//
// Resumable: skips any (symbol, expiry) that already has a non-15:30:00 row.
// Propagates the rateLimiter "daily call budget spent" error so a caller
// (futures/run.js) can stop the whole run cleanly.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { pool } = require("../lib/db");
const { addDays, todayIst } = require("../lib/dates");
const historicalService = require("../breeze/historicalService");
const rateLimiter = require("../breeze/rateLimiter");
const symbolMap = require("../breeze/symbolMap");
const { storeRows, withOiChange } = require("../lib/futuresStorage");

async function loadContractStatuses(symbol, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT expiry,
                MIN(trade_date) AS minDate, MAX(trade_date) AS maxDate,
                MAX(trade_time <> '15:30:00') AS hasMinuteRow
         FROM futures_history
         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
         GROUP BY expiry
         ORDER BY expiry`,
        [symbol, fromDate, toDate]
    );
    return rows.map((r) => ({
        expiry: r.expiry,
        range: { from: r.minDate, to: r.maxDate },
        alreadyEnriched: Number(r.hasMinuteRow) === 1,
    }));
}

/** underlying_price per date (EOD row's value from discovery), for the minute rows to carry. */
async function loadSpotByDate(symbol, fromDate, toDate) {
    const [rows] = await pool.query(
        `SELECT trade_date, MAX(underlying_price) AS price FROM futures_history
         WHERE symbol = ? AND trade_date BETWEEN ? AND ? AND underlying_price IS NOT NULL
         GROUP BY trade_date`,
        [symbol, fromDate, toDate]
    );
    return new Map(rows.map((r) => [r.trade_date, Number(r.price)]));
}

async function backfillSymbol(symbol, fromDate, toDate, opts = {}) {
    const exchangeCode = opts.exchangeCode || symbolMap.exchangeCodeFor(symbol);
    const contracts = await loadContractStatuses(symbol, fromDate, toDate);
    if (!contracts.length) return { rowsStored: 0, contractsFailed: 0, contractsSkipped: 0, contractsTotal: 0 };

    const spotByDate = await loadSpotByDate(symbol, fromDate, toDate);
    let rowsStored = 0, contractsFailed = 0, contractsSkipped = 0;

    for (const { expiry, range, alreadyEnriched } of contracts) {
        if (alreadyEnriched) { contractsSkipped += 1; continue; }
        try {
            const raw = await historicalService.getFutureMinuteCandles({
                stockCode: symbol, expirySql: expiry, fromDateStr: range.from, toDateStr: range.to, exchangeCode,
            });
            rowsStored += await storeRows(symbol, expiry, withOiChange(raw), spotByDate);
        } catch (err) {
            contractsFailed += 1;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[fut-enrich] ${symbol} ${expiry}: ${msg}`);
            if (/daily call budget spent/i.test(msg)) throw err;
        }
    }
    return { rowsStored, contractsFailed, contractsSkipped, contractsTotal: contracts.length };
}

async function main() {
    const symbol = (process.argv[2] || "NIFTY").toUpperCase();
    const today = todayIst();
    const toDate = process.argv[4] || addDays(today, -1);
    const fromDate = process.argv[3] || addDays(toDate, -365 * 3);

    console.log(`[fut-enrich] ${symbol}: ${fromDate} .. ${toDate} (Breeze budget left today: ${rateLimiter.remainingToday()})`);
    try {
        const r = await backfillSymbol(symbol, fromDate, toDate);
        if (!r.contractsTotal) console.log("[fut-enrich] nothing to do — run futures discovery for this symbol/range first.");
        else console.log(`[fut-enrich] done. contracts=${r.contractsTotal} (skipped ${r.contractsSkipped}), rows=${r.rowsStored}, failed=${r.contractsFailed}, budget left=${rateLimiter.remainingToday()}`);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/daily call budget spent/i.test(msg)) {
            console.log(`[fut-enrich] ${msg}`);
            console.log("[fut-enrich] stopping — re-run tomorrow, it resumes.");
        } else throw err;
    }
    await pool.end();
}

module.exports = { backfillSymbol };

if (require.main === module) {
    main().catch((err) => {
        console.error("[fut-enrich] fatal:", err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
