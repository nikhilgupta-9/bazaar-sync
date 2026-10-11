// server/routes/cryptoRoutes.js — Real-Time Delta Exchange Crypto Options & Strategy Builder API
const express = require("express");
const router = express.Router();
const deltaService = require("../services/deltaExchangeService");

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
