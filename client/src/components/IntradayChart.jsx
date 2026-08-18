// components/IntradayChart.jsx
//
// Powers the "NIFTY Chart" / "Strategy Chart" / "Combined" tabs in the
// Strategy Builder. Reuses the same lightweight-charts pattern as
// ContractChartModal.jsx for consistency. Seeded from GET
// /api/option-chain/:symbol/intraday (1-minute resolution, from
// live_index_ticks), then live-appended from the same socket.io feed every
// other page already uses (services/liveSocket.js) — no new live-data path.
import { useEffect, useRef, useState } from "react";
import { createChart, AreaSeries } from "lightweight-charts";
import { fetchIntraday } from "../services/optionChainApi";
import { subscribeLiveTicks } from "../services/liveSocket";
import { bsPrice, yearsToExpiry } from "../utils/blackScholes";
import { legMultiplier } from "../utils/payoff";

/** IST wall-clock date+"HH:MM" -> epoch seconds, treating the wall-clock
 * numbers as the timestamp lightweight-charts should display (same trick
 * ContractChartModal's contract-history data already relies on). */
function toEpochSeconds(dateStr, timeHHMM) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000);
}

// Approximates the strategy's P&L at a given spot price by repricing every
// leg via Black-Scholes using its ENTRY IV as a stand-in for "IV at that
// moment in the day" (we don't persist intraday IV history) and a single
// time-to-expiry for the whole session (intraday drift is negligible) — the
// same kind of explicitly-labelled approximation as payoff.js's
// addMarkToMarketCurve, just replayed across a time axis instead of a price axis.
function strategyPnlAt(spot, legs, t) {
    let pnl = 0;
    for (const leg of legs) {
        const vol = (leg.iv || 0) / 100;
        const value = vol > 0
            ? bsPrice({ spot, strike: leg.strike, t, vol, right: leg.type })
            : Math.max(0, leg.type === "CE" ? spot - leg.strike : leg.strike - spot);
        const diff = leg.action === "buy" ? value - leg.premium : leg.premium - value;
        pnl += diff * legMultiplier(leg);
    }
    return pnl;
}

export default function IntradayChart({ symbol, mode, legs, selectedExpiry }) {
    const containerRef = useRef(null);
    const niftySeriesRef = useRef(null);
    const strategySeriesRef = useRef(null);
    const [points, setPoints] = useState(null);
    const [error, setError] = useState(null);
    const [tradeDate, setTradeDate] = useState(null);
    const [isHistorical, setIsHistorical] = useState(false);

    const showNifty = mode === "nifty" || mode === "combined";
    const showStrategy = mode === "strategy" || mode === "combined";

    useEffect(() => {
        let cancelled = false;
        setPoints(null);
        setError(null);
        fetchIntraday(symbol)
            .then((res) => {
                if (cancelled) return;
                setPoints(res.points);
                setTradeDate(res.tradeDate);
                setIsHistorical(res.isHistorical);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            });
        return () => {
            cancelled = true;
        };
    }, [symbol]);

    useEffect(() => {
        if (!points || !points.length || !containerRef.current || !tradeDate) return;

        const chart = createChart(containerRef.current, {
            layout: { background: { color: "#ffffff" }, textColor: "#374151" },
            grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e5e7eb" },
            rightPriceScale: { borderColor: "#e5e7eb" },
            width: containerRef.current.clientWidth,
            height: 340,
        });

        const t = selectedExpiry ? yearsToExpiry(selectedExpiry) : null;
        const niftyData = points.map((p) => ({ time: toEpochSeconds(tradeDate, p.time), value: p.ltp }));

        if (showNifty) {
            const niftySeries = chart.addSeries(AreaSeries, {
                lineColor: "#2563eb",
                topColor: "rgba(37, 99, 235, 0.25)",
                bottomColor: "rgba(37, 99, 235, 0.0)",
                lineWidth: 2,
                priceScaleId: showStrategy ? "left" : "right",
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            niftySeries.setData(niftyData);
            niftySeriesRef.current = niftySeries;
        }

        if (showStrategy && legs.length && t != null) {
            const strategyData = niftyData.map((p) => ({ time: p.time, value: strategyPnlAt(p.value, legs, t) }));
            const strategySeries = chart.addSeries(AreaSeries, {
                lineColor: "#10b981",
                topColor: "rgba(16, 185, 129, 0.25)",
                bottomColor: "rgba(16, 185, 129, 0.0)",
                lineWidth: 2,
                priceScaleId: "right",
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            strategySeries.setData(strategyData);
            strategySeriesRef.current = strategySeries;
        }

        chart.timeScale().fitContent();

        const handleResize = () => {
            if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
        };
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            niftySeriesRef.current = null;
            strategySeriesRef.current = null;
        };
    }, [points, tradeDate, mode, showNifty, showStrategy, selectedExpiry, legs]);

    // Live-append today's ticks. Only meaningful when we're actually showing
    // today (not a "market closed, here's the last trading day" fallback).
    useEffect(() => {
        if (isHistorical || !tradeDate) return;
        const unsubscribe = subscribeLiveTicks(symbol, (frame) => {
            if (frame.spot == null) return;
            const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
            const hh = String(ist.getUTCHours()).padStart(2, "0");
            const mm = String(ist.getUTCMinutes()).padStart(2, "0");
            const time = toEpochSeconds(tradeDate, `${hh}:${mm}`);

            if (niftySeriesRef.current) niftySeriesRef.current.update({ time, value: frame.spot });
            if (strategySeriesRef.current && legs.length && selectedExpiry) {
                const t = yearsToExpiry(selectedExpiry);
                strategySeriesRef.current.update({ time, value: strategyPnlAt(frame.spot, legs, t) });
            }
        });
        return unsubscribe;
    }, [symbol, isHistorical, tradeDate, legs, selectedExpiry]);

    if (error) {
        return <div className="p-8 text-center text-xs text-rose-500">Failed to load chart: {error}</div>;
    }
    if (!points) {
        return <div className="p-16 text-center text-xs text-gray-400">Loading chart…</div>;
    }
    if (points.length === 0) {
        return <div className="p-16 text-center text-xs text-gray-400">No intraday data yet today.</div>;
    }

    return (
        <div>
            {isHistorical && (
                <div className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                    Market closed — showing the last trading day ({tradeDate}), not live.
                </div>
            )}
            {showStrategy && !legs.length && (
                <div className="mb-2 rounded-md bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500">
                    Add legs to see the strategy's approximate P&L over the day (repriced from each leg's entry IV — not exact).
                </div>
            )}
            <div ref={containerRef} />
        </div>
    );
}
