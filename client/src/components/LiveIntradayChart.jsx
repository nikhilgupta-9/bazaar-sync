// components/LiveIntradayChart.jsx
//
// Powers Strategy Builder's "Strategy Chart" / "NIFTY Chart" / "Strategy
// Chart + NIFTY Chart" tabs — live/today's intraday view, distinct from
// Simulator's StrategyChart.jsx (which replays one PAST historical day from
// stored option_chain_history). Real data foundation carried over from the
// now-unused IntradayChart.jsx: seeded from GET /api/option-chain/:symbol/
// intraday (1-minute NIFTY spot, from live_index_ticks), then live-appended
// from the same socket.io feed every other page uses (services/liveSocket.js)
// — no new live-data path.
//
// *** Two approximations, stated plainly ***
// 1. Candles: only one spot sample per minute is stored/streamed (no true
//    intra-minute OHLC), so each candle is close-to-close (open = previous
//    minute's close) — same technique as Simulator's StrategyChart.jsx.
// 2. Strategy P&L: this app doesn't persist a per-minute option-premium
//    history for TODAY (live_option_ticks isn't folded into
//    option_chain_history until the 23:00 IST nightly cron) — so each leg is
//    repriced via Black-Scholes at each NIFTY sample using its ENTRY IV as a
//    stand-in for "IV at that moment" (same convention the old
//    IntradayChart.jsx used, and the same kind of explicitly-labelled
//    approximation as payoff.js's addMarkToMarketCurve/StrategyBuilder's
//    Today-P&L curve). Not exact — a real fix needs a new endpoint reading
//    live_option_ticks, not built here.
//
// Volume/OI panes (real, unapproximated, in Simulator's charts) are
// deliberately NOT here — NIFTY the index has no meaningful per-tick
// volume/OI of its own, and we don't have live per-leg option volume/OI
// streamed with fine enough resolution to attribute per candle.
import { useEffect, useRef, useState, useMemo } from "react";
import { createChart, CandlestickSeries, LineSeries, LineStyle } from "lightweight-charts";
import { fetchIntraday } from "../services/optionChainApi";
import { subscribeLiveTicks } from "../services/liveSocket";
import { bsPrice, yearsToExpiry } from "../utils/blackScholes";

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

function strategyPnlAt(spot, legs, t) {
    let pnl = 0;
    for (const leg of legs) {
        const vol = (leg.iv || 0) / 100;
        const value = vol > 0
            ? bsPrice({ spot, strike: leg.strike, t, vol, right: leg.type })
            : Math.max(0, leg.type === "CE" ? spot - leg.strike : leg.strike - spot);
        const diff = leg.action === "buy" ? value - leg.premium : leg.premium - value;
        pnl += diff * leg.qty;
    }
    return pnl;
}

/** Point samples -> close-to-close candles. */
function buildCandles(points) {
    let prevClose = null;
    return points.map((p) => {
        const close = p.value;
        const open = prevClose != null ? prevClose : close;
        prevClose = close;
        return { time: p.time, open, high: Math.max(open, close), low: Math.min(open, close), close };
    });
}

export default function LiveIntradayChart({ symbol, mode, legs, selectedExpiry, height = 340 }) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const niftySeriesRef = useRef(null);
    const strategySeriesRef = useRef(null);
    const overlaysRef = useRef([]);
    const pendingPointRef = useRef(null);
    const currentNiftyCandleRef = useRef(null); // in-progress live candle, keyed by minute
    const currentStrategyCandleRef = useRef(null);

    const [points, setPoints] = useState(null);
    const [error, setError] = useState(null);
    const [tradeDate, setTradeDate] = useState(null);
    const [isHistorical, setIsHistorical] = useState(false);
    const [activeTool, setActiveTool] = useState(null);
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({ sma: false, ema: false });

    const showNifty = mode === "nifty" || mode === "combined";
    const showStrategy = mode === "strategy" || mode === "combined";
    const t = useMemo(() => (selectedExpiry ? yearsToExpiry(selectedExpiry) : null), [selectedExpiry]);

    useEffect(() => {
        let cancelled = false;
        setPoints(null);
        setError(null);
        fetchIntraday(symbol)
            .then((res) => {
                if (cancelled) return;
                setPoints(res.points);
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

    const niftyCandles = useMemo(() => {
        if (!points || !tradeDate) return null;
        return buildCandles(points.map((p) => ({ time: toEpochSeconds(tradeDate, p.time), value: p.ltp })));
    }, [points, tradeDate]);

    const strategyCandles = useMemo(() => {
        if (!niftyCandles || !legs.length || t == null) return null;
        return buildCandles(niftyCandles.map((c) => ({ time: c.time, value: strategyPnlAt(c.close, legs, t) })));
    }, [niftyCandles, legs, t]);

    function clearDrawings() {
        const chart = chartRef.current;
        const series = niftySeriesRef.current || strategySeriesRef.current;
        if (!series || !chart) return;
        for (const ov of overlaysRef.current) {
            if (ov.kind === "priceLine") series.removePriceLine(ov.ref);
            else chart.removeSeries(ov.ref);
        }
        overlaysRef.current = [];
        pendingPointRef.current = null;
    }

    useEffect(() => {
        if (!niftyCandles || !niftyCandles.length || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: { background: { color: "#ffffff" }, textColor: "#374151" },
            grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e5e7eb" },
            rightPriceScale: { borderColor: "#e5e7eb" },
            width: containerRef.current.clientWidth,
            height,
        });
        chartRef.current = chart;
        overlaysRef.current = [];
        pendingPointRef.current = null;
        niftySeriesRef.current = null;
        strategySeriesRef.current = null;

        if (showNifty) {
            const s = chart.addSeries(CandlestickSeries, {
                upColor: "#10b981", downColor: "#f43f5e", borderUpColor: "#10b981", borderDownColor: "#f43f5e",
                wickUpColor: "#10b981", wickDownColor: "#f43f5e",
                priceScaleId: showStrategy ? "left" : "right",
                title: "NIFTY",
            });
            s.setData(niftyCandles);
            niftySeriesRef.current = s;
            currentNiftyCandleRef.current = niftyCandles[niftyCandles.length - 1];
        }
        if (showStrategy && strategyCandles) {
            const s = chart.addSeries(CandlestickSeries, {
                upColor: "#3b82f6", downColor: "#f97316", borderUpColor: "#3b82f6", borderDownColor: "#f97316",
                wickUpColor: "#3b82f6", wickDownColor: "#f97316",
                priceScaleId: "right",
                title: "Strategy",
            });
            s.setData(strategyCandles);
            strategySeriesRef.current = s;
            currentStrategyCandleRef.current = strategyCandles[strategyCandles.length - 1];
        }

        const closes = (strategyCandles || niftyCandles).map((c) => c.close);
        const baseData = strategyCandles || niftyCandles;
        if (indicators.sma) {
            const vals = sma(closes, 20);
            const line = chart.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, priceScaleId: showStrategy ? "right" : "right" });
            line.setData(baseData.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: line, type: "indicator" });
        }
        if (indicators.ema) {
            const vals = ema(closes, 20);
            const line = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            line.setData(baseData.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: line, type: "indicator" });
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
            niftySeriesRef.current = null;
            strategySeriesRef.current = null;
            overlaysRef.current = [];
            pendingPointRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [niftyCandles, strategyCandles, showNifty, showStrategy, height, indicators.sma, indicators.ema]);

    // Live-append: builds/updates the current minute's candle in place from
    // each incoming tick, pushing a new candle only when the minute rolls
    // over. Only meaningful when actually showing today (not the "market
    // closed, last trading day" fallback).
    useEffect(() => {
        if (isHistorical || !tradeDate) return;
        const unsubscribe = subscribeLiveTicks(symbol, (frame) => {
            if (frame.spot == null) return;
            const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
            const hh = String(ist.getUTCHours()).padStart(2, "0");
            const mm = String(ist.getUTCMinutes()).padStart(2, "0");
            const time = toEpochSeconds(tradeDate, `${hh}:${mm}`);

            function updateCandle(candleRef, series, value) {
                if (!series) return;
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

            updateCandle(currentNiftyCandleRef, niftySeriesRef.current, frame.spot);
            if (legs.length && t != null) {
                updateCandle(currentStrategyCandleRef, strategySeriesRef.current, strategyPnlAt(frame.spot, legs, t));
            }
        });
        return unsubscribe;
    }, [symbol, isHistorical, tradeDate, legs, t]);

    useEffect(() => {
        const chart = chartRef.current;
        const series = niftySeriesRef.current || strategySeriesRef.current;
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
        return <div className="p-16 text-center text-xs text-gray-400">Loading chart…</div>;
    }
    if (points.length === 0) {
        return <div className="p-16 text-center text-xs text-gray-400">No intraday data yet today.</div>;
    }

    return (
        <div>
            {isHistorical && (
                <div className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                    Market closed — showing the last trading day ({tradeDate}), not live.
                </div>
            )}
            {showStrategy && !legs.length && (
                <div className="mb-2 rounded-md bg-gray-50 px-3 py-1.5 text-[11px] text-gray-500">
                    Add legs to see the strategy's approximate P&L over the day.
                </div>
            )}
            <div className="flex gap-2">
                <div className="flex shrink-0 flex-col gap-1 border-r border-gray-100 pr-2">
                    {DRAWING_TOOLS.map((tool) => (
                        <button
                            key={tool.key}
                            onClick={() => setActiveTool((tk) => (tk === tool.key ? null : tool.key))}
                            title={tool.label}
                            className={`w-9 rounded-md border px-1 py-1.5 text-[10px] font-bold transition ${
                                activeTool === tool.key ? "border-purple-300 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"
                            }`}
                        >
                            {tool.icon}
                        </button>
                    ))}
                    <button onClick={clearDrawings} title="Clear drawings" className="w-9 rounded-md border border-gray-200 px-1 py-1.5 text-[10px] font-bold text-gray-500 hover:bg-gray-50">
                        ✕
                    </button>
                </div>
                <div className="min-w-0 flex-1">
                    <div className="mb-2 flex justify-end">
                        <div className="relative">
                            <button onClick={() => setIndicatorsOpen((v) => !v)} className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
                                Indicators
                            </button>
                            {indicatorsOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setIndicatorsOpen(false)} />
                                    <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-gray-200 bg-white p-2 shadow-xl text-xs">
                                        <label className="flex cursor-pointer items-center gap-2 py-1">
                                            <input type="checkbox" checked={indicators.sma} onChange={() => setIndicators((s) => ({ ...s, sma: !s.sma }))} /> SMA (20)
                                        </label>
                                        <label className="flex cursor-pointer items-center gap-2 py-1">
                                            <input type="checkbox" checked={indicators.ema} onChange={() => setIndicators((s) => ({ ...s, ema: !s.ema }))} /> EMA (20)
                                        </label>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    <div ref={containerRef} />
                    <div className="mt-1 text-[10px] text-gray-400">
                        {showStrategy
                            ? "Strategy P&L candles are close-to-close, repriced from each leg's entry IV — an approximation, not exact live premiums."
                            : `${symbol} intraday, live from our own feed — not a TradingView feed.`}
                    </div>
                </div>
            </div>
        </div>
    );
}
