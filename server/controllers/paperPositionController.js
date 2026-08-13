const paperPositionService = require("../services/paperPositionService");

async function openPosition(req, res) {
    try {
        const { symbol, expiry, strike, optRight, lots, side } = req.body;
        if (!symbol || !expiry || strike == null || !optRight || lots == null) {
            return res.status(400).json({ error: "symbol, expiry, strike, optRight and lots are required" });
        }
        const position = await paperPositionService.openPosition(req.user.sub, {
            symbol, expiry, strike, optRight, lots: Number(lots), side: side || "long",
        });
        res.status(201).json({ position });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[paperTrade:openPosition]", err);
        res.status(status).json({ error: err.message || "failed to open position" });
    }
}

async function closePosition(req, res) {
    try {
        const position = await paperPositionService.closePosition(req.user.sub, req.params.id);
        res.json({ position });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[paperTrade:closePosition]", err);
        res.status(status).json({ error: err.message || "failed to close position" });
    }
}

async function listPositions(req, res) {
    try {
        const positions = req.query.status === "closed"
            ? await paperPositionService.listClosedPositions(req.user.sub)
            : await paperPositionService.listOpenPositions(req.user.sub);
        res.json({ positions });
    } catch (err) {
        console.error("[paperTrade:listPositions]", err);
        res.status(500).json({ error: "failed to load positions" });
    }
}

module.exports = { openPosition, closePosition, listPositions };
