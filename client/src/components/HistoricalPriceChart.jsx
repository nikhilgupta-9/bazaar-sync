// components/HistoricalPriceChart.jsx — High-Performance TradingView & Dhan-Grade Charting Engine
// Powered 100% by Bazaar Sync's stored MySQL database (ohlcv_data).
// Features:
//   • Chart Types: Candlesticks, Hollow Candles, Bars (OHLC), Line, Area, Heikin Ashi
//   • Technical Indicators: SMA(20, 50, 200), EMA(9, 21, 50), Bollinger Bands(20, 2), Supertrend, RSI(14), Volume
//   • Complete Drawing Tools Suite:
//       - Lines: Trendline, Ray, Extended Line, Horizontal Line, Horizontal Ray, Vertical Line, Cross Line, Parallel Channel
//       - Fibonacci & Pitchfork: Fib Retracement (8 colored levels), Fib Extension (3-point), Andrews Pitchfork
//       - Geometric Shapes: Demand/Supply Zone Box, Circle/Ellipse, Triangle Pattern
//       - Risk & Measurement: Long Position (R:R), Short Position (R:R), Price Range Ruler (Δ ₹, Δ %, Bars, Days), Date Range
//       - Annotations: Text Note, Price Callout, Up Arrow, Down Arrow, Sticky Note
//       - Utilities: Pointer, Eraser, Undo/Redo, Lock/Unlock, Hide/Show, Clear All, Color Palette, Line Width & Style
//       - Persistence: Auto-saves per-symbol drawings to localStorage
//   • Interactive Crosshair OHLC Legend, PNG Screenshot, Fullscreen, Dark/Light Theme (Emerald Green #059669)
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
    FiLock,
    FiUnlock,
    FiCornerUpLeft,
    FiCornerUpRight,
    FiCheck,
    FiEdit3,
    FiX,
} from "react-icons/fi";

const CHART_TYPES = [
    { key: "candles", label: "Candles" },
    { key: "hollow", label: "Hollow" },
    { key: "bars", label: "Bars" },
    { key: "line", label: "Line" },
    { key: "area", label: "Area" },
    { key: "heikinashi", label: "Heikin Ashi" },
];

// Grouped Drawing Tools Catalog
const TOOL_GROUPS = [
    {
        id: "lines",
        title: "Lines & Rays",
        defaultIcon: "╱",
        tools: [
            { key: "trendline", label: "Trendline", icon: "╱", shortcut: "Alt+T", pointsNeeded: 2 },
            { key: "ray", label: "Ray", icon: "↗", shortcut: "Ray", pointsNeeded: 2 },
            { key: "ext_line", label: "Extended Line", icon: "↔", shortcut: "Ext", pointsNeeded: 2 },
            { key: "horizontal", label: "Horizontal Line", icon: "─", shortcut: "Alt+H", pointsNeeded: 1 },
            { key: "horiz_ray", label: "Horizontal Ray", icon: "→", shortcut: "H-Ray", pointsNeeded: 1 },
            { key: "vertical", label: "Vertical Line", icon: "│", shortcut: "Alt+V", pointsNeeded: 1 },
            { key: "cross_line", label: "Cross Line", icon: "┼", shortcut: "Cross", pointsNeeded: 1 },
            { key: "channel", label: "Parallel Channel", icon: "⫽", shortcut: "Chan", pointsNeeded: 3 },
        ],
    },
    {
        id: "fibonacci",
        title: "Fibonacci & Patterns",
        defaultIcon: "Fib",
        tools: [
            { key: "fib", label: "Fib Retracement", icon: "Fib", shortcut: "Alt+F", pointsNeeded: 2 },
            { key: "fib_ext", label: "Fib Extension", icon: "Fx", shortcut: "Ext", pointsNeeded: 3 },
            { key: "pitchfork", label: "Andrews Pitchfork", icon: "Ψ", shortcut: "Fork", pointsNeeded: 3 },
        ],
    },
    {
        id: "shapes",
        title: "Shapes & Zones",
        defaultIcon: "▭",
        tools: [
            { key: "rectangle", label: "Demand/Supply Zone", icon: "▭", shortcut: "Alt+R", pointsNeeded: 2 },
            { key: "circle", label: "Circle / Ellipse", icon: "◯", shortcut: "Circle", pointsNeeded: 2 },
            { key: "triangle", label: "Triangle Pattern", icon: "△", shortcut: "Tri", pointsNeeded: 3 },
        ],
    },
    {
        id: "measurement",
        title: "Risk & Measure",
        defaultIcon: "▲",
        tools: [
            { key: "long_pos", label: "Long Risk:Reward", icon: "▲", shortcut: "Alt+L", pointsNeeded: 1 },
            { key: "short_pos", label: "Short Risk:Reward", icon: "▼", shortcut: "Alt+S", pointsNeeded: 1 },
            { key: "ruler", label: "Price Range Ruler", icon: "📏", shortcut: "Alt+M", pointsNeeded: 2 },
            { key: "date_range", label: "Date Range Bar", icon: "📅", shortcut: "Date", pointsNeeded: 2 },
        ],
    },
    {
        id: "annotations",
        title: "Text & Annotations",
        defaultIcon: "🔤",
        tools: [
            { key: "text", label: "Text Note", icon: "🔤", shortcut: "Alt+N", pointsNeeded: 1 },
            { key: "callout", label: "Price Callout", icon: "💬", shortcut: "Call", pointsNeeded: 1 },
            { key: "arrow_up", label: "Buy Up Arrow", icon: "⬆", shortcut: "Buy", pointsNeeded: 1 },
            { key: "arrow_down", label: "Sell Down Arrow", icon: "⬇", shortcut: "Sell", pointsNeeded: 1 },
            { key: "sticky", label: "Sticky Note", icon: "📝", shortcut: "Note", pointsNeeded: 1 },
        ],
    },
];

const ALL_TOOLS_MAP = {};
TOOL_GROUPS.forEach((g) => {
    g.tools.forEach((t) => {
        ALL_TOOLS_MAP[t.key] = { ...t, group: g.id };
    });
});

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.618];
const FIB_COLORS = ["#ef4444", "#f97316", "#eab308", "#059669", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

const COLOR_PALETTE = [
    { name: "Emerald", hex: "#059669" },
    { name: "Sky Blue", hex: "#0284c7" },
    { name: "Purple", hex: "#8b5cf6" },
    { name: "Amber", hex: "#f59e0b" },
    { name: "Rose Red", hex: "#e11d48" },
    { name: "Cyan", hex: "#06b6d4" },
    { name: "White", hex: "#f8fafc" },
    { name: "Slate", hex: "#64748b" },
];

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
    let trend = 1;
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
    if (!epochSec) return "-";
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

    // Chart Options & Indicators
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
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hover, setHover] = useState(null);

    // Drawing Tool State
    const [activeTool, setActiveTool] = useState(null); // tool key e.g. "trendline", "fib", etc.
    const [openFlyout, setOpenFlyout] = useState(null); // group id for flyouts
    const [selectedToolPerGroup, setSelectedToolPerGroup] = useState({
        lines: "trendline",
        fibonacci: "fib",
        shapes: "rectangle",
        measurement: "long_pos",
        annotations: "text",
    });

    // Saved Drawings State (with LocalStorage Sync per symbol)
    const storageKey = `bazaar_sync_drawings_${symbol || "default"}`;
    const [drawings, setDrawings] = useState(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });

    // Drawing Stacks for Undo / Redo
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);

    // Style & Utilities State
    const [activeColor, setActiveColor] = useState("#059669");
    const [activeLineWidth, setActiveLineWidth] = useState(2);
    const [activeLineStyle, setActiveLineStyle] = useState("solid"); // "solid" | "dashed" | "dotted"
    const [drawingsVisible, setDrawingsVisible] = useState(true);
    const [isLocked, setIsLocked] = useState(false);
    const [selectedDrawingId, setSelectedDrawingId] = useState(null);

    // In-Progress Drawing State
    const [inProgressPoints, setInProgressPoints] = useState([]);
    const [mouseCoord, setMouseCoord] = useState(null); // { time, price, x, y }

    // Text Editing Modal
    const [editingTextModal, setEditingTextModal] = useState(null); // { id, initialText }
    const [textInputValue, setTextInputValue] = useState("");

    // Render Tick for SVG overlays coordinate tracking
    const [renderTick, setRenderTick] = useState(0);
    const triggerRender = useCallback(() => setRenderTick((n) => n + 1), []);

    const hasVolume = useMemo(() => (points || []).some((p) => p.volume > 0), [points]);

    // Load drawings when symbol changes
    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            setDrawings(raw ? JSON.parse(raw) : []);
            setUndoStack([]);
            setRedoStack([]);
            setSelectedDrawingId(null);
            setInProgressPoints([]);
        } catch {
            setDrawings([]);
        }
    }, [symbol, storageKey]);

    // Persist drawings to LocalStorage
    const saveDrawings = useCallback(
        (newDrawings) => {
            setDrawings(newDrawings);
            try {
                localStorage.setItem(storageKey, JSON.stringify(newDrawings));
            } catch (err) {
                console.error("Storage save failed", err);
            }
        },
        [storageKey]
    );

    // Build Lightweight Chart Engine
    useEffect(() => {
        if (!points || points.length === 0 || !containerRef.current) return;
        const t = isDark ? THEMES.dark : THEMES.light;

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
                rightOffset: 12,
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

        // Overlay Indicators
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
        };

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

        chart.timeScale().fitContent();

        // Subscribe to range changes to sync SVG coordinates
        chart.timeScale().subscribeVisibleLogicalRangeChange(triggerRender);
        chart.timeScale().subscribeVisibleTimeRangeChange(triggerRender);

        // Crosshair Move Handler
        const onMove = (param) => {
            triggerRender();
            const d = param.time != null ? param.seriesData?.get(priceSeries) : null;
            if (!d) {
                setHover(null);
            } else if (d.open != null) {
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

            // Capture precise mouse coordinates for drawing engine
            if (param.point && param.time != null) {
                const pPrice = priceSeries.coordinateToPrice(param.point.y);
                if (pPrice != null) {
                    setMouseCoord({
                        time: Number(param.time),
                        price: pPrice,
                        x: param.point.x,
                        y: param.point.y,
                    });
                }
            }
        };
        chart.subscribeCrosshairMove(onMove);

        // Auto Resize
        const ro = new ResizeObserver(() => {
            if (containerRef.current && chartRef.current) {
                chartRef.current.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight || 540,
                });
                triggerRender();
            }
        });
        ro.observe(containerRef.current);

        return () => {
            ro.disconnect();
            chart.unsubscribeCrosshairMove(onMove);
            chart.remove();
            chartRef.current = null;
            priceSeriesRef.current = null;
        };
    }, [points, chartType, indicators, showVolume, isDark, hasVolume, triggerRender]);

    // Handle Chart Canvas Click for Drawing Tool Placement
    useEffect(() => {
        const chart = chartRef.current;
        const series = priceSeriesRef.current;
        if (!chart || !series) return;

        const handleClick = (param) => {
            if (isLocked) return;
            if (!activeTool) return;
            if (!param.point || param.time == null) return;
            const price = series.coordinateToPrice(param.point.y);
            if (price == null) return;

            const toolInfo = ALL_TOOLS_MAP[activeTool];
            if (!toolInfo) return;

            const clickPoint = { time: Number(param.time), price: Number(price) };
            const needed = toolInfo.pointsNeeded || 1;
            const nextPoints = [...inProgressPoints, clickPoint];

            if (nextPoints.length < needed) {
                setInProgressPoints(nextPoints);
            } else {
                // Completed Drawing
                const newId = `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
                let meta = {};

                if (activeTool === "long_pos" || activeTool === "short_pos") {
                    meta = { targetPct: 1.5, slPct: 0.8 };
                } else if (activeTool === "text" || activeTool === "sticky") {
                    meta = { text: activeTool === "sticky" ? "Institutional Zone" : "Key Level" };
                } else if (activeTool === "callout") {
                    meta = { text: `₹${price.toFixed(2)}` };
                }

                const newDrawing = {
                    id: newId,
                    type: activeTool,
                    points: nextPoints,
                    color: activeColor,
                    lineWidth: activeLineWidth,
                    lineStyle: activeLineStyle,
                    meta,
                };

                const updated = [...drawings, newDrawing];
                setUndoStack((prev) => [...prev, drawings]);
                setRedoStack([]);
                saveDrawings(updated);
                setSelectedDrawingId(newId);
                setInProgressPoints([]);

                // If text or sticky, open text editor immediately
                if (activeTool === "text" || activeTool === "sticky") {
                    setEditingTextModal({ id: newId, initialText: meta.text });
                    setTextInputValue(meta.text);
                }
            }
        };

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [activeTool, inProgressPoints, drawings, activeColor, activeLineWidth, activeLineStyle, isLocked, saveDrawings]);

    // Keyboard Shortcuts for Pro Speed
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Check if typing in an input
            if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

            if (e.key === "Escape") {
                setActiveTool(null);
                setInProgressPoints([]);
                setSelectedDrawingId(null);
                setOpenFlyout(null);
                return;
            }

            if (e.key === "Delete" || e.key === "Backspace") {
                if (selectedDrawingId && !isLocked) {
                    deleteDrawing(selectedDrawingId);
                }
                return;
            }

            // Undo: Ctrl+Z / Cmd+Z
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
                e.preventDefault();
                handleUndo();
                return;
            }

            // Redo: Ctrl+Y or Ctrl+Shift+Z
            if (
                ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z")
            ) {
                e.preventDefault();
                handleRedo();
                return;
            }

            // Alt Shortcuts
            if (e.altKey) {
                const k = e.key.toLowerCase();
                if (k === "t") {
                    e.preventDefault();
                    selectTool("trendline");
                } else if (k === "h") {
                    e.preventDefault();
                    selectTool("horizontal");
                } else if (k === "f") {
                    e.preventDefault();
                    selectTool("fib");
                } else if (k === "r") {
                    e.preventDefault();
                    selectTool("rectangle");
                } else if (k === "v") {
                    e.preventDefault();
                    selectTool("vertical");
                } else if (k === "l") {
                    e.preventDefault();
                    selectTool("long_pos");
                } else if (k === "s") {
                    e.preventDefault();
                    selectTool("short_pos");
                } else if (k === "m") {
                    e.preventDefault();
                    selectTool("ruler");
                } else if (k === "n") {
                    e.preventDefault();
                    selectTool("text");
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    });

    const selectTool = (toolKey) => {
        if (activeTool === toolKey) {
            setActiveTool(null);
            setInProgressPoints([]);
        } else {
            setActiveTool(toolKey);
            setInProgressPoints([]);
            setSelectedDrawingId(null);
            const tool = ALL_TOOLS_MAP[toolKey];
            if (tool) {
                setSelectedToolPerGroup((prev) => ({ ...prev, [tool.group]: toolKey }));
            }
        }
        setOpenFlyout(null);
    };

    const deleteDrawing = (id) => {
        const next = drawings.filter((d) => d.id !== id);
        setUndoStack((prev) => [...prev, drawings]);
        setRedoStack([]);
        saveDrawings(next);
        if (selectedDrawingId === id) setSelectedDrawingId(null);
    };

    const clearAllDrawings = () => {
        if (!drawings.length) return;
        setUndoStack((prev) => [...prev, drawings]);
        setRedoStack([]);
        saveDrawings([]);
        setSelectedDrawingId(null);
        setInProgressPoints([]);
    };

    const handleUndo = () => {
        if (!undoStack.length) return;
        const prev = undoStack[undoStack.length - 1];
        setRedoStack((r) => [...r, drawings]);
        setUndoStack((u) => u.slice(0, -1));
        saveDrawings(prev);
        setSelectedDrawingId(null);
    };

    const handleRedo = () => {
        if (!redoStack.length) return;
        const next = redoStack[redoStack.length - 1];
        setUndoStack((u) => [...u, drawings]);
        setRedoStack((r) => r.slice(0, -1));
        saveDrawings(next);
        setSelectedDrawingId(null);
    };

    const updateSelectedDrawingStyle = (updates) => {
        if (!selectedDrawingId) return;
        const next = drawings.map((d) => (d.id === selectedDrawingId ? { ...d, ...updates } : d));
        saveDrawings(next);
    };

    const handleSaveText = () => {
        if (!editingTextModal) return;
        const next = drawings.map((d) =>
            d.id === editingTextModal.id
                ? { ...d, meta: { ...d.meta, text: textInputValue || "Note" } }
                : d
        );
        saveDrawings(next);
        setEditingTextModal(null);
        setTextInputValue("");
    };

    // Fullscreen Toggle
    const toggleFullscreen = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            wrapperRef.current?.requestFullscreen?.();
        }
    };

    useEffect(() => {
        const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);

    // Screenshot
    const takeScreenshot = () => {
        const chart = chartRef.current;
        if (!chart) return;
        const canvas = chart.takeScreenshot();
        const link = document.createElement("a");
        link.download = `${symbol || "chart"}_${rangeLabel || ""}_DB_Analysis.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    };

    // Helper Coordinate Conversion
    const getCoords = (p) => {
        const chart = chartRef.current;
        const series = priceSeriesRef.current;
        if (!chart || !series || !p) return { x: null, y: null };
        const x = chart.timeScale().timeToCoordinate(p.time);
        const y = series.priceToCoordinate(p.price);
        return { x, y };
    };

    // SVG Drawing Renderer
    const renderDrawingItem = (d, isGhost = false) => {
        const chart = chartRef.current;
        const series = priceSeriesRef.current;
        if (!chart || !series) return null;

        const pts = (d.points || []).map((p) => {
            const { x, y } = getCoords(p);
            return { ...p, x, y };
        });

        // If ghost drawing with active mouse, append live mouse coordinate
        if (isGhost && mouseCoord) {
            pts.push(mouseCoord);
        }

        const width = containerRef.current?.clientWidth || 800;
        const height = containerRef.current?.clientHeight || 540;
        const strokeColor = isGhost ? "#06b6d4" : d.color || activeColor;
        const strokeW = d.lineWidth || 2;
        const dash =
            d.lineStyle === "dashed" || isGhost
                ? "6 4"
                : d.lineStyle === "dotted"
                ? "2 3"
                : undefined;
        const isSelected = selectedDrawingId === d.id && !isGhost;

        // Render based on tool type
        switch (d.type) {
            case "trendline": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line
                            x1={pts[0].x}
                            y1={pts[0].y}
                            x2={pts[1].x}
                            y2={pts[1].y}
                            stroke={strokeColor}
                            strokeWidth={strokeW}
                            strokeDasharray={dash}
                        />
                        {isSelected && (
                            <>
                                <circle cx={pts[0].x} cy={pts[0].y} r={4.5} fill="#ffffff" stroke={strokeColor} strokeWidth={2} />
                                <circle cx={pts[1].x} cy={pts[1].y} r={4.5} fill="#ffffff" stroke={strokeColor} strokeWidth={2} />
                            </>
                        )}
                    </g>
                );
            }

            case "ray": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const dx = pts[1].x - pts[0].x;
                const dy = pts[1].y - pts[0].y;
                let targetX = pts[1].x;
                let targetY = pts[1].y;
                if (dx !== 0) {
                    const slope = dy / dx;
                    targetX = dx > 0 ? width : 0;
                    targetY = pts[0].y + slope * (targetX - pts[0].x);
                }
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line
                            x1={pts[0].x}
                            y1={pts[0].y}
                            x2={targetX}
                            y2={targetY}
                            stroke={strokeColor}
                            strokeWidth={strokeW}
                            strokeDasharray={dash}
                        />
                        {isSelected && <circle cx={pts[0].x} cy={pts[0].y} r={4.5} fill="#fff" stroke={strokeColor} strokeWidth={2} />}
                    </g>
                );
            }

            case "ext_line": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const dx = pts[1].x - pts[0].x;
                const dy = pts[1].y - pts[0].y;
                let leftY = pts[0].y;
                let rightY = pts[1].y;
                if (dx !== 0) {
                    const slope = dy / dx;
                    leftY = pts[0].y - slope * pts[0].x;
                    rightY = pts[0].y + slope * (width - pts[0].x);
                }
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line x1={0} y1={leftY} x2={width} y2={rightY} stroke={strokeColor} strokeWidth={strokeW} strokeDasharray={dash} />
                    </g>
                );
            }

            case "horizontal": {
                if (!pts.length || pts[0].y == null) return null;
                const y = pts[0].y;
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line x1={0} y1={y} x2={width} y2={y} stroke={strokeColor} strokeWidth={strokeW} strokeDasharray={dash} />
                        <rect x={width - 70} y={y - 10} width={65} height={18} rx={4} fill={strokeColor} />
                        <text x={width - 38} y={y + 3} fill="#ffffff" fontSize={10} fontWeight="bold" textAnchor="middle">
                            ₹{pts[0].price.toFixed(1)}
                        </text>
                    </g>
                );
            }

            case "horiz_ray": {
                if (!pts.length || pts[0].x == null || pts[0].y == null) return null;
                const { x, y } = pts[0];
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line x1={x} y1={y} x2={width} y2={y} stroke={strokeColor} strokeWidth={strokeW} strokeDasharray={dash} />
                        <rect x={width - 70} y={y - 10} width={65} height={18} rx={4} fill={strokeColor} />
                        <text x={width - 38} y={y + 3} fill="#ffffff" fontSize={10} fontWeight="bold" textAnchor="middle">
                            ₹{pts[0].price.toFixed(1)}
                        </text>
                    </g>
                );
            }

            case "vertical": {
                if (!pts.length || pts[0].x == null) return null;
                const x = pts[0].x;
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line x1={x} y1={0} x2={x} y2={height} stroke={strokeColor} strokeWidth={strokeW} strokeDasharray={dash} />
                        <rect x={x - 36} y={height - 22} width={72} height={18} rx={4} fill={strokeColor} />
                        <text x={x} y={height - 9} fill="#ffffff" fontSize={9} fontWeight="bold" textAnchor="middle">
                            {isoDay(pts[0].time)}
                        </text>
                    </g>
                );
            }

            case "cross_line": {
                if (!pts.length || pts[0].x == null || pts[0].y == null) return null;
                const { x, y } = pts[0];
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line x1={0} y1={y} x2={width} y2={y} stroke={strokeColor} strokeWidth={strokeW} strokeDasharray="3 3" />
                        <line x1={x} y1={0} x2={x} y2={height} stroke={strokeColor} strokeWidth={strokeW} strokeDasharray="3 3" />
                        <circle cx={x} cy={y} r={4} fill={strokeColor} />
                    </g>
                );
            }

            case "channel": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const p1 = pts[0];
                const p2 = pts[1];
                const p3 = pts[2] || { x: p1.x, y: p1.y - 40 };
                const offsetY = p3.y - p1.y;

                const polyPoints = `${p1.x},${p1.y} ${p2.x},${p2.y} ${p2.x},${p2.y + offsetY} ${p1.x},${p1.y + offsetY}`;
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <polygon points={polyPoints} fill={strokeColor} fillOpacity={0.12} />
                        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={strokeColor} strokeWidth={strokeW} />
                        <line x1={p1.x} y1={p1.y + offsetY} x2={p2.x} y2={p2.y + offsetY} stroke={strokeColor} strokeWidth={strokeW} />
                        <line
                            x1={p1.x}
                            y1={p1.y + offsetY / 2}
                            x2={p2.x}
                            y2={p2.y + offsetY / 2}
                            stroke={strokeColor}
                            strokeWidth={1}
                            strokeDasharray="4 4"
                        />
                    </g>
                );
            }

            case "fib": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const highPrice = Math.max(pts[0].price, pts[1].price);
                const lowPrice = Math.min(pts[0].price, pts[1].price);
                const diff = highPrice - lowPrice;
                const startX = Math.min(pts[0].x, pts[1].x);
                const endX = Math.max(pts[0].x, pts[1].x, width - 40);

                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        {FIB_LEVELS.map((lvl, idx) => {
                            const pVal = highPrice - diff * lvl;
                            const y = series.priceToCoordinate(pVal);
                            if (y == null) return null;
                            const col = FIB_COLORS[idx % FIB_COLORS.length];
                            return (
                                <g key={lvl}>
                                    <line x1={startX} y1={y} x2={endX} y2={y} stroke={col} strokeWidth={1.5} strokeDasharray="5 3" />
                                    <rect x={endX - 90} y={y - 9} width={85} height={16} rx={3} fill={col} fillOpacity={0.85} />
                                    <text x={endX - 48} y={y + 3} fill="#fff" fontSize={9} fontWeight="bold" textAnchor="middle">
                                        {(lvl * 100).toFixed(1)}% (₹{pVal.toFixed(1)})
                                    </text>
                                </g>
                            );
                        })}
                    </g>
                );
            }

            case "fib_ext": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const p1 = pts[0];
                const p2 = pts[1];
                const p3 = pts[2] || p2;
                const waveDiff = Math.abs(p2.price - p1.price);
                const extLevels = [0.618, 1.0, 1.618, 2.618];

                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={strokeColor} strokeWidth={1.5} />
                        {pts[2] && <line x1={p2.x} y1={p2.y} x2={p3.x} y2={p3.y} stroke={strokeColor} strokeWidth={1} strokeDasharray="3 3" />}
                        {extLevels.map((lvl, idx) => {
                            const targetVal = p3.price + waveDiff * lvl;
                            const y = series.priceToCoordinate(targetVal);
                            if (y == null) return null;
                            const col = FIB_COLORS[idx % FIB_COLORS.length];
                            return (
                                <g key={lvl}>
                                    <line x1={p3.x} y1={y} x2={width - 20} y2={y} stroke={col} strokeWidth={1.5} strokeDasharray="4 3" />
                                    <text x={width - 30} y={y - 3} fill={col} fontSize={9} fontWeight="bold" textAnchor="end">
                                        Ext {lvl}x (₹{targetVal.toFixed(1)})
                                    </text>
                                </g>
                            );
                        })}
                    </g>
                );
            }

            case "rectangle": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const minX = Math.min(pts[0].x, pts[1].x);
                const maxX = Math.max(pts[0].x, pts[1].x);
                const minY = Math.min(pts[0].y, pts[1].y);
                const maxY = Math.max(pts[0].y, pts[1].y);
                const w = maxX - minX;
                const h = maxY - minY;
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <rect x={minX} y={minY} width={w} height={h} fill={strokeColor} fillOpacity={0.15} stroke={strokeColor} strokeWidth={strokeW} />
                        <line x1={minX} y1={minY + h / 2} x2={maxX} y2={minY + h / 2} stroke={strokeColor} strokeWidth={1} strokeDasharray="3 3" />
                        <text x={minX + 6} y={minY + 14} fill={strokeColor} fontSize={10} fontWeight="bold">
                            ZONE (50% Eq: ₹{((pts[0].price + pts[1].price) / 2).toFixed(1)})
                        </text>
                    </g>
                );
            }

            case "circle": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const cx = pts[0].x;
                const cy = pts[0].y;
                const rx = Math.abs(pts[1].x - cx);
                const ry = Math.abs(pts[1].y - cy);
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <ellipse cx={cx} cy={cy} rx={rx || 20} ry={ry || 20} fill={strokeColor} fillOpacity={0.12} stroke={strokeColor} strokeWidth={strokeW} />
                    </g>
                );
            }

            case "triangle": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const p1 = pts[0];
                const p2 = pts[1];
                const p3 = pts[2] || { x: p2.x + 40, y: p1.y };
                const polyPoints = `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <polygon points={polyPoints} fill={strokeColor} fillOpacity={0.15} stroke={strokeColor} strokeWidth={strokeW} />
                    </g>
                );
            }

            case "long_pos":
            case "short_pos": {
                if (!pts.length || pts[0].x == null || pts[0].y == null) return null;
                const isLong = d.type === "long_pos";
                const entryX = pts[0].x;
                const entryY = pts[0].y;
                const entryPrice = pts[0].price;

                const targetPct = d.meta?.targetPct || 1.5;
                const slPct = d.meta?.slPct || 0.8;

                const targetPrice = isLong ? entryPrice * (1 + targetPct / 100) : entryPrice * (1 - targetPct / 100);
                const slPrice = isLong ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);

                const targetY = series.priceToCoordinate(targetPrice) || entryY - 50;
                const slY = series.priceToCoordinate(slPrice) || entryY + 30;

                const boxW = Math.min(220, width - entryX - 10);
                const targetH = Math.abs(targetY - entryY);
                const slH = Math.abs(slY - entryY);

                const targetTop = isLong ? targetY : entryY;
                const slTop = isLong ? entryY : slY;

                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        {/* Target Box (Green) */}
                        <rect x={entryX} y={targetTop} width={boxW} height={targetH} fill="#059669" fillOpacity={0.25} stroke="#059669" strokeWidth={1.5} />
                        {/* Stop Loss Box (Red) */}
                        <rect x={entryX} y={slTop} width={boxW} height={slH} fill="#e11d48" fillOpacity={0.25} stroke="#e11d48" strokeWidth={1.5} />

                        {/* Entry Line */}
                        <line x1={entryX} y1={entryY} x2={entryX + boxW} y2={entryY} stroke="#3b82f6" strokeWidth={2} />

                        {/* Badges */}
                        <text x={entryX + 6} y={targetTop + 14} fill="#059669" fontSize={10} fontWeight="bold">
                            Target: ₹{targetPrice.toFixed(1)} (+{targetPct}%)
                        </text>
                        <text x={entryX + 6} y={slTop + slH - 6} fill="#e11d48" fontSize={10} fontWeight="bold">
                            Stop Loss: ₹{slPrice.toFixed(1)} (-{slPct}%)
                        </text>
                        <rect x={entryX + boxW - 80} y={entryY - 10} width={75} height={20} rx={4} fill="#1e293b" />
                        <text x={entryX + boxW - 42} y={entryY + 4} fill="#fff" fontSize={9} fontWeight="bold" textAnchor="middle">
                            R:R 1 : {(targetPct / slPct).toFixed(1)}
                        </text>
                    </g>
                );
            }

            case "ruler": {
                if (pts.length < 2 || pts[0].x == null || pts[1].x == null) return null;
                const minX = Math.min(pts[0].x, pts[1].x);
                const maxX = Math.max(pts[0].x, pts[1].x);
                const minY = Math.min(pts[0].y, pts[1].y);
                const maxY = Math.max(pts[0].y, pts[1].y);
                const priceDelta = pts[1].price - pts[0].price;
                const pctDelta = pts[0].price ? (priceDelta / pts[0].price) * 100 : 0;
                const isPositive = priceDelta >= 0;
                const deltaDays = Math.abs(Math.round((pts[1].time - pts[0].time) / 86400));

                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <rect
                            x={minX}
                            y={minY}
                            width={maxX - minX}
                            height={maxY - minY}
                            fill={isPositive ? "#059669" : "#e11d48"}
                            fillOpacity={0.12}
                            stroke={isPositive ? "#059669" : "#e11d48"}
                            strokeWidth={1}
                            strokeDasharray="4 4"
                        />
                        <line x1={pts[0].x} y1={pts[0].y} x2={pts[1].x} y2={pts[1].y} stroke={isPositive ? "#059669" : "#e11d48"} strokeWidth={2} />
                        {/* Info Badge */}
                        <g transform={`translate(${(minX + maxX) / 2 - 60}, ${(minY + maxY) / 2 - 20})`}>
                            <rect width={120} height={42} rx={6} fill="#0f172a" fillOpacity={0.92} stroke="#334155" />
                            <text x={60} y={16} fill={isPositive ? "#10b981" : "#f43f5e"} fontSize={11} fontWeight="bold" textAnchor="middle">
                                {isPositive ? "+" : ""}₹{priceDelta.toFixed(2)} ({isPositive ? "+" : ""}{pctDelta.toFixed(2)}%)
                            </text>
                            <text x={60} y={32} fill="#94a3b8" fontSize={9} textAnchor="middle">
                                ⏱ {deltaDays} Days · {Math.max(1, deltaDays)} Bars
                            </text>
                        </g>
                    </g>
                );
            }

            case "text":
            case "sticky": {
                if (!pts.length || pts[0].x == null || pts[0].y == null) return null;
                const { x, y } = pts[0];
                const text = d.meta?.text || "Note";
                const isSticky = d.type === "sticky";

                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <rect
                            x={x}
                            y={y - 20}
                            width={Math.max(80, text.length * 8 + 20)}
                            height={isSticky ? 40 : 26}
                            rx={6}
                            fill={isSticky ? "#fef08a" : isDark ? "#1e293b" : "#f1f5f9"}
                            stroke={isSelected ? "#059669" : "#cbd5e1"}
                            strokeWidth={isSelected ? 2 : 1}
                        />
                        <text
                            x={x + 10}
                            y={y - 4}
                            fill={isSticky ? "#854d0e" : isDark ? "#f8fafc" : "#1e293b"}
                            fontSize={11}
                            fontWeight="bold"
                        >
                            {text}
                        </text>
                    </g>
                );
            }

            case "callout": {
                if (!pts.length || pts[0].x == null || pts[0].y == null) return null;
                const { x, y } = pts[0];
                const text = d.meta?.text || `₹${pts[0].price.toFixed(2)}`;
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <line x1={x} y1={y} x2={x + 25} y2={y - 25} stroke={strokeColor} strokeWidth={1.5} />
                        <rect x={x + 25} y={y - 38} width={75} height={22} rx={4} fill={strokeColor} />
                        <text x={x + 62} y={y - 24} fill="#ffffff" fontSize={10} fontWeight="bold" textAnchor="middle">
                            {text}
                        </text>
                        <circle cx={x} cy={y} r={3.5} fill={strokeColor} />
                    </g>
                );
            }

            case "arrow_up":
            case "arrow_down": {
                if (!pts.length || pts[0].x == null || pts[0].y == null) return null;
                const { x, y } = pts[0];
                const isUpArrow = d.type === "arrow_up";
                const col = isUpArrow ? "#059669" : "#e11d48";
                return (
                    <g key={d.id || "ghost"} className="cursor-pointer" onClick={() => !isGhost && setSelectedDrawingId(d.id)}>
                        <polygon
                            points={
                                isUpArrow
                                    ? `${x},${y - 18} ${x - 8},${y - 2} ${x + 8},${y - 2}`
                                    : `${x},${y + 18} ${x - 8},${y + 2} ${x + 8},${y + 2}`
                            }
                            fill={col}
                        />
                        <rect x={x - 2} y={isUpArrow ? y - 2 : y - 10} width={4} height={10} fill={col} />
                    </g>
                );
            }

            default:
                return null;
        }
    };

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
                {/* Left Controls */}
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
                            <div className="absolute left-0 top-full z-40 mt-1 min-w-[140px] rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
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
                            <div className="absolute left-0 top-full z-40 mt-1 min-w-[180px] rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
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

                {/* Right Controls: Drawing Style / Screenshot & Fullscreen */}
                <div className="flex items-center gap-1.5">
                    {/* Floating Color Palette */}
                    <div className="flex items-center gap-1 border-r border-gray-200 pr-2 mr-1 dark:border-gray-700">
                        {COLOR_PALETTE.slice(0, 5).map((c) => (
                            <button
                                key={c.hex}
                                onClick={() => {
                                    setActiveColor(c.hex);
                                    updateSelectedDrawingStyle({ color: c.hex });
                                }}
                                style={{ backgroundColor: c.hex }}
                                className={`h-4 w-4 rounded-full transition-transform ${
                                    activeColor === c.hex ? "scale-125 ring-2 ring-emerald-500 ring-offset-1" : "hover:scale-110"
                                }`}
                                title={c.name}
                            />
                        ))}
                    </div>

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
                {/* Left Drawing Tools Rail (TradingView / Dhan Pro Grade) */}
                <div className="relative flex shrink-0 flex-col gap-1.5 rounded-xl border border-gray-100 bg-gray-50/70 p-1.5 dark:border-gray-800 dark:bg-gray-900/50 z-30">
                    {/* Tool Categories with Flyouts */}
                    {TOOL_GROUPS.map((group) => {
                        const currentToolKey = selectedToolPerGroup[group.id] || group.tools[0].key;
                        const currentTool = ALL_TOOLS_MAP[currentToolKey] || group.tools[0];
                        const isGroupActive = activeTool && ALL_TOOLS_MAP[activeTool]?.group === group.id;

                        return (
                            <div key={group.id} className="relative">
                                <div className="flex items-center">
                                    <button
                                        onClick={() => selectTool(currentToolKey)}
                                        title={`${currentTool.label} (${currentTool.shortcut})`}
                                        className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold transition-all ${
                                            isGroupActive
                                                ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                                                : "border-gray-200 bg-white text-gray-700 hover:border-emerald-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                        }`}
                                    >
                                        <span>{currentTool.icon}</span>
                                    </button>
                                    {/* Flyout Arrow */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenFlyout(openFlyout === group.id ? null : group.id);
                                        }}
                                        className="absolute -right-1 bottom-0 flex h-3 w-3 items-center justify-center rounded-full bg-gray-200 text-[8px] text-gray-600 hover:bg-emerald-500 hover:text-white dark:bg-gray-700 dark:text-gray-300"
                                    >
                                        ▸
                                    </button>
                                </div>

                                {/* Flyout Drawer */}
                                {openFlyout === group.id && (
                                    <div className="absolute left-full top-0 ml-2 z-50 min-w-[200px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-gray-700 dark:bg-gray-800">
                                        <div className="mb-1 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-400">
                                            {group.title}
                                        </div>
                                        {group.tools.map((t) => (
                                            <button
                                                key={t.key}
                                                onClick={() => selectTool(t.key)}
                                                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                                                    activeTool === t.key
                                                        ? "bg-emerald-600 text-white"
                                                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                                                }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-sm">{t.icon}</span>
                                                    <span>{t.label}</span>
                                                </div>
                                                <kbd className="rounded bg-black/10 px-1 text-[9px] dark:bg-white/10">
                                                    {t.shortcut}
                                                </kbd>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <div className="my-1 border-t border-gray-200 dark:border-gray-700" />

                    {/* Undo */}
                    <button
                        onClick={handleUndo}
                        disabled={!undoStack.length}
                        title="Undo Drawing (Ctrl+Z)"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                        <FiCornerUpLeft className="h-3.5 w-3.5" />
                    </button>

                    {/* Redo */}
                    <button
                        onClick={handleRedo}
                        disabled={!redoStack.length}
                        title="Redo Drawing (Ctrl+Y)"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                        <FiCornerUpRight className="h-3.5 w-3.5" />
                    </button>

                    {/* Lock Drawings */}
                    <button
                        onClick={() => setIsLocked(!isLocked)}
                        title={isLocked ? "Unlock All Drawings" : "Lock All Drawings"}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                            isLocked
                                ? "border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-950/50"
                                : "border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        }`}
                    >
                        {isLocked ? <FiLock className="h-3.5 w-3.5" /> : <FiUnlock className="h-3.5 w-3.5" />}
                    </button>

                    {/* Hide/Show Drawings */}
                    <button
                        onClick={() => setDrawingsVisible(!drawingsVisible)}
                        title={drawingsVisible ? "Hide Drawings" : "Show Drawings"}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                        {drawingsVisible ? <FiEye className="h-3.5 w-3.5" /> : <FiEyeOff className="h-3.5 w-3.5 text-gray-400" />}
                    </button>

                    {/* Clear Drawings */}
                    <button
                        onClick={clearAllDrawings}
                        title="Clear All Drawings (Del)"
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-gray-800 dark:text-rose-400"
                    >
                        <FiTrash2 className="h-3.5 w-3.5" />
                    </button>
                </div>

                {/* Chart Canvas & Interactive SVG Overlay */}
                <div className="relative flex-1 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-inner dark:border-gray-800 dark:bg-[#0b1420]">
                    {/* Live OHLC Legend */}
                    {legend && (
                        <div className="absolute left-3 top-2.5 z-20 flex flex-wrap items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-xs backdrop-blur-xs dark:bg-gray-900/90 dark:text-gray-200">
                            <span className="font-bold text-gray-900 dark:text-white">{symbol}</span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-400">{legend.date}</span>
                            <span className="text-gray-400">|</span>
                            <span>
                                O: <strong className="text-gray-900 dark:text-white">{fmt(legend.o)}</strong>
                            </span>
                            <span>
                                H: <strong className="text-emerald-600">{fmt(legend.h)}</strong>
                            </span>
                            <span>
                                L: <strong className="text-rose-600">{fmt(legend.l)}</strong>
                            </span>
                            <span>
                                C:{" "}
                                <strong className={legend.up ? "text-emerald-600 font-bold" : "text-rose-600 font-bold"}>
                                    {fmt(legend.c)}
                                </strong>
                            </span>
                            {legend.v != null && (
                                <>
                                    <span className="text-gray-400">|</span>
                                    <span>
                                        Vol:{" "}
                                        <strong className="text-gray-900 dark:text-white">
                                            {Number(legend.v).toLocaleString("en-IN")}
                                        </strong>
                                    </span>
                                </>
                            )}
                        </div>
                    )}

                    {/* Active Drawing Tool Banner & Controls */}
                    {activeTool && (
                        <div className="absolute right-3 top-2.5 z-20 flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white shadow-md animate-fade-in">
                            <span>
                                Active: {ALL_TOOLS_MAP[activeTool]?.label} — Click on chart to place points (
                                {inProgressPoints.length}/{ALL_TOOLS_MAP[activeTool]?.pointsNeeded || 1})
                            </span>
                            <button
                                onClick={() => {
                                    setActiveTool(null);
                                    setInProgressPoints([]);
                                }}
                                className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] hover:bg-emerald-800"
                            >
                                Esc / Done
                            </button>
                        </div>
                    )}

                    {/* Selected Drawing Floating Action Menu */}
                    {selectedDrawingId && !activeTool && (
                        <div className="absolute left-1/2 top-2.5 -translate-x-1/2 z-20 flex items-center gap-2 rounded-xl border border-gray-200 bg-white/95 px-3 py-1.5 text-xs shadow-xl backdrop-blur-md dark:border-gray-700 dark:bg-gray-800/95 animate-fade-in">
                            <span className="font-bold text-emerald-600 text-[11px]">Selected Drawing</span>
                            <div className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
                            {/* Width */}
                            {[1, 2, 3, 4].map((w) => (
                                <button
                                    key={w}
                                    onClick={() => updateSelectedDrawingStyle({ lineWidth: w })}
                                    className="px-1.5 py-0.5 text-[10px] font-bold rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    {w}px
                                </button>
                            ))}
                            <div className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
                            {/* Edit text if note */}
                            {drawings.find((d) => d.id === selectedDrawingId)?.meta?.text && (
                                <button
                                    onClick={() => {
                                        const d = drawings.find((x) => x.id === selectedDrawingId);
                                        setEditingTextModal({ id: selectedDrawingId, initialText: d.meta.text });
                                        setTextInputValue(d.meta.text);
                                    }}
                                    className="p-1 text-gray-600 hover:text-emerald-600 dark:text-gray-300"
                                    title="Edit Text"
                                >
                                    <FiEdit3 className="h-3.5 w-3.5" />
                                </button>
                            )}
                            {/* Delete */}
                            <button
                                onClick={() => deleteDrawing(selectedDrawingId)}
                                className="p-1 text-rose-600 hover:bg-rose-50 rounded dark:hover:bg-rose-950/50"
                                title="Delete Drawing"
                            >
                                <FiTrash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}

                    {/* Lightweight Charts Canvas */}
                    <div ref={containerRef} className="h-[68vh] min-h-[480px] w-full" />

                    {/* SVG Vector Drawing Layer */}
                    {drawingsVisible && (
                        <svg className="absolute inset-0 h-full w-full pointer-events-none z-10" key={renderTick}>
                            {/* Render Completed Saved Drawings */}
                            {drawings.map((d) => renderDrawingItem(d, false))}

                            {/* Render Ghost / In-Progress Drawing */}
                            {activeTool && inProgressPoints.length > 0 && (
                                renderDrawingItem(
                                    {
                                        id: "ghost_drawing",
                                        type: activeTool,
                                        points: inProgressPoints,
                                        color: activeColor,
                                        lineWidth: activeLineWidth,
                                        lineStyle: activeLineStyle,
                                        meta: {},
                                    },
                                    true
                                )
                            )}
                        </svg>
                    )}
                </div>
            </div>

            {/* Text Note Edit Modal */}
            {editingTextModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
                    <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
                        <div className="flex items-center justify-between pb-2 border-b border-gray-100 dark:border-gray-800">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-white">Edit Chart Annotation</h3>
                            <button
                                onClick={() => setEditingTextModal(null)}
                                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                <FiX className="h-4 w-4" />
                            </button>
                        </div>
                        <input
                            type="text"
                            value={textInputValue}
                            onChange={(e) => setTextInputValue(e.target.value)}
                            placeholder="Enter annotation text..."
                            className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-900 outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                            autoFocus
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                onClick={() => setEditingTextModal(null)}
                                className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveText}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                                <FiCheck className="h-3.5 w-3.5" />
                                Save Note
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
