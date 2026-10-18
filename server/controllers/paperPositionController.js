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

async function placeOrder(req, res) {
    try {
        const {
            symbol, expiry, strike, optRight, opt_right, option_type, type,
            side, orderType, order_type, price, triggerPrice, trigger_price,
            lots, stopLossPrice, stop_loss_price, targetPrice, target_price,
            trailingSl, trailing_sl, strategyName,
        } = req.body;
        const right = optRight || opt_right || option_type || type;
        const oType = orderType || order_type || "LIMIT";
        const ordSide = side || "buy";
        const sl = stopLossPrice != null ? stopLossPrice : stop_loss_price;
        const tp = targetPrice != null ? targetPrice : target_price;
        const tsl = trailingSl != null ? trailingSl : trailing_sl;
        const trig = triggerPrice != null ? triggerPrice : trigger_price;

        if (!symbol || !expiry || strike == null || !right || lots == null) {
            return res.status(400).json({ error: "symbol, expiry, strike, optRight and lots are required" });
        }

        const order = await paperPositionService.placeOrder(req.user.sub, {
            symbol,
            expiry,
            strike,
            optRight: right,
            side: ordSide,
            orderType: oType,
            price,
            triggerPrice: trig,
            lots: Number(lots),
            stopLossPrice: sl,
            targetPrice: tp,
            trailingSl: tsl,
            strategyName,
        });
        res.status(201).json({ order });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[paperTrade:placeOrder]", err);
        res.status(status).json({ error: err.message || "failed to place order" });
    }
}

async function cancelOrder(req, res) {
    try {
        const order = await paperPositionService.cancelOrder(req.user.sub, req.params.id);
        res.json({ order, message: "Order cancelled successfully" });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[paperTrade:cancelOrder]", err);
        res.status(status).json({ error: err.message || "failed to cancel order" });
    }
}

async function listOrders(req, res) {
    try {
        const { status, limit } = req.query;
        const orders = await paperPositionService.listOrders(req.user.sub, { status, limit });
        res.json({ orders });
    } catch (err) {
        console.error("[paperTrade:listOrders]", err);
        res.status(500).json({ error: "failed to load orders" });
    }
}

async function updatePositionBracket(req, res) {
    try {
        const { stopLossPrice, stop_loss_price, targetPrice, target_price, trailingSl, trailing_sl } = req.body;
        const position = await paperPositionService.updatePositionBracket(req.user.sub, req.params.id, {
            stopLossPrice: stopLossPrice != null ? stopLossPrice : stop_loss_price,
            targetPrice: targetPrice != null ? targetPrice : target_price,
            trailingSl: trailingSl != null ? trailingSl : trailing_sl,
        });
        res.json({ position });
    } catch (err) {
        const status = err.status || 500;
        if (status === 500) console.error("[paperTrade:updatePositionBracket]", err);
        res.status(status).json({ error: err.message || "failed to update bracket" });
    }
}

async function getLeaderboard(req, res) {
    try {
        const userId = req.user?.sub || null;
        const data = await paperPositionService.getLeaderboard(userId);
        res.json(data);
    } catch (err) {
        console.error("[paperTrade:getLeaderboard]", err);
        res.status(500).json({ error: "failed to load leaderboard" });
    }
}

module.exports = {
    openPosition,
    openStrategy,
    closePosition,
    closeAllPositions,
    listPositions,
    placeOrder,
    cancelOrder,
    listOrders,
    updatePositionBracket,
    getLeaderboard,
};
