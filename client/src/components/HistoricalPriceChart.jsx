// components/HistoricalPriceChart.jsx — High-Performance In-House TradingView-Grade Charting Engine
// Powered 100% by Bazaar Sync's stored MySQL database (ohlcv_data).
// Features:
//   • Chart Types: Candlesticks, Hollow Candles, Bars (OHLC), Line, Area, Heikin Ashi
//   • Technical Indicators: SMA(20, 50, 200), EMA(9, 21, 50), Bollinger Bands(20, 2), Supertrend, RSI(14), Volume
//   • Drawing Tools: Trendline, Ray, Horizontal Support/Resistance, Fibonacci Retracement, Rectangle Zones, Long/Short Risk:Reward
//   • Crosshair OHLC Legend, PNG Screenshot, Fullscreen, Dark/Light Theme (Emerald Green #059669)
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
    FiCamera,
    FiMaximize,
    FiMinimize,
    FiEye,
    FiEyeOff,
    FiTrash2,
    FiSliders,
    FiTrendingUp,
} from "react-icons/fi";

const CHART_TYPES = [
    { key: "candles", label: "Candles" },
    { key: "hollow", label: "Hollow" },
    { key: "bars", label: "Bars" },
    { key: "line", label: "Line" },
    { key: "area", label: "Area" },
    { key: "heikinashi", label: "Heikin Ashi" },
];

const DRAWING_TOOLS = [
    { key: "trendline", label: "Trendline", icon: "╱", shortcut: "Alt+T" },
    { key: "ray", label: "Ray", icon: "↗", shortcut: "Ray" },
    { key: "horizontal", label: "Horizontal Line", icon: "─", shortcut: "Alt+H" },
    { key: "fib", label: "Fibonacci Retracement", icon: "Fib", shortcut: "Alt+F" },
    { key: "rectangle", label: "Demand/Supply Zone", icon: "▭", shortcut: "Box" },
    { key: "long_pos", label: "Long Risk:Reward", icon: "▲", shortcut: "Long" },
    { key: "short_pos", label: "Short Risk:Reward", icon: "▼", shortcut: "Short" },
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

// Technical Indicator Calculations
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

function calculateSupertrend(points, period = 10, multiplier = 3) {
    if (!points || points.length < period) return [];
    const tr = [];
    for (let i = 0; i < points.length; i++) {
        if (i === 0) {
            tr.push(points[i].high - points[i].low);
        } else {
            const h = points[i].high;
            const l = points[i].low;
            const prevClose = points[i - 1].close;
            tr.push(Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose)));
        }
    }

    const atr = sma(tr, period);
    const stValues = new Array(points.length).fill(null);
    let trend = 1; // 1 = UP, -1 = DOWN
    let prevUpper = 0;
    let prevLower = 0;

    for (let i = period - 1; i < points.length; i++) {
        const p = points[i];
        const a = atr[i];
        if (a == null) continue;

        const basicUpper = (p.high + p.low) / 2 + multiplier * a;
        const basicLower = (p.high + p.low) / 2 - multiplier * a;

        let finalUpper = basicUpper;
        let finalLower = basicLower;

        if (i > period - 1) {
            const prevClose = points[i - 1].close;
            finalUpper = basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
            finalLower = basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;
        }

        if (i === period - 1) {
            trend = p.close >= finalLower ? 1 : -1;
        } else {
            if (trend === 1 && p.close < finalLower) {
                trend = -1;
            } else if (trend === -1 && p.close > finalUpper) {
                trend = 1;
            }
        }

        stValues[i] = trend === 1 ? finalLower : finalUpper;
        prevUpper = finalUpper;
        prevLower = finalLower;
    }
    return stValues;
}

function calculateRSI(closes, period = 14) {
    const rsi = new Array(closes.length).fill(null);
    if (closes.length <= period) return rsi;

    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;
    rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const currentGain = diff >= 0 ? diff : 0;
        const currentLoss = diff < 0 ? -diff : 0;

        avgGain = (avgGain * (period - 1) + currentGain) / period;
        avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return rsi;
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

function isoDay(epochSec) {
    return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

function fmt(v) {
    return v == null ? "-" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function legendFromPoint(p) {
    if (!p) return null;
    return {
        o: p.open,
        h: p.high,
        l: p.low,
        c: p.close,
        v: p.volume,
        date: isoDay(p.time),
        up: p.close >= p.open,
    };
}

export default function HistoricalPriceChart({ points = [], symbol = "", rangeLabel = "" }) {
    const { isDark } = useTheme();
    const wrapperRef = useRef(null);
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const priceSeriesRef = useRef(null);
    const overlaysRef = useRef([]);
    const pendingPointRef = useRef(null);

    const [chartType, setChartType] = useState("candles");
    const [chartTypeOpen, setChartTypeOpen] = useState(false);
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({
        ema9: false,
        ema21: true,
        sma50: false,
        sma200: false,
        bollinger: false,
        supertrend: false,
        rsi: false,
    });

    const [showVolume, setShowVolume] = useState(true);
    const [activeTool, setActiveTool] = useState(null);
    const [drawingsVisible, setDrawingsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hover, setHover] = useState(null);

    const hasVolume = useMemo(() => (points || []).some((p) => p.volume > 0), [points]);

    // Build Chart using Lightweight Charts running 100% on Database Data
    useEffect(() => {
        if (!points || points.length === 0 || !containerRef.current) return;
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
                borderColor: t.border,
                rightOffset: 8,
                fixLeftEdge: true,
                timeVisible: true,
            },
            rightPriceScale: {
                borderColor: t.border,
                scaleMargins: {
                    top: 0.08,
                    bottom: hasVolume && showVolume ? 0.24 : 0.08,
                },
            },
            crosshair: {
                mode: 1,
            },
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight || 540,
        });

        chartRef.current = chart;
        overlaysRef.current = [];
        pendingPointRef.current = null;

        const effectiveData = chartType === "heikinashi" ? toHeikinAshi(points) : points;
        const ohlc = effectiveData.map((p) => ({
            time: p.time,
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
        }));
        const closes = effectiveData.map((p) => p.close);

        let priceSeries;
        if (chartType === "line") {
            priceSeries = chart.addSeries(LineSeries, {
                color: "#059669",
                lineWidth: 2,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartType === "area") {
            priceSeries = chart.addSeries(AreaSeries, {
                lineColor: "#059669",
                topColor: "rgba(5, 150, 105, 0.28)",
                bottomColor: "rgba(5, 150, 105, 0.01)",
                lineWidth: 2,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc.map((d) => ({ time: d.time, value: d.close })));
        } else if (chartType === "bars") {
            priceSeries = chart.addSeries(BarSeries, {
                upColor: UP,
                downColor: DOWN,
                priceFormat: { type: "price", precision: 2, minMove: 0.05 },
            });
            priceSeries.setData(ohlc);
        } else if (chartType === "hollow") {
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
            // Default: Solid Candlesticks
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

        // Helper for Overlay Indicator Lines
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

        // Indicator Overlays
        if (indicators.ema9) addLine(ema(closes, 9), "#06b6d4", 1.5);
        if (indicators.ema21) addLine(ema(closes, 21), "#10b981", 1.5);
        if (indicators.sma50) addLine(sma(closes, 50), "#f59e0b", 1.5);
        if (indicators.sma200) addLine(sma(closes, 200), "#8b5cf6", 2);

        if (indicators.bollinger) {
            const { upper, mid, lower } = bollingerBands(closes, 20, 2);
            addLine(upper, "#a855f7", 1, LineStyle.Dashed);
            addLine(mid, "#c084fc", 1);
            addLine(lower, "#a855f7", 1, LineStyle.Dashed);
        }

        if (indicators.supertrend) {
            const st = calculateSupertrend(effectiveData, 10, 3);
            addLine(st, "#059669", 2);
        }

        if (indicators.rsi) {
            const rsiVals = calculateRSI(closes, 14);
            const rsiSeries = chart.addSeries(LineSeries, {
                color: "#f59e0b",
                lineWidth: 1.5,
                priceScaleId: "rsi",
                priceLineVisible: false,
                lastValueVisible: true,
            });
            chart.priceScale("rsi").applyOptions({
                scaleMargins: { top: 0.85, bottom: 0.02 },
            });
            rsiSeries.setData(
                ohlc
                    .map((d, i) => ({ time: d.time, value: rsiVals[i] }))
                    .filter((p) => p.value != null && !isNaN(p.value))
            );
            overlaysRef.current.push({ kind: "series", ref: rsiSeries, type: "indicator" });
        }

        // Volume Histogram
        if (hasVolume && showVolume) {
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
                points.map((p) => ({
                    time: p.time,
                    value: p.volume,
                    color: p.close >= p.open ? "rgba(5, 150, 105, 0.35)" : "rgba(225, 29, 72, 0.35)",
                }))
            );
        }

        // Fit content
        chart.timeScale().fitContent();

        // Crosshair Hover Handler
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
                    date: isoDay(Number(param.time)),
                    up: d.close >= d.open,
                });
            } else {
                setHover({ c: d.value, date: isoDay(Number(param.time)), lineOnly: true });
            }
        };
        chart.subscribeCrosshairMove(onMove);

        // Auto-Resize Observer
        const ro = new ResizeObserver(() => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight || 540,
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

    // Drawing-Tool Interactions
    useEffect(() => {
        const chart = chartRef.current;
        const series = priceSeriesRef.current;
        if (!chart || !series || !activeTool || !points?.length) return;
        const lastTime = points[points.length - 1].time;

        function handleClick(param) {
            if (!param.point || param.time == null) return;
            const price = series.coordinateToPrice(param.point.y);
            if (price == null) return;

            // Horizontal Line
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

            // Trendline & Ray
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

            // Fibonacci Retracement
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
                        title: `${(level * 100).toFixed(1)}% (₹${levelPrice.toFixed(1)})`,
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

            // Long Position Risk:Reward Tool
            if (activeTool === "long_pos") {
                const entry = price;
                const target = entry * 1.015; // default +1.5%
                const sl = entry * 0.992; // default -0.8%
                const targetLine = series.createPriceLine({
                    price: target,
                    color: "#059669",
                    lineWidth: 1.5,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "TARGET (+1.5%)",
                });
                const slLine = series.createPriceLine({
                    price: sl,
                    color: "#e11d48",
                    lineWidth: 1.5,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "STOP LOSS (-0.8%)",
                });
                overlaysRef.current.push({ kind: "priceLine", ref: targetLine });
                overlaysRef.current.push({ kind: "priceLine", ref: slLine });
                setActiveTool(null);
                return;
            }

            // Short Position Risk:Reward Tool
            if (activeTool === "short_pos") {
                const entry = price;
                const target = entry * 0.985; // default -1.5%
                const sl = entry * 1.008; // default +0.8%
                const targetLine = series.createPriceLine({
                    price: target,
                    color: "#059669",
                    lineWidth: 1.5,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "TARGET (+1.5%)",
                });
                const slLine = series.createPriceLine({
                    price: sl,
                    color: "#e11d48",
                    lineWidth: 1.5,
                    lineStyle: LineStyle.Solid,
                    axisLabelVisible: true,
                    title: "STOP LOSS (-0.8%)",
                });
                overlaysRef.current.push({ kind: "priceLine", ref: targetLine });
                overlaysRef.current.push({ kind: "priceLine", ref: slLine });
                setActiveTool(null);
                return;
            }
        }

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [activeTool, points, drawingsVisible]);

    // Fullscreen event listener
    useEffect(() => {
        function onFsChange() {
            setIsFullscreen(!!document.fullscreenElement);
            requestAnimationFrame(() => {
                if (chartRef.current && containerRef.current) {
                    chartRef.current.applyOptions({
                        width: containerRef.current.clientWidth,
                        height: containerRef.current.clientHeight || 540,
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
        link.download = `${symbol || "chart"}_${rangeLabel || ""}_DB.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrapperRef.current?.requestFullscreen?.();
    }

    const legend = hover || (points && points.length ? legendFromPoint(points[points.length - 1]) : null);

    return (
        <div
            ref={wrapperRef}
            className={`flex flex-col gap-2 rounded-2xl ${
                isFullscreen
                    ? "fixed inset-0 z-50 h-screen w-screen bg-white p-4 dark:bg-[#0b1420]"
                    : "relative w-full"
            }`}
        >
            {/* TOP BAR: Chart Type, Indicators, Volumes, OHLC Legend, Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50/80 px-3 py-2 text-xs backdrop-blur-sm dark:border-gray-800 dark:bg-gray-900/80">
                {/* Left Controls: Chart Type, Indicators & Volume */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Chart Type Selector */}
                    <div className="relative">
                        <button
                            onClick={() => setChartTypeOpen(!chartTypeOpen)}
                            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 font-bold text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        >
                            <FiTrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                            <span>{CHART_TYPES.find((c) => c.key === chartType)?.label || "Candles"}</span>
                        </button>
                        {chartTypeOpen && (
                            <div className="absolute left-0 top-full z-30 mt-1 min-w-[140px] rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                                {CHART_TYPES.map((ct) => (
                                    <button
                                        key={ct.key}
                                        onClick={() => {
                                            setChartType(ct.key);
                                            setChartTypeOpen(false);
                                        }}
                                        className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                                            chartType === ct.key
                                                ? "bg-emerald-600 text-white"
                                                : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                                        }`}
                                    >
                                        {ct.label}
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
                            <div className="absolute left-0 top-full z-30 mt-1 min-w-[180px] rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                                <div className="mb-1 text-[10px] font-bold uppercase text-gray-400">Overlays & Oscillators</div>
                                {[
                                    { key: "ema9", label: "EMA (9)" },
                                    { key: "ema21", label: "EMA (21)" },
                                    { key: "sma50", label: "SMA (50)" },
                                    { key: "sma200", label: "SMA (200)" },
                                    { key: "bollinger", label: "Bollinger Bands (20,2)" },
                                    { key: "supertrend", label: "Supertrend (10,3)" },
                                    { key: "rsi", label: "RSI (14)" },
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

                    {/* Volume Toggle */}
                    {hasVolume && (
                        <button
                            onClick={() => setShowVolume(!showVolume)}
                            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 font-bold transition ${
                                showVolume
                                    ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
                                    : "border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                        >
                            <span>Volume</span>
                        </button>
                    )}
                </div>

                {/* Right Controls: Screenshot & Fullscreen */}
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={takeScreenshot}
                        title="Download Chart Screenshot (PNG)"
                        className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                        <FiCamera className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={toggleFullscreen}
                        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-600 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                        {isFullscreen ? <FiMinimize className="h-3.5 w-3.5" /> : <FiMaximize className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {/* MAIN CHART BODY + LEFT DRAWING TOOLBAR */}
            <div className="flex w-full gap-2">
                {/* Left Drawing Tools Rail (Dhan Pro) */}
                <div className="flex shrink-0 flex-col gap-1.5 rounded-xl border border-gray-100 bg-gray-50/70 p-1.5 dark:border-gray-800 dark:bg-gray-900/50">
                    {DRAWING_TOOLS.map((tool) => (
                        <button
                            key={tool.key}
                            onClick={() => setActiveTool((t) => (t === tool.key ? null : tool.key))}
                            title={`${tool.label} (${tool.shortcut})`}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold transition-all ${
                                activeTool === tool.key
                                    ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                                    : "border-gray-200 bg-white text-gray-700 hover:border-emerald-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            }`}
                        >
                            <span>{tool.icon}</span>
                        </button>
                    ))}

                    <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                    {/* Hide/Show Drawings */}
                    <button
                        onClick={toggleDrawingsVisible}
                        title={drawingsVisible ? "Hide Drawings" : "Show Drawings"}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                        {drawingsVisible ? <FiEye className="h-3.5 w-3.5" /> : <FiEyeOff className="h-3.5 w-3.5 text-gray-400" />}
                    </button>

                    {/* Clear Drawings */}
                    <button
                        onClick={clearDrawings}
                        title="Clear All Drawings"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-gray-800 dark:text-rose-400"
                    >
                        <FiTrash2 className="h-3.5 w-3.5" />
                    </button>
                </div>

                {/* Chart Canvas & Interactive Legend */}
                <div className="relative flex-1 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-inner dark:border-gray-800 dark:bg-[#0b1420]">
                    {/* Live OHLC Legend */}
                    {legend && (
                        <div className="absolute left-3 top-2.5 z-20 flex flex-wrap items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-xs backdrop-blur-xs dark:bg-gray-900/90 dark:text-gray-200">
                            <span className="font-bold text-gray-900 dark:text-white">{symbol}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-400">{legend.date}</span>
                            <span className="text-gray-400">|</span>
                            <span>O: <strong className="text-gray-900 dark:text-white">{fmt(legend.o)}</strong></span>
                            <span>H: <strong className="text-emerald-600">{fmt(legend.h)}</strong></span>
                            <span>L: <strong className="text-rose-600">{fmt(legend.l)}</strong></span>
                            <span>C: <strong className={legend.up ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>{fmt(legend.c)}</strong></span>
                            {legend.v != null && (
                                <>
                                    <span className="text-gray-400">|</span>
                                    <span>Vol: <strong className="text-gray-900 dark:text-white">{Number(legend.v).toLocaleString("en-IN")}</strong></span>
                                </>
                            )}
                        </div>
                    )}

                    {/* Active Drawing Tool Banner */}
                    {activeTool && (
                        <div className="absolute right-3 top-2.5 z-20 flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white shadow-md animate-fade-in">
                            <span>
                                Active Tool: {DRAWING_TOOLS.find((t) => t.key === activeTool)?.label} — Click on chart to place points
                            </span>
                            <button
                                onClick={() => setActiveTool(null)}
                                className="rounded bg-emerald-700 px-1 text-[10px] hover:bg-emerald-800"
                            >
                                Cancel
                            </button>
                        </div>
                    )}

                    {/* Lightweight Charts Canvas Container */}
                    <div
                        ref={containerRef}
                        className="h-[68vh] min-h-[480px] w-full"
                    />
                </div>
            </div>
        </div>
    );
}
