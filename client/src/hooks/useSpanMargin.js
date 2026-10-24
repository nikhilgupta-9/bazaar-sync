// client/src/hooks/useSpanMargin.js — exchange margin for a basket of NSE/BSE option legs,
// priced server-side from NSE Clearing's SPAN risk file (POST /api/margin/calculate,
// see server/services/spanMarginService.js).
//
// Returns the server result only while it still matches the current legs (null while a
// new quote is in flight, for crypto/empty baskets, or when SPAN can't price the legs), so
// callers fall back to their local estimate instead of showing a stale number.
import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";

/**
 * @param {string} symbol
 * @param {number} spot          only sent along; changes in spot alone don't re-quote
 * @param {Array<{expiry, strike, type, action, lots, lotSize}>} legs  [] disables the hook
 * @returns {{ margin, standaloneMargin, perLeg, file, ... } | null}
 */
export function useSpanMargin(symbol, spot, legs) {
    const [quote, setQuote] = useState(null);
    const reqRef = useRef(0);
    const spotRef = useRef(spot);
    useEffect(() => {
        spotRef.current = spot;
    }, [spot]);
    const key = useMemo(() => JSON.stringify([symbol, legs]), [symbol, legs]);

    useEffect(() => {
        if (!symbol || !legs?.length) return undefined;
        const id = ++reqRef.current;
        const timer = setTimeout(async () => {
            let result = { available: false };
            try {
                const res = await fetch(`${API_BASE}/api/margin/calculate`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ symbol, spot: spotRef.current, legs }),
                });
                result = await res.json();
            } catch {
                // network/backend down — caller keeps its local estimate
            }
            if (id === reqRef.current) setQuote({ key, result });
        }, 300);
        return () => clearTimeout(timer);
    }, [key, symbol, legs]);

    return quote?.key === key && quote.result?.available ? quote.result : null;
}

/** "NSE SPAN · 20261019.i3" label for a SPAN result, or the fallback label. */
export function spanSourceLabel(span, fallback = "Estimate") {
    return span ? `NSE SPAN · ${span.file?.replace(/^nsccl\./, "") || ""}` : fallback;
}
