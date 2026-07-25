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

// Underlying (index/stock) OHLCV history — powers the Strategy Builder's
// "Underlying" chart tab. Reads ohlcv_data (MySQL) only; symbol is stored as
// plain uppercase text there (see services/cron.js), same convention as
// contract-history's symbol matching above.
router.get("/:symbol/underlying-history", async (req, res) => {
    try {
        const { symbol } = req.params;
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);

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
