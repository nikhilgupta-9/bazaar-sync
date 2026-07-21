// controllers/optionChainController.js
//
// Same public contract as always — GET /api/option-chain/:symbol
// (nifty/banknifty/finnifty, ?expiry= optional) — but live data now comes
// from the in-memory market cache fed by the Angel One worker (see
// services/marketCache.js), never from a broker call inside the request.

const optionChainService = require("../services/optionChainService");
const marketCache = require("../services/marketCache");
const { marketHours } = require("../utils/marketUtils");

function withMarketStatus(payload) {
    const cacheStatus = marketCache.getStatus();
    return {
        ...payload,
        marketStatus: {
            isOpen: marketHours.isTradingTime(),
            nextOpen: marketHours.getNextMarketOpen(),
            feedConnected: cacheStatus.feedConnected,
            liveDataFresh: cacheStatus.fresh,
            timestamp: new Date().toISOString(),
        },
    };
}

/** GET /api/option-chain/symbols/list — every symbol with real data, for the Select Asset dropdown. */
async function listSymbols(req, res) {
    try {
        const result = await optionChainService.listSymbols();
        res.json(result);
    } catch (err) {
        console.error("[ListSymbols Error]", err);
        res.status(500).json({ error: err.message || "Failed to list symbols" });
    }
}

async function getOptionChain(req, res) {
    try {
        const { symbol } = req.params;
        const { expiry, forceLive = false } = req.query;

        const payload = await optionChainService.getOptionChain(symbol, expiry, forceLive === "true");
        res.json(withMarketStatus(payload));
    } catch (err) {
        console.error("[OptionChain Error]", err);
        res.status(err.status || 500).json({
            error: err.message || "Failed to fetch option chain",
            timestamp: new Date().toISOString(),
        });
    }
}

/**
 * POST /api/option-chain/refresh — kept for the frontend's manual refresh
 * button. With the worker architecture there is nothing to "re-fetch" from a
 * broker (the cache is already the freshest data we have), so this simply
 * returns the current best payload, forcing the live path when possible.
 */
async function refreshOptionChain(req, res) {
    try {
        const { symbol, expiry } = req.body || {};
        if (!symbol) {
            return res.status(400).json({ error: "Symbol is required" });
        }
        const payload = await optionChainService.getOptionChain(symbol, expiry, true);
        res.json({
            success: true,
            live: !payload.isHistorical,
            message: payload.isHistorical
                ? "Live cache unavailable (market closed or worker down) — served latest historical snapshot"
                : "Live data served from market cache",
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error("[Refresh Error]", err);
        res.status(500).json({
            error: err.message || "Failed to refresh option chain",
            timestamp: new Date().toISOString(),
        });
    }
}

module.exports = { getOptionChain, refreshOptionChain, listSymbols };
