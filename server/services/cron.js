const cron = require("node-cron");
const { pool } = require("../config/db");
const breeze = require("./breeze");

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
// Small delay between contract-level API calls to stay well under Breeze's
// rate limits (see project rule: retry/backoff and request queuing required).
const REQUEST_GAP_MS = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function splitDatetime(datetime) {
    const [date, time] = datetime.split(" ");
    return { date, time };
}

async function storeOHLCV(symbol, rows) {
    if (!rows.length) return;
    const values = rows.map((r) => {
        const { date, time } = splitDatetime(r.datetime);
        return [symbol, date, time, r.open, r.high, r.low, r.close, r.volume];
    });
    await pool.query(
        `INSERT INTO ohlcv_data (symbol, trade_date, trade_time, open, high, low, close, volume)
         VALUES ?
         ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low),
           close=VALUES(close), volume=VALUES(volume)`,
        [values]
    );
}

// Merges same-minute call/put rows for one contract pair into option_chain_history
// rows. IV/Greeks are not provided by Breeze at all (live or historical) — left
// null here, to be filled in by a Black-Scholes calculator (server/utils, TODO).
async function storeOptionChainMinutes(symbol, expiryDate, strike, callRows, putRows) {
    const byTime = new Map();
    for (const r of callRows) {
        const { date, time } = splitDatetime(r.datetime);
        byTime.set(time, { date, time, ceLtp: r.close, ceOi: r.open_interest, ceVolume: r.volume });
    }
    for (const r of putRows) {
        const { date, time } = splitDatetime(r.datetime);
        const row = byTime.get(time) ?? { date, time };
        row.peLtp = r.close;
        row.peOi = r.open_interest;
        row.peVolume = r.volume;
        byTime.set(time, row);
    }
    const rows = Array.from(byTime.values());
    if (!rows.length) return;

    const values = rows.map((r) => [
        symbol, r.date, r.time, expiryDate, strike,
        r.ceLtp ?? null, r.ceOi ?? null, r.ceVolume ?? null,
        r.peLtp ?? null, r.peOi ?? null, r.peVolume ?? null,
    ]);
    await pool.query(
        `INSERT INTO option_chain_history (
           symbol, trade_date, trade_time, expiry, strike,
           ce_ltp, ce_oi, ce_volume, pe_ltp, pe_oi, pe_volume
         ) VALUES ?
         ON DUPLICATE KEY UPDATE
           ce_ltp=VALUES(ce_ltp), ce_oi=VALUES(ce_oi), ce_volume=VALUES(ce_volume),
           pe_ltp=VALUES(pe_ltp), pe_oi=VALUES(pe_oi), pe_volume=VALUES(pe_volume)`,
        [values]
    );
}

async function pullOHLCVForDate(symbol, dateStr) {
    const ohlcv = await breeze.getHistoricalData({
        interval: "1minute",
        fromDate: `${dateStr}T00:00:00.000Z`,
        toDate: `${dateStr}T23:59:59.000Z`,
        stockCode: symbol,
        exchangeCode: "NSE",
        productType: "cash",
    });
    await storeOHLCV(symbol, ohlcv?.Success ?? []);
}

// Pulls the full day's minute-by-minute option chain (price + OI) for one
// expiry, by looping every currently-listed strike and fetching each
// call/put contract's history individually (the live snapshot endpoint
// can't give historical/intraday data, only "right now").
async function pullOptionChainForExpiry(symbol, expiryDateApi, expiryDateSql, dateStr) {
    const liveChain = await breeze.getFullOptionChain({ stockCode: symbol, expiryDate: expiryDateApi });
    const strikes = liveChain.map((r) => r.strike);

    const fromDate = `${dateStr}T00:00:00.000Z`;
    const toDate = `${dateStr}T23:59:59.000Z`;

    for (const strike of strikes) {
        const [callResp, putResp] = await Promise.all([
            breeze.getContractHistory({
                stockCode: symbol, expiryDate: expiryDateApi, right: "call",
                strikePrice: String(strike), fromDate, toDate,
            }),
            breeze.getContractHistory({
                stockCode: symbol, expiryDate: expiryDateApi, right: "put",
                strikePrice: String(strike), fromDate, toDate,
            }),
        ]);
        await storeOptionChainMinutes(
            symbol, expiryDateSql, strike,
            callResp?.Success ?? [], putResp?.Success ?? []
        );
        await sleep(REQUEST_GAP_MS);
    }
}

// TODO: derive real active expiries (nearest weekly/monthly, holiday-aware)
// instead of a hardcoded lookahead. For now this needs the caller to know
// valid expiry dates in both Breeze's "DD-MMM-YYYY" API format and SQL "YYYY-MM-DD".
async function pullSymbolForDate(symbol, dateStr, expiries) {
    await pullOHLCVForDate(symbol, dateStr);
    for (const { api, sql } of expiries) {
        await pullOptionChainForExpiry(symbol, api, sql, dateStr);
    }
}

async function runNightlyPull(expiriesBySymbol) {
    const dateStr = new Date().toISOString().slice(0, 10);
    for (const symbol of SYMBOLS) {
        try {
            await pullSymbolForDate(symbol, dateStr, expiriesBySymbol?.[symbol] ?? []);
            console.log(`[cron] stored ${symbol} data for ${dateStr}`);
        } catch (err) {
            console.error(`[cron] failed to pull ${symbol} for ${dateStr}:`, err.message);
        }
    }
}

// Runs 23:00 IST, Mon-Fri, after market close and settlement.
function start() {
    cron.schedule("0 23 * * 1-5", () => runNightlyPull(), { timezone: "Asia/Kolkata" });
    console.log("[cron] nightly historical data pull scheduled for 23:00 IST (Mon-Fri)");
}

module.exports = { start, runNightlyPull };
