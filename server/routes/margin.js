// server/routes/margin.js — option margin from NSE Clearing's SPAN file (see services/spanMarginService.js).
//   POST /api/margin/calculate  { symbol, spot, legs: [{ expiry, strike, type, action, lots, lotSize }] }
//   GET  /api/margin/status
const express = require("express");
const spanMargin = require("../services/spanMarginService");

const router = express.Router();

router.post("/calculate", async (req, res) => {
    try {
        const { symbol, spot, legs } = req.body || {};
        if (!symbol || !Array.isArray(legs) || !legs.length) {
            return res.status(400).json({ error: "symbol and a non-empty legs array are required" });
        }
        if (legs.length > 20) return res.status(400).json({ error: "at most 20 legs" });
        res.json(await spanMargin.calculateMargin({ symbol, spot, legs }));
    } catch (err) {
        console.error("[margin] calculate failed:", err.message);
        res.status(503).json({ available: false, reason: err.message || "SPAN margin unavailable" });
    }
});

router.get("/status", (req, res) => res.json(spanMargin.status()));

module.exports = router;
