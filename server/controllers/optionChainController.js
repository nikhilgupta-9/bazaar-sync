// controllers/optionChainController.js
//
// Same public contract as always — GET /api/option-chain/:symbol
// (nifty/banknifty/finnifty, ?expiry= optional) — but live data now comes
// from the in-memory market cache fed by the Angel One worker (see
// services/marketCache.js), never from a broker call inside the request.

const optionChainService = require("../services/optionChainService");
const marketCache = require("../services/marketCache");
const instrumentMaster = require("../services/instrumentMaster");
const lotSizeHistoryService = require("../services/lotSizeHistoryService");
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

    // Only widen the expiry list from the live instrument master for a LIVE
    // payload. For a historical payload (market closed / non-live expiry),
    // payload.expiries is the set of expiries that actually have stored rows
    // for that snapshot's trade_date — replacing it with the instrument
    // master's future-dated list produced a dropdown of expiries that don't
    // match `selectedExpiry` and silently fall back to the same day's data
    // when clicked (found 2026-09-10). Keep the payload's own list there.
    let expiries = payload.expiries;
    if (!payload.isHistorical) {
        try {
            const allExpiries = await instrumentMaster.getExpiries(displaySymbol);
            if (allExpiries.length) expiries = allExpiries;
        } catch (err) {
            console.error("[optionChain] expiry list lookup failed, using payload's own list:", err.message);
        }
    }

    // lot_size_history (see lotSizeHistoryService.js) is the admin-curated,
    // authoritative source — it's what NSE's actual lot-revision circulars
    // get entered against, and it's the only source that covers symbols the
    // Angel One NFO-only scrip master never lists at all (BSE indices like
    // SENSEX/BANKEX, individual F&O stocks). It already falls back to
    // instrumentMaster.getLotSize internally when nothing's recorded for
    // this symbol/date, so this alone is normally enough — Strategy
    // Builder's Est. Margin/P&L math (payoff.js's legMultiplier) was
    // previously only ever fed the live cache/scrip-master value, which
    // could silently disagree with (or simply not know) the real current
    // lot size for anything outside the 3 live-subscribed indices.
    let lotSize = null;
    try {
        lotSize = await lotSizeHistoryService.getLotSizeAsOf(displaySymbol, instrumentMaster.todayIst());
    } catch (err) {
        console.error("[optionChain] lot size history lookup failed:", err.message);
    }
    // Last-resort fallback if the DB itself is unreachable: whatever the
    // live worker already has ticking in memory for this symbol right now.
    if (!lotSize) lotSize = marketCache.getLotSize(displaySymbol);

    // Spot vs the last recorded end-of-day close (ohlcv_data, previous
    // trading day) — the header's "Spot" figure shows this delta next to
    // the price. Null (not a fabricated 0%) when there's no prior day's
    // candle yet, e.g. a brand-new symbol's first day of data.
    const prevClose = await optionChainService.getPreviousDayClose(displaySymbol, instrumentMaster.todayIst());
    const spotChange = prevClose != null && payload.spotPrice ? Number((payload.spotPrice - prevClose).toFixed(2)) : null;
    const spotChangePercent = optionChainService.pctChange(payload.spotPrice, prevClose);

    return {
        ...payload,
        expiries,
        vix: vixEntry ? vixEntry.ltp : null,
        futurePrice: futureEntry ? futureEntry.ltp : null,
        futureExpiry: futureEntry ? futureEntry.expiry : null,
        lotSize,
        spotPrevClose: prevClose,
        spotChange,
        spotChangePercent,
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
