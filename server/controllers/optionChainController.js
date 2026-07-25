// controllers/optionChainController.js
//
// Same public contract as always — GET /api/option-chain/:symbol
// (nifty/banknifty/finnifty, ?expiry= optional) — but live data now comes
// from the in-memory market cache fed by the Angel One worker (see
// services/marketCache.js), never from a broker call inside the request.

const optionChainService = require("../services/optionChainService");
const marketCache = require("../services/marketCache");
const instrumentMaster = require("../services/instrumentMaster");
const { marketHours } = require("../utils/marketUtils");

// Attaches data that's independent of whether the option ROWS came back live
// or historical: VIX, the nearest future's price, lot size (all read from
// the same in-memory cache the worker feeds), plus the full expiry list from
// the instrument master. The worker only ever live-subscribes the nearest
// expiry's option chain (see marketWorker.js's token-budget comment), so
// `expiries` here can list more dates than are actually live right now —
// selecting a non-live one falls back to historical data automatically
// (optionChainService.getOptionChain already does this).
async function withMarketExtras(payload, displaySymbol) {
    const cacheStatus = marketCache.getStatus();
    const vixEntry = marketCache.getVix();
    const futureEntry = marketCache.getFuture(displaySymbol);

    let expiries = payload.expiries;
    try {
        const allExpiries = await instrumentMaster.getExpiries(displaySymbol);
        if (allExpiries.length) expiries = allExpiries;
    } catch (err) {
        console.error("[optionChain] expiry list lookup failed, using payload's own list:", err.message);
    }

    return {
        ...payload,
        expiries,
        vix: vixEntry ? vixEntry.ltp : null,
        futurePrice: futureEntry ? futureEntry.ltp : null,
        futureExpiry: futureEntry ? futureEntry.expiry : null,
        lotSize: marketCache.getLotSize(displaySymbol),
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
        res.json(await withMarketExtras(payload, payload.symbol));
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
