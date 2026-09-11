// scripts/backfillFutures.js — forward-fill futures_history via Angel One.
//
// The Angel One counterpart to data-downloader/futures/ (which does the deep
// 2023+ history via ICICI Breeze). This one covers the RECENT window Angel
// One can actually serve — its scrip master only lists currently-live
// contracts, so this reaches back weeks (the current contracts' lifetime),
// not years. Run it daily (or wire nothing — services/cron.js already calls
// pullFuturesForDate for the index futures every night).
//
// Usage: node scripts/backfillFutures.js [SYMBOL|ALL] [DAYS_BACK]
//   SYMBOL     - underlying (NIFTY, RELIANCE, ...) or ALL (default ALL)
//   DAYS_BACK  - trading-day lookback from yesterday (default 30)
//
// Covers FUTIDX (index futures) + FUTSTK (stock futures) from the Angel One
// scrip master. Writes futures_history (symbol, expiry, minute OHLC + OI +
// oi_change). Resumable: skips any (symbol, expiry, date) that already has a
// minute-level row. ON DUPLICATE KEY UPDATE, so re-runs never duplicate.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const angelHist = require("../services/angelOneHistorical");
const instrumentMaster = require("../services/instrumentMaster");
const { addDays } = require("../services/backtestEngine");

const SCRIP_MASTER = path.join(__dirname, "..", "data", "OpenAPIScripMaster.json");
const EOD_TIME = "15:30:00";
const INSERT_BATCH_SIZE = 500;

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "23NOV2026" -> "2026-11-23", string-only (Gotcha #12). */
function expiryToSql(raw) {
    const m = String(raw).match(/^(\d{2})([A-Za-z]{3})(\d{4})$/);
    if (!m) return null;
    const mon = MONTHS[m[2].toUpperCase()];
    return mon ? `${m[3]}-${mon}-${m[1]}` : null;
}

function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function loadFuturesContracts(onlySymbol) {
    if (!fs.existsSync(SCRIP_MASTER)) {
        throw new Error(
            `Angel One scrip master not found at ${SCRIP_MASTER}. Start the server once (it downloads it) or run any script that calls instrumentMaster.ensureLoaded() first.`
        );
    }
    const all = JSON.parse(fs.readFileSync(SCRIP_MASTER, "utf8"));
    const out = [];
    for (const row of all) {
        if (row.instrumenttype !== "FUTIDX" && row.instrumenttype !== "FUTSTK") continue;
        const underlying = String(row.name || "").toUpperCase();
        if (!underlying) continue;
        if (onlySymbol && onlySymbol !== "ALL" && underlying !== onlySymbol) continue;
        const expiry = expiryToSql(row.expiry);
        if (!expiry) continue;
        out.push({
            underlying,
            expiry,
            token: String(row.token),
            exchange: row.exch_seg || "NFO",
        });
    }
    return out;
}

async function alreadyFilled(symbol) {
    const [rows] = await pool.query(
        `SELECT DISTINCT expiry, trade_date FROM futures_history
         WHERE symbol = ? AND trade_time <> ?`,
        [symbol, EOD_TIME]
    );
    return new Set(rows.map((r) => `${r.expiry}|${r.trade_date}`));
}

async function storeDay(symbol, expiry, candles, oiByTime) {
    if (!candles.length) return 0;
    let prevOi = null;
    const values = candles.map((c) => {
        const oi = oiByTime.get(c.time) ?? null;
        const oiChange = prevOi != null && oi != null ? oi - prevOi : null;
        prevOi = oi ?? prevOi;
        return [symbol, expiry, c.date, c.time, c.open, c.high, c.low, c.close, c.volume, oi, oiChange, null];
    });
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
        await pool.query(
            `INSERT INTO futures_history
               (symbol, expiry, trade_date, trade_time, open, high, low, close, volume, oi, oi_change, underlying_price)
             VALUES ?
             ON DUPLICATE KEY UPDATE
               open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close),
               volume=VALUES(volume), oi=VALUES(oi), oi_change=VALUES(oi_change)`,
            [values.slice(i, i + INSERT_BATCH_SIZE)]
        );
    }
    return values.length;
}

async function main() {
    const onlySymbol = (process.argv[2] || "ALL").toUpperCase();
    const daysBack = Number(process.argv[3] || 30);
    const today = instrumentMaster.todayIst();
    const endDate = addDays(today, -1);
    const startDate = addDays(endDate, -daysBack);

    const contracts = loadFuturesContracts(onlySymbol);
    if (!contracts.length) {
        console.log(`[fut-angel] no futures contracts in the scrip master for "${onlySymbol}"`);
        await pool.end();
        return;
    }

    // Group by underlying so the resumable skip-set is loaded once per symbol.
    const bySymbol = new Map();
    for (const c of contracts) {
        if (!bySymbol.has(c.underlying)) bySymbol.set(c.underlying, []);
        bySymbol.get(c.underlying).push(c);
    }

    console.log(`[fut-angel] ${contracts.length} contracts across ${bySymbol.size} underlyings, ${startDate}..${endDate}`);

    let totalRows = 0, contractDaysDone = 0, contractDaysFailed = 0;
    for (const [symbol, list] of bySymbol) {
        const filled = await alreadyFilled(symbol);
        for (const { expiry, token, exchange } of list) {
            for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
                const dow = dayOfWeek(d);
                if (dow === 0 || dow === 6) continue;
                if (d > expiry) continue; // contract already expired by this date
                if (filled.has(`${expiry}|${d}`)) continue;
                try {
                    const candles = await angelHist.getDayCandles({ exchange, symboltoken: token, dateStr: d });
                    if (!candles.length) { continue; } // holiday / no trades
                    const oi = await angelHist.getDayOpenInterest({ exchange, symboltoken: token, dateStr: d }).catch(() => new Map());
                    totalRows += await storeDay(symbol, expiry, candles, oi);
                    contractDaysDone += 1;
                } catch (err) {
                    contractDaysFailed += 1;
                    console.error(`[fut-angel] ${symbol} ${expiry} ${d}: ${err.message}`);
                }
            }
        }
        console.log(`[fut-angel] ${symbol}: done (${list.length} contracts). running totals — rows=${totalRows}, contract-days ok=${contractDaysDone} failed=${contractDaysFailed}`);
    }

    console.log(`[fut-angel] complete. rows stored=${totalRows}, contract-days ok=${contractDaysDone}, failed=${contractDaysFailed}`);
    await pool.end();
}

main().catch((err) => {
    console.error("[fut-angel] fatal:", err.message);
    process.exit(1);
});
