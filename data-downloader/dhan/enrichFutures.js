// dhan/enrichFutures.js — DAILY-ONLY futures history via Dhan (confirmed:
// minute-level intraday for an old/expired futures contract came back
// empty in every real test — /charts/historical is the only path that
// reaches back to 2023, and it does so as a CONTINUOUS ROLLING series, not
// any one literal contract's real life; see historicalService.js's header).
//
// Real expiry per row is derived the same way as options (dhan/expiryResolver.js),
// reusing the MONTH-classified expiries already known from bhavcopy's option
// discovery — index/stock monthly OPTIONS and monthly FUTURES share the same
// NSE expiry day, so no separate futures-specific discovery pass is needed.

const { addDays } = require("../lib/dates");
const instrumentMaster = require("./instrumentMaster");
const historicalService = require("./historicalService");
const expiryResolver = require("./expiryResolver");
const futuresStorage = require("../lib/futuresStorage");

async function enrichFuturesYear(symbol, year) {
    const securityId = await instrumentMaster.resolveAnyFutureSecurityId(symbol);
    if (!securityId) {
        console.warn(`[dhan-futures] ${symbol}: no FUTIDX/FUTSTK contract found in Dhan's master (no futures for this underlying) — skipped`);
        return { rowsStored: 0 };
    }
    const isIndex = Object.prototype.hasOwnProperty.call(instrumentMaster.INDEX_SECURITY_IDS, symbol.toUpperCase()) && symbol.toUpperCase() !== "INDIAVIX";
    const instrument = isIndex ? "FUTIDX" : "FUTSTK";

    const from = `${year}-01-01`, to = `${year}-12-31`;
    const rows = await historicalService.getFuturesDaily(securityId, instrument, from, to);
    if (!rows.length) {
        console.log(`[dhan-futures] ${symbol} ${year}: 0 rows returned`);
        return { rowsStored: 0 };
    }

    // Monthly futures share the index/stock's own monthly OPTIONS expiry day.
    const allExpiries = await expiryResolver.knownExpiries(symbol, from, addDays(to, 60));
    const { month: monthExp } = expiryResolver.classifyExpiries(allExpiries);
    if (!monthExp.length) {
        console.warn(`[dhan-futures] ${symbol} ${year}: no monthly expiries known yet (run options bhavcopy discovery first) — skipped`);
        return { rowsStored: 0 };
    }

    const byExpiry = new Map();
    for (const r of rows) {
        const expiry = expiryResolver.expiryForRank(r.date, monthExp, 1);
        if (!expiry) continue;
        if (!byExpiry.has(expiry)) byExpiry.set(expiry, []);
        byExpiry.get(expiry).push(r);
    }

    let totalRows = 0;
    for (const [expiry, candles] of byExpiry) {
        const withOi = futuresStorage.withOiChange(candles);
        totalRows += await futuresStorage.storeRows(symbol.toUpperCase(), expiry, withOi, new Map());
    }
    console.log(`[dhan-futures] ${symbol} ${year}: ${totalRows} daily rows stored across ${byExpiry.size} monthly contracts`);
    return { rowsStored: totalRows };
}

module.exports = { enrichFuturesYear };
