import React, { useState, useEffect, useMemo } from "react";
// pages/HistoricalChart.jsx — Fullscreen Professional TradingView Workstation
// Edge-to-edge chart terminal matching AlgoTest / TradingView / Dhan with all native drawing tools,
// 100+ technical indicators, clean Indian & Crypto market switching, zero obstructive notices.
import { Link, useSearchParams } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { fetchSymbolList, fetchUnderlyingHistory } from "../services/optionChainApi";
import HistoricalPriceChart from "../components/HistoricalPriceChart";
import TradingViewChart from "../components/TradingViewChart";
import {
    FiHelpCircle,
    FiMaximize2,
    FiMinimize2,
    FiExternalLink,
    FiX,
    FiLayers,
    FiTrendingUp,
} from "react-icons/fi";

const CORE_INDIAN_CHIPS = [
    { label: "NIFTY", symbol: "NIFTY" },
    { label: "SENSEX", symbol: "SENSEX" },
    { label: "MIDCAP", symbol: "MIDCPNIFTY" },
];
const DEFAULT_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];
const QUICK_STOCKS = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "TATAMOTORS", "SBIN"];

const CRYPTO_COINS = [
    { symbol: "BTC", name: "Bitcoin", icon: "₿", color: "text-amber-400" },
    { symbol: "ETH", name: "Ethereum", icon: "Ξ", color: "text-blue-400" },
    { symbol: "SOL", name: "Solana", icon: "◎", color: "text-purple-400" },
];

const CRYPTO_DROPDOWN_LIST = [
    { symbol: "BTC", name: "Bitcoin (BTC/USDT)" },
    { symbol: "ETH", name: "Ethereum (ETH/USDT)" },
    { symbol: "SOL", name: "Solana (SOL/USDT)" },
];

const RANGE_OPTIONS = [
    { label: "1M", days: 30 },
    { label: "3M", days: 90 },
    { label: "6M", days: 180 },
    { label: "1Y", days: 365 },
    { label: "ALL", days: 3650 },
];

const TIMEFRAME_OPTIONS = [
    { label: "1D", key: "1D" },
    { label: "1W", key: "1W" },
    { label: "1M", key: "1M" },
];

// Aggregates raw points to Daily candles for stored DB mode
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

function aggregateCandles(daily, mode = "1D") {
    if (mode === "1D" || !daily.length) return daily;
    const grouped = new Map();
    for (const d of daily) {
        const date = new Date(d.time * 1000);
        let groupKey;
        if (mode === "1W") {
            const day = date.getUTCDay();
            const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(date);
            monday.setUTCDate(diff);
            monday.setUTCHours(0, 0, 0, 0);
            groupKey = Math.floor(monday.getTime() / 1000);
        } else {
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

export default function HistoricalChart() {
    const { isDark } = useTheme();
    const [searchParams] = useSearchParams();
    const initialMarket = searchParams.get("market") === "crypto" ? "crypto" : "indian";
    const initialSymbol = searchParams.get("symbol") || (initialMarket === "crypto" ? "BTC" : "NIFTY");

    const [marketType, setMarketType] = useState(initialMarket);
    const [chartEngine, setChartEngine] = useState("tradingview"); // "tradingview" (Local TV Library) | "stored_db" (Bazaar Sync Pro)
    const [symbolList, setSymbolList] = useState({ indices: DEFAULT_INDICES, stocks: [] });
    const [symbol, setSymbol] = useState(initialSymbol);
    const [days, setDays] = useState(180);
    const [timeframe, setTimeframe] = useState("1D");

    // Fullscreen & Height state
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [chartHeightMode, setChartHeightMode] = useState("screen"); // "screen" | "850" | "1000"

    const computedChartHeight = useMemo(() => {
        if (isFullscreen) return "calc(100vh - 80px)";
        if (chartHeightMode === "850") return "850px";
        if (chartHeightMode === "1000") return "1000px";
        return "calc(100vh - 165px)";
    }, [isFullscreen, chartHeightMode]);

    const computedMinHeight = useMemo(() => {
        if (isFullscreen) return "calc(100vh - 80px)";
        if (chartHeightMode === "850") return "850px";
        if (chartHeightMode === "1000") return "1000px";
        return "720px";
    }, [isFullscreen, chartHeightMode]);

    // Indicator & Style Controls (directly above chart)
    const [chartStyle, setChartStyle] = useState("1"); // "1" = Candles, "8" = Heikin Ashi, "2" = Line
    const [chartInterval, setChartInterval] = useState("D");
    const [chartStudies, setChartStudies] = useState([
        "STD;EMA",
        "STD;RSI",
        "STD;MACD",
        "STD;Bollinger_Bands",
        "STD;Volume",
    ]);

    const toggleStudy = (studyId) => {
        setChartStudies((prev) =>
            prev.includes(studyId) ? prev.filter((s) => s !== studyId) : [...prev, studyId]
        );
    };

    // Cheatsheet Modal
    const [showShortcutsModal, setShowShortcutsModal] = useState(false);

    // Stored DB state
    const [storedResult, setStoredResult] = useState(null);

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
        if (marketType === "crypto" || chartEngine !== "stored_db") return;
        const key = `${symbol}:${days}`;
        let cancelled = false;
        fetchUnderlyingHistory(symbol, days)
            .then((res) => !cancelled && setStoredResult({ key, points: res.points || [], error: null }))
            .catch((err) => !cancelled && setStoredResult({ key, points: [], error: err.message || "Failed to load" }));
        return () => {
            cancelled = true;
        };
    }, [symbol, days, marketType, chartEngine]);

    const handleMarketTypeChange = (type) => {
        setMarketType(type);
        if (type === "crypto") {
            setSymbol("BTC");
            setChartEngine("tradingview");
        } else {
            setSymbol("NIFTY");
        }
    };

    const isCrypto = marketType === "crypto";
    const currentKey = `${symbol}:${days}`;
    const dbLoading = !storedResult || storedResult.key !== currentKey;
    const dbError = dbLoading ? null : storedResult?.error;
    const dbPoints = dbLoading ? null : storedResult?.points;
    const dailyPoints = useMemo(() => toDailyCandles(dbPoints || []), [dbPoints]);
    const displayCandles = useMemo(() => aggregateCandles(dailyPoints, timeframe), [dailyPoints, timeframe]);
    const rangeLabel = RANGE_OPTIONS.find((r) => r.days === days)?.label || "";

    const dbIndicators = useMemo(
        () => ({
            ema9: false,
            ema21: chartStudies.includes("STD;EMA"),
            sma50: false,
            sma200: false,
            bollinger: chartStudies.includes("STD;Bollinger_Bands"),
            supertrend: chartStudies.includes("STD;Supertrend"),
            rsi: chartStudies.includes("STD;RSI"),
            macd: chartStudies.includes("STD;MACD"),
        }),
        [chartStudies]
    );
    const dbShowVolume = chartStudies.includes("STD;Volume");

    return (
        <div
            className={`flex flex-col w-full transition-colors ${
                isDark ? "bg-[#0b1420] text-gray-100" : "bg-white text-gray-900"
            } ${
                isFullscreen
                    ? "fixed inset-0 z-50 h-screen w-screen overflow-hidden"
                    : "flex-1 min-h-[calc(100vh-84px)] h-full"
            }`}
        >
            {/* SLEEK SINGLE-LINE WORKSTATION TOOLBAR */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 bg-white/95 px-3 backdrop-blur-md dark:border-gray-800 dark:bg-[#0b1420]/95 z-10 text-xs">
                {/* Left: Market Switcher & Symbol Quick Select */}
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                    {/* Market Switcher */}
                    <div className="flex rounded-lg bg-gray-100 p-0.5 border border-gray-200 dark:bg-[#151926] dark:border-[#252b3d] shrink-0">
                        <button
                            onClick={() => handleMarketTypeChange("indian")}
                            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                marketType === "indian"
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                            }`}
                            title="Indian Markets (NSE / BSE Indices & Equities)"
                        >
                            <span>🇮🇳</span>
                            <span className="hidden sm:inline">Indian Market</span>
                            <span className="text-[10px] px-1 py-0.2 rounded bg-black/20 font-mono">NSE</span>
                        </button>
                        <button
                            onClick={() => handleMarketTypeChange("crypto")}
                            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md transition-all ${
                                marketType === "crypto"
                                    ? "bg-purple-600 text-white shadow-xs"
                                    : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                            }`}
                            title="Cryptocurrency Derivatives (BTC, ETH, SOL & Altcoins)"
                        >
                            <span>⚡</span>
                            <span className="hidden sm:inline">Crypto</span>
                            <span className="text-[10px] px-1 py-0.2 rounded bg-black/20 font-mono">24/7</span>
                        </button>
                    </div>

                    <span className="text-gray-300 dark:text-gray-700">|</span>

                    {/* Quick Symbol Chips */}
                    {isCrypto ? (
                        <div className="flex items-center gap-1.5 shrink-0">
                            {CRYPTO_COINS.map((c) => (
                                <button
                                    key={c.symbol}
                                    onClick={() => setSymbol(c.symbol)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold transition-all border ${
                                        symbol === c.symbol
                                            ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                                            : "bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-400 dark:bg-[#151926] dark:text-gray-300 dark:border-[#252b3d] dark:hover:text-white"
                                    }`}
                                >
                                    <span className={symbol === c.symbol ? "text-white" : c.color}>{c.icon}</span>
                                    <span>{c.name}</span>
                                    <span className="text-[10px] opacity-80 font-mono">({c.symbol})</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                            {CORE_INDIAN_CHIPS.map((chip) => {
                                const isActive =
                                    symbol === chip.symbol ||
                                    (chip.symbol === "MIDCPNIFTY" && (symbol === "MIDCAP" || symbol === "MIDCPNIFTY"));
                                return (
                                    <button
                                        key={chip.symbol}
                                        onClick={() => setSymbol(chip.symbol)}
                                        className={`rounded-md px-2.5 py-1 text-xs font-bold transition-all border ${
                                            isActive
                                                ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                                : "bg-gray-50 text-gray-700 border-gray-200 hover:border-gray-400 dark:bg-[#151926] dark:text-gray-300 dark:border-[#252b3d] dark:hover:text-white"
                                        }`}
                                    >
                                        {chip.label}
                                    </button>
                                );
                            })}
                            <select
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value)}
                                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-800 shadow-xs outline-none focus:border-emerald-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 shrink-0 cursor-pointer"
                            >
                                <optgroup label="Other Indices">
                                    {symbolList.indices
                                        .filter((s) => !["NIFTY", "SENSEX", "MIDCPNIFTY"].includes(s))
                                        .map((s) => (
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
                                <optgroup label="Core Indices">
                                    <option value="NIFTY">NIFTY</option>
                                    <option value="SENSEX">SENSEX</option>
                                    <option value="MIDCPNIFTY">MIDCAP (MIDCPNIFTY)</option>
                                </optgroup>
                            </select>
                        </div>
                    )}
                </div>

                {/* Right: Quick Navigation, Shortcuts & Fullscreen Controls */}
                <div className="flex items-center gap-1.5 shrink-0 pl-2">
                    {/* Navigation Bridges */}
                    {isCrypto ? (
                        <Link
                            to="/strategy-builder/crypto"
                            className="hidden sm:flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs font-semibold text-purple-700 hover:border-purple-500 dark:text-purple-300"
                        >
                            <span>Builder</span>
                            <FiExternalLink className="h-3 w-3" />
                        </Link>
                    ) : (
                        <>
                            <Link
                                to={`/option-chain/${symbol.toLowerCase()}`}
                                className="hidden md:flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                                <span>Chain</span>
                                <FiExternalLink className="h-3 w-3" />
                            </Link>
                            <Link
                                to="/strategy-builder"
                                className="hidden sm:flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:border-emerald-500 hover:text-emerald-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                                <span>Builder</span>
                                <FiExternalLink className="h-3 w-3" />
                            </Link>
                        </>
                    )}

                    {/* Shortcuts / Tricks modal */}
                    <button
                        onClick={() => setShowShortcutsModal(true)}
                        className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 shadow-2xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                        title="Drawing Tools & Keyboard Shortcuts"
                    >
                        <FiHelpCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="hidden xl:inline">Hotkeys</span>
                    </button>

                    {/* Fullscreen Toggle */}
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all shadow-2xs border ${
                            isFullscreen
                                ? "bg-rose-600 text-white border-rose-600 hover:bg-rose-700"
                                : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                        }`}
                        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen Workstation"}
                    >
                        {isFullscreen ? (
                            <>
                                <FiMinimize2 className="h-3.5 w-3.5" />
                                <span>Exit</span>
                            </>
                        ) : (
                            <>
                                <FiMaximize2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Fullscreen</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* CHART CONTROLS & INDICATOR RIBBON — DIRECTLY ABOVE THE CHART */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200/80 bg-gray-50/90 px-3 py-1.5 text-xs dark:border-gray-800 dark:bg-[#111722]/90 backdrop-blur-xs shrink-0 z-10">
                {/* Left: Quick Indicators directly toggleable onto the chart */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    <span className="flex items-center gap-1 text-[11px] font-bold text-gray-500 dark:text-gray-400 shrink-0">
                        <span className="font-mono text-emerald-500 dark:text-emerald-400 font-extrabold">fx</span>
                        <span>Indicators:</span>
                    </span>
                    {[
                        { id: "STD;EMA", label: "EMA" },
                        { id: "STD;RSI", label: "RSI" },
                        { id: "STD;MACD", label: "MACD" },
                        { id: "STD;Bollinger_Bands", label: "Bollinger Bands" },
                        { id: "STD;Volume", label: "Volume" },
                        { id: "STD;Supertrend", label: "Supertrend" },
                    ].map((ind) => {
                        const active = chartStudies.includes(ind.id);
                        return (
                            <button
                                key={ind.id}
                                onClick={() => toggleStudy(ind.id)}
                                className={`flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold transition-all border shrink-0 ${
                                    active
                                        ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300 dark:bg-[#151926] dark:text-gray-300 dark:border-[#252b3d] dark:hover:border-gray-600"
                                }`}
                                title={`Toggle ${ind.label} on chart`}
                            >
                                <span>{active ? "✓" : "+"}</span>
                                <span>{ind.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Right: Candle Style Switcher (Candle, Heikin Ashi, Line) & Timeframes / Ranges */}
                <div className="flex items-center gap-2 shrink-0">
                    {/* Style Switcher: Candle, Heikin Ashi, Line (Drawings remain visible) */}
                    <div className="flex items-center gap-1 bg-white dark:bg-[#151926] p-0.5 rounded-lg border border-gray-200 dark:border-[#252b3d]">
                        <span className="px-1.5 text-[10px] font-semibold text-gray-400 uppercase">Style:</span>
                        {[
                            { id: "1", label: "Candle", icon: "🕯️" },
                            { id: "8", label: "Heikin Ashi", icon: "📊" },
                            { id: "2", label: "Line", icon: "📈" },
                        ].map((st) => (
                            <button
                                key={st.id}
                                onClick={() => setChartStyle(st.id)}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold transition-all ${
                                    chartStyle === st.id
                                        ? "bg-emerald-600 text-white shadow-2xs"
                                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                }`}
                                title={`Switch chart series to ${st.label} (drawings & tools remain visible)`}
                            >
                                <span>{st.icon}</span>
                                <span>{st.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* Height Mode Switcher: Fit Screen / 850px / 1000px */}
                    <div className="hidden sm:flex items-center gap-0.5 bg-white dark:bg-[#151926] p-0.5 rounded-lg border border-gray-200 dark:border-[#252b3d]">
                        <span className="px-1 text-[10px] font-semibold text-gray-400 uppercase">Height:</span>
                        {[
                            { id: "screen", label: "Fit Screen", title: "Auto-fit 100% of screen height" },
                            { id: "850", label: "850px", title: "Tall 850px view" },
                            { id: "1000", label: "1000px", title: "Extra tall 1000px view" },
                        ].map((h) => (
                            <button
                                key={h.id}
                                onClick={() => setChartHeightMode(h.id)}
                                className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-all ${
                                    chartHeightMode === h.id
                                        ? "bg-emerald-600 text-white shadow-2xs"
                                        : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                }`}
                                title={h.title}
                            >
                                {h.label}
                            </button>
                        ))}
                    </div>

                    {/* Timeframe & Range Controls */}
                    {chartEngine === "stored_db" && marketType === "indian" ? (
                        <div className="flex items-center gap-1.5">
                            {/* DB Timeframes */}
                            <div className="flex items-center gap-0.5 bg-white dark:bg-[#151926] p-0.5 rounded-lg border border-gray-200 dark:border-[#252b3d]">
                                {TIMEFRAME_OPTIONS.map((tf) => (
                                    <button
                                        key={tf.key}
                                        onClick={() => setTimeframe(tf.key)}
                                        className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-all ${
                                            timeframe === tf.key
                                                ? "bg-emerald-600 text-white shadow-2xs"
                                                : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                        }`}
                                    >
                                        {tf.label}
                                    </button>
                                ))}
                            </div>
                            {/* DB Range */}
                            <div className="hidden sm:flex items-center gap-0.5 bg-white dark:bg-[#151926] p-0.5 rounded-lg border border-gray-200 dark:border-[#252b3d]">
                                {RANGE_OPTIONS.map((r) => (
                                    <button
                                        key={r.label}
                                        onClick={() => setDays(r.days)}
                                        className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-all ${
                                            days === r.days
                                                ? "bg-emerald-600 text-white shadow-2xs"
                                                : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                        }`}
                                    >
                                        {r.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        /* TradingView resolution buttons */
                        <div className="hidden md:flex items-center gap-0.5 bg-white dark:bg-[#151926] p-0.5 rounded-lg border border-gray-200 dark:border-[#252b3d]">
                            {[
                                { id: "1", label: "1m" },
                                { id: "5", label: "5m" },
                                { id: "15", label: "15m" },
                                { id: "60", label: "1H" },
                                { id: "D", label: "1D" },
                                { id: "W", label: "1W" },
                            ].map((tf) => (
                                <button
                                    key={tf.id}
                                    onClick={() => setChartInterval(tf.id)}
                                    className={`px-1.5 py-0.5 rounded text-[11px] font-bold transition-all ${
                                        chartInterval === tf.id
                                            ? "bg-gray-900 text-white dark:bg-gray-700"
                                            : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    {tf.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* FULLSCREEN CHART WORKSTATION BODY */}
            <div
                className="relative flex-1 w-full overflow-hidden bg-white dark:bg-[#0b1420]"
                style={{
                    height: computedChartHeight,
                    minHeight: computedMinHeight,
                }}
            >
                {chartEngine === "tradingview" || isCrypto ? (
                    <TradingViewChart
                        symbol={symbol}
                        interval={chartInterval}
                        chartStyle={chartStyle}
                        studies={chartStudies}
                        height={computedChartHeight}
                        className="h-full w-full"
                    />
                ) : (
                    /* Bazaar Sync Pro Native Engine with all drawing tools and full persistence */
                    <div className="flex-1 w-full h-full min-h-0">
                        {dbLoading ? (
                            <div className="flex h-full items-center justify-center text-xs text-gray-400">
                                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent mr-2" />
                                Loading {symbol} historical candles…
                            </div>
                        ) : dbError ? (
                            <div className="flex h-full items-center justify-center text-xs text-rose-600">
                                Error loading database candles: {dbError}
                            </div>
                        ) : displayCandles.length === 0 ? (
                            <div className="flex h-full items-center justify-center text-xs text-gray-400">
                                No stored data found for {symbol}.
                            </div>
                        ) : (
                            <HistoricalPriceChart
                                points={displayCandles}
                                symbol={symbol}
                                rangeLabel={`${rangeLabel} · ${timeframe}`}
                                externalChartType={chartStyle === "8" ? "heikinashi" : chartStyle === "2" ? "line" : "candles"}
                                externalIndicators={dbIndicators}
                                externalShowVolume={dbShowVolume}
                                hideTopBar={true}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* TRADINGVIEW SHORTCUTS & TRICKS MODAL */}
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
                                        TradingView Hotkeys & Drawing Shortcuts
                                    </h2>
                                    <p className="text-xs text-gray-500">Quick shortcuts to speed up your technical chart analysis</p>
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
                                        <span>Drawing Toolbar:</span> <span className="font-medium text-emerald-600">Left Sidebar</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Technical Indicators:</span> <span className="font-medium text-emerald-600">Top fx Button</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Take Screenshot:</span> <span className="font-medium">Camera Icon (PNG)</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Fullscreen Mode:</span> <span className="font-medium">Top Bar Button</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Cancel Tool / Deselect:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Esc</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Delete Selected:</span> <kbd className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] dark:bg-gray-700">Delete</kbd>
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div className="mt-5 flex justify-end">
                            <button
                                onClick={() => setShowShortcutsModal(false)}
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
