// components/CandlestickChart.jsx
//
// Real candlestick chart for the Simulator's "NIFTY Chart" / "Strategy Chart
// + NIFTY Chart" tabs — 1-minute OHLC bars for the currently selected
// historical day, straight from ohlcv_data (see simulatorController.js's
// /candles endpoint), never Angel One. Independent of any strategy replay:
// it renders as soon as a symbol+date is picked, with no legs/run required.
//
// Drawing tools + indicators are intentionally scoped, not a full TradingView
// clone (that's what the paid/licensed TradingView Charting Library + a
// custom datafeed would be — a separate, bigger integration, deliberately
// not chosen here so this chart stays tied to OUR stored historical replay
// data rather than TradingView's own live feed). Built incrementally:
// Trendline, Horizontal Line, Ray, and Fibonacci Retracement are real;
// Rectangle/Ellipse/Brush/measure-tool/replay/alerts are NOT built yet —
// Text is still a "coming soon" stub (a real text-annotation tool needs its
// own input UI, a separate follow-up). Indicators: SMA(20)/EMA(20) (already
// existed) plus Bollinger Bands(20,2) and single-day VWAP (new).
import { useEffect, useRef, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import { createChart, CandlestickSeries, LineSeries, AreaSeries, BarSeries, HistogramSeries, LineStyle } from "lightweight-charts";
import { fetchSimulatorCandles } from "../services/simulatorApi";

const TIMEFRAMES = [
    { key: "1m", label: "1m", minutes: 1 },
    { key: "5m", label: "5m", minutes: 5 },
    { key: "15m", label: "15m", minutes: 15 },
    { key: "1h", label: "1h", minutes: 60 },
];

const CHART_TYPES = [
    { key: "candles", label: "Candles" },
    { key: "bars", label: "Bars" },
    { key: "line", label: "Line" },
    { key: "area", label: "Area" },
];

// Trendline/Horizontal Line/Ray/Fibonacci are real. Rectangle/Ellipse/Brush
// and a real measure tool aren't built yet (next phase) — Text stays a
// stub since it needs its own text-input UI, a separate piece of work.
const DRAWING_TOOLS = [
    { key: "trendline", label: "Trendline", icon: "╱", wired: true },
    { key: "ray", label: "Ray", icon: "↗", wired: true },
    { key: "horizontal", label: "H-Line", icon: "─", wired: true },
    { key: "fib", label: "Fibonacci", icon: "Fib", wired: true },
    { key: "text", label: "Text", icon: "T", wired: false },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"];

// IST wall-clock date+time -> epoch seconds, treating the wall-clock digits
// as if they were already UTC (no offset subtraction) — same deliberate
// convention as IntradayChart.jsx's toEpochSeconds and the contract-history
// backend endpoint. lightweight-charts renders its time axis in UTC by
// default; doing it this way makes the displayed label show the real IST
// time (e.g. "09:15" for market open) instead of shifting it 5.5h.
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

function rollingStdDev(values, period) {
    const out = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
        const slice = values.slice(i - period + 1, i + 1);
        const mean = slice.reduce((a, b) => a + b, 0) / period;
        const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
        out[i] = Math.sqrt(variance);
    }
    return out;
}

/** Bollinger Bands(period, mult): { upper, mid, lower }, null until `period` values are in. */
function bollingerBands(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const sd = rollingStdDev(values, period);
    const upper = mid.map((m, i) => (m != null && sd[i] != null ? m + mult * sd[i] : null));
    const lower = mid.map((m, i) => (m != null && sd[i] != null ? m - mult * sd[i] : null));
    return { upper, mid, lower };
}

/** Cumulative single-day VWAP — resets naturally since this chart is always one historical day. */
function vwapSeries(candles) {
    let cumPV = 0;
    let cumV = 0;
    return candles.map((c) => {
        const typical = (c.high + c.low + c.close) / 3;
        cumPV += typical * (c.volume || 0);
        cumV += c.volume || 0;
        return cumV > 0 ? cumPV / cumV : null;
    });
}

const CandlestickChart = forwardRef(function CandlestickChart({ symbol, date, compact = false }, ref) {
    const wrapperRef = useRef(null);
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const candleSeriesRef = useRef(null);
    // Every overlay (price lines + trendline/ray/fib/indicator line series)
    // created on top of the candles, so "Clear drawings" and chart teardown
    // can remove them without leaking references into a rebuilt chart
    // instance. `type: "drawing"` vs `"indicator"` lets the eye-toggle below
    // hide only user-drawn lines, not indicator overlays.
    const overlaysRef = useRef([]);
    const pendingPointRef = useRef(null); // shared by trendline/ray/fib — only one tool active at a time

    // Exposes the underlying chart instance so a parent (Simulator.jsx's
    // "combined" tab) can wire crosshair/time-range sync against StrategyChart's
    // chart — see StrategyChart.jsx for the matching half of that.
    useImperativeHandle(ref, () => ({ getChart: () => chartRef.current, getSeries: () => candleSeriesRef.current }));

    const [showVolume, setShowVolume] = useState(true);
    const [rawCandles, setRawCandles] = useState(null);
    const [error, setError] = useState(null);
    const [timeframe, setTimeframe] = useState("1m");
    const [chartType, setChartType] = useState("candles");
    const [chartTypeOpen, setChartTypeOpen] = useState(false);
    const [activeTool, setActiveTool] = useState(null);
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({ sma: false, ema: false, bollinger: false, vwap: false });
    const [drawingsVisible, setDrawingsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);

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
        pendingPointRef.current = null;
    }

    // Shows/hides user-drawn lines (trendline/ray/fib) without deleting them.
    // Scoped to `type: "drawing"` line-series overlays only — H-Line (a
    // native lightweight-charts price line, not a series) doesn't expose the
    // same visible-toggle option, so it's left out of this toggle rather than
    // faking support for it; indicator overlays are also untouched (they
    // have their own on/off via the Indicators checkboxes).
    function toggleDrawingsVisible() {
        setDrawingsVisible((v) => {
            const next = !v;
            for (const ov of overlaysRef.current) {
                if (ov.kind === "series" && ov.type === "drawing") ov.ref.applyOptions({ visible: next });
            }
            return next;
        });
    }

    function takeScreenshot() {
        const chart = chartRef.current;
        if (!chart) return;
        const canvas = chart.takeScreenshot();
        const link = document.createElement("a");
        link.download = `${symbol}_${date}_${chartType}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }

    useEffect(() => {
        function onFsChange() {
            setIsFullscreen(!!document.fullscreenElement);
            // Fullscreen resizes the container without always firing a
            // window "resize" event in every browser — nudge the chart too.
            requestAnimationFrame(() => {
                if (chartRef.current && containerRef.current) {
                    chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
                }
            });
        }
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            wrapperRef.current?.requestFullscreen?.();
        }
    }

    // Builds the chart fresh whenever the candle set, chart type, or
    // indicator toggles change — simplest way to keep overlay series in sync
    // with a rebuilt pane without hand-tracking incremental add/remove.
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

        const ohlcData = candles.map((c) => ({
            time: toEpochSeconds(date, c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }));

        let series;
        if (chartType === "line") {
            series = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 2 });
            series.setData(ohlcData.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartType === "area") {
            series = chart.addSeries(AreaSeries, {
                lineColor: "#2563eb",
                topColor: "rgba(37, 99, 235, 0.35)",
                bottomColor: "rgba(37, 99, 235, 0)",
            });
            series.setData(ohlcData.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartType === "bars") {
            series = chart.addSeries(BarSeries, { upColor: "#10b981", downColor: "#f43f5e" });
            series.setData(ohlcData);
        } else {
            series = chart.addSeries(CandlestickSeries, {
                upColor: "#10b981",
                downColor: "#f43f5e",
                borderUpColor: "#10b981",
                borderDownColor: "#f43f5e",
                wickUpColor: "#10b981",
                wickDownColor: "#f43f5e",
            });
            series.setData(ohlcData);
        }
        candleSeriesRef.current = series;
        overlaysRef.current = [];
        pendingPointRef.current = null;

        const hasVolume = candles.some((c) => c.volume != null && c.volume > 0);
        if (showVolume && hasVolume) {
            const volSeries = chart.addSeries(
                HistogramSeries,
                { color: "#93c5fd", priceFormat: { type: "volume" }, title: "Volume" },
                1
            );
            volSeries.setData(
                candles.map((c, i) => ({
                    time: ohlcData[i].time,
                    value: c.volume,
                    color: c.close >= c.open ? "#86efac" : "#fca5a5",
                }))
            );
            chart.panes()[1]?.setHeight(Math.round((compact ? 220 : 380) * 0.2));
        }

        const closes = candles.map((c) => c.close);

        if (indicators.sma) {
            const vals = sma(closes, 20);
            const s = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            s.setData(ohlcData.map((d, i) => ({ time: d.time, value: vals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: s, type: "indicator" });
        }
        if (indicators.ema) {
            const vals = ema(closes, 20);
            const s = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            s.setData(ohlcData.map((d, i) => ({ time: d.time, value: vals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: s, type: "indicator" });
        }
        if (indicators.bollinger) {
            const { upper, mid, lower } = bollingerBands(closes, 20, 2);
            const addBand = (vals, color, width) => {
                const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false });
                s.setData(ohlcData.map((d, i) => ({ time: d.time, value: vals[i] })).filter((p) => p.value != null));
                overlaysRef.current.push({ kind: "series", ref: s, type: "indicator" });
            };
            addBand(upper, "#a855f7", 1);
            addBand(mid, "#c084fc", 1);
            addBand(lower, "#a855f7", 1);
        }
        if (indicators.vwap) {
            const vals = vwapSeries(candles);
            const s = chart.addSeries(LineSeries, { color: "#059669", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            s.setData(ohlcData.map((d, i) => ({ time: d.time, value: vals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: s, type: "indicator" });
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
            pendingPointRef.current = null;
        };
    }, [candles, date, compact, chartType, showVolume, indicators.sma, indicators.ema, indicators.bollinger, indicators.vwap]);

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
                const first = pendingPointRef.current;
                if (!first) {
                    pendingPointRef.current = { time: param.time, value: price };
                    return;
                }
                const trendSeries = chart.addSeries(LineSeries, {
                    color: "#7c3aed",
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    visible: drawingsVisible,
                });
                trendSeries.setData([first, { time: param.time, value: price }].sort((a, b) => a.time - b.time));
                overlaysRef.current.push({ kind: "series", ref: trendSeries, type: "drawing" });
                pendingPointRef.current = null;
                return;
            }

            // Ray: like Trendline, but extrapolated out to the chart's last
            // candle so it reads as "extending forward" — lightweight-charts
            // has no native infinite-ray primitive, so this is a straight
            // extension to the visible data's right edge, not a true
            // infinite ray past the edge of the pane.
            if (activeTool === "ray") {
                const first = pendingPointRef.current;
                if (!first) {
                    pendingPointRef.current = { time: param.time, value: price };
                    return;
                }
                const second = { time: param.time, value: price };
                const lastCandle = candles[candles.length - 1];
                const chartEndTime = lastCandle ? toEpochSeconds(date, lastCandle.time) : second.time;
                let endPoint = second;
                const dt = second.time - first.time;
                if (dt !== 0 && chartEndTime > second.time) {
                    const slope = (second.value - first.value) / dt;
                    endPoint = { time: chartEndTime, value: second.value + slope * (chartEndTime - second.time) };
                }
                const raySeries = chart.addSeries(LineSeries, {
                    color: "#0891b2",
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    visible: drawingsVisible,
                });
                raySeries.setData([first, endPoint].sort((a, b) => a.time - b.time));
                overlaysRef.current.push({ kind: "series", ref: raySeries, type: "drawing" });
                pendingPointRef.current = null;
                return;
            }

            // Fibonacci Retracement: two clicks set the high/low anchor
            // points; the 7 standard levels are drawn as horizontal segments
            // spanning from the anchor range out to the chart's last candle.
            if (activeTool === "fib") {
                const first = pendingPointRef.current;
                if (!first) {
                    pendingPointRef.current = { time: param.time, value: price };
                    return;
                }
                const second = { time: param.time, value: price };
                const high = Math.max(first.value, second.value);
                const low = Math.min(first.value, second.value);
                const diff = high - low;
                const startTime = Math.min(first.time, second.time);
                const lastCandle = candles[candles.length - 1];
                const endTime = lastCandle ? toEpochSeconds(date, lastCandle.time) : Math.max(first.time, second.time);

                FIB_LEVELS.forEach((level, i) => {
                    const levelPrice = high - diff * level;
                    const fibSeries = chart.addSeries(LineSeries, {
                        color: FIB_COLORS[i % FIB_COLORS.length],
                        lineWidth: 1,
                        lineStyle: LineStyle.Dashed,
                        priceLineVisible: false,
                        lastValueVisible: true,
                        title: `${(level * 100).toFixed(1)}%`,
                        visible: drawingsVisible,
                    });
                    fibSeries.setData([
                        { time: startTime, value: levelPrice },
                        { time: Math.max(endTime, startTime), value: levelPrice },
                    ]);
                    overlaysRef.current.push({ kind: "series", ref: fibSeries, type: "drawing" });
                });
                pendingPointRef.current = null;
            }
        }

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [activeTool, candles, date, drawingsVisible]);

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
        <div ref={wrapperRef} className={`flex gap-2 ${isFullscreen ? "bg-white p-3" : ""}`}>
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
                    onClick={toggleDrawingsVisible}
                    title={drawingsVisible ? "Hide drawings" : "Show drawings"}
                    className={`w-9 rounded-md border px-1 py-1.5 text-[10px] font-bold transition ${
                        drawingsVisible ? "border-gray-200 text-gray-500 hover:bg-gray-50" : "border-amber-300 bg-amber-50 text-amber-700"
                    }`}
                >
                    {drawingsVisible ? "👁" : "🚫"}
                </button>
                <button
                    onClick={clearDrawings}
                    title="Clear drawings"
                    className="w-9 rounded-md border border-gray-200 px-1 py-1.5 text-[10px] font-bold text-gray-500 hover:bg-gray-50"
                >
                    ✕
                </button>
            </div>

            <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
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
                                onClick={() => setChartTypeOpen((v) => !v)}
                                className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                            >
                                {CHART_TYPES.find((t) => t.key === chartType)?.label}
                            </button>
                            {chartTypeOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setChartTypeOpen(false)} />
                                    <div className="absolute left-0 z-20 mt-1 w-28 rounded-lg border border-gray-200 bg-white p-1 shadow-xl text-xs">
                                        {CHART_TYPES.map((t) => (
                                            <button
                                                key={t.key}
                                                onClick={() => { setChartType(t.key); setChartTypeOpen(false); }}
                                                className={`block w-full rounded-md px-2 py-1 text-left ${
                                                    chartType === t.key ? "bg-blue-50 text-blue-600 font-semibold" : "text-gray-600 hover:bg-gray-50"
                                                }`}
                                            >
                                                {t.label}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <label className="flex cursor-pointer items-center gap-1 text-[11px] text-gray-600">
                            <input type="checkbox" checked={showVolume} onChange={() => setShowVolume((v) => !v)} /> Volume
                        </label>
                    </div>

                    <div className="flex items-center gap-1.5">
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
                                        <label className="flex cursor-pointer items-center gap-2 py-1">
                                            <input
                                                type="checkbox"
                                                checked={indicators.bollinger}
                                                onChange={() => setIndicators((s) => ({ ...s, bollinger: !s.bollinger }))}
                                            />
                                            Bollinger (20,2)
                                        </label>
                                        <label className="flex cursor-pointer items-center gap-2 py-1">
                                            <input
                                                type="checkbox"
                                                checked={indicators.vwap}
                                                onChange={() => setIndicators((s) => ({ ...s, vwap: !s.vwap }))}
                                            />
                                            VWAP
                                        </label>
                                    </div>
                                </>
                            )}
                        </div>

                        <button
                            onClick={takeScreenshot}
                            title="Download chart as PNG"
                            className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                        >
                            📷
                        </button>
                        <button
                            onClick={toggleFullscreen}
                            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                            className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                        >
                            {isFullscreen ? "⤡" : "⤢"}
                        </button>
                    </div>
                </div>
                <div ref={containerRef} />
            </div>
        </div>
    );
});

export default CandlestickChart;
