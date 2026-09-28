import React from "react";
// components/ContractChartModal.jsx — Ultra-Smooth Strike Option Candlestick Terminal
// Responsive modal with multi-timeframe aggregation (1m, 3m, 5m, 15m), technical indicators,
// complete drawing tools, Heikin Ashi smoothing, volume/OI histogram, and instant leg actions.
import { useEffect, useRef, useState, useMemo } from "react";
import {
    createChart,
    CandlestickSeries,
    BarSeries,
    LineSeries,
    AreaSeries,
    HistogramSeries,
    LineStyle,
} from "lightweight-charts";
import { useTheme } from "../context/ThemeContext";
import { fetchContractHistory } from "../services/optionChainApi";
import { formatPrice, formatPercent } from "../utils/format";
import {
    FiX,
    FiCamera,
    FiMaximize,
    FiMinimize,
    FiSliders,
    FiTrendingUp,
    FiEye,
    FiEyeOff,
    FiTrash2,
    FiPlus,
    FiMinus,
} from "react-icons/fi";

const CHART_STYLES = [
    { key: "candles", label: "Candles" },
    { key: "hollow", label: "Hollow" },
    { key: "bars", label: "Bars" },
    { key: "line", label: "Line" },
    { key: "area", label: "Area" },
    { key: "heikinashi", label: "Heikin Ashi" },
];

const TIMEFRAMES = [
    { label: "1m", value: 1 },
    { label: "3m", value: 3 },
    { label: "5m", value: 5 },
    { label: "15m", value: 15 },
];

const DRAWING_TOOLS = [
    { key: "trendline", label: "Trendline", icon: "╱" },
    { key: "ray", label: "Ray", icon: "↗" },
    { key: "horizontal", label: "Horizontal Level", icon: "─" },
    { key: "fib", label: "Fibonacci Retracement", icon: "Fib" },
    { key: "long_pos", label: "Long Target/SL", icon: "▲" },
    { key: "short_pos", label: "Short Target/SL", icon: "▼" },
];

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#ef4444", "#f97316", "#eab308", "#059669", "#06b6d4", "#3b82f6", "#8b5cf6"];

const THEMES = {
    light: {
        bg: "#ffffff",
        text: "#374151",
        grid: "rgba(0, 0, 0, 0.04)",
        border: "#e5e7eb",
        panelBg: "bg-white",
    },
    dark: {
        bg: "#0b1420",
        text: "#c6ccda",
        grid: "rgba(255, 255, 255, 0.05)",
        border: "#1e293b",
        panelBg: "bg-[#0b1420]",
    },
};

const UP = "#059669";
const DOWN = "#e11d48";

// Technical Calculations
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

function toHeikinAshi(points) {
    if (!points.length) return [];
    const ha = [];
    let prevHaOpen = points[0].open;
    let prevHaClose = points[0].close;

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const haClose = (p.open + p.high + p.low + p.close) / 4;
        const haOpen = i === 0 ? (p.open + p.close) / 2 : (prevHaOpen + prevHaClose) / 2;
        const haHigh = Math.max(p.high, haOpen, haClose);
        const haLow = Math.min(p.low, haOpen, haClose);

        ha.push({ time: p.time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: p.volume });
        prevHaOpen = haOpen;
        prevHaClose = haClose;
    }
    return ha;
}

function aggregateContractCandles(points, intervalMinutes = 1) {
    if (!points || !points.length) return [];

    let prevClose = null;
    const minuteCandles = points.map((p) => {
        const open = prevClose == null ? p.value : prevClose;
        const close = p.value;
        prevClose = close;
        return {
            time: p.time,
            open,
            high: Math.max(open, close),
            low: Math.min(open, close),
            close,
            volume: p.oi || 0,
        };
    });

    if (intervalMinutes === 1) return minuteCandles;

    const intervalSeconds = intervalMinutes * 60;
    const grouped = new Map();

    for (const c of minuteCandles) {
        const bucketTime = Math.floor(c.time / intervalSeconds) * intervalSeconds;
        const g = grouped.get(bucketTime);
        if (!g) {
            grouped.set(bucketTime, {
                time: bucketTime,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume || 0,
            });
        } else {
            g.high = Math.max(g.high, c.high);
            g.low = Math.min(g.low, c.low);
            g.close = c.close;
            g.volume += c.volume || 0;
        }
    }
    return [...grouped.values()].sort((a, b) => a.time - b.time);
}

function formatIsoTime(epochSec) {
    const d = new Date(epochSec * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function ContractChartModal({
    symbol,
    strike,
    expiry,
    right,
    onClose,
    onAddLeg = null,
}) {
    const { isDark } = useTheme();
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const priceSeriesRef = useRef(null);
    const overlaysRef = useRef([]);
    const pendingPointRef = useRef(null);

    const [points, setPoints] = useState(null);
    const [error, setError] = useState(null);
    const [open, setOpen] = useState(false);

    // Chart Controls
    const [chartStyle, setChartStyle] = useState("candles");
    const [chartStyleOpen, setChartStyleOpen] = useState(false);
    const [timeframe, setTimeframe] = useState(1); // 1, 3, 5, 15
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({
        ema9: false,
        ema21: true,
        sma50: false,
        bollinger: false,
    });
    const [showOiVolume, setShowOiVolume] = useState(true);
    const [activeTool, setActiveTool] = useState(null);
    const [drawingsVisible, setDrawingsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hover, setHover] = useState(null);

    // Slide up on mount, slide down before closing
    useEffect(() => {
        const raf = requestAnimationFrame(() => setOpen(true));
        return () => cancelAnimationFrame(raf);
    }, []);

    function handleClose() {
        setOpen(false);
        setTimeout(onClose, 200);
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

    const candles = useMemo(() => {
        const base = aggregateContractCandles(points, timeframe);
        return chartStyle === "heikinashi" ? toHeikinAshi(base) : base;
    }, [points, timeframe, chartStyle]);

    // Build Chart using Lightweight Charts
    useEffect(() => {
        if (!candles || candles.length === 0 || !containerRef.current) return;
        const t = isDark ? THEMES.dark : THEMES.light;

        // Clean container before re-mounting
        containerRef.current.innerHTML = "";

        const chart = createChart(containerRef.current, {
            layout: {
                background: { color: t.bg },
                textColor: t.text,
                fontSize: 11,
            },
            grid: {
                vertLines: { color: t.grid },
                horzLines: { color: t.grid },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: t.border,
                rightOffset: 6,
                fixLeftEdge: true,
            },
            rightPriceScale: {
                borderColor: t.border,
                scaleMargins: {
                    top: 0.08,
                    bottom: showOiVolume ? 0.22 : 0.08,
                },
            },
            crosshair: {
                mode: 1,
            },
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight || 450,
        });

        chartRef.current = chart;
        overlaysRef.current = [];
        pendingPointRef.current = null;

        const ohlc = candles.map((p) => ({
            time: p.time,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
        }));
        const closes = candles.map((p) => p.close);

        let priceSeries;
        if (chartStyle === "line") {
            priceSeries = chart.addSeries(LineSeries, {
                color: "#059669",
                lineWidth: 2,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartStyle === "area") {
            priceSeries = chart.addSeries(AreaSeries, {
                lineColor: "#059669",
                topColor: "rgba(5, 150, 105, 0.28)",
                bottomColor: "rgba(5, 150, 105, 0.01)",
                lineWidth: 2,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartStyle === "bars") {
            priceSeries = chart.addSeries(BarSeries, {
                upColor: UP,
                downColor: DOWN,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc);
        } else if (chartStyle === "hollow") {
            priceSeries = chart.addSeries(CandlestickSeries, {
                upColor: "transparent",
                downColor: DOWN,
                borderVisible: true,
                borderUpColor: UP,
                borderDownColor: DOWN,
                wickUpColor: UP,
                wickDownColor: DOWN,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc);
        } else {
            priceSeries = chart.addSeries(CandlestickSeries, {
                upColor: UP,
                downColor: DOWN,
                borderVisible: false,
                wickUpColor: UP,
                wickDownColor: DOWN,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc);
        }
        priceSeriesRef.current = priceSeries;

        // Overlay Line Helper
        const addLine = (vals, color, width = 1.5, style = LineStyle.Solid) => {
            const s = chart.addSeries(LineSeries, {
                color,
                lineWidth: width,
                lineStyle: style,
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: false,
            });
            s.setData(
                ohlc
                    .map((d, i) => ({ time: d.time, value: vals[i] }))
                    .filter((p) => p.value != null && !isNaN(p.value))
            );
            overlaysRef.current.push({ kind: "series", ref: s, type: "indicator" });
        };

        if (indicators.ema9) addLine(ema(closes, 9), "#06b6d4", 1.5);
        if (indicators.ema21) addLine(ema(closes, 21), "#10b981", 1.5);
        if (indicators.sma50) addLine(sma(closes, 50), "#f59e0b", 1.5);

        if (indicators.bollinger) {
            const { upper, mid, lower } = bollingerBands(closes, 20, 2);
            addLine(upper, "#a855f7", 1, LineStyle.Dashed);
            addLine(mid, "#c084fc", 1);
            addLine(lower, "#a855f7", 1, LineStyle.Dashed);
        }

        // OI / Volume Histogram
        if (showOiVolume && candles.some((c) => c.volume > 0)) {
            const vol = chart.addSeries(
                HistogramSeries,
                {
                    priceFormat: { type: "volume" },
                    priceScaleId: "vol",
                },
                0
            );
            chart.priceScale("vol").applyOptions({
                scaleMargins: { top: 0.82, bottom: 0 },
            });
            vol.setData(
                candles.map((c) => ({
                    time: c.time,
                    value: c.volume,
                    color: c.close >= c.open ? "rgba(5, 150, 105, 0.35)" : "rgba(225, 29, 72, 0.35)",
                }))
            );
        }

        chart.timeScale().fitContent();

        // Crosshair move handler
        const onMove = (param) => {
            const d = param.time != null ? param.seriesData?.get(priceSeries) : null;
            if (!d) {
                setHover(null);
                return;
            }
            if (d.open != null) {
                setHover({
                    o: d.open,
                    h: d.high,
                    l: d.low,
                    c: d.close,
                    time: formatIsoTime(Number(param.time)),
                    up: d.close >= d.open,
                });
            } else {
                setHover({ c: d.value, time: formatIsoTime(Number(param.time)), lineOnly: true });
            }
        };
        chart.subscribeCrosshairMove(onMove);

        // Auto-Resize with ResizeObserver
        const ro = new ResizeObserver(() => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight || 450,
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
    }, [candles, chartStyle, indicators, showOiVolume, isDark]);

    // Drawing tool clicks
    useEffect(() => {
        const chart = chartRef.current;
        const series = priceSeriesRef.current;
        if (!chart || !series || !activeTool || !candles?.length) return;
        const lastTime = candles[candles.length - 1].time;

        function handleClick(param) {
            if (!param.point || param.time == null) return;
            const price = series.coordinateToPrice(param.point.y);
            if (price == null) return;

            if (activeTool === "horizontal") {
                const line = series.createPriceLine({
                    price,
                    color: "#059669",
                    lineWidth: 1.5,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: "KEY LEVEL",
                });
                overlaysRef.current.push({ kind: "priceLine", ref: line });
                return;
            }

            if (activeTool === "trendline" || activeTool === "ray") {
                const first = pendingPointRef.current;
                if (!first) {
                    pendingPointRef.current = { time: param.time, value: price };
                    return;
                }
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
                    color: activeTool === "ray" ? "#06b6d4" : "#059669",
                    lineWidth: 2,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    visible: drawingsVisible,
                });
                s.setData([first, endPoint].sort((a, b) => a.time - b.time));
                overlaysRef.current.push({ kind: "series", ref: s, type: "drawing" });
                pendingPointRef.current = null;
                return;
            }

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
                const endTime = Math.max(lastTime, startTime);

                FIB_LEVELS.forEach((level, i) => {
                    const levelPrice = high - diff * level;
                    const s = chart.addSeries(LineSeries, {
                        color: FIB_COLORS[i % FIB_COLORS.length],
                        lineWidth: 1,
                        lineStyle: LineStyle.Dashed,
                        priceLineVisible: false,
                        lastValueVisible: true,
                        title: `${(level * 100).toFixed(1)}%`,
                        visible: drawingsVisible,
                    });
                    s.setData([
                        { time: startTime, value: levelPrice },
                        { time: endTime, value: levelPrice },
                    ]);
                    overlaysRef.current.push({ kind: "series", ref: s, type: "drawing" });
                });
                pendingPointRef.current = null;
                return;
            }

            if (activeTool === "long_pos" || activeTool === "short_pos") {
                const isLong = activeTool === "long_pos";
                const entry = price;
                const target = isLong ? entry * 1.10 : entry * 0.90;
                const sl = isLong ? entry * 0.93 : entry * 1.07;
                const targetLine = series.createPriceLine({
                    price: target,
                    color: "#059669",
                    lineWidth: 1.5,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "TARGET",
                });
                const slLine = series.createPriceLine({
                    price: sl,
                    color: "#e11d48",
                    lineWidth: 1.5,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "STOP LOSS",
                });
                overlaysRef.current.push({ kind: "priceLine", ref: targetLine });
                overlaysRef.current.push({ kind: "priceLine", ref: slLine });
                setActiveTool(null);
                return;
            }
        }

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [activeTool, candles, drawingsVisible]);

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
        link.download = `${symbol}_${strike}_${right}_${expiry}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }

    // Contract High / Low & Change Stats
    const stats = useMemo(() => {
        if (!points || !points.length) return null;
        const first = points[0].value;
        const last = points[points.length - 1].value;
        const change = last - first;
        const changePct = first > 0 ? (change / first) * 100 : 0;
        let hi = points[0].value;
        let lo = points[0].value;
        let lastOi = points[points.length - 1].oi;

        for (const p of points) {
            if (p.value > hi) hi = p.value;
            if (p.value < lo) lo = p.value;
        }

        return {
            last,
            first,
            change,
            changePct,
            high: hi,
            low: lo,
            oi: lastOi,
            isUp: change >= 0,
        };
    }, [points]);

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/70 backdrop-blur-xs transition-opacity duration-200 ${
                open ? "opacity-100" : "opacity-0"
            }`}
            onClick={handleClose}
        >
            <div
                className={`w-full transition-all duration-200 ease-out rounded-3xl bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col overflow-hidden ${
                    isFullscreen ? "max-w-[99vw] h-[98vh]" : "max-w-[98vw] lg:max-w-[96vw] h-[88vh]"
                } ${
                    open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
                }`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* 1. TOP HEADER: Contract Details, Live Stats & 1-Click Action Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50/90 px-4 py-3 dark:border-gray-800 dark:bg-[#0f172a]/90 backdrop-blur-sm">
                    {/* Left: Strike Badge & Price Metrics */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <span
                            className={`rounded-xl px-3 py-1 text-xs font-black tracking-wide border shadow-xs ${
                                right === "CE"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                                    : "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                            }`}
                        >
                            {symbol} {strike} {right}
                        </span>

                        {stats && (
                            <div className="flex items-baseline gap-2">
                                <span className="text-base sm:text-xl font-black font-mono tabular-nums text-gray-900 dark:text-white">
                                    {formatPrice(stats.last)}
                                </span>
                                <span
                                    className={`text-xs font-bold tabular-nums ${
                                        stats.isUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                    }`}
                                >
                                    {stats.isUp ? "▲ +" : "▼ "}{formatPrice(Math.abs(stats.change))} ({formatPercent(stats.changePct)})
                                </span>
                            </div>
                        )}

                        <span className="hidden md:inline text-xs text-gray-400 dark:text-gray-500">|</span>

                        {stats && (
                            <div className="hidden lg:flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                <span>H: <strong className="text-emerald-600 font-semibold">{formatPrice(stats.high)}</strong></span>
                                <span>L: <strong className="text-rose-600 font-semibold">{formatPrice(stats.low)}</strong></span>
                                {stats.oi != null && <span>OI: <strong className="text-gray-800 dark:text-gray-200 font-semibold">{Number(stats.oi).toLocaleString("en-IN")}</strong></span>}
                            </div>
                        )}

                        <span className="rounded-lg bg-gray-200/70 px-2 py-0.5 text-[10px] font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                            Exp: {expiry}
                        </span>
                    </div>

                    {/* Right: Add Leg Actions (Simulator Integration) + Close */}
                    <div className="flex items-center gap-2">
                        {onAddLeg && (
                            <div className="flex items-center gap-1.5 mr-2">
                                <button
                                    onClick={() => onAddLeg("buy")}
                                    className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700 shadow-xs transition"
                                >
                                    <FiPlus size={14} />
                                    <span>Buy Leg</span>
                                </button>
                                <button
                                    onClick={() => onAddLeg("sell")}
                                    className="flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-black text-white hover:bg-rose-700 shadow-xs transition"
                                >
                                    <FiMinus size={14} />
                                    <span>Sell Leg</span>
                                </button>
                            </div>
                        )}

                        <button
                            onClick={handleClose}
                            className="rounded-xl border border-gray-200 bg-white p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 shadow-xs transition"
                            title="Close Chart"
                        >
                            <FiX size={18} />
                        </button>
                    </div>
                </div>

                {/* 2. SUB TOOLBAR: Timeframes, Chart Style, Indicators, Tools & Screenshot */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-white px-3 py-1.5 text-xs dark:border-gray-800 dark:bg-[#0b1420]">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Timeframe aggregation pills */}
                        <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
                            {TIMEFRAMES.map((tf) => (
                                <button
                                    key={tf.value}
                                    onClick={() => setTimeframe(tf.value)}
                                    className={`rounded-md px-2 py-0.5 text-xs font-bold transition ${
                                        timeframe === tf.value
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
                                    }`}
                                >
                                    {tf.label}
                                </button>
                            ))}
                        </div>

                        {/* Chart Style Selector */}
                        <div className="relative">
                            <button
                                onClick={() => setChartStyleOpen(!chartStyleOpen)}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-bold text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                                <FiTrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                                <span>{CHART_STYLES.find((c) => c.key === chartStyle)?.label || "Candles"}</span>
                            </button>
                            {chartStyleOpen && (
                                <div className="absolute left-0 top-full z-30 mt-1 min-w-[130px] rounded-xl border border-gray-200 bg-white p-1 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                                    {CHART_STYLES.map((cs) => (
                                        <button
                                            key={cs.key}
                                            onClick={() => {
                                                setChartStyle(cs.key);
                                                setChartStyleOpen(false);
                                            }}
                                            className={`flex w-full items-center rounded-lg px-2.5 py-1 text-xs font-semibold ${
                                                chartStyle === cs.key
                                                    ? "bg-emerald-600 text-white"
                                                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                                            }`}
                                        >
                                            {cs.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Indicators Popover */}
                        <div className="relative">
                            <button
                                onClick={() => setIndicatorsOpen(!indicatorsOpen)}
                                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-bold text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                                <FiSliders className="h-3.5 w-3.5 text-emerald-600" />
                                <span>Indicators</span>
                            </button>
                            {indicatorsOpen && (
                                <div className="absolute left-0 top-full z-30 mt-1 min-w-[170px] rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                                    {[
                                        { key: "ema9", label: "EMA (9)" },
                                        { key: "ema21", label: "EMA (21)" },
                                        { key: "sma50", label: "SMA (50)" },
                                        { key: "bollinger", label: "Bollinger (20,2)" },
                                    ].map((ind) => (
                                        <label
                                            key={ind.key}
                                            className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                                        >
                                            <span>{ind.label}</span>
                                            <input
                                                type="checkbox"
                                                checked={!!indicators[ind.key]}
                                                onChange={(e) =>
                                                    setIndicators({ ...indicators, [ind.key]: e.target.checked })
                                                }
                                                className="accent-emerald-600"
                                            />
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Volume/OI Toggle */}
                        <button
                            onClick={() => setShowOiVolume(!showOiVolume)}
                            className={`rounded-lg border px-2.5 py-1 font-bold transition ${
                                showOiVolume
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
                                    : "border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                        >
                            <span>OI Volume</span>
                        </button>
                    </div>

                    {/* Right Tools: Screenshot & Fullscreen */}
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={takeScreenshot}
                            className="rounded-lg border border-gray-200 bg-white p-1 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 shadow-xs transition"
                            title="Take Screenshot"
                        >
                            <FiCamera size={14} />
                        </button>
                        <button
                            onClick={() => setIsFullscreen((v) => !v)}
                            className="rounded-lg border border-gray-200 bg-white p-1 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 shadow-xs transition"
                            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        >
                            {isFullscreen ? <FiMinimize size={14} /> : <FiMaximize size={14} />}
                        </button>
                    </div>
                </div>

                {/* 3. MAIN CHART BODY + LEFT DRAWING RAIL */}
                <div className="flex flex-1 w-full overflow-hidden p-2 gap-2 bg-white dark:bg-[#0b1420]">
                    {/* Left Drawing Tools Rail */}
                    <div className="flex shrink-0 flex-col gap-1 rounded-xl border border-gray-100 bg-gray-50/70 p-1 dark:border-gray-800 dark:bg-gray-900/50">
                        {DRAWING_TOOLS.map((tool) => (
                            <button
                                key={tool.key}
                                onClick={() => setActiveTool((t) => (t === tool.key ? null : tool.key))}
                                title={tool.label}
                                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-[11px] font-bold transition-all ${
                                    activeTool === tool.key
                                        ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                                        : "border-gray-200 bg-white text-gray-700 hover:border-emerald-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                }`}
                            >
                                <span>{tool.icon}</span>
                            </button>
                        ))}

                        <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                        <button
                            onClick={toggleDrawingsVisible}
                            title={drawingsVisible ? "Hide Drawings" : "Show Drawings"}
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        >
                            {drawingsVisible ? <FiEye size={12} /> : <FiEyeOff size={12} className="text-gray-400" />}
                        </button>

                        <button
                            onClick={clearDrawings}
                            title="Clear All Drawings"
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-gray-800 dark:text-rose-400"
                        >
                            <FiTrash2 size={12} />
                        </button>
                    </div>

                    {/* Chart Container Area */}
                    <div className="relative flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-inner dark:border-gray-800 dark:bg-[#0b1420]">
                        {/* Live Crosshair OHLC Legend */}
                        {hover && (
                            <div className="absolute left-3 top-2.5 z-20 flex flex-wrap items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-xs backdrop-blur-xs dark:bg-gray-900/90 dark:text-gray-200">
                                <span className="font-bold text-gray-900 dark:text-white">{hover.time}</span>
                                <span className="text-gray-400">|</span>
                                <span>O: <strong className="text-gray-900 dark:text-white">{formatPrice(hover.o)}</strong></span>
                                <span>H: <strong className="text-emerald-600">{formatPrice(hover.h)}</strong></span>
                                <span>L: <strong className="text-rose-600">{formatPrice(hover.l)}</strong></span>
                                <span>C: <strong className={hover.up ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>{formatPrice(hover.c)}</strong></span>
                            </div>
                        )}

                        {error && (
                            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-rose-500">
                                Failed to load strike chart: {error}
                            </div>
                        )}
                        {!error && !points && (
                            <div className="flex h-full items-center justify-center gap-2 text-xs text-gray-400 animate-pulse">
                                <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                                <span>Loading tick-by-tick option candles…</span>
                            </div>
                        )}
                        {!error && points && points.length === 0 && (
                            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-gray-400">
                                No price history recorded for this contract yet.
                            </div>
                        )}

                        <div
                            ref={containerRef}
                            className={`h-full w-full ${points && points.length > 0 ? "" : "hidden"}`}
                        />
                    </div>
                </div>

                {/* 4. FOOTER NOTE */}
                <div className="border-t border-gray-200 bg-gray-50/80 px-4 py-2 flex items-center justify-between text-[11px] text-gray-500 dark:border-gray-800 dark:bg-[#0f172a]/80 dark:text-gray-400">
                    <span>
                        Tick-level per-minute LTP snapshots synthesized with real Open, High, Low, Close & OI stream.
                    </span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {symbol} · NSE F&O Matrix
                    </span>
                </div>
            </div>
        </div>
    );
}
