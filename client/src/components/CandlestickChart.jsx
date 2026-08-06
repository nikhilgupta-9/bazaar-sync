// components/CandlestickChart.jsx
//
// Real candlestick chart for the Simulator's "NIFTY Chart" / "Strategy Chart
// + NIFTY Chart" tabs — 1-minute OHLC bars for the currently selected
// historical day, straight from ohlcv_data (see simulatorController.js's
// /candles endpoint), never Angel One. Independent of any strategy replay:
// it renders as soon as a symbol+date is picked, with no legs/run required.
//
// Drawing tools + indicators are intentionally scoped, not a full TradingView
// clone: Trendline and Horizontal Line are real and functional; Fibonacci and
// Text are visible in the sidebar (matching the reference spec) but wired as
// "coming soon" rather than faked, since a proper fib-retracement/text-
// annotation tool is a separate, larger follow-up. Indicators are a real
// SMA(20)/EMA(20) overlay, not a placeholder.
import { useEffect, useRef, useState, useMemo } from "react";
import { createChart, CandlestickSeries, LineSeries, LineStyle } from "lightweight-charts";
import { fetchSimulatorCandles } from "../services/simulatorApi";

const TIMEFRAMES = [
    { key: "1m", label: "1m", minutes: 1 },
    { key: "5m", label: "5m", minutes: 5 },
    { key: "15m", label: "15m", minutes: 15 },
    { key: "1h", label: "1h", minutes: 60 },
];

// Fib/Text are shown (per the reference spec's drawing-tools sidebar) but not
// wired yet — disabled with a "coming soon" tooltip rather than pretending to
// work. Trendline/Horizontal Line are real.
const DRAWING_TOOLS = [
    { key: "trendline", label: "Trendline", icon: "╱", wired: true },
    { key: "horizontal", label: "H-Line", icon: "─", wired: true },
    { key: "fib", label: "Fibonacci", icon: "Fib", wired: false },
    { key: "text", label: "Text", icon: "T", wired: false },
];

function toEpochSeconds(dateStr, timeStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm, ss] = timeStr.split(":").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss || 0) / 1000);
}

// Coarser timeframes are built client-side by grouping consecutive 1-minute
// bars (open of the first, close of the last, high/low across the group) —
// the backend always serves 1m bars from ohlcv_data, no per-interval query.
function aggregateCandles(candles, minutes) {
    if (minutes <= 1) return candles;
    const groups = [];
    for (let i = 0; i < candles.length; i += minutes) {
        const chunk = candles.slice(i, i + minutes);
        if (!chunk.length) continue;
        groups.push({
            time: chunk[0].time,
            open: chunk[0].open,
            high: Math.max(...chunk.map((c) => c.high)),
            low: Math.min(...chunk.map((c) => c.low)),
            close: chunk[chunk.length - 1].close,
            volume: chunk.reduce((s, c) => s + (c.volume || 0), 0),
        });
    }
    return groups;
}

function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
        if (i === period - 1) {
            prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
            out[i] = prev;
        } else if (i > period - 1) {
            prev = values[i] * k + prev * (1 - k);
            out[i] = prev;
        }
    }
    return out;
}

export default function CandlestickChart({ symbol, date, compact = false }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const candleSeriesRef = useRef(null);
    // Every overlay (price lines + trendline/indicator line series) created
    // on top of the candles, so "Clear drawings" and chart teardown can
    // remove them without leaking references into a rebuilt chart instance.
    const overlaysRef = useRef([]);
    const pendingTrendPointRef = useRef(null);

    const [rawCandles, setRawCandles] = useState(null);
    const [error, setError] = useState(null);
    const [timeframe, setTimeframe] = useState("1m");
    const [activeTool, setActiveTool] = useState(null);
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({ sma: false, ema: false });

    useEffect(() => {
        let cancelled = false;
        setRawCandles(null);
        setError(null);
        setActiveTool(null);
        if (!symbol || !date) return;
        fetchSimulatorCandles(symbol, { date })
            .then((res) => {
                if (!cancelled) setRawCandles(res.candles);
            })
            .catch((err) => {
                if (!cancelled) setError(err.message);
            });
        return () => {
            cancelled = true;
        };
    }, [symbol, date]);

    const candles = useMemo(() => {
        if (!rawCandles) return null;
        const tf = TIMEFRAMES.find((t) => t.key === timeframe) || TIMEFRAMES[0];
        return aggregateCandles(rawCandles, tf.minutes);
    }, [rawCandles, timeframe]);

    function clearDrawings() {
        const series = candleSeriesRef.current;
        const chart = chartRef.current;
        if (!series || !chart) return;
        for (const ov of overlaysRef.current) {
            if (ov.kind === "priceLine") series.removePriceLine(ov.ref);
            else chart.removeSeries(ov.ref);
        }
        overlaysRef.current = [];
        pendingTrendPointRef.current = null;
    }

    // Builds the chart fresh whenever the candle set or indicator toggles
    // change — simplest way to keep overlay series in sync with a rebuilt
    // pane without hand-tracking incremental add/remove for indicators.
    useEffect(() => {
        if (!candles || !candles.length || !containerRef.current || !date) return;

        const chart = createChart(containerRef.current, {
            layout: { background: { color: "#ffffff" }, textColor: "#374151" },
            grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e5e7eb" },
            rightPriceScale: { borderColor: "#e5e7eb" },
            width: containerRef.current.clientWidth,
            height: compact ? 220 : 380,
        });
        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#10b981",
            downColor: "#f43f5e",
            borderUpColor: "#10b981",
            borderDownColor: "#f43f5e",
            wickUpColor: "#10b981",
            wickDownColor: "#f43f5e",
        });
        const data = candles.map((c) => ({
            time: toEpochSeconds(date, c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));
        series.setData(data);
        candleSeriesRef.current = series;
        overlaysRef.current = [];
        pendingTrendPointRef.current = null;

        if (indicators.sma) {
            const smaVals = sma(candles.map((c) => c.close), 20);
            const smaSeries = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            smaSeries.setData(data.map((d, i) => ({ time: d.time, value: smaVals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: smaSeries });
        }
        if (indicators.ema) {
            const emaVals = ema(candles.map((c) => c.close), 20);
            const emaSeries = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            emaSeries.setData(data.map((d, i) => ({ time: d.time, value: emaVals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: emaSeries });
        }

        chart.timeScale().fitContent();

        const handleResize = () => {
            if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
        };
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            overlaysRef.current = [];
            pendingTrendPointRef.current = null;
        };
    }, [candles, date, compact, indicators.sma, indicators.ema]);

    // Drawing-tool click handling, kept in its own effect so toggling a tool
    // doesn't tear down and rebuild the whole chart — only re-subscribes the
    // click handler.
    useEffect(() => {
        const chart = chartRef.current;
        const series = candleSeriesRef.current;
        if (!chart || !series || !activeTool) return;

        function handleClick(param) {
            if (!param.point || param.time == null) return;
            const price = series.coordinateToPrice(param.point.y);
            if (price == null) return;

            if (activeTool === "horizontal") {
                const line = series.createPriceLine({
                    price,
                    color: "#7c3aed",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: "H-Line",
                });
                overlaysRef.current.push({ kind: "priceLine", ref: line });
                return;
            }

            if (activeTool === "trendline") {
                const first = pendingTrendPointRef.current;
                if (!first) {
                    pendingTrendPointRef.current = { time: param.time, value: price };
                    return;
                }
                const trendSeries = chart.addSeries(LineSeries, {
                    color: "#7c3aed",
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                });
                trendSeries.setData([first, { time: param.time, value: price }].sort((a, b) => a.time - b.time));
                overlaysRef.current.push({ kind: "series", ref: trendSeries });
                pendingTrendPointRef.current = null;
            }
        }

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [activeTool]);

    if (error) {
        return <div className="p-8 text-center text-xs text-rose-500">Failed to load chart: {error}</div>;
    }
    if (!date) {
        return <div className="p-16 text-center text-xs text-gray-400">Pick a date to view the chart.</div>;
    }
    if (!candles) {
        return <div className="p-16 text-center text-xs text-gray-400">Loading candles…</div>;
    }
    if (!candles.length) {
        return (
            <div className="p-16 text-center text-xs text-gray-400">
                No stored candle data for {symbol} on {date}.
            </div>
        );
    }

    return (
        <div className="flex gap-2">
            <div className="flex shrink-0 flex-col gap-1 border-r border-gray-100 pr-2">
                {DRAWING_TOOLS.map((tool) => (
                    <button
                        key={tool.key}
                        onClick={() => tool.wired && setActiveTool((t) => (t === tool.key ? null : tool.key))}
                        disabled={!tool.wired}
                        title={tool.wired ? tool.label : `${tool.label} — coming soon`}
                        className={`w-9 rounded-md border px-1 py-1.5 text-[10px] font-bold transition disabled:opacity-30 disabled:cursor-not-allowed ${
                            activeTool === tool.key
                                ? "border-purple-300 bg-purple-50 text-purple-700"
                                : "border-gray-200 text-gray-500 hover:bg-gray-50"
                        }`}
                    >
                        {tool.icon}
                    </button>
                ))}
                <button
                    onClick={clearDrawings}
                    title="Clear drawings"
                    className="w-9 rounded-md border border-gray-200 px-1 py-1.5 text-[10px] font-bold text-gray-500 hover:bg-gray-50"
                >
                    ✕
                </button>
            </div>

            <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center justify-between">
                    <div className="flex gap-1">
                        {TIMEFRAMES.map((tf) => (
                            <button
                                key={tf.key}
                                onClick={() => setTimeframe(tf.key)}
                                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                                    timeframe === tf.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                }`}
                            >
                                {tf.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative">
                        <button
                            onClick={() => setIndicatorsOpen((v) => !v)}
                            className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                        >
                            Indicators
                        </button>
                        {indicatorsOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setIndicatorsOpen(false)} />
                                <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-gray-200 bg-white p-2 shadow-xl text-xs">
                                    <label className="flex cursor-pointer items-center gap-2 py-1">
                                        <input
                                            type="checkbox"
                                            checked={indicators.sma}
                                            onChange={() => setIndicators((s) => ({ ...s, sma: !s.sma }))}
                                        />
                                        SMA (20)
                                    </label>
                                    <label className="flex cursor-pointer items-center gap-2 py-1">
                                        <input
                                            type="checkbox"
                                            checked={indicators.ema}
                                            onChange={() => setIndicators((s) => ({ ...s, ema: !s.ema }))}
                                        />
                                        EMA (20)
                                    </label>
                                </div>
                            </>
                        )}
                    </div>
                </div>
                <div ref={containerRef} />
            </div>
        </div>
    );
}
