import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
// pages/CryptoStrategyBuilder.jsx — Premier Bitcoin & Crypto Options Strategy Builder
// Side-by-side Strike Chain and Payoff Matrix layout (matching Indian Strategy Builder), Active vs Upcoming Positions, and real-time Greeks.

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
import { saveStrategy } from "../services/strategiesApi";
import { openStrategyTrade, fetchPositions, closePosition } from "../services/paperTradeApi";

const CRYPTO_ASSETS = [
    {
        symbol: "BTCUSD",
        name: "Bitcoin",
        lotSize: 1,
        strikeStep: 250,
        basePrice: 84150.0,
        perpBasis: -35.5,
        icon: "₿",
        badge: "BTC 24/7",
        tickSize: 0.5,
    },
    {
        symbol: "ETHUSD",
        name: "Ethereum",
        lotSize: 1,
        strikeStep: 25,
        basePrice: 3492.5,
        perpBasis: -1.8,
        icon: "Ξ",
        badge: "ETH 24/7",
        tickSize: 0.05,
    },
    {
        symbol: "SOLUSD",
        name: "Solana",
        lotSize: 10,
        strikeStep: 2,
        basePrice: 156.4,
        perpBasis: 0.35,
        icon: "◎",
        badge: "SOL 24/7",
        tickSize: 0.01,
    },
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

/**
 * Calculates standard crypto derivatives margin (Deribit / Portfolio Margin standard):
 * - Long options only: Margin = Total Premium Paid
 * - Defined risk spreads (Bull/Bear spreads, Iron Condor, Butterflies): Margin is capped at Max Spread Loss
 * - Naked short options: Initial Margin = max(10% Spot, 10% Spot - OTM) + Mark Price
 * - Cross-margin benefits for opposite wings
 */
export function calculateCryptoMargin(legs, liveSpot, asset) {
    if (!legs || legs.length === 0 || !liveSpot) {
        return { estMargin: 0, fundsRequired: 0, netPremium: 0, marginBenefit: 0, isHedged: false };
    }

    const lotSize = asset?.lotSize || 1;
    let premiumPaid = 0;
    let premiumReceived = 0;
    let totalNakedMargin = 0;

    const longCalls = [];
    const shortCalls = [];
    const longPuts = [];
    const shortPuts = [];

    const imBasePct = asset?.symbol === "SOLUSD" ? 0.15 : 0.10;

    legs.forEach((leg) => {
        const cost = (leg.entryPrice || 0) * (leg.lots || 1) * lotSize;
        const normalizedLeg = {
            ...leg,
            lotsLeft: leg.lots || 1,
            cost,
        };

        if (leg.action === "BUY") {
            premiumPaid += cost;
            if (leg.right === "CE") longCalls.push(normalizedLeg);
            else longPuts.push(normalizedLeg);
        } else {
            premiumReceived += cost;
            if (leg.right === "CE") shortCalls.push(normalizedLeg);
            else shortPuts.push(normalizedLeg);

            // Compute standalone naked margin for comparison/benefit
            const otm = leg.right === "CE" ? Math.max(0, leg.strike - liveSpot) : Math.max(0, liveSpot - leg.strike);
            const imUnit = Math.max(imBasePct * liveSpot, imBasePct * liveSpot - otm) + (leg.entryPrice || 0);
            totalNakedMargin += imUnit * (leg.lots || 1) * lotSize;
        }
    });

    // Case 1: Purely Long Options
    if (shortCalls.length === 0 && shortPuts.length === 0) {
        return {
            estMargin: Math.round(premiumPaid * 100) / 100,
            fundsRequired: Math.round(premiumPaid * 100) / 100,
            netPremium: Math.round((premiumReceived - premiumPaid) * 100) / 100,
            marginBenefit: 0,
            isHedged: false,
        };
    }

    // Case 2: Match Call Spreads (Hedge Short Calls with Long Calls)
    let callSpreadMargin = 0;
    let matchedHedges = false;
    shortCalls.sort((a, b) => a.strike - b.strike);
    longCalls.sort((a, b) => a.strike - b.strike);

    for (const sLeg of shortCalls) {
        if (sLeg.lotsLeft <= 0) continue;
        for (const lLeg of longCalls) {
            if (sLeg.lotsLeft <= 0) break;
            if (lLeg.lotsLeft <= 0) continue;

            const matchedLots = Math.min(sLeg.lotsLeft, lLeg.lotsLeft);
            if (lLeg.strike <= sLeg.strike) {
                // Bull Call (Debit) Spread: Maximum risk is the debit paid
                const debitPerLot = Math.max(0, lLeg.entryPrice - sLeg.entryPrice) * lotSize;
                callSpreadMargin += debitPerLot * matchedLots;
            } else {
                // Bear Call (Credit) Spread: Max loss is strike width minus credit received
                const width = (lLeg.strike - sLeg.strike) * lotSize;
                const credit = Math.max(0, sLeg.entryPrice - lLeg.entryPrice) * lotSize;
                const maxLoss = Math.max(0, width - credit);
                callSpreadMargin += maxLoss * matchedLots;
            }
            sLeg.lotsLeft -= matchedLots;
            lLeg.lotsLeft -= matchedLots;
            matchedHedges = true;
        }
    }

    // Case 3: Match Put Spreads (Hedge Short Puts with Long Puts)
    let putSpreadMargin = 0;
    shortPuts.sort((a, b) => b.strike - a.strike);
    longPuts.sort((a, b) => b.strike - a.strike);

    for (const sLeg of shortPuts) {
        if (sLeg.lotsLeft <= 0) continue;
        for (const lLeg of longPuts) {
            if (sLeg.lotsLeft <= 0) break;
            if (lLeg.lotsLeft <= 0) continue;

            const matchedLots = Math.min(sLeg.lotsLeft, lLeg.lotsLeft);
            if (lLeg.strike >= sLeg.strike) {
                // Bear Put (Debit) Spread: Maximum risk is the debit paid
                const debitPerLot = Math.max(0, lLeg.entryPrice - sLeg.entryPrice) * lotSize;
                putSpreadMargin += debitPerLot * matchedLots;
            } else {
                // Bull Put (Credit) Spread: Max loss is strike width minus credit received
                const width = (sLeg.strike - lLeg.strike) * lotSize;
                const credit = Math.max(0, sLeg.entryPrice - lLeg.entryPrice) * lotSize;
                const maxLoss = Math.max(0, width - credit);
                putSpreadMargin += maxLoss * matchedLots;
            }
            sLeg.lotsLeft -= matchedLots;
            lLeg.lotsLeft -= matchedLots;
            matchedHedges = true;
        }
    }

    // Case 4: Unhedged remaining short legs
    let unhedgedCallMargin = 0;
    for (const sLeg of shortCalls) {
        if (sLeg.lotsLeft > 0) {
            const otmAmount = Math.max(0, sLeg.strike - liveSpot);
            const imPerUnit = Math.max(imBasePct * liveSpot, imBasePct * liveSpot - otmAmount) + sLeg.entryPrice;
            unhedgedCallMargin += imPerUnit * sLeg.lotsLeft * lotSize;
        }
    }

    let unhedgedPutMargin = 0;
    for (const sLeg of shortPuts) {
        if (sLeg.lotsLeft > 0) {
            const otmAmount = Math.max(0, liveSpot - sLeg.strike);
            const imPerUnit = Math.max(imBasePct * liveSpot, imBasePct * sLeg.strike - otmAmount) + sLeg.entryPrice;
            unhedgedPutMargin += imPerUnit * sLeg.lotsLeft * lotSize;
        }
    }

    const totalCallSideMargin = callSpreadMargin + unhedgedCallMargin;
    const totalPutSideMargin = putSpreadMargin + unhedgedPutMargin;

    // Case 5: Cross-side offset (Iron Condor / Butterflies or Straddle / Strangle cross-margin)
    let totalRiskMargin = 0;
    if (callSpreadMargin > 0 && putSpreadMargin > 0 && unhedgedCallMargin === 0 && unhedgedPutMargin === 0) {
        // Defined risk range wings (Iron Condor): only one wing can lose at a time
        totalRiskMargin = Math.max(callSpreadMargin, putSpreadMargin);
    } else {
        totalRiskMargin = Math.max(totalCallSideMargin, totalPutSideMargin) + Math.min(totalCallSideMargin, totalPutSideMargin) * 0.15;
    }

    const netDebit = Math.max(0, premiumPaid - premiumReceived);
    const estMargin = Math.max(netDebit, totalRiskMargin);
    const marginBenefit = matchedHedges ? Math.max(0, totalNakedMargin - estMargin) : 0;

    return {
        estMargin: Math.round(estMargin * 100) / 100,
        fundsRequired: Math.round((estMargin + (premiumPaid > premiumReceived ? netDebit : 0)) * 100) / 100,
        netPremium: Math.round((premiumReceived - premiumPaid) * 100) / 100,
        marginBenefit: Math.round(marginBenefit * 100) / 100,
        isHedged: matchedHedges,
    };
}

export default function CryptoStrategyBuilder() {
    const { user, token, isPro } = useAuth();
    const navigate = useNavigate();

    // Selected Crypto Asset
    const [selectedAsset, setSelectedAsset] = useState(CRYPTO_ASSETS[0]);
    const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);

    // Live Simulated Spot Price with small real-time ticks
    const [liveSpot, setLiveSpot] = useState(selectedAsset.basePrice);
    useEffect(() => {
        setLiveSpot(selectedAsset.basePrice);
        const interval = setInterval(() => {
            const jitter = (Math.random() - 0.49) * (selectedAsset.basePrice * 0.00035);
            setLiveSpot((prev) => Math.round((prev + jitter) * 100) / 100);
        }, 1800);
        return () => clearInterval(interval);
    }, [selectedAsset]);

    const perpPrice = useMemo(() => {
        return Math.round((liveSpot + selectedAsset.perpBasis) * 100) / 100;
    }, [liveSpot, selectedAsset.perpBasis]);

    // Expiry Catalog Generation
    const expiries = useMemo(() => {
        const base = new Date();
        const list = [];
        const offsets = [0, 1, 2, 7, 14, 21, 28, 56, 84];

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
            });
        }
        return list;
    }, []);

    const [selectedExpiryKey, setSelectedExpiryKey] = useState("");

    useEffect(() => {
        if (expiries.length > 0 && (!selectedExpiryKey || !expiries.some((e) => e.key === selectedExpiryKey))) {
            setSelectedExpiryKey(expiries[0].key);
        }
    }, [expiries, selectedExpiryKey]);

    const currentExpiry = useMemo(() => {
        return expiries.find((e) => e.key === selectedExpiryKey) || expiries[0];
    }, [expiries, selectedExpiryKey]);

    // Upcoming / Draft Staged Positions (Workbench)
    const [stagedLegs, setStagedLegs] = useState([]);

    // Active (Executed / Live Paper) Positions
    const [activePositions, setActivePositions] = useState([]);
    const [loadingActivePositions, setLoadingActivePositions] = useState(false);
    const [activePositionsTab, setActivePositionsTab] = useState("upcoming"); // 'upcoming' | 'active'
    const [includeActiveInPayoff, setIncludeActiveInPayoff] = useState(false);

    // Responsive Mobile Views ('all' | 'chain' | 'payoff' | 'positions')
    const [mobileView, setMobileView] = useState("all");

    // Target Simulation & Shock Sliders
    const [targetDaysAhead, setTargetDaysAhead] = useState(0);
    const [ivShockPct, setIvShockPct] = useState(0); // -30% to +30%
    const [chartRangePct, setChartRangePct] = useState(20); // 10%, 20%, 35%, 50%

    // Modals & UI States
    const [showPresetsModal, setShowPresetsModal] = useState(false);
    const [showSaveModal, setShowSaveModal] = useState(false);
    const [strategyNameInput, setStrategyNameInput] = useState("");
    const [toastMessage, setToastMessage] = useState(null);
    const [strikeRangeCount, setStrikeRangeCount] = useState(12);

    const chainScrollRef = useRef(null);
    const atmRowRef = useRef(null);

    // Show Toast Notification
    const showToast = useCallback((msg, type = "success") => {
        setToastMessage({ msg, type });
        setTimeout(() => setToastMessage(null), 3500);
    }, []);

    // Load Active Positions for user
    const loadActivePositions = useCallback(async () => {
        if (!token) return;
        setLoadingActivePositions(true);
        try {
            const data = await fetchPositions(token, "open");
            const filtered = (data.positions || []).filter(
                (p) => p.symbol === selectedAsset.symbol
            );
            setActivePositions(filtered);
        } catch (err) {
            console.error("Failed to load active positions:", err);
        } finally {
            setLoadingActivePositions(false);
        }
    }, [token, selectedAsset.symbol]);

    useEffect(() => {
        loadActivePositions();
    }, [loadActivePositions]);

    // Strike Ladder Generation with Greeks
    const optionChainRows = useMemo(() => {
        if (!currentExpiry) return [];

        const step = selectedAsset.strikeStep;
        const atmStrike = Math.round(liveSpot / step) * step;
        const strikes = [];

        for (let i = -strikeRangeCount; i <= strikeRangeCount; i++) {
            strikes.push(atmStrike + i * step);
        }

        const daysToExp = Math.max(0.001, currentExpiry.daysLeft);
        const tYears = daysToExp / 365;

        return strikes.map((strike) => {
            const moneyness = Math.log(strike / liveSpot);
            const baseVol = 0.45 * (1 + ivShockPct / 100);
            const ivVal = Math.max(0.12, baseVol + moneyness * moneyness * 0.9 - moneyness * 0.12);
            const ivDisplay = ivVal * 100;

            const callPrice = bsPrice({
                spot: liveSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "CE",
            });
            const callGreeks = calculateGreeks({
                spot: liveSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "CE",
            });

            const putPrice = bsPrice({
                spot: liveSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "PE",
            });
            const putGreeks = calculateGreeks({
                spot: liveSpot,
                strike,
                t: tYears,
                vol: ivVal,
                right: "PE",
            });

            const isAtm = strike === atmStrike;
            const isCallItm = strike < liveSpot;
            const isPutItm = strike > liveSpot;

            // Check if staged
            const stagedCallLeg = stagedLegs.find(
                (l) => l.strike === strike && l.right === "CE" && l.expiry === currentExpiry.iso
            );
            const stagedPutLeg = stagedLegs.find(
                (l) => l.strike === strike && l.right === "PE" && l.expiry === currentExpiry.iso
            );

            return {
                strike,
                isAtm,
                isCallItm,
                isPutItm,
                iv: ivDisplay,
                call: {
                    price: Math.max(0.05, callPrice),
                    delta: callGreeks.delta,
                    theta: callGreeks.theta,
                    gamma: callGreeks.gamma,
                    vega: callGreeks.vega,
                    stagedLeg: stagedCallLeg,
                },
                put: {
                    price: Math.max(0.05, putPrice),
                    delta: putGreeks.delta,
                    theta: putGreeks.theta,
                    gamma: putGreeks.gamma,
                    vega: putGreeks.vega,
                    stagedLeg: stagedPutLeg,
                },
            };
        });
    }, [currentExpiry, selectedAsset.strikeStep, liveSpot, strikeRangeCount, ivShockPct, stagedLegs]);

    // Center scroll on ATM row
    const scrollToAtm = useCallback(() => {
        if (atmRowRef.current && chainScrollRef.current) {
            const row = atmRowRef.current;
            const container = chainScrollRef.current;
            container.scrollTo({
                top: row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2,
                behavior: "smooth",
            });
        }
    }, []);

    // Add / Toggle Staged Leg from Chain
    const handleToggleStagedLeg = useCallback((strike, right, action, price) => {
        if (!currentExpiry) return;
        const expiry = currentExpiry.iso;
        setStagedLegs((prev) => {
            const existingIdx = prev.findIndex(
                (l) => l.strike === strike && l.right === right && l.expiry === expiry
            );
            if (existingIdx >= 0) {
                const existing = prev[existingIdx];
                if (existing.action === action) {
                    return prev.filter((_, idx) => idx !== existingIdx);
                } else {
                    const updated = [...prev];
                    updated[existingIdx] = {
                        ...existing,
                        action,
                        entryPrice: price,
                        currentPrice: price,
                    };
                    return updated;
                }
            } else {
                const newLeg = {
                    id: `${selectedAsset.symbol}-${expiry}-${strike}-${right}-${Date.now()}`,
                    enabled: true,
                    symbol: selectedAsset.symbol,
                    expiry,
                    expiryLabel: currentExpiry.label,
                    daysLeft: currentExpiry.daysLeft,
                    strike,
                    right, // 'CE' | 'PE'
                    action, // 'BUY' | 'SELL'
                    lots: selectedAsset.lotSize,
                    entryPrice: price,
                    currentPrice: price,
                    iv: 45,
                };
                return [...prev, newLeg];
            }
        });
    }, [currentExpiry, selectedAsset]);

    const handleUpdateLegField = useCallback((legId, field, value) => {
        setStagedLegs((prev) =>
            prev.map((l) => (l.id === legId ? { ...l, [field]: value } : l))
        );
    }, []);

    const handleUpdateLots = useCallback((legId, delta) => {
        setStagedLegs((prev) =>
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
        setStagedLegs((prev) => prev.filter((l) => l.id !== legId));
    }, []);

    const handleClearLegs = useCallback(() => {
        setStagedLegs([]);
    }, []);

    // Combine Staged Legs + Active Positions if toggled
    const combinedLegsForAnalysis = useMemo(() => {
        const list = stagedLegs.filter((l) => l.enabled !== false);
        if (includeActiveInPayoff && activePositions.length > 0) {
            activePositions.forEach((pos) => {
                list.push({
                    id: `active-${pos.id}`,
                    enabled: true,
                    symbol: pos.symbol,
                    expiry: pos.expiry,
                    expiryLabel: pos.expiry,
                    daysLeft: 7,
                    strike: Number(pos.strike),
                    right: pos.opt_right,
                    action: pos.side === "long" ? "BUY" : "SELL",
                    lots: Number(pos.lots || 1),
                    entryPrice: Number(pos.entry_price || 0),
                    currentPrice: Number(pos.current_price || pos.entry_price || 0),
                    iv: 45,
                    isActivePos: true,
                });
            });
        }
        return list;
    }, [stagedLegs, includeActiveInPayoff, activePositions]);

    // Portfolio & Payoff Matrix Calculations
    const portfolioSummary = useMemo(() => {
        if (combinedLegsForAnalysis.length === 0) {
            return {
                netPnL: 0,
                netDelta: 0,
                netTheta: 0,
                netGamma: 0,
                netVega: 0,
                maxProfit: 0,
                maxLoss: 0,
                breakevens: [],
                pop: 50,
                netDebit: 0,
                estMargin: 0,
                curve: [],
                minCurvePnl: 0,
                maxCurvePnl: 0,
            };
        }

        let netPnL = 0;
        let netDelta = 0;
        let netTheta = 0;
        let netGamma = 0;
        let netVega = 0;
        let netDebit = 0;

        combinedLegsForAnalysis.forEach((leg) => {
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

        // Payoff Range
        const rangeRatio = chartRangePct / 100;
        const minP = liveSpot * (1 - rangeRatio);
        const maxP = liveSpot * (1 + rangeRatio);
        const steps = 100;
        const stepSize = (maxP - minP) / steps;

        const curve = [];
        let minCurvePnl = Infinity;
        let maxCurvePnl = -Infinity;

        const targetDaysRemaining = Math.max(0.001, (currentExpiry?.daysLeft || 1) - targetDaysAhead);
        const tTargetYears = targetDaysRemaining / 365;

        for (let i = 0; i <= steps; i++) {
            const p = minP + i * stepSize;
            let expiryPnl = 0;
            let targetPnl = 0;

            combinedLegsForAnalysis.forEach((leg) => {
                const mult = leg.action === "BUY" ? 1 : -1;
                // Expiry P&L (Intrinsic value)
                const intrinsic =
                    leg.right === "CE"
                        ? Math.max(0, p - leg.strike)
                        : Math.max(0, leg.strike - p);
                expiryPnl += (intrinsic - leg.entryPrice) * mult * leg.lots;

                // Target Date Mark-to-Market P&L
                const bsVal = bsPrice({
                    spot: p,
                    strike: leg.strike,
                    t: tTargetYears,
                    vol: 0.45 * (1 + ivShockPct / 100),
                    right: leg.right,
                });
                targetPnl += (bsVal - leg.entryPrice) * mult * leg.lots;
            });

            if (expiryPnl < minCurvePnl) minCurvePnl = expiryPnl;
            if (expiryPnl > maxCurvePnl) maxCurvePnl = expiryPnl;

            curve.push({
                price: Math.round(p * 10) / 10,
                pnl: Math.round(expiryPnl * 100) / 100,
                targetPnl: Math.round(targetPnl * 100) / 100,
            });
        }

        // Breakevens Finder
        const breakevens = [];
        for (let i = 0; i < curve.length - 1; i++) {
            const p1 = curve[i];
            const p2 = curve[i + 1];
            if ((p1.pnl <= 0 && p2.pnl >= 0) || (p1.pnl >= 0 && p2.pnl <= 0)) {
                const interp = p1.price + ((0 - p1.pnl) / (p2.pnl - p1.pnl || 1)) * (p2.price - p1.price);
                breakevens.push(Math.round(interp));
            }
        }

        // Probability of Profit (POP) approximation
        let pop = 50;
        if (breakevens.length === 1) {
            const be = breakevens[0];
            const d2 = (Math.log(liveSpot / be) + (0.05 - 0.5 * 0.45 * 0.45) * 0.1) / (0.45 * Math.sqrt(0.1));
            pop = Math.round(normCdf(d2) * 100);
        } else if (breakevens.length >= 2) {
            const beLow = Math.min(...breakevens);
            const beHigh = Math.max(...breakevens);
            const dLow = Math.log(liveSpot / beLow) / (0.45 * Math.sqrt(0.1));
            const dHigh = Math.log(liveSpot / beHigh) / (0.45 * Math.sqrt(0.1));
            pop = Math.round(Math.abs(normCdf(dHigh) - normCdf(dLow)) * 100);
        }

        const marginDetails = calculateCryptoMargin(combinedLegsForAnalysis, liveSpot, selectedAsset);

        const maxProfit = maxCurvePnl > 10000000 ? Infinity : maxCurvePnl;
        const maxLoss = minCurvePnl < -10000000 ? -Infinity : minCurvePnl;

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
            estMargin: marginDetails.estMargin,
            fundsRequired: marginDetails.fundsRequired,
            marginBenefit: marginDetails.marginBenefit,
            netPremium: marginDetails.netPremium,
            isHedged: marginDetails.isHedged,
            curve,
            minCurvePnl,
            maxCurvePnl,
        };
    }, [combinedLegsForAnalysis, optionChainRows, liveSpot, currentExpiry, targetDaysAhead, ivShockPct, chartRangePct, selectedAsset]);

    // 1-Click Execute Staged Basket to Paper Trading
    const handleExecuteStagedToPaper = async () => {
        if (!token) {
            showToast("Please log in to execute paper trades", "error");
            navigate("/login");
            return;
        }
        if (stagedLegs.length === 0) {
            showToast("No staged positions to execute", "error");
            return;
        }

        try {
            const legsPayload = stagedLegs.map((l) => ({
                strike: l.strike,
                optRight: l.right,
                lots: l.lots,
                side: l.action === "BUY" ? "long" : "short",
                entryPrice: l.entryPrice,
            }));

            await openStrategyTrade(token, {
                symbol: selectedAsset.symbol,
                expiry: currentExpiry.iso,
                legs: legsPayload,
                strategyName: strategyNameInput || `${selectedAsset.symbol} Custom Strategy`,
            });

            showToast("Successfully executed positions to Paper Trading!", "success");
            setStagedLegs([]);
            loadActivePositions();
            setActivePositionsTab("active");
        } catch (err) {
            showToast(err.message || "Execution failed", "error");
        }
    };

    // Save Strategy to Database
    const handleSaveStrategy = async () => {
        if (!token) {
            showToast("Please log in to save custom strategies", "error");
            navigate("/login");
            return;
        }
        if (stagedLegs.length === 0) {
            showToast("Please configure at least one leg before saving", "error");
            return;
        }
        if (!strategyNameInput.trim()) {
            showToast("Please enter a name for your strategy", "error");
            return;
        }

        try {
            await saveStrategy(token, {
                name: strategyNameInput.trim(),
                underlying: selectedAsset.symbol,
                legs: stagedLegs,
            });
            showToast(`Strategy "${strategyNameInput}" saved successfully!`, "success");
            setShowSaveModal(false);
            setStrategyNameInput("");
        } catch (err) {
            showToast(err.message || "Failed to save strategy", "error");
        }
    };

    // Square Off Active Position
    const handleCloseActivePosition = async (posId) => {
        if (!token) return;
        try {
            await closePosition(token, posId);
            showToast("Position squared off successfully", "success");
            loadActivePositions();
        } catch (err) {
            showToast(err.message || "Failed to close position", "error");
        }
    };

    return (
        <div className="min-h-screen w-full bg-[#070b12] text-gray-200 flex flex-col font-sans select-none antialiased">
            {/* Toast Notification Banner */}
            {toastMessage && (
                <div
                    className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-2xl px-4 py-3 text-xs font-bold shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 ${
                        toastMessage.type === "error"
                            ? "border border-rose-500/40 bg-rose-950/90 text-rose-200"
                            : "border border-emerald-500/40 bg-emerald-950/90 text-emerald-200"
                    }`}
                >
                    {toastMessage.type === "error" ? <FiAlertCircle size={16} /> : <FiCheckCircle size={16} />}
                    <span>{toastMessage.msg}</span>
                </div>
            )}

            {/* Top Full-Width Trading Bar */}
            <div className="w-full bg-[#0b101b] border-b border-amber-500/20 px-3 sm:px-5 lg:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-lg">
                <div className="flex items-center gap-3 sm:gap-5 flex-wrap">
                    {/* Crypto Asset Selector */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setAssetDropdownOpen((p) => !p)}
                            className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 text-xs font-black text-amber-300 hover:bg-amber-500/20 transition cursor-pointer shadow-xs"
                        >
                            <span className="text-sm font-black text-amber-400">{selectedAsset.icon}</span>
                            <span className="tracking-wide">{selectedAsset.name}</span>
                            <span className="text-[10px] bg-amber-500/20 px-1 py-0.5 rounded text-amber-400 font-mono">
                                {selectedAsset.symbol}
                            </span>
                            <FiChevronDown size={13} className="text-amber-400" />
                        </button>

                        {assetDropdownOpen && (
                            <div className="absolute top-full left-0 mt-1.5 w-56 rounded-2xl border border-gray-700 bg-[#0f172a] p-1.5 shadow-2xl z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                                {CRYPTO_ASSETS.map((asset) => (
                                    <button
                                        key={asset.symbol}
                                        type="button"
                                        onClick={() => {
                                            setSelectedAsset(asset);
                                            setAssetDropdownOpen(false);
                                            setStagedLegs([]);
                                        }}
                                        className={`flex items-center justify-between w-full px-3 py-2 text-xs font-semibold rounded-xl transition cursor-pointer ${
                                            selectedAsset.symbol === asset.symbol
                                                ? "bg-amber-500 text-black font-bold"
                                                : "text-gray-200 hover:bg-gray-800"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-base font-bold">{asset.icon}</span>
                                            <span>{asset.name}</span>
                                        </div>
                                        <span className="text-[11px] font-mono opacity-80">${asset.basePrice}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Live Spot & Perp Stream Quote */}
                    <div className="flex items-baseline gap-2">
                        <span className="text-lg sm:text-xl font-black font-mono tracking-tight text-white">
                            ${formatCryptoPrice(liveSpot, 2)}
                        </span>
                        <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            FUT ${formatCryptoPrice(perpPrice, 2)}
                        </span>
                    </div>
                </div>

                {/* Right Action Tools */}
                <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
                    <button
                        type="button"
                        onClick={() => setShowPresetsModal(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition cursor-pointer"
                    >
                        <FiZap size={13} className="text-amber-400" />
                        <span>Presets</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setShowSaveModal(true)}
                        disabled={stagedLegs.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                        <FiSave size={13} />
                        <span>Save Strategy</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleExecuteStagedToPaper}
                        disabled={stagedLegs.length === 0}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-black text-white hover:from-emerald-500 hover:to-teal-500 shadow-md shadow-emerald-600/20 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                        <FiCheck size={14} />
                        <span>Execute Paper Trade</span>
                    </button>

                    <Link
                        to="/simulator/bitcoin"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/30 bg-blue-500/10 px-2.5 py-1.5 text-xs font-bold text-blue-300 hover:bg-blue-500/20 transition"
                    >
                        <FiPlay size={13} />
                        <span>Simulator Replay</span>
                    </Link>
                </div>
            </div>

            {/* Mobile View Toggle Strip (< lg) */}
            <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto px-3 py-2 bg-[#090d16] border-b border-gray-800">
                {[
                    ["all", "All View"],
                    ["chain", "⛓ Strikes Chain"],
                    ["payoff", "📈 Payoff Matrix"],
                    ["positions", `📋 Positions (${stagedLegs.length})`],
                ].map(([key, label]) => (
                    <button
                        key={key}
                        onClick={() => setMobileView(key)}
                        className={`shrink-0 rounded-xl px-3 py-1 text-xs font-bold transition ${
                            mobileView === key
                                ? "bg-amber-500 text-black font-black"
                                : "bg-gray-800 text-gray-400 hover:text-white"
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Main Side-By-Side Row Layout (Matching Indian Strategy Builder) */}
            <div className="w-full px-3 sm:px-4 lg:px-5 py-3.5 flex-1 overflow-y-auto custom-scrollbar">
                <div className="flex flex-col lg:flex-row gap-4 xl:gap-5 items-start">
                    
                    {/* LEFT COLUMN: Option Chain / Strikes Window (w-full lg:w-[480px] xl:w-[530px] 2xl:w-[570px] shrink-0) */}
                    <div className={`w-full lg:w-[480px] xl:w-[530px] 2xl:w-[570px] shrink-0 flex flex-col gap-2.5 ${mobileView !== "all" && mobileView !== "chain" ? "hidden lg:flex" : ""}`}>
                        {/* Expiry Selector Bar */}
                        <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-2.5 shadow-sm space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Expiry Catalog</span>
                                <button
                                    type="button"
                                    onClick={scrollToAtm}
                                    className="text-[10px] font-bold text-amber-400 hover:underline cursor-pointer"
                                >
                                    Center on ATM
                                </button>
                            </div>

                            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                                {expiries.map((exp) => {
                                    const isSelected = exp.key === selectedExpiryKey;
                                    const hasLegsInExp = stagedLegs.some((l) => l.expiry === exp.iso);

                                    return (
                                        <button
                                            key={exp.key}
                                            type="button"
                                            onClick={() => setSelectedExpiryKey(exp.key)}
                                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 cursor-pointer ${
                                                isSelected
                                                    ? "bg-amber-500 text-black shadow-md shadow-amber-500/20 font-black ring-1 ring-amber-300"
                                                    : "bg-gray-800/60 text-gray-300 hover:bg-gray-800 hover:text-white border border-gray-700/50"
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
                            </div>
                        </div>

                        {/* Strikes Chain Table */}
                        <div className="rounded-2xl border border-gray-800 bg-[#0c121e] overflow-hidden shadow-md flex flex-col">
                            <div className="p-2.5 border-b border-gray-800 flex items-center justify-between bg-[#0f1424]">
                                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    <span>{selectedAsset.symbol} Chain</span>
                                </span>

                                <div className="flex items-center gap-1">
                                    {[8, 12, 16, 24].map((cnt) => (
                                        <button
                                            key={cnt}
                                            type="button"
                                            onClick={() => setStrikeRangeCount(cnt)}
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                                                strikeRangeCount === cnt
                                                    ? "bg-amber-500 text-black font-black"
                                                    : "bg-gray-800 text-gray-400 hover:text-white"
                                            }`}
                                        >
                                            ±{cnt}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div ref={chainScrollRef} className="max-h-[75vh] overflow-y-auto custom-scrollbar">
                                <table className="w-full text-center border-collapse text-xs font-mono select-none">
                                    <thead className="sticky top-0 z-10 bg-[#121929] border-b border-gray-800 text-[10px] font-bold text-gray-400 shadow-xs">
                                        <tr>
                                            <th className="py-2 px-2 text-left w-12">Δ</th>
                                            <th className="py-2 px-2 text-right w-20">Call</th>
                                            <th className="py-2 px-1 text-center w-16">B / S</th>
                                            <th className="py-2 px-2 text-center font-black text-amber-300 w-24 bg-[#162038] border-x border-amber-500/20">
                                                Strike
                                            </th>
                                            <th className="py-2 px-1 text-center w-16">B / S</th>
                                            <th className="py-2 px-2 text-left w-20">Put</th>
                                            <th className="py-2 px-2 text-right w-12">Δ</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-800/40">
                                        {optionChainRows.map((row) => {
                                            const callLeg = row.call.stagedLeg;
                                            const putLeg = row.put.stagedLeg;

                                            return (
                                                <tr
                                                    key={row.strike}
                                                    ref={row.isAtm ? atmRowRef : null}
                                                    className={`hover:bg-amber-500/5 transition-colors ${
                                                        row.isAtm ? "bg-amber-950/25 ring-1 ring-amber-500/40 font-bold" : ""
                                                    }`}
                                                >
                                                    {/* Call Delta */}
                                                    <td className={`py-1.5 px-2 text-left ${row.isCallItm ? "bg-[#182030]/80 text-gray-300" : "text-gray-400"}`}>
                                                        {formatDelta(row.call.delta)}
                                                    </td>

                                                    {/* Call Price */}
                                                    <td className={`py-1.5 px-2 text-right font-bold ${row.isCallItm ? "bg-[#182030]/80 text-gray-100" : "text-gray-200"}`}>
                                                        ${formatCryptoPrice(row.call.price, 2)}
                                                    </td>

                                                    {/* Call B / S */}
                                                    <td className={`py-1 px-1 text-center ${row.isCallItm ? "bg-[#182030]/80" : ""}`}>
                                                        <div className="flex items-center justify-center gap-0.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleStagedLeg(row.strike, "CE", "BUY", row.call.price)}
                                                                className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase transition cursor-pointer ${
                                                                    callLeg && callLeg.action === "BUY"
                                                                        ? "bg-emerald-500 text-black ring-1 ring-emerald-300 font-black"
                                                                        : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30"
                                                                }`}
                                                            >
                                                                B
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleStagedLeg(row.strike, "CE", "SELL", row.call.price)}
                                                                className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase transition cursor-pointer ${
                                                                    callLeg && callLeg.action === "SELL"
                                                                        ? "bg-rose-500 text-white ring-1 ring-rose-300 font-black"
                                                                        : "bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/30"
                                                                }`}
                                                            >
                                                                S
                                                            </button>
                                                        </div>
                                                    </td>

                                                    {/* Strike */}
                                                    <td className={`py-1.5 px-2 font-black text-xs text-center ${row.isAtm ? "bg-amber-950/50 text-amber-300 border-x border-amber-500/40" : "bg-[#121929] text-white border-x border-gray-800"}`}>
                                                        {row.strike}
                                                        {row.isAtm && <span className="block text-[8px] text-amber-400 font-normal leading-tight">ATM</span>}
                                                    </td>

                                                    {/* Put B / S */}
                                                    <td className={`py-1 px-1 text-center ${row.isPutItm ? "bg-[#182030]/80" : ""}`}>
                                                        <div className="flex items-center justify-center gap-0.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleStagedLeg(row.strike, "PE", "BUY", row.put.price)}
                                                                className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase transition cursor-pointer ${
                                                                    putLeg && putLeg.action === "BUY"
                                                                        ? "bg-emerald-500 text-black ring-1 ring-emerald-300 font-black"
                                                                        : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600 hover:text-white border border-emerald-500/30"
                                                                }`}
                                                            >
                                                                B
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleStagedLeg(row.strike, "PE", "SELL", row.put.price)}
                                                                className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase transition cursor-pointer ${
                                                                    putLeg && putLeg.action === "SELL"
                                                                        ? "bg-rose-500 text-white ring-1 ring-rose-300 font-black"
                                                                        : "bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white border border-rose-500/30"
                                                                }`}
                                                            >
                                                                S
                                                            </button>
                                                        </div>
                                                    </td>

                                                    {/* Put Price */}
                                                    <td className={`py-1.5 px-2 text-left font-bold ${row.isPutItm ? "bg-[#182030]/80 text-gray-100" : "text-gray-200"}`}>
                                                        ${formatCryptoPrice(row.put.price, 2)}
                                                    </td>

                                                    {/* Put Delta */}
                                                    <td className={`py-1.5 px-2 text-right ${row.isPutItm ? "bg-[#182030]/80 text-gray-300" : "text-gray-400"}`}>
                                                        {formatDelta(row.put.delta)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Payoff Matrix & Strategy Workbench (flex-1 min-w-0 flex flex-col gap-3.5) */}
                    <div className={`flex-1 min-w-0 flex flex-col gap-3.5 ${mobileView !== "all" && mobileView !== "payoff" && mobileView !== "positions" ? "hidden lg:flex" : ""}`}>
                        
                        {/* 1. Metrics Ribbon in Same Row */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                            <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-2.5 shadow-xs">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">Max Profit</div>
                                <div className="text-sm sm:text-base font-black text-emerald-400 font-mono mt-0.5 truncate">
                                    {portfolioSummary.maxProfit === Infinity
                                        ? "Unlimited"
                                        : `$${formatCryptoPrice(portfolioSummary.maxProfit, 2)}`}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-2.5 shadow-xs">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">Max Loss</div>
                                <div className="text-sm sm:text-base font-black text-rose-400 font-mono mt-0.5 truncate">
                                    {portfolioSummary.maxLoss === -Infinity
                                        ? "Unlimited"
                                        : `$${formatCryptoPrice(Math.abs(portfolioSummary.maxLoss), 2)}`}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-2.5 shadow-xs">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">POP (Win Prob)</div>
                                <div className="text-sm sm:text-base font-black text-amber-400 font-mono mt-0.5">
                                    {portfolioSummary.pop}%
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-2.5 shadow-xs">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">Net Delta</div>
                                <div className="text-sm sm:text-base font-black text-white font-mono mt-0.5">
                                    {formatDelta(portfolioSummary.netDelta)}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-2.5 shadow-xs">
                                <div className="text-[10px] font-bold text-gray-400 uppercase">Theta ($/day)</div>
                                <div
                                    className={`text-sm sm:text-base font-black font-mono mt-0.5 ${
                                        portfolioSummary.netTheta >= 0 ? "text-emerald-400" : "text-rose-400"
                                    }`}
                                >
                                    {portfolioSummary.netTheta >= 0 ? "+" : ""}${formatCryptoPrice(portfolioSummary.netTheta, 2)}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-2.5 shadow-xs">
                                <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase">
                                    <span>Est. Margin</span>
                                    {portfolioSummary.marginBenefit > 0 && (
                                        <span className="text-[9px] text-emerald-400 font-mono font-black" title="Portfolio margin hedge benefit">
                                            -${formatCryptoPrice(portfolioSummary.marginBenefit, 0)}
                                        </span>
                                    )}
                                </div>
                                <div className="text-sm sm:text-base font-black text-blue-400 font-mono mt-0.5 truncate">
                                    ${formatCryptoPrice(portfolioSummary.estMargin, 2)}
                                </div>
                            </div>
                        </div>

                        {/* 2. Interactive Payoff Matrix Chart */}
                        <div className="rounded-2xl border border-gray-800 bg-[#0c121e] p-3.5 sm:p-4 shadow-md space-y-3">
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                                <div>
                                    <h3 className="text-xs sm:text-sm font-black text-white flex items-center gap-2">
                                        <span>Interactive Payoff Chart</span>
                                        <span className="text-[11px] text-gray-400 font-normal hidden sm:inline">
                                            (Green: Expiry, Blue: Target Date MTM)
                                        </span>
                                    </h3>
                                    {portfolioSummary.breakevens.length > 0 && (
                                        <div className="text-[11px] text-amber-300 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                                            <span>BE:</span>
                                            {portfolioSummary.breakevens.map((be) => (
                                                <span key={be} className="bg-amber-500/20 px-1 py-0.2 rounded border border-amber-500/30 text-[10px]">
                                                    ${be}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Controls */}
                                <div className="flex flex-wrap items-center gap-3 text-xs bg-[#101726] px-2.5 py-1.5 rounded-xl border border-gray-800">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-400 text-[11px]">Target:</span>
                                        <input
                                            type="range"
                                            min="0"
                                            max={currentExpiry?.daysLeft || 7}
                                            value={targetDaysAhead}
                                            onChange={(e) => setTargetDaysAhead(Number(e.target.value))}
                                            className="w-16 accent-blue-500 cursor-pointer"
                                        />
                                        <span className="font-bold font-mono text-blue-400 text-[11px]">+{targetDaysAhead}d</span>
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-400 text-[11px]">IV:</span>
                                        <input
                                            type="range"
                                            min="-30"
                                            max="30"
                                            value={ivShockPct}
                                            onChange={(e) => setIvShockPct(Number(e.target.value))}
                                            className="w-16 accent-amber-500 cursor-pointer"
                                        />
                                        <span className="font-bold font-mono text-amber-400 text-[11px]">
                                            {ivShockPct >= 0 ? "+" : ""}{ivShockPct}%
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-1 border-l border-gray-700/60 pl-2">
                                        {[10, 20, 35].map((r) => (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => setChartRangePct(r)}
                                                className={`px-1.5 py-0.2 rounded text-[9px] font-bold cursor-pointer transition ${
                                                    chartRangePct === r
                                                        ? "bg-amber-500 text-black font-black"
                                                        : "bg-gray-800 text-gray-400 hover:text-white"
                                                }`}
                                            >
                                                ±{r}%
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="h-64 sm:h-72 w-full">
                                {combinedLegsForAnalysis.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-xs text-gray-500 border border-dashed border-gray-800/80 rounded-xl bg-[#090d16]/60 p-4 text-center">
                                        <FiBarChart2 size={28} className="text-gray-600 mb-1.5" />
                                        <span>Click <strong className="text-emerald-400 font-bold">B</strong> or <strong className="text-rose-400 font-bold">S</strong> on any strike in the left table to construct strategy payoff curve.</span>
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={portfolioSummary.curve}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#1c2538" />
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
                                                    backgroundColor: "#0d1527",
                                                    border: "1px solid #334155",
                                                    borderRadius: "10px",
                                                    fontSize: "11px",
                                                }}
                                                formatter={(val) => [`$${formatCryptoPrice(val, 2)}`, ""]}
                                                labelFormatter={(p) => `Spot: $${p}`}
                                            />
                                            <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
                                            <ReferenceLine
                                                x={liveSpot}
                                                stroke="#f59e0b"
                                                strokeDasharray="4 4"
                                                strokeWidth={1.5}
                                                label={{
                                                    value: `Spot $${Math.round(liveSpot)}`,
                                                    position: "top",
                                                    fill: "#f59e0b",
                                                    fontSize: 10,
                                                    fontWeight: "bold",
                                                }}
                                            />
                                            {portfolioSummary.breakevens.map((be) => (
                                                <ReferenceLine
                                                    key={be}
                                                    x={be}
                                                    stroke="#38bdf8"
                                                    strokeDasharray="2 2"
                                                    label={{
                                                        value: `BE $${be}`,
                                                        position: "bottom",
                                                        fill: "#38bdf8",
                                                        fontSize: 9,
                                                    }}
                                                />
                                            ))}
                                            <Line
                                                type="monotone"
                                                dataKey="pnl"
                                                name="Expiry P&L"
                                                stroke="#10b981"
                                                strokeWidth={2.2}
                                                dot={false}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="targetPnl"
                                                name="Target Date P&L"
                                                stroke="#3b82f6"
                                                strokeWidth={1.8}
                                                strokeDasharray="4 4"
                                                dot={false}
                                            />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>

                        {/* 3. Positions Management System: Upcoming (Draft) vs Active (Executed) */}
                        <div className="rounded-2xl border border-gray-800 bg-[#0c121e] overflow-hidden shadow-md">
                            {/* Header Tabs */}
                            <div className="p-2.5 sm:p-3 border-b border-gray-800 flex flex-wrap items-center justify-between gap-2 bg-[#0f1424]">
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setActivePositionsTab("upcoming")}
                                        className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black transition cursor-pointer ${
                                            activePositionsTab === "upcoming"
                                                ? "bg-amber-500 text-black shadow-md shadow-amber-500/20"
                                                : "bg-gray-800 text-gray-400 hover:text-white"
                                        }`}
                                    >
                                        <FiLayers size={13} />
                                        <span>Upcoming Staged ({stagedLegs.length})</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setActivePositionsTab("active")}
                                        className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black transition cursor-pointer ${
                                            activePositionsTab === "active"
                                                ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                                                : "bg-gray-800 text-gray-400 hover:text-white"
                                        }`}
                                    >
                                        <FiActivity size={13} />
                                        <span>Active Live ({activePositions.length})</span>
                                    </button>
                                </div>

                                {activePositionsTab === "upcoming" ? (
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={handleExecuteStagedToPaper}
                                            disabled={stagedLegs.length === 0}
                                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs disabled:opacity-40 transition cursor-pointer"
                                        >
                                            Execute to Paper
                                        </button>
                                        {stagedLegs.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleClearLegs}
                                                className="text-xs font-bold text-rose-400 hover:text-rose-300 transition cursor-pointer"
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2.5">
                                        <label className="flex items-center gap-1.5 text-[11px] text-gray-300 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={includeActiveInPayoff}
                                                onChange={(e) => setIncludeActiveInPayoff(e.target.checked)}
                                                className="rounded accent-emerald-500"
                                            />
                                            <span>Overlay on Chart</span>
                                        </label>
                                        <button
                                            type="button"
                                            onClick={loadActivePositions}
                                            className="p-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition cursor-pointer"
                                        >
                                            <FiRefreshCw size={11} className={loadingActivePositions ? "animate-spin" : ""} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Upcoming Staged Positions Table */}
                            {activePositionsTab === "upcoming" && (
                                <div className="overflow-x-auto">
                                    {stagedLegs.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-gray-500">
                                            No upcoming positions staged. Click <strong className="text-emerald-400">B</strong> or <strong className="text-rose-400">S</strong> in the strikes chain to stage a leg.
                                        </div>
                                    ) : (
                                        <table className="w-full text-left text-xs font-mono">
                                            <thead className="bg-[#121929] border-b border-gray-800 text-gray-400 font-bold uppercase text-[9px]">
                                                <tr>
                                                    <th className="py-2 px-2.5 w-8 text-center">Inc</th>
                                                    <th className="py-2 px-2.5 w-16">Side</th>
                                                    <th className="py-2 px-2.5">Contract</th>
                                                    <th className="py-2 px-2.5">Expiry</th>
                                                    <th className="py-2 px-2.5 w-28">Lots</th>
                                                    <th className="py-2 px-2.5">Entry</th>
                                                    <th className="py-2 px-2.5">Live</th>
                                                    <th className="py-2 px-2.5">P&amp;L</th>
                                                    <th className="py-2 px-2.5 text-right">✕</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-800/60">
                                                {stagedLegs.map((leg) => {
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
                                                            <td className="py-2 px-2.5 text-center">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={leg.enabled !== false}
                                                                    onChange={(e) => handleUpdateLegField(leg.id, "enabled", e.target.checked)}
                                                                    className="rounded accent-amber-500 cursor-pointer"
                                                                />
                                                            </td>
                                                            <td className="py-2 px-2.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleUpdateLegField(leg.id, "action", leg.action === "BUY" ? "SELL" : "BUY")}
                                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase cursor-pointer transition ${
                                                                        leg.action === "BUY"
                                                                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                                                            : "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                                                    }`}
                                                                >
                                                                    {leg.action}
                                                                </button>
                                                            </td>
                                                            <td className="py-2 px-2.5 font-bold text-white">
                                                                {leg.strike} {leg.right}
                                                            </td>
                                                            <td className="py-2 px-2.5 text-gray-300 text-[11px]">
                                                                {leg.expiryLabel || leg.expiry}
                                                            </td>
                                                            <td className="py-2 px-2.5">
                                                                <div className="flex items-center gap-1">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleUpdateLots(leg.id, -1)}
                                                                        className="p-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer"
                                                                    >
                                                                        <FiMinus size={9} />
                                                                    </button>
                                                                    <span className="w-6 text-center font-bold text-white text-[11px]">{leg.lots}</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleUpdateLots(leg.id, 1)}
                                                                        className="p-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer"
                                                                    >
                                                                        <FiPlus size={9} />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                            <td className="py-2 px-2.5 text-gray-300 text-[11px]">
                                                                ${formatCryptoPrice(leg.entryPrice, 2)}
                                                            </td>
                                                            <td className="py-2 px-2.5 text-white font-bold text-[11px]">
                                                                ${formatCryptoPrice(livePrice, 2)}
                                                            </td>
                                                            <td className="py-2 px-2.5 font-black text-[11px]">
                                                                <span className={pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                                                    {pnl >= 0 ? "+" : ""}${formatCryptoPrice(pnl, 2)}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 px-2.5 text-right">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleRemoveLeg(leg.id)}
                                                                    className="text-gray-400 hover:text-rose-400 p-0.5 cursor-pointer transition"
                                                                >
                                                                    <FiTrash2 size={12} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            )}

                            {/* Active Executed Positions Table */}
                            {activePositionsTab === "active" && (
                                <div className="overflow-x-auto">
                                    {activePositions.length === 0 ? (
                                        <div className="p-6 text-center text-xs text-gray-500">
                                            No open live paper positions found for {selectedAsset.symbol}.
                                        </div>
                                    ) : (
                                        <table className="w-full text-left text-xs font-mono">
                                            <thead className="bg-[#121929] border-b border-gray-800 text-gray-400 font-bold uppercase text-[9px]">
                                                <tr>
                                                    <th className="py-2 px-2.5">Side</th>
                                                    <th className="py-2 px-2.5">Contract</th>
                                                    <th className="py-2 px-2.5">Expiry</th>
                                                    <th className="py-2 px-2.5">Lots</th>
                                                    <th className="py-2 px-2.5">Entry</th>
                                                    <th className="py-2 px-2.5">Live</th>
                                                    <th className="py-2 px-2.5">P&amp;L</th>
                                                    <th className="py-2 px-2.5 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-800/60">
                                                {activePositions.map((pos) => {
                                                    const row = optionChainRows.find((r) => r.strike === Number(pos.strike));
                                                    const livePrice = row
                                                        ? pos.opt_right === "CE"
                                                            ? row.call.price
                                                            : row.put.price
                                                        : Number(pos.entry_price);
                                                    const mult = pos.side === "long" ? 1 : -1;
                                                    const pnl = (livePrice - Number(pos.entry_price)) * mult * Number(pos.lots || 1);

                                                    return (
                                                        <tr key={pos.id} className="hover:bg-gray-800/40 transition">
                                                            <td className="py-2 px-2.5">
                                                                <span
                                                                    className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                                                                        pos.side === "long"
                                                                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                                                            : "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                                                                    }`}
                                                                >
                                                                    {pos.side === "long" ? "BUY" : "SELL"}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 px-2.5 font-bold text-white">
                                                                {pos.strike} {pos.opt_right}
                                                            </td>
                                                            <td className="py-2 px-2.5 text-gray-300 text-[11px]">
                                                                {pos.expiry}
                                                            </td>
                                                            <td className="py-2 px-2.5 font-bold text-white text-[11px]">
                                                                {pos.lots}
                                                            </td>
                                                            <td className="py-2 px-2.5 text-gray-300 text-[11px]">
                                                                ${formatCryptoPrice(pos.entry_price, 2)}
                                                            </td>
                                                            <td className="py-2 px-2.5 text-white font-bold text-[11px]">
                                                                ${formatCryptoPrice(livePrice, 2)}
                                                            </td>
                                                            <td className="py-2 px-2.5 font-black text-[11px]">
                                                                <span className={pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                                                    {pnl >= 0 ? "+" : ""}${formatCryptoPrice(pnl, 2)}
                                                                </span>
                                                            </td>
                                                            <td className="py-2 px-2.5 text-right">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCloseActivePosition(pos.id)}
                                                                    className="px-2 py-0.5 rounded bg-rose-600/20 border border-rose-500/30 text-rose-400 hover:bg-rose-600 hover:text-white text-[10px] font-bold transition cursor-pointer"
                                                                >
                                                                    Exit
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Presets Modal */}
            {showPresetsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                    <div className="w-full max-w-xl rounded-3xl border border-amber-500/30 bg-[#0f172a] p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-white flex items-center gap-2">
                                <FiZap size={18} className="text-amber-400" />
                                <span>Institutional Crypto Strategy Presets</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowPresetsModal(false)}
                                className="text-gray-400 hover:text-white cursor-pointer"
                            >
                                <FiX size={18} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-400">
                            Deploy tested option strategy structures for {selectedAsset.symbol} with 1 click:
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                            {[
                                {
                                    name: "Bull Call Spread",
                                    desc: "Buy ATM Call + Sell OTM Call",
                                    badge: "Bullish",
                                    action: () => {
                                        const step = selectedAsset.strikeStep;
                                        const atm = Math.round(liveSpot / step) * step;
                                        const rBuy = optionChainRows.find((r) => r.strike === atm);
                                        const rSell = optionChainRows.find((r) => r.strike === atm + step * 2);
                                        if (!rBuy || !rSell || !currentExpiry) return;
                                        setStagedLegs([
                                            { id: `leg-b-${Date.now()}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm, right: "CE", action: "BUY", lots: selectedAsset.lotSize, entryPrice: rBuy.call.price, currentPrice: rBuy.call.price, iv: 45 },
                                            { id: `leg-s-${Date.now() + 1}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm + step * 2, right: "CE", action: "SELL", lots: selectedAsset.lotSize, entryPrice: rSell.call.price, currentPrice: rSell.call.price, iv: 45 },
                                        ]);
                                        setShowPresetsModal(false);
                                    },
                                },
                                {
                                    name: "Bear Put Spread",
                                    desc: "Buy ATM Put + Sell OTM Put",
                                    badge: "Bearish",
                                    action: () => {
                                        const step = selectedAsset.strikeStep;
                                        const atm = Math.round(liveSpot / step) * step;
                                        const rBuy = optionChainRows.find((r) => r.strike === atm);
                                        const rSell = optionChainRows.find((r) => r.strike === atm - step * 2);
                                        if (!rBuy || !rSell || !currentExpiry) return;
                                        setStagedLegs([
                                            { id: `leg-b-${Date.now()}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm, right: "PE", action: "BUY", lots: selectedAsset.lotSize, entryPrice: rBuy.put.price, currentPrice: rBuy.put.price, iv: 45 },
                                            { id: `leg-s-${Date.now() + 1}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm - step * 2, right: "PE", action: "SELL", lots: selectedAsset.lotSize, entryPrice: rSell.put.price, currentPrice: rSell.put.price, iv: 45 },
                                        ]);
                                        setShowPresetsModal(false);
                                    },
                                },
                                {
                                    name: "Short Straddle",
                                    desc: "Sell ATM Call + Sell ATM Put",
                                    badge: "Rangebound",
                                    action: () => {
                                        const step = selectedAsset.strikeStep;
                                        const atm = Math.round(liveSpot / step) * step;
                                        const row = optionChainRows.find((r) => r.strike === atm);
                                        if (!row || !currentExpiry) return;
                                        setStagedLegs([
                                            { id: `leg-ce-${Date.now()}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm, right: "CE", action: "SELL", lots: selectedAsset.lotSize, entryPrice: row.call.price, currentPrice: row.call.price, iv: 45 },
                                            { id: `leg-pe-${Date.now() + 1}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm, right: "PE", action: "SELL", lots: selectedAsset.lotSize, entryPrice: row.put.price, currentPrice: row.put.price, iv: 45 },
                                        ]);
                                        setShowPresetsModal(false);
                                    },
                                },
                                {
                                    name: "Iron Condor",
                                    desc: "Delta-Neutral 4-Leg Defined Risk Wing",
                                    badge: "Neutral",
                                    action: () => {
                                        const step = selectedAsset.strikeStep;
                                        const atm = Math.round(liveSpot / step) * step;
                                        const r1 = optionChainRows.find((r) => r.strike === atm - step * 3);
                                        const r2 = optionChainRows.find((r) => r.strike === atm - step);
                                        const r3 = optionChainRows.find((r) => r.strike === atm + step);
                                        const r4 = optionChainRows.find((r) => r.strike === atm + step * 3);
                                        if (!r1 || !r2 || !r3 || !r4 || !currentExpiry) return;
                                        setStagedLegs([
                                            { id: `leg-1-${Date.now()}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm - step * 3, right: "PE", action: "BUY", lots: selectedAsset.lotSize, entryPrice: r1.put.price, currentPrice: r1.put.price, iv: 45 },
                                            { id: `leg-2-${Date.now() + 1}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm - step, right: "PE", action: "SELL", lots: selectedAsset.lotSize, entryPrice: r2.put.price, currentPrice: r2.put.price, iv: 45 },
                                            { id: `leg-3-${Date.now() + 2}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm + step, right: "CE", action: "SELL", lots: selectedAsset.lotSize, entryPrice: r3.call.price, currentPrice: r3.call.price, iv: 45 },
                                            { id: `leg-4-${Date.now() + 3}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm + step * 3, right: "CE", action: "BUY", lots: selectedAsset.lotSize, entryPrice: r4.call.price, currentPrice: r4.call.price, iv: 45 },
                                        ]);
                                        setShowPresetsModal(false);
                                    },
                                },
                                {
                                    name: "Long Straddle",
                                    desc: "Buy ATM Call + Buy ATM Put",
                                    badge: "High Volatility",
                                    action: () => {
                                        const step = selectedAsset.strikeStep;
                                        const atm = Math.round(liveSpot / step) * step;
                                        const row = optionChainRows.find((r) => r.strike === atm);
                                        if (!row || !currentExpiry) return;
                                        setStagedLegs([
                                            { id: `leg-ce-${Date.now()}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm, right: "CE", action: "BUY", lots: selectedAsset.lotSize, entryPrice: row.call.price, currentPrice: row.call.price, iv: 45 },
                                            { id: `leg-pe-${Date.now() + 1}`, enabled: true, symbol: selectedAsset.symbol, expiry: currentExpiry.iso, expiryLabel: currentExpiry.label, daysLeft: currentExpiry.daysLeft, strike: atm, right: "PE", action: "BUY", lots: selectedAsset.lotSize, entryPrice: row.put.price, currentPrice: row.put.price, iv: 45 },
                                        ]);
                                        setShowPresetsModal(false);
                                    },
                                },
                            ].map((preset, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={preset.action}
                                    className="text-left rounded-2xl border border-gray-800 bg-[#0c121e] p-3 hover:border-amber-500/50 hover:bg-amber-950/20 transition cursor-pointer space-y-0.5"
                                >
                                    <div className="flex items-center justify-between">
                                        <span className="font-bold text-white text-xs">{preset.name}</span>
                                        <span className="text-[9px] font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded">
                                            {preset.badge}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-gray-400">{preset.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Save Strategy Modal */}
            {showSaveModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
                    <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-[#0f172a] p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-white flex items-center gap-2">
                                <FiSave size={18} className="text-emerald-400" />
                                <span>Save Strategy Template</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setShowSaveModal(false)}
                                className="text-gray-400 hover:text-white cursor-pointer"
                            >
                                <FiX size={18} />
                            </button>
                        </div>
                        <p className="text-xs text-gray-400">
                            Save this {selectedAsset.symbol} strategy with {stagedLegs.length} configured legs to your account for future re-use:
                        </p>

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-300">Strategy Name</label>
                            <input
                                type="text"
                                value={strategyNameInput}
                                onChange={(e) => setStrategyNameInput(e.target.value)}
                                placeholder="e.g. BTC Bullish Condor"
                                className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowSaveModal(false)}
                                className="px-3 py-1.5 rounded-xl text-xs font-bold text-gray-400 hover:text-white cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveStrategy}
                                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md transition cursor-pointer"
                            >
                                Save Strategy
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
