// hooks/useCryptoOptionChain.js
// Polls the Delta Exchange option chain for one coin. Returns the same surface
// the Option Chain page reads from useOptionChain (data/loading/error/isLive/
// lastUpdated/load/refresh) so one view renders either market.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCryptoOptionChain } from "../services/cryptoOptionChainApi";

const POLL_MS = 5000;

export function useCryptoOptionChain(coin) {
    const [expiry, setExpiry] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const requestIdRef = useRef(0);

    // request-id guard: a slow response for an old coin/expiry never overwrites a newer one
    const fetchNow = useCallback(async () => {
        const id = ++requestIdRef.current;
        try {
            const next = await fetchCryptoOptionChain(coin, expiry);
            if (id !== requestIdRef.current) return;
            setData(next);
            setError(null);
            setLastUpdated(new Date().toISOString());
        } catch (err) {
            if (id !== requestIdRef.current) return;
            setError(err.message || "Failed to load crypto option chain");
        } finally {
            if (id === requestIdRef.current) setLoading(false);
        }
    }, [coin, expiry]);

    useEffect(() => {
        const first = setTimeout(fetchNow, 0);
        const timer = setInterval(fetchNow, POLL_MS);
        return () => {
            clearTimeout(first);
            clearInterval(timer);
        };
    }, [fetchNow]);

    const load = useCallback((_symbol, exp) => {
        setLoading(true);
        setExpiry(exp || null);
    }, []);

    const refresh = useCallback(() => {
        setLoading(true);
        fetchNow();
    }, [fetchNow]);

    return {
        symbol: coin,
        data,
        loading,
        error,
        isLive: !!data && !error,
        lastUpdated,
        load,
        refresh,
    };
}
