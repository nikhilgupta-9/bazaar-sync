import React from "react";
// pages/HistoricalChart.jsx — Dhan-Style TradingView Pro Station Powered 100% by Database History
// Renders our stored MySQL database records (ohlcv_data) with high-speed Lightweight Charts,
// all drawing tools, indicators (EMA, SMA, Bollinger Bands, Supertrend, RSI, Volume),
// Dhan-style instant trade order panel, timeframe aggregations, and shortcuts cheatsheet.
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { fetchSymbolList, fetchUnderlyingHistory } from "../services/optionChainApi";
import HistoricalPriceChart from "../components/HistoricalPriceChart";
import {
    FiHelpCircle,
    FiTrendingUp,
    FiExternalLink,
    FiShoppingBag,
    FiX,
    FiMaximize2,
    FiLayers,
    FiDatabase,
} from "react-icons/fi";

const DEFAULT_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"];
const QUICK_STOCKS = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "TATAMOTORS", "SBIN"];

const LOT_SIZES = {
    NIFTY: 25,
    BANKNIFTY: 15,
    FINNIFTY: 25,
    MIDCPNIFTY: 50,
    SENSEX: 10,
    BANKEX: 15,
};

const RANGE_OPTIONS = [
    { label: "1M", days: 30 },
    { label: "3M", days: 90 },
    { label: "6M", days: 180 },
    { label: "1Y", days: 365 },
    { label: "3Y", days: 1095 },
    { label: "ALL", days: 3650 },
];

const TIMEFRAME_OPTIONS = [
    { label: "1D", key: "1D" },
    { label: "1W", key: "1W" },
    { label: "1M", key: "1M" },
];

// Aggregates raw points to Daily candles
function toDailyCandles(points) {
    const byDay = new Map();
    for (const p of points) {
        if (p.close == null) continue;
        const dayKey = Math.floor(p.time / 86400) * 86400;
        const g = byDay.get(dayKey);
        if (!g) {
            byDay.set(dayKey, {
                time: dayKey,
                open: p.open,
                high: p.high,
                low: p.low,
                close: p.close,
                volume: p.volume || 0,
            });
        } else {
            g.high = Math.max(g.high, p.high);
            g.low = Math.min(g.low, p.low);
            g.close = p.close;
            g.volume += p.volume || 0;
        }
    }
    return [...byDay.values()].sort((a, b) => a.time - b.time);
}

// Aggregates Daily candles into Weekly or Monthly candles
function aggregateCandles(daily, mode = "1D") {
    if (mode === "1D" || !daily.length) return daily;

    const grouped = new Map();
    for (const d of daily) {
        const date = new Date(d.time * 1000);
        let groupKey;
        if (mode === "1W") {
            // Monday of the week
            const day = date.getUTCDay();
            const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(date);
            monday.setUTCDate(diff);
            monday.setUTCHours(0, 0, 0, 0);
            groupKey = Math.floor(monday.getTime() / 1000);
        } else {
            // 1st of the month
            const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
            groupKey = Math.floor(firstOfMonth.getTime() / 1000);
        }

        const g = grouped.get(groupKey);
        if (!g) {
            grouped.set(groupKey, {
                time: groupKey,
                open: d.open,
                high: d.high,
                low: d.low,
                close: d.close,
                volume: d.volume || 0,
            });
        } else {
            g.high = Math.max(g.high, d.high);
            g.low = Math.min(g.low, d.low);
            g.close = d.close;
            g.volume += d.volume || 0;
        }
    }
    return [...grouped.values()].sort((a, b) => a.time - b.time);
}

function computeStats(daily) {
    if (!daily.length) return null;
    const first = daily[0];
    const last = daily[daily.length - 1];
    const change = last.close - first.close;
    const changePct = first.close ? (change / first.close) * 100 : 0;

    let hi = daily[0],
        lo = daily[0],
        volSum = 0,
        volDays = 0;
    for (const d of daily) {
        if (d.high > hi.high) hi = d;
        if (d.low < lo.low) lo = d;
        if (d.volume > 0) {
            volSum += d.volume;
            volDays += 1;
        }
    }
    return {
        last: last.close,
        lastDate: new Date(last.time * 1000).toISOString().slice(0, 10),
        change,
        changePct,
        high: hi.high,
        highDate: new Date(hi.time * 1000).toISOString().slice(0, 10),
        low: lo.low,
        lowDate: new Date(lo.time * 1000).toISOString().slice(0, 10),
        sessions: daily.length,
        avgVolume: volDays ? volSum / volDays : null,
    };
}

function fmtNum(v) {
    return v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtVol(v) {
    if (v == null) return "—";
    if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
    return String(Math.round(v));
}

export default function HistoricalChart() {
    const { isDark } = useTheme();
    const [symbolList, setSymbolList] = useState({ indices: DEFAULT_INDICES, stocks: [] });
    const [symbol, setSymbol] = useState("NIFTY");
    const [days, setDays] = useState(180);
    const [timeframe, setTimeframe] = useState("1D"); // "1D" | "1W" | "1M"

    // Stored DB state
    const [storedResult, setStoredResult] = useState(null);

    // Dhan-Style "Trade From Chart" Panel
    const [showTradePanel, setShowTradePanel] = useState(false);
    const [tradeSide, setTradeSide] = useState("BUY");
    const [tradeProduct, setTradeProduct] = useState("MIS"); // "MIS" | "NRML"
    const [tradeLots, setTradeLots] = useState(1);
    const [tradeTargetPts, setTradeTargetPts] = useState(50);
    const [tradeStopLossPts, setTradeStopLossPts] = useState(25);
    const [tradeSuccessMsg, setTradeSuccessMsg] = useState("");

    // Cheatsheet Modal
    const [showShortcutsModal, setShowShortcutsModal] = useState(false);

    // Fullscreen state
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        fetchSymbolList()
            .then((res) => {
                setSymbolList({
                    indices: res.indices?.length ? res.indices : DEFAULT_INDICES,
                    stocks: res.stocks || [],
                });
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        const key = `${symbol}:${days}`;
        let cancelled = false;
        fetchUnderlyingHistory(symbol, days)
            .then((res) => !cancelled && setStoredResult({ key, points: res.points || [], error: null }))
            .catch((err) => !cancelled && setStoredResult({ key, points: [], error: err.message || "Failed to load" }));
        return () => {
            cancelled = true;
        };
    }, [symbol, days]);

    const currentKey = `${symbol}:${days}`;
    const loading = !storedResult || storedResult.key !== currentKey;
    const error = loading ? null : storedResult?.error;
    const rawPoints = loading ? null : storedResult?.points;

    const dailyPoints = useMemo(() => toDailyCandles(rawPoints || []), [rawPoints]);
    const displayCandles = useMemo(() => aggregateCandles(dailyPoints, timeframe), [dailyPoints, timeframe]);
    const stats = useMemo(() => computeStats(dailyPoints), [dailyPoints]);
    const rangeLabel = RANGE_OPTIONS.find((r) => r.days === days)?.label || "";
    const isUp = stats && stats.change >= 0;

    const currentLotSize = LOT_SIZES[symbol.toUpperCase()] || 1;
    const totalQty = tradeLots * currentLotSize;
    const riskRewardRatio = tradeStopLossPts > 0 ? (tradeTargetPts / tradeStopLossPts).toFixed(1) : "—";
    const estProfit = totalQty * tradeTargetPts;
    const estLoss = totalQty * tradeStopLossPts;

    const handleExecutePaperOrder = () => {
        const order = {
            id: "ORD_" + Date.now(),
            symbol: symbol,
            side: tradeSide,
            product: tradeProduct,
            lots: tradeLots,
            lotSize: currentLotSize,
            quantity: totalQty,
            targetPts: tradeTargetPts,
            stopLossPts: tradeStopLossPts,
            timestamp: new Date().toISOString(),
        };

        try {
            const existing = JSON.parse(localStorage.getItem("bazaar_paper_chart_orders") || "[]");
            existing.unshift(order);
            localStorage.setItem("bazaar_paper_chart_orders", JSON.stringify(existing.slice(0, 50)));
        } catch {
            /* ignore storage errors */
        }

        setTradeSuccessMsg(`✓ Executed ${tradeSide} ${totalQty} Qty (${tradeLots} Lot) of ${symbol} [${tradeProduct}]`);
        setTimeout(() => setTradeSuccessMsg(""), 4500);
    };

    return (
        <div
            className={`min-h-screen w-full transition-colors ${
                isDark ? "bg-[#0b1420] text-gray-100" : "bg-gray-50 text-gray-900"
            } ${isFullscreen ? "fixed inset-0 z-50 overflow-y-auto p-2" : "p-2 sm:p-4 lg:p-6"}`}
        >
            {/* TOP BAR: Header, DB Indicator Badge, Controls */}
            <div className="flex flex-col gap-3 rounded-2xl border border-gray-200/80 bg-white/95 p-3.5 shadow-sm backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/95 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3 dark:border-gray-800">
                    {/* Title & DB Source Badge */}
                    <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/20">
                            <FiTrendingUp className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">Historical Chart</h1>
                                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                    <FiDatabase className="h-3 w-3" />
                                    <span>Bazaar Sync Database</span>
                                </span>
                            </div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                Powered directly by stored MySQL historical candles · Complete TradingView Tools & Indicators
                            </p>
                        </div>
                    </div>

                    {/* Action Controls & Navigation Bridges */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Trade From Chart Action Button */}
                        <button
                            onClick={() => setShowTradePanel(!showTradePanel)}
                            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all shadow-sm ${
                                showTradePanel
                                    ? "border-emerald-600 bg-emerald-600 text-white"
                                    : "border-emerald-500/30 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                            }`}
                        >
                            <FiShoppingBag className="h-3.5 w-3.5" />
                            <span>{showTradePanel ? "Hide Order Dock" : "⚡ Trade from Chart"}</span>
                        </button>

                        {/* Shortcuts & Tricks Cheatsheet */}
                        <button
                            onClick={() => setShowShortcutsModal(true)}
                            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            title="TradingView & Dhan Keyboard Shortcuts"
                        >
                            <FiHelpCircle className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="hidden sm:inline">Dhan Tricks</span>
                        </button>

                        {/* Fullscreen Toggle */}
                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                        >
                            <FiMaximize2 className="h-3.5 w-3.5" />
                        </button>

                        {/* Cross-Page Navigation Quick Bridges */}
                        <div className="hidden items-center gap-1 md:flex">
                            <Link
                                to={`/option-chain/${symbol.toLowerCase()}`}
                                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                                <span>Chain</span>
                                <FiExternalLink className="h-3 w-3" />
                            </Link>
                            <Link
                                to="/strategy-builder"
                                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                                <span>Builder</span>
                                <FiExternalLink className="h-3 w-3" />
                            </Link>
                            <Link
                                to="/simulator"
                                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                                <span>Backtester</span>
                                <FiExternalLink className="h-3 w-3" />
                            </Link>
                        </div>
                    </div>
                </div>

                {/* CONTROLS ROW: Symbol Chips, Dropdown, Timeframe Aggregation & Date Range */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* Left: Quick Symbol Selector Chips */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        {/* Main Index Chips */}
                        <div className="flex items-center gap-1 overflow-x-auto py-0.5">
                            {DEFAULT_INDICES.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setSymbol(s)}
                                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                        symbol === s
                                            ? "bg-emerald-600 text-white shadow-sm"
                                            : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                                    }`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>

                        {/* Top Stocks Quick Select */}
                        <div className="hidden items-center gap-1 xl:flex">
                            <span className="text-[10px] font-semibold text-gray-400">|</span>
                            {QUICK_STOCKS.slice(0, 5).map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setSymbol(s)}
                                    className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-all ${
                                        symbol === s
                                            ? "bg-emerald-600 text-white font-bold"
                                            : "bg-gray-50 text-gray-600 hover:bg-gray-200 dark:bg-gray-800/60 dark:text-gray-400 dark:hover:bg-gray-700"
                                    }`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>

                        {/* Comprehensive Search / Select Dropdown */}
                        <select
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-800 shadow-sm outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        >
                            <optgroup label="Index Universe">
                                {symbolList.indices.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </optgroup>
                            {symbolList.stocks.length > 0 && (
                                <optgroup label="F&O Stocks">
                                    {symbolList.stocks.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </div>

                    {/* Right: Timeframe Aggregation (1D, 1W, 1M) & Date Range (1M - ALL) */}
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Timeframe Aggregation */}
                        <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            {TIMEFRAME_OPTIONS.map((tf) => (
                                <button
                                    key={tf.key}
                                    onClick={() => setTimeframe(tf.key)}
                                    className={`rounded-md px-2 py-0.5 text-xs font-bold transition-colors ${
                                        timeframe === tf.key
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                    }`}
                                >
                                    {tf.label}
                                </button>
                            ))}
                        </div>

                        {/* Stored DB Date Range Selector */}
                        <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                            {RANGE_OPTIONS.map((r) => (
                                <button
                                    key={r.label}
                                    onClick={() => setDays(r.days)}
                                    className={`rounded-md px-2 py-0.5 text-xs font-semibold transition-colors ${
                                        days === r.days
                                            ? "bg-emerald-600 text-white"
                                            : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                                    }`}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* DHAN-STYLE "TRADE FROM CHART" DOCK / DRAWER */}
            {showTradePanel && (
                <div className="mt-3 rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-teal-500/5 to-emerald-500/10 p-4 shadow-md dark:border-emerald-500/30 dark:bg-emerald-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-500/20 pb-3">
                        <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-xs">
                                ⚡
                            </span>
                            <div>
                                <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
                                    Instant Trade from Chart · {symbol}
                                </h3>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                    Simulate & place live chart paper orders with lot sizing, target & stop loss
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowTradePanel(false)}
                            className="rounded-lg p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800"
                        >
                            <FiX className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Order Controls Row */}
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {/* Side: Buy / Sell */}
                        <div>
                            <label className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Action</label>
                            <div className="mt-1 flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
                                <button
                                    onClick={() => setTradeSide("BUY")}
                                    className={`flex-1 rounded-md py-1 text-xs font-bold transition-all ${
                                        tradeSide === "BUY" ? "bg-emerald-600 text-white" : "text-gray-500"
                                    }`}
                                >
                                    BUY
                                </button>
                                <button
                                    onClick={() => setTradeSide("SELL")}
                                    className={`flex-1 rounded-md py-1 text-xs font-bold transition-all ${
                                        tradeSide === "SELL" ? "bg-rose-600 text-white" : "text-gray-500"
                                    }`}
                                >
                                    SELL
                                </button>
                            </div>
                        </div>

                        {/* Product Type: MIS / NRML */}
                        <div>
                            <label className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Product</label>
                            <div className="mt-1 flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-800">
                                <button
                                    onClick={() => setTradeProduct("MIS")}
                                    className={`flex-1 rounded-md py-1 text-xs font-bold ${
                                        tradeProduct === "MIS" ? "bg-gray-900 text-white dark:bg-gray-700" : "text-gray-500"
                                    }`}
                                >
                                    Intraday
                                </button>
                                <button
                                    onClick={() => setTradeProduct("NRML")}
                                    className={`flex-1 rounded-md py-1 text-xs font-bold ${
                                        tradeProduct === "NRML" ? "bg-gray-900 text-white dark:bg-gray-700" : "text-gray-500"
                                    }`}
                                >
                                    Normal
                                </button>
                            </div>
                        </div>

                        {/* Lots */}
                        <div>
                            <label className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">
                                Lots (Lot = {currentLotSize})
                            </label>
                            <div className="mt-1 flex items-center rounded-lg border border-gray-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-800">
                                <input
                                    type="number"
                                    min="1"
                                    max="100"
                                    value={tradeLots}
                                    onChange={(e) => setTradeLots(Math.max(1, parseInt(e.target.value) || 1))}
                                    className="w-full bg-transparent text-xs font-bold outline-none"
                                />
                                <span className="text-[10px] text-gray-400">({totalQty} Qty)</span>
                            </div>
                        </div>

                        {/* Target (Pts) */}
                        <div>
                            <label className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Target (Pts)</label>
                            <input
                                type="number"
                                min="1"
                                value={tradeTargetPts}
                                onChange={(e) => setTradeTargetPts(Math.max(1, parseFloat(e.target.value) || 1))}
                                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800"
                            />
                        </div>

                        {/* Stop Loss (Pts) */}
                        <div>
                            <label className="text-[10px] font-bold uppercase text-gray-500 dark:text-gray-400">Stop Loss (Pts)</label>
                            <input
                                type="number"
                                min="1"
                                value={tradeStopLossPts}
                                onChange={(e) => setTradeStopLossPts(Math.max(1, parseFloat(e.target.value) || 1))}
                                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold outline-none focus:border-rose-500 dark:border-gray-700 dark:bg-gray-800"
                            />
                        </div>

                        {/* Action Execute Button */}
                        <div className="flex flex-col justify-end">
                            <button
                                onClick={handleExecutePaperOrder}
                                className={`w-full rounded-xl py-2 text-xs font-extrabold text-white shadow-md transition-all ${
                                    tradeSide === "BUY"
                                        ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30"
                                        : "bg-rose-600 hover:bg-rose-700 shadow-rose-600/30"
                                }`}
                            >
                                Place {tradeSide} Order
                            </button>
                        </div>
                    </div>

                    {/* Risk : Reward & Margin Metrics */}
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-600 dark:text-gray-400 border-t border-emerald-500/10 pt-2">
                        <div className="flex flex-wrap items-center gap-3">
                            <span>
                                Risk : Reward: <strong className="text-emerald-600 font-bold">1 : {riskRewardRatio}</strong>
                            </span>
                            <span>
                                Target P&L: <strong className="text-emerald-600 font-bold">+₹{fmtNum(estProfit)}</strong>
                            </span>
                            <span>
                                Max Risk: <strong className="text-rose-600 font-bold">-₹{fmtNum(estLoss)}</strong>
                            </span>
                        </div>
                        {tradeSuccessMsg && (
                            <span className="animate-fade-in font-bold text-emerald-600 dark:text-emerald-400">
                                {tradeSuccessMsg}
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* STAT TILES */}
            {stats && (
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                        <div className="text-[10px] font-bold uppercase text-gray-400">Last Close</div>
                        <div className="text-base font-bold text-gray-900 dark:text-white">{fmtNum(stats.last)}</div>
                        <div className="text-[10px] text-gray-400">{stats.lastDate}</div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                        <div className="text-[10px] font-bold uppercase text-gray-400">Change ({rangeLabel})</div>
                        <div className={`text-base font-bold ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
                            {isUp ? "+" : ""}{stats.changePct.toFixed(2)}%
                        </div>
                        <div className="text-[10px] text-gray-400">{isUp ? "+" : ""}{fmtNum(stats.change)} pts</div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                        <div className="text-[10px] font-bold uppercase text-gray-400">Period High</div>
                        <div className="text-base font-bold text-emerald-600">{fmtNum(stats.high)}</div>
                        <div className="text-[10px] text-gray-400">{stats.highDate}</div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                        <div className="text-[10px] font-bold uppercase text-gray-400">Period Low</div>
                        <div className="text-base font-bold text-rose-600">{fmtNum(stats.low)}</div>
                        <div className="text-[10px] text-gray-400">{stats.lowDate}</div>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                        <div className="text-[10px] font-bold uppercase text-gray-400">Avg Volume</div>
                        <div className="text-base font-bold text-gray-900 dark:text-white">
                            {stats.avgVolume ? fmtVol(stats.avgVolume) : stats.sessions}
                        </div>
                        <div className="text-[10px] text-gray-400">{stats.sessions} trading days</div>
                    </div>
                </div>
            )}

            {/* MAIN CHART CONTAINER */}
            <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                {loading ? (
                    <div className="flex h-[62vh] min-h-[460px] flex-col items-center justify-center gap-2 text-xs text-gray-400">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                        <span>Loading {symbol} historical candles from database…</span>
                    </div>
                ) : error ? (
                    <div className="flex h-[62vh] min-h-[460px] items-center justify-center text-xs text-rose-600">
                        Failed to load data: {error}
                    </div>
                ) : displayCandles.length === 0 ? (
                    <div className="flex h-[62vh] min-h-[460px] flex-col items-center justify-center gap-2 text-xs text-gray-400">
                        <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">
                            No stored history found for {symbol}
                        </span>
                        <span>Run the backfill scripts to ingest historical OHLCV data.</span>
                    </div>
                ) : (
                    <>
                        <HistoricalPriceChart
                            points={displayCandles}
                            symbol={symbol}
                            rangeLabel={`${rangeLabel} · ${timeframe}`}
                        />
                        <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 border-t border-gray-100 pt-2 dark:border-gray-800">
                            <span>
                                {displayCandles.length} candles ({timeframe} granularity) · Powered 100% by Bazaar Sync's stored OHLCV database.
                            </span>
                            <span>Timezone: Asia/Kolkata (IST)</span>
                        </div>
                    </>
                )}
            </div>

            {/* TRADINGVIEW & DHAN TRICKS / SHORTCUTS MODAL */}
            {showShortcutsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
                    <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900 sm:p-6">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
                            <div className="flex items-center gap-2">
                                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold text-sm">
                                    ⚡
                                </span>
                                <div>
                                    <h2 className="text-base font-extrabold text-gray-900 dark:text-white">
                                        TradingView & Dhan Pro Shortcuts & Tricks
                                    </h2>
                                    <p className="text-xs text-gray-500">Master high-speed technical analysis on our stored data</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowShortcutsModal(false)}
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                <FiX className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
                            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-gray-800 dark:bg-gray-800/50">
                                <h4 className="font-bold text-emerald-600 mb-2 flex items-center gap-1.5">
                                    <FiLayers className="h-4 w-4" /> Pro Drawing Tools & Hotkeys
                                </h4>
                                <ul className="space-y-1.5 text-gray-600 dark:text-gray-300">
                                    <li className="flex justify-between">
                                        <span>Trendline:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + T</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Horizontal Level:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + H</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Fibonacci Retracement:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + F</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Demand/Supply Zone:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + R</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Long Risk:Reward (R:R):</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + L</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Short Risk:Reward (R:R):</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + S</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Price Range (Ruler):</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + M</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Vertical Timeline:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + V</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Text / Sticky Annotation:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Alt + N</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Undo / Redo:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Ctrl + Z / Y</kbd>
                                    </li>
                                </ul>
                            </div>

                            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-gray-800 dark:bg-gray-800/50">
                                <h4 className="font-bold text-emerald-600 mb-2 flex items-center gap-1.5">
                                    <FiTrendingUp className="h-4 w-4" /> Chart Navigation & Tools
                                </h4>
                                <ul className="space-y-1.5 text-gray-600 dark:text-gray-300">
                                    <li className="flex justify-between">
                                        <span>Candlestick Styles:</span> <span className="font-medium">Candles, Hollow, Bars, Heikin Ashi</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Persistent Storage:</span> <span className="font-medium text-emerald-600 font-bold">Auto-Saved per Stock</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Take Screenshot:</span> <span className="font-medium">Camera Icon (PNG)</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Fullscreen Mode:</span> <span className="font-medium">Expand Icon</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Cancel Tool / Deselect:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Esc</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Delete Selected:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Delete / Backspace</kbd>
                                    </li>
                                </ul>
                            </div>

                            <div className="sm:col-span-2 rounded-xl border border-emerald-500/20 bg-emerald-50/50 p-3.5 dark:border-emerald-500/20 dark:bg-emerald-950/20">
                                <h4 className="font-bold text-emerald-700 dark:text-emerald-300 mb-1">
                                    💡 Dhan Pro Trick: Supply & Demand Zones + Risk:Reward
                                </h4>
                                <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-relaxed">
                                    1. Draw <strong>Demand/Supply Zones (Alt+R)</strong> around high volume rejection levels.
                                    <br />
                                    2. Mark Fibonacci Retracements <strong>(Alt+F)</strong> from swing lows to swing highs. Watch for confluence at the <strong>50% (0.5) and 61.8% (Golden Pocket)</strong> levels.
                                    <br />
                                    3. Deploy <strong>Long Position (Alt+L)</strong> or <strong>Short Position (Alt+S)</strong> tools to visualize target and stop loss zones with automated 1:2 Risk-to-Reward calculation.
                                </p>
                            </div>
                        </div>

                        <div className="mt-5 flex justify-end">
                            <button
                                onClick={() => setShowShortcutsModal(false)}
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                                Got it, Let's Trade!
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
