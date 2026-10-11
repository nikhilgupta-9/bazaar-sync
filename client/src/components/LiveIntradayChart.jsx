import React, { useEffect, useRef, useState, useMemo } from "react";
import { createChart, CandlestickSeries, LineSeries, LineStyle } from "lightweight-charts";
import { useTheme } from "../context/ThemeContext";
import { fetchIntraday } from "../services/optionChainApi";
import { subscribeLiveTicks } from "../services/liveSocket";
import { bsPrice, yearsToExpiry } from "../utils/blackScholes";
import { formatPrice } from "../utils/format";

const DRAWING_TOOLS = [
    { key: "trendline", label: "Trendline", icon: "╱" },
    { key: "ray", label: "Ray", icon: "↗" },
    { key: "horizontal", label: "H-Line", icon: "─" },
    { key: "fib", label: "Fibonacci", icon: "Fib" },
];
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"];

function toEpochSeconds(dateStr, timeHHMM) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [hh, mm] = timeHHMM.split(":").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d, hh, mm, 0) / 1000);
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

function strategyPnlAt(spot, legs, fallbackT) {
    if (!spot || !legs || !legs.length) return 0;
    let pnl = 0;
    for (const leg of legs) {
        if (leg.active === false) continue;
        const strike = Number(leg.strike);
        const premium = Number(leg.premium);
        if (!Number.isFinite(strike) || !Number.isFinite(premium)) continue;

        const legExpiry = leg.expiry;
        const t = legExpiry ? yearsToExpiry(legExpiry) : (fallbackT || 7 / 365);
        const ivNum = parseFloat(leg.iv);
        const vol = Number.isFinite(ivNum) && ivNum > 0 ? ivNum / 100 : 0.15;

        const theoPrice = bsPrice({
            spot: Number(spot),
            strike,
            t: Math.max(t, 1 / (365 * 24 * 4)),
            vol: Math.max(vol, 0.01),
            right: leg.type,
        });

        const diff = leg.action === "buy" ? theoPrice - premium : premium - theoPrice;
        const multiplier = (Number(leg.qty) || 1) * (Number(leg.lotSize) || 1);
        pnl += diff * multiplier;
    }
    return Number.isFinite(pnl) ? pnl : 0;
}

/** Point samples -> close-to-close candles. */
function buildCandles(points) {
    let prevClose = null;
    const out = [];
    for (const p of points) {
        if (p.value == null || !Number.isFinite(p.value)) continue;
        const close = p.value;
        const open = prevClose != null ? prevClose : close;
        out.push({
            time: p.time,
            open,
            high: Math.max(open, close),
            low: Math.min(open, close),
            close,
        });
        prevClose = close;
    }
    return out;
}

export default function LiveIntradayChart({ symbol, mode, legs = [], selectedExpiry, height = 360 }) {
    const { theme } = useTheme();
    const isDark = theme === "dark" || document.documentElement.classList.contains("dark");

    const strategyContainerRef = useRef(null);
    const niftyContainerRef = useRef(null);
    const singleContainerRef = useRef(null);

    const strategyChartRef = useRef(null);
    const niftyChartRef = useRef(null);
    const singleChartRef = useRef(null);

    const niftySeriesRef = useRef(null);
    const strategySeriesRef = useRef(null);

    const overlaysRef = useRef([]);
    const pendingPointRef = useRef(null);
    const currentNiftyCandleRef = useRef(null);
    const currentStrategyCandleRef = useRef(null);

    const [points, setPoints] = useState(null);
    const [error, setError] = useState(null);
    const [tradeDate, setTradeDate] = useState(null);
    const [isHistorical, setIsHistorical] = useState(false);
    const [activeTool, setActiveTool] = useState(null);
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({ sma: false, ema: false });

    const isCombined = mode === "combined";
    const showStrategyOnly = mode === "strategy";
    const showNiftyOnly = mode === "nifty";

    // Fetch intraday points
    useEffect(() => {
        let cancelled = false;
        setPoints(null);
        setError(null);
        fetchIntraday(symbol)
            .then((res) => {
                if (cancelled) return;
                setPoints(res.points || []);
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

    // Compute NIFTY Candles
    const niftyCandles = useMemo(() => {
        if (!points || !points.length || !tradeDate) return null;
        return buildCandles(points.map((p) => ({ time: toEpochSeconds(tradeDate, p.time), value: p.ltp })));
    }, [points, tradeDate]);

    // Compute Strategy Candles
    const strategyCandles = useMemo(() => {
        if (!niftyCandles || !niftyCandles.length || !legs || !legs.length) return null;
        const fallbackT = selectedExpiry
            ? yearsToExpiry(selectedExpiry)
            : legs[0]?.expiry
            ? yearsToExpiry(legs[0].expiry)
            : 7 / 365;

        const candles = buildCandles(
            niftyCandles.map((c) => ({
                time: c.time,
                value: strategyPnlAt(c.close, legs, fallbackT),
            }))
        );
        return candles.length ? candles : null;
    }, [niftyCandles, legs, selectedExpiry]);

    function clearDrawings() {
        const chart = singleChartRef.current || strategyChartRef.current || niftyChartRef.current;
        const series = strategySeriesRef.current || niftySeriesRef.current;
        if (!series || !chart) return;
        for (const ov of overlaysRef.current) {
            if (ov.kind === "priceLine") series.removePriceLine(ov.ref);
            else chart.removeSeries(ov.ref);
        }
        overlaysRef.current = [];
        pendingPointRef.current = null;
    }

    // Chart Configuration helper
    const createChartConfig = (chartHeight) => ({
        layout: {
            background: { color: isDark ? "#0b1420" : "#ffffff" },
            textColor: isDark ? "#9ca3af" : "#374151",
        },
        grid: {
            vertLines: { color: isDark ? "rgba(255,255,255,0.05)" : "#f3f4f6" },
            horzLines: { color: isDark ? "rgba(255,255,255,0.05)" : "#f3f4f6" },
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "#e5e7eb",
        },
        rightPriceScale: {
            visible: true,
            borderColor: isDark ? "rgba(255,255,255,0.1)" : "#e5e7eb",
        },
        leftPriceScale: {
            visible: false,
        },
        height: chartHeight,
    });

    // Render Charts
    useEffect(() => {
        if (!niftyCandles || !niftyCandles.length) return;

        // Cleanup previous instances
        overlaysRef.current = [];
        pendingPointRef.current = null;
        if (strategyChartRef.current) {
            strategyChartRef.current.remove();
            strategyChartRef.current = null;
        }
        if (niftyChartRef.current) {
            niftyChartRef.current.remove();
            niftyChartRef.current = null;
        }
        if (singleChartRef.current) {
            singleChartRef.current.remove();
            singleChartRef.current = null;
        }
        niftySeriesRef.current = null;
        strategySeriesRef.current = null;

        if (isCombined) {
            // COMBINED MODE: Two stacked synchronized charts
            const sPaneHeight = Math.max(190, Math.floor(height * 0.5));
            const nPaneHeight = Math.max(170, Math.floor(height * 0.46));

            if (strategyContainerRef.current && strategyCandles) {
                const sChart = createChart(strategyContainerRef.current, {
                    ...createChartConfig(sPaneHeight),
                    width: strategyContainerRef.current.clientWidth,
                });
                strategyChartRef.current = sChart;

                const sSeries = sChart.addSeries(CandlestickSeries, {
                    upColor: "#10b981",
                    downColor: "#f43f5e",
                    borderUpColor: "#10b981",
                    borderDownColor: "#f43f5e",
                    wickUpColor: "#10b981",
                    wickDownColor: "#f43f5e",
                    title: "Strategy P&L",
                });
                sSeries.setData(strategyCandles);
                sSeries.createPriceLine({
                    price: 0,
                    color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: "0.00",
                });
                strategySeriesRef.current = sSeries;
                currentStrategyCandleRef.current = strategyCandles[strategyCandles.length - 1];
                sChart.timeScale().fitContent();
            }

            if (niftyContainerRef.current) {
                const nChart = createChart(niftyContainerRef.current, {
                    ...createChartConfig(nPaneHeight),
                    width: niftyContainerRef.current.clientWidth,
                });
                niftyChartRef.current = nChart;

                const nSeries = nChart.addSeries(CandlestickSeries, {
                    upColor: "#10b981",
                    downColor: "#f43f5e",
                    borderUpColor: "#10b981",
                    borderDownColor: "#f43f5e",
                    wickUpColor: "#10b981",
                    wickDownColor: "#f43f5e",
                    title: symbol,
                });
                nSeries.setData(niftyCandles);
                niftySeriesRef.current = nSeries;
                currentNiftyCandleRef.current = niftyCandles[niftyCandles.length - 1];
                nChart.timeScale().fitContent();
            }

            // Sync Time Scales between both charts
            if (strategyChartRef.current && niftyChartRef.current) {
                let isSyncing = false;
                const sTimeScale = strategyChartRef.current.timeScale();
                const nTimeScale = niftyChartRef.current.timeScale();

                sTimeScale.subscribeVisibleLogicalRangeChange((range) => {
                    if (isSyncing || !range) return;
                    isSyncing = true;
                    nTimeScale.setVisibleLogicalRange(range);
                    isSyncing = false;
                });
                nTimeScale.subscribeVisibleLogicalRangeChange((range) => {
                    if (isSyncing || !range) return;
                    isSyncing = true;
                    sTimeScale.setVisibleLogicalRange(range);
                    isSyncing = false;
                });
            }
        } else if (showStrategyOnly) {
            // STRATEGY ONLY MODE
            if (singleContainerRef.current && strategyCandles) {
                const chart = createChart(singleContainerRef.current, {
                    ...createChartConfig(height),
                    width: singleContainerRef.current.clientWidth,
                });
                singleChartRef.current = chart;

                const sSeries = chart.addSeries(CandlestickSeries, {
                    upColor: "#10b981",
                    downColor: "#f43f5e",
                    borderUpColor: "#10b981",
                    borderDownColor: "#f43f5e",
                    wickUpColor: "#10b981",
                    wickDownColor: "#f43f5e",
                    title: "Strategy P&L",
                });
                sSeries.setData(strategyCandles);
                sSeries.createPriceLine({
                    price: 0,
                    color: isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)",
                    lineWidth: 1,
                    lineStyle: LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: "0.00",
                });
                strategySeriesRef.current = sSeries;
                currentStrategyCandleRef.current = strategyCandles[strategyCandles.length - 1];

                const closes = strategyCandles.map((c) => c.close);
                if (indicators.sma) {
                    const vals = sma(closes, 20);
                    const line = chart.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
                    line.setData(strategyCandles.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
                    overlaysRef.current.push({ kind: "series", ref: line, type: "indicator" });
                }
                if (indicators.ema) {
                    const vals = ema(closes, 20);
                    const line = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
                    line.setData(strategyCandles.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
                    overlaysRef.current.push({ kind: "series", ref: line, type: "indicator" });
                }

                chart.timeScale().fitContent();
            }
        } else {
            // NIFTY ONLY MODE
            if (singleContainerRef.current) {
                const chart = createChart(singleContainerRef.current, {
                    ...createChartConfig(height),
                    width: singleContainerRef.current.clientWidth,
                });
                singleChartRef.current = chart;

                const nSeries = chart.addSeries(CandlestickSeries, {
                    upColor: "#10b981",
                    downColor: "#f43f5e",
                    borderUpColor: "#10b981",
                    borderDownColor: "#f43f5e",
                    wickUpColor: "#10b981",
                    wickDownColor: "#f43f5e",
                    title: symbol,
                });
                nSeries.setData(niftyCandles);
                niftySeriesRef.current = nSeries;
                currentNiftyCandleRef.current = niftyCandles[niftyCandles.length - 1];

                const closes = niftyCandles.map((c) => c.close);
                if (indicators.sma) {
                    const vals = sma(closes, 20);
                    const line = chart.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
                    line.setData(niftyCandles.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
                    overlaysRef.current.push({ kind: "series", ref: line, type: "indicator" });
                }
                if (indicators.ema) {
                    const vals = ema(closes, 20);
                    const line = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
                    line.setData(niftyCandles.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
                    overlaysRef.current.push({ kind: "series", ref: line, type: "indicator" });
                }

                chart.timeScale().fitContent();
            }
        }

        const handleResize = () => {
            if (singleContainerRef.current && singleChartRef.current) {
                singleChartRef.current.applyOptions({ width: singleContainerRef.current.clientWidth });
            }
            if (strategyContainerRef.current && strategyChartRef.current) {
                strategyChartRef.current.applyOptions({ width: strategyContainerRef.current.clientWidth });
            }
            if (niftyContainerRef.current && niftyChartRef.current) {
                niftyChartRef.current.applyOptions({ width: niftyContainerRef.current.clientWidth });
            }
        };
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
            if (strategyChartRef.current) {
                strategyChartRef.current.remove();
                strategyChartRef.current = null;
            }
            if (niftyChartRef.current) {
                niftyChartRef.current.remove();
                niftyChartRef.current = null;
            }
            if (singleChartRef.current) {
                singleChartRef.current.remove();
                singleChartRef.current = null;
            }
            niftySeriesRef.current = null;
            strategySeriesRef.current = null;
        };
    }, [niftyCandles, strategyCandles, isCombined, showStrategyOnly, showNiftyOnly, height, isDark, symbol, indicators.sma, indicators.ema]);

    // Live Tick Streaming
    useEffect(() => {
        if (isHistorical || !tradeDate) return;
        const unsubscribe = subscribeLiveTicks(symbol, (frame) => {
            if (frame.spot == null) return;
            const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
            const hh = String(ist.getUTCHours()).padStart(2, "0");
            const mm = String(ist.getUTCMinutes()).padStart(2, "0");
            const time = toEpochSeconds(tradeDate, `${hh}:${mm}`);

            function updateCandle(candleRef, series, value) {
                if (!series || !Number.isFinite(value)) return;
                let candle = candleRef.current;
                if (!candle || candle.time !== time) {
                    const open = candle ? candle.close : value;
                    candle = { time, open, high: Math.max(open, value), low: Math.min(open, value), close: value };
                } else {
                    candle = { ...candle, high: Math.max(candle.high, value), low: Math.min(candle.low, value), close: value };
                }
                candleRef.current = candle;
                series.update(candle);
            }

            if (niftySeriesRef.current) {
                updateCandle(currentNiftyCandleRef, niftySeriesRef.current, frame.spot);
            }
            if (strategySeriesRef.current && legs && legs.length) {
                const fallbackT = selectedExpiry
                    ? yearsToExpiry(selectedExpiry)
                    : legs[0]?.expiry
                    ? yearsToExpiry(legs[0].expiry)
                    : 7 / 365;
                updateCandle(currentStrategyCandleRef, strategySeriesRef.current, strategyPnlAt(frame.spot, legs, fallbackT));
            }
        });
        return unsubscribe;
    }, [symbol, isHistorical, tradeDate, legs, selectedExpiry]);

    // Drawing tool clicks on single chart
    useEffect(() => {
        const chart = singleChartRef.current || strategyChartRef.current || niftyChartRef.current;
        const series = strategySeriesRef.current || niftySeriesRef.current;
        if (!chart || !series || !activeTool) return;

        function handleClick(param) {
            if (!param.point || param.time == null) return;
            const price = series.coordinateToPrice(param.point.y);
            if (price == null) return;

            if (activeTool === "horizontal") {
                const line = series.createPriceLine({ price, color: "#7c3aed", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "H-Line" });
                overlaysRef.current.push({ kind: "priceLine", ref: line });
                return;
            }
            if (activeTool === "trendline") {
                const first = pendingPointRef.current;
                if (!first) { pendingPointRef.current = { time: param.time, value: price }; return; }
                const s = chart.addSeries(LineSeries, { color: "#7c3aed", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
                s.setData([first, { time: param.time, value: price }].sort((a, b) => a.time - b.time));
                overlaysRef.current.push({ kind: "series", ref: s, type: "drawing" });
                pendingPointRef.current = null;
                return;
            }
            if (activeTool === "ray") {
                const first = pendingPointRef.current;
                if (!first) { pendingPointRef.current = { time: param.time, value: price }; return; }
                const second = { time: param.time, value: price };
                const lastCandle = (strategyCandles || niftyCandles)[(strategyCandles || niftyCandles).length - 1];
                const endTime = lastCandle ? lastCandle.time : second.time;
                let endPoint = second;
                const dt = second.time - first.time;
                if (dt !== 0 && endTime > second.time) {
                    const slope = (second.value - first.value) / dt;
                    endPoint = { time: endTime, value: second.value + slope * (endTime - second.time) };
                }
                const s = chart.addSeries(LineSeries, { color: "#0891b2", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
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
                const lastCandle = (strategyCandles || niftyCandles)[(strategyCandles || niftyCandles).length - 1];
                const endTime = lastCandle ? lastCandle.time : Math.max(first.time, second.time);
                FIB_LEVELS.forEach((level, i) => {
                    const levelPrice = high - diff * level;
                    const s = chart.addSeries(LineSeries, {
                        color: FIB_COLORS[i % FIB_COLORS.length], lineWidth: 1, lineStyle: LineStyle.Dashed,
                        priceLineVisible: false, lastValueVisible: true, title: `${(level * 100).toFixed(1)}%`,
                    });
                    s.setData([{ time: startTime, value: levelPrice }, { time: Math.max(endTime, startTime), value: levelPrice }]);
                    overlaysRef.current.push({ kind: "series", ref: s, type: "drawing" });
                });
                pendingPointRef.current = null;
            }
        }

        chart.subscribeClick(handleClick);
        return () => chart.unsubscribeClick(handleClick);
    }, [activeTool, niftyCandles, strategyCandles]);

    if (error) {
        return <div className="p-8 text-center text-xs text-rose-500">Failed to load chart: {error}</div>;
    }
    if (!points) {
        return <div className="p-16 text-center text-xs text-gray-400">Loading chart data…</div>;
    }
    if (points.length === 0) {
        return <div className="p-16 text-center text-xs text-gray-400">No intraday data yet today.</div>;
    }

    return (
        <div>
            {isHistorical && (
                <div className="mb-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    Market closed — showing the last trading day ({tradeDate}), not live.
                </div>
            )}
            {(isCombined || showStrategyOnly) && (!legs || !legs.length) && (
                <div className="mb-2 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                    Add legs from the Option Chain below to see the strategy's live intraday P&L curve.
                </div>
            )}

            <div className="flex gap-2">
                {/* Left Tool Sidebar */}
                <div className="flex shrink-0 flex-col gap-1 border-r border-gray-100 dark:border-white/10 pr-2">
                    {DRAWING_TOOLS.map((tool) => (
                        <button
                            key={tool.key}
                            onClick={() => setActiveTool((tk) => (tk === tool.key ? null : tool.key))}
                            title={tool.label}
                            className={`w-9 rounded-lg border px-1 py-1.5 text-[10px] font-bold transition ${
                                activeTool === tool.key
                                    ? "border-emerald-500 dark:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
                                    : "border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5"
                            }`}
                        >
                            {tool.icon}
                        </button>
                    ))}
                    <button onClick={clearDrawings} title="Clear drawings" className="w-9 rounded-lg border border-gray-200 dark:border-white/10 px-1 py-1.5 text-[10px] font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5">
                        ✕
                    </button>
                </div>

                <div className="min-w-0 flex-1">
                    {/* Top indicator bar */}
                    {!isCombined && (
                        <div className="mb-2 flex justify-end">
                            <div className="relative">
                                <button onClick={() => setIndicatorsOpen((v) => !v)} className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2.5 py-1 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 shadow-xs transition">
                                    Indicators
                                </button>
                                {indicatorsOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setIndicatorsOpen(false)} />
                                        <div className="absolute right-0 z-20 mt-1 w-36 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] p-2.5 shadow-xl text-xs text-gray-800 dark:text-gray-200">
                                            <label className="flex cursor-pointer items-center gap-2 py-1 hover:text-emerald-600 dark:hover:text-emerald-400">
                                                <input type="checkbox" checked={indicators.sma} onChange={() => setIndicators((s) => ({ ...s, sma: !s.sma }))} className="accent-emerald-600" /> SMA (20)
                                            </label>
                                            <label className="flex cursor-pointer items-center gap-2 py-1 hover:text-emerald-600 dark:hover:text-emerald-400">
                                                <input type="checkbox" checked={indicators.ema} onChange={() => setIndicators((s) => ({ ...s, ema: !s.ema }))} className="accent-emerald-600" /> EMA (20)
                                            </label>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Chart Containers */}
                    {isCombined ? (
                        <div className="space-y-3">
                            {/* Strategy Chart Pane */}
                            <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] p-2 shadow-xs">
                                <div className="mb-1.5 flex items-center justify-between px-2 text-xs font-bold text-gray-700 dark:text-gray-200">
                                    <div className="flex items-center gap-2">
                                        <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 text-[11px] font-bold">
                                            Strategy Intraday P&L
                                        </span>
                                        {strategyCandles && strategyCandles.length > 0 && (
                                            <span className={`tabular-nums font-mono text-xs ${strategyCandles[strategyCandles.length - 1].close >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                {strategyCandles[strategyCandles.length - 1].close >= 0 ? "+" : ""}{formatPrice(strategyCandles[strategyCandles.length - 1].close)}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-gray-400 font-normal">Close-to-close repriced (₹)</span>
                                </div>
                                {strategyCandles ? (
                                    <div ref={strategyContainerRef} className="rounded-lg overflow-hidden" />
                                ) : (
                                    <div className="py-12 text-center text-xs text-gray-400">
                                        Add legs to display Strategy Chart
                                    </div>
                                )}
                            </div>

                            {/* NIFTY Chart Pane */}
                            <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] p-2 shadow-xs">
                                <div className="mb-1.5 flex items-center justify-between px-2 text-xs font-bold text-gray-700 dark:text-gray-200">
                                    <div className="flex items-center gap-2">
                                        <span className="rounded bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 px-2 py-0.5 text-[11px] font-bold">
                                            {symbol} Spot Intraday
                                        </span>
                                        {niftyCandles && niftyCandles.length > 0 && (
                                            <span className="tabular-nums font-mono text-xs text-gray-900 dark:text-gray-100">
                                                {formatPrice(niftyCandles[niftyCandles.length - 1].close)}
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-gray-400 font-normal">1-min candles</span>
                                </div>
                                <div ref={niftyContainerRef} className="rounded-lg overflow-hidden" />
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div className="mb-1.5 flex items-center justify-between px-2 text-xs font-bold text-gray-700 dark:text-gray-200">
                                <span className="rounded bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-200 px-2 py-0.5 text-[11px] font-bold">
                                    {showStrategyOnly ? "Strategy Intraday P&L" : `${symbol} Spot Intraday`}
                                </span>
                            </div>
                            <div ref={singleContainerRef} className="rounded-lg overflow-hidden" />
                        </div>
                    )}

                    <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
                        {isCombined || showStrategyOnly
                            ? "Strategy P&L is repriced from each leg's entry IV — an approximation, not exact live premiums."
                            : `${symbol} intraday, live from our own feed.`}
                    </div>
                </div>
            </div>
        </div>
    );
}
