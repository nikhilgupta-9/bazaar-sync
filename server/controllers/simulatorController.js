// controllers/simulatorController.js
//
// "Simulator" — replays ONE real historical trading day minute-by-minute so
// a strategy's P&L can be watched evolving like it's happening live. All
// PRICING reads ONLY option_chain_history + ohlcv_data (same hard rule as
// backtestEngine.js and the same query patterns — getEntryPrices/
// getForwardMinutes there are the batch-backtest version of exactly what
// this does for a single day) — replay math never depends on Angel One.
// getChainAtTime/replay additionally read lotSizeHistoryService.getLotSizeAsOf
// (the historical trade date's real lot size, not today's — NSE revises F&O
// lot sizes periodically, so a 2022 replay must not use 2026's lot size;
// falls back to instrumentMaster's current scrip-master value only when no
// historical entry has been recorded yet) purely to attach/apply a real lot
// size — option_chain_history has no lot_size column (never stored
// historically), and without a real value every leg silently defaulted to
// lotSize=1 in payoff.js's legMultiplier, scaling every P&L/Greek number
// wrong. This is a read-only DB/cached-file lookup, not a live broker call —
// it doesn't touch the replay's price determinism, only the quantity
// multiplier.
const { pool } = require("../config/db");
const lotSizeHistoryService = require("../services/lotSizeHistoryService");

// listDates scans every row for a symbol (NIFTY alone is 6M+ rows after
// Phase 7's backfills) to compute a per-date distinct-snapshot count — even
// with idx_symbol_date_time in place, that's an ~8s covering-index scan,
// not something to redo on every Simulator page load. The underlying data
// is effectively append-only (only nightly cron/backfill scripts add rows;
// nothing edits a past date's rows in place), so a short TTL cache is safe
// and turns every repeat load (same user switching back, another user on
// the same symbol) instant. Same in-memory-Map convention as marketCache.js.
const DATES_CACHE_TTL_MS = 10 * 60 * 1000;
const datesCache = new Map(); // symbol -> { expiresAt, payload }

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

/**
 * GET /api/simulator/dates/:symbol — every trading day that actually has
 * stored option data. Previously capped at `LIMIT 60` (~3 months back),
 * which broke the calendar for anything older: Phase 7's NSE Bhavcopy
 * backfill stores YEARS of history, but the calendar's month/year nav lets
 * a user go back arbitrarily far — with only the 60 most recent dates known
 * client-side, every day in an older month looked unavailable (and wrongly
 * got a "Holiday" dot, since the frontend can't tell "never fetched" apart
 * from "confirmed no data"). No LIMIT now: distinct trade_dates for one
 * symbol over ~5 years is at most ~1,250 rows — a small, cheap payload.
 *
 * Also reports `sparseDates`: days with only 1 stored snapshot (an EOD-only
 * Bhavcopy row, see CLAUDE.md Phase 7) where the time-step scrubber has
 * nothing to move between. Previously a user only discovered this AFTER
 * picking the day and hitting a disabled -1m/+1m button; now the calendar
 * can mark it up front so real per-minute days (Angel One nightly cron) are
 * visually distinguishable from EOD-only days (Bhavcopy/Breeze-not-yet-run).
 */
async function listDates(req, res) {
    try {
        const symbol = resolveSymbol(req, res);
        if (!symbol) return;

        const cached = datesCache.get(symbol);
        if (cached && cached.expiresAt > Date.now()) {
            return res.json(cached.payload);
        }

        // FORCE INDEX: the optimizer's row-count estimate for idx_backtest_range
        // (symbol, expiry, trade_date, trade_time) makes it look cheaper than
        // idx_symbol_date_time here, but expiry sitting before trade_date in
        // that index means MySQL can't stream trade_date-grouped order from it
        // and falls back to a full filesort over every row for the symbol
        // (measured ~13s for NIFTY). idx_symbol_date_time (symbol, trade_date,
        // trade_time) was built for exactly this query and needs to be forced.
        const [rows] = await pool.query(
            `SELECT trade_date, COUNT(DISTINCT trade_time) AS snapshotCount
             FROM option_chain_history FORCE INDEX (idx_symbol_date_time)
             WHERE symbol = ? GROUP BY trade_date ORDER BY trade_date DESC`,
            [symbol]
        );
        const dates = rows.map((r) => r.trade_date);
        const sparseDates = rows.filter((r) => Number(r.snapshotCount) <= 1).map((r) => r.trade_date);
        const payload = { symbol, dates, sparseDates };

        datesCache.set(symbol, { expiresAt: Date.now() + DATES_CACHE_TTL_MS, payload });
        res.json(payload);
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
            `SELECT strike, underlying_price,
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume, ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume, pe_delta, pe_gamma, pe_theta, pe_vega
             FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND expiry = ? AND trade_time = ?
             ORDER BY strike ASC`,
            [symbol, date, selectedExpiry, selectedTime]
        );

        // ohlcv_data is empty for Bhavcopy-sourced (EOD-only) days — fall back to
        // the underlying_price already stored on the option_chain_history row itself.
        const fallbackSpot = rawRows.find((r) => r.underlying_price != null)?.underlying_price;
        const spotPrice = (await getSpotAt(symbol, date, selectedTime)) ?? (fallbackSpot != null ? Number(fallbackSpot) : null);

        let lotSize = null;
        try {
            lotSize = await lotSizeHistoryService.getLotSizeAsOf(symbol, date);
        } catch (err) {
            console.error("[simulator/chain] lot size lookup failed:", err.message);
        }

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
            lotSize,
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

        // Real lot size AS OF `date` (see getChainAtTime above) — every leg's
        // `qty` is a LOT count (same convention as payoff.js's
        // legMultiplier), so the pnl series below must scale by lotSize, not
        // just qty, or every P&L figure is wrong by a factor of the real lot
        // size (e.g. NIFTY's 75) — this was previously missing entirely (qty
        // used bare).
        let lotSize = null;
        try {
            lotSize = await lotSizeHistoryService.getLotSizeAsOf(symbol, date);
        } catch (err) {
            console.error("[simulator/replay] lot size lookup failed:", err.message);
        }
        const shareMultiplier = lotSize || 1;

        const [timeRows] = await pool.query(
            `SELECT DISTINCT trade_time FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND expiry = ? ORDER BY trade_time ASC`,
            [symbol, date, expiry]
        );
        const times = timeRows.map((r) => r.trade_time);
        if (!times.length) return res.status(404).json({ error: `No stored option data for ${symbol} ${date} expiry ${expiry}` });
        const entryTime = times[0];

        const [priceRows] = await pool.query(
            `SELECT trade_time, strike, underlying_price, ce_ltp, pe_ltp FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND expiry = ? AND strike IN (?)
             ORDER BY trade_time ASC`,
            [symbol, date, expiry, strikes]
        );
        const byMinute = new Map(); // time -> Map<strike, {ce_ltp, pe_ltp}>
        const fallbackSpotByTime = new Map(); // time -> underlying_price stored on the row itself
        for (const r of priceRows) {
            if (!byMinute.has(r.trade_time)) byMinute.set(r.trade_time, new Map());
            byMinute.get(r.trade_time).set(Number(r.strike), r);
            if (r.underlying_price != null && !fallbackSpotByTime.has(r.trade_time)) {
                fallbackSpotByTime.set(r.trade_time, Number(r.underlying_price));
            }
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
                    pnl += diff * leg.qty * shareMultiplier;
                }
            }
            const spot = spotByTime.get(time) ?? fallbackSpotByTime.get(time) ?? null;
            return { time, spot, pnl: pnl != null ? Number(pnl.toFixed(2)) : null };
        });

        res.json({ symbol, date, expiry, entryTime, lotSize, legs: legsWithEntry, series });
    } catch (err) {
        console.error("[simulator/replay]", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * GET /api/simulator/candles/:symbol?date=YYYY-MM-DD
 * Real 1-minute OHLC candles for the underlying on one historical trading
 * day, straight from ohlcv_data (same table the replay endpoint already
 * reads spot closes from) — powers the Simulator's NIFTY Chart tab. Never
 * touches Angel One; timeframe aggregation (5m/15m/1h) is done client-side
 * from these 1m bars rather than adding query variants for each interval.
 */
async function getCandles(req, res) {
    try {
        const symbol = resolveSymbol(req, res);
        if (!symbol) return;
        const { date } = req.query;
        if (!date) return res.status(400).json({ error: "date is required (see /api/simulator/dates/:symbol)" });

        const [rows] = await pool.query(
            `SELECT trade_time, open, high, low, close, volume FROM ohlcv_data
             WHERE symbol = ? AND trade_date = ? ORDER BY trade_time ASC`,
            [symbol, date]
        );
        if (!rows.length) {
            return res.status(404).json({ error: `No stored candle data for ${symbol} on ${date}` });
        }
        const candles = rows
            .filter((r) => r.open != null && r.high != null && r.low != null && r.close != null)
            .map((r) => ({
                time: r.trade_time,
                open: Number(r.open),
                high: Number(r.high),
                low: Number(r.low),
                close: Number(r.close),
                volume: r.volume != null ? Number(r.volume) : null,
            }));
        res.json({ symbol, date, candles });
    } catch (err) {
        console.error("[simulator/candles]", err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = { listDates, getChainAtTime, replay, getCandles };
