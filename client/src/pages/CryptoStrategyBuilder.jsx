import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
// pages/CryptoStrategyBuilder.jsx — Delta Exchange-Grade Crypto & Bitcoin Options Strategy Builder
// Complete with Live Delta API Option Chain, Hover Buy/Sell triggers, Multi-Leg Strategy Contracts,
// Real-time Payoff Chart with Spot Line, Target Date MTM Curve, Slider, Greeks, and Delta Cyber Theme.

import { Link, useNavigate } from "react-router-dom";
import {
    FiTrendingUp,
    FiTrendingDown,
    FiActivity,
    FiDollarSign,
    FiPercent,
    FiClock,
    FiLayers,
    FiSettings,
    FiSliders,
    FiDownload,
    FiRefreshCw,
    FiCheck,
    FiAlertCircle,
    FiChevronRight,
    FiChevronLeft,
    FiChevronDown,
    FiShield,
    FiZap,
    FiPlus,
    FiMinus,
    FiTrash2,
    FiBarChart2,
    FiPieChart,
    FiCrosshair,
    FiInfo,
    FiShare2,
    FiEye,
    FiX,
    FiCalendar,
    FiPlay,
    FiSave,
    FiCheckCircle,
    FiArrowRight,
    FiLock,
    FiMaximize2,
    FiSearch,
    FiExternalLink,
    FiGrid,
    FiEdit3,
    FiTarget,
    FiBell,
} from "react-icons/fi";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    ReferenceLine,
    ComposedChart,
} from "recharts";
import { bsPrice, calculateGreeks, normCdf } from "../utils/blackScholes";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { saveStrategy } from "../services/strategiesApi";
import TradingViewChart from "../components/TradingViewChart";

const BACKEND_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";

const CRYPTO_COINS = [
    { symbol: "BTC", name: "Bitcoin", icon: "₿", defaultLot: 0.001, leverage: "200x", color: "text-amber-400" },
    { symbol: "ETH", name: "Ethereum", icon: "Ξ", defaultLot: 0.01, leverage: "100x", color: "text-blue-400" },
    { symbol: "SOL", name: "Solana", icon: "◎", defaultLot: 0.1, leverage: "50x", color: "text-purple-400" },
    { symbol: "XAUT", name: "Tether Gold", icon: "🪙", defaultLot: 0.01, leverage: "50x", color: "text-yellow-400", badge: "NEW" },
];

function formatNumber(num, decimals = 2) {
    if (num == null || isNaN(num)) return "0.00";
    return Number(num).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

// Yesterday in IST as YYYY-MM-DD — the latest fully-recorded day for the backtester.
function yesterdayIst() {
    const t = new Date(Date.now() + 5.5 * 3600 * 1000 - 86400 * 1000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
const minuteToHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

function formatCompact(num) {
    if (num == null || isNaN(num)) return "0";
    const n = Math.abs(num);
    if (n >= 1e6) return (num / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (num / 1e3).toFixed(1) + "K";
    return num.toFixed(2);
}

// -------------------------------------------------------------
// SKELETON LOADERS FOR DELTA OBSIDIAN THEME
// -------------------------------------------------------------
function SkeletonBone({ className = "" }) {
    return <div className={`animate-pulse rounded-md bg-[#1d2335]/80 ${className}`} />;
}

function OptionChainSkeletonRows({ rowCount = 14 }) {
    return (
        <>
            {Array.from({ length: rowCount }).map((_, idx) => {
                const isAtmRow = idx === Math.floor(rowCount / 2);
                return (
                    <tr
                        key={`skel-row-${idx}`}
                        className={`border-b border-[#1b2030] transition-colors ${
                            isAtmRow
                                ? "bg-emerald-950/20 border-y border-emerald-500/40"
                                : idx % 2 === 0
                                ? "bg-[#11141f]/50"
                                : "bg-[#141824]/40"
                        }`}
                    >
                        {/* CALL DELTA */}
                        <td className="py-2.5 px-1">
                            <SkeletonBone className="h-3.5 w-7 mx-auto bg-gray-700/40" />
                        </td>
                        {/* CALL BID QTY */}
                        <td className="py-2.5 px-1 hidden md:table-cell">
                            <SkeletonBone className="h-3 w-9 mx-auto bg-gray-800/60" />
                        </td>
                        {/* CALL BID (IV) */}
                        <td className="py-2.5 px-1">
                            <div className="flex flex-col items-center gap-1">
                                <SkeletonBone className="h-3 w-11 bg-emerald-900/30 border border-emerald-500/20" />
                                <SkeletonBone className="h-2 w-7 bg-gray-800/50" />
                            </div>
                        </td>
                        {/* CALL MARK (IV) */}
                        <td className="py-2 px-2 bg-emerald-500/5">
                            <div className="flex flex-col items-center gap-1">
                                <SkeletonBone className="h-4 w-14 bg-emerald-500/20 border border-emerald-500/30" />
                                <SkeletonBone className="h-2 w-8 bg-emerald-500/20" />
                            </div>
                        </td>
                        {/* CALL ASK (IV) */}
                        <td className="py-2.5 px-1">
                            <div className="flex flex-col items-center gap-1">
                                <SkeletonBone className="h-3 w-11 bg-rose-900/30 border border-rose-500/20" />
                                <SkeletonBone className="h-2 w-7 bg-gray-800/50" />
                            </div>
                        </td>
                        {/* CALL ASK QTY */}
                        <td className="py-2.5 px-1 hidden md:table-cell">
                            <SkeletonBone className="h-3 w-9 mx-auto bg-gray-800/60" />
                        </td>
                        {/* CALL OI */}
                        <td className="py-2.5 px-2">
                            <div className="flex items-center justify-end gap-1.5">
                                <SkeletonBone className="h-3 w-10 bg-gray-700/40" />
                                <SkeletonBone className="h-1.5 w-12 bg-emerald-500/20 rounded-full" />
                            </div>
                        </td>

                        {/* STRIKE (CENTER) */}
                        <td className={`py-2 px-3 bg-[#0e111a] border-x border-[#23293d] ${isAtmRow ? "ring-1 ring-emerald-500/40" : ""}`}>
                            <div className="flex items-center justify-center gap-1">
                                <SkeletonBone className={`h-4 w-16 ${isAtmRow ? "bg-amber-500/30 border border-amber-500/50" : "bg-amber-500/20"}`} />
                                {isAtmRow && (
                                    <span className="text-[8px] px-1 py-0.2 rounded bg-emerald-500/30 text-emerald-300 font-extrabold uppercase animate-pulse">
                                        ATM
                                    </span>
                                )}
                            </div>
                        </td>

                        {/* PUT OI */}
                        <td className="py-2.5 px-2">
                            <div className="flex items-center justify-start gap-1.5">
                                <SkeletonBone className="h-1.5 w-12 bg-rose-500/20 rounded-full" />
                                <SkeletonBone className="h-3 w-10 bg-gray-700/40" />
                            </div>
                        </td>
                        {/* PUT BID QTY */}
                        <td className="py-2.5 px-1 hidden md:table-cell">
                            <SkeletonBone className="h-3 w-9 mx-auto bg-gray-800/60" />
                        </td>
                        {/* PUT BID (IV) */}
                        <td className="py-2.5 px-1">
                            <div className="flex flex-col items-center gap-1">
                                <SkeletonBone className="h-3 w-11 bg-emerald-900/30 border border-emerald-500/20" />
                                <SkeletonBone className="h-2 w-7 bg-gray-800/50" />
                            </div>
                        </td>
                        {/* PUT MARK (IV) */}
                        <td className="py-2 px-2 bg-rose-500/5">
                            <div className="flex flex-col items-center gap-1">
                                <SkeletonBone className="h-4 w-14 bg-rose-500/20 border border-rose-500/30" />
                                <SkeletonBone className="h-2 w-8 bg-rose-500/20" />
                            </div>
                        </td>
                        {/* PUT ASK (IV) */}
                        <td className="py-2.5 px-1">
                            <div className="flex flex-col items-center gap-1">
                                <SkeletonBone className="h-3 w-11 bg-rose-900/30 border border-rose-500/20" />
                                <SkeletonBone className="h-2 w-7 bg-gray-800/50" />
                            </div>
                        </td>
                        {/* PUT ASK QTY */}
                        <td className="py-2.5 px-1 hidden md:table-cell">
                            <SkeletonBone className="h-3 w-9 mx-auto bg-gray-800/60" />
                        </td>
                        {/* PUT DELTA */}
                        <td className="py-2.5 px-1">
                            <SkeletonBone className="h-3.5 w-7 mx-auto bg-gray-700/40" />
                        </td>
                    </tr>
                );
            })}
        </>
    );
}

// `historical` = the Crypto Backtester (/simulator/crypto): same UI, but the chain
// comes from real Delta Exchange 1-min history at a chosen date + time (IST)
// instead of the live feed. No live data is used in that mode.
export default function CryptoStrategyBuilder({ historical = false }) {
    const { token, user } = useAuth();
    const selfPath = historical ? "/simulator/crypto" : "/strategy-builder/crypto";
    const coinList = historical ? CRYPTO_COINS.filter((c) => c.symbol !== "XAUT") : CRYPTO_COINS; // no XAUT options history

    // Historical replay clock (only used when `historical`)
    const [histMeta, setHistMeta] = useState({ minDate: "2024-01-01", maxDate: yesterdayIst() });
    const [histDate, setHistDate] = useState(yesterdayIst());
    const [histMinute, setHistMinute] = useState(9 * 60 + 15); // 09:15 IST
    const [isPlaying, setIsPlaying] = useState(false);
    const [playSpeed, setPlaySpeed] = useState(1); // minutes advanced per second
    const histRequestRef = useRef(0);
    const hasChainRef = useRef(false);
    const isAuthenticated = Boolean(user || token);
    const { theme, toggleTheme, isDark } = useTheme();
    const navigate = useNavigate();

    // Option Chain container and ATM strike row refs for auto-centering
    const chainTableContainerRef = useRef(null);
    const atmRowRef = useRef(null);

    // Active Asset & Expiry
    const [selectedCoin, setSelectedCoin] = useState("BTC");
    const [viewMode, setViewMode] = useState("option_chain"); // "option_chain" | "chart"
    const [isStrategyBuilderOpen, setIsStrategyBuilderOpen] = useState(true);

    // Chart Specific Controls
    const [chartInterval, setChartInterval] = useState("15");
    const [chartStyle, setChartStyle] = useState("1"); // "1" = Candles, "8" = Heikin Ashi, "2" = Line
    const [chartStudies, setChartStudies] = useState([
        "STD;EMA",
        "STD;RSI",
        "STD;MACD",
        "STD;Bollinger_Bands",
    ]);

    const toggleStudy = (studyId) => {
        setChartStudies((prev) =>
            prev.includes(studyId) ? prev.filter((s) => s !== studyId) : [...prev, studyId]
        );
    };

    // Live Data State
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [chainData, setChainData] = useState({
        underlying: "BTC",
        spotPrice: 83025.0,
        spot24hChange: -1.25,
        spot24hVol: 20544000,
        expiries: [],
        activeExpiry: null,
        chain: [],
        totalStrikes: 0,
    });
    const [selectedExpiry, setSelectedExpiry] = useState(null);
    const [hoveredLeg, setHoveredLeg] = useState(null); // { strike, type: 'call' | 'put' }

    // Multi-Leg Strategy Builder State
    const [strategyLegs, setStrategyLegs] = useState([]);

    // Delta Exchange Sizing Unit: "contracts" (e.g. 10 Lots) vs "coins" (e.g. 0.010 BTC)
    const [sizingUnit, setSizingUnit] = useState("contracts");
    const [lastSyncTime, setLastSyncTime] = useState(Date.now());
    const [spotFlash, setSpotFlash] = useState(null); // "up" | "down" | null
    const prevSpotRef = useRef(null);

    // Active coin configuration
    const currentCoinConfig = useMemo(() => {
        return CRYPTO_COINS.find((c) => c.symbol === selectedCoin) || CRYPTO_COINS[0];
    }, [selectedCoin]);

    const [globalMultiplier, setGlobalMultiplier] = useState(1);
    const [payoffTab, setPayoffTab] = useState("chart"); // "chart" | "pnl_table" | "greeks"
    const [bottomTab, setBottomTab] = useState("positions"); // "positions" | "open_orders" | "stop_orders" | "fills" | "order_history"
    const [mobileTab, setMobileTab] = useState("chain"); // "chain" | "builder" | "positions"

    // Currency Converter State: USD ($) vs INR (₹)
    const [currency, setCurrency] = useState("USD"); // "USD" | "INR"
    const [usdtInrRate, setUsdtInrRate] = useState(96.80); // Live USDT/INR rate (fallback 96.80)
    const [fxLoading, setFxLoading] = useState(false);
    const [fxLastUpdated, setFxLastUpdated] = useState(null);

    // Fetch Real-time USD/USDT to INR Rate
    const fetchInrRate = useCallback(async () => {
        try {
            setFxLoading(true);
            // 1. Try CoinGecko USDT INR
            const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr");
            if (res.ok) {
                const data = await res.json();
                if (data?.tether?.inr && data.tether.inr > 50) {
                    setUsdtInrRate(data.tether.inr);
                    setFxLastUpdated(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
                    return;
                }
            }
        } catch (e) {
            console.warn("CoinGecko USDT/INR fetch error:", e.message);
        }

        try {
            // 2. Fallback to open exchange rate API
            const res2 = await fetch("https://open.er-api.com/v6/latest/USD");
            if (res2.ok) {
                const data2 = await res2.json();
                if (data2?.rates?.INR && data2.rates.INR > 50) {
                    setUsdtInrRate(data2.rates.INR);
                    setFxLastUpdated(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
                    return;
                }
            }
        } catch (e2) {
            console.warn("Open ER API USD/INR error:", e2.message);
        } finally {
            setFxLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchInrRate();
        const fxTimer = setInterval(fetchInrRate, 60000); // refresh FX rate every 1 min
        return () => clearInterval(fxTimer);
    }, [fetchInrRate]);

    // Format money dynamically based on currency toggle (handles negatives cleanly, e.g. -$0.05)
    const formatMoney = useCallback((amountUsd, decimals = 2) => {
        if (amountUsd == null || isNaN(amountUsd)) return currency === "INR" ? "₹0.00" : "$0.00";
        const isNeg = Number(amountUsd) < 0;
        const absVal = Math.abs(Number(amountUsd));
        if (currency === "INR") {
            const inrVal = absVal * usdtInrRate;
            return `${isNeg ? "-" : ""}₹${Number(inrVal).toLocaleString("en-IN", {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            })}`;
        }
        return `${isNeg ? "-" : ""}$${Number(absVal).toLocaleString("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        })}`;
    }, [currency, usdtInrRate]);

    // Compact money formatting (e.g. $85K or ₹82.4L)
    const formatCompactMoney = useCallback((amountUsd) => {
        if (amountUsd == null || isNaN(amountUsd)) return currency === "INR" ? "₹0" : "$0";
        const val = currency === "INR" ? Number(amountUsd) * usdtInrRate : Number(amountUsd);
        const prefix = currency === "INR" ? "₹" : "$";
        const abs = Math.abs(val);

        if (currency === "INR") {
            if (abs >= 1e7) return `${prefix}${(val / 1e7).toFixed(2)}Cr`;
            if (abs >= 1e5) return `${prefix}${(val / 1e5).toFixed(2)}L`;
            if (abs >= 1e3) return `${prefix}${(val / 1e3).toFixed(1)}K`;
            return `${prefix}${val.toFixed(2)}`;
        }
        if (abs >= 1e6) return `${prefix}${(val / 1e6).toFixed(1)}M`;
        if (abs >= 1e3) return `${prefix}${(val / 1e3).toFixed(1)}K`;
        return `${prefix}${val.toFixed(2)}`;
    }, [currency, usdtInrRate]);

    // Target Price Slider State
    const [targetPrice, setTargetPrice] = useState(83025.0);
    const [targetDaysAhead, setTargetDaysAhead] = useState(0); // 0 = today/now, max = expiry

    // -------------------------------------------------------------
    // STOP LOSS & TAKE PROFIT (RISK MANAGEMENT ENGINE)
    // -------------------------------------------------------------
    const [enableStopLoss, setEnableStopLoss] = useState(true);
    const [slType, setSlType] = useState("mtm_loss"); // "mtm_loss" ($) | "pct_loss" (%) | "spot_price" ($ Spot)
    const [slValue, setSlValue] = useState(150); // $150 default MTM SL
    const [enableTakeProfit, setEnableTakeProfit] = useState(true);
    const [tpType, setTpType] = useState("mtm_profit"); // "mtm_profit" ($) | "pct_profit" (%) | "spot_price" ($ Spot)
    const [tpValue, setTpValue] = useState(300); // $300 default MTM TP
    const [trailingSL, setTrailingSL] = useState(false);
    const [trailStep, setTrailStep] = useState(25);
    const [isSlModalOpen, setIsSlModalOpen] = useState(false); // Controls the Stop Loss Dialog Box modal

    // Specific Buy Leg SL Modal State
    const [activeBuyLegForSl, setActiveBuyLegForSl] = useState(null);
    const [legSlPctInput, setLegSlPctInput] = useState(25);
    const [legTpPctInput, setLegTpPctInput] = useState(50);
    const [legSlEnabled, setLegSlEnabled] = useState(true);
    const [legTpEnabled, setLegTpEnabled] = useState(true);

    // Demo wallet capital (initial $12,810 simulated demo funds)
    const [demoBalance, setDemoBalance] = useState(12810);
    const positionsPanelRef = useRef(null);

    // Positions & Order Management State (Empty until trades are placed / logged in)
    const [positions, setPositions] = useState([]);
    const [stopOrders, setStopOrders] = useState([]);
    const [openOrders, setOpenOrders] = useState([]);
    const [fills, setFills] = useState([]);
    const [orderHistory, setOrderHistory] = useState([]);

    // Modal state for modifying Stop Loss on an existing position / order
    const [editingSlItem, setEditingSlItem] = useState(null);
    const [editSlValue, setEditSlValue] = useState("");
    const [editTpValue, setEditTpValue] = useState("");

    // Notification message
    const [orderSuccessMsg, setOrderSuccessMsg] = useState(null);
    const [saveSuccessMsg, setSaveSuccessMsg] = useState(null);

    // -------------------------------------------------------------
    // 1. FETCH LIVE CRYPTO OPTION CHAIN (DELTA API PROXY)
    // -------------------------------------------------------------
    const fetchOptionChain = useCallback(async (isSilent = false) => {
        // While replaying, stepping the clock shouldn't flash the skeleton once a chain is on screen.
        const silent = isSilent || (historical && hasChainRef.current);
        if (!silent) setLoading(true);
        else setRefreshing(true);
        setError(null);
        const requestId = ++histRequestRef.current;

        if (historical) {
            try {
                const url = `${BACKEND_BASE}/api/crypto/history/chain?underlying=${selectedCoin}&date=${histDate}&time=${minuteToHHMM(histMinute)}${selectedExpiry ? `&expiry=${encodeURIComponent(selectedExpiry)}` : ""}`;
                const res = await fetch(url);
                const data = await res.json().catch(() => ({}));
                if (requestId !== histRequestRef.current) return; // a newer scrub already won
                if (!res.ok) throw new Error(data.error || `HTTP ${res.status}: Failed to load historical chain`);
                setChainData(data);
                hasChainRef.current = (data.chain || []).length > 0;
                setLastSyncTime(Date.now());
                prevSpotRef.current = data.spotPrice;
                // The chosen expiry may have settled by this minute — follow the server's pick.
                if (data.activeExpiry?.raw && data.activeExpiry.raw !== selectedExpiry) setSelectedExpiry(data.activeExpiry.raw);
                if (data.spotPrice && (!targetPrice || targetPrice === 83025.0)) setTargetPrice(data.spotPrice);
            } catch (err) {
                if (requestId !== histRequestRef.current) return;
                setError(err.message);
                setIsPlaying(false);
            } finally {
                if (requestId === histRequestRef.current) {
                    setLoading(false);
                    setRefreshing(false);
                }
            }
            return;
        }

        try {
            const url = `${BACKEND_BASE}/api/crypto/option-chain?underlying=${selectedCoin}${selectedExpiry ? `&expiry=${encodeURIComponent(selectedExpiry)}` : ""}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch option chain`);
            const data = await res.json();

            setChainData(data);
            setLastSyncTime(Date.now());
            if (prevSpotRef.current !== null && data.spotPrice) {
                if (data.spotPrice > prevSpotRef.current) {
                    setSpotFlash("up");
                    setTimeout(() => setSpotFlash(null), 1200);
                } else if (data.spotPrice < prevSpotRef.current) {
                    setSpotFlash("down");
                    setTimeout(() => setSpotFlash(null), 1200);
                }
            }
            prevSpotRef.current = data.spotPrice;

            if (!selectedExpiry && data.activeExpiry?.raw) {
                setSelectedExpiry(data.activeExpiry.raw);
            }
            if (data.spotPrice && (!targetPrice || targetPrice === 83025.0)) {
                setTargetPrice(data.spotPrice);
            }
        } catch (err) {
            console.warn("[CryptoStrategy] Delta API Proxy fetch error, fallback to mock generation:", err.message);
            // Fallback generation if local backend is offline
            generateFallbackChain(selectedCoin);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [selectedCoin, selectedExpiry, historical, histDate, histMinute]);

    const generateFallbackChain = (coin) => {
        const spot = coin === "BTC" ? 85289.5 : coin === "ETH" ? 3492.0 : coin === "SOL" ? 156.0 : 2750.0;
        const step = coin === "BTC" ? 200 : coin === "ETH" ? 25 : coin === "SOL" ? 2 : 10;
        const baseStrike = Math.round(spot / step) * step;
        const expiries = [
            { raw: "2026-10-11T12:00:00Z", label: "11 Oct 26", timeToExpiry: "1d:2h:27m", timestamp: Date.now() + 86400000 },
            { raw: "2026-10-12T12:00:00Z", label: "12 Oct 26", timeToExpiry: "2d:2h:27m", timestamp: Date.now() + 172800000 },
            { raw: "2026-10-16T12:00:00Z", label: "16 Oct 26", timeToExpiry: "6d:2h:27m", timestamp: Date.now() + 518400000 },
            { raw: "2026-10-23T12:00:00Z", label: "23 Oct 26", timeToExpiry: "13d:2h:27m", timestamp: Date.now() + 1123200000 },
            { raw: "2026-10-30T12:00:00Z", label: "30 Oct 26", timeToExpiry: "20d:2h:27m", timestamp: Date.now() + 1728000000 },
        ];

        const rows = [];
        for (let i = -15; i <= 15; i++) {
            const strike = baseStrike + i * step;
            const diff = strike - spot;
            const callMark = Math.max(10, Math.round(spot * 0.03 * Math.exp(-diff / (spot * 0.1))));
            const putMark = Math.max(10, Math.round(spot * 0.03 * Math.exp(diff / (spot * 0.1))));

            rows.push({
                strike,
                call: {
                    symbol: `C-${coin}-${strike}`,
                    strike,
                    markPrice: callMark,
                    markIv: 21.5 + Math.abs(i) * 0.4,
                    bidPrice: Math.round(callMark * 0.98),
                    bidIv: 20.8,
                    bidQty: 3.732,
                    askPrice: Math.round(callMark * 1.02),
                    askIv: 22.1,
                    askQty: 2.488,
                    oi: 120 + Math.abs(i) * 15,
                    oiValueUsd: (120 + Math.abs(i) * 15) * spot * 0.05,
                    delta: Math.max(0.05, Math.min(0.95, 0.5 - diff / (spot * 0.2))),
                    oiPercent: Math.min(100, Math.max(15, 80 - Math.abs(i) * 4)),
                },
                put: {
                    symbol: `P-${coin}-${strike}`,
                    strike,
                    markPrice: putMark,
                    markIv: 20.5 + Math.abs(i) * 0.4,
                    bidPrice: Math.round(putMark * 0.98),
                    bidIv: 19.8,
                    bidQty: 3.732,
                    askPrice: Math.round(putMark * 1.02),
                    askIv: 21.2,
                    askQty: 2.488,
                    oi: 140 + Math.abs(i) * 12,
                    oiValueUsd: (140 + Math.abs(i) * 12) * spot * 0.05,
                    delta: Math.min(-0.05, Math.max(-0.95, -0.5 - diff / (spot * 0.2))),
                    oiPercent: Math.min(100, Math.max(15, 85 - Math.abs(i) * 4)),
                }
            });
        }

        setChainData({
            underlying: coin,
            spotPrice: spot,
            spot24hChange: -1.25,
            spot24hVol: 20544000,
            expiries,
            activeExpiry: expiries[0],
            chain: rows,
            totalStrikes: rows.length,
        });
        setTargetPrice(spot);
    };

    useEffect(() => {
        fetchOptionChain();
        if (historical) return undefined; // replay: refetch only when date / time / coin / expiry change
        const timer = setInterval(() => fetchOptionChain(true), 2500);
        return () => clearInterval(timer);
    }, [fetchOptionChain, historical]);

    // Backtester: date bounds from the server, and the replay clock.
    useEffect(() => {
        if (!historical) return undefined;
        let cancelled = false;
        fetch(`${BACKEND_BASE}/api/crypto/history/meta`)
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => {
                if (!cancelled && m?.minDate && m?.maxDate) setHistMeta({ minDate: m.minDate, maxDate: m.maxDate });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [historical]);

    useEffect(() => {
        if (!historical || !isPlaying) return undefined;
        const timer = setInterval(() => {
            setHistMinute((m) => {
                const next = m + playSpeed;
                if (next >= 1439) {
                    setIsPlaying(false);
                    return 1439;
                }
                return next;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [historical, isPlaying, playSpeed]);

    const stepHistMinute = (delta) => setHistMinute((m) => Math.min(1439, Math.max(0, m + delta)));
    // -------------------------------------------------------------
    // ATM STRIKE COMPUTATION & AUTO-SCROLL TO CENTER
    // -------------------------------------------------------------
    const atmStrike = useMemo(() => {
        if (!chainData.chain || chainData.chain.length === 0 || !chainData.spotPrice) return null;
        let closest = chainData.chain[0]?.strike;
        let minDiff = Math.abs(closest - chainData.spotPrice);
        for (const row of chainData.chain) {
            const diff = Math.abs(row.strike - chainData.spotPrice);
            if (diff < minDiff) {
                minDiff = diff;
                closest = row.strike;
            }
        }
        return closest;
    }, [chainData.chain, chainData.spotPrice]);

    // Keep ATM Strike centered in the Option Chain table
    useEffect(() => {
        if (!loading && atmRowRef.current && chainTableContainerRef.current) {
            const timer = setTimeout(() => {
                const container = chainTableContainerRef.current;
                const row = atmRowRef.current;
                if (!container || !row) return;
                const rowTop = row.offsetTop;
                const rowHeight = row.offsetHeight;
                const containerHeight = container.clientHeight;
                const targetScrollTop = rowTop - (containerHeight / 2) + (rowHeight / 2);

                container.scrollTo({
                    top: Math.max(0, targetScrollTop),
                    behavior: "smooth",
                });
            }, 150);
            return () => clearTimeout(timer);
        }
    }, [atmStrike, selectedCoin, selectedExpiry, loading]);

    // -------------------------------------------------------------
    // 2. STRATEGY LEGS INTERACTION (HOVER BUY/SELL & ADD/REMOVE)
    // -------------------------------------------------------------
    const handleAddLeg = (option, action = "BUY") => {
        if (!option) return;
        const act = action.toUpperCase();
        const contractVal = option.contractValue || currentCoinConfig.defaultLot || 0.001;

        // Delta Exchange Live Mark Price
        const markP = option.markPrice && option.markPrice > 0 ? option.markPrice : (option.bidPrice || option.askPrice || 100);

        // Check if this strike & type already exists in legs
        const existingIdx = strategyLegs.findIndex(
            (l) => l.strike === option.strike && l.type?.toLowerCase() === (option.contractType || "").toLowerCase()
        );

        if (existingIdx !== -1) {
            setStrategyLegs((prev) =>
                prev.map((l, i) => {
                    if (i === existingIdx) {
                        if (l.action === act) {
                            return { ...l, lots: (l.lots || 1) + 1, selected: true };
                        } else {
                            return { ...l, action: act, selected: true };
                        }
                    }
                    return l;
                })
            );
            if (!isStrategyBuilderOpen) setIsStrategyBuilderOpen(true);
            return;
        }

        const newLeg = {
            id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            symbol: option.symbol || `${option.contractType === "call" ? "C" : "P"}-${selectedCoin}-${option.strike}`,
            action: act,
            type: option.contractType?.toUpperCase() || (option.symbol?.startsWith("C") ? "CALL" : "PUT"),
            strike: option.strike,
            expiry: chainData.activeExpiry?.label || "11 Oct 26",
            lots: 1, // Number of contracts
            contractValue: contractVal, // e.g. 0.001 for BTC
            price: markP, // Live Mark Price
            markPrice: markP,
            bidPrice: option.bidPrice || 0,
            askPrice: option.askPrice || 0,
            iv: option.markIv || 22.0,
            delta: option.delta != null ? Number(option.delta) : (option.contractType === "call" ? 0.5 : -0.5),
            gamma: option.gamma != null ? Number(option.gamma) : 0.0002,
            theta: option.theta != null ? Number(option.theta) : -1.5,
            vega: option.vega != null ? Number(option.vega) : 3.0,
            leverage: currentCoinConfig.leverage || "100x",
            selected: true,
            // Percentage SL only applies to BUY legs, never to SELL legs
            slPct: act === "BUY" ? 25 : null,
            tpPct: act === "BUY" ? 50 : null,
        };
        setStrategyLegs((prev) => [...prev, newLeg]);
        if (!isStrategyBuilderOpen) setIsStrategyBuilderOpen(true);
    };

    const handleRemoveLeg = (id) => {
        setStrategyLegs((prev) => prev.filter((l) => l.id !== id));
    };

    const handleToggleLegSelection = (id) => {
        setStrategyLegs((prev) => prev.map((l) => l.id === id ? { ...l, selected: !l.selected } : l));
    };

    const handleSelectAllLegs = (selected) => {
        setStrategyLegs((prev) => prev.map((l) => ({ ...l, selected })));
    };

    const handleClearAllLegs = () => {
        setStrategyLegs([]);
    };

    // 1-Click Delta Exchange Pre-Built Strategy Mapper
    const handleApplyPresetStrategy = (presetKey) => {
        if (!chainData.chain || chainData.chain.length === 0) return;
        const strikes = chainData.chain.map((r) => r.strike).sort((a, b) => a - b);
        let atmIdx = strikes.indexOf(atmStrike);
        if (atmIdx === -1) {
            let minDist = Infinity;
            strikes.forEach((s, idx) => {
                const dist = Math.abs(s - (chainData.spotPrice || 82000));
                if (dist < minDist) {
                    minDist = dist;
                    atmIdx = idx;
                }
            });
        }
        if (atmIdx === -1) atmIdx = Math.floor(strikes.length / 2);

        const getOptionAt = (offset, type) => {
            const idx = Math.max(0, Math.min(strikes.length - 1, atmIdx + offset));
            const row = chainData.chain.find((r) => r.strike === strikes[idx]);
            if (!row) return null;
            return type === "CALL" ? row.call : row.put;
        };

        const newLegs = [];
        const expLabel = chainData.activeExpiry?.label || "11 Oct 26";
        const cVal = currentCoinConfig.defaultLot || 0.001;

        const addPresetLeg = (opt, action, type) => {
            if (!opt) return;
            const markP = opt.markPrice && opt.markPrice > 0 ? opt.markPrice : (opt.bidPrice || opt.askPrice || 100);
            newLegs.push({
                id: `leg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                symbol: opt.symbol || `${type === "CALL" ? "C" : "P"}-${selectedCoin}-${opt.strike}`,
                action,
                type,
                strike: opt.strike,
                expiry: expLabel,
                lots: 1,
                contractValue: cVal,
                price: markP,
                markPrice: markP,
                bidPrice: opt.bidPrice || 0,
                askPrice: opt.askPrice || 0,
                iv: opt.markIv || 25.0,
                delta: opt.delta != null ? Number(opt.delta) : (type === "CALL" ? 0.5 : -0.5),
                gamma: opt.gamma != null ? Number(opt.gamma) : 0.0002,
                theta: opt.theta != null ? Number(opt.theta) : -1.5,
                vega: opt.vega != null ? Number(opt.vega) : 3.0,
                leverage: currentCoinConfig.leverage || "100x",
                selected: true,
                slPct: action === "BUY" ? 25 : null,
                tpPct: action === "BUY" ? 50 : null,
            });
        };

        if (presetKey === "bull_call_spread") {
            addPresetLeg(getOptionAt(0, "CALL"), "BUY", "CALL");
            addPresetLeg(getOptionAt(1, "CALL"), "SELL", "CALL");
        } else if (presetKey === "bear_put_spread") {
            addPresetLeg(getOptionAt(0, "PUT"), "BUY", "PUT");
            addPresetLeg(getOptionAt(-1, "PUT"), "SELL", "PUT");
        } else if (presetKey === "long_straddle") {
            addPresetLeg(getOptionAt(0, "CALL"), "BUY", "CALL");
            addPresetLeg(getOptionAt(0, "PUT"), "BUY", "PUT");
        } else if (presetKey === "long_strangle") {
            addPresetLeg(getOptionAt(1, "CALL"), "BUY", "CALL");
            addPresetLeg(getOptionAt(-1, "PUT"), "BUY", "PUT");
        } else if (presetKey === "iron_condor") {
            addPresetLeg(getOptionAt(-2, "PUT"), "BUY", "PUT");
            addPresetLeg(getOptionAt(-1, "PUT"), "SELL", "PUT");
            addPresetLeg(getOptionAt(1, "CALL"), "SELL", "CALL");
            addPresetLeg(getOptionAt(2, "CALL"), "BUY", "CALL");
        }

        if (newLegs.length > 0) {
            setStrategyLegs(newLegs);
            if (!isStrategyBuilderOpen) setIsStrategyBuilderOpen(true);
        }
    };

    const handleUpdateLegAction = (id, newAction) => {
        setStrategyLegs((prev) =>
            prev.map((l) =>
                l.id === id
                    ? {
                          ...l,
                          action: newAction,
                          // Percentage SL only applies to BUY legs, never to SELL legs
                          slPct: newAction === "BUY" ? (l.slPct ?? 25) : null,
                          tpPct: newAction === "BUY" ? (l.tpPct ?? 50) : null,
                      }
                    : l
            )
        );
    };

    // Open dedicated % SL/TP modal for a specific BUY leg
    const handleOpenLegSlModal = (leg) => {
        setActiveBuyLegForSl(leg);
        setLegSlPctInput(leg.slPct ?? 25);
        setLegTpPctInput(leg.tpPct ?? 50);
        setLegSlEnabled(leg.slPct !== null && leg.slPct !== undefined);
        setLegTpEnabled(leg.tpPct !== null && leg.tpPct !== undefined);
        setIsSlModalOpen(true);
    };

    // Save % SL/TP for the active BUY leg
    const handleSaveLegSl = () => {
        if (activeBuyLegForSl) {
            setStrategyLegs((prev) =>
                prev.map((l) =>
                    l.id === activeBuyLegForSl.id
                        ? {
                              ...l,
                              slPct: legSlEnabled ? Number(legSlPctInput) : null,
                              tpPct: legTpEnabled ? Number(legTpPctInput) : null,
                          }
                        : l
                )
            );
        }
        setIsSlModalOpen(false);
        setActiveBuyLegForSl(null);
        setOrderSuccessMsg(`✅ Stop Loss / Take Profit % applied to ${activeBuyLegForSl?.symbol || "Buy leg"}!`);
        setTimeout(() => setOrderSuccessMsg(null), 3000);
    };

    const handleUpdateLegLots = (id, delta) => {
        setStrategyLegs((prev) => prev.map((l) => {
            if (l.id === id) {
                const updated = Math.max(1, (l.lots || 1) + delta);
                return { ...l, lots: updated };
            }
            return l;
        }));
    };

    const handleSetLegLots = (id, exactLots) => {
        setStrategyLegs((prev) => prev.map((l) => {
            if (l.id === id) {
                const updated = Math.max(1, Math.round(Number(exactLots)) || 1);
                return { ...l, lots: updated };
            }
            return l;
        }));
    };

    const handleSetLegCoinQty = (id, coinQty) => {
        setStrategyLegs((prev) => prev.map((l) => {
            if (l.id === id) {
                const cVal = l.contractValue || currentCoinConfig.defaultLot || 0.001;
                const computedLots = Math.max(1, Math.round(Number(coinQty) / cVal));
                return { ...l, lots: computedLots };
            }
            return l;
        }));
    };

    const handleUpdateLegPrice = (id, newPrice) => {
        setStrategyLegs((prev) => prev.map((l) => {
            if (l.id === id) {
                return { ...l, price: Math.max(0.01, Number(newPrice)) };
            }
            return l;
        }));
    };

    // Check if contract is already in active strategy
    const isContractSelected = (strike, type) => {
        return strategyLegs.some(
            (l) => l.strike === strike && l.type?.toLowerCase() === type?.toLowerCase() && l.selected
        );
    };

    // -------------------------------------------------------------
    // 3. PAYOFF CALCULATIONS & METRICS ENGINE
    // -------------------------------------------------------------
    const activeSelectedLegs = useMemo(() => {
        return strategyLegs.filter((l) => l.selected);
    }, [strategyLegs]);

    const payoffMetrics = useMemo(() => {
        if (activeSelectedLegs.length === 0) {
            return {
                maxProfit: 0,
                maxLoss: 0,
                rewardRisk: 0,
                breakevens: [],
                orderMargin: 0,
                totalNetPremium: 0,
                totalNotionalUsd: 0,
                totalCoins: 0,
                chartData: [],
            };
        }

        const spot = chainData.spotPrice || 83025.0;
        const minPrice = spot * 0.75;
        const maxPrice = spot * 1.25;
        const steps = 80;
        const priceStep = (maxPrice - minPrice) / steps;

        const chartData = [];
        let maxP = -Infinity;
        let minP = Infinity;
        let breakevens = [];
        let prevPnl = null;

        for (let p = minPrice; p <= maxPrice; p += priceStep) {
            let expiryPnl = 0;
            let targetPnl = 0;

            activeSelectedLegs.forEach((leg) => {
                const cVal = leg.contractValue || currentCoinConfig.defaultLot || 0.001;
                // Coin volume = lots * contractValue * globalMultiplier (Delta Exchange coin sizing)
                const coinVolume = (leg.lots || 1) * cVal * globalMultiplier;
                const isBuy = leg.action === "BUY";
                const isCall = leg.type === "CALL";
                const k = leg.strike;
                const premium = leg.price || leg.markPrice || 100;

                // Expiry Payoff per full coin
                let intrinsic = 0;
                if (isCall) intrinsic = Math.max(0, p - k);
                else intrinsic = Math.max(0, k - p);

                const legExpiryPnl = isBuy ? (intrinsic - premium) * coinVolume : (premium - intrinsic) * coinVolume;
                expiryPnl += legExpiryPnl;

                // Target Date Projected Payoff (Black-Scholes dynamic MTM curve)
                const tDays = Math.max(0.01, 1 - targetDaysAhead / 30);
                const bsTheoretical = bsPrice(p, k, tDays, 0.05, (leg.iv || 22) / 100, isCall ? "call" : "put");
                const legTargetPnl = isBuy ? (bsTheoretical - premium) * coinVolume : (premium - bsTheoretical) * coinVolume;
                targetPnl += legTargetPnl;
            });

            if (expiryPnl > maxP) maxP = expiryPnl;
            if (expiryPnl < minP) minP = expiryPnl;

            // Detect breakevens
            if (prevPnl !== null && ((prevPnl < 0 && expiryPnl >= 0) || (prevPnl > 0 && expiryPnl <= 0))) {
                breakevens.push(Math.round(p));
            }
            prevPnl = expiryPnl;

            chartData.push({
                price: Math.round(p),
                expiryPnl: parseFloat(expiryPnl.toFixed(2)),
                targetPnl: parseFloat(targetPnl.toFixed(2)),
                profitArea: expiryPnl >= 0 ? parseFloat(expiryPnl.toFixed(2)) : 0,
                lossArea: expiryPnl < 0 ? parseFloat(expiryPnl.toFixed(2)) : 0,
            });
        }

        const maxLoss = minP < 0 ? Math.abs(minP) : 0;
        const rewardRisk = maxLoss > 0 ? (maxP / maxLoss).toFixed(2) : "∞";

        // Delta Exchange Initial Margin & Net Premium
        let totalNetPremium = 0;
        let totalRequiredMargin = 0;
        let totalNotionalUsd = 0;
        let totalCoins = 0;

        activeSelectedLegs.forEach((leg) => {
            const cVal = leg.contractValue || currentCoinConfig.defaultLot || 0.001;
            const coinVolume = (leg.lots || 1) * cVal * globalMultiplier;
            const prem = (leg.price || leg.markPrice || 0) * coinVolume;
            const notional = spot * coinVolume;

            totalCoins += coinVolume;
            totalNotionalUsd += notional;

            if (leg.action === "BUY") {
                totalNetPremium -= prem; // Cash outflow
                totalRequiredMargin += prem; // Max loss is premium paid
            } else {
                totalNetPremium += prem; // Cash inflow (credit)
                totalRequiredMargin += notional * 0.05; // 5% initial margin for short option
            }
        });

        return {
            maxProfit: maxP > 0 ? maxP : 0,
            maxLoss: minP < 0 ? minP : 0,
            rewardRisk,
            breakevens,
            orderMargin: Math.max(0.5, totalRequiredMargin),
            totalNetPremium,
            totalNotionalUsd,
            totalCoins,
            chartData,
        };
    }, [activeSelectedLegs, globalMultiplier, chainData.spotPrice, targetDaysAhead, currentCoinConfig]);

    // Strategy Portfolio Greeks calculation (Delta, Gamma, Theta, Vega)
    const strategyGreeks = useMemo(() => {
        let netDelta = 0;
        let netGamma = 0;
        let netTheta = 0;
        let netVega = 0;

        activeSelectedLegs.forEach((leg) => {
            const cVal = leg.contractValue || currentCoinConfig.defaultLot || 0.001;
            const volume = (leg.lots || 1) * cVal * globalMultiplier;
            const direction = leg.action === "BUY" ? 1 : -1;

            const d = leg.delta != null ? Number(leg.delta) : (leg.type === "CALL" ? 0.5 : -0.5);
            const g = leg.gamma != null ? Number(leg.gamma) : 0.0002;
            const t = leg.theta != null ? Number(leg.theta) : -1.5;
            const v = leg.vega != null ? Number(leg.vega) : 3.0;

            netDelta += direction * d * volume;
            netGamma += direction * g * volume;
            netTheta += direction * t * volume;
            netVega += direction * v * volume;
        });

        return {
            delta: netDelta,
            gamma: netGamma,
            theta: netTheta,
            vega: netVega,
        };
    }, [activeSelectedLegs, globalMultiplier, currentCoinConfig]);

    // Current PNL at Target Price
    const targetPricePnl = useMemo(() => {
        if (activeSelectedLegs.length === 0) return 0;
        let pnl = 0;
        activeSelectedLegs.forEach((leg) => {
            const cVal = leg.contractValue || currentCoinConfig.defaultLot || 0.001;
            const coinVolume = (leg.lots || 1) * cVal * globalMultiplier;
            const isBuy = leg.action === "BUY";
            const isCall = leg.type === "CALL";
            const k = leg.strike;
            const premium = leg.price || leg.markPrice || 100;
            let intrinsic = isCall ? Math.max(0, targetPrice - k) : Math.max(0, k - targetPrice);
            pnl += isBuy ? (intrinsic - premium) * coinVolume : (premium - intrinsic) * coinVolume;
        });
        return pnl;
    }, [activeSelectedLegs, globalMultiplier, targetPrice, currentCoinConfig]);

    // Live portfolio summary across all open positions
    const portfolioSummary = useMemo(() => {
        let totalUnrealizedPnl = 0;
        let totalMarginUsed = 0;
        let totalNotional = 0;

        positions.forEach((pos) => {
            totalUnrealizedPnl += Number(pos.unrealizedPnl || 0);
            totalMarginUsed += Number(pos.margin || 0);
            const cVal = pos.contractValue || (pos.coinSymbol === "BTC" ? 0.001 : 0.01);
            totalNotional += (pos.lots || 1) * cVal * (chainData.spotPrice || 82000);
        });

        return {
            totalUnrealizedPnl,
            totalMarginUsed,
            totalNotional,
            count: positions.length,
        };
    }, [positions, chainData.spotPrice]);

    // Update live positions mark price and unrealized P&L when chainData refreshes
    useEffect(() => {
        if (!chainData?.chain || positions.length === 0) return;
        setPositions((prevPositions) => {
            let hasChanged = false;
            const updated = prevPositions.map((pos) => {
                // Only reprice from the chain this position belongs to (same coin + expiry) —
                // otherwise viewing another expiry/coin, or an expiry settling mid-replay,
                // would mark it with an unrelated contract's price.
                if (pos.coinSymbol && chainData.underlying && pos.coinSymbol !== chainData.underlying) return pos;
                if (pos.expiry && chainData.activeExpiry?.label && pos.expiry !== chainData.activeExpiry.label) return pos;
                const row = chainData.chain.find((r) => r.strike === pos.strike);
                if (!row) return pos;
                const optionData = pos.type === "CALL" ? row.call : row.put;
                const currentMark = optionData?.markPrice != null ? optionData.markPrice : pos.markPrice;
                if (currentMark == null) return pos;

                const cVal = pos.contractValue || (pos.coinSymbol === "BTC" ? 0.001 : 0.01);
                const volume = (pos.lots || 1) * cVal;
                const isBuy = pos.side === "BUY";
                const pnl = isBuy
                    ? (currentMark - pos.entryPrice) * volume
                    : (pos.entryPrice - currentMark) * volume;
                const pnlPct = pos.entryPrice > 0
                    ? isBuy
                        ? ((currentMark - pos.entryPrice) / pos.entryPrice) * 100
                        : ((pos.entryPrice - currentMark) / pos.entryPrice) * 100
                    : 0;

                if (Math.abs(currentMark - pos.markPrice) > 0.0001 || Math.abs(pnl - pos.unrealizedPnl) > 0.005) {
                    hasChanged = true;
                    return {
                        ...pos,
                        markPrice: currentMark,
                        unrealizedPnl: pnl,
                        pnlPct: pnlPct,
                    };
                }
                return pos;
            });
            return hasChanged ? updated : prevPositions;
        });
    }, [chainData]);

    // -------------------------------------------------------------
    // 4. ORDER EXECUTION & STOP LOSS MANAGEMENT ENGINE
    // -------------------------------------------------------------
    const handlePlaceOrder = () => {
        if (activeSelectedLegs.length === 0) return;
        const now = new Date();
        const timestamp = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const dateStr = `${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${timestamp}`;

        const newPositions = [];
        const newStopOrders = [];
        const newFills = [];
        const newHistory = [];

        activeSelectedLegs.forEach((leg, idx) => {
            const posId = `pos-${Date.now()}-${idx}`;
            const soId = `SO-${Math.floor(1000 + Math.random() * 9000)}`;
            const tpId = `TP-${Math.floor(1000 + Math.random() * 9000)}`;
            const ordId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
            const entryPrice = leg.price || leg.markPrice || 100;
            const cVal = leg.contractValue || currentCoinConfig.defaultLot || 0.001;
            const coinQty = (leg.lots || 1) * cVal;
            const sizeStr = `${leg.lots || 1} Ctr (${coinQty.toFixed(3)} ${selectedCoin})`;
            const legMargin = (payoffMetrics.orderMargin || 100) / (activeSelectedLegs.length || 1);

            // Calculate SL Trigger Description & Price
            let slText = "None";
            let slPrice = null;
            if (enableStopLoss) {
                if (slType === "mtm_loss") {
                    slText = `-$${slValue} MTM`;
                    slPrice = leg.action === "BUY" ? Math.max(1, entryPrice * 0.7) : entryPrice * 1.3;
                } else if (slType === "pct_loss") {
                    slText = `-${slValue}% Loss`;
                    slPrice = leg.action === "BUY" ? entryPrice * (1 - slValue / 100) : entryPrice * (1 + slValue / 100);
                } else {
                    slText = `Spot @ $${Number(slValue).toLocaleString()}`;
                    slPrice = leg.action === "BUY" ? entryPrice * 0.8 : entryPrice * 1.2;
                }

                newStopOrders.push({
                    id: soId,
                    contract: `${selectedCoin} ${leg.strike?.toLocaleString()} ${leg.type === "CALL" ? "CE" : "PE"}`,
                    type: "STOP_LOSS",
                    condition:
                        slType === "spot_price"
                            ? `${selectedCoin} Spot <= $${slValue}`
                            : `Mark ${leg.action === "BUY" ? "<=" : ">="} $${formatNumber(slPrice)}`,
                    triggerPrice: slPrice,
                    orderType: "Market SL",
                    status: "ACTIVE",
                    createdAt: dateStr,
                    posId,
                });
            }

            // Calculate TP Trigger Description & Price
            let tpText = "None";
            let tpPrice = null;
            if (enableTakeProfit) {
                if (tpType === "mtm_profit") {
                    tpText = `+$${tpValue} MTM`;
                    tpPrice = leg.action === "BUY" ? entryPrice * 1.5 : Math.max(1, entryPrice * 0.5);
                } else if (tpType === "pct_profit") {
                    tpText = `+${tpValue}% Gain`;
                    tpPrice = leg.action === "BUY" ? entryPrice * (1 + tpValue / 100) : Math.max(1, entryPrice * (1 - tpValue / 100));
                } else {
                    tpText = `Spot @ $${Number(tpValue).toLocaleString()}`;
                    tpPrice = leg.action === "BUY" ? entryPrice * 1.3 : Math.max(1, entryPrice * 0.7);
                }

                newStopOrders.push({
                    id: tpId,
                    contract: `${selectedCoin} ${leg.strike?.toLocaleString()} ${leg.type === "CALL" ? "CE" : "PE"}`,
                    type: "TAKE_PROFIT",
                    condition:
                        tpType === "spot_price"
                            ? `${selectedCoin} Spot >= $${tpValue}`
                            : `Mark ${leg.action === "BUY" ? ">=" : "<="} $${formatNumber(tpPrice)}`,
                    triggerPrice: tpPrice,
                    orderType: "Market TP",
                    status: "ACTIVE",
                    createdAt: dateStr,
                    posId,
                });
            }

            newPositions.push({
                id: posId,
                symbol: `${selectedCoin} ${leg.strike?.toLocaleString()} ${leg.type === "CALL" ? "CE" : "PE"}`,
                side: leg.action,
                type: leg.type,
                strike: leg.strike,
                expiry: leg.expiry || chainData.activeExpiry?.label || "11 Oct 26",
                lots: leg.lots || 1,
                contractValue: cVal,
                coinQty,
                coinSymbol: selectedCoin,
                coinIcon: currentCoinConfig.icon || "₿",
                size: sizeStr,
                entryPrice,
                markPrice: entryPrice,
                margin: legMargin,
                unrealizedPnl: 0.0,
                pnlPct: 0.0,
                slTrigger: slText,
                tpTrigger: tpText,
                stopOrderId: soId,
                status: "OPEN",
                createdAt: dateStr,
            });

            newFills.push({
                id: `fill-${Date.now()}-${idx}`,
                orderId: ordId,
                contract: `${selectedCoin} ${leg.strike?.toLocaleString()} ${leg.type === "CALL" ? "CE" : "PE"}`,
                side: leg.action,
                size: sizeStr,
                price: `$${formatNumber(entryPrice)}`,
                fee: `$${(entryPrice * coinQty * 0.0005).toFixed(2)}`,
                time: dateStr,
                type: "ENTRY",
            });

            newHistory.push({
                id: ordId,
                contract: `${selectedCoin} ${leg.strike?.toLocaleString()} ${leg.type === "CALL" ? "CE" : "PE"}`,
                side: leg.action,
                type: "MARKET",
                status: "FILLED",
                price: `$${formatNumber(entryPrice)}`,
                time: dateStr,
            });
        });

        setPositions((prev) => [...newPositions, ...prev]);
        setStopOrders((prev) => [...newStopOrders, ...prev]);
        setFills((prev) => [...newFills, ...prev]);
        setOrderHistory((prev) => [...newHistory, ...prev]);
        setDemoBalance((prev) => Math.max(0, prev - (payoffMetrics.orderMargin || 100)));

        // Automatically switch to positions tab so user sees their executed order immediately
        setBottomTab("positions");
        setMobileTab("positions");

        setOrderSuccessMsg(
            `Order Executed! ${activeSelectedLegs.length} position(s) opened in Delta Simulator. Margin Used: $${formatNumber(payoffMetrics.orderMargin || 100)}`
        );
        setTimeout(() => setOrderSuccessMsg(null), 6000);

        // Smooth scroll to positions panel
        setTimeout(() => {
            if (positionsPanelRef.current) {
                positionsPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }, 150);
    };

    // Market Close Individual Position
    const handleClosePosition = (posId) => {
        const targetPos = positions.find((p) => p.id === posId);
        if (!targetPos) return;

        const now = new Date();
        const timestamp = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const dateStr = `${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${timestamp}`;
        const closeOrderId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;

        setPositions((prev) => prev.filter((p) => p.id !== posId));
        setStopOrders((prev) => prev.filter((so) => so.posId !== posId && so.id !== targetPos.stopOrderId));
        setDemoBalance((prev) => prev + (targetPos.margin || 0) + (targetPos.unrealizedPnl || 0));

        setFills((prev) => [
            {
                id: `fill-${Date.now()}`,
                orderId: closeOrderId,
                contract: targetPos.symbol,
                side: targetPos.side === "BUY" ? "SELL" : "BUY",
                size: targetPos.size,
                price: `$${formatNumber(targetPos.markPrice)}`,
                fee: "$0.10",
                time: dateStr,
                type: "MARKET_CLOSE",
            },
            ...prev,
        ]);

        setOrderHistory((prev) => [
            {
                id: closeOrderId,
                contract: targetPos.symbol,
                side: targetPos.side === "BUY" ? "SELL" : "BUY",
                type: "MARKET_CLOSE",
                status: "FILLED",
                price: `$${formatNumber(targetPos.markPrice)}`,
                time: dateStr,
            },
            ...prev,
        ]);

        setOrderSuccessMsg(
            `Position ${targetPos.symbol} closed at $${formatNumber(targetPos.markPrice)} (Realized: ${
                targetPos.unrealizedPnl >= 0 ? "+" : ""
            }$${formatNumber(targetPos.unrealizedPnl)})`
        );
        setTimeout(() => setOrderSuccessMsg(null), 4000);
    };

    // Market Close All Open Positions
    const handleCloseAllPositions = () => {
        if (positions.length === 0) return;
        const now = new Date();
        const timestamp = now.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const dateStr = `${now.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${timestamp}`;

        let totalPnl = 0;
        const newFills = [];
        const newHistory = [];

        positions.forEach((pos) => {
            totalPnl += (pos.unrealizedPnl || 0);
            const closeOrderId = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
            newFills.push({
                id: `fill-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                orderId: closeOrderId,
                contract: pos.symbol,
                side: pos.side === "BUY" ? "SELL" : "BUY",
                size: pos.size,
                price: `$${formatNumber(pos.markPrice)}`,
                fee: "$0.10",
                time: dateStr,
                type: "BATCH_CLOSE",
            });
            newHistory.push({
                id: closeOrderId,
                contract: pos.symbol,
                side: pos.side === "BUY" ? "SELL" : "BUY",
                type: "MARKET_CLOSE",
                status: "FILLED",
                price: `$${formatNumber(pos.markPrice)}`,
                time: dateStr,
            });
        });

        setDemoBalance((prev) => prev + portfolioSummary.totalMarginUsed + totalPnl);
        setPositions([]);
        setStopOrders([]);
        setFills((prev) => [...newFills, ...prev]);
        setOrderHistory((prev) => [...newHistory, ...prev]);

        setOrderSuccessMsg(`✅ Closed all ${positions.length} position(s). Total Realized PnL: ${totalPnl >= 0 ? "+" : ""}$${formatNumber(totalPnl)}`);
        setTimeout(() => setOrderSuccessMsg(null), 5000);
    };

    // Cancel a Stop Order
    const handleCancelStopOrder = (soId) => {
        setStopOrders((prev) => prev.filter((so) => so.id !== soId));
        setPositions((prev) =>
            prev.map((p) => (p.stopOrderId === soId ? { ...p, slTrigger: "None (Cancelled)" } : p))
        );
        setOrderSuccessMsg(`Stop Order ${soId} cancelled.`);
        setTimeout(() => setOrderSuccessMsg(null), 3000);
    };

    // Open Edit Stop Loss Modal
    const handleOpenEditSlModal = (item) => {
        setEditingSlItem(item);
        setEditSlValue(item.slTrigger || "");
        setEditTpValue(item.tpTrigger || "");
    };

    // Save Modified Stop Loss
    const handleSaveEditSl = () => {
        if (!editingSlItem) return;
        setPositions((prev) =>
            prev.map((p) =>
                p.id === editingSlItem.id
                    ? { ...p, slTrigger: editSlValue || p.slTrigger, tpTrigger: editTpValue || p.tpTrigger }
                    : p
            )
        );
        setStopOrders((prev) =>
            prev.map((so) =>
                so.posId === editingSlItem.id || so.id === editingSlItem.stopOrderId
                    ? { ...so, condition: `Updated SL Trigger: ${editSlValue}` }
                    : so
            )
        );
        setEditingSlItem(null);
        setOrderSuccessMsg("✅ Stop Loss / Target updated successfully!");
        setTimeout(() => setOrderSuccessMsg(null), 3000);
    };

    return (
        <div className="min-h-screen bg-[#0b0e14] text-gray-200 font-sans selection:bg-amber-500/30 selection:text-amber-200">
            {/* ------------------------------------------------------------- */}
            {/* 1. UNIFIED CRYPTO STRATEGY BUILDER HEADER & TOOLBAR           */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-[#0e121b] border-b border-[#1f2433] px-3 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
                {/* Left: Page Title, View Mode & Coin Switcher */}
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 pr-2 border-r border-[#1f2535]">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-400 flex items-center justify-center shadow-md shadow-amber-900/40">
                            <span className="text-gray-950 font-black text-sm">Δ</span>
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="font-extrabold text-sm lg:text-base text-white tracking-tight">
                                    {historical ? "Crypto Options Backtester" : "Crypto Strategy Builder"}
                                </h1>
                                {historical ? (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1 shadow-xs">
                                        <FiClock size={10} />
                                        <span>Historical Replay</span>
                                    </span>
                                ) : (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[9px] font-black uppercase tracking-wider inline-flex items-center gap-1 shadow-xs">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
                                        <span>LIVE DELTA FEED</span>
                                    </span>
                                )}
                            </div>
                            <div className="text-[10px] text-gray-400 font-medium">
                                {historical
                                    ? "Real Delta Exchange 1-min history • Payoff & Greeks at any past minute"
                                    : "Delta Exchange Derivatives Feed • Real-Time Greeks & Payoff"}
                            </div>
                        </div>
                    </div>

                    {/* Option Chain / Chart Segment View (the chart is a live widget — hidden in the backtester) */}
                    <div className={`${historical ? "hidden" : "flex"} rounded-lg bg-[#151926] p-0.5 border border-[#252b3d] shadow-inner`}>
                        <button
                            onClick={() => setViewMode("option_chain")}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                viewMode === "option_chain"
                                    ? "bg-amber-500 text-black font-extrabold shadow-sm ring-1 ring-amber-400/50"
                                    : "text-gray-400 hover:text-gray-200 hover:bg-[#1a2030]"
                            }`}
                            title="Delta Exchange Options Matrix"
                        >
                            <FiGrid size={13} />
                            <span>Option Chain</span>
                        </button>
                        <button
                            onClick={() => setViewMode("chart")}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                viewMode === "chart"
                                    ? "bg-amber-500 text-black font-extrabold shadow-sm ring-1 ring-amber-400/50"
                                    : "text-gray-400 hover:text-gray-200 hover:bg-[#1a2030]"
                            }`}
                            title="Interactive TradingView Chart with All Tools & Indicators"
                        >
                            <FiBarChart2 size={13} />
                            <span>Chart</span>
                        </button>
                    </div>

                    {/* Coin Selector Pills */}
                    <div className="flex items-center gap-1.5">
                        {coinList.map((coin) => (
                            <button
                                key={coin.symbol}
                                onClick={() => {
                                    if (selectedCoin !== coin.symbol) {
                                        setSelectedCoin(coin.symbol);
                                        setSelectedExpiry(null);
                                        setLoading(true);
                                    }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                                    selectedCoin === coin.symbol
                                        ? "bg-amber-500/15 text-amber-300 border-amber-500/60 shadow-sm ring-1 ring-amber-500/40"
                                        : "bg-[#151926] text-gray-400 border-[#252b3d] hover:border-gray-600 hover:text-gray-200"
                                }`}
                            >
                                <span className={coin.color}>{coin.icon}</span>
                                <span>{coin.symbol}</span>
                                {coin.badge && (
                                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500 text-black font-extrabold">
                                        {coin.badge}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Middle: Expiry Date Carousel with Skeleton Loading */}
                <div className="flex items-center gap-1 overflow-x-auto py-1 custom-scrollbar max-w-full lg:max-w-md">
                    <button
                        onClick={() => {
                            if (chainData.expiries.length > 0) {
                                const idx = chainData.expiries.findIndex((e) => e.raw === selectedExpiry);
                                if (idx > 0) {
                                    setSelectedExpiry(chainData.expiries[idx - 1].raw);
                                    setLoading(true);
                                }
                            }
                        }}
                        className="p-1.5 rounded bg-[#151926] hover:bg-[#1e2336] text-gray-400 cursor-pointer"
                        title="Previous Expiry"
                    >
                        <FiChevronLeft size={14} />
                    </button>

                    {chainData.expiries && chainData.expiries.length > 0 ? (
                        chainData.expiries.map((exp) => {
                            const isSelected = exp.raw === selectedExpiry;
                            return (
                                <button
                                    key={exp.raw}
                                    onClick={() => {
                                        if (selectedExpiry !== exp.raw) {
                                            setSelectedExpiry(exp.raw);
                                            setLoading(true);
                                        }
                                    }}
                                    className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                                        isSelected
                                            ? "bg-amber-950/40 text-amber-300 border-amber-500/70 font-bold ring-1 ring-amber-500/50"
                                            : "bg-[#151926] text-gray-400 border-[#252b3d] hover:text-gray-200"
                                    }`}
                                >
                                    {exp.label}
                                </button>
                            );
                        })
                    ) : (
                        <div className="flex items-center gap-1.5 overflow-hidden">
                            {["17 Oct 26", "18 Oct 26", "24 Oct 26", "31 Oct 26", "07 Nov 26"].map((placeholder, idx) => (
                                <div
                                    key={idx}
                                    className="shrink-0 px-3 py-1.5 rounded-lg bg-[#151926] border border-[#252b3d] animate-pulse flex items-center justify-center"
                                >
                                    <div className="w-14 h-3 rounded bg-gray-700/50" />
                                </div>
                            ))}
                        </div>
                    )}

                    <button
                        onClick={() => {
                            if (chainData.expiries.length > 0) {
                                const idx = chainData.expiries.findIndex((e) => e.raw === selectedExpiry);
                                if (idx < chainData.expiries.length - 1) {
                                    setSelectedExpiry(chainData.expiries[idx + 1].raw);
                                    setLoading(true);
                                }
                            }
                        }}
                        className="p-1.5 rounded bg-[#151926] hover:bg-[#1e2336] text-gray-400 cursor-pointer"
                        title="Next Expiry"
                    >
                        <FiChevronRight size={14} />
                    </button>
                </div>

                {/* Right: USD/INR Converter, Demo Wallet, Live Spot Index & Strategy Builder Toggle */}
                <div className="flex items-center gap-2 lg:gap-3">
                    {/* Live Spot Mini Badge with Reactive Price Flash */}
                    <div className={`hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg border transition-all ${
                        spotFlash === "up"
                            ? "bg-emerald-950/60 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/50"
                            : spotFlash === "down"
                            ? "bg-rose-950/60 border-rose-500 text-rose-300 ring-1 ring-rose-500/50"
                            : "bg-[#131722] border-[#232a3d]"
                    }`}>
                        <span className="text-gray-400">{selectedCoin} {historical ? "Spot @ replay" : "Spot"}:</span>
                        <span className="font-mono font-bold text-white">{formatMoney(chainData.spotPrice, 2)}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                            chainData.spot24hChange >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                        }`}>
                            {chainData.spot24hChange >= 0 ? "+" : ""}{Number(chainData.spot24hChange || 0).toFixed(2)}%
                        </span>
                    </div>

                    {/* USD ($) <-> INR (₹) Converter Toggle Button */}
                    <div className="flex items-center bg-[#131722] p-0.5 rounded-lg border border-[#2b344a] shadow-xs">
                        <button
                            onClick={() => setCurrency("USD")}
                            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                currency === "USD"
                                    ? "bg-amber-500 text-black font-bold shadow-sm"
                                    : "text-gray-400 hover:text-gray-200"
                            }`}
                            title="View all prices in US Dollars ($)"
                        >
                            <span>$ USD</span>
                        </button>
                        <button
                            onClick={() => setCurrency("INR")}
                            className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                currency === "INR"
                                    ? "bg-emerald-600 text-white shadow-sm"
                                    : "text-gray-400 hover:text-gray-200"
                            }`}
                            title={`Convert and view in Indian Rupees (₹) @ ₹${usdtInrRate.toFixed(2)}/USD`}
                        >
                            <span>₹ INR</span>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse" />
                        </button>
                    </div>

                    {/* Real-time Rupee Rate Pill */}
                    <div
                        onClick={fetchInrRate}
                        className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#141926] border border-emerald-500/30 text-[11px] font-mono cursor-pointer hover:border-emerald-400/60 transition-all"
                        title={`Live FX Rate: 1 USD = ₹${usdtInrRate.toFixed(2)} (Click to refresh)`}
                    >
                        <span className="text-gray-400">1$ =</span>
                        <strong className="text-emerald-400 font-bold">₹{usdtInrRate.toFixed(2)}</strong>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                fetchInrRate();
                            }}
                            className={`text-gray-400 hover:text-emerald-300 ${fxLoading ? "animate-spin" : ""}`}
                            title="Refresh Live Exchange Rate"
                        >
                            <FiRefreshCw size={10} />
                        </button>
                    </div>

                    {/* User Auth Buttons or Profile indicator */}
                    {user || token ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => navigate("/profile")}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1f2c] hover:bg-[#252c3e] text-amber-300 border border-amber-500/30 text-xs font-bold transition cursor-pointer"
                                title="My Account Profile"
                            >
                                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                                <span className="max-w-[80px] truncate">{user?.name || user?.email?.split("@")[0] || "Trader"}</span>
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => navigate(`/login?mode=signup&redirect=${selfPath}`)}
                                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-950/40 transition cursor-pointer hover:scale-[1.02]"
                            >
                                Sign Up
                            </button>
                            <button
                                onClick={() => navigate(`/login?mode=login&redirect=${selfPath}`)}
                                className="px-3.5 py-1.5 rounded-lg bg-[#191e2c] hover:bg-emerald-500/10 text-emerald-400 hover:text-emerald-300 border border-emerald-500/40 text-xs font-bold transition cursor-pointer hover:scale-[1.02]"
                            >
                                Log In
                            </button>
                        </div>
                    )}

                    {/* Reload Wallet Button */}
                    <button
                        onClick={() => {
                            if (window.confirm("Reset demo trading wallet balance back to $12,810?")) {
                                setDemoBalance(12810);
                            }
                        }}
                        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1f2c] hover:bg-[#252c3e] text-amber-300 border border-amber-500/30 text-xs font-bold transition-all cursor-pointer shadow-xs"
                        title="Demo Trading Balance (Click to Reset to $12,810)"
                    >
                        <FiDollarSign size={12} className="text-amber-400" />
                        <span>{formatMoney(demoBalance, 0)}</span>
                    </button>

                    {/* Strategy Builder Toggle Button */}
                    <button
                        onClick={() => setIsStrategyBuilderOpen(!isStrategyBuilderOpen)}
                        className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md ${
                            isStrategyBuilderOpen
                                ? "bg-amber-500 text-black font-bold shadow-amber-900/30"
                                : "bg-[#1c2233] text-gray-300 hover:text-white border border-[#2d364f]"
                        }`}
                    >
                        <FiLayers size={14} />
                        <span>Strategy Builder</span>
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    </button>
                </div>
            </div>

            {/* Historical replay bar: pick a past date, scrub / play the IST clock */}
            {historical && (
                <div className="bg-[#0e121b] border-b border-[#1f2433] px-3 lg:px-6 py-2.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="flex items-center gap-1.5 rounded-lg border border-[#2b344a] bg-[#131722] px-2 py-1">
                            <span className="text-gray-400 font-semibold">Date</span>
                            <input
                                type="date"
                                value={histDate}
                                min={histMeta.minDate}
                                max={histMeta.maxDate}
                                onChange={(e) => {
                                    if (!e.target.value) return;
                                    setIsPlaying(false);
                                    setSelectedExpiry(null);
                                    hasChainRef.current = false;
                                    setHistDate(e.target.value);
                                }}
                                className="bg-transparent font-mono font-bold text-amber-300 outline-none [color-scheme:dark]"
                            />
                        </label>

                        <div className="flex items-center gap-1">
                            {[[-60, "-1h"], [-15, "-15m"], [-1, "-1m"]].map(([d, l]) => (
                                <button key={l} onClick={() => stepHistMinute(d)} className="rounded-md border border-[#2b344a] bg-[#151926] px-2 py-1 font-semibold text-gray-300 hover:text-white hover:border-gray-500 cursor-pointer">
                                    {l}
                                </button>
                            ))}
                            <span className="mx-1 rounded-md border border-amber-500/50 bg-amber-950/40 px-2.5 py-1 font-mono font-bold text-amber-300 tabular-nums">
                                {minuteToHHMM(histMinute)} IST
                            </span>
                            {[[1, "+1m"], [15, "+15m"], [60, "+1h"]].map(([d, l]) => (
                                <button key={l} onClick={() => stepHistMinute(d)} className="rounded-md border border-[#2b344a] bg-[#151926] px-2 py-1 font-semibold text-gray-300 hover:text-white hover:border-gray-500 cursor-pointer">
                                    {l}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => setIsPlaying((p) => !p)}
                            disabled={histMinute >= 1439}
                            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 font-bold cursor-pointer disabled:opacity-40 ${
                                isPlaying ? "bg-rose-600 text-white hover:bg-rose-500" : "bg-amber-500 text-black hover:bg-amber-400"
                            }`}
                        >
                            {isPlaying ? "❚❚ Pause" : "▶ Play"}
                        </button>
                        <select
                            value={playSpeed}
                            onChange={(e) => setPlaySpeed(Number(e.target.value))}
                            className="rounded-lg border border-[#2b344a] bg-[#151926] px-2 py-1 font-semibold text-gray-300 outline-none cursor-pointer"
                            title="Replay speed (minutes per second)"
                        >
                            {[1, 2, 5, 10, 30].map((v) => (
                                <option key={v} value={v}>{v}x</option>
                            ))}
                        </select>

                        <span className="ml-auto text-[11px] text-gray-500">
                            Source: Delta Exchange mark price (1-min) · IV/Greeks solved from mark · bid/ask/OI not recorded
                        </span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={1439}
                        value={histMinute}
                        onChange={(e) => setHistMinute(Number(e.target.value))}
                        className="w-full accent-amber-500 cursor-pointer"
                        aria-label="Replay time of day (IST)"
                    />
                </div>
            )}

            {/* Mobile Tab Navigator */}
            <div className="lg:hidden flex border-b border-[#232733] bg-[#121622] text-xs font-bold">
                <button
                    onClick={() => setMobileTab("chain")}
                    className={`flex-1 py-2.5 text-center border-b-2 ${
                        mobileTab === "chain" ? "border-amber-500 text-amber-400 bg-amber-500/10" : "border-transparent text-gray-400"
                    }`}
                >
                    {viewMode === "chart" ? "Chart" : "Option Chain"}
                </button>
                <button
                    onClick={() => setMobileTab("builder")}
                    className={`flex-1 py-2.5 text-center border-b-2 ${
                        mobileTab === "builder" ? "border-amber-500 text-amber-400 bg-amber-500/10" : "border-transparent text-gray-400"
                    }`}
                >
                    Builder ({activeSelectedLegs.length})
                </button>
                <button
                    onClick={() => setMobileTab("positions")}
                    className={`flex-1 py-2.5 text-center border-b-2 ${
                        mobileTab === "positions" ? "border-amber-500 text-amber-400 bg-amber-500/10" : "border-transparent text-gray-400"
                    }`}
                >
                    Positions
                </button>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 3. MAIN SPLIT LAYOUT: OPTION CHAIN + STRATEGY BUILDER         */}
            {/* ------------------------------------------------------------- */}
            <div className="p-2 lg:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4">
                {/* --------------------------------------------------------- */}
                {/* LEFT COLUMN: DELTA OPTION CHAIN TABLE (8 COLS OR 12 COLS) */}
                {/* --------------------------------------------------------- */}
                <div
                    className={`${
                        isStrategyBuilderOpen ? "lg:col-span-7 xl:col-span-8" : "lg:col-span-12"
                    } ${mobileTab !== "chain" ? "hidden lg:block" : "block"} flex flex-col rounded-xl bg-[#11141f] border border-[#1f2535] overflow-hidden min-h-[640px]`}
                >
                    {viewMode === "chart" ? (
                        <div className="flex flex-col h-full min-h-[680px]">
                            {/* Chart Control Toolbar */}
                            <div className="bg-[#151926] px-3.5 py-2.5 border-b border-[#23293d] flex flex-wrap items-center justify-between gap-2 text-xs">
                                {/* Left: Symbol, Spot & 24h Change */}
                                <div className="flex items-center gap-2.5">
                                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0b0e14] border border-[#252b3d]">
                                        <span className={CRYPTO_COINS.find((c) => c.symbol === selectedCoin)?.color || "text-amber-400"}>
                                            {CRYPTO_COINS.find((c) => c.symbol === selectedCoin)?.icon || "₿"}
                                        </span>
                                        <span className="font-extrabold text-white font-mono">{selectedCoin}/USDT</span>
                                        <span className="text-[10px] text-gray-400 font-semibold">Perpetual</span>
                                    </div>
                                    <div
                                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                                            spotFlash === "up"
                                                ? "bg-emerald-950/80 text-emerald-300 ring-1 ring-emerald-500/50"
                                                : spotFlash === "down"
                                                ? "bg-rose-950/80 text-rose-300 ring-1 ring-rose-500/50"
                                                : "bg-[#0b0e14] text-white border border-[#23293d]"
                                        }`}
                                    >
                                        <span>${formatNumber(chainData.spotPrice, 2)}</span>
                                        <span className={`text-[10px] ${chainData.spot24hChange >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                            {chainData.spot24hChange >= 0 ? "+" : ""}{chainData.spot24hChange.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>

                                {/* Center: Timeframe Resolutions */}
                                <div className="flex items-center gap-1 bg-[#0b0e14] p-0.5 rounded-lg border border-[#232a3d]">
                                    {[
                                        { label: "1m", val: "1" },
                                        { label: "5m", val: "5" },
                                        { label: "15m", val: "15" },
                                        { label: "1H", val: "60" },
                                        { label: "4H", val: "240" },
                                        { label: "1D", val: "D" },
                                        { label: "1W", val: "W" },
                                    ].map((tf) => (
                                        <button
                                            key={tf.val}
                                            onClick={() => setChartInterval(tf.val)}
                                            className={`px-2 py-1 text-[11px] font-bold rounded transition-all ${
                                                chartInterval === tf.val
                                                    ? "bg-amber-500 text-black font-bold shadow-sm"
                                                    : "text-gray-400 hover:text-gray-200 hover:bg-[#1a2030]"
                                            }`}
                                        >
                                            {tf.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Right: Candle Style Switcher */}
                                <div className="flex items-center gap-1 bg-[#0b0e14] p-0.5 rounded-lg border border-[#232a3d]">
                                    {[
                                        { label: "Candles", val: "1" },
                                        { label: "Heikin Ashi", val: "8" },
                                        { label: "Line", val: "2" },
                                    ].map((style) => (
                                        <button
                                            key={style.val}
                                            onClick={() => setChartStyle(style.val)}
                                            className={`px-2 py-1 text-[11px] font-semibold rounded transition-all ${
                                                chartStyle === style.val
                                                    ? "bg-amber-950/60 text-amber-200 border border-amber-500/40"
                                                    : "text-gray-400 hover:text-gray-200 hover:bg-[#1a2030]"
                                            }`}
                                        >
                                            {style.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Indicators Quick Ribbon */}
                            <div className="bg-[#11141f] px-3.5 py-1.5 border-b border-[#1f2535] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-gray-400 font-semibold flex items-center gap-1">
                                        <FiActivity size={12} className="text-amber-400" />
                                        <span>Quick Indicators:</span>
                                    </span>
                                    {[
                                        { id: "STD;EMA", name: "EMA" },
                                        { id: "STD;RSI", name: "RSI" },
                                        { id: "STD;MACD", name: "MACD" },
                                        { id: "STD;Bollinger_Bands", name: "Bollinger Bands" },
                                        { id: "STD;Volume", name: "Volume" },
                                        { id: "STD;Supertrend", name: "Supertrend" },
                                    ].map((ind) => {
                                        const active = chartStudies.includes(ind.id);
                                        return (
                                            <button
                                                key={ind.id}
                                                onClick={() => toggleStudy(ind.id)}
                                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all ${
                                                    active
                                                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm"
                                                        : "bg-[#0b0e14] text-gray-400 border-[#252b3d] hover:border-gray-600 hover:text-gray-200"
                                                }`}
                                            >
                                                {active ? "✓ " : "+ "}{ind.name}
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                    <span className="px-2 py-0.5 rounded bg-amber-950/30 text-amber-300 border border-amber-500/30 font-medium">
                                        🛠 All Drawing Tools & Indicators active via TradingView
                                    </span>
                                </div>
                            </div>

                            {/* TradingView Advanced Real-Time Chart */}
                            <div className="relative w-full h-[680px] min-h-[600px] bg-[#0b1420]">
                                <TradingViewChart
                                    symbol={selectedCoin}
                                    interval={chartInterval}
                                    chartStyle={chartStyle}
                                    studies={chartStudies}
                                    height="680px"
                                    className="h-full w-full min-h-[600px]"
                                />
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Option Chain Spot & Time Header */}
                            <div className="bg-[#151926] px-4 py-2.5 border-b border-[#23293d] flex items-center justify-between text-xs">
                        <div className="font-bold text-emerald-400 flex items-center gap-1.5 uppercase tracking-wider">
                            <span>Calls</span>
                        </div>

                        {/* Spot Price Live Center Ticker with Skeleton Loading */}
                        <div className="flex items-center gap-3">
                            {loading && !chainData.spotPrice ? (
                                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#232a3d] bg-[#0b0e14] animate-pulse">
                                    <div className="w-16 h-3 rounded bg-gray-700/60" />
                                    <div className="w-16 h-4 rounded bg-gray-600/70" />
                                </div>
                            ) : (
                                <div className={`flex items-center gap-2 px-3 py-1 rounded-lg border transition-all ${
                                    spotFlash === "up"
                                        ? "bg-emerald-950/60 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/50"
                                        : spotFlash === "down"
                                        ? "bg-rose-950/60 border-rose-500 text-rose-300 ring-1 ring-rose-500/50"
                                        : "bg-[#0b0e14] border-[#232a3d]"
                                }`}>
                                    <span className="text-gray-400 font-medium">{selectedCoin} Index:</span>
                                    <span className="font-mono font-extrabold text-white text-sm">
                                        ${formatNumber(chainData.spotPrice, 2)}
                                    </span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                                        chainData.spot24hChange >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                    }`}>
                                        {chainData.spot24hChange >= 0 ? "+" : ""}{Number(chainData.spot24hChange || 0).toFixed(2)}%
                                    </span>
                                </div>
                            )}

                            {loading && (!chainData.activeExpiry || !chainData.activeExpiry.timeToExpiry) ? (
                                <div className="hidden sm:flex items-center gap-1.5 bg-[#0b0e14] px-2.5 py-1.5 rounded-lg border border-[#1f2535] animate-pulse">
                                    <div className="w-3 h-3 rounded-full bg-amber-500/30" />
                                    <div className="w-24 h-3 rounded bg-gray-700/50" />
                                </div>
                            ) : (
                                <div className="hidden sm:flex items-center gap-1.5 text-gray-400 text-[11px] bg-[#0b0e14] px-2.5 py-1 rounded-lg border border-[#1f2535]">
                                    <FiClock size={12} className="text-amber-400" />
                                    <span>Time to Expiry:</span>
                                    <strong className="text-amber-300 font-mono">
                                        {chainData.activeExpiry?.timeToExpiry || "—"}
                                    </strong>
                                </div>
                            )}

                            {/* Feed Status & Manual Refresh Trigger */}
                            <div className="flex items-center gap-1.5">
                                <div className={`hidden md:flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded-lg border transition-all ${
                                    loading
                                        ? "text-amber-300 bg-amber-950/40 border-amber-500/40 animate-pulse"
                                        : "text-emerald-400 bg-emerald-950/30 border-emerald-500/30"
                                }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-amber-400 animate-spin" : "bg-emerald-400 animate-ping"}`} />
                                    <span>{loading ? "Syncing..." : historical ? `Replay ${histDate} ${minuteToHHMM(histMinute)} IST` : "Live Feed (2.5s)"}</span>
                                </div>
                                <button
                                    onClick={() => fetchOptionChain(false)}
                                    disabled={loading}
                                    className="p-1 rounded-lg bg-[#0b0e14] hover:bg-[#191f2e] text-gray-400 hover:text-amber-300 border border-[#23293d] transition cursor-pointer"
                                    title="Refresh Option Chain (Force reload live strikes)"
                                >
                                    <FiRefreshCw size={11} className={loading || refreshing ? "animate-spin text-amber-400" : ""} />
                                </button>
                            </div>
                        </div>

                        <div className="font-bold text-rose-400 flex items-center gap-1.5 uppercase tracking-wider">
                            <span>Puts</span>
                        </div>
                    </div>

                    {/* Option Chain Data Table */}
                    <div
                        ref={chainTableContainerRef}
                        className="flex-1 overflow-x-auto overflow-y-auto max-h-[720px] custom-scrollbar select-none"
                    >
                        <table className="w-full text-center border-collapse text-[11px]">
                            {/* Table Header Columns */}
                            <thead className="sticky top-0 z-20 bg-[#171c2b] text-gray-400 font-semibold border-b border-[#262d42]">
                                <tr>
                                    {/* CALLS HEADERS */}
                                    <th className="py-2 px-1 text-gray-400 font-medium">Delta</th>
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium hidden md:table-cell">Bid Qty</th>}
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium">Bid (IV)</th>}
                                    <th className="py-2 px-1 text-emerald-400 font-bold bg-emerald-500/5">Mark (IV)</th>
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium">Ask (IV)</th>}
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium hidden md:table-cell">Ask Qty</th>}
                                    {!historical && <th className="py-2 px-2 text-gray-400 font-medium text-right">OI</th>}

                                    {/* STRIKE HEADER */}
                                    <th className="py-2 px-3 bg-[#0e111a] text-amber-400 font-bold border-x border-[#23293d]">
                                        Strike
                                    </th>

                                    {/* PUTS HEADERS */}
                                    {!historical && <th className="py-2 px-2 text-gray-400 font-medium text-left">OI</th>}
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium hidden md:table-cell">Bid Qty</th>}
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium">Bid (IV)</th>}
                                    <th className="py-2 px-1 text-rose-400 font-bold bg-rose-500/5">Mark (IV)</th>
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium">Ask (IV)</th>}
                                    {!historical && <th className="py-2 px-1 text-gray-400 font-medium hidden md:table-cell">Ask Qty</th>}
                                    <th className="py-2 px-1 text-gray-400 font-medium">Delta</th>
                                </tr>
                            </thead>

                            {/* Table Rows */}
                            <tbody className="divide-y divide-[#1b2030] font-mono">
                                {loading ? (
                                    <OptionChainSkeletonRows rowCount={14} />
                                ) : !chainData.chain || chainData.chain.length === 0 ? (
                                    <tr>
                                        <td colSpan={historical ? 5 : 15} className="py-14 text-center font-sans text-xs text-gray-400">
                                            {error
                                                ? error
                                                : historical && chainData.historical?.hasOptions === false
                                                ? `Delta Exchange has no ${selectedCoin} options history — pick BTC or ETH.`
                                                : historical
                                                ? "No option contracts were trading at this minute."
                                                : "No option contracts listed for this expiry."}
                                        </td>
                                    </tr>
                                ) : (
                                    chainData.chain.map((row) => {
                                    const isAtm = row.strike === atmStrike;
                                    const isCallSelected = isContractSelected(row.strike, "call");
                                    const isPutSelected = isContractSelected(row.strike, "put");

                                    return (
                                        <tr
                                            key={row.strike}
                                            ref={isAtm ? atmRowRef : null}
                                            id={isAtm ? "atm-strike-row" : undefined}
                                            className={`transition-colors group ${
                                                isAtm
                                                    ? "bg-emerald-950/40 border-y-2 border-emerald-500/70 shadow-md ring-1 ring-emerald-500/30 font-semibold"
                                                    : "hover:bg-[#181d2c]"
                                            }`}
                                        >
                                            {/* CALLS CELLS */}
                                            <td className="py-2 px-1 text-gray-400">
                                                {row.call?.delta != null ? row.call.delta.toFixed(2) : "—"}
                                            </td>
                                            {!historical && (
                                            <td className="py-2 px-1 text-gray-400 hidden md:table-cell">
                                                {row.call?.bidQty != null ? row.call.bidQty.toFixed(3) : "—"}
                                            </td>
                                            )}
                                            {!historical && (
                                            <td className="py-2 px-1 text-emerald-400/90">
                                                <div>{row.call?.bidPrice ? formatMoney(row.call.bidPrice, currency === "INR" ? 0 : 2) : "—"}</div>
                                                <div className="text-[9px] text-gray-500">{row.call?.bidIv ? `${row.call.bidIv.toFixed(1)}%` : "-"}</div>
                                            </td>
                                            )}

                                            {/* CALL MARK CELL WITH HOVER BUY/SELL PILLS */}
                                            <td
                                                onMouseEnter={() => setHoveredLeg({ strike: row.strike, type: "call" })}
                                                onMouseLeave={() => setHoveredLeg(null)}
                                                className={`py-1.5 px-2 relative transition-all ${
                                                    isCallSelected ? "bg-amber-500/20 border-l-2 border-amber-400 ring-1 ring-amber-500/30" : "bg-emerald-500/5 hover:bg-emerald-500/10"
                                                }`}
                                            >
                                                {hoveredLeg?.strike === row.strike && hoveredLeg?.type === "call" ? (
                                                    <div className="flex flex-col items-center justify-center gap-0.5 z-10">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleAddLeg(row.call, "BUY"); }}
                                                                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] shadow cursor-pointer hover:scale-105 transition"
                                                            >
                                                                Buy
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleAddLeg(row.call, "SELL"); }}
                                                                className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-black text-[10px] shadow cursor-pointer hover:scale-105 transition"
                                                            >
                                                                Sell
                                                            </button>
                                                        </div>
                                                        <div className="text-[9px] font-mono font-bold text-emerald-300">
                                                            {formatMoney(row.call?.markPrice, currency === "INR" ? 0 : 2)}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <div className="font-bold text-white tracking-tight">{row.call?.markPrice ? formatMoney(row.call.markPrice, currency === "INR" ? 0 : 2) : "—"}</div>
                                                        <div className="text-[9px] text-emerald-400 font-mono">{row.call?.markIv ? `${row.call.markIv.toFixed(1)}%` : "-"}</div>
                                                    </div>
                                                )}
                                            </td>

                                            {!historical && (
                                            <td className="py-2 px-1 text-rose-400/90">
                                                <div>{row.call?.askPrice ? formatMoney(row.call.askPrice, currency === "INR" ? 0 : 2) : "—"}</div>
                                                <div className="text-[9px] text-gray-500">{row.call?.askIv ? `${row.call.askIv.toFixed(1)}%` : "-"}</div>
                                            </td>
                                            )}
                                            {!historical && (
                                            <td className="py-2 px-1 text-gray-400 hidden md:table-cell">
                                                {row.call?.askQty != null ? row.call.askQty.toFixed(3) : "—"}
                                            </td>
                                            )}

                                            {/* CALL OI WITH VISUAL BAR */}
                                            {!historical && (
                                            <td className="py-2 px-2 text-right relative">
                                                <div
                                                    className="absolute inset-y-1 right-0 bg-emerald-500/10 rounded-l"
                                                    style={{ width: `${row.call?.oiPercent || 0}%` }}
                                                />
                                                <span className="relative z-10 text-gray-300 font-medium">
                                                    {row.call?.oiValueUsd != null ? formatCompactMoney(row.call.oiValueUsd) : "—"}
                                                </span>
                                            </td>
                                            )}

                                            {/* STRIKE PRICE (CENTER) */}
                                            <td className={`py-2 px-3 border-x border-[#23293d] font-bold transition-all ${
                                                isAtm
                                                    ? "bg-[#0c1f17] text-emerald-300 ring-2 ring-emerald-500/80 font-black shadow-inner"
                                                    : "bg-[#0d1017] text-amber-400"
                                            }`}>
                                                <div className="flex flex-col items-center justify-center">
                                                    <span className={isAtm ? "text-xs font-black text-emerald-300 tracking-wide" : ""}>
                                                        {row.strike.toLocaleString()}
                                                    </span>
                                                    {isAtm && (
                                                        <span className="mt-0.5 px-2 py-0.2 rounded-full bg-emerald-500/25 text-emerald-300 border border-emerald-400/60 text-[8px] font-black tracking-wider uppercase inline-flex items-center gap-1 shadow-xs animate-pulse">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                            ATM
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* PUT OI WITH VISUAL BAR */}
                                            {!historical && (
                                            <td className="py-2 px-2 text-left relative">
                                                <div
                                                    className="absolute inset-y-1 left-0 bg-rose-500/10 rounded-r"
                                                    style={{ width: `${row.put?.oiPercent || 0}%` }}
                                                />
                                                <span className="relative z-10 text-gray-300 font-medium">
                                                    {row.put?.oiValueUsd != null ? formatCompactMoney(row.put.oiValueUsd) : "—"}
                                                </span>
                                            </td>
                                            )}

                                            {!historical && (
                                            <td className="py-2 px-1 text-gray-400 hidden md:table-cell">
                                                {row.put?.bidQty != null ? row.put.bidQty.toFixed(3) : "—"}
                                            </td>
                                            )}
                                            {!historical && (
                                            <td className="py-2 px-1 text-emerald-400/90">
                                                <div>{row.put?.bidPrice ? formatMoney(row.put.bidPrice, currency === "INR" ? 0 : 2) : "—"}</div>
                                                <div className="text-[9px] text-gray-500">{row.put?.bidIv ? `${row.put.bidIv.toFixed(1)}%` : "-"}</div>
                                            </td>
                                            )}

                                            {/* PUT MARK CELL WITH HOVER BUY/SELL PILLS */}
                                            <td
                                                onMouseEnter={() => setHoveredLeg({ strike: row.strike, type: "put" })}
                                                onMouseLeave={() => setHoveredLeg(null)}
                                                className={`py-1.5 px-2 relative transition-all ${
                                                    isPutSelected ? "bg-amber-500/20 border-r-2 border-amber-400 ring-1 ring-amber-500/30" : "bg-rose-500/5 hover:bg-rose-500/10"
                                                }`}
                                            >
                                                {hoveredLeg?.strike === row.strike && hoveredLeg?.type === "put" ? (
                                                    <div className="flex flex-col items-center justify-center gap-0.5 z-10">
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleAddLeg(row.put, "BUY"); }}
                                                                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-black text-[10px] shadow cursor-pointer hover:scale-105 transition"
                                                            >
                                                                Buy
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleAddLeg(row.put, "SELL"); }}
                                                                className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-black text-[10px] shadow cursor-pointer hover:scale-105 transition"
                                                            >
                                                                Sell
                                                            </button>
                                                        </div>
                                                        <div className="text-[9px] font-mono font-bold text-rose-300">
                                                            {formatMoney(row.put?.markPrice, currency === "INR" ? 0 : 2)}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div>
                                                        <div className="font-bold text-white tracking-tight">{row.put?.markPrice ? formatMoney(row.put.markPrice, currency === "INR" ? 0 : 2) : "—"}</div>
                                                        <div className="text-[9px] text-rose-400 font-mono">{row.put?.markIv ? `${row.put.markIv.toFixed(1)}%` : "-"}</div>
                                                    </div>
                                                )}
                                            </td>

                                            {!historical && (
                                            <td className="py-2 px-1 text-rose-400/90">
                                                <div>{row.put?.askPrice ? formatMoney(row.put.askPrice, currency === "INR" ? 0 : 2) : "—"}</div>
                                                <div className="text-[9px] text-gray-500">{row.put?.askIv ? `${row.put.askIv.toFixed(1)}%` : "-"}</div>
                                            </td>
                                            )}
                                            {!historical && (
                                            <td className="py-2 px-1 text-gray-400 hidden md:table-cell">
                                                {row.put?.askQty != null ? row.put.askQty.toFixed(3) : "—"}
                                            </td>
                                            )}
                                            <td className="py-2 px-1 text-gray-400">
                                                {row.put?.delta != null ? row.put.delta.toFixed(2) : "—"}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                            </tbody>
                        </table>
                    </div>
                        </>
                    )}
                </div>

                {/* --------------------------------------------------------- */}
                {/* RIGHT COLUMN: GUEST SIGNUP/LOGIN WALL OR STRATEGY BUILDER */}
                {/* --------------------------------------------------------- */}
                {isStrategyBuilderOpen && (
                    <div
                        className={`lg:col-span-5 xl:col-span-4 ${
                            mobileTab !== "builder" ? "hidden lg:flex" : "flex"
                        } flex-col gap-3`}
                    >
                        {strategyLegs.length === 0 ? (
                            /* ======================================================== */
                            /* EMPTY STRATEGY STATE: LOGIN / SIGNUP & DELTA PRESETS     */
                            /* ======================================================== */
                            <div className="rounded-xl bg-[#11141f] border border-[#1f2535] p-4 sm:p-5 flex flex-col gap-4 shadow-xl animate-in fade-in duration-150">
                                {/* Header Branding */}
                                <div className="flex items-center gap-3 pb-3.5 border-b border-[#1f2535]">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-yellow-400 flex items-center justify-center text-black font-black text-lg shadow-md shadow-amber-900/40">
                                        Δ
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                                                Delta Strategy Studio
                                            </h3>
                                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase tracking-wider">
                                                {historical ? "Replay Greeks" : "Live Greeks"}
                                            </span>
                                        </div>
                                        <p className="text-[11px] text-gray-400">
                                            {historical ? "Build multi-leg options and replay their Payoff & Stop Loss" : "Deploy multi-leg options with real-time Payoff & Stop Loss"}
                                        </p>
                                    </div>
                                </div>

                                {/* Auth Callout (Login / Sign Up options prominent when no strategy is active) */}
                                {!isAuthenticated ? (
                                    <div className="rounded-xl bg-gradient-to-br from-amber-950/40 via-[#141926] to-[#0f131d] border border-amber-500/30 p-4 space-y-3">
                                        <div className="flex items-center gap-2 text-amber-300">
                                            <FiLock size={15} />
                                            <span className="font-extrabold text-xs uppercase tracking-wider">Connect Delta Trader Account</span>
                                        </div>
                                        <p className="text-xs text-gray-300 leading-relaxed">
                                            Log in or create a free account to execute simulated crypto trades, save custom strategies, and sync risk triggers.
                                        </p>
                                        <div className="flex items-center gap-2.5 pt-1">
                                            <button
                                                onClick={() => navigate(`/login?mode=login&redirect=${selfPath}`)}
                                                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs shadow-lg shadow-amber-950/40 transition cursor-pointer text-center"
                                            >
                                                Log In
                                            </button>
                                            <button
                                                onClick={() => navigate(`/login?mode=signup&redirect=${selfPath}`)}
                                                className="flex-1 py-2.5 rounded-xl bg-[#181d2c] hover:bg-[#252c3e] text-amber-300 border border-amber-500/40 font-bold text-xs transition cursor-pointer text-center"
                                            >
                                                Sign Up Free
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-xl bg-[#141926] border border-[#23293d] p-3 flex items-center justify-between gap-3 text-xs">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                                                <FiCheckCircle size={16} />
                                            </div>
                                            <div>
                                                <div className="font-bold text-white">{user?.name || user?.email?.split("@")[0] || "Trader"}</div>
                                                <div className="text-[10px] text-gray-400 font-mono">Demo Capital: $${formatMoney(demoBalance, 0)}</div>
                                            </div>
                                        </div>
                                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                                            Connected
                                        </span>
                                    </div>
                                )}

                                {/* 1-Click Delta Popular Strategy Presets */}
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="font-extrabold text-gray-200 flex items-center gap-1.5 uppercase tracking-wider text-[11px]">
                                            <FiZap size={13} className="text-amber-400" />
                                            <span>1-Click Popular Strategies</span>
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-mono">Delta Presets</span>
                                    </div>

                                    {loading && (!chainData.chain || chainData.chain.length === 0) ? (
                                        <div className="grid grid-cols-2 gap-2">
                                            {[1, 2, 3, 4].map((i) => (
                                                <div
                                                    key={i}
                                                    className="p-3 rounded-xl bg-[#141926] border border-[#23293d] animate-pulse space-y-2"
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="h-3.5 w-24 bg-gray-700/60 rounded" />
                                                        <div className="h-3.5 w-3.5 bg-gray-700/40 rounded-full" />
                                                    </div>
                                                    <div className="h-2.5 w-32 bg-gray-800/60 rounded" />
                                                    <div className="h-3 w-20 bg-gray-800/80 rounded" />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => handleApplyPresetStrategy("bull_call_spread")}
                                            className="p-3 rounded-xl bg-[#141926] hover:bg-[#1a2133] border border-[#23293d] hover:border-emerald-500/50 transition-all text-left group cursor-pointer shadow-xs"
                                        >
                                            <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-emerald-400">
                                                <span>Bull Call Spread</span>
                                                <FiTrendingUp size={13} className="text-emerald-400" />
                                            </div>
                                            <div className="text-[10px] text-gray-400 mt-1 font-mono">Buy ATM Call + Sell OTM Call</div>
                                            <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-bold">
                                                Bullish • Defined Risk
                                            </span>
                                        </button>

                                        <button
                                            onClick={() => handleApplyPresetStrategy("bear_put_spread")}
                                            className="p-3 rounded-xl bg-[#141926] hover:bg-[#1a2133] border border-[#23293d] hover:border-rose-500/50 transition-all text-left group cursor-pointer shadow-xs"
                                        >
                                            <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-rose-400">
                                                <span>Bear Put Spread</span>
                                                <FiTrendingDown size={13} className="text-rose-400" />
                                            </div>
                                            <div className="text-[10px] text-gray-400 mt-1 font-mono">Buy ATM Put + Sell OTM Put</div>
                                            <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-400 font-bold">
                                                Bearish • Defined Risk
                                            </span>
                                        </button>

                                        <button
                                            onClick={() => handleApplyPresetStrategy("long_straddle")}
                                            className="p-3 rounded-xl bg-[#141926] hover:bg-[#1a2133] border border-[#23293d] hover:border-amber-500/50 transition-all text-left group cursor-pointer shadow-xs"
                                        >
                                            <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-amber-400">
                                                <span>Long Straddle</span>
                                                <FiActivity size={13} className="text-amber-400" />
                                            </div>
                                            <div className="text-[10px] text-gray-400 mt-1 font-mono">Buy ATM Call + Buy ATM Put</div>
                                            <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 font-bold">
                                                Volatility Breakout
                                            </span>
                                        </button>

                                        <button
                                            onClick={() => handleApplyPresetStrategy("iron_condor")}
                                            className="p-3 rounded-xl bg-[#141926] hover:bg-[#1a2133] border border-[#23293d] hover:border-purple-500/50 transition-all text-left group cursor-pointer shadow-xs"
                                        >
                                            <div className="flex items-center justify-between text-xs font-bold text-white group-hover:text-purple-400">
                                                <span>Iron Condor</span>
                                                <FiShield size={13} className="text-purple-400" />
                                            </div>
                                            <div className="text-[10px] text-gray-400 mt-1 font-mono">4-Leg Range Bound Spread</div>
                                            <span className="inline-block mt-1.5 text-[9px] px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-300 font-bold">
                                                Neutral • Range Income
                                            </span>
                                        </button>
                                    </div>
                                    )}
                                </div>

                                {/* Custom Option Chain Step Guide */}
                                <div className="rounded-xl bg-[#0e121b] border border-[#1f2535] p-3.5 space-y-2 text-xs">
                                    <span className="font-bold text-white text-[11px] uppercase tracking-wider block">
                                        Or Build Custom Strategy:
                                    </span>
                                    <div className="space-y-2 text-gray-400 text-[11px]">
                                        <div className="flex items-center gap-2.5">
                                            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-[10px] shrink-0 font-mono">1</span>
                                            <span>Hover over any <strong>Mark Price</strong> on the Option Chain table</span>
                                        </div>
                                        <div className="flex items-center gap-2.5">
                                            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-[10px] shrink-0 font-mono">2</span>
                                            <span>Click <strong className="text-emerald-400">Buy</strong> or <strong className="text-rose-400">Sell</strong> to stack legs into your strategy</span>
                                        </div>
                                        <div className="flex items-center gap-2.5">
                                            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-300 font-bold flex items-center justify-center text-[10px] shrink-0 font-mono">3</span>
                                            <span>Instant <strong>PnL Payoff Curve, Greeks & Stop Loss</strong> will appear here!</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            /* ======================================================== */
                            /* ACTIVE STRATEGY STATE: CONTRACTS + PAYOFF + SL/TP + ORDER */
                            /* ======================================================== */
                            <>
                        {/* 1. STRATEGY CONTRACTS CARD WITH DELTA EXCHANGE COIN SIZING */}
                        <div className="rounded-xl bg-[#11141f] border border-[#1f2535] p-3.5 flex flex-col gap-3 shadow-lg">
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#1f2535]">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={strategyLegs.length > 0 && strategyLegs.every((l) => l.selected)}
                                        onChange={(e) => handleSelectAllLegs(e.target.checked)}
                                        className="rounded bg-[#171c2b] border-[#2d364f] accent-amber-500 text-amber-500 focus:ring-0 cursor-pointer"
                                    />
                                    <span className="font-extrabold text-xs text-white">
                                        Strategy Contracts ({activeSelectedLegs.length}/{strategyLegs.length})
                                    </span>
                                </div>

                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {/* Delta Exchange Sizing Unit Selector (Contracts vs Coins) */}
                                    <div className="flex rounded-lg bg-[#151926] p-0.5 border border-[#2b344a] text-[10px] font-mono">
                                        <button
                                            onClick={() => setSizingUnit("contracts")}
                                            className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                                                sizingUnit === "contracts"
                                                    ? "bg-amber-500 text-black font-extrabold shadow"
                                                    : "text-gray-400 hover:text-white"
                                            }`}
                                            title="Size positions by number of contracts (1 Ctr = 0.001 BTC)"
                                        >
                                            Contracts
                                        </button>
                                        <button
                                            onClick={() => setSizingUnit("coins")}
                                            className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                                                sizingUnit === "coins"
                                                    ? "bg-amber-500 text-black font-extrabold shadow"
                                                    : "text-gray-400 hover:text-white"
                                            }`}
                                            title={`Size positions in ${selectedCoin} coins`}
                                        >
                                            Coins ({selectedCoin})
                                        </button>
                                    </div>

                                    {/* Multiplier control */}
                                    <div className="flex items-center gap-1 bg-[#151926] px-1.5 py-0.5 rounded-lg border border-[#2b344a] text-xs font-mono">
                                        <button
                                            onClick={() => setGlobalMultiplier((prev) => Math.max(1, prev - 1))}
                                            className="text-gray-400 hover:text-white px-1 font-bold cursor-pointer"
                                            title="Decrease multiplier"
                                        >
                                            -
                                        </button>
                                        <span className="font-bold text-white px-1">{globalMultiplier}x</span>
                                        <button
                                            onClick={() => setGlobalMultiplier((prev) => prev + 1)}
                                            className="text-gray-400 hover:text-white px-1 font-bold cursor-pointer"
                                            title="Increase multiplier"
                                        >
                                            +
                                        </button>
                                    </div>

                                    <button
                                        onClick={handleClearAllLegs}
                                        className="p-1 rounded-md text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
                                        title="Clear All Legs"
                                    >
                                        <FiTrash2 size={13} />
                                    </button>
                                </div>
                            </div>

                            {/* Contract Legs List */}
                            <div className="space-y-2.5 max-h-[300px] overflow-y-auto custom-scrollbar pr-0.5">
                                {strategyLegs.length > 0 ? (
                                    strategyLegs.map((leg) => {
                                        const cVal = leg.contractValue || currentCoinConfig.defaultLot || 0.001;
                                        const coinQty = (leg.lots || 1) * cVal * globalMultiplier;
                                        const notionalVal = (chainData.spotPrice || 83000) * coinQty;
                                        const premiumVal = (leg.markPrice || leg.price || 0) * coinQty;

                                        return (
                                            <div
                                                key={leg.id}
                                                className={`p-3 rounded-xl border transition-all flex flex-col gap-2.5 text-xs ${
                                                    leg.selected
                                                        ? "bg-[#141926] border-[#29324a] shadow-sm ring-1 ring-amber-500/20"
                                                        : "bg-[#0f121b] border-[#1b202e] opacity-60"
                                                }`}
                                            >
                                                {/* ROW 1: Selection, Action (BUY/SELL), Contract Name, Expiry, SL badge & Delete */}
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <input
                                                            type="checkbox"
                                                            checked={leg.selected}
                                                            onChange={() => handleToggleLegSelection(leg.id)}
                                                            className="rounded bg-[#171c2b] border-[#2d364f] accent-amber-500 text-amber-500 focus:ring-0 cursor-pointer"
                                                        />

                                                        {/* B/S Action Toggle Pill */}
                                                        <button
                                                            onClick={() => handleUpdateLegAction(leg.id, leg.action === "BUY" ? "SELL" : "BUY")}
                                                            className={`px-2 py-0.5 rounded font-black text-[11px] shadow transition hover:scale-105 cursor-pointer ${
                                                                leg.action === "BUY"
                                                                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                                                                    : "bg-rose-600 hover:bg-rose-500 text-white"
                                                            }`}
                                                            title={`Click to switch to ${leg.action === "BUY" ? "SELL" : "BUY"}`}
                                                        >
                                                            {leg.action}
                                                        </button>

                                                        {/* Contract Strike & Right */}
                                                        <div className="font-mono font-bold text-white text-xs flex items-center gap-1">
                                                            <span className={leg.type === "CALL" ? "text-emerald-400" : "text-rose-400"}>
                                                                {selectedCoin} {leg.strike.toLocaleString()} {leg.type}
                                                            </span>
                                                        </div>

                                                        <span className="text-[10px] text-gray-400 font-mono px-1.5 py-0.5 rounded bg-[#10141f] border border-[#23293d]">
                                                            {leg.expiry}
                                                        </span>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {/* BUY leg % SL badge */}
                                                        {leg.action === "BUY" && (
                                                            <button
                                                                onClick={() => handleOpenLegSlModal(leg)}
                                                                className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono font-bold transition-all flex items-center gap-1 cursor-pointer ${
                                                                    leg.slPct || leg.tpPct
                                                                        ? "bg-rose-500/15 border-rose-500/40 text-rose-300 hover:bg-rose-500/25"
                                                                        : "bg-[#181d2c] border-[#2b344a] text-gray-400 hover:text-white"
                                                                }`}
                                                                title="Configure % Stop Loss / Target"
                                                            >
                                                                <FiShield size={10} className={leg.slPct ? "text-rose-400" : "text-gray-400"} />
                                                                <span>{leg.slPct ? `-${leg.slPct}% SL` : "+ SL"}</span>
                                                            </button>
                                                        )}

                                                        {/* Remove Leg Button */}
                                                        <button
                                                            onClick={() => handleRemoveLeg(leg.id)}
                                                            className="p-1 rounded-md text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                                                            title="Remove leg"
                                                        >
                                                            <FiTrash2 size={13} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* ROW 2: Sizing Stepper + Lot Presets + Financial Metrics */}
                                                <div className="pt-2 border-t border-[#1f2638] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                                                    {/* Left: Sizing Stepper & Quick Lot Presets */}
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="flex items-center bg-[#0d1017] px-2 py-1 rounded-lg border border-[#232a3d] text-xs font-mono">
                                                            <button
                                                                onClick={() => handleUpdateLegLots(leg.id, -1)}
                                                                className="text-gray-400 hover:text-white px-1 cursor-pointer font-bold"
                                                                title="Decrease 1 contract"
                                                            >
                                                                -
                                                            </button>

                                                            {sizingUnit === "contracts" ? (
                                                                <span className="text-white font-bold px-1.5">
                                                                    {leg.lots || 1} <span className="text-gray-500 text-[10px]">Ctr</span>
                                                                </span>
                                                            ) : (
                                                                <span className="text-amber-400 font-bold px-1.5">
                                                                    {coinQty.toFixed(3)} <span className="text-gray-500 text-[10px]">{selectedCoin}</span>
                                                                </span>
                                                            )}

                                                            <button
                                                                onClick={() => handleUpdateLegLots(leg.id, 1)}
                                                                className="text-gray-400 hover:text-white px-1 cursor-pointer font-bold"
                                                                title="Increase 1 contract"
                                                            >
                                                                +
                                                            </button>
                                                        </div>

                                                        {/* Quick Lot Presets */}
                                                        <div className="flex items-center gap-1 text-[10px] font-mono">
                                                            {[1, 5, 10, 25].map((q) => (
                                                                <button
                                                                    key={q}
                                                                    onClick={() => handleSetLegLots(leg.id, q)}
                                                                    className={`px-1.5 py-0.5 rounded cursor-pointer transition ${
                                                                        leg.lots === q
                                                                            ? "bg-amber-500 text-black font-extrabold shadow"
                                                                            : "bg-[#10141f] text-gray-400 hover:text-white border border-[#242c3f]"
                                                                    }`}
                                                                >
                                                                    {q}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* Right: Mark Price & Premium */}
                                                    <div className="flex items-center gap-3 text-gray-400 text-[10px]">
                                                        <div>
                                                            <span className="text-gray-500">Mark: </span>
                                                            <strong className="text-white">${formatNumber(leg.markPrice || leg.price, 2)}</strong>
                                                        </div>
                                                        <div>
                                                            <span className="text-gray-500">Prem: </span>
                                                            <strong className={leg.action === "BUY" ? "text-rose-400" : "text-emerald-400"}>
                                                                {leg.action === "BUY" ? "-" : "+"}${formatNumber(premiumVal, 2)}
                                                            </strong>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="text-center py-6 text-gray-500 text-xs">
                                        No legs added. Hover over Option Chain mark prices and click <strong>Buy</strong> or <strong>Sell</strong> to build your strategy.
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 2. STRATEGY PAYOFF ENGINE & METRICS CARD */}
                        <div className="rounded-xl bg-[#11141f] border border-[#1f2535] p-3.5 flex flex-col gap-3 shadow-lg">
                            {/* Payoff Header Tabs */}
                            <div className="flex items-center justify-between pb-2 border-b border-[#1f2535]">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-xs text-white">Strategy PayOff</span>
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 font-mono font-bold">
                                        Delta Sim
                                    </span>
                                </div>
                                <div className="flex items-center bg-[#0d1017] p-0.5 rounded-lg border border-[#23293d] text-[11px]">
                                    <button
                                        onClick={() => setPayoffTab("chart")}
                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                            payoffTab === "chart"
                                                ? "bg-amber-500 text-black font-extrabold shadow"
                                                : "text-gray-400 hover:text-gray-200"
                                        }`}
                                    >
                                        PNL Chart
                                    </button>
                                    <button
                                        onClick={() => setPayoffTab("greeks")}
                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                            payoffTab === "greeks"
                                                ? "bg-amber-500 text-black font-extrabold shadow"
                                                : "text-gray-400 hover:text-gray-200"
                                        }`}
                                    >
                                        Greeks
                                    </button>
                                    <button
                                        onClick={() => setPayoffTab("pnl_table")}
                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                            payoffTab === "pnl_table"
                                                ? "bg-amber-500 text-black font-extrabold shadow"
                                                : "text-gray-400 hover:text-gray-200"
                                        }`}
                                    >
                                        PNL Table
                                    </button>
                                </div>
                            </div>

                            {/* Key Stats Bar: Max Profit, Max Loss, Reward/Risk, Breakeven */}
                            <div className="grid grid-cols-4 gap-2 bg-[#0c0f17] p-2.5 rounded-lg border border-[#1d2334] text-center font-mono text-[11px]">
                                <div>
                                    <span className="text-[10px] text-gray-400 block font-sans">Max Profit</span>
                                    <strong className="text-emerald-400 font-bold">
                                        {formatMoney(payoffMetrics.maxProfit, currency === "INR" ? 0 : 2)}
                                    </strong>
                                </div>
                                <div>
                                    <span className="text-[10px] text-gray-400 block font-sans">Max Loss</span>
                                    <strong className="text-rose-400 font-bold">
                                        {formatMoney(payoffMetrics.maxLoss, currency === "INR" ? 0 : 2)}
                                    </strong>
                                </div>
                                <div>
                                    <span className="text-[10px] text-gray-400 block font-sans">Reward / Risk</span>
                                    <strong className="text-white font-bold">{payoffMetrics.rewardRisk}</strong>
                                </div>
                                <div>
                                    <span className="text-[10px] text-gray-400 block font-sans">Breakeven</span>
                                    <strong className="text-amber-300 font-bold text-[10px]">
                                        {payoffMetrics.breakevens.length > 0 ? payoffMetrics.breakevens.join(", ") : "N/A"}
                                    </strong>
                                </div>
                            </div>

                            {/* TAB 1: Interactive Recharts Payoff Curve */}
                            {payoffTab === "chart" && (
                                <div className="h-[185px] w-full bg-[#0a0d14] rounded-lg p-2 relative border border-[#181e2b]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={payoffMetrics.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <CartesianGrid stroke="#1c2233" strokeDasharray="3 3" />
                                            <XAxis dataKey="price" stroke="#4b5563" tick={{ fontSize: 9, fill: "#9ca3af" }} />
                                            <YAxis stroke="#4b5563" tick={{ fontSize: 9, fill: "#9ca3af" }} />
                                            <Tooltip
                                                contentStyle={{ backgroundColor: "#121622", borderColor: "#2b344a", fontSize: "11px", color: "#fff" }}
                                                formatter={(val) => [formatMoney(val, 1), "Payoff"]}
                                                labelFormatter={(lbl) => `${selectedCoin} Price: $${lbl}`}
                                            />
                                            <ReferenceLine y={0} stroke="#4b5563" strokeWidth={1} />
                                            <ReferenceLine
                                                x={chainData.spotPrice}
                                                stroke="#10b981"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                                label={{
                                                    value: `ATM Spot $${formatNumber(chainData.spotPrice, 0)}`,
                                                    fill: "#10b981",
                                                    fontSize: 10,
                                                    fontWeight: "bold",
                                                    position: "top",
                                                }}
                                            />
                                            {/* Stop Loss Marker on Chart */}
                                            {enableStopLoss && slType === "spot_price" && slValue && (
                                                <ReferenceLine
                                                    x={Number(slValue)}
                                                    stroke="#f43f5e"
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.5}
                                                    label={{ value: `SL Trigger $${slValue}`, fill: "#f43f5e", fontSize: 9, position: "top" }}
                                                />
                                            )}
                                            {enableStopLoss && slType === "mtm_loss" && slValue && (
                                                <ReferenceLine
                                                    y={-Math.abs(Number(slValue))}
                                                    stroke="#f43f5e"
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.5}
                                                    label={{ value: `Max SL -$${slValue}`, fill: "#f43f5e", fontSize: 9, position: "left" }}
                                                />
                                            )}
                                            {/* Take Profit Marker on Chart */}
                                            {enableTakeProfit && tpType === "spot_price" && tpValue && (
                                                <ReferenceLine
                                                    x={Number(tpValue)}
                                                    stroke="#10b981"
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.5}
                                                    label={{ value: `TP Target $${tpValue}`, fill: "#10b981", fontSize: 9, position: "top" }}
                                                />
                                            )}
                                            {enableTakeProfit && tpType === "mtm_profit" && tpValue && (
                                                <ReferenceLine
                                                    y={Math.abs(Number(tpValue))}
                                                    stroke="#10b981"
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.5}
                                                    label={{ value: `Target TP +$${tpValue}`, fill: "#10b981", fontSize: 9, position: "left" }}
                                                />
                                            )}
                                            <Area type="monotone" dataKey="profitArea" fill="#10b981" fillOpacity={0.2} stroke="none" />
                                            <Area type="monotone" dataKey="lossArea" fill="#ef4444" fillOpacity={0.2} stroke="none" />
                                            <Line type="monotone" dataKey="expiryPnl" stroke="#10b981" strokeWidth={2} dot={false} name="On Expiry" />
                                            <Line type="monotone" dataKey="targetPnl" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="On Target" />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            )}

                            {/* TAB 2: Greeks Dashboard */}
                            {payoffTab === "greeks" && (
                                <div className="p-3 bg-[#0a0d14] rounded-lg border border-[#181e2b] flex flex-col gap-3 font-mono">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        <div className="p-2.5 rounded-lg bg-[#11141f] border border-[#1f2535] text-center">
                                            <span className="text-[10px] text-gray-400 font-sans block">Net Delta (Δ)</span>
                                            <strong className={`text-xs font-bold ${strategyGreeks.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                {strategyGreeks.delta >= 0 ? "+" : ""}{strategyGreeks.delta.toFixed(4)}
                                            </strong>
                                            <span className="text-[9px] text-gray-500 block font-sans">Directional</span>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-[#11141f] border border-[#1f2535] text-center">
                                            <span className="text-[10px] text-gray-400 font-sans block">Net Theta (Θ)</span>
                                            <strong className={`text-xs font-bold ${strategyGreeks.theta >= 0 ? "text-emerald-400" : "text-amber-400"}`}>
                                                {strategyGreeks.theta >= 0 ? "+" : ""}${formatNumber(strategyGreeks.theta, 2)}/d
                                            </strong>
                                            <span className="text-[9px] text-gray-500 block font-sans">Time Decay</span>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-[#11141f] border border-[#1f2535] text-center">
                                            <span className="text-[10px] text-gray-400 font-sans block">Net Gamma (Γ)</span>
                                            <strong className="text-xs font-bold text-blue-400">
                                                {strategyGreeks.gamma >= 0 ? "+" : ""}{strategyGreeks.gamma.toFixed(6)}
                                            </strong>
                                            <span className="text-[9px] text-gray-500 block font-sans">Delta Accel</span>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-[#11141f] border border-[#1f2535] text-center">
                                            <span className="text-[10px] text-gray-400 font-sans block">Net Vega (ν)</span>
                                            <strong className={`text-xs font-bold ${strategyGreeks.vega >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                {strategyGreeks.vega >= 0 ? "+" : ""}${formatNumber(strategyGreeks.vega, 2)}
                                            </strong>
                                            <span className="text-[9px] text-gray-500 block font-sans">1% IV Move</span>
                                        </div>
                                    </div>

                                    {/* Leg-by-leg Greeks Table */}
                                    <div className="overflow-x-auto custom-scrollbar max-h-[140px]">
                                        <table className="w-full text-center text-[10px]">
                                            <thead>
                                                <tr className="text-gray-500 border-b border-[#1c2233]">
                                                    <th className="py-1 text-left">Leg</th>
                                                    <th className="py-1">Side</th>
                                                    <th className="py-1">Delta</th>
                                                    <th className="py-1">Theta</th>
                                                    <th className="py-1">Gamma</th>
                                                    <th className="py-1">Vega</th>
                                                    <th className="py-1">IV</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[#171c2a]">
                                                {activeSelectedLegs.map((leg) => (
                                                    <tr key={leg.id} className="hover:bg-[#131724]">
                                                        <td className="py-1.5 text-left text-white font-bold">
                                                            {leg.strike.toLocaleString()} {leg.type}
                                                        </td>
                                                        <td className="py-1.5">
                                                            <span className={leg.action === "BUY" ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                                                {leg.action}
                                                            </span>
                                                        </td>
                                                        <td className="py-1.5 text-gray-300">{Number(leg.delta || 0.5).toFixed(2)}</td>
                                                        <td className="py-1.5 text-gray-300">{Number(leg.theta || -1.5).toFixed(1)}</td>
                                                        <td className="py-1.5 text-gray-300">{Number(leg.gamma || 0.0002).toFixed(4)}</td>
                                                        <td className="py-1.5 text-gray-300">{Number(leg.vega || 3.0).toFixed(1)}</td>
                                                        <td className="py-1.5 text-amber-400">{Number(leg.iv || 22).toFixed(1)}%</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* TAB 3: PnL Table */}
                            {payoffTab === "pnl_table" && (
                                <div className="h-[185px] overflow-y-auto bg-[#0a0d14] rounded-lg p-2 font-mono text-[10px] text-gray-300 custom-scrollbar">
                                    <table className="w-full text-center">
                                        <thead>
                                            <tr className="text-gray-500 border-b border-[#1c2233]">
                                                <th className="py-1">{selectedCoin} Price</th>
                                                <th className="py-1">Expiry PnL</th>
                                                <th className="py-1">Target PnL</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {payoffMetrics.chartData.slice(0, 30).map((pt, i) => (
                                                <tr key={i} className="hover:bg-[#141926]">
                                                    <td className="py-0.5">${pt.price}</td>
                                                    <td className={pt.expiryPnl >= 0 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                                                        {formatMoney(pt.expiryPnl, currency === "INR" ? 0 : 2)}
                                                    </td>
                                                    <td className={pt.targetPnl >= 0 ? "text-amber-400" : "text-rose-400"}>
                                                        {formatMoney(pt.targetPnl, currency === "INR" ? 0 : 2)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Target Price Simulation Slider */}
                            <div className="bg-[#0b0e14] p-2.5 rounded-lg border border-[#1b2130] flex flex-col gap-1.5 text-xs">
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-400 text-[11px]">
                                        {selectedCoin} Target Price: <strong className="text-white font-mono">${formatNumber(targetPrice)}</strong>
                                    </span>
                                    <button
                                        onClick={() => setTargetPrice(chainData.spotPrice || 83025.0)}
                                        className="text-[10px] text-amber-400 hover:text-amber-300 font-bold cursor-pointer"
                                    >
                                        Reset
                                    </button>
                                </div>

                                <input
                                    type="range"
                                    min={(chainData.spotPrice || 83025.0) * 0.8}
                                    max={(chainData.spotPrice || 83025.0) * 1.2}
                                    step={10}
                                    value={targetPrice}
                                    onChange={(e) => setTargetPrice(Number(e.target.value))}
                                    className="w-full accent-amber-500 cursor-pointer"
                                />

                                <div className="flex items-center justify-between text-[10px]">
                                    <span className="text-gray-500">Projected PnL at Target:</span>
                                    <strong className={targetPricePnl >= 0 ? "text-emerald-400 font-mono" : "text-rose-400 font-mono"}>
                                        {targetPricePnl >= 0 ? "+" : ""}{formatMoney(targetPricePnl, currency === "INR" ? 0 : 2)}
                                    </strong>
                                </div>
                            </div>

                            {/* Order Margin, Stop Loss Quick Badge & Place Order Action Button */}
                            <div className="pt-2 border-t border-[#1f2535] flex flex-col gap-2.5">
                                <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
                                    <span>
                                        Order Margin: <strong className="text-white">{formatMoney(payoffMetrics.orderMargin, currency === "INR" ? 0 : 2)}</strong>
                                    </span>
                                    <span>
                                        Available Margin: <strong className="text-emerald-400">{formatMoney(demoBalance, 0)}</strong>
                                    </span>
                                </div>

                                {/* Compact Stop Loss & Target Status Bar with Small Trigger Button */}
                                <div className="flex items-center justify-between text-xs bg-[#0c0f17] p-2.5 rounded-xl border border-[#20273a] shadow-xs">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-lg ${enableStopLoss ? "bg-rose-500/20 text-rose-400" : "bg-gray-800 text-gray-500"}`}>
                                            <FiShield size={13} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-1.5 font-bold text-[11px] text-white">
                                                <span>Stop Loss:</span>
                                                <span className={enableStopLoss ? "text-rose-400 font-mono" : "text-gray-500 font-normal"}>
                                                    {enableStopLoss
                                                        ? slType === "mtm_loss"
                                                            ? `-$${slValue} MTM`
                                                            : slType === "pct_loss"
                                                            ? `-${slValue}% Loss`
                                                            : `Spot $${slValue}`
                                                        : "Disabled"}
                                                </span>
                                            </div>
                                            {enableTakeProfit && (
                                                <div className="text-[10px] text-emerald-400 font-mono">
                                                    Target: {tpType === "mtm_profit" ? `+$${tpValue} MTM` : tpType === "pct_profit" ? `+${tpValue}%` : `Spot $${tpValue}`}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Small Dialog Opener Button */}
                                    <button
                                        onClick={() => setIsSlModalOpen(true)}
                                        className="px-2.5 py-1 rounded-lg bg-[#141926] hover:bg-[#1f2638] text-amber-300 hover:text-white border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                                    >
                                        <FiSliders size={11} className="text-amber-400" />
                                        <span>Config SL/TP</span>
                                    </button>
                                </div>

                                {orderSuccessMsg && (
                                    <div className="p-2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs text-center font-bold">
                                        {orderSuccessMsg}
                                    </div>
                                )}

                                <button
                                    onClick={handlePlaceOrder}
                                    disabled={activeSelectedLegs.length === 0}
                                    className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-black font-black text-sm shadow-lg shadow-amber-950/40 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer hover:scale-[1.01]"
                                >
                                    <span>Execute Strategy with Stop Loss</span>
                                    <span className="text-xs px-2 py-0.5 rounded bg-black/20 font-mono">
                                        ({activeSelectedLegs.length} Legs)
                                    </span>
                                </button>
                            </div>
                        </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 4. BOTTOM TABS: POSITIONS, STOP ORDERS, OPEN ORDERS, FILLS    */}
            {/* ------------------------------------------------------------- */}
            <div
                ref={positionsPanelRef}
                id="positions-panel"
                className={`mx-2 lg:mx-4 mb-6 rounded-xl bg-[#11141f] border border-[#1f2535] overflow-hidden ${
                    mobileTab === "positions" ? "block" : "hidden lg:block"
                }`}
            >
                {/* Bottom Header Tabs */}
                <div className="bg-[#151926] px-4 py-2 border-b border-[#23293d] flex items-center justify-between gap-3 text-xs font-bold">
                    <div className="flex items-center gap-4 overflow-x-auto custom-scrollbar py-0.5">
                        {[
                            { id: "positions", label: `Positions (${positions.length})` },
                            { id: "stop_orders", label: `Stop Orders (${stopOrders.length})` },
                            { id: "open_orders", label: `Open Orders (${openOrders.length})` },
                            { id: "fills", label: `Fills (${fills.length})` },
                            { id: "order_history", label: `Order History (${orderHistory.length})` },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setBottomTab(tab.id)}
                                className={`pb-1 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer ${
                                    bottomTab === tab.id
                                        ? "text-amber-400 border-b-2 border-amber-500 font-extrabold"
                                        : "text-gray-400 hover:text-gray-200"
                                }`}
                            >
                                <span>{tab.label}</span>
                                {tab.id === "stop_orders" && stopOrders.length > 0 && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Quick status badge */}
                    <div className="hidden sm:flex items-center gap-2 font-mono text-[11px] text-gray-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Delta Derivatives Sim</span>
                    </div>
                </div>

                {/* Portfolio Summary KPI Bar (shown whenever there are open positions) */}
                {positions.length > 0 && (
                    <div className="p-3.5 bg-[#0e121b] border-b border-[#1f2535] flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-4 lg:gap-6 font-mono text-xs">
                            {/* Total Unrealized PnL */}
                            <div className="flex flex-col">
                                <span className="text-[10px] text-gray-400 font-sans uppercase tracking-wider font-semibold">Total Unrealized P&L</span>
                                <div className="flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full animate-ping ${portfolioSummary.totalUnrealizedPnl >= 0 ? "bg-emerald-400" : "bg-rose-400"}`} />
                                    <span className={`font-black text-sm lg:text-base ${portfolioSummary.totalUnrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                        {portfolioSummary.totalUnrealizedPnl >= 0 ? "+" : ""}{formatMoney(portfolioSummary.totalUnrealizedPnl, currency === "INR" ? 0 : 2)}
                                    </span>
                                    <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded ${
                                        portfolioSummary.totalUnrealizedPnl >= 0 ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                    }`}>
                                        {portfolioSummary.totalMarginUsed > 0
                                            ? `${portfolioSummary.totalUnrealizedPnl >= 0 ? "+" : ""}${((portfolioSummary.totalUnrealizedPnl / portfolioSummary.totalMarginUsed) * 100).toFixed(2)}%`
                                            : "0.00%"}
                                    </span>
                                </div>
                            </div>

                            {/* Open Positions Count */}
                            <div className="flex flex-col border-l border-[#222a3d] pl-4">
                                <span className="text-[10px] text-gray-400 font-sans uppercase tracking-wider font-semibold">Open Positions</span>
                                <span className="font-bold text-white text-xs lg:text-sm">
                                    {positions.length} Contract{positions.length > 1 ? "s" : ""}
                                </span>
                            </div>

                            {/* Margin in Use */}
                            <div className="flex flex-col border-l border-[#222a3d] pl-4">
                                <span className="text-[10px] text-gray-400 font-sans uppercase tracking-wider font-semibold">Margin Used</span>
                                <span className="font-bold text-gray-200 text-xs lg:text-sm">
                                    {formatMoney(portfolioSummary.totalMarginUsed, currency === "INR" ? 0 : 2)}
                                </span>
                            </div>

                            {/* Simulated Demo Wallet */}
                            <div className="hidden sm:flex flex-col border-l border-[#222a3d] pl-4">
                                <span className="text-[10px] text-gray-400 font-sans uppercase tracking-wider font-semibold">Available Wallet</span>
                                <span className="font-bold text-amber-400 text-xs lg:text-sm">
                                    {formatMoney(demoBalance, currency === "INR" ? 0 : 0)}
                                </span>
                            </div>
                        </div>

                        {/* Right side actions */}
                        <div className="flex items-center gap-2">
                            {!isAuthenticated && (
                                <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[11px] font-medium">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    <span>Demo Mode (Guest)</span>
                                </span>
                            )}
                            <button
                                onClick={handleCloseAllPositions}
                                className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/40 text-xs font-bold transition-all cursor-pointer shadow-xs flex items-center gap-1.5"
                                title="Market close all open positions"
                            >
                                <FiTrash2 size={12} />
                                <span>Close All Positions</span>
                            </button>
                        </div>
                    </div>
                )}

                {/* Guest Mode Informational Banner (Non-blocking) */}
                {!isAuthenticated && positions.length > 0 && (
                    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <span>
                                <strong>Delta Derivatives Simulation Mode:</strong> 24/7 crypto demo execution with real-time mark prices and zero restrictions.
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => navigate(`/login?mode=login&redirect=${selfPath}`)}
                                className="text-amber-300 hover:text-white font-bold underline cursor-pointer"
                            >
                                Log In
                            </button>
                            <span className="text-gray-500">•</span>
                            <button
                                onClick={() => navigate(`/login?mode=signup&redirect=${selfPath}`)}
                                className="text-amber-300 hover:text-white font-bold underline cursor-pointer"
                            >
                                Sign Up to Save History
                            </button>
                        </div>
                    </div>
                )}

                {/* 1. POSITIONS TABLE */}
                {bottomTab === "positions" && (
                    <div className="overflow-x-auto custom-scrollbar">
                        {positions.length > 0 ? (
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-[#141926] text-gray-400 uppercase text-[10px] font-bold tracking-wider border-b border-[#232a3d]">
                                    <tr>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Contract</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Side</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Size</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Entry Price</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Mark Price</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Unrealized P&L</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Stop Loss</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Take Profit</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#1b2030]">
                                    {positions.map((pos) => (
                                        <tr key={pos.id} className="hover:bg-[#161a28] transition-colors">
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded-md bg-[#181d2c] border border-[#2b344a] flex items-center justify-center text-xs font-bold text-amber-400">
                                                        {pos.coinIcon || (pos.coinSymbol === "ETH" ? "Ξ" : pos.coinSymbol === "SOL" ? "◎" : "₿")}
                                                    </span>
                                                    <div>
                                                        <div className="flex items-center gap-1.5 font-mono font-bold text-white text-xs">
                                                            <span>{pos.coinSymbol || "BTC"}</span>
                                                            <span className={`px-1.5 py-0.2 rounded text-[10px] font-black ${
                                                                pos.type === "CALL" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                            }`}>
                                                                {pos.strike?.toLocaleString()} {pos.type === "CALL" ? "CE" : "PE"}
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] text-gray-400 font-mono">
                                                            {pos.expiry}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span className={`px-2 py-0.5 rounded font-black text-[10px] ${
                                                    pos.side === "BUY" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                                }`}>
                                                    {pos.side}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-300 font-semibold">{pos.size}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-300">{formatMoney(pos.entryPrice, currency === "INR" ? 0 : 2)}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-white font-bold">
                                                {formatMoney(pos.markPrice, currency === "INR" ? 0 : 2)}
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <div className={`font-bold ${pos.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                    <span>{pos.unrealizedPnl >= 0 ? "+" : ""}{formatMoney(pos.unrealizedPnl, currency === "INR" ? 0 : 2)}</span>
                                                    <span className="text-[10px] ml-1 opacity-80">
                                                        ({pos.pnlPct >= 0 ? "+" : ""}{pos.pnlPct.toFixed(1)}%)
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded bg-rose-900/30 text-rose-300 border border-rose-700/40 text-[11px] font-bold inline-flex items-center gap-1">
                                                    <FiShield size={10} className="text-rose-400" />
                                                    <span>{pos.slTrigger || "None"}</span>
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded bg-emerald-900/30 text-emerald-300 border border-emerald-700/40 text-[11px] font-bold inline-flex items-center gap-1">
                                                    <FiTarget size={10} className="text-emerald-400" />
                                                    <span>{pos.tpTrigger || "None"}</span>
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-right space-x-1.5">
                                                <button
                                                    onClick={() => handleOpenEditSlModal(pos)}
                                                    className="px-2.5 py-1 rounded bg-[#232b3d] hover:bg-[#2e3952] text-gray-300 hover:text-white border border-gray-700 text-[11px] font-bold transition-colors inline-flex items-center gap-1 cursor-pointer"
                                                >
                                                    <FiEdit3 size={11} />
                                                    <span>Edit SL</span>
                                                </button>
                                                <button
                                                    onClick={() => handleClosePosition(pos.id)}
                                                    className="px-2.5 py-1 rounded bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[11px] font-bold transition-colors cursor-pointer"
                                                >
                                                    Market Close
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : !isAuthenticated ? (
                            <div className="p-8 sm:p-12 flex flex-col items-center justify-center text-center space-y-4 bg-[#0d1017]">
                                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xl shadow-amber-950/50">
                                    <FiLayers size={26} />
                                </div>
                                <div className="space-y-1.5 max-w-md">
                                    <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                                        No Active Crypto Positions
                                    </h3>
                                    <p className="text-xs text-gray-400 leading-relaxed">
                                        Build a multi-leg crypto strategy using the Option Chain above and click <strong>Execute Strategy with Stop Loss</strong> to test trades in the Delta Simulator.
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                                    <button
                                        onClick={() => {
                                            if (chainTableContainerRef.current) {
                                                chainTableContainerRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
                                            }
                                        }}
                                        className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs shadow-lg shadow-amber-950/50 transition cursor-pointer flex items-center gap-2 hover:scale-[1.02]"
                                    >
                                        <FiGrid size={13} />
                                        <span>Open Option Chain</span>
                                    </button>
                                    <button
                                        onClick={() => navigate(`/login?mode=login&redirect=${selfPath}`)}
                                        className="px-5 py-2.5 rounded-xl border border-[#2e374f] text-gray-300 hover:text-white hover:bg-[#161c2b] font-bold text-xs transition cursor-pointer"
                                    >
                                        <span>Log In to Sync Profile</span>
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12 text-gray-500 text-xs">
                                No open positions. Build a strategy above and click <strong>Execute Strategy</strong> to place orders.
                            </div>
                        )}
                    </div>
                )}

                {/* 2. STOP ORDERS TABLE */}
                {bottomTab === "stop_orders" && (
                    <div className="overflow-x-auto custom-scrollbar">
                        {stopOrders.length > 0 ? (
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-[#141926] text-gray-400 uppercase text-[10px] font-bold tracking-wider border-b border-[#232a3d]">
                                    <tr>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Order ID</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Target Contract</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Type</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Trigger Condition</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Order Type</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Created At</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#1b2030]">
                                    {stopOrders.map((so) => (
                                        <tr key={so.id} className="hover:bg-[#161a28] transition-colors">
                                            <td className="py-2.5 px-3 whitespace-nowrap font-bold text-amber-400">{so.id}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-white font-bold">{so.contract}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span
                                                    className={`px-2 py-0.5 rounded font-black text-[10px] ${
                                                        so.type === "STOP_LOSS"
                                                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                                            : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                                    }`}
                                                >
                                                    {so.type === "STOP_LOSS" ? "STOP LOSS" : "TAKE PROFIT"}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap font-bold text-gray-200">{so.condition}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-400">{so.orderType}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px] inline-flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                    {so.status}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-400">{so.createdAt}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-right">
                                                <button
                                                    onClick={() => handleCancelStopOrder(so.id)}
                                                    className="px-2.5 py-1 rounded bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-[11px] font-bold transition-colors cursor-pointer"
                                                >
                                                    Cancel Trigger
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="text-center py-10 text-gray-500 text-xs font-mono">
                                No active Stop Loss or Take Profit trigger orders.
                            </div>
                        )}
                    </div>
                )}

                {/* 3. OPEN ORDERS TABLE */}
                {bottomTab === "open_orders" && (
                    <div className="p-8 text-center py-10 text-gray-500 text-xs font-mono">
                        No pending limit orders. All market orders were immediately executed at best Delta price.
                    </div>
                )}

                {/* 4. FILLS TABLE */}
                {bottomTab === "fills" && (
                    <div className="overflow-x-auto custom-scrollbar">
                        {fills.length > 0 ? (
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-[#141926] text-gray-400 uppercase text-[10px] font-bold tracking-wider border-b border-[#232a3d]">
                                    <tr>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Fill ID</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Order ID</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Contract</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Side</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Size</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Executed Price</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Fee</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Time</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Type</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#1b2030]">
                                    {fills.map((f) => (
                                        <tr key={f.id} className="hover:bg-[#161a28] transition-colors">
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-400">{f.id}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap font-bold text-amber-400">{f.orderId}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-white font-bold">{f.contract}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span
                                                    className={`px-2 py-0.5 rounded font-black text-[10px] ${
                                                        f.side === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                    }`}
                                                >
                                                    {f.side}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-300">{f.size}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-white font-bold">{f.price}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-400">{f.fee}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-400">{f.time}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-300 text-[10px] font-bold">
                                                    {f.type}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="text-center py-10 text-gray-500 text-xs font-mono">
                                No execution fills recorded yet.
                            </div>
                        )}
                    </div>
                )}

                {/* 5. ORDER HISTORY TABLE */}
                {bottomTab === "order_history" && (
                    <div className="overflow-x-auto custom-scrollbar">
                        {orderHistory.length > 0 ? (
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="bg-[#141926] text-gray-400 uppercase text-[10px] font-bold tracking-wider border-b border-[#232a3d]">
                                    <tr>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Order ID</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Contract</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Side</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Order Type</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Price</th>
                                        <th className="py-2.5 px-3 whitespace-nowrap">Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#1b2030]">
                                    {orderHistory.map((oh) => (
                                        <tr key={oh.id} className="hover:bg-[#161a28] transition-colors">
                                            <td className="py-2.5 px-3 whitespace-nowrap font-bold text-amber-400">{oh.id}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-white font-bold">{oh.contract}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span
                                                    className={`px-2 py-0.5 rounded font-black text-[10px] ${
                                                        oh.side === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"
                                                    }`}
                                                >
                                                    {oh.side}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-400">{oh.type}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap">
                                                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                                                    {oh.status}
                                                </span>
                                            </td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-white font-bold">{oh.price}</td>
                                            <td className="py-2.5 px-3 whitespace-nowrap text-gray-400">{oh.time}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="text-center py-10 text-gray-500 text-xs font-mono">
                                No past order history.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 5. EDIT STOP LOSS / TAKE PROFIT MODAL DIALOG                  */}
            {/* ------------------------------------------------------------- */}
            {editingSlItem && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-md bg-[#11141f] border border-[#262e42] rounded-2xl p-5 shadow-2xl space-y-4 text-gray-200">
                        <div className="flex items-center justify-between pb-3 border-b border-[#23293d]">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
                                    <FiShield size={16} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-sm text-white">
                                        Modify Stop Loss & Target
                                    </h3>
                                    <div className="text-[11px] text-gray-400 font-mono">
                                        {editingSlItem.symbol || editingSlItem.contract}
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setEditingSlItem(null)}
                                className="text-gray-400 hover:text-white"
                            >
                                <FiX size={18} />
                            </button>
                        </div>

                        <div className="space-y-3 font-sans text-xs">
                            <div>
                                <label className="block text-gray-400 mb-1 font-medium">
                                    Stop Loss Condition / Trigger:
                                </label>
                                <input
                                    type="text"
                                    value={editSlValue}
                                    onChange={(e) => setEditSlValue(e.target.value)}
                                    placeholder="e.g. -$50 MTM, or Mark Price <= $120"
                                    className="w-full bg-[#181d2c] border border-[#2b344a] rounded-lg px-3 py-2 text-white font-mono font-bold focus:border-rose-500 focus:outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-gray-400 mb-1 font-medium">
                                    Take Profit Target:
                                </label>
                                <input
                                    type="text"
                                    value={editTpValue}
                                    onChange={(e) => setEditTpValue(e.target.value)}
                                    placeholder="e.g. +$100 MTM, or Mark Price >= $250"
                                    className="w-full bg-[#181d2c] border border-[#2b344a] rounded-lg px-3 py-2 text-white font-mono font-bold focus:border-emerald-500 focus:outline-none"
                                />
                            </div>

                            <div className="p-2.5 rounded-lg bg-[#0c0f17] border border-[#1e2436] text-[11px] text-gray-400 space-y-1">
                                <div className="flex justify-between">
                                    <span>Entry Price:</span>
                                    <strong className="text-white font-mono">${formatNumber(editingSlItem.entryPrice)}</strong>
                                </div>
                                <div className="flex justify-between">
                                    <span>Current Mark Price:</span>
                                    <strong className="text-white font-mono">${formatNumber(editingSlItem.markPrice)}</strong>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#23293d]">
                            <button
                                onClick={() => setEditingSlItem(null)}
                                className="px-4 py-2 rounded-lg bg-[#1a1f2c] hover:bg-[#252c3e] text-gray-300 text-xs font-bold transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveEditSl}
                                className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black text-xs font-extrabold shadow-lg shadow-amber-900/30 transition-all"
                            >
                                Update Trigger
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* 6. STRATEGY & LEG STOP LOSS / TAKE PROFIT MODAL DIALOG       */}
            {/* ------------------------------------------------------------- */}
            {isSlModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-[#11141f] border border-[#2b344a] rounded-2xl p-6 shadow-2xl space-y-4 text-gray-200 animate-in fade-in zoom-in-95 duration-150">
                        {/* If opening for a specific BUY leg */}
                        {activeBuyLegForSl ? (
                            <>
                                {/* Modal Header for BUY Leg */}
                                <div className="flex items-center justify-between pb-3 border-b border-[#23293d]">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-2 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-500 text-white shadow-md shadow-rose-900/30">
                                            <FiShield size={18} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h3 className="font-extrabold text-base text-white">
                                                    Configure % Stop Loss & Target
                                                </h3>
                                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold">
                                                    BUY (Long)
                                                </span>
                                            </div>
                                            <div className="text-xs text-gray-400 font-mono flex items-center gap-2 mt-0.5">
                                                <span className="text-amber-300 font-bold">{activeBuyLegForSl.symbol}</span>
                                                <span>•</span>
                                                <span>Premium: <strong className="text-white">{formatMoney(activeBuyLegForSl.price || 100, currency === "INR" ? 0 : 2)}</strong></span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setIsSlModalOpen(false);
                                            setActiveBuyLegForSl(null);
                                        }}
                                        className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition cursor-pointer"
                                    >
                                        <FiX size={20} />
                                    </button>
                                </div>

                                {/* Modal Body for BUY Leg */}
                                <div className="space-y-4 text-xs">
                                    {/* STOP LOSS PERCENTAGE SECTION */}
                                    <div className="p-3.5 rounded-xl bg-[#0c0f17] border border-rose-500/30 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-rose-300">
                                                <input
                                                    type="checkbox"
                                                    checked={legSlEnabled}
                                                    onChange={(e) => setLegSlEnabled(e.target.checked)}
                                                    className="w-4 h-4 rounded bg-[#171c2b] border-rose-500/50 text-rose-600 focus:ring-0 cursor-pointer"
                                                />
                                                <span>Stop Loss % (Debit Protection)</span>
                                            </label>
                                            {legSlEnabled && (
                                                <span className="text-rose-400 font-mono font-bold text-xs">
                                                    -{legSlPctInput}% Loss
                                                </span>
                                            )}
                                        </div>

                                        {legSlEnabled && (
                                            <div className="space-y-2.5 pt-1">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative flex-1">
                                                        <span className="absolute left-3 top-2 text-gray-500 font-mono text-xs font-bold">-</span>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="99"
                                                            value={legSlPctInput}
                                                            onChange={(e) => setLegSlPctInput(Math.min(99, Math.max(1, Number(e.target.value))))}
                                                            className="w-full bg-[#141926] border border-[#262e42] rounded-lg pl-6 pr-8 py-1.5 text-sm text-white font-mono font-bold focus:border-rose-500 focus:outline-none"
                                                        />
                                                        <span className="absolute right-3 top-2 text-gray-400 font-bold">%</span>
                                                    </div>

                                                    <div className="text-right font-mono bg-[#141926] px-3 py-1.5 rounded-lg border border-[#262e42] text-[11px]">
                                                        <span className="text-gray-400 block text-[10px]">Trigger Price</span>
                                                        <strong className="text-rose-400 font-bold">
                                                            {formatMoney((activeBuyLegForSl.price || 100) * (1 - legSlPctInput / 100), currency === "INR" ? 0 : 2)}
                                                        </strong>
                                                    </div>
                                                </div>

                                                {/* Preset Buttons */}
                                                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                                    <span className="text-gray-400">Quick SL Presets:</span>
                                                    {[10, 20, 25, 35, 50, 75].map((pct) => (
                                                        <button
                                                            key={pct}
                                                            onClick={() => setLegSlPctInput(pct)}
                                                            className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                                legSlPctInput === pct
                                                                    ? "bg-rose-600 text-white border-rose-500 shadow"
                                                                    : "bg-[#181d2c] text-gray-300 border-[#2b344a] hover:bg-[#22293d]"
                                                            }`}
                                                        >
                                                            -{pct}%
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* TAKE PROFIT PERCENTAGE SECTION */}
                                    <div className="p-3.5 rounded-xl bg-[#0c0f17] border border-emerald-500/30 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-emerald-300">
                                                <input
                                                    type="checkbox"
                                                    checked={legTpEnabled}
                                                    onChange={(e) => setLegTpEnabled(e.target.checked)}
                                                    className="w-4 h-4 rounded bg-[#171c2b] border-emerald-500/50 text-emerald-600 focus:ring-0 cursor-pointer"
                                                />
                                                <span>Take Profit % (Target)</span>
                                            </label>
                                            {legTpEnabled && (
                                                <span className="text-emerald-400 font-mono font-bold text-xs">
                                                    +{legTpPctInput}% Gain
                                                </span>
                                            )}
                                        </div>

                                        {legTpEnabled && (
                                            <div className="space-y-2.5 pt-1">
                                                <div className="flex items-center gap-3">
                                                    <div className="relative flex-1">
                                                        <span className="absolute left-3 top-2 text-gray-500 font-mono text-xs font-bold">+</span>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            max="1000"
                                                            value={legTpPctInput}
                                                            onChange={(e) => setLegTpPctInput(Math.max(1, Number(e.target.value)))}
                                                            className="w-full bg-[#141926] border border-[#262e42] rounded-lg pl-6 pr-8 py-1.5 text-sm text-white font-mono font-bold focus:border-emerald-500 focus:outline-none"
                                                        />
                                                        <span className="absolute right-3 top-2 text-gray-400 font-bold">%</span>
                                                    </div>

                                                    <div className="text-right font-mono bg-[#141926] px-3 py-1.5 rounded-lg border border-[#262e42] text-[11px]">
                                                        <span className="text-gray-400 block text-[10px]">Target Price</span>
                                                        <strong className="text-emerald-400 font-bold">
                                                            {formatMoney((activeBuyLegForSl.price || 100) * (1 + legTpPctInput / 100), currency === "INR" ? 0 : 2)}
                                                        </strong>
                                                    </div>
                                                </div>

                                                {/* Preset Buttons */}
                                                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                                    <span className="text-gray-400">Quick Target Presets:</span>
                                                    {[25, 50, 75, 100, 150, 200].map((pct) => (
                                                        <button
                                                            key={pct}
                                                            onClick={() => setLegTpPctInput(pct)}
                                                            className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                                legTpPctInput === pct
                                                                    ? "bg-emerald-600 text-white border-emerald-500 shadow"
                                                                    : "bg-[#181d2c] text-gray-300 border-[#2b344a] hover:bg-[#22293d]"
                                                            }`}
                                                        >
                                                            +{pct}%
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Modal Footer for BUY Leg */}
                                <div className="flex items-center justify-between pt-3 border-t border-[#23293d]">
                                    <button
                                        onClick={() => {
                                            setLegSlEnabled(false);
                                            setLegTpEnabled(false);
                                            setStrategyLegs((prev) =>
                                                prev.map((l) =>
                                                    l.id === activeBuyLegForSl.id ? { ...l, slPct: null, tpPct: null } : l
                                                )
                                            );
                                            setIsSlModalOpen(false);
                                            setActiveBuyLegForSl(null);
                                        }}
                                        className="px-3 py-2 rounded-xl bg-[#181d2c] hover:bg-[#22293d] text-rose-400 text-xs font-bold transition cursor-pointer"
                                    >
                                        Remove % SL/TP
                                    </button>

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => {
                                                setIsSlModalOpen(false);
                                                setActiveBuyLegForSl(null);
                                            }}
                                            className="px-4 py-2 rounded-xl bg-[#181d2c] hover:bg-[#22293d] text-gray-300 text-xs font-bold transition cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleSaveLegSl}
                                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black text-xs font-extrabold shadow-lg shadow-amber-900/40 transition cursor-pointer"
                                        >
                                            Save % Triggers
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Strategy-wide Modal Header */}
                                <div className="flex items-center justify-between pb-3 border-b border-[#23293d]">
                                    <div className="flex items-center gap-2.5">
                                        <div className="p-2 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-500 text-white shadow-md shadow-rose-900/30">
                                            <FiShield size={18} />
                                        </div>
                                        <div>
                                            <h3 className="font-extrabold text-base text-white">
                                                Risk Management & Stop Loss
                                            </h3>
                                            <div className="text-xs text-gray-400">
                                                Set automated exit triggers for {selectedCoin} Strategy ({activeSelectedLegs.length} Legs)
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setIsSlModalOpen(false)}
                                        className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition cursor-pointer"
                                    >
                                        <FiX size={20} />
                                    </button>
                                </div>

                                {/* Modal Body */}
                                <div className="space-y-4 text-xs">
                                    {/* STOP LOSS SECTION */}
                                    <div className="p-3.5 rounded-xl bg-[#0c0f17] border border-rose-500/30 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-rose-300">
                                                <input
                                                    type="checkbox"
                                                    checked={enableStopLoss}
                                                    onChange={(e) => setEnableStopLoss(e.target.checked)}
                                                    className="w-4 h-4 rounded bg-[#171c2b] border-rose-500/50 text-rose-600 focus:ring-0 cursor-pointer"
                                                />
                                                <span>Stop Loss (SL)</span>
                                            </label>

                                            {enableStopLoss && (
                                                <div className="flex rounded-lg bg-[#151926] p-0.5 border border-[#23293d] text-xs">
                                                    <button
                                                        onClick={() => {
                                                            setSlType("mtm_loss");
                                                            setSlValue(150);
                                                        }}
                                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                                            slType === "mtm_loss" ? "bg-rose-600 text-white shadow" : "text-gray-400 hover:text-gray-200"
                                                        }`}
                                                    >
                                                        Max Loss ($)
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setSlType("pct_loss");
                                                            setSlValue(25);
                                                        }}
                                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                                            slType === "pct_loss" ? "bg-rose-600 text-white shadow" : "text-gray-400 hover:text-gray-200"
                                                        }`}
                                                    >
                                                        % Loss
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setSlType("spot_price");
                                                            setSlValue(Math.round((chainData.spotPrice || 83025) * 0.98));
                                                        }}
                                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                                            slType === "spot_price" ? "bg-rose-600 text-white shadow" : "text-gray-400 hover:text-gray-200"
                                                        }`}
                                                    >
                                                        Spot Price
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {enableStopLoss && (
                                            <div className="space-y-2.5 pt-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="relative flex-1">
                                                        <span className="absolute left-3 top-2 text-gray-500 font-mono text-xs font-bold">
                                                            {slType === "mtm_loss" ? "-$" : slType === "pct_loss" ? "-" : "$"}
                                                        </span>
                                                        <input
                                                            type="number"
                                                            value={slValue}
                                                            onChange={(e) => setSlValue(Number(e.target.value))}
                                                            placeholder="Enter SL value"
                                                            className="w-full bg-[#141926] border border-[#262e42] rounded-lg pl-8 pr-3 py-1.5 text-sm text-white font-mono font-bold focus:border-rose-500 focus:outline-none"
                                                        />
                                                    </div>
                                                    {slType === "pct_loss" && <span className="text-gray-400 font-bold">%</span>}
                                                </div>

                                                {/* Quick Presets */}
                                                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                                    <span className="text-gray-400">Quick SL Presets:</span>
                                                    {slType === "mtm_loss" && (
                                                        <>
                                                            {[-50, -100, -250, -500].map((val) => (
                                                                <button
                                                                    key={val}
                                                                    onClick={() => setSlValue(Math.abs(val))}
                                                                    className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                                        slValue === Math.abs(val)
                                                                            ? "bg-rose-600 text-white border-rose-500"
                                                                            : "bg-[#181d2c] text-gray-300 border-[#2b344a] hover:bg-[#22293d]"
                                                                    }`}
                                                                >
                                                                    ${val}
                                                                </button>
                                                            ))}
                                                        </>
                                                    )}
                                                    {slType === "pct_loss" && (
                                                        <>
                                                            {[15, 25, 50, 75].map((val) => (
                                                                <button
                                                                    key={val}
                                                                    onClick={() => setSlValue(val)}
                                                                    className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                                        slValue === val
                                                                            ? "bg-rose-600 text-white border-rose-500"
                                                                            : "bg-[#181d2c] text-gray-300 border-[#2b344a] hover:bg-[#22293d]"
                                                                    }`}
                                                                >
                                                                    -{val}%
                                                                </button>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* TAKE PROFIT / TARGET SECTION */}
                                    <div className="p-3.5 rounded-xl bg-[#0c0f17] border border-emerald-500/30 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="flex items-center gap-2 cursor-pointer font-bold text-sm text-emerald-300">
                                                <input
                                                    type="checkbox"
                                                    checked={enableTakeProfit}
                                                    onChange={(e) => setEnableTakeProfit(e.target.checked)}
                                                    className="w-4 h-4 rounded bg-[#171c2b] border-emerald-500/50 text-emerald-600 focus:ring-0 cursor-pointer"
                                                />
                                                <span>Take Profit (Target)</span>
                                            </label>

                                            {enableTakeProfit && (
                                                <div className="flex rounded-lg bg-[#151926] p-0.5 border border-[#23293d] text-xs">
                                                    <button
                                                        onClick={() => {
                                                            setTpType("mtm_profit");
                                                            setTpValue(300);
                                                        }}
                                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                                            tpType === "mtm_profit" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-gray-200"
                                                        }`}
                                                    >
                                                        Target ($)
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setTpType("pct_profit");
                                                            setTpValue(50);
                                                        }}
                                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                                            tpType === "pct_profit" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-gray-200"
                                                        }`}
                                                    >
                                                        % Gain
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setTpType("spot_price");
                                                            setTpValue(Math.round((chainData.spotPrice || 83025) * 1.03));
                                                        }}
                                                        className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                                                            tpType === "spot_price" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-gray-200"
                                                        }`}
                                                    >
                                                        Spot Price
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {enableTakeProfit && (
                                            <div className="space-y-2.5 pt-1">
                                                <div className="flex items-center gap-2">
                                                    <div className="relative flex-1">
                                                        <span className="absolute left-3 top-2 text-gray-500 font-mono text-xs font-bold">
                                                            {tpType === "mtm_profit" ? "+$" : tpType === "pct_profit" ? "+" : "$"}
                                                        </span>
                                                        <input
                                                            type="number"
                                                            value={tpValue}
                                                            onChange={(e) => setTpValue(Number(e.target.value))}
                                                            placeholder="Enter Target value"
                                                            className="w-full bg-[#141926] border border-[#262e42] rounded-lg pl-8 pr-3 py-1.5 text-sm text-white font-mono font-bold focus:border-emerald-500 focus:outline-none"
                                                        />
                                                    </div>
                                                    {tpType === "pct_profit" && <span className="text-gray-400 font-bold">%</span>}
                                                </div>

                                                {/* Quick Presets */}
                                                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                                    <span className="text-gray-400">Quick Target Presets:</span>
                                                    {tpType === "mtm_profit" && (
                                                        <>
                                                            {[100, 250, 500, 1000].map((val) => (
                                                                <button
                                                                    key={val}
                                                                    onClick={() => setTpValue(val)}
                                                                    className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                                        tpValue === val
                                                                            ? "bg-emerald-600 text-white border-emerald-500"
                                                                            : "bg-[#181d2c] text-gray-300 border-[#2b344a] hover:bg-[#22293d]"
                                                                    }`}
                                                                >
                                                                    +${val}
                                                                </button>
                                                            ))}
                                                        </>
                                                    )}
                                                    {tpType === "pct_profit" && (
                                                        <>
                                                            {[25, 50, 100, 200].map((val) => (
                                                                <button
                                                                    key={val}
                                                                    onClick={() => setTpValue(val)}
                                                                    className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                                        tpValue === val
                                                                            ? "bg-emerald-600 text-white border-emerald-500"
                                                                            : "bg-[#181d2c] text-gray-300 border-[#2b344a] hover:bg-[#22293d]"
                                                                    }`}
                                                                >
                                                                    +{val}%
                                                                </button>
                                                            ))}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* TRAILING STOP LOSS OPTION */}
                                    <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-[#0c0f17] border border-[#1e2436]">
                                        <label className="flex items-center gap-2 text-gray-300 cursor-pointer font-medium">
                                            <input
                                                type="checkbox"
                                                checked={trailingSL}
                                                onChange={(e) => setTrailingSL(e.target.checked)}
                                                className="rounded bg-[#171c2b] border-[#2d364f] accent-amber-500 text-amber-500 focus:ring-0 cursor-pointer"
                                            />
                                            <span>Enable Trailing Stop Loss</span>
                                        </label>

                                        {trailingSL && (
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-gray-400">Step:</span>
                                                <input
                                                    type="number"
                                                    value={trailStep}
                                                    onChange={(e) => setTrailStep(Number(e.target.value))}
                                                    className="w-16 bg-[#141926] border border-[#2b344a] rounded px-2 py-1 text-xs text-white font-mono font-bold text-right"
                                                />
                                                <span className="text-gray-400">$</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Modal Footer Actions */}
                                <div className="flex items-center justify-between pt-3 border-t border-[#23293d]">
                                    <button
                                        onClick={() => {
                                            setEnableStopLoss(false);
                                            setEnableTakeProfit(false);
                                            setIsSlModalOpen(false);
                                        }}
                                        className="px-3 py-2 rounded-xl bg-[#181d2c] hover:bg-[#22293d] text-rose-400 text-xs font-bold transition cursor-pointer"
                                    >
                                        Disable All Triggers
                                    </button>

                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setIsSlModalOpen(false)}
                                            className="px-4 py-2 rounded-xl bg-[#181d2c] hover:bg-[#22293d] text-gray-300 text-xs font-bold transition cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => {
                                                setIsSlModalOpen(false);
                                                setOrderSuccessMsg("✅ Stop Loss / Target triggers configured!");
                                                setTimeout(() => setOrderSuccessMsg(null), 3000);
                                            }}
                                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black text-xs font-extrabold shadow-lg shadow-amber-900/30 transition cursor-pointer"
                                        >
                                            Apply & Save
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
