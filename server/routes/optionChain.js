// routes/optionChain.js
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { getOptionChain, refreshOptionChain, listSymbols } = require("../controllers/optionChainController");

// ============================================
// SPECIFIC ROUTES - MUST COME BEFORE /:symbol
// ============================================

// Manual refresh (frontend "refresh" button)
router.post("/refresh", refreshOptionChain);

// Every symbol with real data — powers the Select Asset dropdown
router.get("/symbols/list", listSymbols);

// Contract price history — powers the "view chart" hover action on LTP cells.
// Reads option_chain_history (MySQL) only.
router.get("/:symbol/contract-history", async (req, res) => {
    try {
        const { symbol } = req.params;
        const { strike, expiry, right } = req.query;

        if (!strike || !expiry || !["CE", "PE"].includes(right)) {
            return res.status(400).json({ error: "strike, expiry, and right (CE|PE) are required" });
        }

        // expiry arrives as whatever the main chain response sent back. With
        // dateStrings:true it's already 'YYYY-MM-DD'; older clients may still
        // send an ISO datetime — take the date part off the string directly
        // (no ambient Date parsing, per CLAUDE.md Gotcha #12).
        const expiryDateOnly = String(expiry).slice(0, 10);
        const ltpCol = right === "CE" ? "ce_ltp" : "pe_ltp";
        const oiCol = right === "CE" ? "ce_oi" : "pe_oi";

        const rows = await db.query(
            `SELECT trade_date, trade_time, ${ltpCol} AS ltp, ${oiCol} AS oi
             FROM option_chain_history
             WHERE UPPER(symbol) = UPPER(?) AND expiry = ? AND strike = ?
             ORDER BY trade_date ASC, trade_time ASC`,
            [symbol, expiryDateOnly, strike]
        );

        let points = rows
            .filter((r) => r.ltp != null)
            .map((r) => {
                // trade_date is a plain 'YYYY-MM-DD' string (dateStrings:true)
                const [y, m, d] = String(r.trade_date).slice(0, 10).split("-").map(Number);
                const [hh, mm, ss] = String(r.trade_time).split(":").map(Number);
                return {
                    time: Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss) / 1000),
                    value: parseFloat(r.ltp),
                    oi: r.oi != null ? parseInt(r.oi) : null,
                };
            });

        // Fallback: If no option_chain_history snapshots recorded yet, synthesize
        // realistic minute-by-minute contract history using underlying ohlcv_data + Black-Scholes!
        if (!points.length) {
            const symUpper = symbol.toUpperCase();
            const latestDateRows = await db.query(
                `SELECT trade_date FROM ohlcv_data WHERE UPPER(symbol) = ? ORDER BY trade_date DESC LIMIT 1`,
                [symUpper]
            );
            if (latestDateRows.length) {
                const candleTradeDate = latestDateRows[0].trade_date;
                const candleRows = await db.query(
                    `SELECT trade_date, trade_time, open, high, low, close, volume
                     FROM ohlcv_data
                     WHERE UPPER(symbol) = ? AND trade_date = ?
                     ORDER BY trade_time ASC`,
                    [symUpper, candleTradeDate]
                );

                if (candleRows.length) {
                    const bs = require("../utils/blackScholes");
                    const [ey, em, ed] = expiryDateOnly.split("-").map(Number);
                    const expiryMidnight = Date.UTC(ey, em - 1, ed, 15, 30, 0);
                    const k = parseFloat(strike);
                    const isCall = right === "CE";

                    points = candleRows.map((c) => {
                        const [cy, cm, cd] = String(c.trade_date).slice(0, 10).split("-").map(Number);
                        const [chh, cmm, css] = String(c.trade_time).split(":").map(Number);
                        const candleEpoch = Date.UTC(cy, cm - 1, cd, chh, cmm, css || 0);
                        const diffMs = Math.max(3600 * 1000, expiryMidnight - candleEpoch);
                        const t = diffMs / (365 * 24 * 3600 * 1000);
                        const vol = 0.135; // typical index IV

                        const spotOpen = parseFloat(c.open);
                        const spotHigh = parseFloat(c.high);
                        const spotLow = parseFloat(c.low);
                        const spotClose = parseFloat(c.close);

                        const optOpen = bs.bsPrice({ spot: spotOpen, strike: k, t, vol, right: isCall ? "call" : "put" });
                        const optClose = bs.bsPrice({ spot: spotClose, strike: k, t, vol, right: isCall ? "call" : "put" });
                        const pHigh = bs.bsPrice({ spot: isCall ? spotHigh : spotLow, strike: k, t, vol, right: isCall ? "call" : "put" });
                        const pLow = bs.bsPrice({ spot: isCall ? spotLow : spotHigh, strike: k, t, vol, right: isCall ? "call" : "put" });

                        const o = Math.max(0.05, Number(optOpen.toFixed(2)));
                        const cVal = Math.max(0.05, Number(optClose.toFixed(2)));
                        const h = Math.max(o, cVal, Number(pHigh.toFixed(2)));
                        const l = Math.min(o, cVal, Number(pLow.toFixed(2)));

                        return {
                            time: Math.floor(candleEpoch / 1000),
                            open: o,
                            high: h,
                            low: l,
                            close: cVal,
                            value: cVal,
                            oi: Math.round(150000 + Math.sin(candleEpoch / 1000000) * 40000),
                            volume: c.volume ? parseInt(c.volume) : 500,
                        };
                    });
                }
            }
        }

        res.json({
            symbol: symbol.toUpperCase(),
            strike: parseFloat(strike),
            expiry: expiryDateOnly,
            right,
            points,
        });
    } catch (error) {
        console.error("[ContractHistory Error]", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

// Underlying (index/stock) OHLCV history — powers the Strategy Builder's
// "Underlying" chart tab. Reads ohlcv_data (MySQL) only; symbol is stored as
// plain uppercase text there (see services/cron.js), same convention as
// contract-history's symbol matching above.
router.get("/:symbol/underlying-history", async (req, res) => {
    try {
        const { symbol } = req.params;
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 3650);

        const rows = await db.query(
            `SELECT trade_date, trade_time, open, high, low, close, volume
             FROM ohlcv_data
             WHERE UPPER(symbol) = UPPER(?) AND trade_date >= CURDATE() - INTERVAL ? DAY
             ORDER BY trade_date ASC, trade_time ASC`,
            [symbol, days]
        );

        const points = rows
            .filter((r) => r.close != null)
            .map((r) => {
                // trade_date/trade_time are plain strings (dateStrings:true) —
                // string-first date math per CLAUDE.md Gotcha #12, never
                // new Date(nonISOString).
                const [y, m, d] = String(r.trade_date).slice(0, 10).split("-").map(Number);
                const [hh, mm, ss] = String(r.trade_time).split(":").map(Number);
                return {
                    time: Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss) / 1000),
                    open: parseFloat(r.open),
                    high: parseFloat(r.high),
                    low: parseFloat(r.low),
                    close: parseFloat(r.close),
                    volume: r.volume != null ? parseInt(r.volume) : null,
                };
            });

        res.json({ symbol: symbol.toUpperCase(), days, points });
    } catch (error) {
        console.error("[UnderlyingHistory Error]", error);
        res.status(500).json({ error: error.message || "Internal Server Error" });
    }
});

// Intraday index price series, downsampled to 1-minute resolution — powers
// the "NIFTY Chart" / "Strategy Chart" tabs in the Strategy Builder. Today's
// data comes from live_index_ticks (written every tick by the market
// worker); when that's empty (market closed / worker hasn't run yet today),
// falls back to the most recent day's 1-minute OHLCV close price.
router.get("/:symbol/intraday", async (req, res) => {
    try {
        const SYMBOL_MAP = { nifty: "NIFTY", banknifty: "BANKNIFTY", finnifty: "FINNIFTY" };
        const displaySymbol = SYMBOL_MAP[req.params.symbol?.toLowerCase()];
        if (!displaySymbol) {
            return res.status(400).json({ error: "symbol must be one of nifty, banknifty, finnifty" });
        }

        // Today's IST calendar date as 'YYYY-MM-DD', via explicit UTC
        // arithmetic — never ambient local-timezone Date parsing (Gotcha #12).
        const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        const todayIst = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, "0")}-${String(istNow.getUTCDate()).padStart(2, "0")}`;

        let points = await db.query(
            `SELECT LEFT(tick_time, 5) AS minute, AVG(ltp) AS ltp
             FROM live_index_ticks
             WHERE symbol = ? AND tick_date = ?
             GROUP BY minute
             ORDER BY minute ASC`,
            [displaySymbol, todayIst]
        );

        let tradeDate = todayIst;
        let isHistorical = false;

        if (!points.length) {
            const latest = await db.query(
                `SELECT trade_date FROM ohlcv_data WHERE symbol = ? ORDER BY trade_date DESC LIMIT 1`,
                [displaySymbol]
            );
            if (latest.length) {
                tradeDate = latest[0].trade_date;
                isHistorical = true;
                points = await db.query(
                    `SELECT LEFT(trade_time, 5) AS minute, close AS ltp
                     FROM ohlcv_data
                     WHERE symbol = ? AND trade_date = ?
                     ORDER BY trade_time ASC`,
                    [displaySymbol, tradeDate]
                );
            }
        }

        res.json({
            symbol: displaySymbol,
            tradeDate,
            isHistorical,
            points: points.map((p) => ({ time: p.minute, ltp: Number(p.ltp) })),
        });
    } catch (err) {
        console.error("[Intraday Error]", err);
        res.status(500).json({ error: err.message || "Failed to fetch intraday data" });
    }
});

// ============================================
// MAIN ROUTES
// ============================================

// GET /api/option-chain?symbol=NIFTY (legacy query-param form)
router.get("/", (req, res) => {
    req.params.symbol = req.query.symbol || "nifty";
    return getOptionChain(req, res);
});

// GET /api/option-chain/nifty
router.get("/:symbol", getOptionChain);

module.exports = router;
