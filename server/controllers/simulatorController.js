// controllers/simulatorController.js
//
// "Simulator" — replays ONE real historical trading day minute-by-minute so
// a strategy's P&L can be watched evolving like it's happening live. Reads
// ONLY option_chain_history + ohlcv_data (same hard rule as backtestEngine.js
// and the same query patterns — getEntryPrices/getForwardMinutes there are
// the batch-backtest version of exactly what this does for a single day).
// Never touches Angel One.
const { pool } = require("../config/db");

function computeAtmStrike(strikes, spot) {
    if (!strikes.length || spot == null) return null;
    return strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]);
}

function computeMaxPain(rows) {
    if (!rows.length) return null;
    let bestStrike = rows[0].strike;
    let bestPayout = Infinity;
    for (const candidate of rows) {
        const S = candidate.strike;
        let payout = 0;
        for (const r of rows) {
            payout += (r.ceOi || 0) * Math.max(0, S - r.strike);
            payout += (r.peOi || 0) * Math.max(0, r.strike - S);
        }
        if (payout < bestPayout) {
            bestPayout = payout;
            bestStrike = S;
        }
    }
    return bestStrike;
}

function computePcr(rows) {
    const totalCe = rows.reduce((s, r) => s + (r.ceOi || 0), 0);
    const totalPe = rows.reduce((s, r) => s + (r.peOi || 0), 0);
    return totalCe ? Number((totalPe / totalCe).toFixed(2)) : null;
}

// Any symbol with real data in option_chain_history is valid — indices and
// the ~280 F&O stocks Bhavcopy/Breeze backfilled (Phase 7), not just the
// original 3 hardcoded indices. Mirrors optionChainService's DB-driven
// symbol handling rather than a fixed enum; an unknown symbol still comes
// back as a clean 404 ("no stored option data") from the query below, same
// as a known symbol with no data for the requested date.
function resolveSymbol(req, res) {
    const raw = req.params.symbol;
    const displaySymbol = raw ? raw.toUpperCase() : null;
    if (!displaySymbol || !/^[A-Z0-9&-]+$/.test(displaySymbol)) {
        res.status(400).json({ error: "a valid symbol is required" });
        return null;
    }
    return displaySymbol;
}

/** GET /api/simulator/dates/:symbol — trading days that actually have stored option data. */
async function listDates(req, res) {
    try {
        const symbol = resolveSymbol(req, res);
        if (!symbol) return;
        const [rows] = await pool.query(
            `SELECT DISTINCT trade_date FROM option_chain_history WHERE symbol = ? ORDER BY trade_date DESC LIMIT 60`,
            [symbol]
        );
        res.json({ symbol, dates: rows.map((r) => r.trade_date) });
    } catch (err) {
        console.error("[simulator/dates]", err);
        res.status(500).json({ error: err.message });
    }
}

async function getSpotAt(symbol, date, time) {
    const [rows] = await pool.query(
        `SELECT close FROM ohlcv_data WHERE symbol = ? AND trade_date = ? AND trade_time >= ?
         ORDER BY trade_time ASC LIMIT 1`,
        [symbol, date, time]
    );
    return rows[0]?.close != null ? Number(rows[0].close) : null;
}

/**
 * GET /api/simulator/chain/:symbol?date=YYYY-MM-DD&expiry=YYYY-MM-DD&time=HH:MM:SS
 * A real historical option-chain snapshot — same shape the frontend already
 * knows how to render (Strategy Builder's chain table). `expiry`/`time` are
 * optional: omitted expiry defaults to the earliest listed that day, omitted
 * time defaults to the day's earliest stored snapshot (so building legs
 * starts from "the beginning of the day", matching a real trading session).
 */
async function getChainAtTime(req, res) {
    try {
        const symbol = resolveSymbol(req, res);
        if (!symbol) return;
        const { date, expiry, time } = req.query;
        if (!date) return res.status(400).json({ error: "date is required (see /api/simulator/dates/:symbol)" });

        const [expiryRows] = await pool.query(
            `SELECT DISTINCT expiry FROM option_chain_history WHERE symbol = ? AND trade_date = ? ORDER BY expiry ASC`,
            [symbol, date]
        );
        const expiries = expiryRows.map((r) => r.expiry);
        if (!expiries.length) {
            return res.status(404).json({ error: `No stored option data for ${symbol} on ${date}` });
        }
        const selectedExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0];

        const [timeRows] = await pool.query(
            `SELECT DISTINCT trade_time FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND expiry = ? ORDER BY trade_time ASC`,
            [symbol, date, selectedExpiry]
        );
        const times = timeRows.map((r) => r.trade_time);
        const selectedTime = time && times.includes(time) ? time : times[0];

        const [rawRows] = await pool.query(
            `SELECT strike,
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
             FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND expiry = ? AND trade_time = ?
             ORDER BY strike ASC`,
            [symbol, date, selectedExpiry, selectedTime]
        );

        const spotPrice = await getSpotAt(symbol, date, selectedTime);

        const rows = rawRows.map((r) => ({
            strike: Number(r.strike),
            ce: {
                ltp: r.ce_ltp != null ? Number(r.ce_ltp) : null,
                oi: r.ce_oi != null ? Number(r.ce_oi) : null,
                oiChange: r.ce_oi_change != null ? Number(r.ce_oi_change) : null,
                iv: r.ce_iv != null ? Number(r.ce_iv) : null,
                volume: r.ce_volume != null ? Number(r.ce_volume) : null,
                delta: r.ce_delta != null ? Number(r.ce_delta) : null,
                gamma: r.ce_gamma != null ? Number(r.ce_gamma) : null,
                theta: r.ce_theta != null ? Number(r.ce_theta) : null,
                vega: r.ce_vega != null ? Number(r.ce_vega) : null,
            },
            pe: {
                ltp: r.pe_ltp != null ? Number(r.pe_ltp) : null,
                oi: r.pe_oi != null ? Number(r.pe_oi) : null,
                oiChange: r.pe_oi_change != null ? Number(r.pe_oi_change) : null,
                iv: r.pe_iv != null ? Number(r.pe_iv) : null,
                volume: r.pe_volume != null ? Number(r.pe_volume) : null,
                delta: r.pe_delta != null ? Number(r.pe_delta) : null,
                gamma: r.pe_gamma != null ? Number(r.pe_gamma) : null,
                theta: r.pe_theta != null ? Number(r.pe_theta) : null,
                vega: r.pe_vega != null ? Number(r.pe_vega) : null,
            },
        }));

        res.json({
            symbol,
            date,
            expiries,
            selectedExpiry,
            times,
            selectedTime,
            spotPrice,
            atmStrike: computeAtmStrike(rows.map((r) => r.strike), spotPrice),
            maxPainStrike: computeMaxPain(rows.map((r) => ({ strike: r.strike, ceOi: r.ce.oi, peOi: r.pe.oi }))),
            pcr: computePcr(rows.map((r) => ({ ceOi: r.ce.oi, peOi: r.pe.oi }))),
            rows,
        });
    } catch (err) {
        console.error("[simulator/chain]", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * POST /api/simulator/replay/:symbol  body: { date, expiry, legs }
 * legs: [{ strike, type: 'CE'|'PE', action: 'buy'|'sell', qty }]
 *
 * Entry price for every leg is looked up from the real stored LTP at the
 * day's EARLIEST snapshot (not trusted from the client) so a replay always
 * matches what was actually recorded, then every subsequent minute's P&L is
 * computed from the real stored LTP at that minute too — no Black-Scholes
 * approximation needed here, unlike the live "Strategy Chart" tab, because
 * the historical per-minute option prices are already persisted.
 */
async function replay(req, res) {
    try {
        const symbol = resolveSymbol(req, res);
        if (!symbol) return;
        const { date, expiry, legs } = req.body || {};
        if (!date || !expiry) return res.status(400).json({ error: "date and expiry are required" });
        if (!Array.isArray(legs) || !legs.length) return res.status(400).json({ error: "legs must be a non-empty array" });
        for (const leg of legs) {
            if (!leg.strike || !["CE", "PE"].includes(leg.type) || !["buy", "sell"].includes(leg.action)) {
                return res.status(400).json({ error: "each leg needs strike, type ('CE'|'PE'), action ('buy'|'sell')" });
            }
        }

        const strikes = [...new Set(legs.map((l) => Number(l.strike)))];

        const [timeRows] = await pool.query(
            `SELECT DISTINCT trade_time FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND expiry = ? ORDER BY trade_time ASC`,
            [symbol, date, expiry]
        );
        const times = timeRows.map((r) => r.trade_time);
        if (!times.length) return res.status(404).json({ error: `No stored option data for ${symbol} ${date} expiry ${expiry}` });
        const entryTime = times[0];

        const [priceRows] = await pool.query(
            `SELECT trade_time, strike, ce_ltp, pe_ltp FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND expiry = ? AND strike IN (?)
             ORDER BY trade_time ASC`,
            [symbol, date, expiry, strikes]
        );
        const byMinute = new Map(); // time -> Map<strike, {ce_ltp, pe_ltp}>
        for (const r of priceRows) {
            if (!byMinute.has(r.trade_time)) byMinute.set(r.trade_time, new Map());
            byMinute.get(r.trade_time).set(Number(r.strike), r);
        }

        const entryPrices = byMinute.get(entryTime);
        const legsWithEntry = legs.map((leg) => {
            const row = entryPrices?.get(Number(leg.strike));
            const entryPrice = row ? Number(leg.type === "CE" ? row.ce_ltp : row.pe_ltp) : null;
            return { ...leg, strike: Number(leg.strike), qty: Number(leg.qty) || 1, entryPrice };
        });

        const [ohlcvRows] = await pool.query(
            `SELECT trade_time, close FROM ohlcv_data WHERE symbol = ? AND trade_date = ? ORDER BY trade_time ASC`,
            [symbol, date]
        );
        const spotByTime = new Map(ohlcvRows.map((r) => [r.trade_time, Number(r.close)]));

        const series = times.map((time) => {
            const priceByStrike = byMinute.get(time);
            let pnl = null;
            if (priceByStrike) {
                pnl = 0;
                for (const leg of legsWithEntry) {
                    const row = priceByStrike.get(leg.strike);
                    const price = row ? Number(leg.type === "CE" ? row.ce_ltp : row.pe_ltp) : null;
                    if (price == null || leg.entryPrice == null) {
                        pnl = null;
                        break;
                    }
                    const diff = leg.action === "buy" ? price - leg.entryPrice : leg.entryPrice - price;
                    pnl += diff * leg.qty;
                }
            }
            return { time, spot: spotByTime.get(time) ?? null, pnl: pnl != null ? Number(pnl.toFixed(2)) : null };
        });

        res.json({ symbol, date, expiry, entryTime, legs: legsWithEntry, series });
    } catch (err) {
        console.error("[simulator/replay]", err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = { listDates, getChainAtTime, replay };
