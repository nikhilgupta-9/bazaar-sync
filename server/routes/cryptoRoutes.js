// server/routes/cryptoRoutes.js — Real-Time Delta Exchange Crypto Options & Strategy Builder API
const express = require("express");
const router = express.Router();
const deltaService = require("../services/deltaExchangeService");
const cryptoHistory = require("../services/cryptoHistoricalService");

/**
 * Historical (backtest) endpoints — real Delta Exchange 1-min history, no live data.
 * GET /api/crypto/history/meta
 * GET /api/crypto/history/chain?underlying=BTC&date=2026-09-25&time=09:15&expiry=2026-09-25T12:00:00.000Z
 * GET /api/crypto/history/spot?underlying=BTC&date=2026-09-25
 */
router.get("/history/meta", (req, res) => {
    res.json(cryptoHistory.meta());
});

router.get("/history/chain", async (req, res) => {
    try {
        const { underlying, date, time, expiry } = req.query;
        res.json(await cryptoHistory.getHistoricalChain({ underlying, date, time, expiry }));
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[CryptoRoutes] History Chain Error:", err);
        res.status(status).json({ error: err.message || "Failed to load historical crypto option chain" });
    }
});

router.get("/history/spot", async (req, res) => {
    try {
        const { underlying, date } = req.query;
        res.json(await cryptoHistory.getHistoricalSpotSeries({ underlying, date }));
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[CryptoRoutes] History Spot Error:", err);
        res.status(status).json({ error: err.message || "Failed to load historical spot series" });
    }
});

/**
 * GET /api/crypto/option-chain
 * Query: ?underlying=BTC&expiry=2026-10-11T12:00:00Z
 */
router.get("/option-chain", async (req, res) => {
    try {
        const underlying = req.query.underlying || req.query.symbol || "BTC";
        const expiry = req.query.expiry || null;
        const chain = await deltaService.getCryptoOptionChain(underlying, expiry);
        res.json(chain);
    } catch (err) {
        console.error("[CryptoRoutes] Option Chain Error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch live crypto option chain" });
    }
});

/**
 * GET /api/crypto/tickers
 */
router.get("/tickers", async (req, res) => {
    try {
        const tickers = await deltaService.getAllTickers();
        res.json({ result: tickers });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/crypto/products
 */
router.get("/products", async (req, res) => {
    try {
        const products = await deltaService.getAllProducts();
        res.json({ result: products });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
