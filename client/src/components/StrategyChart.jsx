// components/StrategyChart.jsx
//
// TradingView-style chart for Simulator's "Strategy Chart" tab — charts the
// constructed option strategy's combined P&L over the replayed historical
// day (not NIFTY itself; see CandlestickChart.jsx for that), with volume/OI
// sub-panes and the same drawing-tool/indicator chrome as the NIFTY chart.
//
// *** Candle approximation, stated plainly *** — option_chain_history stores
// ONE ltp snapshot per minute per contract, not true intra-minute
// open/high/low. So each "candle" here is close-to-close: open = previous
// minute's combined P&L, close = this minute's, high/low = max/min of the
// two. This is a standard technique for turning point samples into a candle
// series, but it is NOT real intra-minute price action — there was never a
// wick beyond open/close within that single minute, because we only ever
// sampled once. Documented here so nobody mistakes this for tick-level data.
//
// Volume/OI are the real stored ce_volume/pe_volume/ce_oi/pe_oi values,
// summed across the strategy's legs (see simulatorController.js's replay
// endpoint) — not approximated.
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, LineStyle } from "lightweight-charts";

const DRAWING_TOOLS = [
    { key: "trendline", label: "Trendline", icon: "╱" },
    { key: "ray", label: "Ray", icon: "↗" },
    { key: "horizontal", label: "H-Line", icon: "─" },
    { key: "fib", label: "Fibonacci", icon: "Fib" },
];
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6"];

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

/** replayData.series ({time,pnl,volume,oi}) -> close-to-close OHLC candles, epoch seconds (see toEpochSeconds convention). */
function buildCandles(series, toEpoch, inverted) {
    let prevClose = null;
    const out = [];
    for (const point of series) {
        if (point.pnl == null) {
            prevClose = null; // a real data gap — don't bridge across it with a fake candle
            continue;
        }
        const close = inverted ? -point.pnl : point.pnl;
        const open = prevClose != null ? prevClose : close;
        out.push({
            time: toEpoch(point.time),
            open,
            high: Math.max(open, close),
            low: Math.min(open, close),
            close,
            volume: point.volume,
            oi: point.oi,
        });
        prevClose = close;
    }
    return out;
}

const StrategyChart = forwardRef(function StrategyChart({ replayData, date, currentTime, height = 320 }, ref) {
    const containerRef = useRef(null);
    const chartRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const overlaysRef = useRef([]);
    const pendingPointRef = useRef(null);

    const [activeTool, setActiveTool] = useState(null);
    const [indicatorsOpen, setIndicatorsOpen] = useState(false);
    const [indicators, setIndicators] = useState({ sma: false, ema: false });
    const [inverted, setInverted] = useState(false);
    const [showVolume, setShowVolume] = useState(true);
    const [showOi, setShowOi] = useState(true);

    // Same IST-digits-as-UTC convention as CandlestickChart.jsx/IntradayChart.jsx.
    function toEpoch(timeStr) {
        const [y, m, d] = date.split("-").map(Number);
        const [hh, mm, ss] = String(timeStr).split(":").map(Number);
        return Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss || 0) / 1000);
    }

    useImperativeHandle(ref, () => ({
        getChart: () => chartRef.current,
        getSeries: () => candleSeriesRef.current,
    }));

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

    const candles = replayData ? buildCandles(replayData.series, toEpoch, inverted) : null;

    useEffect(() => {
        if (!candles || !candles.length || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
            layout: { background: { color: "#ffffff" }, textColor: "#374151" },
            grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e5e7eb" },
            rightPriceScale: { borderColor: "#e5e7eb" },
            width: containerRef.current.clientWidth,
            height,
        });
        chartRef.current = chart;

        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#10b981",
            downColor: "#f43f5e",
            borderUpColor: "#10b981",
            borderDownColor: "#f43f5e",
            wickUpColor: "#10b981",
            wickDownColor: "#f43f5e",
            title: "Strategy",
        });
        series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        candleSeriesRef.current = series;
        overlaysRef.current = [];
        pendingPointRef.current = null;

        // Panes 1/2 are only created if there's real volume/OI data — a
        // strategy on strikes with zero recorded activity shouldn't show an
        // empty sub-pane implying data that doesn't exist.
        const hasVolume = candles.some((c) => c.volume != null && c.volume > 0);
        const hasOi = candles.some((c) => c.oi != null && c.oi > 0);

        if (showVolume && hasVolume) {
            const volSeries = chart.addSeries(
                HistogramSeries,
                { color: "#93c5fd", priceFormat: { type: "volume" }, title: "Volume" },
                1
            );
            volSeries.setData(
                candles.filter((c) => c.volume != null).map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? "#86efac" : "#fca5a5" }))
            );
            chart.panes()[1]?.setHeight(Math.round(height * 0.22));
        }
        if (showOi && hasOi) {
            const oiPaneIndex = showVolume && hasVolume ? 2 : 1;
            const oiSeries = chart.addSeries(
                LineSeries,
                { color: "#8b5cf6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, title: "OI" },
                oiPaneIndex
            );
            oiSeries.setData(candles.filter((c) => c.oi != null).map((c) => ({ time: c.time, value: c.oi })));
            chart.panes()[oiPaneIndex]?.setHeight(Math.round(height * 0.18));
        }

        if (indicators.sma) {
            const vals = sma(candles.map((c) => c.close), 20);
            const s = chart.addSeries(LineSeries, { color: "#2563eb", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            s.setData(candles.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
            overlaysRef.current.push({ kind: "series", ref: s, type: "indicator" });
        }
        if (indicators.ema) {
            const vals = ema(candles.map((c) => c.close), 20);
            const s = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false });
            s.setData(candles.map((c, i) => ({ time: c.time, value: vals[i] })).filter((p) => p.value != null));
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [replayData, date, inverted, showVolume, showOi, height, indicators.sma, indicators.ema]);

    // Move the crosshair to the currently-scrubbed replay instant — mirrors
    // the dashed reference line the old recharts version drew.
    useEffect(() => {
        const chart = chartRef.current;
        const series = candleSeriesRef.current;
        if (!chart || !series || !currentTime || !candles) return;
        const target = candles.find((c) => c.time === toEpoch(currentTime));
        if (target) chart.setCrosshairPosition(target.close, target.time, series);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTime, candles]);

    useEffect(() => {
        const chart = chartRef.current;
        const series = candleSeriesRef.current;
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
                const lastCandle = candles[candles.length - 1];
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
                const lastCandle = candles[candles.length - 1];
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
    }, [activeTool, candles]);

    if (!replayData) {
        return (
            <div className="py-16 text-center text-xs text-gray-400">
                Click "Run Simulation" to see the real minute-by-minute replay for this chart.
            </div>
        );
    }
    if (!candles || !candles.length) {
        return <div className="py-16 text-center text-xs text-gray-400">No replay data to chart.</div>;
    }

    return (
        <div className="flex gap-2">
            <div className="flex shrink-0 flex-col gap-1 border-r border-gray-100 pr-2">
                {DRAWING_TOOLS.map((tool) => (
                    <button
                        key={tool.key}
                        onClick={() => setActiveTool((t) => (t === tool.key ? null : tool.key))}
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
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px]">
                        <span className="font-semibold text-gray-500">Strategy P&L (approx. candles)</span>
                        <button
                            onClick={() => setInverted((v) => !v)}
                            title="Flip the P&L scale — useful for viewing a short/credit strategy the other way"
                            className={`rounded-md border px-2 py-1 font-semibold transition ${
                                inverted ? "border-blue-300 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                            }`}
                        >
                            Inverted price
                        </button>
                        <label className="flex cursor-pointer items-center gap-1 text-gray-600">
                            <input type="checkbox" checked={showVolume} onChange={() => setShowVolume((v) => !v)} /> Volume
                        </label>
                        <label className="flex cursor-pointer items-center gap-1 text-gray-600">
                            <input type="checkbox" checked={showOi} onChange={() => setShowOi((v) => !v)} /> OI
                        </label>
                    </div>

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
                <div className="mt-2 text-[11px] text-gray-400 text-center">
                    Candles are close-to-close between real stored per-minute P&L samples — not true intra-minute price action (only one price was ever recorded per minute).
                </div>
            </div>
        </div>
    );
});

export default StrategyChart;
