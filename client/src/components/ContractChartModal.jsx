// components/ContractChartModal.jsx
import { useEffect, useRef, useState } from "react";
import { createChart, AreaSeries } from "lightweight-charts";
import { fetchContractHistory } from "../services/optionChainApi";
import { formatPrice } from "../utils/format";

/**
 * TradingView-style price chart for a single option contract, opened from the
 * hover action on the option chain's LTP cells. Real per-strike option
 * contracts aren't listed on TradingView itself, so this renders our own
 * stored LTP snapshots (option_chain_history) through TradingView's
 * open-source Lightweight Charts library rather than an embedded widget.
 */
export default function ContractChartModal({ symbol, strike, expiry, right, onClose }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const [points, setPoints] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setPoints(null);
        setError(null);

        fetchContractHistory(symbol, { strike, expiry, right })
            .then((res) => {
                if (!cancelled) setPoints(res.points);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            });

        return () => {
            cancelled = true;
        };
    }, [symbol, strike, expiry, right]);

    useEffect(() => {
        if (!points || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: {
                background: { color: "#131722" },
                textColor: "#d1d4dc",
            },
            grid: {
                vertLines: { color: "#1e222d" },
                horzLines: { color: "#1e222d" },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: "#2a2e39",
            },
            rightPriceScale: { borderColor: "#2a2e39" },
            width: containerRef.current.clientWidth,
            height: 360,
        });

        const series = chart.addSeries(AreaSeries, {
            lineColor: "#2962ff",
            topColor: "rgba(41, 98, 255, 0.35)",
            bottomColor: "rgba(41, 98, 255, 0.0)",
            lineWidth: 2,
            priceFormat: { type: "price", precision: 2, minMove: 0.05 },
        });
        series.setData(points.map((p) => ({ time: p.time, value: p.value })));
        chart.timeScale().fitContent();

        const handleResize = () => {
            if (containerRef.current) {
                chart.applyOptions({ width: containerRef.current.clientWidth });
            }
        };
        window.addEventListener("resize", handleResize);

        chartRef.current = chart;
        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
        };
    }, [points]);

    const lastPoint = points && points.length > 0 ? points[points.length - 1] : null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-3xl rounded-lg bg-[#131722] shadow-xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
                    <div className="text-sm font-semibold text-gray-100">
                        {symbol} {strike} {right}
                        {lastPoint && (
                            <span className="ml-2 font-mono text-blue-400">
                                {formatPrice(lastPoint.value)}
                            </span>
                        )}
                        <span className="ml-2 text-[10px] font-normal text-gray-500">
                            Expiry {expiry}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white transition"
                        aria-label="Close chart"
                    >
                        ✕
                    </button>
                </div>

                <div className="p-2">
                    {error && (
                        <div className="p-8 text-center text-xs text-rose-400">
                            Failed to load chart: {error}
                        </div>
                    )}
                    {!error && !points && (
                        <div className="p-16 text-center text-xs text-gray-500">Loading chart…</div>
                    )}
                    {!error && points && points.length === 0 && (
                        <div className="p-16 text-center text-xs text-gray-500">
                            No price history stored yet for this contract.
                        </div>
                    )}
                    <div ref={containerRef} className={points && points.length > 0 ? "" : "hidden"} />
                </div>

                <div className="border-t border-gray-700 px-4 py-2 text-[10px] text-gray-500">
                    LTP history from our own recorded snapshots, not a live TradingView feed.
                </div>
            </div>
        </div>
    );
}
