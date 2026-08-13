// components/UnderlyingChart.jsx
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";
import { fetchUnderlyingHistory } from "../services/optionChainApi";

/**
 * Real candlestick chart of the underlying (index/stock) from stored
 * ohlcv_data, rendered inline (not a modal) in the Strategy Builder's chart
 * card — light theme to match the rest of the page, unlike the dark
 * TradingView-style theme ContractChartModal uses for its popup.
 */
export default function UnderlyingChart({ symbol, days = 30 }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const [points, setPoints] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setPoints(null);
        setError(null);

        fetchUnderlyingHistory(symbol, days)
            .then((res) => {
                if (!cancelled) setPoints(res.points);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            });

        return () => {
            cancelled = true;
        };
    }, [symbol, days]);

    useEffect(() => {
        if (!points || !points.length || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: { background: { color: "#ffffff" }, textColor: "#374151" },
            grid: {
                vertLines: { color: "#f3f4f6" },
                horzLines: { color: "#f3f4f6" },
            },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e5e7eb" },
            rightPriceScale: { borderColor: "#e5e7eb" },
            width: containerRef.current.clientWidth,
            height: 360,
        });

        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#10b981",
            downColor: "#f43f5e",
            borderVisible: false,
            wickUpColor: "#10b981",
            wickDownColor: "#f43f5e",
            priceFormat: { type: "price", precision: 2, minMove: 0.05 },
        });
        series.setData(points);
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

    if (error) {
        return <div className="p-16 text-center text-xs text-rose-600">Failed to load chart: {error}</div>;
    }
    if (!points) {
        return <div className="p-16 text-center text-xs text-gray-400">Loading underlying chart…</div>;
    }
    if (points.length === 0) {
        return <div className="p-16 text-center text-xs text-gray-400">No stored OHLCV history yet for {symbol}.</div>;
    }

    return (
        <div>
            <div ref={containerRef} />
            <div className="mt-1 text-[10px] text-gray-400">
                {symbol} daily/minute OHLCV from our own stored history — not a live TradingView feed.
            </div>
        </div>
    );
}
