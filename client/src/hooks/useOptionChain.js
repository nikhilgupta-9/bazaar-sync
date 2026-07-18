// hooks/useOptionChain.js
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOptionChain, refreshOptionChain } from "../services/optionChainApi";
import { subscribeLiveTicks } from "../services/liveSocket";

// Polling fallback intervals (only used when the live socket has nothing to
// say — market closed, worker down, or historical data being shown; that
// historical mode is legitimate, not a bug).
const POLLING_INTERVALS = {
    MARKET_CLOSED: 300000, // 5 minutes
    EXTENDED_HOURS: 60000, // 1 minute
    LIVE_FALLBACK: 15000, // market open but no socket frames arriving
};
const LIVE_FRAME_STALE_MS = 20000;

/**
 * Shared fetch + live-update logic for every page built on top of
 * /api/option-chain (Option Chain, Max Pain, PCR, IV chart, Straddle chart,
 * OI Heatmap, Strategy Builder).
 *
 * Flow:
 *   1. REST fetch gives the full payload (rows, ATM, max pain, PCR, greeks).
 *   2. While the market is open, socket.io "latestTicks" frames (broadcast
 *      from the backend's in-memory market cache ~1/s) are merged into the
 *      loaded rows — LTP/OI/volume/spot move live without re-fetching.
 *   3. When the market is closed or no frames arrive, a slow REST poll keeps
 *      the page from going permanently stale.
 *
 * Keeps the request-id race guard: React StrictMode double-invokes effects
 * in dev, and a slow superseded request must not overwrite a newer result.
 */
export function useOptionChain(initialSymbol = "NIFTY") {
    const [symbol, setSymbol] = useState(initialSymbol);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [marketStatus, setMarketStatus] = useState({ isOpen: false, nextOpen: null, timestamp: null });
    const [isLive, setIsLive] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    const requestIdRef = useRef(0);
    const expiryRef = useRef(null);
    const lastFrameAtRef = useRef(0);
    const pollingRef = useRef(null);

    const load = useCallback(async (sym, expiry, forceLive = false) => {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        try {
            const d = await fetchOptionChain(sym, expiry, forceLive);
            if (requestId !== requestIdRef.current) return; // superseded

            expiryRef.current = expiry ?? d.selectedExpiry ?? null;
            setData(d);
            setMarketStatus(d.marketStatus || { isOpen: false });
            setIsLive(!d.isHistorical);
            setLastUpdated(new Date().toISOString());
            setError(null);
        } catch (e) {
            if (requestId !== requestIdRef.current) return;
            setError(e.message);
            setData(null);
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, []);

    // --- socket.io live merge -------------------------------------------
    useEffect(() => {
        const unsubscribe = subscribeLiveTicks(
            symbol,
            (frame) => {
                lastFrameAtRef.current = Date.now();
                setIsLive(true);
                setLastUpdated(new Date().toISOString());
                setData((prev) => {
                    if (!prev || !prev.rows || prev.rows.length === 0) return prev;
                    // Frames carry the nearest expiry only — don't smear live
                    // ticks over a different expiry's historical rows.
                    if (frame.expiry && prev.selectedExpiry && String(frame.expiry) !== String(prev.selectedExpiry)) {
                        return prev;
                    }
                    const byStrike = new Map(frame.ticks.map((t) => [Number(t.strike), t]));
                    const rows = prev.rows.map((row) => {
                        const t = byStrike.get(Number(row.strike));
                        if (!t) return row;
                        return {
                            ...row,
                            ce: {
                                ...row.ce,
                                ltp: t.ceLtp ?? row.ce.ltp,
                                oi: t.ceOi ?? row.ce.oi,
                                volume: t.ceVolume ?? row.ce.volume,
                            },
                            pe: {
                                ...row.pe,
                                ltp: t.peLtp ?? row.pe.ltp,
                                oi: t.peOi ?? row.pe.oi,
                                volume: t.peVolume ?? row.pe.volume,
                            },
                        };
                    });
                    return {
                        ...prev,
                        rows,
                        spotPrice: frame.spot ?? prev.spotPrice,
                        isHistorical: false,
                        timestamp: new Date().toISOString(),
                    };
                });
            },
            (status) => {
                setMarketStatus((prev) => ({ ...prev, isOpen: status.marketOpen, feedConnected: status.feedConnected }));
            }
        );
        return unsubscribe;
    }, [symbol]);

    // --- polling fallback ------------------------------------------------
    useEffect(() => {
        if (pollingRef.current) clearInterval(pollingRef.current);

        const interval = marketStatus.isOpen ? POLLING_INTERVALS.LIVE_FALLBACK : POLLING_INTERVALS.MARKET_CLOSED;

        pollingRef.current = setInterval(() => {
            const framesFresh = Date.now() - lastFrameAtRef.current < LIVE_FRAME_STALE_MS;
            if (framesFresh) return; // socket is doing the job — no REST churn
            if (marketStatus.isOpen) setIsLive(false);
            load(symbol, expiryRef.current);
        }, interval);

        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, [symbol, marketStatus.isOpen, load]);

    // --- public API (kept compatible with all existing pages) ------------
    const refresh = useCallback(async () => {
        try {
            await refreshOptionChain(symbol);
            await load(symbol, expiryRef.current, true);
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        }
    }, [symbol, load]);

    const changeExpiry = useCallback(
        (sym, expiry) => {
            // Existing pages call this as load(symbol, expiry)
            load(sym ?? symbol, expiry);
        },
        [symbol, load]
    );

    const changeSymbol = useCallback(
        (newSymbol) => {
            if (newSymbol !== symbol) {
                setSymbol(newSymbol);
                expiryRef.current = null;
                load(newSymbol);
            }
        },
        [symbol, load]
    );

    const disconnect = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
    }, []);

    // Initial load
    useEffect(() => {
        load(initialSymbol);
    }, [initialSymbol, load]);

    return {
        symbol,
        setSymbol: changeSymbol,
        data,
        loading,
        error,
        load: changeExpiry,
        marketStatus,
        isLive,
        lastUpdated,
        refresh,
        disconnect,
    };
}
