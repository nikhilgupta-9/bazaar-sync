import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
// pages/CryptoSimulator.jsx — Premier Crypto Options Simulator & Replay Station
// Dedicated 3 Crypto Assets: BTC (Bitcoin), ETH (Ethereum), and SOL (Solana)
// UI perfectly aligned with CryptoStrategyBuilder:
// - Header with Δ Icon, Coin Switcher (BTC, ETH, SOL), Expiry Carousel, Real-time USD/INR FX Toggle
// - Replay Timeline Ribbon with Historical Presets (2024 to 2026), Time Scrubbing & Autoplay
// - Collapsible Multi-Leg Strategy Builder Tray with % Stop Loss badge on BUY legs
// - Interactive Payoff Engine (Expiry Curve, Target Date MTM Curve, IV Shock, Greeks)
// - High-Contrast Option Chain Matrix with ATM Always Highlighted & Centered
// - Bottom Tabs: Positions, Stop Orders, Trade History with Guest & Free Tier PRO Gate

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
    FiArrowRight,
    FiAward,
    FiTarget,
    FiCheckCircle,
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

// Crypto Asset Definitions (STRICTLY only BTC, ETH, and SOL)
const CRYPTO_COINS = [
    {
        symbol: "BTC",
        name: "Bitcoin",
        pair: "BTCUSD",
        lotSize: 1,
        strikeStep: 200,
        basePrice: 83322.3,
        perpBasis: -42.3,
        icon: "₿",
        color: "text-amber-400",
        badge: "BTC 24/7",
    },
    {
        symbol: "ETH",
        name: "Ethereum",
        pair: "ETHUSD",
        lotSize: 1,
        strikeStep: 25,
        basePrice: 3485.4,
        perpBasis: -2.1,
        icon: "Ξ",
        color: "text-blue-400",
        badge: "ETH 24/7",
    },
    {
        symbol: "SOL",
        name: "Solana",
        pair: "SOLUSD",
        lotSize: 10,
        strikeStep: 2,
        basePrice: 154.8,
        perpBasis: 0.25,
        icon: "◎",
        color: "text-purple-400",
        badge: "SOL 24/7",
    },
];

// Historical Presets for BTC, ETH, SOL Replay (2024 to 2026)
const HISTORICAL_DATE_PRESETS = [
    { label: "2024 Bull Run", date: "2024-03-14", badge: "2024" },
    { label: "2024 Election Rally", date: "2024-11-06", badge: "2024" },
    { label: "2025 Supercycle", date: "2025-01-20", badge: "2025" },
    { label: "2025 Consolidation", date: "2025-06-15", badge: "2025" },
    { label: "2026 Q1 Cycle", date: "2026-03-10", badge: "2026" },
    { label: "2026 Live Market", date: "2026-10-11", badge: "2026" },
];

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

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

export default function CryptoSimulator() {
    const { isPro, user, token, logout } = useAuth();
    const isAuthenticated = Boolean(user || token);
    const navigate = useNavigate();

    // Option Chain container & ATM strike row refs for auto-centering
    const chainTableContainerRef = useRef(null);
    const atmRowRef = useRef(null);

    // Selected Crypto Asset (STRICTLY BTC, ETH, SOL)
    const [selectedCoin, setSelectedCoin] = useState(CRYPTO_COINS[0].symbol);
    const currentAsset = useMemo(() => {
        return CRYPTO_COINS.find((c) => c.symbol === selectedCoin) || CRYPTO_COINS[0];
    }, [selectedCoin]);

    // View Mode (Option Chain vs Chart vs Payoff Engine)
    const [viewMode, setViewMode] = useState("option_chain"); // "option_chain" | "payoff" | "chart"
    const [isStrategyTrayOpen, setIsStrategyTrayOpen] = useState(true);

    // Currency Converter State: USD ($) vs INR (₹)
    const [currency, setCurrency] = useState("USD"); // "USD" | "INR"
    const [usdtInrRate, setUsdtInrRate] = useState(96.80);
    const [fxLoading, setFxLoading] = useState(false);

    // Fetch Real-time USD/USDT to INR Rate
    const fetchInrRate = useCallback(async () => {
        try {
            setFxLoading(true);
            const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr");
            if (res.ok) {
                const data = await res.json();
                if (data?.tether?.inr && data.tether.inr > 50) {
                    setUsdtInrRate(data.tether.inr);
                    return;
                }
            }
        } catch (e) {
            console.warn("CoinGecko USDT/INR fetch error:", e.message);
        }

        try {
            const res2 = await fetch("https://open.er-api.com/v6/latest/USD");
            if (res2.ok) {
                const data2 = await res2.json();
                if (data2?.rates?.INR && data2.rates.INR > 50) {
                    setUsdtInrRate(data2.rates.INR);
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
        const fxTimer = setInterval(fetchInrRate, 60000);
        return () => clearInterval(fxTimer);
    }, [fetchInrRate]);

    // Format money dynamically based on currency toggle
    const formatMoney = useCallback((amountUsd, decimals = 2) => {
        if (amountUsd == null || isNaN(amountUsd)) return currency === "INR" ? "₹0.00" : "$0.00";
        if (currency === "INR") {
            const inrVal = Number(amountUsd) * usdtInrRate;
            return `₹${Number(inrVal).toLocaleString("en-IN", {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            })}`;
        }
        return `$${Number(amountUsd).toLocaleString("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        })}`;
    }, [currency, usdtInrRate]);

    // Simulation Date & Time (in minutes from 00:00 to 1439)
    const [simDate, setSimDate] = useState("2026-10-11"); // Historical session date
    const [simMinute, setSimMinute] = useState(556); // 09:16 default
    const [isPlaying, setIsPlaying] = useState(false);
    const [playSpeed, setPlaySpeed] = useState(1); // 1x, 2x, 5x, 10x

    // PRO Membership Gate Modal State
    const [showProModal, setShowProModal] = useState(false);
    const [authBannerDismissed, setAuthBannerDismissed] = useState(false);

    // Stop Loss & Take Profit Engine State (Specifically for BUY legs)
    const [isSlModalOpen, setIsSlModalOpen] = useState(false);
    const [activeBuyLegForSl, setActiveBuyLegForSl] = useState(null);
    const [legSlPctInput, setLegSlPctInput] = useState(25);
    const [legTpPctInput, setLegTpPctInput] = useState(50);
    const [legSlEnabled, setLegSlEnabled] = useState(true);
    const [legTpEnabled, setLegTpEnabled] = useState(true);

    // Bottom Navigation Tab: 'positions' | 'stop_orders' | 'history'
    const [bottomTab, setBottomTab] = useState("positions");
    const [mobileTab, setMobileTab] = useState("chain"); // "chain" | "tray" | "payoff" | "positions"
    const [activeSideDrawer, setActiveSideDrawer] = useState("payoff"); // 'payoff' | 'greeks' | 'presets' | null
    const [viewPositionsOnly, setViewPositionsOnly] = useState(false);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [showImportExportModal, setShowImportExportModal] = useState(false);
    const [strikeRangeCount, setStrikeRangeCount] = useState(14); // 14 strikes above & below ATM

    // Target Time Simulation (Target Date for MTM curve)
    const [targetDaysAhead, setTargetDaysAhead] = useState(0);
    const [ivShockPct, setIvShockPct] = useState(0); // -20% to +20% IV shock

    // Active Strategy Legs (Basket)
    const [legs, setLegs] = useState([]);

    // -------------------------------------------------------------
    // MEMBERSHIP & LOGIN GUARD FUNCTION
    // "bina membership ke historical testing na kar paye"
    // -------------------------------------------------------------
    const checkAccessOrPrompt = useCallback(() => {
        if (!isAuthenticated) {
            navigate("/login?redirect=/simulator/crypto");
            return false;
        }
        if (!isPro) {
            setShowProModal(true);
            return false;
        }
        return true;
    }, [isAuthenticated, isPro, navigate]);

    // -------------------------------------------------------------
    // HISTORICAL DATA ENGINE FOR BTC, ETH, AND SOL (2024 to 2026)
    // -------------------------------------------------------------
    const getHistoricalBasePrice = useCallback((assetSymbol, dateStr) => {
        const date = new Date(dateStr);
        const year = date.getFullYear();
        const dayOfYear = Math.floor((date - new Date(year, 0, 0)) / 86400000);

        if (assetSymbol === "BTC" || assetSymbol === "BTCUSD") {
            if (year <= 2024) {
                return 42500 + (dayOfYear / 365) * 51500 + Math.sin(dayOfYear * 0.1) * 3200;
            } else if (year === 2025) {
                return 92000 + Math.sin(dayOfYear * 0.05) * 8000 + (dayOfYear / 365) * 12000;
            } else {
                return 83322.3 + Math.sin(dayOfYear * 0.08) * 4500;
            }
        } else if (assetSymbol === "ETH" || assetSymbol === "ETHUSD") {
            if (year <= 2024) {
                return 2300 + (dayOfYear / 365) * 1400 + Math.sin(dayOfYear * 0.1) * 200;
            } else if (year === 2025) {
                return 3300 + Math.sin(dayOfYear * 0.05) * 350 + (dayOfYear / 365) * 400;
            } else {
                return 3485.4 + Math.sin(dayOfYear * 0.08) * 150;
            }
        } else if (assetSymbol === "SOL" || assetSymbol === "SOLUSD") {
            if (year <= 2024) {
                return 95 + (dayOfYear / 365) * 120 + Math.sin(dayOfYear * 0.1) * 15;
            } else if (year === 2025) {
                return 180 + Math.sin(dayOfYear * 0.05) * 30 + (dayOfYear / 365) * 25;
            } else {
                return 154.8 + Math.sin(dayOfYear * 0.08) * 12;
            }
        }
        return 83322.3;
    }, []);

    const historicalBasePrice = useMemo(() => {
        return Math.round(getHistoricalBasePrice(currentAsset.symbol, simDate) * 100) / 100;
    }, [currentAsset.symbol, simDate, getHistoricalBasePrice]);

    // Simulated Spot Price with realistic intra-day tick volatility
    const currentSpot = useMemo(() => {
        const timeFactor = Math.sin((simMinute / 1440) * Math.PI * 4) * 0.008;
        const noise = Math.sin(simMinute * 17.3) * 0.002;
        const drift = ((simMinute - 556) / 1440) * 0.005;
        const price = historicalBasePrice * (1 + timeFactor + noise + drift);
        return Math.round(price * 100) / 100;
    }, [historicalBasePrice, simMinute]);

    const currentPerp = useMemo(() => {
        return Math.round((currentSpot + currentAsset.perpBasis) * 100) / 100;
    }, [currentSpot, currentAsset.perpBasis]);

    const spotChange = useMemo(() => {
        const diff = currentSpot - historicalBasePrice;
        const pct = (diff / historicalBasePrice) * 100;
        return { diff, pct };
    }, [currentSpot, historicalBasePrice]);

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

    // Generate Option Chain Matrix
    const optionChainRows = useMemo(() => {
        if (!currentExpiry) return [];

        const step = currentAsset.strikeStep;
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
    }, [currentExpiry, currentAsset.strikeStep, currentSpot, strikeRangeCount, simMinute, ivShockPct, legs]);

    // ATM Centering Effect: Automatically scroll ATM strike row to center view
    useEffect(() => {
        if (atmRowRef.current && chainTableContainerRef.current) {
            const timer = setTimeout(() => {
                atmRowRef.current?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                });
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [currentSpot, selectedExpiryKey, currentAsset.symbol]);

    // Add or modify a leg with BUY or SELL action
    // "strategy contract me percentage sale pr nhi only buy pr lagta he"
    const handleToggleLeg = useCallback((strike, right, action, price) => {
        if (!checkAccessOrPrompt()) return;
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
                        // Percentage SL only for BUY legs
                        slPct: action === "BUY" ? 25 : null,
                        tpPct: action === "BUY" ? 50 : null,
                    };
                    return updated;
                }
            } else {
                // Add new leg
                const newLeg = {
                    id: `${currentAsset.symbol}-${expiry}-${strike}-${right}-${Date.now()}`,
                    symbol: currentAsset.symbol,
                    expiry,
                    expiryLabel: currentExpiry.label,
                    strike,
                    right,
                    action,
                    lots: currentAsset.lotSize,
                    entryPrice: price,
                    currentPrice: price,
                    iv: 42,
                    // Percentage SL only for BUY legs
                    slPct: action === "BUY" ? 25 : null,
                    tpPct: action === "BUY" ? 50 : null,
                };
                return [...prev, newLeg];
            }
        });
    }, [checkAccessOrPrompt, currentExpiry, currentAsset]);

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

    // Quick Time Jumps (Protected by checkAccessOrPrompt)
    const jumpTime = useCallback((offsetMins) => {
        if (!checkAccessOrPrompt()) return;
        setSimMinute((prev) => Math.max(0, Math.min(1439, prev + offsetMins)));
    }, [checkAccessOrPrompt]);

    const setExactTimePreset = useCallback((preset) => {
        if (!checkAccessOrPrompt()) return;
        if (preset === "BOD") setSimMinute(0); // 00:00
        else if (preset === "EOD") setSimMinute(1439); // 23:59
        else if (preset === "09:16") setSimMinute(556);
        else if (preset === "15:30") setSimMinute(930);
    }, [checkAccessOrPrompt]);

    const jumpDay = useCallback((dayDelta) => {
        if (!checkAccessOrPrompt()) return;
        setSimDate((prev) => {
            const d = new Date(prev);
            d.setDate(d.getDate() + dayDelta);
            return d.toISOString().split("T")[0];
        });
    }, [checkAccessOrPrompt]);

    const handleDateChange = useCallback((newDate) => {
        if (!checkAccessOrPrompt()) return;
        setSimDate(newDate);
    }, [checkAccessOrPrompt]);

    const handlePlayToggle = useCallback(() => {
        if (!checkAccessOrPrompt()) return;
        setIsPlaying((p) => !p);
    }, [checkAccessOrPrompt]);

    // Save Stop Loss Dialog configuration for BUY Leg
    const handleSaveLegSl = useCallback(() => {
        if (!activeBuyLegForSl) return;
        setLegs((prev) =>
            prev.map((l) =>
                l.id === activeBuyLegForSl.id
                    ? {
                          ...l,
                          slPct: legSlEnabled ? legSlPctInput : null,
                          tpPct: legTpEnabled ? legTpPctInput : null,
                      }
                    : l
            )
        );
        setIsSlModalOpen(false);
        setActiveBuyLegForSl(null);
    }, [activeBuyLegForSl, legSlEnabled, legSlPctInput, legTpEnabled, legTpPctInput]);

    // Open Stop Loss Modal for a specific BUY Leg
    const handleOpenSlModalForLeg = useCallback((leg) => {
        if (leg.action !== "BUY") return;
        setActiveBuyLegForSl(leg);
        setLegSlPctInput(leg.slPct ?? 25);
        setLegTpPctInput(leg.tpPct ?? 50);
        setLegSlEnabled(leg.slPct != null);
        setLegTpEnabled(leg.tpPct != null);
        setIsSlModalOpen(true);
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
            const dLow = Math.log(currentSpot / beLow) / (0.42 * Math.sqrt(0.1));
            const dHigh = Math.log(currentSpot / beHigh) / (0.42 * Math.sqrt(0.1));
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
        <div className="min-h-screen bg-[#0b0e14] text-gray-200 font-sans selection:bg-purple-600/40">
            {/* ------------------------------------------------------------- */}
            {/* 1. TOP HEADER & TOOLBAR (EXACTLY LIKE STRATEGY BUILDER)       */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-[#0e121b] border-b border-[#1f2433] px-3 lg:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
                {/* Left: Page Title, View Mode & Coin Switcher */}
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 pr-2 border-r border-[#1f2535]">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-600 via-indigo-600 to-emerald-400 flex items-center justify-center shadow-md shadow-purple-900/40">
                            <span className="text-white font-black text-sm">Δ</span>
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5">
                                <h1 className="font-extrabold text-sm lg:text-base text-white tracking-tight">
                                    Crypto Options Simulator
                                </h1>
                                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-bold uppercase tracking-wider animate-pulse">
                                    2024–2026 Replay
                                </span>
                            </div>
                            <div className="text-[10px] text-gray-400 font-medium hidden sm:block">
                                Historical Backtesting &amp; Strategy Engine • Strictly BTC, ETH &amp; SOL
                            </div>
                        </div>
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex rounded-lg bg-[#151926] p-0.5 border border-[#252b3d]">
                        <button
                            type="button"
                            onClick={() => setViewMode("option_chain")}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                viewMode === "option_chain"
                                    ? "bg-purple-600 text-white shadow"
                                    : "text-gray-400 hover:text-gray-200"
                            }`}
                        >
                            Option Chain
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("payoff")}
                            className={`px-3 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                viewMode === "payoff"
                                    ? "bg-purple-600 text-white shadow"
                                    : "text-gray-400 hover:text-gray-200"
                            }`}
                        >
                            Payoff Chart
                        </button>
                    </div>

                    {/* Crypto Coin Selector Pills (STRICTLY BTC, ETH, SOL) */}
                    <div className="flex items-center gap-1.5">
                        {CRYPTO_COINS.map((coin) => (
                            <button
                                key={coin.symbol}
                                type="button"
                                onClick={() => {
                                    setSelectedCoin(coin.symbol);
                                    setLegs([]);
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                                    selectedCoin === coin.symbol
                                        ? "bg-purple-500/20 text-purple-300 border-purple-500 shadow-sm ring-1 ring-purple-500/30 font-extrabold"
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

                {/* Middle: Expiry Date Carousel */}
                <div className="flex items-center gap-1 overflow-x-auto py-1 custom-scrollbar max-w-full lg:max-w-md">
                    <button
                        type="button"
                        onClick={() => {
                            const idx = expiries.findIndex((e) => e.key === selectedExpiryKey);
                            if (idx > 0) setSelectedExpiryKey(expiries[idx - 1].key);
                        }}
                        className="p-1.5 rounded bg-[#151926] hover:bg-[#1e2336] text-gray-400 cursor-pointer"
                        title="Previous Expiry"
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
                                className={`shrink-0 px-3 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1 ${
                                    isSelected
                                        ? "bg-[#251d3b] text-purple-300 border-purple-500 font-bold ring-1 ring-purple-500/50"
                                        : "bg-[#151926] text-gray-400 border-[#252b3d] hover:text-gray-200"
                                }`}
                            >
                                <span>{exp.label}</span>
                                <span className="text-[10px] text-gray-400 font-mono">{exp.subLabel}</span>
                                {hasLegsInExp && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                            </button>
                        );
                    })}

                    <button
                        type="button"
                        onClick={() => {
                            const idx = expiries.findIndex((e) => e.key === selectedExpiryKey);
                            if (idx < expiries.length - 1) setSelectedExpiryKey(expiries[idx + 1].key);
                        }}
                        className="p-1.5 rounded bg-[#151926] hover:bg-[#1e2336] text-gray-400 cursor-pointer"
                        title="Next Expiry"
                    >
                        <FiChevronRight size={14} />
                    </button>
                </div>

                {/* Right: Currency Converter & Auth Buttons */}
                <div className="flex items-center gap-3">
                    {/* Currency Toggle */}
                    <div className="flex items-center bg-[#151926] border border-[#252b3d] rounded-xl p-0.5 shadow-xs">
                        <button
                            type="button"
                            onClick={() => setCurrency("USD")}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                currency === "USD"
                                    ? "bg-purple-600 text-white shadow-xs font-black"
                                    : "text-gray-400 hover:text-white"
                            }`}
                        >
                            $ USD
                        </button>
                        <button
                            type="button"
                            onClick={() => setCurrency("INR")}
                            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                                currency === "INR"
                                    ? "bg-emerald-600 text-white shadow-xs font-black"
                                    : "text-gray-400 hover:text-white"
                            }`}
                        >
                            <span>₹ INR</span>
                            <span className="text-[10px] opacity-80 font-mono">
                                (₹{usdtInrRate.toFixed(1)})
                            </span>
                        </button>
                    </div>

                    {/* Auth Section with Website Emerald Theme */}
                    {isAuthenticated ? (
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 bg-[#121929] border border-gray-800 px-2.5 py-1 rounded-xl text-xs">
                                <div className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-[10px]">
                                    {user?.name ? user.name[0].toUpperCase() : "U"}
                                </div>
                                <span className="font-semibold text-gray-200 max-w-[90px] truncate hidden sm:inline">
                                    {user?.name || "Member"}
                                </span>
                                <span
                                    className={`rounded px-1.5 py-0.2 text-[9px] font-black uppercase ${
                                        isPro
                                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                            : "bg-gray-700 text-gray-300"
                                    }`}
                                >
                                    {isPro ? "PRO" : "FREE"}
                                </span>
                            </div>

                            {!isPro && (
                                <button
                                    type="button"
                                    onClick={() => setShowProModal(true)}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-xl text-xs shadow-md transition flex items-center gap-1 cursor-pointer"
                                >
                                    <FiZap size={12} />
                                    <span>Upgrade PRO</span>
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={logout}
                                className="text-gray-400 hover:text-rose-400 p-1 text-xs transition cursor-pointer"
                                title="Log Out"
                            >
                                <FiX size={16} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Link
                                to="/register?redirect=/simulator/crypto"
                                className="border border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-600 hover:text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition shadow-xs"
                            >
                                Sign Up
                            </Link>
                            <Link
                                to="/login?redirect=/simulator/crypto"
                                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3.5 py-1.5 rounded-lg text-xs transition shadow-xs"
                            >
                                Log In
                            </Link>
                        </div>
                    )}
                </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 2. REPLAY TIMELINE & CONTROLS RIBBON                         */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-[#0b101c] border-b border-amber-500/20 px-4 py-2 flex flex-col gap-1.5 shrink-0 shadow-md">
                {/* Time Scrubber Slider */}
                <div className="relative w-full flex items-center group">
                    <input
                        type="range"
                        min="0"
                        max="1439"
                        value={simMinute}
                        onChange={(e) => {
                            if (!checkAccessOrPrompt()) return;
                            setSimMinute(Number(e.target.value));
                        }}
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-[#f59e0b] hover:h-2 transition-all"
                        style={{
                            background: `linear-gradient(to right, #f59e0b 0%, #fbbf24 ${(simMinute / 1439) * 100}%, #1e293b ${(simMinute / 1439) * 100}%, #1e293b 100%)`,
                        }}
                    />
                </div>

                {/* Control Ribbon */}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-300">
                    {/* Left: Replay Badge & Historical Presets */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-xs font-black text-amber-400">
                            <span>{currentAsset.icon}</span>
                            <span>{currentAsset.symbol} 24/7 Simulator</span>
                        </div>

                        {/* Historical Year/Date Presets */}
                        <div className="flex items-center gap-1 bg-[#101726] border border-gray-800 rounded-xl p-0.5">
                            {HISTORICAL_DATE_PRESETS.map((p) => {
                                const isCurrent = simDate === p.date;
                                return (
                                    <button
                                        key={p.date}
                                        type="button"
                                        onClick={() => handleDateChange(p.date)}
                                        className={`px-2 py-0.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                            isCurrent
                                                ? "bg-amber-500/20 text-amber-300 border border-amber-500/50"
                                                : "text-gray-400 hover:text-gray-200"
                                        }`}
                                        title={p.label}
                                    >
                                        <span>{p.badge}</span>
                                    </button>
                                );
                            })}
                        </div>
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
                            onClick={() => jumpTime(-15)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            -15m
                        </button>
                        <button
                            type="button"
                            onClick={() => jumpTime(-1)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            -1m
                        </button>

                        {/* Date Picker */}
                        <div className="flex items-center gap-1 mx-1">
                            <input
                                type="date"
                                min="2024-01-01"
                                max="2026-12-31"
                                value={simDate}
                                onChange={(e) => handleDateChange(e.target.value)}
                                className="rounded-md border border-amber-500/40 bg-amber-950/30 px-2.5 py-0.5 text-xs font-bold text-amber-200 outline-none cursor-pointer"
                            />
                        </div>

                        {/* Time Picker Display */}
                        <div className="flex items-center gap-1 font-mono font-bold text-xs bg-gray-800 px-2 py-0.5 rounded-md border border-gray-700 text-amber-300">
                            <span>{timeString}</span>
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
                            onClick={() => jumpTime(15)}
                            className="rounded-md border border-gray-700/80 bg-gray-800/60 px-1.5 py-0.5 text-[11px] font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                        >
                            +15m
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
                                onClick={handlePlayToggle}
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

            {/* ------------------------------------------------------------- */}
            {/* 3. SPOT PRICE & PERPETUAL QUOTE RIBBON                       */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-[#080d17] border-b border-gray-800/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 shrink-0">
                {/* Spot Quote */}
                <div className="flex items-center gap-4">
                    <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black tracking-tight font-mono text-white">
                            {formatMoney(currentSpot, 2)}
                        </span>
                        <span
                            className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                                spotChange.diff >= 0
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                    : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                            }`}
                        >
                            {spotChange.diff >= 0 ? "+" : ""}
                            {formatMoney(spotChange.diff, 2)} ({spotChange.pct.toFixed(2)}%)
                        </span>
                    </div>

                    <div className="h-4 w-px bg-gray-800 hidden sm:block" />

                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 font-bold uppercase">FUT Perp:</span>
                        <span className="font-mono font-black text-amber-300">
                            {formatMoney(currentPerp, 2)}
                        </span>
                    </div>
                </div>

                {/* Right: Net Realized / MTM & Tray Toggle */}
                <div className="flex items-center gap-3">
                    {legs.length > 0 && (
                        <div className="flex items-center gap-2 bg-[#121929] border border-gray-700 px-3 py-1 rounded-xl text-xs">
                            <span className="text-gray-400 font-semibold">Net MTM P&amp;L:</span>
                            <span
                                className={`font-mono font-black text-sm ${
                                    portfolioSummary.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"
                                }`}
                            >
                                {portfolioSummary.netPnL >= 0 ? "+" : ""}
                                {formatMoney(portfolioSummary.netPnL, 2)}
                            </span>
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={() => setIsStrategyTrayOpen((p) => !p)}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#151926] border border-[#252b3d] text-xs font-bold text-gray-300 hover:text-white transition cursor-pointer"
                    >
                        <FiLayers size={13} className="text-purple-400" />
                        <span>Strategy Tray ({legs.length})</span>
                        <FiChevronDown size={13} className={`transition-transform ${isStrategyTrayOpen ? "rotate-180" : ""}`} />
                    </button>
                </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 4. COLLAPSIBLE STRATEGY BUILDER TRAY                         */}
            {/* ------------------------------------------------------------- */}
            {isStrategyTrayOpen && (
                <div className="bg-[#0e121d] border-b border-[#1e2538] px-4 py-3 space-y-3 transition-all animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                                <span>Simulated Strategy Legs Basket</span>
                            </h2>
                            <span className="px-2 py-0.2 rounded-full bg-purple-500/20 text-purple-300 font-mono text-[10px] font-bold">
                                {legs.length} Active {legs.length === 1 ? "Leg" : "Legs"}
                            </span>
                        </div>

                        {legs.length > 0 && (
                            <button
                                type="button"
                                onClick={handleClearLegs}
                                className="inline-flex items-center gap-1 text-xs font-bold text-rose-400 hover:text-rose-300 transition cursor-pointer"
                            >
                                <FiTrash2 size={12} /> Clear Basket
                            </button>
                        )}
                    </div>

                    {legs.length === 0 ? (
                        <div className="p-4 rounded-xl border border-dashed border-gray-800 text-center text-xs text-gray-500">
                            No strategy legs selected yet. Click the <strong>B (Buy)</strong> or <strong>S (Sell)</strong> buttons on any strike in the Option Chain below to construct your strategy.
                        </div>
                    ) : (
                        <div className="overflow-x-auto custom-scrollbar rounded-xl border border-[#1f2638] bg-[#090d16]">
                            <table className="w-full text-left text-xs font-mono">
                                <thead className="bg-[#101626] border-b border-[#1f2638] text-[10px] font-bold text-gray-400 uppercase">
                                    <tr>
                                        <th className="py-2 px-3">Action</th>
                                        <th className="py-2 px-3">Contract</th>
                                        <th className="py-2 px-3">Expiry</th>
                                        <th className="py-2 px-3">Lots</th>
                                        <th className="py-2 px-3">Entry MP</th>
                                        <th className="py-2 px-3">Live MP</th>
                                        <th className="py-2 px-3">% Stop Loss (Buy Only)</th>
                                        <th className="py-2 px-3">P&amp;L</th>
                                        <th className="py-2 px-3 text-right">Remove</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#182033]">
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
                                            <tr key={leg.id} className="hover:bg-purple-950/10 transition">
                                                <td className="py-2 px-3">
                                                    <span
                                                        className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                            leg.action === "BUY"
                                                                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                                                : "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                                        }`}
                                                    >
                                                        {leg.action}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-3 font-bold text-white">
                                                    {leg.symbol} {leg.strike} {leg.right}
                                                </td>
                                                <td className="py-2 px-3 text-gray-300">
                                                    {leg.expiryLabel || leg.expiry}
                                                </td>
                                                <td className="py-2 px-3">
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateLots(leg.id, -1)}
                                                            className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer"
                                                        >
                                                            <FiMinus size={10} />
                                                        </button>
                                                        <span className="w-7 text-center font-bold">{leg.lots}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleUpdateLots(leg.id, 1)}
                                                            className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer"
                                                        >
                                                            <FiPlus size={10} />
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="py-2 px-3 text-gray-300">
                                                    {formatMoney(leg.entryPrice, 2)}
                                                </td>
                                                <td className="py-2 px-3 text-white font-bold">
                                                    {formatMoney(livePrice, 2)}
                                                </td>

                                                {/* Percentage Stop Loss on BUY Legs Only */}
                                                <td className="py-2 px-3">
                                                    {leg.action === "BUY" ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenSlModalForLeg(leg)}
                                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold font-mono transition cursor-pointer border bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20"
                                                            title="Click to configure % Stop Loss & Target"
                                                        >
                                                            <FiShield size={10} />
                                                            <span>
                                                                SL: {leg.slPct != null ? `-${leg.slPct}%` : "Off"}
                                                            </span>
                                                        </button>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-500 italic">
                                                            N/A (Buy Only)
                                                        </span>
                                                    )}
                                                </td>

                                                <td className="py-2 px-3 font-black">
                                                    <span
                                                        className={
                                                            pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                                        }
                                                    >
                                                        {pnl >= 0 ? "+" : ""}
                                                        {formatMoney(pnl, 2)}
                                                    </span>
                                                </td>
                                                <td className="py-2 px-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveLeg(leg.id)}
                                                        className="text-gray-400 hover:text-rose-400 p-1 cursor-pointer"
                                                        title="Remove Leg"
                                                    >
                                                        <FiTrash2 size={12} />
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
            )}

            {/* ------------------------------------------------------------- */}
            {/* 5. MAIN WORKSPACE: OPTION CHAIN / PAYOFF VIEW                */}
            {/* ------------------------------------------------------------- */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                <div
                    ref={chainTableContainerRef}
                    className="flex-1 flex flex-col overflow-y-auto custom-scrollbar"
                >
                    {viewMode === "payoff" ? (
                        /* Payoff Engine Full Screen */
                        <div className="p-6 max-w-6xl mx-auto w-full space-y-6">
                            {/* Key Performance Matrix Cards */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-4">
                                    <div className="text-[11px] font-bold text-gray-400 uppercase">Max Profit</div>
                                    <div className="text-lg font-black text-emerald-400 font-mono mt-1">
                                        {portfolioSummary.maxProfit > 999999
                                            ? "Unlimited"
                                            : formatMoney(portfolioSummary.maxProfit, 2)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">At Expiry</div>
                                </div>

                                <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-4">
                                    <div className="text-[11px] font-bold text-gray-400 uppercase">Max Loss</div>
                                    <div className="text-lg font-black text-rose-400 font-mono mt-1">
                                        {portfolioSummary.maxLoss < -999999
                                            ? "Unlimited"
                                            : formatMoney(Math.abs(portfolioSummary.maxLoss), 2)}
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
                                        {formatMoney(portfolioSummary.estMargin, 2)}
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">Collateral</div>
                                </div>
                            </div>

                            {/* Payoff Chart */}
                            <div className="rounded-3xl border border-gray-800 bg-[#0c121e] p-5 space-y-4">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                                        <span>Multi-Leg Payoff Simulation</span>
                                        <span className="text-xs font-normal text-gray-400">
                                            (Green = Expiry P&amp;L, Blue = Target Date MTM)
                                        </span>
                                    </h3>

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
                                            Select Buy/Sell legs from the Option Chain to generate your Payoff Matrix.
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
                                                    tickFormatter={(v) => (currency === "INR" ? `₹${Math.round(v * usdtInrRate)}` : `$${v}`)}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: "#0f172a",
                                                        border: "1px solid #334155",
                                                        borderRadius: "10px",
                                                        fontSize: "12px",
                                                    }}
                                                    formatter={(val) => [formatMoney(val), ""]}
                                                />
                                                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
                                                <ReferenceLine
                                                    x={currentSpot}
                                                    stroke="#f59e0b"
                                                    strokeDasharray="3 3"
                                                    label={{
                                                        value: `Spot ${formatMoney(currentSpot, 0)}`,
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
                    ) : (
                        /* Option Chain Matrix Table */
                        <div className="flex-1 overflow-x-auto">
                            <table className="w-full text-center border-collapse text-xs font-mono select-none">
                                <thead className="sticky top-0 z-20 bg-[#0f1424] border-b border-gray-800 text-[11px] font-bold text-gray-400 shadow-sm">
                                    <tr>
                                        {/* CALLS SIDE */}
                                        <th className="py-2.5 px-3 text-left w-20">Delta</th>
                                        <th className="py-2.5 px-3 text-right w-28">Call MP</th>
                                        <th className="py-2.5 px-2 text-center w-28">Buy / Sell</th>

                                        {/* CENTER STRIKE */}
                                        <th className="py-2.5 px-4 text-center font-extrabold text-amber-300 w-36 bg-[#141b30] border-x border-amber-500/20">
                                            Strike
                                        </th>
                                        <th className="py-2.5 px-3 text-center w-16 bg-[#141b30] border-r border-amber-500/20">
                                            IV
                                        </th>

                                        {/* PUTS SIDE */}
                                        <th className="py-2.5 px-2 text-center w-28">Buy / Sell</th>
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
                                                    ref={row.isAtm ? atmRowRef : null}
                                                    className={`hover:bg-purple-950/20 transition-colors ${
                                                        row.isAtm
                                                            ? "bg-amber-950/40 ring-2 ring-amber-500/60 shadow-lg relative z-10"
                                                            : ""
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
                                                        {formatMoney(row.call.price, 2)}
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
                                                                title={`Buy ${row.strike} CE @ ${formatMoney(row.call.price, 2)}`}
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
                                                                title={`Sell ${row.strike} CE @ ${formatMoney(row.call.price, 2)}`}
                                                            >
                                                                S
                                                            </button>
                                                            {/* % SL Trigger badge on active BUY leg */}
                                                            {callLeg && callLeg.action === "BUY" && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenSlModalForLeg(callLeg)}
                                                                    className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold hover:bg-amber-500/30 cursor-pointer"
                                                                    title="Configure % Stop Loss"
                                                                >
                                                                    %{callLeg.slPct ?? 25}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>

                                                    {/* STRIKE PRICE (Center Column with ATM Indicator & Centering) */}
                                                    <td
                                                        className={`py-2 px-3 font-extrabold text-sm text-center ${
                                                            row.isAtm
                                                                ? "bg-amber-950/60 text-amber-200 border-x-2 border-amber-500 shadow-inner"
                                                                : "bg-[#0f1424] text-white border-x border-gray-800"
                                                        }`}
                                                    >
                                                        <div className="flex flex-col items-center">
                                                            <span className="flex items-center gap-1">
                                                                {row.strike}
                                                                {row.isAtm && (
                                                                    <span className="px-1 py-0.2 rounded bg-amber-500 text-black text-[9px] font-black uppercase tracking-wider">
                                                                        ATM
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {row.isAtm && (
                                                                <span className="text-[9px] font-medium text-amber-400">
                                                                    Fut {formatMoney(syntheticFut, 1)}
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
                                                                title={`Buy ${row.strike} PE @ ${formatMoney(row.put.price, 2)}`}
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
                                                                title={`Sell ${row.strike} PE @ ${formatMoney(row.put.price, 2)}`}
                                                            >
                                                                S
                                                            </button>
                                                            {/* % SL Trigger badge on active BUY leg */}
                                                            {putLeg && putLeg.action === "BUY" && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenSlModalForLeg(putLeg)}
                                                                    className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-bold hover:bg-amber-500/30 cursor-pointer"
                                                                    title="Configure % Stop Loss"
                                                                >
                                                                    %{putLeg.slPct ?? 25}
                                                                </button>
                                                            )}
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
                                                        {formatMoney(row.put.price, 2)}
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

                {/* Right Side Drawer: Greeks & Presets */}
                {activeSideDrawer && (
                    <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-gray-800 bg-[#0a0f1c] p-4 flex flex-col gap-4 shrink-0 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                {activeSideDrawer === "payoff" && <FiActivity size={14} className="text-amber-400" />}
                                {activeSideDrawer === "greeks" && <FiPieChart size={14} className="text-amber-400" />}
                                {activeSideDrawer === "presets" && <FiZap size={14} className="text-amber-400" />}
                                <span>
                                    {activeSideDrawer === "payoff"
                                        ? "Crypto Payoff Matrix"
                                        : activeSideDrawer === "greeks"
                                        ? "Portfolio Greeks"
                                        : "Strategy Presets"}
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

                        {/* Payoff Mini Widget */}
                        {activeSideDrawer === "payoff" && (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">Max Profit</div>
                                        <div className="text-sm font-black text-emerald-400 font-mono mt-0.5">
                                            {portfolioSummary.maxProfit > 999999
                                                ? "Unlimited"
                                                : formatMoney(portfolioSummary.maxProfit, 2)}
                                        </div>
                                    </div>
                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">Max Loss</div>
                                        <div className="text-sm font-black text-rose-400 font-mono mt-0.5">
                                            {portfolioSummary.maxLoss < -999999
                                                ? "Unlimited"
                                                : formatMoney(Math.abs(portfolioSummary.maxLoss), 2)}
                                        </div>
                                    </div>
                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">Est. Margin</div>
                                        <div className="text-sm font-black text-blue-400 font-mono mt-0.5">
                                            {formatMoney(portfolioSummary.estMargin, 2)}
                                        </div>
                                    </div>
                                    <div className="rounded-xl bg-[#070b14] border border-gray-800 p-2.5">
                                        <div className="text-[10px] text-gray-400 font-bold uppercase">POP</div>
                                        <div className="text-sm font-black text-amber-400 font-mono mt-0.5">
                                            {portfolioSummary.pop}%
                                        </div>
                                    </div>
                                </div>

                                <div className="h-44 w-full rounded-2xl bg-[#070b14] border border-gray-800 p-2">
                                    {legs.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-[11px] text-gray-500 text-center px-4">
                                            Add legs from the Option Chain to view the Payoff Chart.
                                        </div>
                                    ) : (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={portfolioSummary.curve}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#1f293d" />
                                                <XAxis dataKey="price" hide />
                                                <YAxis hide />
                                                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="2 2" />
                                                <ReferenceLine x={currentSpot} stroke="#f59e0b" strokeDasharray="3 3" />
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
                        )}

                        {/* Greeks Widget */}
                        {activeSideDrawer === "greeks" && (
                            <div className="space-y-3 text-xs">
                                <div className="flex items-center justify-between p-3 rounded-xl bg-[#070b14] border border-gray-800">
                                    <span className="text-gray-400 font-bold">Delta (Δ)</span>
                                    <span className="font-mono font-black text-white">{portfolioSummary.netDelta.toFixed(3)}</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-xl bg-[#070b14] border border-gray-800">
                                    <span className="text-gray-400 font-bold">Theta (θ / day)</span>
                                    <span className="font-mono font-black text-emerald-400">
                                        {formatMoney(portfolioSummary.netTheta, 2)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-xl bg-[#070b14] border border-gray-800">
                                    <span className="text-gray-400 font-bold">Gamma (Γ)</span>
                                    <span className="font-mono font-black text-white">{portfolioSummary.netGamma.toFixed(4)}</span>
                                </div>
                                <div className="flex items-center justify-between p-3 rounded-xl bg-[#070b14] border border-gray-800">
                                    <span className="text-gray-400 font-bold">Vega (ν / 1%)</span>
                                    <span className="font-mono font-black text-blue-400">
                                        {formatMoney(portfolioSummary.netVega, 2)}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 6. BOTTOM TABBED SECTION (POSITIONS / STOP ORDERS / HISTORY) */}
            {/* ------------------------------------------------------------- */}
            <div className="bg-[#0b0e14] border-t border-[#1f2433] mt-auto">
                <div className="flex items-center border-b border-[#1f2433] px-4 gap-2">
                    <button
                        type="button"
                        onClick={() => setBottomTab("positions")}
                        className={`px-4 py-2 text-xs font-bold transition-all border-b-2 cursor-pointer ${
                            bottomTab === "positions"
                                ? "border-purple-500 text-purple-400"
                                : "border-transparent text-gray-400 hover:text-gray-200"
                        }`}
                    >
                        Positions ({legs.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setBottomTab("stop_orders")}
                        className={`px-4 py-2 text-xs font-bold transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
                            bottomTab === "stop_orders"
                                ? "border-purple-500 text-purple-400"
                                : "border-transparent text-gray-400 hover:text-gray-200"
                        }`}
                    >
                        <span>Stop Orders (% SL)</span>
                        {legs.some((l) => l.action === "BUY" && l.slPct != null) && (
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                        )}
                    </button>
                </div>

                {/* Tab Content */}
                <div className="p-4">
                    {!isAuthenticated ? (
                        <div className="p-8 flex flex-col items-center justify-center text-center space-y-3 bg-[#0d1017] rounded-2xl border border-gray-800">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-md">
                                <FiLock size={22} />
                            </div>
                            <div className="space-y-1 max-w-md">
                                <h3 className="text-sm font-bold text-white">
                                    Log In to View Positions &amp; Stop Loss Triggers
                                </h3>
                                <p className="text-xs text-gray-400">
                                    Position baskets, active stop loss limits, and simulated PnL records are securely linked to your account.
                                </p>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                                <Link
                                    to="/login?redirect=/simulator/crypto"
                                    className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition"
                                >
                                    Log In
                                </Link>
                                <Link
                                    to="/register?redirect=/simulator/crypto"
                                    className="px-4 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-600 hover:text-white text-emerald-400 font-bold text-xs transition"
                                >
                                    Sign Up
                                </Link>
                            </div>
                        </div>
                    ) : bottomTab === "positions" ? (
                        legs.length === 0 ? (
                            <div className="text-center py-6 text-xs text-gray-500">
                                No open positions. Add BUY/SELL legs in the Option Chain above.
                            </div>
                        ) : (
                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full text-left text-xs font-mono">
                                    <thead className="bg-[#101626] text-gray-400 text-[10px] font-bold uppercase">
                                        <tr>
                                            <th className="py-2 px-3">Side</th>
                                            <th className="py-2 px-3">Contract</th>
                                            <th className="py-2 px-3">Lots</th>
                                            <th className="py-2 px-3">Entry Price</th>
                                            <th className="py-2 px-3">Mark Price</th>
                                            <th className="py-2 px-3">% SL</th>
                                            <th className="py-2 px-3">MTM P&amp;L</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800">
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
                                                <tr key={leg.id} className="hover:bg-purple-950/10">
                                                    <td className="py-2 px-3">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${leg.action === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400"}`}>
                                                            {leg.action}
                                                        </span>
                                                    </td>
                                                    <td className="py-2 px-3 font-bold text-white">
                                                        {leg.symbol} {leg.strike} {leg.right} ({leg.expiryLabel})
                                                    </td>
                                                    <td className="py-2 px-3">{leg.lots}</td>
                                                    <td className="py-2 px-3 text-gray-300">{formatMoney(leg.entryPrice)}</td>
                                                    <td className="py-2 px-3 text-white font-bold">{formatMoney(livePrice)}</td>
                                                    <td className="py-2 px-3">
                                                        {leg.action === "BUY" ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenSlModalForLeg(leg)}
                                                                className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 cursor-pointer"
                                                            >
                                                                SL: {leg.slPct != null ? `-${leg.slPct}%` : "Off"}
                                                            </button>
                                                        ) : (
                                                            <span className="text-[10px] text-gray-500 italic">N/A</span>
                                                        )}
                                                    </td>
                                                    <td className="py-2 px-3 font-bold">
                                                        <span className={pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                                            {pnl >= 0 ? "+" : ""}{formatMoney(pnl)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )
                    ) : (
                        <div className="space-y-2">
                            {legs.filter((l) => l.action === "BUY" && l.slPct != null).length === 0 ? (
                                <div className="text-center py-6 text-xs text-gray-500">
                                    No active % Stop Loss triggers set on BUY legs. Click % SL on any BUY leg to configure.
                                </div>
                            ) : (
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-left text-xs font-mono">
                                        <thead className="bg-[#101626] text-gray-400 text-[10px] font-bold uppercase">
                                            <tr>
                                                <th className="py-2 px-3">Contract</th>
                                                <th className="py-2 px-3">Entry Price</th>
                                                <th className="py-2 px-3">SL %</th>
                                                <th className="py-2 px-3">SL Trigger Price</th>
                                                <th className="py-2 px-3">Target %</th>
                                                <th className="py-2 px-3">Target Price</th>
                                                <th className="py-2 px-3 text-right">Modify</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-800">
                                            {legs.filter((l) => l.action === "BUY" && l.slPct != null).map((leg) => {
                                                const slPrice = leg.entryPrice * (1 - leg.slPct / 100);
                                                const tpPrice = leg.tpPct != null ? leg.entryPrice * (1 + leg.tpPct / 100) : null;

                                                return (
                                                    <tr key={leg.id} className="hover:bg-purple-950/10">
                                                        <td className="py-2 px-3 font-bold text-white">
                                                            {leg.symbol} {leg.strike} {leg.right}
                                                        </td>
                                                        <td className="py-2 px-3">{formatMoney(leg.entryPrice)}</td>
                                                        <td className="py-2 px-3 text-rose-400 font-bold">-{leg.slPct}%</td>
                                                        <td className="py-2 px-3 text-rose-300 font-bold">{formatMoney(slPrice)}</td>
                                                        <td className="py-2 px-3 text-emerald-400 font-bold">
                                                            {leg.tpPct != null ? `+${leg.tpPct}%` : "Off"}
                                                        </td>
                                                        <td className="py-2 px-3 text-emerald-300 font-bold">
                                                            {tpPrice != null ? formatMoney(tpPrice) : "—"}
                                                        </td>
                                                        <td className="py-2 px-3 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleOpenSlModalForLeg(leg)}
                                                                className="px-2.5 py-1 rounded bg-[#1e2538] hover:bg-[#2b3550] text-gray-200 text-xs font-bold cursor-pointer"
                                                            >
                                                                Edit
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
                    )}
                </div>
            </div>

            {/* ------------------------------------------------------------- */}
            {/* 7. STOP LOSS & TARGET DIALOG BOX MODAL (BUY LEGS ONLY)        */}
            {/* ------------------------------------------------------------- */}
            {isSlModalOpen && activeBuyLegForSl && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
                    <div className="w-full max-w-lg bg-[#11141f] border border-[#2b344a] rounded-2xl p-6 shadow-2xl space-y-4 text-gray-200 animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between pb-3 border-b border-[#23293d]">
                            <div className="flex items-center gap-2.5">
                                <div className="p-2 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-500 text-white shadow-md shadow-rose-900/30">
                                    <FiShield size={18} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-extrabold text-base text-white">
                                            Configure % Stop Loss &amp; Target
                                        </h3>
                                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold">
                                            BUY (Long Leg)
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-400 font-mono flex items-center gap-2 mt-0.5">
                                        <span className="text-amber-300 font-bold">
                                            {activeBuyLegForSl.symbol} {activeBuyLegForSl.strike} {activeBuyLegForSl.right}
                                        </span>
                                        <span>•</span>
                                        <span>
                                            Entry Premium:{" "}
                                            <strong className="text-white">
                                                {formatMoney(activeBuyLegForSl.entryPrice || 100, 2)}
                                            </strong>
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsSlModalOpen(false);
                                    setActiveBuyLegForSl(null);
                                }}
                                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition cursor-pointer"
                            >
                                <FiX size={20} />
                            </button>
                        </div>

                        {/* Modal Body */}
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
                                                    {formatMoney(
                                                        (activeBuyLegForSl.entryPrice || 100) * (1 - legSlPctInput / 100),
                                                        2
                                                    )}
                                                </strong>
                                            </div>
                                        </div>

                                        {/* Quick Presets */}
                                        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                            <span className="text-gray-400">Quick SL Presets:</span>
                                            {[10, 20, 25, 35, 50, 75].map((pct) => (
                                                <button
                                                    key={pct}
                                                    type="button"
                                                    onClick={() => setLegSlPctInput(pct)}
                                                    className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                        legSlPctInput === pct
                                                            ? "bg-rose-600 text-white border-rose-500 shadow-sm"
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
                                                    {formatMoney(
                                                        (activeBuyLegForSl.entryPrice || 100) * (1 + legTpPctInput / 100),
                                                        2
                                                    )}
                                                </strong>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                                            <span className="text-gray-400">Quick Target Presets:</span>
                                            {[25, 50, 75, 100, 150, 200].map((pct) => (
                                                <button
                                                    key={pct}
                                                    type="button"
                                                    onClick={() => setLegTpPctInput(pct)}
                                                    className={`px-2 py-0.5 rounded-md border font-mono font-bold transition-all cursor-pointer ${
                                                        legTpPctInput === pct
                                                            ? "bg-emerald-600 text-white border-emerald-500 shadow-sm"
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

                        {/* Modal Footer */}
                        <div className="flex items-center justify-between pt-3 border-t border-[#23293d]">
                            <button
                                type="button"
                                onClick={() => {
                                    setLegs((prev) =>
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
                                    type="button"
                                    onClick={() => {
                                        setIsSlModalOpen(false);
                                        setActiveBuyLegForSl(null);
                                    }}
                                    className="px-4 py-2 rounded-xl bg-[#181d2c] hover:bg-[#22293d] text-gray-300 text-xs font-bold transition cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveLegSl}
                                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-xs font-extrabold shadow-lg shadow-emerald-900/40 transition cursor-pointer"
                                >
                                    Save % Triggers
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ------------------------------------------------------------- */}
            {/* 8. PRO MEMBERSHIP GATE MODAL                                 */}
            {/* ------------------------------------------------------------- */}
            {showProModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xs p-4 animate-in fade-in duration-150">
                    <div className="w-full max-w-lg rounded-3xl border border-amber-500/40 bg-[#0d121f] p-6 shadow-2xl text-gray-200 space-y-5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-lg font-black">
                                    ★
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-white">
                                        PRO Membership Required
                                    </h3>
                                    <p className="text-xs text-amber-300/80 font-medium">
                                        Unlock 2024–2026 Historical Crypto Backtesting
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowProModal(false)}
                                className="text-gray-400 hover:text-white p-1 cursor-pointer"
                            >
                                <FiX size={18} />
                            </button>
                        </div>

                        <div className="rounded-2xl bg-[#080c16] border border-gray-800 p-4 space-y-3 text-xs">
                            <div className="flex items-start gap-2.5">
                                <FiCheckCircle className="text-emerald-400 mt-0.5 shrink-0" size={15} />
                                <div>
                                    <strong className="text-white">Strictly BTC, ETH &amp; SOL Historical Data:</strong> Full 2024 to 2026 tick-by-tick option prices and implied volatility replay.
                                </div>
                            </div>
                            <div className="flex items-start gap-2.5">
                                <FiCheckCircle className="text-emerald-400 mt-0.5 shrink-0" size={15} />
                                <div>
                                    <strong className="text-white">24/7 Scrubbing &amp; Autoplay:</strong> Fast time jumps (-1d, -1h, +15m, +1h, EOD) with up to 10x playback speed.
                                </div>
                            </div>
                            <div className="flex items-start gap-2.5">
                                <FiCheckCircle className="text-emerald-400 mt-0.5 shrink-0" size={15} />
                                <div>
                                    <strong className="text-white">% Stop Loss &amp; Take Profit:</strong> Strict debit protection triggers on BUY legs with live USD/INR currency conversion.
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <button
                                type="button"
                                onClick={() => setShowProModal(false)}
                                className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold transition cursor-pointer"
                            >
                                Maybe Later
                            </button>

                            <Link
                                to="/pricing"
                                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-xs font-black shadow-lg shadow-emerald-950/60 transition"
                            >
                                <FiZap size={14} />
                                <span>Upgrade to PRO Now</span>
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
