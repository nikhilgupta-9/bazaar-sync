// components/ContractChartModal.jsx
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import { fetchContractHistory } from "../services/optionChainApi";
import { formatPrice } from "../utils/format";

/**
 * TradingView-style candlestick chart for a single option contract, opened
 * from the hover action on the option chain's LTP cells. Real per-strike
 * option contracts aren't listed on TradingView itself, so this renders our
 * own stored per-minute LTP snapshots (option_chain_history) through
 * TradingView's open-source Lightweight Charts library rather than an
 * embedded widget.
 *
 * option_chain_history stores one LTP snapshot per minute, not real OHLC —
 * so each minute's candle is synthesized close-to-close (open = the
 * previous minute's close/LTP, close = this minute's LTP, high/low = the
 * wider of the two), same convention already established for the Simulator
 * Strategy Chart's per-minute P&L candles. Not a substitute for a real
 * intra-minute OHLC feed, just an honest way to show minute-wise movement
 * from what's actually stored.
 *
 * Presented as a bottom sheet (slides up from the bottom, not a centered
 * dialog) rather than a modal.
 */
export default function ContractChartModal({ symbol, strike, expiry, right, onClose }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const [points, setPoints] = useState(null);
    const [error, setError] = useState(null);
    const [open, setOpen] = useState(false);

    // Slide up on mount, slide down before actually closing.
    useEffect(() => {
        const raf = requestAnimationFrame(() => setOpen(true));
        return () => cancelAnimationFrame(raf);
    }, []);

    function handleClose() {
        setOpen(false);
        setTimeout(onClose, 220);
    }

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
            height: containerRef.current.clientHeight,
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#26a69a",
            downColor: "#ef5350",
            borderUpColor: "#26a69a",
            borderDownColor: "#ef5350",
            wickUpColor: "#26a69a",
            wickDownColor: "#ef5350",
            priceFormat: { type: "price", precision: 2, minMove: 0.05 },
        });

        // Synthesize a minute candle from consecutive LTP snapshots — see
        // file header comment for why (no real per-minute OHLC is stored).
        let prevClose = null;
        const candles = points.map((p) => {
            const open = prevClose == null ? p.value : prevClose;
            const close = p.value;
            prevClose = close;
            return {
                time: p.time,
                open,
                high: Math.max(open, close),
                low: Math.min(open, close),
                close,
            };
        });
        series.setData(candles);
        chart.timeScale().fitContent();

        const handleResize = () => {
            if (containerRef.current) {
                chart.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
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
            className={`fixed inset-0 z-50 flex items-end justify-center bg-black/50 transition-opacity duration-200 ${
                open ? "opacity-100" : "opacity-0"
            }`}
            onClick={handleClose}
        >
            <div
                className={`w-full max-w-4xl rounded-t-2xl bg-[#131722] shadow-2xl overflow-hidden transition-transform duration-200 ease-out ${
                    open ? "translate-y-0" : "translate-y-full"
                }`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-600" />

                <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
                    <div className="text-sm font-semibold text-gray-100">
                        {symbol} {strike} {right}
                        {lastPoint && (
                            <span className="ml-2 font-mono text-blue-400">
                                {formatPrice(lastPoint.value)}
                            </span>
                        )}
                        <span className="ml-2 text-[10px] font-normal text-gray-500">
                            Expiry {expiry} · 1-min candles
                        </span>
                    </div>
                    <button
                        onClick={handleClose}
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
                    <div
                        ref={containerRef}
                        className={`h-[50vh] max-h-[440px] ${points && points.length > 0 ? "" : "hidden"}`}
                    />
                </div>

                <div className="border-t border-gray-700 px-4 py-2 text-[10px] text-gray-500">
                    Candles synthesized from our own recorded per-minute LTP snapshots, not a live TradingView feed.
                </div>
            </div>
        </div>
    );
}
