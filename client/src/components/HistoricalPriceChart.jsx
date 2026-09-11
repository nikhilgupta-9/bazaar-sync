// components/HistoricalPriceChart.jsx — the Historical Chart page's main
// chart: a scoped "TradingView-lite" for our own stored daily OHLCV.
//
// Takes an already-aggregated daily candle array (the page aggregates the
// mixed minute/EOD rows so it can also derive its stat tiles from the same
// data) with epoch-second `time` values, and gives it a real charting UI:
//   • chart types  — candles / bars / line / area
//   • indicators   — SMA(20), SMA(50), EMA(20), Bollinger Bands(20,2)
//   • drawing tools — Trendline, Ray, Horizontal line, Fibonacci retracement
//     (ported from CandlestickChart.jsx — same lightweight-charts primitives,
//     adapted for epoch-time daily candles instead of one intraday day)
//   • volume histogram pane (auto — only when the symbol has volume)
//   • crosshair OHLC legend, PNG screenshot, fullscreen
//
// NOT a full TradingView clone (that needs their licensed Charting Library +
// a datafeed — a separate integration, deliberately not chosen so this stays
// tied to OUR stored data). Rectangle/measure/alerts/replay are out of scope.
//
// Theme-aware — reads useTheme() so it isn't a white slab on the dark theme.
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, LineStyle } from "lightweight-charts";
import { useTheme } from "../context/ThemeContext";
import { FiCamera, FiMaximize, FiMinimize, FiEye, FiEyeOff, FiTrash2 } from "react-icons/fi";

const CHART_TYPES = [
    { key: "candles", label: "Candles" },
    { key: "bars", label: "Bars" },
    { key: "line", label: "Line" },
    { key: "area", label: "Area" },
];

const DRAWING_TOOLS = [
    { key: "trendline", label: "Trendline", icon: "╱" },
    { key: "ray", label: "Ray", icon: "↗" },
    { key: "horizontal", label: "Horizontal line", icon: "─" },
    { key: "fib", label: "Fibonacci retracement", icon: "Fib" },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"];

const THEMES = {
    light: { bg: "#ffffff", text: "#374151", grid: "#f3f4f6", border: "#e5e7eb", panelBg: "bg-white" },
    dark: { bg: "#0b1420", text: "#c6ccda", grid: "rgba(255,255,255,0.06)", border: "#232c3b", panelBg: "bg-white" },
};
const UP = "#10b981";
const DOWN = "#f43f5e";

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
function bollingerBands(values, period = 20, mult = 2) {
    const mid = sma(values, period);
    const sd = rollingStdDev(values, period);
    const upper = mid.map((m, i) => (m != null && sd[i] != null ? m + mult * sd[i] : null));
    const lower = mid.map((m, i) => (m != null && sd[i] != null ? m - mult * sd[i] : null));
    return { upper, mid, lower };
}

function isoDay(epochSec) {
    return new Date(epochSec * 1000).toISOString().slice(0, 10);
}
function fmt(v) {
    return v == null ? "-" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function HistoricalPriceChart({ points, symbol = "", rangeLabel = "" }) {
    const { isDark } = useTheme();
    const wrapperRef = useRef(null);
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const priceSeriesRef = useRef(null);
    const overlaysRef = useRef([]); // { kind:'series'|'priceLine', ref, type:'drawing'|'indicator' }
    const pendingPointRef = useRef(null);

    const [chartType, setChartType] = useState("candles");
    const [chartTypeOpen, setChartTypeOpen] = useState(false);
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({ sma20: true, sma50: false, ema20: false, bollinger: false });
    const [showVolume, setShowVolume] = useState(true);
    const [activeTool, setActiveTool] = useState(null);
    const [drawingsVisible, setDrawingsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hover, setHover] = useState(null);

    const hasVolume = useMemo(() => (points || []).some((p) => p.volume > 0), [points]);

    // Build (or rebuild) the chart. Rebuilds on data / type / indicator /
    // theme changes — simplest way to keep overlay series consistent; user
    // drawings are cleared on rebuild (same tradeoff as CandlestickChart).
    useEffect(() => {
        if (!points || points.length === 0 || !containerRef.current) return;
        const t = isDark ? THEMES.dark : THEMES.light;

        const chart = createChart(containerRef.current, {
            layout: { background: { color: t.bg }, textColor: t.text, fontSize: 11 },
            grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
            timeScale: { borderColor: t.border, rightOffset: 6, fixLeftEdge: true },
            rightPriceScale: { borderColor: t.border, scaleMargins: { top: 0.08, bottom: hasVolume && showVolume ? 0.26 : 0.08 } },
            crosshair: { mode: 1 },
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight || 520,
        });
        chartRef.current = chart;
        overlaysRef.current = [];
        pendingPointRef.current = null;

        const ohlc = points.map((p) => ({ time: p.time, open: p.open, high: p.high, low: p.low, close: p.close }));
        const closes = points.map((p) => p.close);

        let priceSeries;
        if (chartType === "line") {
            priceSeries = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 2 });
            priceSeries.setData(ohlc.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartType === "area") {
            priceSeries = chart.addSeries(AreaSeries, {
                lineColor: "#2563eb", topColor: "rgba(37,99,235,0.30)", bottomColor: "rgba(37,99,235,0)", lineWidth: 2,
            });
            priceSeries.setData(ohlc.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartType === "bars") {
            priceSeries = chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN });
            priceSeries.setData(ohlc);
        } else {
            priceSeries = chart.addSeries(CandlestickSeries, {
                upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc);
        }
        priceSeriesRef.current = priceSeries;

        const addLine = (vals, color, width = 1.5) => {
            const s = chart.addSeries(LineSeries, { color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            s.setData(ohlc.map((d, i) => ({ time: d.time, value: vals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: s, type: "indicator" });
        };
        if (indicators.sma20) addLine(sma(closes, 20), "#f59e0b");
        if (indicators.sma50) addLine(sma(closes, 50), "#8b5cf6");
        if (indicators.ema20) addLine(ema(closes, 20), "#0891b2");
        if (indicators.bollinger) {
            const { upper, mid, lower } = bollingerBands(closes, 20, 2);
            addLine(upper, "#a855f7", 1);
            addLine(mid, "#c084fc", 1);
            addLine(lower, "#a855f7", 1);
        }

        if (hasVolume && showVolume) {
            const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" }, 0);
            chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
            vol.setData(points.map((p) => ({ time: p.time, value: p.volume, color: p.close >= p.open ? "rgba(16,185,129,0.4)" : "rgba(244,63,94,0.4)" })));
        }

        chart.timeScale().fitContent();

        const onMove = (param) => {
            const d = param.time != null ? param.seriesData?.get(priceSeries) : null;
            if (!d) { setHover(null); return; }
            if (d.open != null) setHover({ o: d.open, h: d.high, l: d.low, c: d.close, date: isoDay(Number(param.time)), up: d.close >= d.open });
            else setHover({ c: d.value, date: isoDay(Number(param.time)), lineOnly: true });
        };
        chart.subscribeCrosshairMove(onMove);

        const ro = new ResizeObserver(() => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight || 520,
                });
            }
        });
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            chart.unsubscribeCrosshairMove(onMove);
            chart.remove();
            chartRef.current = null;
            priceSeriesRef.current = null;
            overlaysRef.current = [];
        };
    }, [points, chartType, indicators, showVolume, isDark, hasVolume]);

    // Drawing-tool clicks — separate effect so toggling a tool only re-subs
    // the click handler instead of rebuilding the whole chart.
    useEffect(() => {
        const chart = chartRef.current;
        const series = priceSeriesRef.current;
        if (!chart || !series || !activeTool || !points?.length) return;
        const lastTime = points[points.length - 1].time;

        function handleClick(param) {
            if (!param.point || param.time == null) return;
            const price = series.coordinateToPrice(param.point.y);
            if (price == null) return;

            if (activeTool === "horizontal") {
                const line = series.createPriceLine({
                    price, color: "#7c3aed", lineWidth: 1, lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true, title: "",
                });
                overlaysRef.current.push({ kind: "priceLine", ref: line });
                return;
            }

            if (activeTool === "trendline" || activeTool === "ray") {
                const first = pendingPointRef.current;
                if (!first) { pendingPointRef.current = { time: param.time, value: price }; return; }
                const second = { time: param.time, value: price };
                let endPoint = second;
                if (activeTool === "ray") {
                    const dt = second.time - first.time;
                    if (dt !== 0 && lastTime > second.time) {
                        const slope = (second.value - first.value) / dt;
                        endPoint = { time: lastTime, value: second.value + slope * (lastTime - second.time) };
                    }
                }
                const s = chart.addSeries(LineSeries, {
                    color: activeTool === "ray" ? "#0891b2" : "#7c3aed", lineWidth: 2,
                    priceLineVisible: false, lastValueVisible: false, visible: drawingsVisible,
                });
                s.setData([first, endPoint].sort((a, b) => a.time - b.time));
                overlaysRef.current.push({ kind: "series", ref: s, type: "drawing" });
                pendingPointRef.current = null;
                return;
            }

            if (activeTool === "fib") {
                const first = pendingPointRef.current;
                if (!first) { pendingPointRef.current = { time: param.time, value: price }; return; }
                const second = { time: param.time, value: price };
                const high = Math.max(first.value, second.value);
                const low = Math.min(first.value, second.value);
                const diff = high - low;
                const startTime = Math.min(first.time, second.time);
                const endTime = Math.max(lastTime, startTime);
                FIB_LEVELS.forEach((level, i) => {
                    const levelPrice = high - diff * level;
                    const s = chart.addSeries(LineSeries, {
                        color: FIB_COLORS[i % FIB_COLORS.length], lineWidth: 1, lineStyle: LineStyle.Dashed,
                        priceLineVisible: false, lastValueVisible: true, title: `${(level * 100).toFixed(1)}%`, visible: drawingsVisible,
                    });
                    s.setData([{ time: startTime, value: levelPrice }, { time: endTime, value: levelPrice }]);
                    overlaysRef.current.push({ kind: "series", ref: s, type: "drawing" });
                });
                pendingPointRef.current = null;
            }
        }

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [activeTool, points, drawingsVisible]);

    useEffect(() => {
        function onFsChange() {
            setIsFullscreen(!!document.fullscreenElement);
            requestAnimationFrame(() => {
                if (chartRef.current && containerRef.current) {
                    chartRef.current.applyOptions({
                        width: containerRef.current.clientWidth,
                        height: containerRef.current.clientHeight || 520,
                    });
                }
            });
        }
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);

    function clearDrawings() {
        const chart = chartRef.current;
        const series = priceSeriesRef.current;
        if (!chart || !series) return;
        for (const ov of overlaysRef.current) {
            if (ov.type === "indicator") continue;
            if (ov.kind === "priceLine") series.removePriceLine(ov.ref);
            else chart.removeSeries(ov.ref);
        }
        overlaysRef.current = overlaysRef.current.filter((ov) => ov.type === "indicator");
        pendingPointRef.current = null;
    }
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
        link.download = `${symbol || "chart"}_${rangeLabel || ""}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }
    function toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrapperRef.current?.requestFullscreen?.();
    }

    const legend = hover || (points && points.length ? legendFromPoint(points[points.length - 1]) : null);
    const toolbarBtn = "rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-100";

    return (
        <div ref={wrapperRef} className={`flex gap-2 ${isFullscreen ? "h-screen bg-white p-3" : ""}`}>
            {/* Left drawing rail */}
            <div className="flex shrink-0 flex-col gap-1 border-r border-gray-100 pr-2">
                {DRAWING_TOOLS.map((tool) => (
                    <button
                        key={tool.key}
                        onClick={() => setActiveTool((t) => (t === tool.key ? null : tool.key))}
                        title={tool.label}
                        className={`w-9 rounded-md border px-1 py-1.5 text-[10px] font-bold transition ${
                            activeTool === tool.key ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-100"
                        }`}
                    >
                        {tool.icon}
                    </button>
                ))}
                <button onClick={toggleDrawingsVisible} title={drawingsVisible ? "Hide drawings" : "Show drawings"}
                    className={`grid w-9 place-items-center rounded-md border px-1 py-1.5 transition ${drawingsVisible ? "border-gray-200 text-gray-500 hover:bg-gray-100" : "border-amber-300 bg-amber-50 text-amber-700"}`}>
                    {drawingsVisible ? <FiEye size={13} /> : <FiEyeOff size={13} />}
                </button>
                <button onClick={clearDrawings} title="Clear drawings"
                    className="grid w-9 place-items-center rounded-md border border-gray-200 px-1 py-1.5 text-gray-500 hover:bg-gray-100">
                    <FiTrash2 size={13} />
                </button>
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
                {/* Toolbar */}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <div className="relative">
                            <button onClick={() => setChartTypeOpen((v) => !v)} className={toolbarBtn}>
                                {CHART_TYPES.find((c) => c.key === chartType)?.label} ▾
                            </button>
                            {chartTypeOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setChartTypeOpen(false)} />
                                    <div className="absolute left-0 z-20 mt-1 w-28 rounded-lg border border-gray-200 bg-white p-1 text-xs shadow-xl">
                                        {CHART_TYPES.map((c) => (
                                            <button key={c.key} onClick={() => { setChartType(c.key); setChartTypeOpen(false); }}
                                                className={`block w-full rounded-md px-2 py-1 text-left ${chartType === c.key ? "bg-blue-50 font-semibold text-blue-600" : "text-gray-600 hover:bg-gray-100"}`}>
                                                {c.label}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="relative">
                            <button onClick={() => setIndicatorsOpen((v) => !v)} className={toolbarBtn}>Indicators ▾</button>
                            {indicatorsOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setIndicatorsOpen(false)} />
                                    <div className="absolute left-0 z-20 mt-1 w-40 rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-xl">
                                        {[
                                            ["sma20", "SMA (20)"],
                                            ["sma50", "SMA (50)"],
                                            ["ema20", "EMA (20)"],
                                            ["bollinger", "Bollinger (20, 2)"],
                                        ].map(([k, label]) => (
                                            <label key={k} className="flex cursor-pointer items-center gap-2 py-1">
                                                <input type="checkbox" checked={indicators[k]} onChange={() => setIndicators((s) => ({ ...s, [k]: !s[k] }))} />
                                                {label}
                                            </label>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

                        {hasVolume && (
                            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-gray-600">
                                <input type="checkbox" checked={showVolume} onChange={() => setShowVolume((v) => !v)} /> Volume
                            </label>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5">
                        <button onClick={takeScreenshot} title="Download PNG" className={`grid place-items-center ${toolbarBtn}`}><FiCamera size={13} /></button>
                        <button onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"} className={`grid place-items-center ${toolbarBtn}`}>
                            {isFullscreen ? <FiMinimize size={13} /> : <FiMaximize size={13} />}
                        </button>
                    </div>
                </div>

                {/* Chart */}
                <div className="relative min-w-0 flex-1">
                    {legend && (
                        <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap gap-x-3 gap-y-0.5 rounded-md border border-gray-200 bg-white/90 px-2 py-1 text-[11px] font-medium tabular-nums text-gray-600 shadow-sm backdrop-blur-sm">
                            <span className="text-gray-400">{symbol} · {legend.date}</span>
                            {legend.lineOnly ? (
                                <span>Close <b className="text-gray-900">{fmt(legend.c)}</b></span>
                            ) : (
                                <>
                                    <span>O <b className="text-gray-800">{fmt(legend.o)}</b></span>
                                    <span>H <b className="text-gray-800">{fmt(legend.h)}</b></span>
                                    <span>L <b className="text-gray-800">{fmt(legend.l)}</b></span>
                                    <span>C <b className={legend.up ? "text-emerald-600" : "text-rose-600"}>{fmt(legend.c)}</b></span>
                                </>
                            )}
                        </div>
                    )}
                    {activeTool && (
                        <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                            {DRAWING_TOOLS.find((d) => d.key === activeTool)?.label}: click on the chart{activeTool !== "horizontal" ? " (2 points)" : ""}
                        </div>
                    )}
                    <div ref={containerRef} className={isFullscreen ? "h-full" : "h-[62vh] min-h-[420px]"} />
                </div>
            </div>
        </div>
    );
}

function legendFromPoint(p) {
    return { o: p.open, h: p.high, l: p.low, c: p.close, date: isoDay(p.time), up: p.close >= p.open };
}
