const paperPositionService = require("../services/paperPositionService");

async function openPosition(req, res) {
    try {
        const { symbol, expiry, strike, optRight, opt_right, option_type, type, lots, side, strategyName } = req.body;
        const right = optRight || opt_right || option_type || type;
        if (!symbol || !expiry || strike == null || !right || lots == null) {
            return res.status(400).json({ error: "symbol, expiry, strike, optRight and lots are required" });
        }
        const position = await paperPositionService.openPosition(req.user.sub, {
            symbol,
            expiry,
            strike,
            optRight: right,
            lots: Number(lots),
            side: side || "long",
            strategyName,
        });
        res.status(201).json({ position });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[paperTrade:openPosition]", err);
        res.status(status).json({ error: err.message || "failed to open position" });
    }
}

async function openStrategy(req, res) {
    try {
        const { symbol, expiry, legs, strategyName } = req.body;
        if (!symbol || !expiry || !Array.isArray(legs) || legs.length === 0) {
            return res.status(400).json({ error: "symbol, expiry, and legs array are required" });
        }
        const positions = await paperPositionService.openStrategyPositions(req.user.sub, {
            symbol,
            expiry,
            legs,
            strategyName: strategyName || "Multi-Leg Strategy",
        });
        res.status(201).json({ positions, count: positions.length });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[paperTrade:openStrategy]", err);
        res.status(status).json({ error: err.message || "failed to execute strategy" });
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

async function closeAllPositions(req, res) {
    try {
        const symbol = req.body.symbol || req.query.symbol || null;
        const closed = await paperPositionService.closeAllPositions(req.user.sub, symbol);
        res.json({ closed, count: closed.length });
    } catch (err) {
        console.error("[paperTrade:closeAllPositions]", err);
        res.status(500).json({ error: err.message || "failed to close all positions" });
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

module.exports = { openPosition, openStrategy, closePosition, closeAllPositions, listPositions };
