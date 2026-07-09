import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOptionChain } from "../services/optionChainApi";

// Shared fetch logic for every page built on top of /api/option-chain
// (Option Chain, Max Pain, PCR, IV chart, Straddle chart). Guards against
// out-of-order responses — React StrictMode double-invokes effects in dev,
// and without this a slow, superseded request could overwrite a newer,
// already-rendered result.
export function useOptionChain(initialSymbol = "NIFTY") {
    const [symbol, setSymbol] = useState(initialSymbol);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const requestIdRef = useRef(0);

    const load = useCallback(async (sym, expiry) => {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        try {
            const d = await fetchOptionChain(sym, expiry);
            if (requestId !== requestIdRef.current) return; // superseded
            setData(d);
            setError(null);
        } catch (e) {
            if (requestId !== requestIdRef.current) return;
            setError(e.message);
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        load(symbol);
    }, [symbol, load]);

    return { symbol, setSymbol, data, loading, error, load };
}
