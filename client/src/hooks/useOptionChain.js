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

// A single contract (one strike's CE or PE) is flagged stale — amber ⚠, last
// value carried forward — when its own last tick is older than this while the
// feed is otherwise live. Illiquid strikes and strikes that drifted outside
// the worker's ±15-strike window stop ticking well before the whole feed does.
const CONTRACT_STALE_MS = 25000;
// Greeks/IV/delta never stream over the socket (only LTP/OI/volume do) — they
// only refresh on a REST load. Flag them stale when the last REST load is
// older than this during market hours.
const GREEKS_STALE_MS = 90000;

// Coerce a server timestamp (ms-epoch number, or ISO string) to ms, or null.
function toMs(ts) {
    if (ts == null) return null;
    if (typeof ts === "number") return Number.isFinite(ts) && ts > 0 ? ts : null;
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? null : parsed;
}

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
    // ms epoch of the last REST payload (greeks/IV/delta only refresh then),
    // and a value bumped every few seconds so consumers re-evaluate "how old
    // is each contract now" without needing a data change.
    const [dataLoadedAt, setDataLoadedAt] = useState(0);
    const [staleNow, setStaleNow] = useState(() => Date.now());

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
            // Stamp each contract's last-tick time from the server's per-side
            // `ts` (live path) — falls back to now, so a fresh historical/
            // market-closed load never looks stale. Consumed by ChainRow to
            // decide which cells get the amber ⚠ + carried-forward treatment.
            const nowMs = Date.now();
            if (Array.isArray(d.rows)) {
                d.rows = d.rows.map((row) => ({
                    ...row,
                    ce: { ...row.ce, _tickAt: toMs(row.ce?.ts) ?? nowMs },
                    pe: { ...row.pe, _tickAt: toMs(row.pe?.ts) ?? nowMs },
                }));
            }
            setData(d);
            setDataLoadedAt(nowMs);
            setStaleNow(nowMs);
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
                    const frameMs = toMs(frame.timestamp) ?? Date.now();
                    const byStrike = new Map(frame.ticks.map((t) => [Number(t.strike), t]));
                    const rows = prev.rows.map((row) => {
                        const t = byStrike.get(Number(row.strike));
                        if (!t) return row; // strike absent from the frame — keep its old _tickAt so it ages into "stale"
                        // A side's _tickAt only advances when that side actually
                        // carried a value this frame (t.ceLtp/t.ceOi present) —
                        // a frame that lists the strike but with null CE data
                        // means that contract still isn't ticking.
                        const ceTicked = t.ceLtp != null || t.ceOi != null;
                        const peTicked = t.peLtp != null || t.peOi != null;
                        return {
                            ...row,
                            ce: {
                                ...row.ce,
                                ltp: t.ceLtp ?? row.ce.ltp,
                                oi: t.ceOi ?? row.ce.oi,
                                volume: t.ceVolume ?? row.ce.volume,
                                _tickAt: toMs(t.ceTs) ?? (ceTicked ? frameMs : row.ce._tickAt),
                            },
                            pe: {
                                ...row.pe,
                                ltp: t.peLtp ?? row.pe.ltp,
                                oi: t.peOi ?? row.pe.oi,
                                volume: t.peVolume ?? row.pe.volume,
                                _tickAt: toMs(t.peTs) ?? (peTicked ? frameMs : row.pe._tickAt),
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

    // --- staleness re-tick ---------------------------------------------
    // Bumps `staleNow` every 5s so ChainRow re-evaluates "how old is each
    // contract" as wall-clock time passes, without needing a data change.
    // Only runs while the market is open and we're on the live path — a
    // static historical snapshot is never "aging".
    useEffect(() => {
        if (!marketStatus.isOpen || !isLive) return;
        const id = setInterval(() => setStaleNow(Date.now()), 5000);
        return () => clearInterval(id);
    }, [marketStatus.isOpen, isLive]);

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
        dataLoadedAt,
        staleNow,
        refresh,
        disconnect,
    };
}

/**
 * Given one contract side (row.ce / row.pe), decide whether its live data
 * has gone stale. `opts` comes straight from the hook: { isLive, marketOpen,
 * feedConnected, dataLoadedAt, now }. Returns per-group booleans so ChainRow
 * can badge LTP/OI separately from delta/greeks (which never stream).
 */
export function contractStaleness(side, opts) {
    const { isLive, marketOpen, feedConnected, dataLoadedAt, now } = opts || {};
    // Only meaningful on the live path during market hours with the feed up —
    // a historical snapshot or a closed market is "as fresh as it gets".
    if (!side || !isLive || !marketOpen || feedConnected === false) {
        return { priceStale: false, greeksStale: false };
    }
    const tickAt = side._tickAt || dataLoadedAt || 0;
    return {
        priceStale: tickAt > 0 && now - tickAt > CONTRACT_STALE_MS,
        greeksStale: dataLoadedAt > 0 && now - dataLoadedAt > GREEKS_STALE_MS,
    };
}
