// dhan/enrichFutures.js — DAILY-ONLY futures history via Dhan (confirmed:
// minute-level intraday for an old/expired futures contract came back
// empty in every real test — /charts/historical is the only path that
// reaches back to 2023, and it does so as a CONTINUOUS ROLLING series, not
// any one literal contract's real life; see historicalService.js's header).
//
// Real expiry per row is derived the same way as options (dhan/expiryResolver.js
// + dhan/expiryDiscovery.js's pure in-memory bhavcopy lookup, never written to
// any table) — index/stock monthly OPTIONS and monthly FUTURES share the same
// NSE expiry day, so no separate futures-specific discovery pass is needed.

const { addDays } = require("../lib/dates");

function toRanges(dates) {
    const sorted = [...new Set(dates)].sort();
    const ranges = [];
    for (const date of sorted) {
        const previous = ranges[ranges.length - 1];
        if (!previous || addDays(previous[1], 1) !== date) ranges.push([date, date]);
        else previous[1] = date;
    }
    return ranges;
}
const instrumentMaster = require("./instrumentMaster");
const historicalService = require("./historicalService");
const expiryResolver = require("./expiryResolver");
const expiryDiscovery = require("./expiryDiscovery");
const futuresStorage = require("../lib/futuresStorage");

async function enrichFuturesYear(symbol, year, missingDates = null) {
    const securityId = await instrumentMaster.resolveAnyFutureSecurityId(symbol);
    if (!securityId) {
        console.warn(`[dhan-futures] ${symbol}: no FUTIDX/FUTSTK contract found in Dhan's master (no futures for this underlying) — skipped`);
        return { rowsStored: 0 };
    }
    const isIndex = Object.prototype.hasOwnProperty.call(instrumentMaster.INDEX_SECURITY_IDS, symbol.toUpperCase()) && symbol.toUpperCase() !== "INDIAVIX";
    const instrument = isIndex ? "FUTIDX" : "FUTSTK";
    const exchangeSegment = instrumentMaster.exchangeSegmentForFno(symbol); // SENSEX/BANKEX need BSE_FNO, not NSE_FNO — see instrumentMaster.js

    const from = `${year}-01-01`, to = `${year}-12-31`;
    const ranges = missingDates ? toRanges(missingDates) : [[from, to]];
    const rows = [];
    for (const [rangeFrom, rangeTo] of ranges) {
        rows.push(...await historicalService.getFuturesDaily(securityId, instrument, rangeFrom, rangeTo, exchangeSegment));
    }
    if (!rows.length) {
        console.log(`[dhan-futures] ${symbol} ${year}: 0 rows returned`);
        return { rowsStored: 0 };
    }

    // Monthly futures share the index/stock's own monthly OPTIONS expiry day.
    const allExpiries = await expiryDiscovery.discoverExpiries(symbol, from, addDays(to, 60));
    const { month: monthExp } = expiryResolver.classifyExpiries(allExpiries);
    if (!monthExp.length) {
        console.warn(`[dhan-futures] ${symbol} ${year}: no real monthly expiries found in NSE/BSE bhavcopy for this range — skipped`);
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
