const { pool } = require("../config/db");

// Reads ONLY from MySQL (option_chain_history + ohlcv_data) — never the live
// Breeze API, per project hard rule. `option_chain_history.underlying_price`
// isn't populated by cron.js's ingestion (see CLAUDE.md), so spot price at
// any timestamp comes from a join with ohlcv_data instead.
//
// Dates are handled as plain 'YYYY-MM-DD' strings throughout, not JS Date
// objects — the pool is configured with `dateStrings: true` (config/db.js),
// so mysql2 returns DATE columns as strings already. Using Date objects for
// arithmetic caused a real timezone bug elsewhere in this project (see
// CLAUDE.md gotchas on expiryDisplayToApi); string-based day/month math here
// avoids that class of bug entirely by never invoking a timezone conversion.

function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const utcMs = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
    const dt = new Date(utcMs);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function daysBetween(dateStrA, dateStrB) {
    const [ay, am, ad] = dateStrA.split("-").map(Number);
    const [by, bm, bd] = dateStrB.split("-").map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / (24 * 60 * 60 * 1000));
}

function yearMonthOf(dateStr) {
    return dateStr.slice(0, 7); // "YYYY-MM"
}

async function getTradingDays(symbol, startDate, endDate) {
    const [rows] = await pool.query(
        `SELECT DISTINCT trade_date FROM ohlcv_data
         WHERE symbol = ? AND trade_date BETWEEN ? AND ? ORDER BY trade_date`,
        [symbol, startDate, endDate]
    );
    return rows.map((r) => r.trade_date);
}

async function getExpiries(symbol, fromDate) {
    const [rows] = await pool.query(
        `SELECT DISTINCT expiry FROM option_chain_history
         WHERE symbol = ? AND expiry >= ? ORDER BY expiry`,
        [symbol, fromDate]
    );
    return rows.map((r) => r.expiry);
}

// Monthly expiry = the last expiry chronologically within its calendar month
// among the known expiry set; every other expiry in that month is "weekly".
// This is inferred from the data itself, not the exchange calendar, so a
// month with only one expiry present will just count that one as monthly.
function classifyExpiries(expiries) {
    const byMonth = new Map();
    for (const exp of expiries) {
        const key = yearMonthOf(exp);
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key).push(exp);
    }
    const monthly = new Set();
    for (const list of byMonth.values()) monthly.add(list[list.length - 1]);
    return (exp) => (monthly.has(exp) ? "monthly" : "weekly");
}

function pickExpiryForDay(day, expiries, expiryType, classify) {
    const candidates = expiries.filter((e) => e >= day && classify(e) === expiryType);
    return candidates.length ? candidates[0] : null;
}

async function getSpotAt(symbol, date, time) {
    const [rows] = await pool.query(
        `SELECT close FROM ohlcv_data WHERE symbol=? AND trade_date=? AND trade_time>=?
         ORDER BY trade_time ASC LIMIT 1`,
        [symbol, date, time]
    );
    return rows[0]?.close ?? null;
}

async function getStrikeGap(symbol, expiry) {
    const [rows] = await pool.query(
        `SELECT DISTINCT strike FROM option_chain_history WHERE symbol=? AND expiry=? ORDER BY strike`,
        [symbol, expiry]
    );
    if (rows.length < 2) return 50; // fallback
    const gaps = {};
    for (let i = 1; i < rows.length; i++) {
        const g = Number(rows[i].strike) - Number(rows[i - 1].strike);
        gaps[g] = (gaps[g] || 0) + 1;
    }
    return Number(Object.entries(gaps).sort((a, b) => b[1] - a[1])[0][0]);
}

async function getEntryPrices(symbol, expiry, date, time, strikes) {
    const [rows] = await pool.query(
        `SELECT strike, ce_ltp, pe_ltp FROM option_chain_history
         WHERE symbol=? AND expiry=? AND trade_date=? AND trade_time>=?
         AND strike IN (?) ORDER BY trade_time ASC LIMIT ?`,
        [symbol, expiry, date, time, strikes, strikes.length * 4]
    );
    const byStrike = new Map();
    for (const r of rows) {
        if (!byStrike.has(Number(r.strike))) byStrike.set(Number(r.strike), r);
    }
    return byStrike;
}

async function getForwardMinutes(symbol, expiry, date, fromTime, strikes) {
    const [rows] = await pool.query(
        `SELECT trade_time, strike, ce_ltp, pe_ltp FROM option_chain_history
         WHERE symbol=? AND expiry=? AND trade_date=? AND trade_time>=?
         AND strike IN (?) ORDER BY trade_time ASC`,
        [symbol, expiry, date, fromTime, strikes]
    );
    const byMinute = new Map();
    for (const r of rows) {
        if (!byMinute.has(r.trade_time)) byMinute.set(r.trade_time, new Map());
        byMinute.get(r.trade_time).set(Number(r.strike), r);
    }
    return byMinute; // Map<time, Map<strike, row>>
}

function legPnlAtPrices(legs, priceByStrike) {
    let pnl = 0;
    for (const leg of legs) {
        const row = priceByStrike.get(leg.strike);
        if (!row) return null; // missing data this minute
        const price = leg.type === "CE" ? row.ce_ltp : row.pe_ltp;
        if (price == null) return null;
        const diff = leg.action === "buy" ? price - leg.entryPrice : leg.entryPrice - price;
        pnl += diff * leg.qty;
    }
    return pnl;
}

function computeStats(trades) {
    if (!trades.length) return { netPnl: 0, winRate: 0, totalTrades: 0, maxDrawdown: 0, sharpeRatio: 0, equityCurve: [] };

    let cumulative = 0, peak = 0, maxDrawdown = 0;
    const equityCurve = trades.map((t) => {
        cumulative += t.pnl;
        peak = Math.max(peak, cumulative);
        maxDrawdown = Math.min(maxDrawdown, cumulative - peak);
        return { date: t.entryDate, equity: Number(cumulative.toFixed(2)) };
    });

    const wins = trades.filter((t) => t.pnl > 0).length;
    const pnls = trades.map((t) => t.pnl);
    const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const variance = pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / pnls.length;
    const stdev = Math.sqrt(variance);
    // Simplified per-trade Sharpe proxy (mean/stdev of trade P&L) — NOT a
    // proper annualized Sharpe on capital deployed, which needs a margin/
    // capital-base assumption we don't have. Labelled as such in the API response.
    const sharpeRatio = stdev ? mean / stdev : 0;

    return {
        netPnl: Number(cumulative.toFixed(2)),
        winRate: Number(((wins / trades.length) * 100).toFixed(2)),
        totalTrades: trades.length,
        maxDrawdown: Number(maxDrawdown.toFixed(2)),
        sharpeRatio: Number(sharpeRatio.toFixed(3)),
        equityCurve,
    };
}

// legs: [{ action: 'buy'|'sell', type: 'CE'|'PE', strikeOffset: int, qty: int }]
// strikeOffset is in multiples of that day's strike gap from ATM (0 = ATM).
// startDate/endDate/entryTime are plain strings: 'YYYY-MM-DD' / 'HH:MM:SS'.
async function runBacktest({ symbol, expiryType, startDate, endDate, legs, entryTime, dte, stopLossPct, targetPct }) {
    const tradingDays = await getTradingDays(symbol, startDate, endDate);
    const expiries = await getExpiries(symbol, startDate);
    if (!expiries.length) {
        return { trades: [], skipped: [], ...computeStats([]), note: "No option_chain_history data for this symbol/range — run the backfill script first." };
    }
    const classify = classifyExpiries(expiries);
    const strikeGapCache = new Map();

    const trades = [];
    const skipped = [];

    for (const day of tradingDays) {
        const expiry = pickExpiryForDay(day, expiries, expiryType, classify);
        if (!expiry) { skipped.push({ day, reason: "no matching expiry" }); continue; }
        if (dte != null && daysBetween(day, expiry) !== dte) { skipped.push({ day, reason: "dte mismatch" }); continue; }

        const spot = await getSpotAt(symbol, day, entryTime);
        if (spot == null) { skipped.push({ day, reason: "no spot data" }); continue; }

        if (!strikeGapCache.has(expiry)) strikeGapCache.set(expiry, await getStrikeGap(symbol, expiry));
        const gap = strikeGapCache.get(expiry);
        const atmStrike = Math.round(spot / gap) * gap;
        const dayLegs = legs.map((l) => ({ ...l, strike: atmStrike + l.strikeOffset * gap }));
        const strikes = [...new Set(dayLegs.map((l) => l.strike))];

        const entryRows = await getEntryPrices(symbol, expiry, day, entryTime, strikes);
        let missingEntry = false;
        for (const leg of dayLegs) {
            const row = entryRows.get(leg.strike);
            const price = row ? (leg.type === "CE" ? row.ce_ltp : row.pe_ltp) : null;
            if (price == null) { missingEntry = true; break; }
            leg.entryPrice = Number(price);
        }
        if (missingEntry) { skipped.push({ day, reason: "no entry price data" }); continue; }

        const entryCost = dayLegs.reduce((s, l) => s + l.entryPrice * l.qty, 0);
        const slAmount = stopLossPct ? (stopLossPct / 100) * Math.abs(entryCost) : null;
        const targetAmount = targetPct ? (targetPct / 100) * Math.abs(entryCost) : null;

        const forwardMinutes = await getForwardMinutes(symbol, expiry, day, entryTime, strikes);
        const times = [...forwardMinutes.keys()].sort();

        let exitTime = null, exitReason = "eod", finalPnl = 0;
        for (const time of times) {
            const priceByStrike = forwardMinutes.get(time);
            const pnl = legPnlAtPrices(dayLegs, priceByStrike);
            if (pnl == null) continue;
            finalPnl = pnl;
            if (slAmount != null && pnl <= -slAmount) { exitTime = time; exitReason = "stop_loss"; break; }
            if (targetAmount != null && pnl >= targetAmount) { exitTime = time; exitReason = "target"; break; }
        }
        if (!exitTime) {
            exitTime = times[times.length - 1] ?? entryTime;
            exitReason = day === expiry ? "expiry" : "eod";
        }

        trades.push({
            entryDate: day, expiry, legs: dayLegs, entryTime, exitTime,
            entryCost: Number(entryCost.toFixed(2)), pnl: Number(finalPnl.toFixed(2)), exitReason,
        });
    }

    return { trades, skipped, ...computeStats(trades) };
}

module.exports = { runBacktest, addDays };
