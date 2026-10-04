import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
// pages/BitcoinSimulator.jsx — Premier Bitcoin & Crypto Options Simulator & Replay Station
// Inspired by AlgoTest & Indian Options Simulator with dedicated Bitcoin Gold Theme:
// - Bitcoin Gold & Crypto Dark Aesthetics (₿ BTCUSD, Amber accents #f59e0b / #f7931a)
// - Dual Action BUY ('B' Emerald) & SELL ('S' Rose) Buttons on every Call & Put strike
// - Interactive Multi-Leg Payoff Engine (Expiry Curve + Target Date MTM Curve + IV Shock)
// - Complete Simulator Metrics (Max Profit, Max Loss, Breakevens, POP, Risk:Reward, Greeks)
// - 24/7 Tick Time Slider & Fast Jumps (-1d, BOD, -1h, -15m, -1m, +1m, +15m, +1h, EOD, +1d)
// - 1-Click Institutional Presets (Straddle, Strangle, Iron Condor, Bull Call Spread, Iron Fly)

import { Link, useNavigate } from "react-router-dom";
import {
    FiPlay,
    FiPause,
    FiRotateCcw,
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
    FiUpload,
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
    FiExternalLink,
    FiShare2,
    FiLock,
    FiEye,
    FiX,
    FiCalendar,
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
import {
    computePayoffCurve,
    computeBreakevens,
    computeMaxProfitLoss,
    computeRiskRewardRatio,
} from "../utils/payoff";
import { useAuth } from "../context/AuthContext";

// Crypto Asset Definitions
const CRYPTO_ASSETS = [
    {
        symbol: "BTCUSD",
        name: "Bitcoin",
        lotSize: 1,
        strikeStep: 200,
        basePrice: 83322.3,
        perpBasis: -42.3,
        icon: "₿",
        badge: "BTC 24/7",
    },
    {
        symbol: "ETHUSD",
        name: "Ethereum",
        lotSize: 1,
        strikeStep: 25,
        basePrice: 3485.4,
        perpBasis: -2.1,
        icon: "Ξ",
        badge: "ETH 24/7",
    },
    {
        symbol: "SOLUSD",
        name: "Solana",
        lotSize: 10,
        strikeStep: 2,
        basePrice: 154.8,
        perpBasis: 0.25,
        icon: "◎",
        badge: "SOL 24/7",
    },
];

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatCryptoPrice(val, decimals = 2) {
    if (val == null || isNaN(val)) return "0.00";
    return Number(val).toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}

function formatDelta(val) {
    if (val == null || isNaN(val)) return "0.00";
    return Number(val).toFixed(2);
}

function formatIV(val) {
    if (val == null || isNaN(val)) return "0.0";
    return Number(val).toFixed(1);
}

export default function BitcoinSimulator() {
    const { isPro } = useAuth();
    const navigate = useNavigate();

    // Selected Crypto Asset
    const [selectedAsset, setSelectedAsset] = useState(CRYPTO_ASSETS[0]);
    const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);

    // Simulation Date & Time (in minutes from 00:00 to 1439)
    const [simDate, setSimDate] = useState(() => {
        const d = new Date();
        return d.toISOString().split("T")[0]; // YYYY-MM-DD
    });
    const [simMinute, setSimMinute] = useState(556); // 09:16 default
    const [isPlaying, setIsPlaying] = useState(false);
    const [playSpeed, setPlaySpeed] = useState(1); // 1x, 2x, 5x, 10x

    // Navigation Sub-Header Tabs: 'chain' | 'positions' | 'payoff' | 'chart'
    const [activeViewTab, setActiveViewTab] = useState("chain");
    const [activeSideDrawer, setActiveSideDrawer] = useState("payoff"); // 'payoff' | 'greeks' | 'presets' | null
    const [viewPositionsOnly, setViewPositionsOnly] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showImportExportModal, setShowImportExportModal] = useState(false);
    const [strikeRangeCount, setStrikeRangeCount] = useState(14); // 14 strikes above & below ATM

    // Target Time Simulation (Target Date / Target Hour for MTM curve)
    const [targetDaysAhead, setTargetDaysAhead] = useState(0);
    const [targetMinuteOffset, setTargetMinuteOffset] = useState(0); // 0 to 1440 mins ahead
    const [ivShockPct, setIvShockPct] = useState(0); // -20% to +20% IV shock

    // Active Strategy Legs (Basket)
    const [legs, setLegs] = useState([]);

    // Expiry Catalog Generation
    const expiries = useMemo(() => {
        const base = new Date(simDate);
        const list = [];
        const offsets = [0, 1, 2, 7, 14, 28, 56, 84];

        for (let i = 0; i < offsets.length; i++) {
            const exp = new Date(base);
            exp.setDate(exp.getDate() + offsets[i]);
            const day = String(exp.getDate()).padStart(2, "0");
            const month = MONTH_NAMES[exp.getMonth()];
            const year = String(exp.getFullYear()).slice(-2);
            const iso = exp.toISOString().split("T")[0];
            const daysLeft = offsets[i];
            list.push({
                key: iso,
                label: `${day} ${month}`,
                subLabel: `(${daysLeft}d)`,
                daysLeft,
                iso,
                dateObj: exp,
            });
        }
        return list;
    }, [simDate]);

    const [selectedExpiryKey, setSelectedExpiryKey] = useState("");

    useEffect(() => {
        if (expiries.length > 0 && (!selectedExpiryKey || !expiries.some((e) => e.key === selectedExpiryKey))) {
            setSelectedExpiryKey(expiries[0].key);
        }
    }, [expiries, selectedExpiryKey]);

    const currentExpiry = useMemo(() => {
        return expiries.find((e) => e.key === selectedExpiryKey) || expiries[0];
    }, [expiries, selectedExpiryKey]);

    // Simulated Spot Price with realistic intra-day volatility
    const currentSpot = useMemo(() => {
        const timeFactor = Math.sin((simMinute / 1440) * Math.PI * 4) * 0.008;
        const noise = Math.sin(simMinute * 17.3) * 0.002;
        const drift = ((simMinute - 556) / 1440) * 0.005;
        const price = selectedAsset.basePrice * (1 + timeFactor + noise + drift);
        return Math.round(price * 100) / 100;
    }, [selectedAsset.basePrice, simMinute]);

    const currentPerp = useMemo(() => {
        return Math.round((currentSpot + selectedAsset.perpBasis) * 100) / 100;
    }, [currentSpot, selectedAsset.perpBasis]);

    const spotChange = useMemo(() => {
        const diff = currentSpot - selectedAsset.basePrice;
        const pct = (diff / selectedAsset.basePrice) * 100;
        return { diff, pct };
    }, [currentSpot, selectedAsset.basePrice]);

    // Playback loop
    useEffect(() => {
        if (!isPlaying) return;
        const interval = setInterval(() => {
            setSimMinute((prev) => {
                const next = prev + playSpeed;
                if (next >= 1439) {
                    setIsPlaying(false);
                    return 1439;
                }
                return next;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [isPlaying, playSpeed]);

    // Time string formatting (HH:MM)
    const timeString = useMemo(() => {
        const hours = Math.floor(simMinute / 60);
        const mins = simMinute % 60;
        return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    }, [simMinute]);

    // Generate Option Chain Matrix with exact AlgoTest layout + BUY/SELL Buttons
    const optionChainRows = useMemo(() => {
        if (!currentExpiry) return [];

        const step = selectedAsset.strikeStep;
        const atmStrike = Math.round(currentSpot / step) * step;
        const strikes = [];

        for (let i = -strikeRangeCount; i <= strikeRangeCount; i++) {
            strikes.push(atmStrike + i * step);
        }

        const daysToExp = Math.max(0.001, currentExpiry.daysLeft + (1440 - simMinute) / 1440);
        const tYears = daysToExp / 365;

        return strikes.map((strike) => {
            const moneyness = Math.log(strike / currentSpot);
            const baseVol = 0.42 * (1 + ivShockPct / 100);
            const ivVal = Math.max(0.15, baseVol + moneyness * moneyness * 0.8 - moneyness * 0.15);
            const ivDisplay = ivVal * 100;

            const callPrice = bsPrice({
                spot: currentSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "CE",
            });
            const callGreeks = calculateGreeks({
                spot: currentSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "CE",
            });

            const putPrice = bsPrice({
                spot: currentSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "PE",
            });
            const putGreeks = calculateGreeks({
                spot: currentSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "PE",
            });

            const isAtm = strike === atmStrike;
            const isCallItm = strike < currentSpot;
            const isPutItm = strike > currentSpot;

            const callLeg = legs.find(
                (l) => l.strike === strike && l.right === "CE" && l.expiry === currentExpiry.iso
            );
            const putLeg = legs.find(
                (l) => l.strike === strike && l.right === "PE" && l.expiry === currentExpiry.iso
            );

            return {
                strike,
                isAtm,
                isCallItm,
                isPutItm,
                iv: ivDisplay,
                call: {
                    price: Math.max(0.01, callPrice),
                    delta: callGreeks.delta,
                    theta: callGreeks.theta,
                    gamma: callGreeks.gamma,
                    vega: callGreeks.vega,
                    leg: callLeg,
                },
                put: {
                    price: Math.max(0.01, putPrice),
                    delta: putGreeks.delta,
                    theta: putGreeks.theta,
                    gamma: putGreeks.gamma,
                    vega: putGreeks.vega,
                    leg: putLeg,
                },
            };
        });
    }, [currentExpiry, selectedAsset.strikeStep, currentSpot, strikeRangeCount, simMinute, ivShockPct, legs]);

    // Add or modify a leg with explicit BUY or SELL action
    const handleToggleLeg = useCallback((strike, right, action, price) => {
        if (!currentExpiry) return;
        const expiry = currentExpiry.iso;
        setLegs((prev) => {
            const existingIdx = prev.findIndex(
                (l) => l.strike === strike && l.right === right && l.expiry === expiry
            );
            if (existingIdx >= 0) {
                const existing = prev[existingIdx];
                if (existing.action === action) {
                    // Remove if clicked same action again
                    return prev.filter((_, idx) => idx !== existingIdx);
                } else {
                    // Switch BUY <-> SELL
                    const updated = [...prev];
                    updated[existingIdx] = {
                        ...existing,
                        action,
                        entryPrice: price,
                    };
                    return updated;
                }
            } else {
                // Add new leg
                const newLeg = {
                    id: `${selectedAsset.symbol}-${expiry}-${strike}-${right}-${Date.now()}`,
                    symbol: selectedAsset.symbol,
                    expiry,
                    expiryLabel: currentExpiry.label,
                    strike,
                    right,
                    action,
                    lots: selectedAsset.lotSize,
                    entryPrice: price,
                    currentPrice: price,
                    iv: 42,
                };
                return [...prev, newLeg];
            }
        });
    }, [currentExpiry, selectedAsset]);

    const handleUpdateLots = useCallback((legId, delta) => {
        setLegs((prev) =>
            prev.map((l) => {
                if (l.id === legId) {
                    const newLots = Math.max(1, l.lots + delta);
                    return { ...l, lots: newLots };
                }
                return l;
            })
        );
    }, []);

    const handleRemoveLeg = useCallback((legId) => {
        setLegs((prev) => prev.filter((l) => l.id !== legId));
    }, []);

    const handleClearLegs = useCallback(() => {
        setLegs([]);
    }, []);

    // Quick Time Jumps
    const jumpTime = useCallback((offsetMins) => {
        setSimMinute((prev) => Math.max(0, Math.min(1439, prev + offsetMins)));
    }, []);

    const setExactTimePreset = useCallback((preset) => {
        if (preset === "BOD") setSimMinute(0); // 00:00
        else if (preset === "EOD") setSimMinute(1439); // 23:59
        else if (preset === "09:16") setSimMinute(556);
        else if (preset === "15:30") setSimMinute(930);
    }, []);

    const jumpDay = useCallback((dayDelta) => {
        setSimDate((prev) => {
            const d = new Date(prev);
            d.setDate(d.getDate() + dayDelta);
            return d.toISOString().split("T")[0];
        });
    }, []);

    // Portfolio Payoff & Comprehensive Greeks Engine
    const portfolioSummary = useMemo(() => {
        if (legs.length === 0) {
            return {
                netPnL: 0,
                netDelta: 0,
                netTheta: 0,
                netGamma: 0,
                netVega: 0,
                maxProfit: 0,
                maxLoss: 0,
                breakevens: [],
                riskReward: "0.00",
                pop: 50,
                netDebit: 0,
                estMargin: 0,
                curve: [],
            };
        }

        let netPnL = 0;
        let netDelta = 0;
        let netTheta = 0;
        let netGamma = 0;
        let netVega = 0;
        let netDebit = 0;

        legs.forEach((leg) => {
            const mult = leg.action === "BUY" ? 1 : -1;
            const row = optionChainRows.find((r) => r.strike === leg.strike);
            const livePrice = row
                ? leg.right === "CE"
                    ? row.call.price
                    : row.put.price
                : leg.entryPrice;
            const pnl = (livePrice - leg.entryPrice) * mult * leg.lots;
            netPnL += pnl;
            netDebit += leg.entryPrice * mult * leg.lots;

            if (row) {
                const g = leg.right === "CE" ? row.call : row.put;
                netDelta += g.delta * mult * leg.lots;
                netTheta += g.theta * mult * leg.lots;
                netGamma += g.gamma * mult * leg.lots;
                netVega += g.vega * mult * leg.lots;
            }
        });

        // Payoff curve for graph
        const minP = currentSpot * 0.85;
        const maxP = currentSpot * 1.15;
        let curve = computePayoffCurve(legs, { minPrice: minP, maxPrice: maxP, steps: 80 }) || [];
        const breakevens = computeBreakevens(legs) || [];
        const { maxProfit, maxLoss } = computeMaxProfitLoss(legs);

        // Add Target Date MTM curve with time decay
        const targetDaysRemaining = Math.max(0.01, (currentExpiry?.daysLeft || 0) - targetDaysAhead);
        const tTargetYears = targetDaysRemaining / 365;

        curve = curve.map((pt) => {
            let targetPnl = 0;
            legs.forEach((leg) => {
                const mult = leg.action === "BUY" ? 1 : -1;
                const bsVal = bsPrice({
                    spot: pt.price,
                    strike: leg.strike,
                    t: tTargetYears,
                    vol: 0.42 * (1 + ivShockPct / 100),
                    right: leg.right,
                });
                targetPnl += (bsVal - leg.entryPrice) * mult * leg.lots;
            });
            return {
                ...pt,
                targetPnl: Math.round(targetPnl * 100) / 100,
            };
        });

        // Probability of Profit (POP) approximation
        let pop = 50;
        if (breakevens.length === 1) {
            const be = breakevens[0];
            const d2 = (Math.log(currentSpot / be) + (0.05 - 0.5 * 0.42 * 0.42) * 0.1) / (0.42 * Math.sqrt(0.1));
            pop = Math.round(normCdf(d2) * 100);
        } else if (breakevens.length >= 2) {
            const beLow = Math.min(...breakevens);
            const beHigh = Math.max(...breakevens);
            const dLow = (Math.log(currentSpot / beLow)) / (0.42 * Math.sqrt(0.1));
            const dHigh = (Math.log(currentSpot / beHigh)) / (0.42 * Math.sqrt(0.1));
            pop = Math.round(Math.abs(normCdf(dHigh) - normCdf(dLow)) * 100);
        }

        // Est. Margin (Approx 15% of spot per short leg)
        const shortLegsCount = legs.filter((l) => l.action === "SELL").length;
        const estMargin = shortLegsCount * currentSpot * 0.15 + Math.max(0, netDebit);

        return {
            netPnL,
            netDelta,
            netTheta,
            netGamma,
            netVega,
            maxProfit,
            maxLoss,
            breakevens,
            pop: Math.min(99, Math.max(1, pop)),
            netDebit,
            estMargin,
            curve,
        };
    }, [legs, optionChainRows, currentSpot, currentExpiry, targetDaysAhead, ivShockPct]);

    const syntheticFut = useMemo(() => {
        return Math.round((currentSpot + 7.38) * 100) / 100;
    }, [currentSpot]);

    return (
        <div className="min-h-screen bg-[#070a11] text-gray-200 flex flex-col font-sans select-none antialiased">
            {/* Top Amber Replay Timeline & Scrubbing Ribbon */}
            <div className="bg-[#0b101d] border-b border-amber-500/20 px-4 py-1.5 flex flex-col gap-1.5 shrink-0 shadow-md">
                {/* Gold/Amber Progress Scrubber */}
                <div className="relative w-full flex items-center group">
                    <input
                        type="range"
                        min="0"
                        max="1439"
                        value={simMinute}
                        onChange={(e) => setSimMinute(Number(e.target.value))}
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#f59e0b] hover:h-2 transition-all"
                        style={{
                            background: `linear-gradient(to right, #f59e0b 0%, #fbbf24 ${(simMinute / 1439) * 100}%, #1e293b ${(simMinute / 1439) * 100}%, #1e293b 100%)`,
                        }}
                    />
                </div>

                {/* Control Ribbon (Matches AlgoTest layout with Bitcoin Accents) */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-300">
                    {/* Left: Brand Badge & Export */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-xs font-black text-amber-400">
                            <span>₿</span>
                            <span>BTC Replay</span>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowImportExportModal(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/80 px-2.5 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            <span>Import/Export</span>
                            <FiChevronDown size={12} />
                        </button>
                    </div>

                    {/* Middle Jump / Stepper Controls */}
                    <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                        <button
                            type="button"
                            onClick={() => jumpDay(-1)}
                            title="Previous Day"
                            className="flex items-center gap-1 rounded-md border border-gray-700/80 bg-gray-800/60 px-2 py-0.5 text-[11px] font-semibold text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            <FiLock size={10} className="text-amber-400" />
                            <span>-1d</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setExactTimePreset("BOD")}
                            title="Beginning of Day (00:00)"
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-2 py-0.5 text-[11px] font-bold text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            BOD
                        </button>

                        <button
                            type="button"
                            onClick={() => jumpTime(-60)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            -1h
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(-30)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            -30m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(-15)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            -15m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(-5)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            -5m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(-1)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            -1m
                        </button>

                        {/* Date Picker Ribbon */}
                        <div className="flex items-center gap-1 mx-1">
                            <input
                                type="date"
                                value={simDate}
                                onChange={(e) => setSimDate(e.target.value)}
                                className="rounded-md border border-amber-500/40 bg-amber-950/30 px-2.5 py-0.5 text-xs font-bold text-amber-200 outline-none cursor-pointer"
                            />
                        </div>

                        {/* Time Picker */}
                        <div className="flex items-center gap-1 font-mono font-bold text-xs bg-gray-800 px-2 py-0.5 rounded-md border border-gray-700 text-amber-300">
                            <span>{timeString}</span>
                            <FiChevronDown size={11} className="text-gray-400" />
                        </div>

                        {/* Forward Jumps */}
                        <button
                            type="button"
                            onClick={() => jumpTime(1)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            +1m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(5)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            +5m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(15)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            +15m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(30)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            +30m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(60)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            +1h
                        </button>
                        <button
                            type="button"
                            onClick={() => setExactTimePreset("EOD")}
                            title="End of Day (23:59)"
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-2 py-0.5 text-[11px] font-bold text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            EOD
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpDay(1)}
                            title="Next Day"
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-2 py-0.5 text-[11px] font-semibold text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            +1d
                        </button>

                        {/* Autoplay Play/Pause */}
                        <div className="flex items-center gap-1 pl-1 border-l border-gray-700">
                            <button
                                type="button"
                                onClick={() => setIsPlaying((p) => !p)}
                                className={`flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-bold text-white transition shadow-xs cursor-pointer ${
                                    isPlaying
                                        ? "bg-rose-600 hover:bg-rose-500"
                                        : "bg-amber-600 hover:bg-amber-500 text-black font-black"
                                }`}
                            >
                                {isPlaying ? <FiPause size={12} /> : <FiPlay size={12} />}
                                <span>{isPlaying ? "Pause" : "Play"}</span>
                            </button>

                            <select
                                value={playSpeed}
                                onChange={(e) => setPlaySpeed(Number(e.target.value))}
                                className="bg-gray-800 border border-gray-700 rounded text-[11px] font-bold text-gray-200 px-1 py-0.5 outline-none cursor-pointer"
                            >
                                <option value="1">1x</option>
                                <option value="2">2x</option>
                                <option value="5">5x</option>
                                <option value="10">10x</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sub-Header Navigation: Option Chain | Positions | Payoff View | Greeks */}
            <div className="bg-[#0a0f1b] border-b border-gray-800 px-4 py-2 flex items-center justify-between gap-4 shrink-0">
                {/* Left Side: View Mode Tabs */}
                <div className="flex items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setActiveViewTab("chain")}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            activeViewTab === "chain"
                                ? "bg-amber-500 text-black shadow-md shadow-amber-500/20 font-black"
                                : "text-gray-400 hover:text-white hover:bg-gray-800/60"
                        }`}
                    >
                        Option Chain
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveViewTab("positions")}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            activeViewTab === "positions"
                                ? "bg-amber-500 text-black shadow-md shadow-amber-500/20 font-black"
                                : "text-gray-400 hover:text-white hover:bg-gray-800/60"
                        }`}
                    >
                        <span>Positions</span>
                        {legs.length > 0 && (
                            <span className="rounded-full bg-emerald-500 text-black px-1.5 py-0.2 text-[10px] font-black">
                                {legs.length}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveViewTab("payoff")}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            activeViewTab === "payoff"
                                ? "bg-amber-500 text-black shadow-md shadow-amber-500/20 font-black"
                                : "text-gray-400 hover:text-white hover:bg-gray-800/60"
                        }`}
                    >
                        Full Payoff Engine
                    </button>
                </div>

                {/* Right Side: Quick Tools Toggles */}
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setActiveSideDrawer((p) => (p === "payoff" ? null : "payoff"))}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                            activeSideDrawer === "payoff"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                        }`}
                    >
                        Side Payoff
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveSideDrawer((p) => (p === "greeks" ? null : "greeks"))}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                            activeSideDrawer === "greeks"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                        }`}
                    >
                        Greeks
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveSideDrawer((p) => (p === "presets" ? null : "presets"))}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                            activeSideDrawer === "presets"
                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                        }`}
                    >
                        ✦ Strategy Presets
                    </button>
                </div>
            </div>

            {/* Spot Price & Perpetual Futures Metric Bar */}
            <div className="bg-[#080d17] border-b border-gray-800/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 shrink-0">
                {/* Left: BTCUSD Spot Price with Gold ₿ Icon */}
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setAssetDropdownOpen((p) => !p)}
                            className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition cursor-pointer"
                        >
                            <span className="text-base font-black text-amber-400">{selectedAsset.icon}</span>
                            <span>{selectedAsset.symbol} (Lot size: {selectedAsset.lotSize})</span>
                            <FiChevronDown size={13} className="text-amber-400" />
                        </button>

                        {assetDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1 w-56 rounded-xl border border-gray-700 bg-[#0f172a] p-1.5 shadow-2xl z-50">
                                {CRYPTO_ASSETS.map((asset) => (
                                    <button
                                        key={asset.symbol}
                                        type="button"
                                        onClick={() => {
                                            setSelectedAsset(asset);
                                            setAssetDropdownOpen(false);
                                            setLegs([]);
                                        }}
                                        className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-gray-200 hover:bg-amber-600 hover:text-black rounded-lg transition"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-amber-400 font-bold">{asset.icon}</span>
                                            <span>{asset.name} ({asset.symbol})</span>
                                        </div>
                                        <span className="text-gray-400 text-[11px]">${asset.basePrice}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Spot Quote */}
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black tracking-tight font-mono text-white">
                            ${formatCryptoPrice(currentSpot, 2)}
                        </span>
                        <span
                            className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                                spotChange.diff >= 0
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                    : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                            }`}
                        >
                            {spotChange.diff >= 0 ? "+" : ""}
                            {spotChange.diff.toFixed(2)} ({spotChange.pct.toFixed(2)}%)
                        </span>
                    </div>
                </div>

                {/* Center: FUT Perpetual */}
                <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">FUT Perpetual:</span>
                    <span className="text-base font-black tracking-tight font-mono text-amber-300">
                        ${formatCryptoPrice(currentPerp, 2)}
                    </span>
                </div>

                {/* Right: Net PnL & Settings */}
                <div className="flex items-center gap-3">
                    {legs.length > 0 && (
                        <div className="flex items-center gap-2 bg-gray-800/90 border border-gray-700 px-3 py-1 rounded-xl text-xs">
                            <span className="text-gray-400">Net Realized / MTM:</span>
                            <span
                                className={`font-mono font-black text-sm ${
                                    portfolioSummary.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"
                                }`}
                            >
                                {portfolioSummary.netPnL >= 0 ? "+" : ""}${formatCryptoPrice(portfolioSummary.netPnL, 2)}
                            </span>
                        </div>
                    )}

                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-300">
                        <input
                            type="checkbox"
                            checked={viewPositionsOnly}
                            onChange={(e) => setViewPositionsOnly(e.target.checked)}
                            className="rounded bg-gray-800 border-gray-700 text-amber-500 focus:ring-0"
                        />
                        <span>View Positions Only</span>
                    </label>

                    <button
                        type="button"
                        onClick={() => setShowSettingsModal(true)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition cursor-pointer"
                        title="Simulator Settings"
                    >
                        <FiSettings size={16} />
                    </button>
                </div>
            </div>

            {/* Expiry Selector Strip */}
            <div className="bg-[#090e1a] border-b border-gray-800 px-4 py-2 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                    <button
                        type="button"
                        onClick={() => {
                            const idx = expiries.findIndex((e) => e.key === selectedExpiryKey);
                            if (idx > 0) setSelectedExpiryKey(expiries[idx - 1].key);
                        }}
                        className="p-1 rounded text-gray-400 hover:bg-gray-800 hover:text-white"
                    >
                        <FiChevronLeft size={14} />
                    </button>

                    {expiries.map((exp) => {
                        const isSelected = exp.key === selectedExpiryKey;
                        const hasLegsInExp = legs.some((l) => l.expiry === exp.iso);

                        return (
                            <button
                                key={exp.key}
                                type="button"
                                onClick={() => setSelectedExpiryKey(exp.key)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                    isSelected
                                        ? "bg-amber-500 text-black shadow-md shadow-amber-500/20 font-black ring-1 ring-amber-300"
                                        : "bg-gray-800/60 text-gray-300 hover:bg-gray-800 hover:text-white border border-gray-700/60"
                                }`}
                            >
                                <span>{exp.label}</span>
                                <span className={`text-[10px] ${isSelected ? "text-black/80 font-bold" : "text-amber-400/80"}`}>
                                    {exp.subLabel}
                                </span>
                                {hasLegsInExp && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
                                )}
                            </button>
                        );
                    })}

                    <button
                        type="button"
                        onClick={() => {
                            const idx = expiries.findIndex((e) => e.key === selectedExpiryKey);
                            if (idx < expiries.length - 1) setSelectedExpiryKey(expiries[idx + 1].key);
                        }}
                        className="p-1 rounded text-gray-400 hover:bg-gray-800 hover:text-white"
                    >
                        <FiChevronRight size={14} />
                    </button>
                </div>

                <div className="text-[11px] text-gray-400 hidden sm:flex items-center gap-2 shrink-0 font-medium">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <span>Realtime Deribit/Binance Pricing Engine</span>
                </div>
            </div>

            {/* Main Content Area: Option Chain Table or Full Payoff Engine */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                {/* Left/Center Main Area */}
                <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">
                    {activeViewTab === "payoff" ? (
                        /* Full Screen Payoff Engine View */
                        <div className="p-6 max-w-6xl mx-auto w-full space-y-6">
                            {/* Key Performance Matrix Cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-4">
                                    <div className="text-[11px] font-bold text-gray-400 uppercase">Max Profit</div>
                                    <div className="text-lg font-black text-emerald-400 font-mono mt-1">
                                        {portfolioSummary.maxProfit > 999999
                                            ? "Unlimited"
                                            : `$${formatCryptoPrice(portfolioSummary.maxProfit, 2)}`}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">At Expiry</div>
                                </div>

                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-4">
                                    <div className="text-[11px] font-bold text-gray-400 uppercase">Max Loss</div>
                                    <div className="text-lg font-black text-rose-400 font-mono mt-1">
                                        {portfolioSummary.maxLoss < -999999
                                            ? "Unlimited"
                                            : `$${formatCryptoPrice(Math.abs(portfolioSummary.maxLoss), 2)}`}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">Capped Risk</div>
                                </div>

                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-4">
                                    <div className="text-[11px] font-bold text-gray-400 uppercase">Probability of Profit</div>
                                    <div className="text-lg font-black text-amber-400 font-mono mt-1">
                                        {portfolioSummary.pop}%
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">Estimated POP</div>
                                </div>

                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-4">
                                    <div className="text-[11px] font-bold text-gray-400 uppercase">Est. Margin Needed</div>
                                    <div className="text-lg font-black text-blue-400 font-mono mt-1">
                                        ${formatCryptoPrice(portfolioSummary.estMargin, 2)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">Collateral</div>
                                </div>
                            </div>

                            {/* Big Interactive Payoff Chart */}
                            <div className="rounded-3xl border border-gray-800 bg-[#0c121e] p-5 space-y-4">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                                            <span>Multi-Leg Payoff Simulation</span>
                                            <span className="text-xs font-normal text-gray-400">
                                                (Green = Expiry P&amp;L, Blue = Target Date MTM)
                                            </span>
                                        </h3>
                                    </div>

                                    {/* Target Simulation Sliders */}
                                    <div className="flex items-center gap-4 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400">Days Ahead:</span>
                                            <input
                                                type="range"
                                                min="0"
                                                max={currentExpiry?.daysLeft || 7}
                                                value={targetDaysAhead}
                                                onChange={(e) => setTargetDaysAhead(Number(e.target.value))}
                                                className="w-24 accent-blue-500"
                                            />
                                            <span className="font-bold font-mono text-blue-400">+{targetDaysAhead}d</span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-400">IV Shock:</span>
                                            <input
                                                type="range"
                                                min="-20"
                                                max="20"
                                                value={ivShockPct}
                                                onChange={(e) => setIvShockPct(Number(e.target.value))}
                                                className="w-24 accent-amber-500"
                                            />
                                            <span className="font-bold font-mono text-amber-400">
                                                {ivShockPct >= 0 ? "+" : ""}{ivShockPct}%
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="h-72 w-full">
                                    {legs.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-xs text-gray-500">
                                            Select Buy/Sell legs from the Option Chain to generate your Bitcoin Payoff Matrix.
                                        </div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={portfolioSummary.curve}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                                                <XAxis
                                                    dataKey="price"
                                                    tickFormatter={(p) => Math.round(p)}
                                                    stroke="#64748b"
                                                    fontSize={11}
                                                />
                                                <YAxis
                                                    stroke="#64748b"
                                                    fontSize={11}
                                                    tickFormatter={(v) => `$${v}`}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: "#0f172a",
                                                        border: "1px solid #334155",
                                                        borderRadius: "10px",
                                                        fontSize: "12px",
                                                    }}
                                                />
                                                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
                                                <ReferenceLine
                                                    x={currentSpot}
                                                    stroke="#f59e0b"
                                                    strokeDasharray="3 3"
                                                    label={{
                                                        value: `Spot $${Math.round(currentSpot)}`,
                                                        position: "top",
                                                        fill: "#f59e0b",
                                                        fontSize: 11,
                                                    }}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="pnl"
                                                    name="Expiry P&L"
                                                    stroke="#10b981"
                                                    strokeWidth={2.5}
                                                    dot={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="targetPnl"
                                                    name="Target Date P&L"
                                                    stroke="#3b82f6"
                                                    strokeWidth={2}
                                                    strokeDasharray="4 4"
                                                    dot={false}
                                                />
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : activeViewTab === "positions" ? (
                        /* Positions Tab */
                        <div className="p-6 max-w-5xl mx-auto w-full space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                    <span>Active Simulated Legs</span>
                                    <span className="rounded-full bg-amber-500 text-black font-black px-2.5 py-0.5 text-xs">
                                        {legs.length}
                                    </span>
                                </h2>
                                {legs.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleClearLegs}
                                        className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 transition"
                                    >
                                        <FiTrash2 size={13} /> Clear All Legs
                                    </button>
                                )}
                            </div>

                            {legs.length === 0 ? (
                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-12 text-center text-gray-400 space-y-3">
                                    <FiLayers size={32} className="mx-auto text-amber-500" />
                                    <div className="text-sm font-bold text-gray-200">No active positions in basket</div>
                                    <p className="text-xs text-gray-500 max-w-md mx-auto">
                                        Switch to the <strong>Option Chain</strong> tab and click the <strong>B (Buy)</strong> or <strong>S (Sell)</strong> buttons on any strike to simulate trades.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setActiveViewTab("chain")}
                                        className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 transition"
                                    >
                                        Open Option Chain
                                    </button>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] overflow-hidden shadow-md">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-[#101726] border-b border-gray-800 text-gray-400 font-bold uppercase text-[10px]">
                                            <tr>
                                                <th className="py-3 px-4">Action</th>
                                                <th className="py-3 px-4">Instrument</th>
                                                <th className="py-3 px-4">Expiry</th>
                                                <th className="py-3 px-4">Strike</th>
                                                <th className="py-3 px-4">Lots</th>
                                                <th className="py-3 px-4">Entry MP</th>
                                                <th className="py-3 px-4">Current MP</th>
                                                <th className="py-3 px-4">P&amp;L ($)</th>
                                                <th className="py-3 px-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-800/60 font-mono">
                                            {legs.map((leg) => {
                                                const row = optionChainRows.find((r) => r.strike === leg.strike);
                                                const livePrice = row
                                                    ? leg.right === "CE"
                                                        ? row.call.price
                                                        : row.put.price
                                                    : leg.entryPrice;
                                                const mult = leg.action === "BUY" ? 1 : -1;
                                                const pnl = (livePrice - leg.entryPrice) * mult * leg.lots;

                                                return (
                                                    <tr key={leg.id} className="hover:bg-gray-800/40 transition">
                                                        <td className="py-3 px-4">
                                                            <span
                                                                className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase ${
                                                                    leg.action === "BUY"
                                                                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                                                        : "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                                                }`}
                                                            >
                                                                {leg.action}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-4 font-bold text-white">
                                                            {leg.symbol}
                                                        </td>
                                                        <td className="py-3 px-4 text-gray-300">
                                                            {leg.expiryLabel || leg.expiry}
                                                        </td>
                                                        <td className="py-3 px-4 font-bold text-white">
                                                            {leg.strike} {leg.right}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleUpdateLots(leg.id, -1)}
                                                                    className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer"
                                                                >
                                                                    <FiMinus size={10} />
                                                                </button>
                                                                <span className="w-8 text-center font-bold">{leg.lots}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleUpdateLots(leg.id, 1)}
                                                                    className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer"
                                                                >
                                                                    <FiPlus size={10} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 text-gray-300">
                                                            ${formatCryptoPrice(leg.entryPrice, 2)}
                                                        </td>
                                                        <td className="py-3 px-4 text-white font-bold">
                                                            ${formatCryptoPrice(livePrice, 2)}
                                                        </td>
                                                        <td className="py-3 px-4 font-black">
                                                            <span
                                                                className={
                                                                    pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                                                }
                                                            >
                                                                {pnl >= 0 ? "+" : ""}${formatCryptoPrice(pnl, 2)}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-4 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRemoveLeg(leg.id)}
                                                                className="text-gray-400 hover:text-rose-400 p-1 cursor-pointer"
                                                                title="Close Leg"
                                                            >
                                                                <FiTrash2 size={13} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Option Chain Matrix with Dual Action BUY ('B') and SELL ('S') Buttons on every row */
                        <div className="flex-1 overflow-x-auto">
                            <table className="w-full text-center border-collapse text-xs font-mono select-none">
                                {/* Table Header */}
                                <thead className="sticky top-0 z-20 bg-[#0f1424] border-b border-gray-800 text-[11px] font-bold text-gray-400 shadow-sm">
                                    <tr>
                                        {/* CALLS SIDE */}
                                        <th className="py-2.5 px-3 text-left w-20">Delta</th>
                                        <th className="py-2.5 px-3 text-right w-28">Call MP</th>
                                        <th className="py-2.5 px-2 text-center w-24">Buy / Sell</th>

                                        {/* CENTER STRIKE & VOLATILITY */}
                                        <th className="py-2.5 px-4 text-center font-extrabold text-amber-300 w-32 bg-[#141b30] border-x border-amber-500/20">
                                            Strike
                                        </th>
                                        <th className="py-2.5 px-3 text-center w-16 bg-[#141b30] border-r border-amber-500/20">
                                            IV
                                        </th>

                                        {/* PUTS SIDE */}
                                        <th className="py-2.5 px-2 text-center w-24">Buy / Sell</th>
                                        <th className="py-2.5 px-3 text-left w-28">Put MP</th>
                                        <th className="py-2.5 px-3 text-right w-20">Delta</th>
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-gray-800/40 text-xs">
                                    {optionChainRows
                                        .filter((r) => !viewPositionsOnly || r.call.leg || r.put.leg)
                                        .map((row) => {
                                            const callLeg = row.call.leg;
                                            const putLeg = row.put.leg;

                                            return (
                                                <tr
                                                    key={row.strike}
                                                    className={`hover:bg-amber-500/5 transition-colors ${
                                                        row.isAtm ? "ring-1 ring-amber-500/40 bg-amber-950/20" : ""
                                                    }`}
                                                >
                                                    {/* CALL DELTA */}
                                                    <td
                                                        className={`py-2 px-3 text-left ${
                                                            callLeg
                                                                ? callLeg.action === "BUY"
                                                                    ? "bg-emerald-900/40 text-emerald-300 font-bold"
                                                                    : "bg-rose-900/40 text-rose-300 font-bold"
                                                                : row.isCallItm
                                                                ? "bg-[#161a24]/80 text-gray-300"
                                                                : "text-gray-400"
                                                        }`}
                                                    >
                                                        {formatDelta(row.call.delta)}
                                                    </td>

                                                    {/* CALL MARKET PRICE */}
                                                    <td
                                                        className={`py-2 px-3 text-right font-bold transition ${
                                                            callLeg
                                                                ? callLeg.action === "BUY"
                                                                    ? "bg-emerald-900/40 text-emerald-300 font-black"
                                                                    : "bg-rose-900/40 text-rose-300 font-black"
                                                                : row.isCallItm
                                                                ? "bg-[#161a24]/80 text-gray-100"
                                                                : "text-gray-200"
                                                        }`}
                                                    >
                                                        ${formatCryptoPrice(row.call.price, 2)}
                                                    </td>

                                                    {/* CALL BUY / SELL BUTTONS */}
                                                    <td
                                                        className={`py-1.5 px-2 text-center ${
                                                            row.isCallItm ? "bg-[#161a24]/80" : ""
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleLeg(row.strike, "CE", "BUY", row.call.price)}
                                                                className={`px-2 py-1 rounded text-[10px] font-black uppercase transition cursor-pointer shadow-xs ${
                                                                    callLeg && callLeg.action === "BUY"
                                                                        ? "bg-emerald-500 text-black ring-2 ring-emerald-300"
                                                                        : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30"
                                                                }`}
                                                                title={`Buy ${row.strike} CE @ $${row.call.price.toFixed(2)}`}
                                                            >
                                                                B
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleLeg(row.strike, "CE", "SELL", row.call.price)}
                                                                className={`px-2 py-1 rounded text-[10px] font-black uppercase transition cursor-pointer shadow-xs ${
                                                                    callLeg && callLeg.action === "SELL"
                                                                        ? "bg-rose-500 text-white ring-2 ring-rose-300"
                                                                        : "bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/30"
                                                                }`}
                                                                title={`Sell ${row.strike} CE @ $${row.call.price.toFixed(2)}`}
                                                            >
                                                                S
                                                            </button>
                                                        </div>
                                                    </td>

                                                    {/* STRIKE PRICE (Center Column with ATM Indicator) */}
                                                    <td
                                                        className={`py-2 px-3 font-extrabold text-sm text-center ${
                                                            row.isAtm
                                                                ? "bg-amber-950/40 text-amber-300 border-x border-amber-500/40 shadow-inner"
                                                                : "bg-[#0f1424] text-white border-x border-gray-800"
                                                        }`}
                                                    >
                                                        <div className="flex flex-col items-center">
                                                            <span>{row.strike}</span>
                                                            {row.isAtm && (
                                                                <span className="text-[9px] font-medium text-amber-400">
                                                                    Synthetic FUT ${syntheticFut}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {/* IV (Implied Volatility) */}
                                                    <td
                                                        className={`py-2 px-3 text-center text-[11px] ${
                                                            callLeg || putLeg
                                                                ? "bg-amber-500/20 text-amber-200 font-bold"
                                                                : "bg-[#0f1424] text-gray-400 border-r border-gray-800"
                                                        }`}
                                                    >
                                                        {formatIV(row.iv)}
                                                    </td>

                                                    {/* PUT BUY / SELL BUTTONS */}
                                                    <td
                                                        className={`py-1.5 px-2 text-center ${
                                                            row.isPutItm ? "bg-[#161a24]/80" : ""
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleLeg(row.strike, "PE", "BUY", row.put.price)}
                                                                className={`px-2 py-1 rounded text-[10px] font-black uppercase transition cursor-pointer shadow-xs ${
                                                                    putLeg && putLeg.action === "BUY"
                                                                        ? "bg-emerald-500 text-black ring-2 ring-emerald-300"
                                                                        : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30"
                                                                }`}
                                                                title={`Buy ${row.strike} PE @ $${row.put.price.toFixed(2)}`}
                                                            >
                                                                B
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleLeg(row.strike, "PE", "SELL", row.put.price)}
                                                                className={`px-2 py-1 rounded text-[10px] font-black uppercase transition cursor-pointer shadow-xs ${
                                                                    putLeg && putLeg.action === "SELL"
                                                                        ? "bg-rose-500 text-white ring-2 ring-rose-300"
                                                                        : "bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/30"
                                                                }`}
                                                                title={`Sell ${row.strike} PE @ $${row.put.price.toFixed(2)}`}
                                                            >
                                                                S
                                                            </button>
                                                        </div>
                                                    </td>

                                                    {/* PUT MARKET PRICE */}
                                                    <td
                                                        className={`py-2 px-3 text-left font-bold transition ${
                                                            putLeg
                                                                ? putLeg.action === "BUY"
                                                                    ? "bg-emerald-900/40 text-emerald-300 font-black"
                                                                    : "bg-rose-900/40 text-rose-300 font-black"
                                                                : row.isPutItm
                                                                ? "bg-[#161a24]/80 text-gray-100"
                                                                : "text-gray-200"
                                                        }`}
                                                    >
                                                        ${formatCryptoPrice(row.put.price, 2)}
                                                    </td>

                                                    {/* PUT DELTA */}
                                                    <td
                                                        className={`py-2 px-3 text-right ${
                                                            putLeg
                                                                ? putLeg.action === "BUY"
                                                                    ? "bg-emerald-900/40 text-emerald-300 font-bold"
                                                                    : "bg-rose-900/40 text-rose-300 font-bold"
                                                                : row.isPutItm
                                                                ? "bg-[#161a24]/80 text-gray-300"
                                                                : "text-gray-400"
                                                        }`}
                                                    >
                                                        {formatDelta(row.put.delta)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Right Side Drawer: Interactive Payoff Chart / Greeks / Presets */}
                {activeSideDrawer && (
                    <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-gray-800 bg-[#0a0f1c] p-4 flex flex-col gap-4 shrink-0 overflow-y-auto custom-scrollbar">
                        {/* Header of Drawer */}
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                {activeSideDrawer === "payoff" && <FiActivity size={14} className="text-amber-400" />}
                                {activeSideDrawer === "greeks" && <FiPieChart size={14} className="text-amber-400" />}
                                {activeSideDrawer === "presets" && <FiZap size={14} className="text-amber-400" />}
                                <span>
                                    {activeSideDrawer === "payoff"
                                        ? "Bitcoin Payoff Matrix"
                                        : activeSideDrawer === "greeks"
                                        ? "Crypto Portfolio Greeks"
                                        : "1-Click Strategy Presets"}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveSideDrawer(null)}
                                className="text-gray-400 hover:text-white p-1 cursor-pointer"
                            >
                                <FiX size={14} />
                            </button>
                        </div>

                        {/* PAYOFF DRAWER */}
                        {activeSideDrawer === "payoff" && (
                            <div className="space-y-4">
                                {/* Summary Metrics Card */}
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">Max Profit</div>
                                        <div className="text-sm font-black text-emerald-400 font-mono mt-0.5">
                                            {portfolioSummary.maxProfit > 999999
                                                ? "Unlimited"
                                                : `$${formatCryptoPrice(portfolioSummary.maxProfit, 2)}`}
                                        </div>
                                    </div>

                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">Max Loss</div>
                                        <div className="text-sm font-black text-rose-400 font-mono mt-0.5">
                                            {portfolioSummary.maxLoss < -999999
                                                ? "Unlimited"
                                                : `$${formatCryptoPrice(Math.abs(portfolioSummary.maxLoss), 2)}`}
                                        </div>
                                    </div>

                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">POP</div>
                                        <div className="text-sm font-black text-amber-400 font-mono mt-0.5">
                                            {portfolioSummary.pop}%
                                        </div>
                                    </div>

                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">Net Debit/Credit</div>
                                        <div className="text-sm font-black text-blue-400 font-mono mt-0.5">
                                            ${formatCryptoPrice(Math.abs(portfolioSummary.netDebit), 2)}
                                        </div>
                                    </div>
                                </div>

                                {/* Payoff Graph */}
                                <div className="rounded-2xl border border-gray-800 bg-[#070b14] p-3">
                                    <div className="flex items-center justify-between text-[11px] font-bold text-gray-400 mb-2">
                                        <span>P&amp;L at Expiry Curve</span>
                                        <span className="text-[10px] text-amber-400">Spot: ${Math.round(currentSpot)}</span>
                                    </div>
                                    <div className="h-48 w-full">
                                        {legs.length === 0 ? (
                                            <div className="h-full flex items-center justify-center text-xs text-gray-500">
                                                Click B or S on the chain to view Payoff
                                            </div>
                                        ) : (
                                            <ResponsiveContainer width="100%" height="100%">
                                                <ComposedChart data={portfolioSummary.curve}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                                                    <XAxis
                                                        dataKey="price"
                                                        tickFormatter={(p) => Math.round(p)}
                                                        stroke="#64748b"
                                                        fontSize={10}
                                                    />
                                                    <YAxis
                                                        stroke="#64748b"
                                                        fontSize={10}
                                                        tickFormatter={(v) => `$${v}`}
                                                    />
                                                    <Tooltip
                                                        contentStyle={{
                                                            backgroundColor: "#0f172a",
                                                            border: "1px solid #334155",
                                                            borderRadius: "8px",
                                                            fontSize: "11px",
                                                        }}
                                                    />
                                                    <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" />
                                                    <ReferenceLine
                                                        x={currentSpot}
                                                        stroke="#f59e0b"
                                                        strokeDasharray="3 3"
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="pnl"
                                                        stroke="#10b981"
                                                        strokeWidth={2}
                                                        dot={false}
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="targetPnl"
                                                        stroke="#3b82f6"
                                                        strokeWidth={1.5}
                                                        strokeDasharray="3 3"
                                                        dot={false}
                                                    />
                                                </ComposedChart>
                                            </ResponsiveContainer>
                                        )}
                                    </div>
                                </div>

                                {/* Breakevens */}
                                {portfolioSummary.breakevens.length > 0 && (
                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-3 text-xs">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase mb-1">
                                            Breakeven Levels
                                        </div>
                                        <div className="flex flex-wrap gap-2 font-mono font-bold text-amber-300">
                                            {portfolioSummary.breakevens.map((be, idx) => (
                                                <span key={idx} className="bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/60">
                                                    ${formatCryptoPrice(be, 2)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* GREEKS DRAWER */}
                        {activeSideDrawer === "greeks" && (
                            <div className="space-y-3">
                                <div className="rounded-xl bg-[#070b14] border border-gray-800 p-3.5 space-y-2.5 text-xs font-mono">
                                    <div className="flex items-center justify-between border-b border-gray-800/80 pb-2">
                                        <span className="text-gray-400 font-sans">Portfolio Delta</span>
                                        <span className="font-bold text-white">
                                            {formatDelta(portfolioSummary.netDelta)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between border-b border-gray-800/80 pb-2">
                                        <span className="text-gray-400 font-sans">Portfolio Theta ($/day)</span>
                                        <span
                                            className={`font-bold ${
                                                portfolioSummary.netTheta >= 0 ? "text-emerald-400" : "text-rose-400"
                                            }`}
                                        >
                                            {portfolioSummary.netTheta >= 0 ? "+" : ""}
                                            ${formatCryptoPrice(portfolioSummary.netTheta, 2)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between border-b border-gray-800/80 pb-2">
                                        <span className="text-gray-400 font-sans">Portfolio Gamma</span>
                                        <span className="font-bold text-white">
                                            {portfolioSummary.netGamma.toFixed(4)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-400 font-sans">Portfolio Vega ($/1% IV)</span>
                                        <span className="font-bold text-white">
                                            ${formatCryptoPrice(portfolioSummary.netVega, 2)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* PRESETS DRAWER */}
                        {activeSideDrawer === "presets" && (
                            <div className="space-y-2 text-xs">
                                <p className="text-gray-400 text-[11px] mb-2">
                                    1-Click deploy standard institutional options strategies on {selectedAsset.symbol}:
                                </p>
                                {[
                                    {
                                        name: "Straddle (ATM Call + ATM Put)",
                                        desc: "Long Volatility Breakout",
                                        action: () => {
                                            const step = selectedAsset.strikeStep;
                                            const atm = Math.round(currentSpot / step) * step;
                                            const row = optionChainRows.find((r) => r.strike === atm);
                                            if (!row || !currentExpiry) return;
                                            setLegs([
                                                {
                                                    id: `leg-ce-${Date.now()}`,
                                                    symbol: selectedAsset.symbol,
                                                    expiry: currentExpiry.iso,
                                                    expiryLabel: currentExpiry.label,
                                                    strike: atm,
                                                    right: "CE",
                                                    action: "BUY",
                                                    lots: 1,
                                                    entryPrice: row.call.price,
                                                    currentPrice: row.call.price,
                                                    iv: 42,
                                                },
                                                {
                                                    id: `leg-pe-${Date.now() + 1}`,
                                                    symbol: selectedAsset.symbol,
                                                    expiry: currentExpiry.iso,
                                                    expiryLabel: currentExpiry.label,
                                                    strike: atm,
                                                    right: "PE",
                                                    action: "BUY",
                                                    lots: 1,
                                                    entryPrice: row.put.price,
                                                    currentPrice: row.put.price,
                                                    iv: 42,
                                                },
                                            ]);
                                        },
                                    },
                                    {
                                        name: "Short Strangle (OTM CE + OTM PE)",
                                        desc: "Theta Decay Harvest",
                                        action: () => {
                                            const step = selectedAsset.strikeStep;
                                            const atm = Math.round(currentSpot / step) * step;
                                            const callStrike = atm + step * 2;
                                            const putStrike = atm - step * 2;
                                            const rCall = optionChainRows.find((r) => r.strike === callStrike);
                                            const rPut = optionChainRows.find((r) => r.strike === putStrike);
                                            if (!rCall || !rPut || !currentExpiry) return;
                                            setLegs([
                                                {
                                                    id: `leg-ce-${Date.now()}`,
                                                    symbol: selectedAsset.symbol,
                                                    expiry: currentExpiry.iso,
                                                    expiryLabel: currentExpiry.label,
                                                    strike: callStrike,
                                                    right: "CE",
                                                    action: "SELL",
                                                    lots: 1,
                                                    entryPrice: rCall.call.price,
                                                    currentPrice: rCall.call.price,
                                                    iv: 42,
                                                },
                                                {
                                                    id: `leg-pe-${Date.now() + 1}`,
                                                    symbol: selectedAsset.symbol,
                                                    expiry: currentExpiry.iso,
                                                    expiryLabel: currentExpiry.label,
                                                    strike: putStrike,
                                                    right: "PE",
                                                    action: "SELL",
                                                    lots: 1,
                                                    entryPrice: rPut.put.price,
                                                    currentPrice: rPut.put.price,
                                                    iv: 42,
                                                },
                                            ]);
                                        },
                                    },
                                    {
                                        name: "Bull Call Spread",
                                        desc: "Directional Uptrend with Capped Risk",
                                        action: () => {
                                            const step = selectedAsset.strikeStep;
                                            const atm = Math.round(currentSpot / step) * step;
                                            const buyStrike = atm;
                                            const sellStrike = atm + step * 2;
                                            const rBuy = optionChainRows.find((r) => r.strike === buyStrike);
                                            const rSell = optionChainRows.find((r) => r.strike === sellStrike);
                                            if (!rBuy || !rSell || !currentExpiry) return;
                                            setLegs([
                                                {
                                                    id: `leg-b-${Date.now()}`,
                                                    symbol: selectedAsset.symbol,
                                                    expiry: currentExpiry.iso,
                                                    expiryLabel: currentExpiry.label,
                                                    strike: buyStrike,
                                                    right: "CE",
                                                    action: "BUY",
                                                    lots: 1,
                                                    entryPrice: rBuy.call.price,
                                                    currentPrice: rBuy.call.price,
                                                    iv: 42,
                                                },
                                                {
                                                    id: `leg-s-${Date.now() + 1}`,
                                                    symbol: selectedAsset.symbol,
                                                    expiry: currentExpiry.iso,
                                                    expiryLabel: currentExpiry.label,
                                                    strike: sellStrike,
                                                    right: "CE",
                                                    action: "SELL",
                                                    lots: 1,
                                                    entryPrice: rSell.call.price,
                                                    currentPrice: rSell.call.price,
                                                    iv: 42,
                                                },
                                            ]);
                                        },
                                    },
                                    {
                                        name: "Iron Condor",
                                        desc: "Range-Bound High POP Strategy",
                                        action: () => {
                                            const step = selectedAsset.strikeStep;
                                            const atm = Math.round(currentSpot / step) * step;
                                            const r1 = optionChainRows.find((r) => r.strike === atm - step * 3);
                                            const r2 = optionChainRows.find((r) => r.strike === atm - step);
                                            const r3 = optionChainRows.find((r) => r.strike === atm + step);
                                            const r4 = optionChainRows.find((r) => r.strike === atm + step * 3);
                                            if (!r1 || !r2 || !r3 || !r4 || !currentExpiry) return;
                                            setLegs([
                                                { id: `leg-1-${Date.now()}`, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, strike: atm - step * 3, right: "PE", action: "BUY", lots: 1, entryPrice: r1.put.price, currentPrice: r1.put.price, iv: 42 },
                                                { id: `leg-2-${Date.now() + 1}`, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, strike: atm - step, right: "PE", action: "SELL", lots: 1, entryPrice: r2.put.price, currentPrice: r2.put.price, iv: 42 },
                                                { id: `leg-3-${Date.now() + 2}`, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, strike: atm + step, right: "CE", action: "SELL", lots: 1, entryPrice: r3.call.price, currentPrice: r3.call.price, iv: 42 },
                                                { id: `leg-4-${Date.now() + 3}`, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, strike: atm + step * 3, right: "CE", action: "BUY", lots: 1, entryPrice: r4.call.price, currentPrice: r4.call.price, iv: 42 },
                                            ]);
                                        },
                                    },
                                ].map((preset, idx) => (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={preset.action}
                                        className="w-full text-left rounded-xl border border-gray-800 bg-[#070b14] p-3 hover:border-amber-500/50 hover:bg-amber-950/20 transition cursor-pointer"
                                    >
                                        <div className="font-bold text-white">{preset.name}</div>
                                        <div className="text-[10px] text-gray-400 mt-0.5">{preset.desc}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Import / Export Modal */}
            {showImportExportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                    <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#0f172a] p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <FiShare2 size={16} className="text-amber-400" />
                                <span>Export / Import Bitcoin Strategy</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowImportExportModal(false)}
                                className="text-gray-400 hover:text-white cursor-pointer"
                            >
                                <FiX size={16} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-400">
                            Share your {selectedAsset.symbol} options backtest position with other traders or save it to your local disk.
                        </p>
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() => {
                                    const json = JSON.stringify(legs, null, 2);
                                    navigator.clipboard.writeText(json);
                                    alert("Strategy JSON copied to clipboard!");
                                    setShowImportExportModal(false);
                                }}
                                className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-black hover:bg-amber-400 transition cursor-pointer"
                            >
                                <FiDownload size={14} /> Copy Strategy JSON
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Settings Modal */}
            {showSettingsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                    <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#0f172a] p-5 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <FiSettings size={16} className="text-amber-400" />
                                <span>Option Chain &amp; Engine Settings</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowSettingsModal(false)}
                                className="text-gray-400 hover:text-white cursor-pointer"
                            >
                                <FiX size={16} />
                            </button>
                        </div>

                        <div className="space-y-3 text-xs">
                            <div>
                                <label className="block text-gray-400 font-bold mb-1">
                                    Strikes Visible (Above &amp; Below ATM)
                                </label>
                                <select
                                    value={strikeRangeCount}
                                    onChange={(e) => setStrikeRangeCount(Number(e.target.value))}
                                    className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white outline-none"
                                >
                                    <option value="8">8 Strikes (Compact)</option>
                                    <option value="14">14 Strikes (Standard)</option>
                                    <option value="20">20 Strikes (Deep OTM)</option>
                                    <option value="30">30 Strikes (Full Spectrum)</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-gray-400 font-bold mb-1">
                                    Primary Crypto Underlying
                                </label>
                                <select
                                    value={selectedAsset.symbol}
                                    onChange={(e) => {
                                        const found = CRYPTO_ASSETS.find((a) => a.symbol === e.target.value);
                                        if (found) {
                                            setSelectedAsset(found);
                                            setLegs([]);
                                        }
                                    }}
                                    className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white outline-none"
                                >
                                    {CRYPTO_ASSETS.map((a) => (
                                        <option key={a.symbol} value={a.symbol}>
                                            {a.name} ({a.symbol})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button
                                type="button"
                                onClick={() => setShowSettingsModal(false)}
                                className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 cursor-pointer"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
