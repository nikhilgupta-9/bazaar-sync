// routes/optionChain.js
const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { getOptionChain, refreshOptionChain } = require("../controllers/optionChainController");

// ============================================
// SPECIFIC ROUTES - MUST COME BEFORE /:symbol
// ============================================

// Manual refresh (frontend "refresh" button)
router.post("/refresh", refreshOptionChain);

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

        const points = rows
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
