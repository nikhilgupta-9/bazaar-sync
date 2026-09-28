// pages/PaperTrade.jsx — Commercial Live Paper Trading & Hedging Workstation
// Model: 2-Day Free Trial (₹1,00,000 Virtual Money) -> Pro Membership ₹499/mo (₹5,00,000 Virtual Money)
// Refill: +₹5,00,000 Virtual Capital for ₹100 via Razorpay.
// Live WebSocket Tick Streaming across 7 Indices & 210+ Stocks, instant Hedging with margin discounts.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useOptionChain } from "../hooks/useOptionChain";
import {
    fetchWallet,
    createRefillOrder,
    verifyRefillPayment,
    fetchPositions,
    openStrategyTrade,
    closePosition,
    closeAllPositions,
} from "../services/paperTradeApi";
import { createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";
import { formatRupees, formatPrice, formatOi, formatDateTime } from "../utils/format";
import {
    computePayoffCurve,
    computeBreakevens,
    computeMaxProfitLoss,
    computeRiskRewardRatio,
    computeNetGreeks,
    addMarkToMarketCurve,
    computeExpectedMove,
    computePOP,
    computeMarginDetails,
    evaluationExpiryOf,
} from "../utils/payoff";
import { yearsToExpiry } from "../utils/blackScholes";
import PayoffChart from "../components/PayoffChart";
import PresetStrategies from "../components/PresetStrategies";
import { fetchSymbolList } from "../services/optionChainApi";
import {
    FiLayers,
    FiSearch,
    FiChevronDown,
    FiCheck,
    FiTrash2,
    FiPlusCircle,
    FiAward,
    FiShield,
    FiTrendingUp,
    FiTrendingDown,
    FiRefreshCw,
    FiCheckCircle,
    FiAlertCircle,
    FiZap,
    FiBarChart2,
} from "react-icons/fi";

const FALLBACK_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const STRIKE_RANGES = [
    { label: "±10", value: 10 },
    { label: "±20", value: 20 },
    { label: "±50", value: 50 },
    { label: "All", value: null },
];

const GUEST_WALLET_KEY = "bazaar_sync_guest_wallet";
const GUEST_POSITIONS_KEY = "bazaar_sync_guest_positions";
const GUEST_CLOSED_KEY = "bazaar_sync_guest_closed";

function loadGuestWallet() {
    try {
        const raw = localStorage.getItem(GUEST_WALLET_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return { balance: 100000, margin_utilized: 0 }; // 1 Lakh initial trial balance
}

function saveGuestWallet(w) {
    try {
        localStorage.setItem(GUEST_WALLET_KEY, JSON.stringify(w));
    } catch {}
}

function loadGuestPositions() {
    try {
        const raw = localStorage.getItem(GUEST_POSITIONS_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return [];
}

function saveGuestPositions(p) {
    try {
        localStorage.setItem(GUEST_POSITIONS_KEY, JSON.stringify(p));
    } catch {}
}

function loadGuestClosed() {
    try {
        const raw = localStorage.getItem(GUEST_CLOSED_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return [];
}

function saveGuestClosed(c) {
    try {
        localStorage.setItem(GUEST_CLOSED_KEY, JSON.stringify(c));
    } catch {}
}

function formatExpiryShort(sqlDate) {
    if (!sqlDate) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const parts = sqlDate.split("-");
    if (parts.length < 3) return sqlDate;
    const [, m, d] = parts.map(Number);
    return `${d} ${months[m - 1] || ""}`;
}

let legIdCounter = Date.now();

export default function PaperTrade() {
    const { token, user, isPro, refreshUser } = useAuth();

    // 1. Live Option Chain with WebSocket Streaming
    const {
        symbol,
        setSymbol,
        data: chainData,
        loading: chainLoading,
        error: chainError,
        load: changeExpiry,
        marketStatus,
        isLive,
        lastUpdated,
    } = useOptionChain("NIFTY");

    // 2. Universe of 7 Indices & 210+ Stocks
    const [symbolList, setSymbolList] = useState({ indices: FALLBACK_INDICES, stocks: [] });
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [strikeRange, setStrikeRange] = useState(15);
    const [activeTab, setActiveTab] = useState("trade"); // 'trade' | 'positions' | 'history'
    const [mobileSide, setMobileSide] = useState("both"); // 'both' | 'calls' | 'puts'
    const [mobileTradeTab, setMobileTradeTab] = useState("chain"); // 'chain' | 'payoff' (for mobile screen toggle)
    const [basketViewMode, setBasketViewMode] = useState("split"); // 'split' | 'chart' | 'legs'
    const [showPositionsPayoff, setShowPositionsPayoff] = useState(false);

    // Modals
    const [refillModalOpen, setRefillModalOpen] = useState(false);
    const [proModalOpen, setProModalOpen] = useState(false);
    const [paymentLoading, setPaymentLoading] = useState(false);

    // Fetch symbol list
    useEffect(() => {
        let cancelled = false;
        fetchSymbolList()
            .then((res) => {
                if (!cancelled && res) {
                    setSymbolList({
                        indices: res.indices?.length ? res.indices : FALLBACK_INDICES,
                        stocks: res.stocks || [],
                    });
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const filteredIndices = useMemo(
        () => symbolList.indices.filter((s) => s.toLowerCase().includes(searchQuery.toLowerCase())),
        [symbolList, searchQuery]
    );
    const filteredStocks = useMemo(
        () => symbolList.stocks.filter((s) => s.toLowerCase().includes(searchQuery.toLowerCase())),
        [symbolList, searchQuery]
    );

    // 3. Wallet & Positions State
    const [wallet, setWallet] = useState(null);
    const [openPositions, setOpenPositions] = useState([]);
    const [closedPositions, setClosedPositions] = useState([]);
    const [feedback, setFeedback] = useState(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [closingId, setClosingId] = useState(null);
    const [closingAll, setClosingAll] = useState(false);

    // Refresh wallet
    const loadWallet = useCallback(async () => {
        if (token) {
            try {
                const res = await fetchWallet(token);
                setWallet(res.wallet);
            } catch (err) {
                console.error("[PaperTrade] loadWallet failed:", err);
            }
        } else {
            setWallet(loadGuestWallet());
        }
    }, [token]);

    // Refresh positions
    const loadPositions = useCallback(async () => {
        if (token) {
            try {
                const [openRes, closedRes] = await Promise.all([
                    fetchPositions(token, "open"),
                    fetchPositions(token, "closed"),
                ]);
                setOpenPositions(openRes.positions || []);
                setClosedPositions(closedRes.positions || []);
            } catch (err) {
                console.error("[PaperTrade] loadPositions failed:", err);
            }
        } else {
            const guestOpens = loadGuestPositions();
            const guestClosed = loadGuestClosed();

            const updatedOpens = guestOpens.map((pos) => {
                let liveLtp = pos.entry_price;
                if (chainData && chainData.symbol === pos.symbol && chainData.rows) {
                    const row = chainData.rows.find((r) => Number(r.strike) === Number(pos.strike));
                    if (row) {
                        const side = pos.option_type === "CE" ? row.ce : row.pe;
                        if (side && side.ltp != null) liveLtp = Number(side.ltp);
                    }
                }
                const totalShares = pos.lots * pos.lot_size;
                const diff = pos.side === "long" ? liveLtp - pos.entry_price : pos.entry_price - liveLtp;
                const unrealizedPnl = diff * totalShares;
                return {
                    ...pos,
                    current_price: liveLtp,
                    unrealizedPnl,
                };
            });
            setOpenPositions(updatedOpens);
            setClosedPositions(guestClosed);
        }
    }, [token, chainData]);

    useEffect(() => {
        loadWallet();
        loadPositions();
    }, [token, loadWallet, loadPositions]);

    // Live MTM poll every 5s
    useEffect(() => {
        const timer = setInterval(() => {
            loadPositions();
            loadWallet();
        }, 5000);
        return () => clearInterval(timer);
    }, [loadPositions, loadWallet]);

    // Derived Market Values
    const spotPrice = chainData?.spotPrice ? Number(chainData.spotPrice) : null;
    const atmStrike = chainData?.atmStrike ? Number(chainData.atmStrike) : null;
    const lotSize = chainData?.lotSize ? Number(chainData.lotSize) : 50;

    // Display rows based on strike range around ATM
    const displayRows = useMemo(() => {
        const rows = chainData?.rows || [];
        if (!rows.length || strikeRange == null || atmStrike == null) return rows;
        const atmIndex = rows.findIndex((r) => Number(r.strike) === Number(atmStrike));
        if (atmIndex === -1) return rows;
        const start = Math.max(0, atmIndex - strikeRange);
        const end = Math.min(rows.length, atmIndex + strikeRange + 1);
        return rows.slice(start, end);
    }, [chainData, strikeRange, atmStrike]);

    // 4. Live Hedge / Strategy Basket
    const [basketLegs, setBasketLegs] = useState([]);
    const [showPresetsModal, setShowPresetsModal] = useState(false);

    function handleToggleLeg(row, right, action) {
        const side = right === "CE" ? row.ce : row.pe;
        if (!side || side.ltp == null) return;
        const strikeNum = Number(row.strike);

        const existingIdx = basketLegs.findIndex((l) => l.strike === strikeNum && l.type === right);
        if (existingIdx >= 0) {
            const existing = basketLegs[existingIdx];
            if (existing.action === action) {
                setBasketLegs((prev) => prev.filter((_, i) => i !== existingIdx));
                return;
            } else {
                setBasketLegs((prev) =>
                    prev.map((l, i) =>
                        i === existingIdx ? { ...l, action, premium: Number(side.ltp) } : l
                    )
                );
                return;
            }
        }

        const newLeg = {
            id: ++legIdCounter,
            action,
            type: right,
            strike: strikeNum,
            premium: Number(side.ltp),
            qty: 1,
            lotSize,
            iv: side.iv ? Number(side.iv) : null,
            delta: side.delta ? Number(side.delta) : null,
            expiry: chainData?.selectedExpiry,
        };
        setBasketLegs((prev) => [...prev, newLeg]);
    }

    function removeBasketLeg(id) {
        setBasketLegs((prev) => prev.filter((l) => l.id !== id));
    }

    function updateBasketLegLots(id, delta) {
        setBasketLegs((prev) =>
            prev.map((l) => (l.id === id ? { ...l, qty: Math.max(1, l.qty + delta) } : l))
        );
    }

    function rollBasketLegStrike(id, direction) {
        if (!chainData?.rows?.length) return;
        const sorted = [...chainData.rows].sort((a, b) => Number(a.strike) - Number(b.strike));
        setBasketLegs((prev) =>
            prev.map((leg) => {
                if (leg.id !== id) return leg;
                const idx = sorted.findIndex((r) => Number(r.strike) === Number(leg.strike));
                if (idx === -1) return leg;
                const nextRow = sorted[idx + direction];
                if (!nextRow) return leg;
                const side = leg.type === "CE" ? nextRow.ce : nextRow.pe;
                return {
                    ...leg,
                    strike: Number(nextRow.strike),
                    premium: Number(side?.ltp ?? leg.premium),
                    iv: side?.iv != null ? Number(side.iv) : leg.iv,
                    delta: side?.delta != null ? Number(side.delta) : leg.delta,
                };
            })
        );
    }

    function toggleBasketLegAction(id) {
        setBasketLegs((prev) =>
            prev.map((leg) =>
                leg.id === id
                    ? { ...leg, action: leg.action === "buy" ? "sell" : "buy" }
                    : leg
            )
        );
    }

    function applyFullPreset(presetLegs) {
        if (!Array.isArray(presetLegs) || !presetLegs.length) return;
        const formatted = presetLegs.map((l, idx) => ({
            id: ++legIdCounter + idx,
            action: l.action || "buy",
            type: l.type || "CE",
            strike: Number(l.strike),
            premium: Number(l.premium || 0),
            qty: Number(l.qty || 1),
            lotSize: Number(l.lotSize || lotSize),
            expiry: l.expiry || chainData?.selectedExpiry,
            iv: l.iv ? Number(l.iv) : null,
            delta: l.delta ? Number(l.delta) : null,
        }));
        setBasketLegs(formatted);
        setShowPresetsModal(false);
    }

    function applyPresetHedge(type) {
        if (!chainData?.rows?.length || !atmStrike) return;
        const strikes = chainData.rows.map((r) => Number(r.strike)).sort((a, b) => a - b);
        const atmIdx = strikes.indexOf(atmStrike);
        if (atmIdx === -1) return;

        const getRow = (idx) => {
            const s = strikes[Math.max(0, Math.min(strikes.length - 1, idx))];
            return chainData.rows.find((r) => Number(r.strike) === s);
        };

        let newLegs = [];
        const expiry = chainData.selectedExpiry;

        if (type === "BULL_CALL_SPREAD") {
            const atmRow = getRow(atmIdx);
            const otmRow = getRow(atmIdx + 2);
            if (atmRow && otmRow) {
                newLegs = [
                    { id: ++legIdCounter, action: "buy", type: "CE", strike: Number(atmRow.strike), premium: Number(atmRow.ce?.ltp || 0), qty: 1, lotSize, expiry },
                    { id: ++legIdCounter, action: "sell", type: "CE", strike: Number(otmRow.strike), premium: Number(otmRow.ce?.ltp || 0), qty: 1, lotSize, expiry },
                ];
            }
        } else if (type === "BEAR_PUT_SPREAD") {
            const atmRow = getRow(atmIdx);
            const otmRow = getRow(atmIdx - 2);
            if (atmRow && otmRow) {
                newLegs = [
                    { id: ++legIdCounter, action: "buy", type: "PE", strike: Number(atmRow.strike), premium: Number(atmRow.pe?.ltp || 0), qty: 1, lotSize, expiry },
                    { id: ++legIdCounter, action: "sell", type: "PE", strike: Number(otmRow.strike), premium: Number(otmRow.pe?.ltp || 0), qty: 1, lotSize, expiry },
                ];
            }
        } else if (type === "IRON_CONDOR") {
            const pBuy = getRow(atmIdx - 4);
            const pSell = getRow(atmIdx - 2);
            const cSell = getRow(atmIdx + 2);
            const cBuy = getRow(atmIdx + 4);
            if (pBuy && pSell && cSell && cBuy) {
                newLegs = [
                    { id: ++legIdCounter, action: "buy", type: "PE", strike: Number(pBuy.strike), premium: Number(pBuy.pe?.ltp || 0), qty: 1, lotSize, expiry },
                    { id: ++legIdCounter, action: "sell", type: "PE", strike: Number(pSell.strike), premium: Number(pSell.pe?.ltp || 0), qty: 1, lotSize, expiry },
                    { id: ++legIdCounter, action: "sell", type: "CE", strike: Number(cSell.strike), premium: Number(cSell.ce?.ltp || 0), qty: 1, lotSize, expiry },
                    { id: ++legIdCounter, action: "buy", type: "CE", strike: Number(cBuy.strike), premium: Number(cBuy.ce?.ltp || 0), qty: 1, lotSize, expiry },
                ];
            }
        } else if (type === "STRADDLE") {
            const atmRow = getRow(atmIdx);
            if (atmRow) {
                newLegs = [
                    { id: ++legIdCounter, action: "buy", type: "CE", strike: Number(atmRow.strike), premium: Number(atmRow.ce?.ltp || 0), qty: 1, lotSize, expiry },
                    { id: ++legIdCounter, action: "buy", type: "PE", strike: Number(atmRow.strike), premium: Number(atmRow.pe?.ltp || 0), qty: 1, lotSize, expiry },
                ];
            }
        } else if (type === "SHORT_STRANGLE") {
            const putRow = getRow(atmIdx - 2);
            const callRow = getRow(atmIdx + 2);
            if (putRow && callRow) {
                newLegs = [
                    { id: ++legIdCounter, action: "sell", type: "PE", strike: Number(putRow.strike), premium: Number(putRow.pe?.ltp || 0), qty: 1, lotSize, expiry },
                    { id: ++legIdCounter, action: "sell", type: "CE", strike: Number(callRow.strike), premium: Number(callRow.ce?.ltp || 0), qty: 1, lotSize, expiry },
                ];
            }
        }

        setBasketLegs(newLegs);
    }

    // 5. Full Strategy Payoff & Analytics Engine for Basket
    const payoffData = useMemo(() => {
        if (!basketLegs.length || !spotPrice) {
            return {
                curve: [],
                breakevens: [],
                maxProfit: null,
                maxLoss: null,
                riskReward: null,
                netGreeks: null,
                pop: null,
                expectedMove: null,
                fundsRequired: 0,
                marginBenefit: 0,
                isHedged: false,
                atmIv: null,
                yearsRemaining: null,
            };
        }

        try {
            const strikes = basketLegs.map((l) => l.strike).filter(Boolean);
            const minStrike = strikes.length ? Math.min(...strikes) : spotPrice;
            const maxStrike = strikes.length ? Math.max(...strikes) : spotPrice;
            const minPrice = Math.min(spotPrice * 0.90, minStrike * 0.95);
            const maxPrice = Math.max(spotPrice * 1.10, maxStrike * 1.05);

            let curveData = computePayoffCurve(basketLegs, { minPrice, maxPrice, steps: 120 }) || [];
            const breakEvs = computeBreakevens(curveData) || [];
            const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(basketLegs, curveData);
            const rReward = computeRiskRewardRatio(mxProf, mxLoss);
            const netGrks = computeNetGreeks(basketLegs);
            const marginCalc = computeMarginDetails(basketLegs, spotPrice, symbol);

            const evaluationExpiry = evaluationExpiryOf(basketLegs) || chainData?.selectedExpiry;
            const yearsRemaining = evaluationExpiry ? yearsToExpiry(evaluationExpiry) : null;
            const atmRow = chainData?.rows?.find((r) => Number(r.strike) === Number(atmStrike));
            const atmIv = atmRow?.ce?.iv ? Number(atmRow.ce.iv) : (atmRow?.pe?.iv ? Number(atmRow.pe.iv) : null);

            if (atmIv && yearsRemaining) {
                curveData = addMarkToMarketCurve(curveData, basketLegs, yearsRemaining, Date.now());
            }
            const expMv = (atmIv && yearsRemaining) ? computeExpectedMove(spotPrice, atmIv, yearsRemaining) : null;
            const popVal = (atmIv && yearsRemaining) ? computePOP(curveData, spotPrice, atmIv, yearsRemaining) : null;

            return {
                curve: curveData,
                breakevens: breakEvs,
                maxProfit: mxProf,
                maxLoss: mxLoss,
                riskReward: rReward,
                netGreeks: netGrks,
                pop: popVal,
                expectedMove: expMv,
                fundsRequired: marginCalc.fundsRequired,
                marginBenefit: marginCalc.marginBenefit,
                isHedged: marginCalc.isHedged,
                atmIv,
                yearsRemaining,
            };
        } catch (err) {
            console.error("[PaperTrade] payoff calculation error:", err);
            return {
                curve: [],
                breakevens: [],
                maxProfit: null,
                maxLoss: null,
                riskReward: null,
                netGreeks: null,
                pop: null,
                expectedMove: null,
                fundsRequired: 0,
                marginBenefit: 0,
                isHedged: false,
                atmIv: null,
                yearsRemaining: null,
            };
        }
    }, [basketLegs, spotPrice, symbol, chainData, atmStrike]);

    // Backward-compatible alias for execution logic
    const hedgeStats = payoffData;

    // 6. Payoff Analysis for Active Open Positions
    const openPositionLegs = useMemo(() => {
        return openPositions
            .filter((p) => p.symbol === symbol)
            .map((p) => ({
                id: p.id,
                action: p.side === "long" ? "buy" : "sell",
                type: p.option_type,
                strike: Number(p.strike),
                premium: Number(p.entry_price),
                qty: Number(p.lots) || 1,
                lotSize: Number(p.lot_size) || lotSize,
                expiry: p.expiry,
            }));
    }, [openPositions, symbol, lotSize]);

    const positionsPayoffData = useMemo(() => {
        if (!openPositionLegs.length || !spotPrice) {
            return {
                curve: [],
                breakevens: [],
                maxProfit: null,
                maxLoss: null,
                riskReward: null,
                netGreeks: null,
                pop: null,
                expectedMove: null,
                atmIv: null,
                yearsRemaining: null,
            };
        }

        try {
            const strikes = openPositionLegs.map((l) => l.strike).filter(Boolean);
            const minStrike = strikes.length ? Math.min(...strikes) : spotPrice;
            const maxStrike = strikes.length ? Math.max(...strikes) : spotPrice;
            const minPrice = Math.min(spotPrice * 0.90, minStrike * 0.95);
            const maxPrice = Math.max(spotPrice * 1.10, maxStrike * 1.05);

            let curveData = computePayoffCurve(openPositionLegs, { minPrice, maxPrice, steps: 120 }) || [];
            const breakEvs = computeBreakevens(curveData) || [];
            const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(openPositionLegs, curveData);
            const rReward = computeRiskRewardRatio(mxProf, mxLoss);
            const netGrks = computeNetGreeks(openPositionLegs);

            const evaluationExpiry = evaluationExpiryOf(openPositionLegs) || chainData?.selectedExpiry;
            const yearsRemaining = evaluationExpiry ? yearsToExpiry(evaluationExpiry) : null;
            const atmRow = chainData?.rows?.find((r) => Number(r.strike) === Number(atmStrike));
            const atmIv = atmRow?.ce?.iv ? Number(atmRow.ce.iv) : (atmRow?.pe?.iv ? Number(atmRow.pe.iv) : null);

            if (atmIv && yearsRemaining) {
                curveData = addMarkToMarketCurve(curveData, openPositionLegs, yearsRemaining, Date.now());
            }
            const expMv = (atmIv && yearsRemaining) ? computeExpectedMove(spotPrice, atmIv, yearsRemaining) : null;
            const popVal = (atmIv && yearsRemaining) ? computePOP(curveData, spotPrice, atmIv, yearsRemaining) : null;

            return {
                curve: curveData,
                breakevens: breakEvs,
                maxProfit: mxProf,
                maxLoss: mxLoss,
                riskReward: rReward,
                netGreeks: netGrks,
                pop: popVal,
                expectedMove: expMv,
                atmIv,
                yearsRemaining,
            };
        } catch (err) {
            console.error("[PaperTrade] positions payoff error:", err);
            return {
                curve: [],
                breakevens: [],
                maxProfit: null,
                maxLoss: null,
                riskReward: null,
                netGreeks: null,
                pop: null,
                expectedMove: null,
                atmIv: null,
                yearsRemaining: null,
            };
        }
    }, [openPositionLegs, spotPrice, chainData, atmStrike]);

    // Execute Live Paper Trade
    async function handleExecuteHedge() {
        if (!basketLegs.length) return;

        const currentBalance = wallet ? Number(wallet.balance) : 100000;
        if (currentBalance < hedgeStats.fundsRequired) {
            setFeedback({
                type: "error",
                text: `Insufficient Virtual Cash. Required: ${formatRupees(hedgeStats.fundsRequired)}, Available: ${formatRupees(currentBalance)}. Refill +₹5,00,000 for ₹100 below.`,
            });
            setRefillModalOpen(true);
            return;
        }

        try {
            setIsExecuting(true);
            setFeedback(null);

            const title =
                basketLegs.length === 1
                    ? `${symbol} ${basketLegs[0].strike} ${basketLegs[0].type}`
                    : `${symbol} Hedge Basket (${basketLegs.length} Legs)`;

            if (token) {
                await openStrategyTrade(token, {
                    symbol,
                    expiry: chainData?.selectedExpiry,
                    strategy_name: title,
                    legs: basketLegs.map((l) => ({
                        optRight: l.type || l.optRight || l.option_type,
                        opt_right: l.type || l.optRight || l.option_type,
                        option_type: l.type || l.optRight || l.option_type,
                        type: l.type || l.optRight || l.option_type,
                        strike: l.strike,
                        side: l.action === "buy" ? "long" : "short",
                        lots: l.qty || l.lots || 1,
                        entry_price: l.premium,
                        lot_size: l.lotSize || lotSize,
                        expiry: l.expiry || chainData?.selectedExpiry,
                    })),
                });
                await loadWallet();
                await loadPositions();
            } else {
                const newPositions = basketLegs.map((l) => {
                    const totalShares = l.qty * (l.lotSize || lotSize);
                    const premiumTotal = l.premium * totalShares;
                    const margin = l.action === "sell" ? (spotPrice || l.strike) * totalShares * 0.12 : premiumTotal;
                    return {
                        id: ++legIdCounter,
                        symbol,
                        expiry: chainData?.selectedExpiry,
                        strategy_name: title,
                        option_type: l.type,
                        strike: l.strike,
                        side: l.action === "buy" ? "long" : "short",
                        lots: l.qty,
                        lot_size: l.lotSize || lotSize,
                        entry_price: l.premium,
                        current_price: l.premium,
                        unrealizedPnl: 0,
                        margin_blocked: margin,
                        created_at: new Date().toISOString(),
                    };
                });

                const updatedOpens = [...openPositions, ...newPositions];
                saveGuestPositions(updatedOpens);
                setOpenPositions(updatedOpens);

                const updatedWallet = {
                    balance: currentBalance - hedgeStats.fundsRequired,
                    margin_utilized: (wallet?.margin_utilized || 0) + hedgeStats.fundsRequired,
                };
                saveGuestWallet(updatedWallet);
                setWallet(updatedWallet);
            }

            setFeedback({ type: "success", text: `Paper Trade "${title}" executed successfully!` });
            setBasketLegs([]);
            setActiveTab("positions");
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to execute paper trade." });
        } finally {
            setIsExecuting(false);
        }
    }

    // Close Single Position
    async function handleClosePosition(pos) {
        try {
            setClosingId(pos.id);
            setFeedback(null);

            if (token) {
                await closePosition(token, pos.id);
                await loadWallet();
                await loadPositions();
            } else {
                const liveLtp = pos.current_price || pos.entry_price;
                const totalShares = pos.lots * pos.lot_size;
                const diff = pos.side === "long" ? liveLtp - pos.entry_price : pos.entry_price - liveLtp;
                const realizedPnl = diff * totalShares;

                const closedPos = {
                    ...pos,
                    exit_price: liveLtp,
                    realized_pnl: realizedPnl,
                    closed_at: new Date().toISOString(),
                };

                const updatedOpens = openPositions.filter((p) => p.id !== pos.id);
                const updatedClosed = [closedPos, ...closedPositions];
                saveGuestPositions(updatedOpens);
                saveGuestClosed(updatedClosed);
                setOpenPositions(updatedOpens);
                setClosedPositions(updatedClosed);

                const marginReleased = Number(pos.margin_blocked || 0);
                const updatedWallet = {
                    balance: (wallet?.balance || 100000) + marginReleased + realizedPnl,
                    margin_utilized: Math.max(0, (wallet?.margin_utilized || 0) - marginReleased),
                };
                saveGuestWallet(updatedWallet);
                setWallet(updatedWallet);
            }

            setFeedback({ type: "success", text: `Position ${pos.symbol} ${pos.strike} ${pos.option_type} closed.` });
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to close position." });
        } finally {
            setClosingId(null);
        }
    }

    // Close All Positions
    async function handleCloseAllPositions() {
        if (!openPositions.length) return;
        try {
            setClosingAll(true);
            setFeedback(null);

            if (token) {
                await closeAllPositions(token);
                await loadWallet();
                await loadPositions();
            } else {
                let netRealized = 0;
                let totalMarginReleased = 0;
                const newlyClosed = openPositions.map((pos) => {
                    const liveLtp = pos.current_price || pos.entry_price;
                    const totalShares = pos.lots * pos.lot_size;
                    const diff = pos.side === "long" ? liveLtp - pos.entry_price : pos.entry_price - liveLtp;
                    const realizedPnl = diff * totalShares;
                    netRealized += realizedPnl;
                    totalMarginReleased += Number(pos.margin_blocked || 0);
                    return {
                        ...pos,
                        exit_price: liveLtp,
                        realized_pnl: realizedPnl,
                        closed_at: new Date().toISOString(),
                    };
                });

                saveGuestPositions([]);
                const updatedClosed = [...newlyClosed, ...closedPositions];
                saveGuestClosed(updatedClosed);
                setOpenPositions([]);
                setClosedPositions(updatedClosed);

                const updatedWallet = {
                    balance: (wallet?.balance || 100000) + totalMarginReleased + netRealized,
                    margin_utilized: 0,
                };
                saveGuestWallet(updatedWallet);
                setWallet(updatedWallet);
            }

            setFeedback({ type: "success", text: "All open paper positions squared off." });
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to square off all positions." });
        } finally {
            setClosingAll(false);
        }
    }

    // Razorpay Refill Flow (+₹5,00,000 for ₹100)
    async function handleBuyRefill() {
        if (!token) {
            // Guest mode instant local refill
            const current = wallet ? Number(wallet.balance) : 100000;
            const updated = { balance: current + 500000, margin_utilized: wallet?.margin_utilized || 0 };
            saveGuestWallet(updated);
            setWallet(updated);
            setRefillModalOpen(false);
            setFeedback({ type: "success", text: "₹5,00,000 virtual balance added in Demo mode!" });
            return;
        }

        try {
            setPaymentLoading(true);
            const orderRes = await createRefillOrder(token);
            const Razorpay = await loadRazorpayCheckout();

            const rzp = new Razorpay({
                key: orderRes.key,
                amount: orderRes.amount,
                currency: orderRes.currency,
                name: "Bazaar Sync",
                description: "Paper Trading Refill — +₹5,00,000 Virtual Capital",
                order_id: orderRes.orderId,
                handler: async (response) => {
                    try {
                        await verifyRefillPayment(token, response);
                        await loadWallet();
                        setRefillModalOpen(false);
                        setFeedback({ type: "success", text: "Payment verified! ₹5,00,000 virtual capital added to your account." });
                    } catch (e) {
                        setFeedback({ type: "error", text: e.message || "Payment verification failed." });
                    }
                },
                theme: { color: "#059669" },
            });
            rzp.open();
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to initiate refill payment." });
        } finally {
            setPaymentLoading(false);
        }
    }

    // Razorpay Pro Membership Flow (₹499/month -> ₹5L + Full Access)
    async function handleBuyPro() {
        if (!token) {
            setFeedback({ type: "error", text: "Please create a free account or log in to subscribe to Pro." });
            setProModalOpen(false);
            return;
        }

        try {
            setPaymentLoading(true);
            const orderRes = await createProOrder(token);
            const Razorpay = await loadRazorpayCheckout();

            const rzp = new Razorpay({
                key: orderRes.key,
                amount: orderRes.amount,
                currency: orderRes.currency,
                name: "Bazaar Sync Pro",
                description: "Monthly Membership (₹499/mo) — ₹5,00,000 Virtual Capital + Full Platform Access",
                order_id: orderRes.orderId,
                handler: async (response) => {
                    try {
                        await verifyProPayment(token, response);
                        await loadWallet();
                        if (refreshUser) await refreshUser();
                        setProModalOpen(false);
                        setFeedback({ type: "success", text: "Welcome to Pro! Membership activated with ₹5,00,000 Virtual Capital." });
                    } catch (e) {
                        setFeedback({ type: "error", text: e.message || "Payment verification failed." });
                    }
                },
                theme: { color: "#059669" },
            });
            rzp.open();
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to initiate Pro membership." });
        } finally {
            setPaymentLoading(false);
        }
    }

    // Portfolio Totals
    const totalUnrealized = useMemo(
        () => openPositions.reduce((sum, p) => sum + (Number(p.unrealizedPnl) || 0), 0),
        [openPositions]
    );
    const virtualCash = wallet ? Number(wallet.balance) : 100000;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-[#0b1420] text-gray-900 dark:text-gray-100 pb-20 font-sans transition-colors">
            {/* --------------------------------------------------------------------- */}
            {/* Top Responsive Full-Width Header Bar */}
            {/* --------------------------------------------------------------------- */}
            <div className="sticky top-0 z-40 bg-white/95 dark:bg-[#111c2a]/95 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 px-3 sm:px-6 py-2.5 shadow-xs">
                <div className="w-full max-w-[1920px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
                    {/* Symbol Selector & Spot Ticker */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <button
                            onClick={() => setSearchOpen(true)}
                            className="flex items-center gap-1.5 sm:gap-2 bg-gray-100 hover:bg-gray-200 dark:bg-[#18263a] dark:hover:bg-[#20324c] border border-gray-300 dark:border-gray-700 px-2.5 sm:px-3 py-1.5 rounded-xl font-black text-xs sm:text-sm text-gray-900 dark:text-white transition cursor-pointer shadow-2xs"
                        >
                            <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{symbol}</span>
                            <FiChevronDown className="text-gray-400" />
                        </button>

                        <div className="flex items-center gap-1.5 sm:gap-2 font-mono">
                            <span className="text-gray-500 dark:text-gray-400 font-sans text-[11px] hidden xs:inline">Spot:</span>
                            <span className="font-extrabold text-gray-900 dark:text-white text-xs sm:text-sm tabular-nums">
                                {spotPrice ? formatPrice(spotPrice) : "—"}
                            </span>
                            {chainData?.spotChange != null && (
                                <span className={`text-[10px] sm:text-[11px] font-bold ${Number(chainData.spotChange) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    ({Number(chainData.spotChange) >= 0 ? "+" : ""}{Number(chainData.spotChangePercent || 0).toFixed(2)}%)
                                </span>
                            )}
                        </div>

                        {/* Live WebSocket Status Pill */}
                        <div className="flex items-center gap-1.5 px-2 py-0.8 rounded-full bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800/50 text-[10px] sm:text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            <span className="hidden sm:inline">Live Stream</span>
                            <span className="sm:hidden">Live</span>
                        </div>
                    </div>

                    {/* Expiry Selector & Wallet Balance */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        {chainData?.expiries?.length > 0 && (
                            <div className="flex items-center gap-1">
                                <span className="text-gray-500 dark:text-gray-400 text-[11px] hidden sm:inline">Expiry:</span>
                                <select
                                    value={chainData.selectedExpiry || ""}
                                    onChange={(e) => changeExpiry(symbol, e.target.value)}
                                    className="bg-gray-100 dark:bg-[#18263a] border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 font-bold text-gray-800 dark:text-gray-200 text-xs outline-none cursor-pointer"
                                >
                                    {chainData.expiries.map((exp) => (
                                        <option key={exp} value={exp}>
                                            {formatExpiryShort(exp)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-gray-200 dark:border-gray-800">
                            <div>
                                <div className="text-[9px] sm:text-[10px] text-gray-400 font-bold uppercase">Virtual Cash</div>
                                <div className="font-mono font-black text-[11px] sm:text-xs text-gray-900 dark:text-white tabular-nums">
                                    {formatRupees(virtualCash)}
                                </div>
                            </div>

                            {/* Refill Button (+₹5L for ₹100) */}
                            <button
                                onClick={() => setRefillModalOpen(true)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-xs cursor-pointer transition flex items-center gap-1"
                                title="Add +₹5,00,000 Virtual Capital for ₹100"
                            >
                                <FiPlusCircle className="text-xs" />
                                <span>+₹5L (₹100)</span>
                            </button>

                            {/* Pro Membership Badge / Button */}
                            {!isPro ? (
                                <button
                                    onClick={() => setProModalOpen(true)}
                                    className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-extrabold text-[11px] shadow-xs cursor-pointer transition flex items-center gap-1"
                                >
                                    <FiAward className="text-xs" />
                                    <span>Pro (₹499/mo)</span>
                                </button>
                            ) : (
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 font-black text-[10px]">
                                    ⭐ Pro Active
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* --------------------------------------------------------------------- */}
            {/* Quick Indices Bar & View Navigation */}
            {/* --------------------------------------------------------------------- */}
            <div className="bg-white/80 dark:bg-[#101926]/90 border-b border-gray-200 dark:border-gray-800 px-3 sm:px-6 py-2 overflow-x-auto">
                <div className="w-full max-w-[1920px] mx-auto flex flex-wrap items-center justify-between gap-2.5 text-xs">
                    <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
                        <span className="text-[11px] text-gray-400 font-bold mr-1 shrink-0 hidden md:inline">7 Indices:</span>
                        {symbolList.indices.map((sym) => (
                            <button
                                key={sym}
                                onClick={() => setSymbol(sym)}
                                className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition cursor-pointer shrink-0 ${
                                    symbol === sym
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "bg-gray-100 dark:bg-[#182333] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#223348]"
                                }`}
                            >
                                {sym}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center bg-gray-200/80 dark:bg-[#182333] p-1 rounded-xl text-xs font-bold shrink-0 shadow-inner">
                        <button
                            onClick={() => setActiveTab("trade")}
                            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                                activeTab === "trade" ? "bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            Option Chain & Hedge
                        </button>
                        <button
                            onClick={() => setActiveTab("positions")}
                            className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "positions" ? "bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <span>Positions</span>
                            {openPositions.length > 0 && (
                                <span className="rounded-full bg-blue-600 text-white text-[10px] px-1.5 py-0.2">
                                    {openPositions.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab("history")}
                            className={`px-3 py-1.5 rounded-lg transition cursor-pointer ${
                                activeTab === "history" ? "bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-xs" : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            History ({closedPositions.length})
                        </button>
                    </div>
                </div>
            </div>

            <div className="w-full max-w-[1920px] mx-auto px-2 sm:px-4 lg:px-6 pt-3 space-y-3">
                {/* 2-Day Trial / Pro Commercial Banner */}
                {!isPro && (
                    <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-3 text-xs text-emerald-900 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">🎁</span>
                            <div>
                                <span className="font-extrabold">2-Day Free Trial Active: </span>
                                You have <span className="font-mono font-bold">₹1,00,000</span> virtual capital. Join Pro for ₹499/mo to get <span className="font-bold">₹5,00,000</span> capital & full platform access!
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setRefillModalOpen(true)}
                                className="px-3 py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition cursor-pointer"
                            >
                                Refill +₹5L (₹100)
                            </button>
                            <button
                                onClick={() => setProModalOpen(true)}
                                className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-black transition cursor-pointer"
                            >
                                Get Pro (₹499/mo)
                            </button>
                        </div>
                    </div>
                )}

                {/* Feedback Alerts */}
                {feedback && (
                    <div className={`p-3 rounded-xl text-xs flex items-center justify-between shadow-xs ${
                        feedback.type === "success"
                            ? "bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                            : "bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300"
                    }`}>
                        <div className="flex items-center gap-2">
                            {feedback.type === "success" ? (
                                <FiCheckCircle className="text-emerald-600 text-sm shrink-0" />
                            ) : (
                                <FiAlertCircle className="text-rose-600 text-sm shrink-0" />
                            )}
                            <span>{feedback.text}</span>
                        </div>
                        <button onClick={() => setFeedback(null)} className="cursor-pointer font-bold ml-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">✕</button>
                    </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* 1. TRADE TAB: SIDE-BY-SIDE OPTION CHAIN & PAYOFF WORKBENCH */}
                {/* ----------------------------------------------------------------- */}
                {activeTab === "trade" && (
                    <div className="space-y-3">
                        {/* Mobile Sub-Tab Navigation (< lg screens) */}
                        <div className="flex lg:hidden items-center justify-between bg-white dark:bg-[#121c2b] p-1.5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-2xs">
                            <div className="grid grid-cols-2 gap-1 w-full text-xs font-bold">
                                <button
                                    onClick={() => setMobileTradeTab("chain")}
                                    className={`py-2 px-3 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                                        mobileTradeTab === "chain"
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                    }`}
                                >
                                    <FiLayers className="text-xs" />
                                    <span>Option Chain</span>
                                </button>
                                <button
                                    onClick={() => setMobileTradeTab("payoff")}
                                    className={`py-2 px-3 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                                        mobileTradeTab === "payoff"
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                    }`}
                                >
                                    <FiBarChart2 className="text-xs" />
                                    <span>Payoff & Hedge</span>
                                    {basketLegs.length > 0 && (
                                        <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
                                            {basketLegs.length}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Split Workstation Grid (Desktop: Left Option Chain, Right Payoff Workbench) */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
                            {/* ========================================================= */}
                            {/* LEFT PANEL: LIVE OPTION CHAIN TABLE */}
                            {/* ========================================================= */}
                            <div className={`lg:col-span-7 xl:col-span-7 2xl:col-span-7 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#121c2b] shadow-sm overflow-hidden flex flex-col ${
                                mobileTradeTab !== "chain" ? "hidden lg:flex" : "flex"
                            }`}>
                                {/* Table Controls */}
                                <div className="px-3 sm:px-4 py-2.5 bg-gray-50 dark:bg-[#162234] border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-gray-500 dark:text-gray-400 font-bold text-[11px]">Strikes:</span>
                                        {STRIKE_RANGES.map((r) => (
                                            <button
                                                key={r.label}
                                                onClick={() => setStrikeRange(r.value)}
                                                className={`px-2 py-0.8 rounded-lg font-bold text-[11px] transition cursor-pointer ${
                                                    strikeRange === r.value
                                                        ? "bg-emerald-600 text-white shadow-xs"
                                                        : "bg-gray-200/80 dark:bg-[#1c2a3d] text-gray-700 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-[#253852]"
                                                }`}
                                            >
                                                {r.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Mobile View Toggle (Calls | Both | Puts) */}
                                    <div className="flex md:hidden items-center bg-gray-200 dark:bg-[#182333] p-0.5 rounded-lg text-xs font-bold">
                                        <button
                                            onClick={() => setMobileSide("calls")}
                                            className={`px-2 py-0.8 rounded-md text-[11px] ${mobileSide === "calls" ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-xs" : "text-gray-500"}`}
                                        >
                                            Calls
                                        </button>
                                        <button
                                            onClick={() => setMobileSide("both")}
                                            className={`px-2 py-0.8 rounded-md text-[11px] ${mobileSide === "both" ? "bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-xs" : "text-gray-500"}`}
                                        >
                                            Both
                                        </button>
                                        <button
                                            onClick={() => setMobileSide("puts")}
                                            className={`px-2 py-0.8 rounded-md text-[11px] ${mobileSide === "puts" ? "bg-white dark:bg-gray-900 text-purple-600 dark:text-purple-400 shadow-xs" : "text-gray-500"}`}
                                        >
                                            Puts
                                        </button>
                                    </div>

                                    <div className="text-gray-500 dark:text-gray-400 text-[11px] font-mono hidden sm:block">
                                        Live Ticks: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{displayRows.length} strikes</span> | Lot: <span className="text-gray-900 dark:text-white font-bold">{lotSize}</span>
                                    </div>
                                </div>

                                {/* Fast Responsive Option Chain Table with Independent Scroll */}
                                <div className="overflow-x-auto max-h-[calc(100vh-210px)] overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-xs text-center border-collapse">
                                        <thead className="sticky top-0 z-10">
                                            <tr className="bg-gray-100/90 dark:bg-[#101926]/95 backdrop-blur-xs text-gray-600 dark:text-gray-400 text-[11px] font-bold border-b border-gray-200 dark:border-gray-800">
                                                {(mobileSide === "both" || mobileSide === "calls") && (
                                                    <th colSpan={4} className="py-2 bg-blue-50/70 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 uppercase tracking-wider text-[10px]">CALL OPTIONS</th>
                                                )}
                                                <th className="py-2 bg-gray-200/80 dark:bg-[#172335] text-gray-900 dark:text-white font-extrabold text-[11px]">STRIKE</th>
                                                {(mobileSide === "both" || mobileSide === "puts") && (
                                                    <th colSpan={4} className="py-2 bg-purple-50/70 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 uppercase tracking-wider text-[10px]">PUT OPTIONS</th>
                                                )}
                                            </tr>
                                            <tr className="bg-gray-50/95 dark:bg-[#131d2c]/95 backdrop-blur-xs text-gray-500 dark:text-gray-400 text-[10px] border-b border-gray-200 dark:border-gray-800 font-semibold">
                                                {(mobileSide === "both" || mobileSide === "calls") && (
                                                    <>
                                                        <th className="py-1.5 px-2 text-right">OI</th>
                                                        <th className="py-1.5 px-2 text-right">Delta</th>
                                                        <th className="py-1.5 px-2 text-right">Live LTP</th>
                                                        <th className="py-1.5 px-2 text-center w-14">Trade</th>
                                                    </>
                                                )}
                                                <th className="py-1.5 px-2.5 bg-gray-100/90 dark:bg-[#172335]/90 text-gray-800 dark:text-gray-200 font-bold">Strike</th>
                                                {(mobileSide === "both" || mobileSide === "puts") && (
                                                    <>
                                                        <th className="py-1.5 px-2 text-center w-14">Trade</th>
                                                        <th className="py-1.5 px-2 text-left">Live LTP</th>
                                                        <th className="py-1.5 px-2 text-left">Delta</th>
                                                        <th className="py-1.5 px-2 text-left">OI</th>
                                                    </>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/80 font-mono text-xs">
                                            {displayRows.map((row) => {
                                                const strikeNum = Number(row.strike);
                                                const isAtm = atmStrike != null && strikeNum === atmStrike;
                                                const ceLeg = basketLegs.find((l) => l.strike === strikeNum && l.type === "CE");
                                                const peLeg = basketLegs.find((l) => l.strike === strikeNum && l.type === "PE");

                                                return (
                                                    <tr
                                                        key={row.strike}
                                                        className={`hover:bg-gray-50 dark:hover:bg-[#18263a] transition ${
                                                            isAtm ? "bg-amber-50/70 dark:bg-amber-950/30 font-bold" : ""
                                                        }`}
                                                    >
                                                        {/* CE Side */}
                                                        {(mobileSide === "both" || mobileSide === "calls") && (
                                                            <>
                                                                <td className="py-1.5 px-2 text-right text-gray-500 dark:text-gray-400 tabular-nums text-[11px]">
                                                                    {formatOi(row.ce?.oi)}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-right text-gray-400 tabular-nums text-[11px]">
                                                                    {row.ce?.delta != null ? Number(row.ce.delta).toFixed(2) : "—"}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-right font-bold tabular-nums text-gray-900 dark:text-white">
                                                                    {row.ce?.ltp != null ? formatPrice(row.ce.ltp) : "—"}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-center">
                                                                    {row.ce?.ltp != null && (
                                                                        <div className="flex items-center justify-center gap-1">
                                                                            <button
                                                                                onClick={() => handleToggleLeg(row, "CE", "buy")}
                                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-black border transition cursor-pointer ${
                                                                                    ceLeg?.action === "buy"
                                                                                        ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                                                                                        : "border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60"
                                                                                }`}
                                                                                title="Buy Call"
                                                                            >
                                                                                B
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleToggleLeg(row, "CE", "sell")}
                                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-black border transition cursor-pointer ${
                                                                                    ceLeg?.action === "sell"
                                                                                        ? "bg-rose-600 text-white border-rose-500 shadow-xs"
                                                                                        : "border-rose-500 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60"
                                                                                }`}
                                                                                title="Sell Call"
                                                                            >
                                                                                S
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            </>
                                                        )}

                                                        {/* Strike */}
                                                        <td className={`py-1.5 px-2.5 bg-gray-50/80 dark:bg-[#152132] font-black tabular-nums border-x border-gray-100 dark:border-gray-800 ${
                                                            isAtm ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-white"
                                                        }`}>
                                                            {row.strike}
                                                            {isAtm && (
                                                                <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-amber-500 text-black font-bold">
                                                                    ATM
                                                                </span>
                                                            )}
                                                        </td>

                                                        {/* PE Side */}
                                                        {(mobileSide === "both" || mobileSide === "puts") && (
                                                            <>
                                                                <td className="py-1.5 px-2 text-center">
                                                                    {row.pe?.ltp != null && (
                                                                        <div className="flex items-center justify-center gap-1">
                                                                            <button
                                                                                onClick={() => handleToggleLeg(row, "PE", "buy")}
                                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-black border transition cursor-pointer ${
                                                                                    peLeg?.action === "buy"
                                                                                        ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                                                                                        : "border-emerald-500 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/60"
                                                                                }`}
                                                                                title="Buy Put"
                                                                            >
                                                                                B
                                                                            </button>
                                                                            <button
                                                                                onClick={() => handleToggleLeg(row, "PE", "sell")}
                                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-black border transition cursor-pointer ${
                                                                                    peLeg?.action === "sell"
                                                                                        ? "bg-rose-600 text-white border-rose-500 shadow-xs"
                                                                                        : "border-rose-500 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/60"
                                                                                }`}
                                                                                title="Sell Put"
                                                                            >
                                                                                S
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-left font-bold tabular-nums text-gray-900 dark:text-white">
                                                                    {row.pe?.ltp != null ? formatPrice(row.pe.ltp) : "—"}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-left text-gray-400 tabular-nums text-[11px]">
                                                                    {row.pe?.delta != null ? Number(row.pe.delta).toFixed(2) : "—"}
                                                                </td>
                                                                <td className="py-1.5 px-2 text-left text-gray-500 dark:text-gray-400 tabular-nums text-[11px]">
                                                                    {formatOi(row.pe?.oi)}
                                                                </td>
                                                            </>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* ========================================================= */}
                            {/* RIGHT PANEL: PAYOFF CHART & STRATEGY WORKBENCH */}
                            {/* ========================================================= */}
                            <div className={`lg:col-span-5 xl:col-span-5 2xl:col-span-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#121c2b] p-3.5 sm:p-4 shadow-sm space-y-3.5 lg:sticky lg:top-[70px] ${
                                mobileTradeTab !== "payoff" ? "hidden lg:block" : "block"
                            }`}>
                                {/* Header & 1-Click Presets */}
                                <div className="border-b border-gray-100 dark:border-gray-800 pb-3 space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <FiBarChart2 className="text-emerald-600 dark:text-emerald-400 text-base" />
                                            <span className="font-extrabold text-xs sm:text-sm text-gray-900 dark:text-white">
                                                Payoff Chart & Hedge Builder
                                            </span>
                                        </div>
                                        <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#18263a] px-2 py-0.5 rounded-md">
                                            {basketLegs.length} Legs
                                        </span>
                                    </div>

                                    {/* 1-Click Presets & All Matrix Buttons */}
                                    <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] font-bold py-0.5 no-scrollbar">
                                        <button
                                            onClick={() => setShowPresetsModal(true)}
                                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 cursor-pointer shrink-0 transition flex items-center gap-1 shadow-xs"
                                        >
                                            <span>✨ All 15+ Strategies</span>
                                        </button>
                                        <button
                                            onClick={() => applyPresetHedge("BULL_CALL_SPREAD")}
                                            className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#1c2a3d] hover:bg-gray-200 dark:hover:bg-[#253852] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700/60 cursor-pointer shrink-0 transition"
                                        >
                                            Bull Call
                                        </button>
                                        <button
                                            onClick={() => applyPresetHedge("BEAR_PUT_SPREAD")}
                                            className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#1c2a3d] hover:bg-gray-200 dark:hover:bg-[#253852] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700/60 cursor-pointer shrink-0 transition"
                                        >
                                            Bear Put
                                        </button>
                                        <button
                                            onClick={() => applyPresetHedge("IRON_CONDOR")}
                                            className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#1c2a3d] hover:bg-gray-200 dark:hover:bg-[#253852] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700/60 cursor-pointer shrink-0 transition"
                                        >
                                            Iron Condor
                                        </button>
                                        <button
                                            onClick={() => applyPresetHedge("STRADDLE")}
                                            className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#1c2a3d] hover:bg-gray-200 dark:hover:bg-[#253852] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700/60 cursor-pointer shrink-0 transition"
                                        >
                                            Straddle
                                        </button>
                                        <button
                                            onClick={() => applyPresetHedge("SHORT_STRANGLE")}
                                            className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-[#1c2a3d] hover:bg-gray-200 dark:hover:bg-[#253852] text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700/60 cursor-pointer shrink-0 transition"
                                        >
                                            Strangle
                                        </button>
                                    </div>
                                </div>

                                {basketLegs.length > 0 ? (
                                    <div className="space-y-3">
                                        {/* Strategy Analytics Badges Grid */}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
                                            {payoffData.maxProfit != null && (
                                                <div className="px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300">
                                                    <div className="text-[9px] text-emerald-600 dark:text-emerald-400 uppercase font-bold">Max Profit</div>
                                                    <div className="font-mono font-black tabular-nums truncate">
                                                        {typeof payoffData.maxProfit === "number" ? `+${formatPrice(payoffData.maxProfit)}` : payoffData.maxProfit}
                                                    </div>
                                                </div>
                                            )}
                                            {payoffData.maxLoss != null && (
                                                <div className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-300">
                                                    <div className="text-[9px] text-rose-600 dark:text-rose-400 uppercase font-bold">Max Loss</div>
                                                    <div className="font-mono font-black tabular-nums truncate">
                                                        {typeof payoffData.maxLoss === "number" ? formatPrice(payoffData.maxLoss) : payoffData.maxLoss}
                                                    </div>
                                                </div>
                                            )}
                                            {payoffData.riskReward && payoffData.riskReward !== "—" && (
                                                <div className="px-2.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-300">
                                                    <div className="text-[9px] text-blue-600 dark:text-blue-400 uppercase font-bold">Risk : Reward</div>
                                                    <div className="font-mono font-black tabular-nums truncate">{payoffData.riskReward}</div>
                                                </div>
                                            )}
                                            {payoffData.pop != null && (
                                                <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                                                    <div className="text-[9px] text-amber-600 dark:text-amber-400 uppercase font-bold">POP (Profit Prob)</div>
                                                    <div className="font-mono font-black tabular-nums">{payoffData.pop}%</div>
                                                </div>
                                            )}
                                            {payoffData.breakevens?.length > 0 && (
                                                <div className="px-2.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/50 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-300 col-span-2 sm:col-span-1">
                                                    <div className="text-[9px] text-purple-600 dark:text-purple-400 uppercase font-bold">Breakeven</div>
                                                    <div className="font-mono font-bold text-[11px] tabular-nums truncate">
                                                        {payoffData.breakevens.map((b) => Math.round(b)).join(" | ")}
                                                    </div>
                                                </div>
                                            )}
                                            {payoffData.netGreeks && (
                                                <div className="px-2.5 py-1.5 rounded-lg bg-gray-50 dark:bg-[#18263a] border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                                                    <div className="text-[9px] text-gray-400 uppercase font-bold">Net Delta (Δ)</div>
                                                    <div className="font-mono font-bold text-[11px] tabular-nums">
                                                        {payoffData.netGreeks.delta.toFixed(2)}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Real-time Payoff Chart Container */}
                                        <div className="bg-gray-50/70 dark:bg-[#101926]/70 border border-gray-200 dark:border-gray-800 rounded-xl p-2.5 shadow-inner">
                                            <div className="flex items-center justify-between mb-1 px-1">
                                                <div className="text-[10px] font-extrabold uppercase text-gray-500 dark:text-gray-400">
                                                    Live Payoff Curve ({symbol})
                                                </div>
                                                <div className="flex items-center gap-2.5 text-[9px] text-gray-400 font-semibold">
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-2 h-0.5 bg-emerald-500 rounded"></span> Expiry
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <span className="w-2 h-0.5 bg-blue-500 rounded border-b border-dashed"></span> Today
                                                    </span>
                                                </div>
                                            </div>
                                            <PayoffChart
                                                curve={payoffData.curve}
                                                spotPrice={spotPrice}
                                                breakevens={payoffData.breakevens}
                                                expectedMove={payoffData.expectedMove}
                                                atmIv={payoffData.atmIv}
                                                yearsRemaining={payoffData.yearsRemaining}
                                                height={220}
                                            />
                                        </div>

                                        {/* Selected Basket Legs List with Strike Roll & Action Toggle */}
                                        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-0.5 custom-scrollbar">
                                            {basketLegs.map((leg) => (
                                                <div
                                                    key={leg.id}
                                                    className="flex items-center justify-between bg-gray-50 dark:bg-[#18263a] border border-gray-200 dark:border-gray-700/70 p-2 rounded-xl text-xs shadow-2xs hover:border-emerald-500/50 transition"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => toggleBasketLegAction(leg.id)}
                                                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase text-white cursor-pointer transition shadow-xs hover:opacity-90 ${
                                                                leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"
                                                            }`}
                                                            title="Click to toggle BUY / SELL"
                                                        >
                                                            {leg.action.toUpperCase()}
                                                        </button>

                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => rollBasketLegStrike(leg.id, -1)}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-[10px] font-bold cursor-pointer transition"
                                                                title="Shift strike down"
                                                            >
                                                                ↓
                                                            </button>
                                                            <div>
                                                                <div className="font-extrabold font-mono text-gray-900 dark:text-white text-xs">
                                                                    {leg.strike} {leg.type}
                                                                </div>
                                                                <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                                                                    LTP: {formatPrice(leg.premium)}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => rollBasketLegStrike(leg.id, 1)}
                                                                className="w-5 h-5 rounded flex items-center justify-center bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-[10px] font-bold cursor-pointer transition"
                                                                title="Shift strike up"
                                                            >
                                                                ↑
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        <div className="flex items-center bg-white dark:bg-[#101926] rounded-lg border border-gray-200 dark:border-gray-700 shadow-2xs">
                                                            <button
                                                                onClick={() => updateBasketLegLots(leg.id, -1)}
                                                                className="px-2 py-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white cursor-pointer font-bold"
                                                            >
                                                                −
                                                            </button>
                                                            <span className="px-1.5 font-bold text-gray-900 dark:text-white text-[11px] tabular-nums">
                                                                {leg.qty}L
                                                            </span>
                                                            <button
                                                                onClick={() => updateBasketLegLots(leg.id, 1)}
                                                                className="px-2 py-0.5 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white cursor-pointer font-bold"
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                        <button
                                                            onClick={() => removeBasketLeg(leg.id)}
                                                            className="text-gray-400 hover:text-rose-600 p-1 cursor-pointer transition"
                                                            title="Remove leg"
                                                        >
                                                            <FiTrash2 />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Margin Details & Execution Buttons */}
                                        <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-2.5">
                                            <div className="flex items-center justify-between text-xs">
                                                <div>
                                                    <span className="text-gray-500 dark:text-gray-400 text-[11px]">Required Funds: </span>
                                                    <span className="font-black text-emerald-600 dark:text-emerald-400 font-mono text-sm tabular-nums">
                                                        {formatRupees(payoffData.fundsRequired)}
                                                    </span>
                                                </div>
                                                {payoffData.isHedged && payoffData.marginBenefit > 0 && (
                                                    <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                                                        ✓ Saved {formatPrice(payoffData.marginBenefit)} (Hedge)
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setBasketLegs([])}
                                                    className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs font-bold cursor-pointer transition"
                                                >
                                                    Clear
                                                </button>
                                                <button
                                                    onClick={handleExecuteHedge}
                                                    disabled={isExecuting}
                                                    className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                                                >
                                                    <FiCheck className="text-sm" />
                                                    <span>{isExecuting ? "Executing…" : "⚡ Execute Live Paper Trade"}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center py-12 px-4 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 space-y-2.5">
                                        <div className="text-3xl">📊</div>
                                        <div className="font-extrabold text-gray-800 dark:text-gray-200 text-xs">
                                            No Strategy Legs Selected
                                        </div>
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400 max-w-[260px] mx-auto leading-relaxed">
                                            Click <strong className="text-emerald-600 dark:text-emerald-400">B (Buy)</strong> or <strong className="text-rose-600 dark:text-rose-400">S (Sell)</strong> on any strike in the Option Chain table on the left, or choose a 1-Click preset above.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Floating Mobile Bar when legs are selected and viewing Option Chain on mobile */}
                        {basketLegs.length > 0 && mobileTradeTab === "chain" && (
                            <div className="lg:hidden fixed bottom-4 inset-x-3 z-30 bg-gray-900/95 text-white p-3 rounded-2xl shadow-2xl border border-gray-700 flex items-center justify-between backdrop-blur-md">
                                <div>
                                    <div className="text-[10px] text-gray-400 font-bold uppercase">{basketLegs.length} Legs in Basket</div>
                                    <div className="font-mono font-black text-xs text-emerald-400">
                                        Req: {formatRupees(payoffData.fundsRequired)}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setMobileTradeTab("payoff")}
                                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black shadow-md flex items-center gap-1.5 cursor-pointer"
                                >
                                    <FiBarChart2 className="text-sm" />
                                    <span>View Payoff & Execute →</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* 3. OPEN POSITIONS & REAL-TIME MTM */}
                {/* ----------------------------------------------------------------- */}
                {activeTab === "positions" && (
                    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#121c2b] shadow-sm overflow-hidden space-y-0">
                        <div className="px-4 py-3.5 bg-gray-50 dark:bg-[#162234] border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
                            <div className="flex items-center gap-2">
                                <span className="text-gray-900 dark:text-white text-sm">Open Paper Positions</span>
                                <span className="text-gray-500 dark:text-gray-400 font-normal">({openPositions.length} active)</span>
                            </div>

                            <div className="flex items-center gap-2">
                                {openPositions.length > 0 && (
                                    <>
                                        <button
                                            onClick={() => setShowPositionsPayoff(!showPositionsPayoff)}
                                            className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                                                showPositionsPayoff
                                                    ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                                                    : "bg-white dark:bg-[#18263a] text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-[#20324c]"
                                            }`}
                                        >
                                            <FiBarChart2 />
                                            <span>{showPositionsPayoff ? "Hide Payoff Chart" : "Portfolio Payoff Chart"}</span>
                                        </button>
                                        <button
                                            onClick={handleCloseAllPositions}
                                            disabled={closingAll}
                                            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition cursor-pointer disabled:opacity-50"
                                        >
                                            {closingAll ? "Exiting All…" : "Exit All Positions"}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Collapsible Portfolio Payoff Chart for Open Positions */}
                        {showPositionsPayoff && openPositions.length > 0 && (
                            <div className="p-4 bg-gray-50/70 dark:bg-[#101926]/70 border-b border-gray-200 dark:border-gray-800 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2.5">
                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="font-extrabold text-xs text-gray-900 dark:text-white">
                                            {symbol} Portfolio Risk Curve:
                                        </span>
                                        {positionsPayoffData.maxProfit != null && (
                                            <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold">
                                                Max Profit: {typeof positionsPayoffData.maxProfit === "number" ? `+${formatPrice(positionsPayoffData.maxProfit)}` : positionsPayoffData.maxProfit}
                                            </span>
                                        )}
                                        {positionsPayoffData.maxLoss != null && (
                                            <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300 font-bold">
                                                Max Loss: {typeof positionsPayoffData.maxLoss === "number" ? formatPrice(positionsPayoffData.maxLoss) : positionsPayoffData.maxLoss}
                                            </span>
                                        )}
                                        {positionsPayoffData.breakevens?.length > 0 && (
                                            <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 font-bold">
                                                Breakeven: {positionsPayoffData.breakevens.map((b) => Math.round(b)).join(" | ")}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-gray-400">
                                        Spot: <strong className="text-gray-900 dark:text-white">{spotPrice ? formatPrice(spotPrice) : "—"}</strong>
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-[#121c2b] p-3 rounded-xl border border-gray-200 dark:border-gray-800 shadow-inner">
                                    <PayoffChart
                                        curve={positionsPayoffData.curve}
                                        spotPrice={spotPrice}
                                        breakevens={positionsPayoffData.breakevens}
                                        expectedMove={positionsPayoffData.expectedMove}
                                        atmIv={positionsPayoffData.atmIv}
                                        yearsRemaining={positionsPayoffData.yearsRemaining}
                                        height={260}
                                    />
                                </div>
                            </div>
                        )}

                        {openPositions.length === 0 ? (
                            <div className="py-16 text-center text-gray-400 text-xs">
                                <div className="text-3xl mb-2">📑</div>
                                <p className="font-bold text-gray-700 dark:text-gray-300">No active positions</p>
                                <p className="mt-1 text-gray-500">
                                    Click B or S on the Option Chain to build a live paper trade or hedge.
                                </p>
                                <button
                                    onClick={() => setActiveTab("trade")}
                                    className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 cursor-pointer"
                                >
                                    Go to Option Chain →
                                </button>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-gray-100/70 dark:bg-[#101926] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 text-[11px]">
                                        <tr>
                                            <th className="px-3 py-2.5">Symbol</th>
                                            <th className="px-3 py-2.5 text-center">Side</th>
                                            <th className="px-3 py-2.5 text-center">Lots</th>
                                            <th className="px-3 py-2.5">Expiry</th>
                                            <th className="px-3 py-2.5 text-center">Strike</th>
                                            <th className="px-3 py-2.5 text-center">Type</th>
                                            <th className="px-3 py-2.5 text-right">Entry</th>
                                            <th className="px-3 py-2.5 text-right">Live LTP</th>
                                            <th className="px-3 py-2.5 text-right">Unrealized P&L</th>
                                            <th className="px-3 py-2.5 text-right">Margin</th>
                                            <th className="px-3 py-2.5 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/80 font-medium font-mono">
                                        {openPositions.map((pos) => {
                                            const pnl = Number(pos.unrealizedPnl || 0);
                                            const isProfit = pnl >= 0;
                                            return (
                                                <tr key={pos.id} className="hover:bg-gray-50 dark:hover:bg-[#18263a] transition">
                                                    <td className="px-3 py-2.5 font-bold text-gray-900 dark:text-white">
                                                        {pos.symbol}
                                                        {pos.strategy_name && (
                                                            <div className="text-[10px] text-gray-500 dark:text-gray-400 font-sans font-normal truncate max-w-[120px]">
                                                                {pos.strategy_name}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                            pos.side === "long" ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800" : "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
                                                        }`}>
                                                            {pos.side === "long" ? "BUY" : "SELL"}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center font-bold tabular-nums">
                                                        {pos.lots}
                                                    </td>
                                                    <td className="px-3 py-2.5 font-sans text-gray-700 dark:text-gray-300">
                                                        {formatExpiryShort(pos.expiry)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center font-bold text-gray-900 dark:text-white">
                                                        {pos.strike}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                            pos.option_type === "CE" ? "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400" : "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-400"
                                                        }`}>
                                                            {pos.option_type}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-gray-700 dark:text-gray-300">
                                                        {formatPrice(pos.entry_price)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-gray-900 dark:text-white">
                                                        {pos.current_price != null ? formatPrice(pos.current_price) : "—"}
                                                    </td>
                                                    <td className={`px-3 py-2.5 text-right font-black tabular-nums ${
                                                        isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                    }`}>
                                                        {isProfit ? "+" : ""}{formatRupees(pnl)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right text-gray-500 dark:text-gray-400 tabular-nums">
                                                        {formatRupees(pos.margin_blocked || 0)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <button
                                                            onClick={() => handleClosePosition(pos)}
                                                            disabled={closingId === pos.id}
                                                            className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950 dark:hover:bg-rose-900 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold text-[11px] transition cursor-pointer disabled:opacity-50"
                                                        >
                                                            {closingId === pos.id ? "Closing…" : "Exit"}
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

                {/* ----------------------------------------------------------------- */}
                {/* 4. CLOSED TRADES & REALIZED P&L */}
                {/* ----------------------------------------------------------------- */}
                {activeTab === "history" && (
                    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#121c2b] shadow-sm overflow-hidden">
                        <div className="px-4 py-3.5 bg-gray-50 dark:bg-[#162234] border-b border-gray-200 dark:border-gray-800 flex items-center justify-between text-xs font-bold">
                            <span className="text-gray-900 dark:text-white text-sm">Closed Paper Trades</span>
                            <span className="text-gray-500 dark:text-gray-400 font-normal">Realized P&L Ledger</span>
                        </div>

                        {closedPositions.length === 0 ? (
                            <div className="py-16 text-center text-gray-400 text-xs">
                                <div className="text-3xl mb-2">📜</div>
                                <p className="font-bold text-gray-700 dark:text-gray-300">No closed trades yet</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-gray-100/70 dark:bg-[#101926] text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800 text-[11px]">
                                        <tr>
                                            <th className="px-3 py-2.5">Symbol</th>
                                            <th className="px-3 py-2.5 text-center">Side</th>
                                            <th className="px-3 py-2.5 text-center">Lots</th>
                                            <th className="px-3 py-2.5">Expiry</th>
                                            <th className="px-3 py-2.5 text-center">Strike</th>
                                            <th className="px-3 py-2.5 text-center">Type</th>
                                            <th className="px-3 py-2.5 text-right">Entry</th>
                                            <th className="px-3 py-2.5 text-right">Exit</th>
                                            <th className="px-3 py-2.5 text-right">Realized P&L</th>
                                            <th className="px-3 py-2.5 text-right">Time</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/80 font-medium font-mono">
                                        {closedPositions.map((pos) => {
                                            const pnl = Number(pos.realized_pnl || 0);
                                            const isProfit = pnl >= 0;
                                            return (
                                                <tr key={pos.id} className="hover:bg-gray-50 dark:hover:bg-[#18263a] transition">
                                                    <td className="px-3 py-2.5 font-bold text-gray-900 dark:text-white">{pos.symbol}</td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                            pos.side === "long" ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300" : "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300"
                                                        }`}>
                                                            {pos.side === "long" ? "BUY" : "SELL"}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center font-bold tabular-nums">{pos.lots}</td>
                                                    <td className="px-3 py-2.5 font-sans text-gray-700 dark:text-gray-300">{formatExpiryShort(pos.expiry)}</td>
                                                    <td className="px-3 py-2.5 text-center font-bold text-gray-900 dark:text-white">{pos.strike}</td>
                                                    <td className="px-3 py-2.5 text-center font-bold text-blue-600 dark:text-blue-400">{pos.option_type}</td>
                                                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatPrice(pos.entry_price)}</td>
                                                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-900 dark:text-white">{pos.exit_price != null ? formatPrice(pos.exit_price) : "—"}</td>
                                                    <td className={`px-3 py-2.5 text-right font-black tabular-nums ${
                                                        isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                    }`}>
                                                        {isProfit ? "+" : ""}{formatRupees(pnl)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right text-gray-500 font-sans text-[11px]">
                                                        {pos.closed_at ? formatDateTime(pos.closed_at) : "—"}
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

            {/* --------------------------------------------------------------------- */}
            {/* Symbol Search Modal (7 Indices & 210+ Stocks) */}
            {/* --------------------------------------------------------------------- */}
            {searchOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121c2b] border border-gray-200 dark:border-gray-700 shadow-2xl p-5 space-y-4 max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                            <span className="font-extrabold text-gray-900 dark:text-white text-base">Select Asset (7 Indices & 210+ Stocks)</span>
                            <button onClick={() => setSearchOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white cursor-pointer text-lg">✕</button>
                        </div>

                        <div className="relative">
                            <FiSearch className="absolute left-3.5 top-3 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search NIFTY, BANKNIFTY, RELIANCE, TCS…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                autoFocus
                                className="w-full bg-gray-50 dark:bg-[#18263a] border border-gray-300 dark:border-gray-700 rounded-xl pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-emerald-500"
                            />
                        </div>

                        <div className="overflow-y-auto space-y-3 flex-1 pr-1 custom-scrollbar">
                            {/* Indices */}
                            {filteredIndices.length > 0 && (
                                <div>
                                    <div className="text-[11px] font-bold uppercase text-gray-400 mb-1.5">Indices (7)</div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {filteredIndices.map((sym) => (
                                            <button
                                                key={sym}
                                                onClick={() => {
                                                    setSymbol(sym);
                                                    setSearchOpen(false);
                                                    setSearchQuery("");
                                                }}
                                                className={`p-2.5 rounded-xl border text-left font-bold text-xs transition cursor-pointer ${
                                                    symbol === sym
                                                        ? "bg-emerald-50 dark:bg-emerald-600/30 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                                                        : "bg-gray-50 dark:bg-[#18263a] border-gray-200 dark:border-gray-700/60 text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#20324c]"
                                                }`}
                                            >
                                                {sym}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Stocks */}
                            {filteredStocks.length > 0 && (
                                <div>
                                    <div className="text-[11px] font-bold uppercase text-gray-400 mb-1.5">F&O Stocks ({filteredStocks.length})</div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {filteredStocks.map((sym) => (
                                            <button
                                                key={sym}
                                                onClick={() => {
                                                    setSymbol(sym);
                                                    setSearchOpen(false);
                                                    setSearchQuery("");
                                                }}
                                                className={`p-2 rounded-xl border text-left font-bold text-xs transition cursor-pointer truncate ${
                                                    symbol === sym
                                                        ? "bg-emerald-50 dark:bg-emerald-600/30 border-emerald-500 text-emerald-700 dark:text-emerald-300"
                                                        : "bg-gray-50 dark:bg-[#18263a] border-gray-200 dark:border-gray-700/60 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#20324c]"
                                                }`}
                                            >
                                                {sym}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* --------------------------------------------------------------------- */}
            {/* Refill Virtual Balance Modal (+₹5,00,000 for ₹100) */}
            {/* --------------------------------------------------------------------- */}
            {refillModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121c2b] border border-gray-200 dark:border-gray-700 shadow-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-xl">💳</span>
                                <span className="font-extrabold text-base text-gray-900 dark:text-white">
                                    Refill Virtual Trading Capital
                                </span>
                            </div>
                            <button onClick={() => setRefillModalOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white cursor-pointer text-lg">✕</button>
                        </div>

                        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 p-4 space-y-2 text-center">
                            <div className="text-xs text-emerald-700 dark:text-emerald-400 font-bold uppercase tracking-wider">
                                Instant Capital Top-Up
                            </div>
                            <div className="text-2xl font-black text-gray-900 dark:text-white font-mono">
                                +₹5,00,000 Virtual Cash
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300">
                                Continue practicing your options strategies without downtime.
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 px-1 font-semibold">
                            <span>Cost:</span>
                            <span className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono">₹100 Only</span>
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={() => setRefillModalOpen(false)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleBuyRefill}
                                disabled={paymentLoading}
                                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                {paymentLoading ? "Processing…" : "Pay ₹100 & Add ₹5 Lakhs"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --------------------------------------------------------------------- */}
            {/* Pro Membership Modal (₹499/month) */}
            {/* --------------------------------------------------------------------- */}
            {proModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#121c2b] border border-gray-200 dark:border-gray-700 shadow-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                            <div className="flex items-center gap-2">
                                <span className="text-xl">⭐</span>
                                <span className="font-extrabold text-base text-gray-900 dark:text-white">
                                    Bazaar Sync Pro Membership
                                </span>
                            </div>
                            <button onClick={() => setProModalOpen(false)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white cursor-pointer text-lg">✕</button>
                        </div>

                        <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 p-4 space-y-2 text-center">
                            <div className="text-xs text-amber-700 dark:text-amber-400 font-bold uppercase tracking-wider">
                                All-in-One Professional Plan
                            </div>
                            <div className="text-2xl font-black text-gray-900 dark:text-white font-mono">
                                ₹499 / Month
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300">
                                Includes ₹5,00,000 Virtual Capital + Full Platform Access.
                            </div>
                        </div>

                        <ul className="space-y-2 text-xs text-gray-700 dark:text-gray-300">
                            <li className="flex items-center gap-2">
                                <FiCheck className="text-emerald-500 shrink-0 font-bold" />
                                <span>₹5,00,000 Virtual Capital for Live Paper Trading</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <FiCheck className="text-emerald-500 shrink-0 font-bold" />
                                <span>Unlimited Live WebSocket Option Chain (7 Indices & 210+ Stocks)</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <FiCheck className="text-emerald-500 shrink-0 font-bold" />
                                <span>StockMojo Payoff Chart & Advanced Greek Analytics</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <FiCheck className="text-emerald-500 shrink-0 font-bold" />
                                <span>Multi-leg Historical Simulator & Strategy Replay</span>
                            </li>
                        </ul>

                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={() => setProModalOpen(false)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition cursor-pointer"
                            >
                                Maybe Later
                            </button>
                            <button
                                onClick={handleBuyPro}
                                disabled={paymentLoading}
                                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-xs font-black shadow-md shadow-amber-600/20 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                {paymentLoading ? "Processing…" : "Subscribe for ₹499/mo"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --------------------------------------------------------------------- */}
            {/* 15+ Ready-Made Strategies Matrix Modal (Simulator Hedging Parity) */}
            {/* --------------------------------------------------------------------- */}
            {showPresetsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6">
                    <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-white dark:bg-[#121c2b] border border-gray-200 dark:border-gray-700 shadow-2xl p-4 sm:p-6 space-y-4 flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                            <div className="flex items-center gap-2.5">
                                <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 font-black">
                                    ⚡
                                </span>
                                <div>
                                    <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                                        Ready-Made Hedging Strategy Matrix ({symbol})
                                    </h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        15+ professional multi-leg option strategies with live strike mapping & risk profiles
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowPresetsModal(false)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                            <PresetStrategies
                                data={chainData}
                                onApply={applyFullPreset}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
