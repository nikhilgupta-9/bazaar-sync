// pages/PaperTrade.jsx — Commercial Live Paper Trading & Hedging Workstation
// Model: 2-Day Free Trial (₹1,00,000 Virtual Money) -> Pro Membership ₹499/mo (₹5,00,000 Virtual Money)
// Refill: +₹5,00,000 Virtual Capital for ₹100 via Razorpay.
// Live WebSocket Tick Streaming across 7 Indices & 210+ Stocks, instant Hedging with margin discounts.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
    fetchPaperLeaderboard,
    updatePositionBracket,
    fetchPaperOrders,
    placePaperOrder,
    cancelPaperOrder,
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
import { yearsToExpiry, bsPrice } from "../utils/blackScholes";
import PayoffChart from "../components/PayoffChart";
import TradingViewChart from "../components/TradingViewChart";
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
    FiTarget,
    FiClock,
    FiActivity,
    FiSettings,
    FiList,
    FiXCircle,
    FiSliders,
} from "react-icons/fi";

// Option-chain columns the user can toggle from the chain's settings menu.
// Listed outermost → innermost for the CALL side (the PUT side mirrors it), and
// `markets` lists where the field really exists in that market's chain data —
// Indian rows (optionChainService) carry Chg%/OI Chg, Delta Exchange carries Bid/Ask.
const CHAIN_COLUMNS = [
    { id: "oi", label: "OI", markets: ["indian", "crypto"] },
    { id: "oiChange", label: "OI Chg", markets: ["indian"] },
    { id: "volume", label: "Volume", markets: ["indian", "crypto"] },
    { id: "iv", label: "IV", markets: ["indian", "crypto"] },
    { id: "vega", label: "Vega", markets: ["indian", "crypto"] },
    { id: "theta", label: "Theta", markets: ["indian", "crypto"] },
    { id: "gamma", label: "Gamma", markets: ["indian", "crypto"] },
    { id: "delta", label: "Delta", markets: ["indian", "crypto"] },
    { id: "bid", label: "Bid", markets: ["crypto"] },
    { id: "ask", label: "Ask", markets: ["crypto"] },
    { id: "changePercent", label: "Chg %", markets: ["indian"] },
    { id: "ltp", label: "LTP", markets: ["indian", "crypto"], locked: true },
];
const DEFAULT_CHAIN_COLS_BY_MARKET = {
    indian: ["oi", "oiChange", "volume", "iv", "delta"],
    crypto: ["bid", "ask", "iv", "delta", "volume"],
};
const CHAIN_COLS_KEY_PREFIX = "bazaar_sync_pt_chain_cols_";

function loadChainCols(market) {
    try {
        const raw = localStorage.getItem(CHAIN_COLS_KEY_PREFIX + market);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {}
    return DEFAULT_CHAIN_COLS_BY_MARKET[market] || ["delta"];
}

const FALLBACK_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const STRIKE_RANGES = [
    { label: "±10", value: 10 },
    { label: "±20", value: 20 },
    { label: "±50", value: 50 },
    { label: "All", value: null },
];

const BACKEND_BASE = "http://localhost:5001";

const CRYPTO_COINS = [
    { symbol: "BTC", name: "Bitcoin", icon: "₿", defaultLot: 0.001, leverage: "100x", color: "text-amber-500", pair: "BTCUSDT" },
    { symbol: "ETH", name: "Ethereum", icon: "Ξ", defaultLot: 0.01, leverage: "50x", color: "text-blue-500", pair: "ETHUSDT" },
    { symbol: "SOL", name: "Solana", icon: "◎", defaultLot: 0.1, leverage: "20x", color: "text-purple-500", pair: "SOLUSDT" },
];

const GUEST_WALLET_KEY = "bazaar_sync_guest_wallet";
const GUEST_CRYPTO_WALLET_KEY = "bazaar_sync_guest_crypto_wallet";
const GUEST_POSITIONS_KEY = "bazaar_sync_guest_positions";
const GUEST_CLOSED_KEY = "bazaar_sync_guest_closed";
const GUEST_ORDERS_KEY = "bazaar_sync_guest_orders";

function loadGuestOrders() {
    try {
        const raw = localStorage.getItem(GUEST_ORDERS_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return [];
}

function saveGuestOrders(orders) {
    try {
        localStorage.setItem(GUEST_ORDERS_KEY, JSON.stringify(orders));
    } catch {}
}

function loadGuestCryptoWallet() {
    try {
        const raw = localStorage.getItem(GUEST_CRYPTO_WALLET_KEY);
        if (raw) return JSON.parse(raw);
    } catch {}
    return { balance: 10000, margin_utilized: 0 }; // $10,000 USDT initial virtual capital
}

function saveGuestCryptoWallet(w) {
    try {
        localStorage.setItem(GUEST_CRYPTO_WALLET_KEY, JSON.stringify(w));
    } catch {}
}

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
    // crypto expiries arrive as ISO timestamps ("2026-10-16T12:00:00Z") — keep the date part
    const parts = String(sqlDate).slice(0, 10).split("-");
    if (parts.length < 3) return sqlDate;
    const [, m, d] = parts.map(Number);
    return `${d} ${months[m - 1] || ""}`;
}

let legIdCounter = Date.now();

// Stop-loss / target are option-premium prices. A BUY's SL sits below entry and
// its target above; a SELL (short) is the mirror image. Returns a message or null.
function bracketError(side, entry, sl, tgt) {
    const isLong = side === "long" || side === "buy";
    const e = Number(entry);
    const check = (raw, kind) => {
        if (raw === "" || raw == null) return null;
        const v = Number(raw);
        if (!(v > 0)) return `${kind} must be a positive price`;
        const belowWanted = kind === "SL" ? isLong : !isLong;
        if (belowWanted && v >= e) return `${kind} must be below the current price (${e}) for a ${isLong ? "Buy" : "Sell"}`;
        if (!belowWanted && v <= e) return `${kind} must be above the current price (${e}) for a ${isLong ? "Buy" : "Sell"}`;
        return null;
    };
    return check(sl, "SL") || check(tgt, "Target");
}

const toBracket = (v) => (v === "" || v == null || !(Number(v) > 0) ? null : Number(v));

// Same trigger rule the backend uses in paperPositionService.handleLiveTicks.
function bracketHit(pos, ltp) {
    const sl = pos.stop_loss_price != null ? Number(pos.stop_loss_price) : null;
    const tgt = pos.target_price != null ? Number(pos.target_price) : null;
    if (pos.side === "long") {
        if (sl != null && ltp <= sl) return "stop_loss";
        if (tgt != null && ltp >= tgt) return "target";
    } else {
        if (sl != null && ltp >= sl) return "stop_loss";
        if (tgt != null && ltp <= tgt) return "target";
    }
    return null;
}

const EXIT_REASON_LABELS = { stop_loss: "SL hit", target: "Target hit", manual: "Manual", close_all: "Square-off all" };

export default function PaperTrade() {
    const { token, user, isPro, refreshUser } = useAuth();
    const navigate = useNavigate();

    // 1. Live Option Chain with WebSocket Streaming
    const {
        symbol,
        setSymbol,
        data: indianChainData,
        loading: indianChainLoading,
        error: indianChainError,
        load: changeIndianExpiry,
        marketStatus: indianMarketStatus,
        isLive: indianIsLive,
        lastUpdated: indianLastUpdated,
    } = useOptionChain("NIFTY");

    // Market Switcher: 'indian' | 'crypto'
    const [marketMode, setMarketMode] = useState("indian");
    const [cryptoSymbol, setCryptoSymbol] = useState("BTC");
    const [cryptoChainData, setCryptoChainData] = useState(null);
    const [cryptoLoading, setCryptoLoading] = useState(false);
    const [cryptoError, setCryptoError] = useState(null);
    const [selectedCryptoExpiry, setSelectedCryptoExpiry] = useState(null);
    const [currency, setCurrency] = useState("USD"); // "USD" | "INR"
    const [usdtInrRate, setUsdtInrRate] = useState(86.5);
    const [cryptoLeverage, setCryptoLeverage] = useState(20); // Delta Exchange default options leverage: 20x (5% IM)
    const [chartViewTab, setChartViewTab] = useState("presets"); // "presets" | "payoff" | "tradingview" (default to presets matching StockMojo)
    const [positionsViewTab, setPositionsViewTab] = useState("payoff"); // "payoff" | "tradingview"
    const [cryptoWallet, setCryptoWallet] = useState(loadGuestCryptoWallet);

    const isCrypto = marketMode === "crypto";
    const activeSymbol = isCrypto ? cryptoSymbol : symbol;
    const chainData = isCrypto ? cryptoChainData : indianChainData;
    const chainLoading = isCrypto ? cryptoLoading : indianChainLoading;
    const chainError = isCrypto ? cryptoError : indianChainError;
    const changeExpiry = isCrypto
        ? (_sym, exp) => setSelectedCryptoExpiry(exp)
        : changeIndianExpiry;
    const marketStatus = isCrypto ? { isOpen: true, nextOpen: null } : indianMarketStatus;
    const isLive = isCrypto ? true : indianIsLive;
    const lastUpdated = isCrypto ? new Date().toISOString() : indianLastUpdated;

    // Fetch live USDT/INR rate
    useEffect(() => {
        let active = true;
        async function fetchFx() {
            try {
                const res = await fetch("https://open.er-api.com/v6/latest/USD");
                if (res.ok) {
                    const d = await res.json();
                    if (active && d?.rates?.INR) setUsdtInrRate(d.rates.INR);
                }
            } catch {}
        }
        fetchFx();
        return () => { active = false; };
    }, []);

    // Fetch Crypto Option Chain
    const fetchCryptoOptionChain = useCallback(async (coin = cryptoSymbol, exp = selectedCryptoExpiry) => {
        setCryptoLoading(true);
        setCryptoError(null);
        try {
            const url = `${BACKEND_BASE}/api/crypto/option-chain?underlying=${coin}${exp ? `&expiry=${encodeURIComponent(exp)}` : ""}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            const spot = Number(data.spotPrice) || (coin === "BTC" ? 85000 : coin === "ETH" ? 2500 : 110);
            const step = coin === "BTC" ? 200 : coin === "ETH" ? 25 : 2;
            const baseStrike = Math.round(spot / step) * step;

            let expiries = (data.expiries || []).map((e) => (typeof e === "string" ? e : e.raw || e.label));
            if (!expiries.length) {
                const today = new Date();
                expiries = [
                    new Date(today.getTime() + 86400000).toISOString().split("T")[0],
                    new Date(today.getTime() + 2 * 86400000).toISOString().split("T")[0],
                    new Date(today.getTime() + 7 * 86400000).toISOString().split("T")[0],
                    new Date(today.getTime() + 14 * 86400000).toISOString().split("T")[0],
                ];
            }
            const activeExp = exp || data.activeExpiry?.raw || expiries[0];

            let rows = [];
            if (Array.isArray(data.chain) && data.chain.length > 0) {
                // Delta Exchange reports OI/volume in coin units (e.g. 0.001 BTC);
                // show them as contract counts, and leave fields it didn't send
                // as null ("—") instead of filling in made-up defaults.
                const posOrNull = (v) => (Number(v) > 0 ? Number(v) : null);
                const mapSide = (o) => {
                    if (!o) return null;
                    const cv = Number(o.contractValue) || CRYPTO_COINS.find((c) => c.symbol === coin)?.defaultLot || 1;
                    const toContracts = (v) => (v == null ? null : Math.round(Number(v) / cv));
                    return {
                        ltp: o.markPrice ?? o.askPrice ?? o.bidPrice ?? 0,
                        iv: posOrNull(o.markIv),
                        delta: o.delta != null ? Number(o.delta) : null,
                        oi: toContracts(o.oi),
                        volume: toContracts(o.volume),
                        gamma: o.gamma ?? null,
                        theta: o.theta ?? null,
                        vega: o.vega ?? null,
                        bid: posOrNull(o.bidPrice),
                        ask: posOrNull(o.askPrice),
                    };
                };
                rows = data.chain.map((r) => ({
                    strike: Number(r.strike),
                    ce: mapSide(r.call),
                    pe: mapSide(r.put),
                }));
            } else {
                for (let i = -15; i <= 15; i++) {
                    const strike = baseStrike + i * step;
                    const diff = strike - spot;
                    const callMark = Math.max(0.1, Math.round(spot * 0.03 * Math.exp(-diff / (spot * 0.1)) * 100) / 100);
                    const putMark = Math.max(0.1, Math.round(spot * 0.03 * Math.exp(diff / (spot * 0.1)) * 100) / 100);
                    rows.push({
                        strike,
                        ce: {
                            ltp: callMark,
                            iv: 24 + Math.abs(i) * 0.4,
                            delta: Math.max(0.05, Math.min(0.95, 0.5 - diff / (spot * 0.2))),
                            oi: Math.round(150 + Math.abs(i) * 12),
                            bid: Math.round(callMark * 0.98 * 100) / 100,
                            ask: Math.round(callMark * 1.02 * 100) / 100,
                        },
                        pe: {
                            ltp: putMark,
                            iv: 24 + Math.abs(i) * 0.4,
                            delta: Math.min(-0.05, Math.max(-0.95, -0.5 - diff / (spot * 0.2))),
                            oi: Math.round(160 + Math.abs(i) * 10),
                            bid: Math.round(putMark * 0.98 * 100) / 100,
                            ask: Math.round(putMark * 1.02 * 100) / 100,
                        },
                    });
                }
            }

            let closestAtm = rows[0]?.strike;
            let minDiff = Infinity;
            rows.forEach((r) => {
                const diff = Math.abs(r.strike - spot);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestAtm = r.strike;
                }
            });

            setCryptoChainData({
                symbol: coin,
                spotPrice: spot,
                spotChange: (spot * (Number(data.spot24hChange) || 0)) / 100,
                spotChangePercent: Number(data.spot24hChange) || 0,
                selectedExpiry: activeExp,
                expiries,
                lotSize: CRYPTO_COINS.find((c) => c.symbol === coin)?.defaultLot || 1,
                atmStrike: closestAtm,
                rows,
            });
        } catch (err) {
            console.error("[PaperTrade] fetchCryptoOptionChain error:", err);
            setCryptoError(err.message);
        } finally {
            setCryptoLoading(false);
        }
    }, [cryptoSymbol, selectedCryptoExpiry]);

    useEffect(() => {
        if (marketMode === "crypto") {
            fetchCryptoOptionChain(cryptoSymbol, selectedCryptoExpiry);
            const timer = setInterval(() => {
                fetchCryptoOptionChain(cryptoSymbol, selectedCryptoExpiry);
            }, 3000);
            return () => clearInterval(timer);
        }
    }, [marketMode, cryptoSymbol, selectedCryptoExpiry, fetchCryptoOptionChain]);

    // 2. Universe of 7 Indices & 210+ Stocks
    const [symbolList, setSymbolList] = useState({ indices: FALLBACK_INDICES, stocks: [] });
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [strikeRange, setStrikeRange] = useState(15);
    const [activeTab, setActiveTab] = useState("trade"); // 'trade' | 'positions' | 'history' | 'leaderboard'
    const [mobileSide, setMobileSide] = useState("both"); // 'both' | 'calls' | 'puts'
    const [mobileTradeTab, setMobileTradeTab] = useState("chain"); // 'chain' | 'payoff' (for mobile screen toggle)
    const [basketViewMode, setBasketViewMode] = useState("split"); // 'split' | 'chart' | 'legs'
    const [showPositionsPayoff, setShowPositionsPayoff] = useState(false);
    const [leaderboardData, setLeaderboardData] = useState(null);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);

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

    // Orders Management State (Delta Exchange / StockMojo Parity)
    const [orders, setOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [orderFilter, setOrderFilter] = useState("all"); // 'all' | 'pending' | 'executed' | 'cancelled'
    const [cancellingOrderId, setCancellingOrderId] = useState(null);

    // Target Date / Time-Decay Slider (StockMojo Parity)
    const [targetDaysOffset, setTargetDaysOffset] = useState(0);

    // Direct Quick Order Slip Modal (Delta Exchange & StockMojo Parity)
    const [orderModal, setOrderModal] = useState(null);

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

    // Load Orders
    const loadOrders = useCallback(async () => {
        if (token) {
            try {
                setOrdersLoading(true);
                const res = await fetchPaperOrders(token);
                const serverOrders = (res.orders || []).map((o) => ({
                    ...o,
                    market: o.market || "indian",
                    optRight: o.opt_right || o.optRight || o.option_type,
                    price: o.price != null ? Number(o.price) : null,
                    executed_price: o.executed_price != null ? Number(o.executed_price) : null,
                }));
                const guestCryptoOrders = loadGuestOrders().filter((o) => o.market === "crypto");
                const merged = [...serverOrders, ...guestCryptoOrders].sort(
                    (a, b) => new Date(b.placed_at || b.created_at || 0) - new Date(a.placed_at || a.created_at || 0)
                );
                setOrders(merged);
            } catch (err) {
                console.error("[PaperTrade] loadOrders failed:", err);
            } finally {
                setOrdersLoading(false);
            }
        } else {
            setOrders(loadGuestOrders().sort((a, b) => new Date(b.placed_at || b.created_at || 0) - new Date(a.placed_at || a.created_at || 0)));
        }
    }, [token]);

    // Cancel Order
    const handleCancelOrder = async (order) => {
        try {
            setCancellingOrderId(order.id);
            if (token && order.market !== "crypto") {
                await cancelPaperOrder(token, order.id);
                await loadWallet();
                await loadOrders();
            } else {
                const allOrders = loadGuestOrders();
                const updated = allOrders.map((o) =>
                    o.id === order.id ? { ...o, status: "CANCELLED", cancelled_at: new Date().toISOString() } : o
                );
                saveGuestOrders(updated);
                setOrders(updated);

                // Refund reserved funds
                const refund = Number(order.required_funds || 0);
                if (order.market === "crypto") {
                    const cw = loadGuestCryptoWallet();
                    const nextW = {
                        balance: Number(cw.balance) + refund,
                        margin_utilized: Math.max(0, (cw.margin_utilized || 0) - refund),
                    };
                    saveGuestCryptoWallet(nextW);
                    setCryptoWallet(nextW);
                } else {
                    const gw = loadGuestWallet();
                    const nextW = {
                        balance: Number(gw.balance) + refund,
                        margin_utilized: Math.max(0, (gw.margin_utilized || 0) - refund),
                    };
                    saveGuestWallet(nextW);
                    setWallet(nextW);
                }
            }
            setFeedback({ type: "success", text: `Order #${order.id} cancelled successfully.` });
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to cancel order." });
        } finally {
            setCancellingOrderId(null);
        }
    };

    // Close positions that live only in this browser (crypto trades, and every
    // trade of a logged-out guest): book P&L, release margin, move to history.
    // Reads storage as the source of truth so it's safe to call from callbacks.
    const closeLocalPositions = useCallback((toClose, defaultReason = "manual") => {
        if (!toClose.length) return;
        const ids = new Set(toClose.map((p) => p.id));
        const now = new Date().toISOString();
        let inr = { delta: 0, margin: 0 };
        let usd = { delta: 0, margin: 0 };
        const closedNow = toClose.map((pos) => {
            const exitPrice = Number(pos.current_price ?? pos.entry_price);
            const shares = pos.lots * pos.lot_size;
            const realized = (pos.side === "long" ? exitPrice - pos.entry_price : pos.entry_price - exitPrice) * shares;
            const margin = Number(pos.margin_blocked || 0);
            const bucket = pos.market === "crypto" ? usd : inr;
            bucket.delta += margin + realized;
            bucket.margin += margin;
            const { _reason, ...rest } = pos;
            return { ...rest, exit_price: exitPrice, realized_pnl: realized, closed_at: now, exit_reason: _reason || defaultReason };
        });

        saveGuestPositions(loadGuestPositions().filter((p) => !ids.has(p.id)));
        saveGuestClosed([...closedNow, ...loadGuestClosed()]);
        setOpenPositions((prev) => prev.filter((p) => !ids.has(p.id)));
        setClosedPositions((prev) => [...closedNow, ...prev.filter((p) => !ids.has(p.id))]);

        if (usd.margin || usd.delta) {
            const cw = loadGuestCryptoWallet();
            const next = { balance: Number(cw.balance) + usd.delta, margin_utilized: Math.max(0, (cw.margin_utilized || 0) - usd.margin) };
            saveGuestCryptoWallet(next);
            setCryptoWallet(next);
        }
        if (inr.margin || inr.delta) {
            const gw = loadGuestWallet();
            const next = { balance: Number(gw.balance) + inr.delta, margin_utilized: Math.max(0, (gw.margin_utilized || 0) - inr.margin) };
            saveGuestWallet(next);
            setWallet(next);
        }
    }, []);

    // SL/Target popup, shared by basket legs and open positions:
    // { kind: "leg" | "position", id, pos?, side, ref, label, sl, target } while open.
    const [slModal, setSlModal] = useState(null);
    const [savingBracket, setSavingBracket] = useState(false);

    // Server positions closed by a stop-loss/target since the last refresh get a banner.
    const serverOpenIdsRef = useRef(null);

    // Refresh positions
    const loadPositions = useCallback(async () => {
        const sameExpiry = (a, b) => String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
        // Mark browser-held positions to the loaded chain (only when symbol AND expiry
        // match — another expiry's premium isn't this contract's price) and collect
        // any whose stop-loss/target that fresh price has crossed.
        const markLocal = (list) => {
            const hits = [];
            const marked = list.map((pos) => {
                let liveLtp = null;
                if (chainData && chainData.symbol === pos.symbol && sameExpiry(chainData.selectedExpiry, pos.expiry) && chainData.rows) {
                    const row = chainData.rows.find((r) => Number(r.strike) === Number(pos.strike));
                    const side = row && (pos.option_type === "CE" ? row.ce : row.pe);
                    if (side && side.ltp != null && Number(side.ltp) > 0) liveLtp = Number(side.ltp);
                }
                const price = liveLtp ?? Number(pos.current_price ?? pos.entry_price);
                const diff = pos.side === "long" ? price - pos.entry_price : pos.entry_price - price;
                const next = { ...pos, current_price: price, unrealizedPnl: diff * pos.lots * pos.lot_size };
                if (liveLtp != null) {
                    const reason = bracketHit(pos, liveLtp);
                    if (reason) hits.push({ ...next, _reason: reason });
                }
                return next;
            });
            return { marked, hits };
        };
        const announce = (hits) => {
            if (!hits.length) return;
            const h = hits[0];
            const what = h._reason === "stop_loss" ? "🛑 Stop loss hit" : "🎯 Target hit";
            const more = hits.length > 1 ? ` (+${hits.length - 1} more)` : "";
            setFeedback({
                type: h._reason === "stop_loss" ? "error" : "success",
                text: `${what}: ${h.symbol} ${h.strike} ${h.option_type} closed at ${
                    h.market === "crypto" ? `$${Number(h.current_price).toFixed(2)}` : formatPrice(h.current_price)
                }${more}.`,
            });
        };

        // Match guest pending orders against live ticks
        const guestOrders = loadGuestOrders();
        const pending = guestOrders.filter((o) => o.status === "PENDING");
        if (pending.length && chainData?.rows?.length) {
            let updatedOrders = [...guestOrders];
            let newPositions = [];
            let filledCount = 0;

            for (const ord of pending) {
                if (ord.symbol === chainData.symbol && sameExpiry(ord.expiry, chainData.selectedExpiry)) {
                    const row = chainData.rows.find((r) => Number(r.strike) === Number(ord.strike));
                    const side = row && (ord.optRight === "CE" ? row.ce : row.pe);
                    if (side && side.ltp != null && Number(side.ltp) > 0) {
                        const currentLtp = Number(side.ltp);
                        let isFilled = false;
                        if (ord.orderType === "MARKET") {
                            isFilled = true;
                        } else if (ord.orderType === "LIMIT") {
                            if (ord.side === "buy" && currentLtp <= Number(ord.price)) isFilled = true;
                            if (ord.side === "sell" && currentLtp >= Number(ord.price)) isFilled = true;
                        }

                        if (isFilled) {
                            filledCount++;
                            updatedOrders = updatedOrders.map((o) =>
                                o.id === ord.id
                                    ? { ...o, status: "EXECUTED", executed_price: currentLtp, executed_at: new Date().toISOString() }
                                    : o
                            );
                            const totalShares = ord.lots * ord.lot_size;
                            const allocatedMargin = ord.side === "buy"
                                ? currentLtp * totalShares
                                : (ord.market === "crypto"
                                    ? ((chainData.spotPrice || ord.strike) * totalShares / (ord.leverage || 20))
                                    : ((chainData.spotPrice || ord.strike) * totalShares * 0.113));

                            newPositions.push({
                                id: ++legIdCounter,
                                symbol: ord.symbol,
                                market: ord.market || (["BTC", "ETH", "SOL"].includes(ord.symbol) ? "crypto" : "indian"),
                                expiry: ord.expiry,
                                strategy_name: ord.strategyName || `${ord.symbol} ${ord.strike} ${ord.optRight}`,
                                option_type: ord.optRight,
                                strike: ord.strike,
                                side: ord.side === "buy" ? "long" : "short",
                                lots: ord.lots,
                                lot_size: ord.lot_size,
                                entry_price: currentLtp,
                                current_price: currentLtp,
                                unrealizedPnl: 0,
                                margin_blocked: allocatedMargin,
                                stop_loss_price: ord.stopLossPrice,
                                target_price: ord.targetPrice,
                                created_at: new Date().toISOString(),
                            });
                        }
                    }
                }
            }

            if (filledCount > 0) {
                saveGuestOrders(updatedOrders);
                setOrders(updatedOrders);
                const updatedOpens = [...loadGuestPositions(), ...newPositions];
                saveGuestPositions(updatedOpens);
                setOpenPositions(updatedOpens);
                setFeedback({
                    type: "success",
                    text: `⚡ ${filledCount} Pending Limit Order(s) filled against live market ticks!`,
                });
            }
        }

        if (token) {
            try {
                const [openRes, closedRes] = await Promise.all([
                    fetchPositions(token, "open"),
                    fetchPositions(token, "closed"),
                ]);
                // server rows use opt_right / livePrice / exit_time — map to the names this page renders
                const norm = (p) => ({
                    ...p,
                    market: "indian",
                    option_type: p.option_type || p.opt_right,
                    current_price: p.livePrice ?? p.current_price ?? null,
                    closed_at: p.closed_at || p.exit_time || null,
                });
                const serverOpen = (openRes.positions || []).map(norm);
                const serverClosed = (closedRes.positions || []).map(norm);
                // crypto trades are browser-held even when logged in — keep them in the lists
                const { marked, hits } = markLocal(loadGuestPositions().filter((p) => p.market === "crypto"));
                const localClosed = loadGuestClosed().filter((p) => p.market === "crypto");

                setOpenPositions([...serverOpen, ...marked]);
                setClosedPositions(
                    [...serverClosed, ...localClosed].sort((a, b) => String(b.closed_at || "").localeCompare(String(a.closed_at || "")))
                );

                const prevOpen = serverOpenIdsRef.current;
                if (prevOpen) {
                    const fired = serverClosed
                        .filter((p) => prevOpen.has(p.id) && (p.exit_reason === "stop_loss" || p.exit_reason === "target"))
                        .map((p) => ({ ...p, current_price: p.exit_price, _reason: p.exit_reason }));
                    announce(fired);
                }
                serverOpenIdsRef.current = new Set(serverOpen.map((p) => p.id));

                if (hits.length) {
                    closeLocalPositions(hits);
                    announce(hits);
                }
            } catch (err) {
                console.error("[PaperTrade] loadPositions failed:", err);
            }
        } else {
            const { marked, hits } = markLocal(loadGuestPositions());
            setOpenPositions(marked);
            setClosedPositions(loadGuestClosed());
            if (hits.length) {
                closeLocalPositions(hits);
                announce(hits);
            }
        }
    }, [token, chainData, closeLocalPositions]);

    useEffect(() => {
        loadWallet();
        loadPositions();
        loadOrders();
    }, [token, loadWallet, loadPositions, loadOrders]);

    // Load Leaderboard Data
    const loadLeaderboard = useCallback(async () => {
        if (!token) return;
        setLeaderboardLoading(true);
        try {
            const res = await fetchPaperLeaderboard(token);
            setLeaderboardData(res);
        } catch (err) {
            console.error("[PaperTrade] loadLeaderboard failed:", err);
        } finally {
            setLeaderboardLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (activeTab === "leaderboard") {
            loadLeaderboard();
        }
    }, [activeTab, loadLeaderboard]);

    // Derived Market Values
    const spotPrice = chainData?.spotPrice ? Number(chainData.spotPrice) : null;
    const atmStrike = chainData?.atmStrike ? Number(chainData.atmStrike) : null;
    const currentCryptoCoin = useMemo(() => CRYPTO_COINS.find((c) => c.symbol === cryptoSymbol) || CRYPTO_COINS[0], [cryptoSymbol]);
    const lotSize = isCrypto
        ? currentCryptoCoin.defaultLot
        : (chainData?.lotSize ? Number(chainData.lotSize) : 50);

    const formatActivePrice = useCallback((val, decimals = 2) => {
        if (val == null || isNaN(val)) return "—";
        if (isCrypto) {
            if (currency === "INR") {
                return `₹${Number(val * usdtInrRate).toLocaleString("en-IN", {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                })}`;
            }
            return `$${Number(val).toLocaleString("en-US", {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            })}`;
        }
        return formatPrice(val);
    }, [isCrypto, currency, usdtInrRate]);

    // User-chosen option-chain columns, remembered per market in localStorage.
    const [chainColsByMarket, setChainColsByMarket] = useState(() => ({
        indian: loadChainCols("indian"),
        crypto: loadChainCols("crypto"),
    }));
    const [chainSettingsOpen, setChainSettingsOpen] = useState(false);
    // Sum of call + put volume across every strike of the selected expiry (null if no strike reports volume).
    const chainTotalVolume = useMemo(() => {
        let total = 0;
        let seen = false;
        for (const r of chainData?.rows || []) {
            for (const v of [r.ce?.volume, r.pe?.volume]) {
                if (v != null && !Number.isNaN(Number(v))) {
                    total += Number(v);
                    seen = true;
                }
            }
        }
        return seen ? total : null;
    }, [chainData]);
    const chainColIds = chainColsByMarket[marketMode] || DEFAULT_CHAIN_COLS;
    const marketChainColumns = CHAIN_COLUMNS.filter((c) => c.markets.includes(marketMode));
    const visibleChainCols = marketChainColumns.filter((c) => c.locked || chainColIds.includes(c.id));
    const toggleChainCol = (id) => {
        setChainColsByMarket((prev) => {
            const cur = prev[marketMode] || DEFAULT_CHAIN_COLS;
            const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
            try {
                localStorage.setItem(CHAIN_COLS_KEY_PREFIX + marketMode, JSON.stringify(next));
            } catch {
                // storage unavailable (private mode) — keep the choice for this session only
            }
            return { ...prev, [marketMode]: next };
        });
    };
    const resetChainCols = () => {
        try {
            localStorage.removeItem(CHAIN_COLS_KEY_PREFIX + marketMode);
        } catch {
            // ignore
        }
        setChainColsByMarket((prev) => ({ ...prev, [marketMode]: DEFAULT_CHAIN_COLS }));
    };
    const signedClass = (v) =>
        v > 0 ? "text-emerald-600 dark:text-emerald-400" : v < 0 ? "text-rose-600 dark:text-rose-400" : "text-gray-400";
    const fmtCount = (v) =>
        isCrypto ? Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }) : formatOi(Number(v));
    // Renders one option-chain cell for a CE/PE side; "—" whenever the field is missing.
    const renderChainCell = (sideData, colId) => {
        const v = sideData?.[colId];
        if (v == null || Number.isNaN(Number(v))) return { text: "—", cls: "text-gray-400" };
        const n = Number(v);
        switch (colId) {
            case "ltp":
                return { text: formatActivePrice(n), cls: "font-black text-gray-900 dark:text-white text-[11px]" };
            case "bid":
            case "ask":
                return { text: formatActivePrice(n), cls: "text-gray-600 dark:text-gray-300" };
            case "changePercent":
                return { text: `${n > 0 ? "+" : ""}${n.toFixed(2)}%`, cls: signedClass(n) };
            case "oiChange":
                return { text: `${n > 0 ? "+" : ""}${fmtCount(n)}`, cls: signedClass(n) };
            case "oi":
            case "volume":
                return { text: fmtCount(n), cls: "text-gray-600 dark:text-gray-300" };
            case "iv":
                return { text: n.toFixed(1), cls: "text-gray-600 dark:text-gray-300" };
            case "gamma":
                return { text: n.toFixed(4), cls: "text-gray-400" };
            case "theta":
            case "vega":
                return { text: n.toFixed(2), cls: "text-gray-400" };
            default:
                return { text: n.toFixed(2), cls: "text-gray-400" };
        }
    };

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

    // Days to expiry for Black-Scholes and Target Date Slider
    const daysToExpiry = useMemo(() => {
        if (!chainData?.selectedExpiry) return 1;
        const expDate = new Date(chainData.selectedExpiry);
        const now = new Date();
        const diff = Math.max(1, Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        return isNaN(diff) ? 1 : diff;
    }, [chainData?.selectedExpiry]);

    function openOrderSlip(row, optRight, side = "buy") {
        const sData = optRight === "CE" ? row.ce : row.pe;
        if (!sData || sData.ltp == null) return;
        const currentPrice = Number(sData.ltp);
        const bestBid = sData.bid ? Number(sData.bid) : currentPrice;
        const bestAsk = sData.ask ? Number(sData.ask) : currentPrice;
        const defaultOrderPrice = side === "buy" ? bestAsk : bestBid;

        setOrderModal({
            symbol: activeSymbol,
            expiry: chainData?.selectedExpiry,
            strike: Number(row.strike),
            optRight,
            side, // 'buy' | 'sell'
            orderType: "MARKET", // 'MARKET' | 'LIMIT'
            price: defaultOrderPrice,
            ltp: currentPrice,
            bid: bestBid,
            ask: bestAsk,
            iv: sData.iv ? Number(sData.iv) : null,
            delta: sData.delta ? Number(sData.delta) : null,
            lots: 1,
            lotSize,
            isCrypto,
            spotPrice,
            leverage: cryptoLeverage || 20,
            sl: "",
            target: "",
        });
    }

    async function handleExecuteDirectOrder(m) {
        if (!m) return;
        const totalShares = m.lots * m.lotSize;
        const orderPrice = m.orderType === "LIMIT" ? Number(m.price) : Number(m.ltp);
        const notional = (spotPrice || m.strike) * totalShares;
        const reqFunds = m.side === "buy"
            ? orderPrice * totalShares
            : (m.isCrypto ? (notional / (m.leverage || 20)) : (notional * 0.113));

        const curBal = m.isCrypto
            ? Number(cryptoWallet.balance)
            : (wallet ? Number(wallet.balance) : 100000);

        if (curBal < reqFunds) {
            setFeedback({
                type: "error",
                text: m.isCrypto
                    ? `Insufficient Virtual USDT Balance. Required: $${reqFunds.toFixed(2)}, Available: $${curBal.toFixed(2)}.`
                    : `Insufficient Virtual Cash. Required: ${formatRupees(reqFunds)}, Available: ${formatRupees(curBal)}.`
            });
            return;
        }

        try {
            setIsExecuting(true);
            setFeedback(null);

            if (token && !m.isCrypto) {
                await placePaperOrder(token, {
                    symbol: m.symbol,
                    expiry: m.expiry,
                    strike: m.strike,
                    optRight: m.optRight,
                    side: m.side,
                    orderType: m.orderType,
                    price: m.orderType === "LIMIT" ? m.price : null,
                    lots: m.lots,
                    stopLossPrice: toBracket(m.sl),
                    targetPrice: toBracket(m.target),
                });
                await loadWallet();
                await loadPositions();
                await loadOrders();
            } else {
                const isMarket = m.orderType === "MARKET";
                const orderId = ++legIdCounter;
                const newOrder = {
                    id: orderId,
                    symbol: m.symbol,
                    market: m.isCrypto ? "crypto" : "indian",
                    expiry: m.expiry,
                    strike: m.strike,
                    optRight: m.optRight,
                    side: m.side,
                    orderType: m.orderType,
                    status: isMarket ? "EXECUTED" : "PENDING",
                    lots: m.lots,
                    lot_size: m.lotSize,
                    price: orderPrice,
                    executed_price: isMarket ? orderPrice : null,
                    required_funds: reqFunds,
                    stopLossPrice: toBracket(m.sl),
                    targetPrice: toBracket(m.target),
                    leverage: m.leverage || 20,
                    placed_at: new Date().toISOString(),
                    executed_at: isMarket ? new Date().toISOString() : null,
                };

                const allOrders = [newOrder, ...loadGuestOrders()];
                saveGuestOrders(allOrders);
                setOrders(allOrders);

                if (isMarket) {
                    const newPos = {
                        id: ++legIdCounter,
                        symbol: m.symbol,
                        market: m.isCrypto ? "crypto" : "indian",
                        expiry: m.expiry,
                        strategy_name: `${m.symbol} ${m.strike} ${m.optRight}`,
                        option_type: m.optRight,
                        strike: m.strike,
                        side: m.side === "buy" ? "long" : "short",
                        lots: m.lots,
                        lot_size: m.lotSize,
                        entry_price: orderPrice,
                        current_price: orderPrice,
                        unrealizedPnl: 0,
                        margin_blocked: reqFunds,
                        stop_loss_price: toBracket(m.sl),
                        target_price: toBracket(m.target),
                        created_at: new Date().toISOString(),
                    };
                    const updatedOpens = [...loadGuestPositions(), newPos];
                    saveGuestPositions(updatedOpens);
                    setOpenPositions(updatedOpens);

                    if (m.isCrypto) {
                        const nextW = { balance: curBal - reqFunds, margin_utilized: (cryptoWallet?.margin_utilized || 0) + reqFunds };
                        saveGuestCryptoWallet(nextW);
                        setCryptoWallet(nextW);
                    } else {
                        const nextW = { balance: curBal - reqFunds, margin_utilized: (wallet?.margin_utilized || 0) + reqFunds };
                        saveGuestWallet(nextW);
                        setWallet(nextW);
                    }
                } else {
                    if (m.isCrypto) {
                        const nextW = { balance: curBal - reqFunds, margin_utilized: (cryptoWallet?.margin_utilized || 0) + reqFunds };
                        saveGuestCryptoWallet(nextW);
                        setCryptoWallet(nextW);
                    } else {
                        const nextW = { balance: curBal - reqFunds, margin_utilized: (wallet?.margin_utilized || 0) + reqFunds };
                        saveGuestWallet(nextW);
                        setWallet(nextW);
                    }
                }
            }

            setFeedback({
                type: "success",
                text: m.orderType === "MARKET"
                    ? `Trade executed: ${m.side.toUpperCase()} ${m.lots} ${m.isCrypto ? "Ctr" : "Lots"} ${m.symbol} ${m.strike} ${m.optRight}!`
                    : `Limit order placed: ${m.side.toUpperCase()} ${m.lots} ${m.isCrypto ? "Ctr" : "Lots"} ${m.symbol} ${m.strike} ${m.optRight} at ${m.price}!`,
            });
            setOrderModal(null);
            if (m.orderType === "MARKET") {
                setActiveTab("positions");
            } else {
                setActiveTab("orders");
            }
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to place order." });
        } finally {
            setIsExecuting(false);
        }
    }

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
                setChartViewTab("payoff");
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
        // show the payoff as soon as a trade is added to the basket
        setChartViewTab("payoff");
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
        setChartViewTab("payoff");
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
        if (newLegs.length) setChartViewTab("payoff");
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
            const marginCalc = computeMarginDetails(basketLegs, spotPrice, activeSymbol, {
                isCrypto,
                leverage: isCrypto ? cryptoLeverage : 1,
            });

            const evaluationExpiry = evaluationExpiryOf(basketLegs) || chainData?.selectedExpiry;
            const yearsRemaining = evaluationExpiry ? yearsToExpiry(evaluationExpiry) : null;
            const atmRow = chainData?.rows?.find((r) => Number(r.strike) === Number(atmStrike));
            const atmIv = atmRow?.ce?.iv ? Number(atmRow.ce.iv) : (atmRow?.pe?.iv ? Number(atmRow.pe.iv) : null);

            if (atmIv && yearsRemaining) {
                const targetDateMs = Date.now() + (targetDaysOffset || 0) * 86400000;
                const targetYearsRemaining = Math.max(0.0001, yearsRemaining - ((targetDaysOffset || 0) / 365));
                curveData = addMarkToMarketCurve(curveData, basketLegs, targetYearsRemaining, targetDateMs);
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
    }, [basketLegs, spotPrice, activeSymbol, isCrypto, cryptoLeverage, chainData, atmStrike, targetDaysOffset]);

    // Backward-compatible alias for execution logic
    const hedgeStats = payoffData;

    // 6. Payoff Analysis for Active Open Positions
    const openPositionLegs = useMemo(() => {
        return openPositions
            .filter((p) => p.symbol === activeSymbol)
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
    }, [openPositions, activeSymbol, lotSize]);

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
                const targetDateMs = Date.now() + (targetDaysOffset || 0) * 86400000;
                const targetYearsRemaining = Math.max(0.0001, yearsRemaining - ((targetDaysOffset || 0) / 365));
                curveData = addMarkToMarketCurve(curveData, openPositionLegs, targetYearsRemaining, targetDateMs);
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
    }, [openPositionLegs, spotPrice, chainData, atmStrike, targetDaysOffset]);

    function renderTargetDateSlider() {
        return (
            <div className="mb-2 p-2.5 rounded-xl border border-gray-200/80 dark:border-white/10 bg-gray-50/80 dark:bg-[#070e17]/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 shrink-0">
                    <span className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold text-xs">
                        ⏱
                    </span>
                    <div>
                        <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                            Target Date (Theta Simulation)
                        </div>
                        <div className="text-xs font-black font-mono text-gray-900 dark:text-white flex items-center gap-1.5">
                            <span>
                                {(() => {
                                    const d = new Date(Date.now() + (targetDaysOffset || 0) * 86400000);
                                    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                                })()}
                            </span>
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
                                {targetDaysOffset === 0 ? "Today (T+0)" : targetDaysOffset >= daysToExpiry ? "At Expiry" : `T+${targetDaysOffset}d`}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 max-w-md flex items-center gap-2">
                    <span className="text-[10px] font-mono text-gray-400 shrink-0">T+0</span>
                    <input
                        type="range"
                        min={0}
                        max={Math.max(1, daysToExpiry)}
                        step={1}
                        value={Math.min(targetDaysOffset, daysToExpiry)}
                        onChange={(e) => setTargetDaysOffset(Number(e.target.value))}
                        className="w-full accent-blue-600 dark:accent-blue-500 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-pointer"
                    />
                    <span className="text-[10px] font-mono text-gray-400 shrink-0">Exp ({daysToExpiry}d)</span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                    <button
                        type="button"
                        onClick={() => setTargetDaysOffset(0)}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold font-mono transition cursor-pointer ${
                            targetDaysOffset === 0
                                ? "bg-blue-600 text-white shadow-xs"
                                : "bg-gray-200/70 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        }`}
                    >
                        Today
                    </button>
                    {daysToExpiry > 1 && (
                        <button
                            type="button"
                            onClick={() => setTargetDaysOffset(Math.min(daysToExpiry, 1))}
                            className={`px-2 py-0.5 rounded text-[10.5px] font-bold font-mono transition cursor-pointer ${
                                targetDaysOffset === 1
                                    ? "bg-blue-600 text-white shadow-xs"
                                    : "bg-gray-200/70 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            +1D
                        </button>
                    )}
                    {daysToExpiry > 3 && (
                        <button
                            type="button"
                            onClick={() => setTargetDaysOffset(Math.min(daysToExpiry, 3))}
                            className={`px-2 py-0.5 rounded text-[10.5px] font-bold font-mono transition cursor-pointer ${
                                targetDaysOffset === 3
                                    ? "bg-blue-600 text-white shadow-xs"
                                    : "bg-gray-200/70 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            +3D
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setTargetDaysOffset(daysToExpiry)}
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold font-mono transition cursor-pointer ${
                            targetDaysOffset === daysToExpiry
                                ? "bg-blue-600 text-white shadow-xs"
                                : "bg-gray-200/70 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        }`}
                    >
                        Expiry
                    </button>
                </div>
            </div>
        );
    }

    // Execute Live Paper Trade
    async function handleExecuteHedge() {
        if (!basketLegs.length) return;

        const badLeg = basketLegs.find((l) => bracketError(l.action, l.premium, l.sl, l.target));
        if (badLeg) {
            setFeedback({
                type: "error",
                text: `${badLeg.strike} ${badLeg.type}: ${bracketError(badLeg.action, badLeg.premium, badLeg.sl, badLeg.target)}`,
            });
            return;
        }

        const currentBalance = isCrypto
            ? Number(cryptoWallet.balance)
            : (wallet ? Number(wallet.balance) : 100000);

        if (currentBalance < hedgeStats.fundsRequired) {
            setFeedback({
                type: "error",
                text: isCrypto
                    ? `Insufficient Virtual USDT Balance. Required: $${hedgeStats.fundsRequired.toFixed(2)}, Available: $${currentBalance.toFixed(2)}.`
                    : `Insufficient Virtual Cash. Required: ${formatRupees(hedgeStats.fundsRequired)}, Available: ${formatRupees(currentBalance)}. Refill +₹5,00,000 for ₹100 below.`,
            });
            if (!isCrypto) setRefillModalOpen(true);
            return;
        }

        try {
            setIsExecuting(true);
            setFeedback(null);

            const title =
                basketLegs.length === 1
                    ? `${activeSymbol} ${basketLegs[0].strike} ${basketLegs[0].type}`
                    : `${activeSymbol} Hedge Basket (${basketLegs.length} Legs)`;

            if (token && !isCrypto) {
                await openStrategyTrade(token, {
                    symbol: activeSymbol,
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
                        stopLossPrice: toBracket(l.sl),
                        targetPrice: toBracket(l.target),
                    })),
                });
                await loadWallet();
                await loadPositions();
            } else {
                // Compute proportional margin blocked per leg so the sum matches hedgeStats.fundsRequired exactly
                const rawLegMargins = basketLegs.map((l) => {
                    const totalShares = l.qty * (l.lotSize || lotSize);
                    if (l.action === "buy") {
                        return l.premium * totalShares;
                    }
                    const notional = (spotPrice || l.strike) * totalShares;
                    return isCrypto ? (notional / (cryptoLeverage || 20)) : (notional * 0.113);
                });
                const sumRawMargins = rawLegMargins.reduce((a, b) => a + b, 0);
                const scale = sumRawMargins > 0 ? (hedgeStats.fundsRequired / sumRawMargins) : 1;

                const newPositions = basketLegs.map((l, idx) => {
                    const totalShares = l.qty * (l.lotSize || lotSize);
                    const precision = isCrypto ? 10000 : 100;
                    const allocatedMargin = Math.round(rawLegMargins[idx] * scale * precision) / precision;
                    return {
                        id: ++legIdCounter,
                        symbol: activeSymbol,
                        market: isCrypto ? "crypto" : "indian",
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
                        margin_blocked: allocatedMargin,
                        stop_loss_price: toBracket(l.sl),
                        target_price: toBracket(l.target),
                        created_at: new Date().toISOString(),
                    };
                });

                const updatedOpens = [...openPositions, ...newPositions];
                saveGuestPositions(updatedOpens);
                setOpenPositions(updatedOpens);

                if (isCrypto) {
                    const updatedCryptoWallet = {
                        balance: currentBalance - hedgeStats.fundsRequired,
                        margin_utilized: (cryptoWallet?.margin_utilized || 0) + hedgeStats.fundsRequired,
                    };
                    saveGuestCryptoWallet(updatedCryptoWallet);
                    setCryptoWallet(updatedCryptoWallet);
                } else {
                    const updatedWallet = {
                        balance: currentBalance - hedgeStats.fundsRequired,
                        margin_utilized: (wallet?.margin_utilized || 0) + hedgeStats.fundsRequired,
                    };
                    saveGuestWallet(updatedWallet);
                    setWallet(updatedWallet);
                }
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

            if (token && pos.market !== "crypto") {
                await closePosition(token, pos.id);
                await loadWallet();
                await loadPositions();
            } else {
                closeLocalPositions([pos], "manual");
            }

            setFeedback({ type: "success", text: `Position ${pos.symbol} ${pos.strike} ${pos.option_type} closed.` });
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to close position." });
        } finally {
            setClosingId(null);
        }
    }

    function openLegSl(leg) {
        setSlModal({
            kind: "leg",
            id: leg.id,
            side: leg.action,
            ref: Number(leg.premium),
            label: `${leg.action === "buy" ? "BUY" : "SELL"} ${leg.strike} ${leg.type}`,
            sl: leg.sl ?? "",
            target: leg.target ?? "",
        });
    }

    function openPositionSl(pos) {
        setSlModal({
            kind: "position",
            id: pos.id,
            pos,
            side: pos.side,
            ref: Number(pos.current_price ?? pos.entry_price),
            label: `${pos.side === "long" ? "BUY" : "SELL"} ${pos.symbol} ${pos.strike} ${pos.option_type}`,
            sl: pos.stop_loss_price != null ? String(Number(pos.stop_loss_price)) : "",
            target: pos.target_price != null ? String(Number(pos.target_price)) : "",
        });
    }

    async function saveSlModal(clear = false) {
        if (!slModal) return;
        const slRaw = clear ? "" : slModal.sl;
        const tgtRaw = clear ? "" : slModal.target;
        if (bracketError(slModal.side, slModal.ref, slRaw, tgtRaw)) return; // popup shows the error inline

        if (slModal.kind === "leg") {
            setBasketLegs((prev) => prev.map((l) => (l.id === slModal.id ? { ...l, sl: slRaw, target: tgtRaw } : l)));
            setSlModal(null);
            return;
        }

        const pos = slModal.pos;
        const sl = toBracket(slRaw);
        const target = toBracket(tgtRaw);
        try {
            setSavingBracket(true);
            if (token && pos.market !== "crypto") {
                await updatePositionBracket(token, pos.id, { stopLossPrice: sl, targetPrice: target, trailingSl: pos.trailing_sl ?? null });
                await loadPositions();
            } else {
                const apply = (p) => (p.id === pos.id ? { ...p, stop_loss_price: sl, target_price: target } : p);
                saveGuestPositions(loadGuestPositions().map(apply));
                setOpenPositions((prev) => prev.map(apply));
            }
            setSlModal(null);
            setFeedback({
                type: "success",
                text: sl == null && target == null
                    ? `SL/Target removed for ${pos.symbol} ${pos.strike} ${pos.option_type}.`
                    : `SL/Target set for ${pos.symbol} ${pos.strike} ${pos.option_type}.`,
            });
        } catch (e) {
            setFeedback({ type: "error", text: e.message || "Failed to update SL/Target." });
        } finally {
            setSavingBracket(false);
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
            }
            // browser-held positions: crypto always, everything for a guest
            closeLocalPositions(openPositions.filter((p) => !token || p.market === "crypto"), "close_all");
            if (token) {
                await loadWallet();
                await loadPositions();
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
        if (!token || !user) {
            setProModalOpen(false);
            navigate("/login");
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

    // ATM Row Reference for Smooth Quick Scroll. Scrolls only the chain's own
    // container (scrollIntoView would also drag the whole page down).
    const atmRowRef = useRef(null);
    const chainScrollRef = useRef(null);
    const centerAtm = useCallback((behavior = "smooth") => {
        const box = chainScrollRef.current;
        const row = atmRowRef.current;
        if (!box || !row || box.clientHeight === 0) return false;
        const boxRect = box.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        // centre within the area below the sticky column header, not the whole box
        const headH = box.querySelector("thead")?.offsetHeight || 0;
        const visibleH = box.clientHeight - headH;
        const target = box.scrollTop + (rowRect.top - boxRect.top) - headH - visibleH / 2 + rowRect.height / 2;
        box.scrollTo({ top: Math.max(0, target), behavior });
        return true;
    }, []);
    const scrollToAtm = () => centerAtm("smooth");

    // Desktop: stretch the chain's scroll box from where it sits on load down to
    // the bottom of the viewport. Measured against the document (not the current
    // scroll position) so the sticky TopNav can't feed back into the height.
    useLayoutEffect(() => {
        if (activeTab !== "trade") return;
        const fit = () => {
            const box = chainScrollRef.current;
            if (!box) return;
            if (window.innerWidth < 1024) {
                box.style.maxHeight = "";
                return;
            }
            const docTop = box.getBoundingClientRect().top + window.scrollY;
            box.style.maxHeight = `${Math.max(320, window.innerHeight - docTop - 16)}px`;
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [activeTab, mobileTradeTab, isCrypto]);

    // Auto-center ATM once per chain view (load, symbol/expiry/range switch, tab
    // back to the chain) — not on every live tick, so manual scrolling sticks.
    const lastCenteredKeyRef = useRef(null);
    const atmCenterKey = `${marketMode}|${activeSymbol}|${chainData?.selectedExpiry ?? ""}|${strikeRange}|${activeTab}|${mobileTradeTab}|${displayRows.length}`;
    useEffect(() => {
        if (activeTab !== "trade" || atmStrike == null || displayRows.length === 0) return;
        if (lastCenteredKeyRef.current === atmCenterKey) return;
        let cancelled = false;
        const raf = requestAnimationFrame(() => {
            if (!centerAtm("auto")) return;
            lastCenteredKeyRef.current = atmCenterKey;
            // web fonts landing late change row heights — re-centre once they're in
            document.fonts?.ready.then(() => {
                if (!cancelled) requestAnimationFrame(() => centerAtm("auto"));
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
        };
    }, [atmCenterKey, activeTab, atmStrike, displayRows, centerAtm]);

    // Portfolio Totals for Open Positions
    const totalUnrealized = useMemo(
        () => openPositions.reduce((sum, p) => sum + (Number(p.unrealizedPnl) || 0), 0),
        [openPositions]
    );
    const totalMarginBlocked = useMemo(
        () => openPositions.reduce((sum, p) => sum + (Number(p.margin_blocked) || 0), 0),
        [openPositions]
    );

    // History Totals for Closed Positions
    const totalRealizedPnl = useMemo(
        () => closedPositions.reduce((sum, p) => sum + (Number(p.realized_pnl) || 0), 0),
        [closedPositions]
    );
    const winningTrades = useMemo(
        () => closedPositions.filter((p) => Number(p.realized_pnl) > 0).length,
        [closedPositions]
    );
    const losingTrades = useMemo(
        () => closedPositions.filter((p) => Number(p.realized_pnl) < 0).length,
        [closedPositions]
    );
    const winRate = useMemo(
        () => (closedPositions.length > 0 ? ((winningTrades / closedPositions.length) * 100).toFixed(1) : 0),
        [closedPositions, winningTrades]
    );
    const bestTradePnl = useMemo(
        () => (closedPositions.length > 0 ? Math.max(...closedPositions.map((p) => Number(p.realized_pnl) || 0)) : 0),
        [closedPositions]
    );
    const virtualCash = wallet ? Number(wallet.balance) : 100000;

    return (
        <div className="min-h-screen bg-gray-50/70 dark:bg-[#070a11] text-gray-900 dark:text-gray-100 font-sans pb-16 transition-colors">
            {/* --------------------------------------------------------------------- */}
            {/* 1. Primary Unified Trading Header Bar (Sticky Top-0) */}
            {/* --------------------------------------------------------------------- */}
            <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#0b1420]/95 backdrop-blur-md border-b border-gray-200 dark:border-white/10 px-3 sm:px-6 py-2 shadow-xs transition-colors">
                <div className="w-full max-w-[1720px] mx-auto flex flex-wrap xl:flex-nowrap items-center justify-between gap-3 text-xs">
                    {/* Left Group: Market Mode, Asset Button, Spot Ticker, Expiry */}
                    <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap xl:flex-nowrap">
                        {/* Market Switcher: Indian Market vs Crypto */}
                        <div className="flex items-center bg-gray-100 dark:bg-[#121c2b] p-0.5 rounded-xl border border-gray-200 dark:border-white/10 shadow-2xs">
                            <button
                                onClick={() => {
                                    setMarketMode("indian");
                                    setBasketLegs([]);
                                }}
                                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer flex items-center gap-1.5 ${
                                    !isCrypto
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                }`}
                            >
                                <span>🇮🇳</span>
                                <span className="hidden 2xl:inline">NSE F&amp;O</span>
                                <span className="2xl:hidden">NSE</span>
                            </button>
                            <button
                                onClick={() => {
                                    setMarketMode("crypto");
                                    setBasketLegs([]);
                                }}
                                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer flex items-center gap-1.5 ${
                                    isCrypto
                                        ? "bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                }`}
                            >
                                <span>⚡</span>
                                <span>Crypto</span>
                            </button>
                        </div>

                        {/* Symbol Button */}
                        {!isCrypto ? (
                            <button
                                onClick={() => setSearchOpen(true)}
                                className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 dark:bg-[#121c2b] dark:hover:bg-[#1a273b] border border-gray-200 dark:border-white/10 px-3 py-1.5 rounded-xl font-black text-xs sm:text-sm text-gray-900 dark:text-white transition cursor-pointer shadow-2xs"
                            >
                                <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{symbol}</span>
                                <FiChevronDown className="text-gray-400" />
                            </button>
                        ) : (
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#121c2b] p-0.5 rounded-xl border border-gray-200 dark:border-white/10">
                                {CRYPTO_COINS.map((c) => (
                                    <button
                                        key={c.symbol}
                                        onClick={() => {
                                            setCryptoSymbol(c.symbol);
                                            setBasketLegs([]);
                                        }}
                                        className={`px-2.5 py-1 rounded-lg font-bold text-xs transition cursor-pointer flex items-center gap-1 ${
                                            cryptoSymbol === c.symbol
                                                ? "bg-amber-500 text-white shadow-xs"
                                                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                        }`}
                                    >
                                        <span>{c.icon}</span>
                                        <span>{c.symbol}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Spot Price & Change */}
                        <div className="flex items-center gap-2 font-mono bg-gray-50/80 dark:bg-[#070e17]/80 px-2.5 py-1 rounded-xl border border-gray-200/80 dark:border-white/5">
                            <span className="relative flex h-1.5 w-1.5" title={isCrypto ? "24/7 live feed" : "Live feed"}>
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                            </span>
                            <span className="text-gray-400 font-sans text-[11px] font-semibold">SPOT</span>
                            <span className="font-extrabold text-gray-900 dark:text-white text-xs sm:text-sm tabular-nums">
                                {formatActivePrice(spotPrice)}
                            </span>
                            {chainData?.spotChange != null && (
                                <span className={`text-[11px] font-bold ${Number(chainData.spotChange) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    ({Number(chainData.spotChange) >= 0 ? "+" : ""}{Number(chainData.spotChangePercent || 0).toFixed(2)}%)
                                </span>
                            )}
                        </div>

                        {/* VIX (Indian mode) */}
                        {!isCrypto && chainData?.vix != null && (
                            <div className="hidden md:flex xl:hidden 2xl:flex items-center gap-1 font-mono bg-gray-50/80 dark:bg-[#070e17]/80 px-2 py-1 rounded-xl border border-gray-200/80 dark:border-white/5 text-[11px] shrink-0">
                                <span className="text-gray-400 font-sans text-[10px] font-bold">VIX</span>
                                <span className="font-bold text-gray-800 dark:text-gray-200 tabular-nums">
                                    {Number(chainData.vix).toFixed(2)}
                                </span>
                            </div>
                        )}

                        {/* Expiry Selector */}
                        {chainData?.expiries?.length > 0 && (
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#121c2b] px-2 py-0.5 rounded-xl border border-gray-200 dark:border-white/10">
                                <span className="text-gray-400 text-[10px] font-bold uppercase hidden 2xl:inline">Exp:</span>
                                <select
                                    value={chainData.selectedExpiry || ""}
                                    onChange={(e) => changeExpiry(activeSymbol, e.target.value)}
                                    className="bg-transparent font-bold text-gray-800 dark:text-gray-200 text-xs outline-none cursor-pointer py-1"
                                >
                                    {chainData.expiries.map((exp) => (
                                        <option key={exp} value={exp} className="bg-white dark:bg-[#121c2b] text-gray-900 dark:text-white">
                                            {formatExpiryShort(exp)}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* USD <-> INR for Crypto */}
                        {isCrypto && (
                            <div className="flex items-center bg-gray-100 dark:bg-[#121c2b] p-0.5 rounded-lg border border-gray-200 dark:border-white/10">
                                <button
                                    onClick={() => setCurrency("USD")}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                                        currency === "USD" ? "bg-purple-600 text-white shadow-xs" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                                    }`}
                                >
                                    $ USD
                                </button>
                                <button
                                    onClick={() => setCurrency("INR")}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                                        currency === "INR" ? "bg-emerald-600 text-white shadow-xs" : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                                    }`}
                                    title={`1 USD = ₹${usdtInrRate.toFixed(2)}`}
                                >
                                    ₹ INR
                                </button>
                            </div>
                        )}

                    </div>

                    {/* Page Tabs */}
                    <div className="flex items-center shrink-0 bg-gray-100 dark:bg-[#121c2b] p-1 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10 shadow-2xs">
                        <button
                            onClick={() => setActiveTab("trade")}
                            className={`px-2.5 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "trade"
                                    ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <FiLayers size={13} />
                            <span>Trade<span className="hidden min-[1680px]:inline"> &amp; Strategy</span></span>
                        </button>
                        <button
                            onClick={() => setActiveTab("positions")}
                            className={`px-2.5 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "positions"
                                    ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <span>Positions</span>
                            {openPositions.length > 0 && (
                                <span className="rounded-full bg-emerald-600 text-white text-[10px] px-1.5 py-0.2 font-mono">
                                    {openPositions.length}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => {
                                setActiveTab("orders");
                                loadOrders();
                            }}
                            className={`px-2.5 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "orders"
                                    ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <FiList size={13} />
                            <span>Orders</span>
                            {orders.filter((o) => o.status === "PENDING").length > 0 ? (
                                <span className="rounded-full bg-amber-500 text-white text-[10px] px-1.5 py-0.2 font-mono font-black animate-pulse">
                                    {orders.filter((o) => o.status === "PENDING").length}
                                </span>
                            ) : orders.length > 0 ? (
                                <span className="text-[10px] text-gray-400 font-mono">({orders.length})</span>
                            ) : null}
                        </button>
                        <button
                            onClick={() => setActiveTab("history")}
                            className={`px-2.5 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                                activeTab === "history"
                                    ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <span>History</span>
                            {closedPositions.length > 0 && (
                                <span className="text-[10px] text-gray-400 font-mono">({closedPositions.length})</span>
                            )}
                        </button>
                        <button
                            onClick={() => setActiveTab("leaderboard")}
                            className={`px-2.5 py-1 rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                activeTab === "leaderboard"
                                    ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <span>🏆</span>
                            <span className="hidden min-[1680px]:inline">Leaderboard</span>
                        </button>
                    </div>


                    {/* Right: Virtual Capital Card & Pro */}
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        <div
                            className="bg-gray-100 dark:bg-[#121c2b] px-3 py-1 rounded-xl border border-gray-200 dark:border-white/10 flex items-center gap-3"
                            title={!isCrypto && !isPro ? "Free trial: practicing with ₹1,00,000 virtual capital. Pro gives ₹5,00,000 + full platform access." : undefined}
                        >
                            <div>
                                <div className="text-[9px] text-gray-400 font-extrabold uppercase tracking-wider">
                                    {isCrypto ? "Virtual USDT" : isPro ? "Virtual Cash" : "Trial Cash"}
                                </div>
                                <div className="font-mono font-black text-xs text-gray-900 dark:text-white tabular-nums">
                                    {isCrypto ? (
                                        currency === "INR" ? (
                                            `₹${Number(cryptoWallet.balance * usdtInrRate).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                                        ) : (
                                            `$${Number(cryptoWallet.balance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                        )
                                    ) : (
                                        formatRupees(virtualCash)
                                    )}
                                </div>
                            </div>

                            {!isCrypto ? (
                                <button
                                    onClick={() => setRefillModalOpen(true)}
                                    className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10.5px] shadow-xs cursor-pointer transition flex items-center gap-1 shrink-0"
                                    title="Add +₹5,00,000 Virtual Capital for ₹100"
                                >
                                    <FiPlusCircle size={11} />
                                    <span>Refill</span>
                                </button>
                            ) : (
                                <button
                                    onClick={() => {
                                        const resetW = { balance: 10000, margin_utilized: 0 };
                                        saveGuestCryptoWallet(resetW);
                                        setCryptoWallet(resetW);
                                        setFeedback({ type: "success", text: "Crypto Virtual Capital reset to $10,000 USDT!" });
                                    }}
                                    className="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10.5px] shadow-xs cursor-pointer transition flex items-center gap-1 shrink-0"
                                >
                                    <FiRefreshCw size={11} />
                                    <span>Reset</span>
                                </button>
                            )}
                        </div>

                        {!isPro ? (
                            <button
                                onClick={() => setProModalOpen(true)}
                                className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-[11px] shadow-xs cursor-pointer transition flex items-center gap-1"
                            >
                                <FiAward size={12} />
                                <span className="hidden min-[1680px]:inline">Upgrade to Pro (₹499/mo)</span>
                                <span className="hidden sm:max-[1679px]:inline">Pro ₹499/mo</span>
                                <span className="sm:hidden">Pro</span>
                            </button>
                        ) : (
                            <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 font-black text-[10px] flex items-center gap-1">
                                <span>⭐</span>
                                <span className="hidden sm:inline">Pro Active</span>
                            </span>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Content Workspace */}
            <main className="w-full max-w-[1720px] mx-auto px-3 sm:px-6 pt-3 space-y-3">
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
                            <span className="font-semibold">{feedback.text}</span>
                        </div>
                        <button onClick={() => setFeedback(null)} className="cursor-pointer font-bold ml-2 text-gray-500 hover:text-gray-800 dark:hover:text-white">✕</button>
                    </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* 1. TRADE & STRATEGY WORKBENCH TAB */}
                {/* ----------------------------------------------------------------- */}
                {activeTab === "trade" && (
                    <div className="space-y-3">
                        {/* Mobile Sub-Tab Navigation (< lg screens) */}
                        <div className="flex lg:hidden items-center justify-between bg-white dark:bg-[#121c2b] p-1.5 rounded-xl border border-gray-200 dark:border-white/10 shadow-2xs">
                            <div className="grid grid-cols-2 gap-1 w-full text-xs font-bold">
                                <button
                                    onClick={() => setMobileTradeTab("chain")}
                                    className={`py-2 px-3 rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 ${
                                        mobileTradeTab === "chain"
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                    }`}
                                >
                                    <FiLayers size={12} />
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
                                    <FiBarChart2 size={12} />
                                    <span>Strategy &amp; Payoff</span>
                                    {basketLegs.length > 0 && (
                                        <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white/20 text-[10px]">
                                            {basketLegs.length}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Split Workstation Layout on Desktop (Left: Option Chain ~500px, Right: Strategy Workspace ~flex-1) */}
                        <div className="flex flex-col lg:flex-row gap-4 items-start">
                            {/* ========================================================= */}
                            {/* LEFT PANEL: STOCKMOJO OPTION CHAIN WINDOW */}
                            {/* ========================================================= */}
                            <div style={{ "--chain-extra": `${Math.max(0, visibleChainCols.length - 2) * 110}px` }} className={`w-full lg:w-[calc(490px+var(--chain-extra))] xl:w-[calc(530px+var(--chain-extra))] 2xl:w-[calc(560px+var(--chain-extra))] lg:max-w-[62vw] shrink-0 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm overflow-hidden flex flex-col lg:sticky lg:top-[72px] ${
                                mobileTradeTab !== "chain" ? "hidden lg:flex" : "flex"
                            }`}>
                                {/* Option Chain Mini Bar: Expiry & ATM Info */}
                                <div className="px-3 py-2 border-b border-gray-100 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-extrabold text-gray-900 dark:text-white uppercase tracking-wider text-[11px]">
                                            Option Chain
                                        </span>
                                        {chainData?.selectedExpiry && (
                                            <span className="px-2 py-0.5 rounded-md bg-gray-200/80 dark:bg-white/10 text-gray-700 dark:text-gray-300 text-[10.5px] font-bold">
                                                {formatExpiryShort(chainData.selectedExpiry)}
                                            </span>
                                        )}
                                        {isCrypto ? (
                                            <>
                                                <span className="text-[10.5px] text-gray-400 font-mono" title="Contract Value on Delta Exchange">
                                                    1 Ctr = <strong className="text-gray-800 dark:text-gray-200">{lotSize} {activeSymbol}</strong>
                                                </span>
                                                <span className="text-[10.5px] text-gray-400 font-mono" title="Total option volume for this expiry, in contracts (calls + puts)">
                                                    Vol <strong className="text-gray-800 dark:text-gray-200">{chainTotalVolume != null ? chainTotalVolume.toLocaleString("en-US") : "—"}</strong>
                                                </span>
                                            </>
                                        ) : (
                                            <span className="text-[10.5px] text-gray-400 font-mono">Lot <strong className="text-gray-800 dark:text-gray-200">{lotSize}</strong></span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1 ml-auto">
                                            {STRIKE_RANGES.map((r) => (
                                                <button
                                                    key={r.label}
                                                    type="button"
                                                    onClick={() => setStrikeRange(r.value)}
                                                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition cursor-pointer ${
                                                        strikeRange === r.value
                                                            ? "bg-emerald-600 text-white shadow-xs"
                                                            : "bg-gray-100 dark:bg-[#121c2b] text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-white/10 hover:border-emerald-500"
                                                    }`}
                                                >
                                                    {r.label}
                                                </button>
                                            ))}
                                    </div>

                                    {atmStrike && !isCrypto && (
                                        <button
                                            type="button"
                                            onClick={scrollToAtm}
                                            className="flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400 font-bold hover:underline cursor-pointer"
                                        >
                                            <span>ATM: {atmStrike}</span>
                                            <span>🎯</span>
                                        </button>
                                    )}

                                    <div className="relative">
                                        <button
                                            type="button"
                                            onClick={() => setChainSettingsOpen((o) => !o)}
                                            className={`w-7 h-7 rounded-lg flex items-center justify-center border transition cursor-pointer ${
                                                chainSettingsOpen
                                                    ? "bg-emerald-600 text-white border-emerald-600"
                                                    : "bg-white dark:bg-[#121c2b] text-gray-500 dark:text-gray-400 border-gray-200 dark:border-white/10 hover:text-emerald-600 hover:border-emerald-500"
                                            }`}
                                            title="Choose option chain columns"
                                        >
                                            <FiSettings size={13} />
                                        </button>
                                        {chainSettingsOpen && (
                                            <>
                                                <div className="fixed inset-0 z-30" onClick={() => setChainSettingsOpen(false)} />
                                                <div className="absolute right-0 top-9 z-40 w-56 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0f1a29] shadow-lg p-3 text-xs font-sans">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="font-extrabold text-gray-900 dark:text-white">Chain Columns</span>
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase">{isCrypto ? "Crypto" : "NSE F&O"}</span>
                                                    </div>
                                                    <div className="space-y-0.5 max-h-72 overflow-y-auto custom-scrollbar">
                                                        {[...marketChainColumns].reverse().map((c) => {
                                                            const checked = c.locked || chainColIds.includes(c.id);
                                                            return (
                                                                <label
                                                                    key={c.id}
                                                                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                                                                        c.locked ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5"
                                                                    }`}
                                                                >
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={checked}
                                                                        disabled={c.locked}
                                                                        onChange={() => toggleChainCol(c.id)}
                                                                        className="accent-emerald-600 w-3.5 h-3.5"
                                                                    />
                                                                    <span className="font-semibold text-gray-800 dark:text-gray-200">{c.label}</span>
                                                                    {c.locked && <span className="ml-auto text-[10px] text-gray-400">always</span>}
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={resetChainCols}
                                                        className="mt-2 w-full text-center text-[11px] font-bold text-gray-500 hover:text-emerald-600 cursor-pointer"
                                                    >
                                                        Reset to default
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {!isCrypto && (
                                    <div className="px-3 py-1.5 border-b border-gray-100 dark:border-white/10 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                                    {symbolList.indices.map((sym) => (
                                        <button
                                            key={sym}
                                            onClick={() => setSymbol(sym)}
                                            className={`px-2.5 py-0.8 rounded-lg font-bold text-[11px] transition cursor-pointer shrink-0 ${
                                                symbol === sym
                                                    ? "bg-emerald-600 text-white shadow-xs"
                                                    : "bg-gray-100 dark:bg-[#121c2b] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#18263a]"
                                            }`}
                                        >
                                            {sym}
                                        </button>
                                    ))}
                                    </div>
                                )}

                                {/* Option Chain Table with Independent Scroll */}
                                <div ref={chainScrollRef} className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto custom-scrollbar">
                                    <table className="w-full text-xs text-center border-collapse">
                                        <thead className="sticky top-0 z-10 shadow-2xs">
                                            <tr className="bg-gray-100/95 dark:bg-[#070e17]/95 backdrop-blur-xs text-[10px] font-extrabold border-b border-gray-200 dark:border-white/10">
                                                {(mobileSide === "both" || mobileSide === "calls") && (
                                                    <th colSpan={visibleChainCols.length + 1} className="py-1.5 bg-blue-50/70 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 uppercase tracking-wider text-[10px] font-black border-r border-gray-200/60 dark:border-white/10">
                                                        CALLS (CE)
                                                    </th>
                                                )}
                                                <th className="py-1.5 w-24 min-w-[76px] bg-gray-100 dark:bg-[#0b1420] text-gray-900 dark:text-white font-black text-[10.5px]">
                                                    STRIKE
                                                </th>
                                                {(mobileSide === "both" || mobileSide === "puts") && (
                                                    <th colSpan={visibleChainCols.length + 1} className="py-1.5 bg-purple-50/70 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 uppercase tracking-wider text-[10px] font-black border-l border-gray-200/60 dark:border-white/10">
                                                        PUTS (PE)
                                                    </th>
                                                )}
                                            </tr>
                                            <tr className="bg-gray-50/90 dark:bg-[#0b1420]/90 backdrop-blur-xs text-gray-400 text-[9.5px] border-b border-gray-200 dark:border-white/10 font-bold">
                                                {(mobileSide === "both" || mobileSide === "calls") && (
                                                    <>
                                                        {visibleChainCols.map((c) => (
                                                            <th key={c.id} className="py-1 px-1.5 text-right font-semibold whitespace-nowrap">{c.label}</th>
                                                        ))}
                                                        <th className="py-1 px-1 text-center w-14">Trade</th>
                                                    </>
                                                )}
                                                <th className="py-1 px-1 w-24 min-w-[76px] bg-gray-50/50 dark:bg-[#070e17]/50 text-gray-800 dark:text-gray-200 font-extrabold text-[10px]">
                                                    Strike
                                                </th>
                                                {(mobileSide === "both" || mobileSide === "puts") && (
                                                    <>
                                                        <th className="py-1 px-1 text-center w-14">Trade</th>
                                                        {[...visibleChainCols].reverse().map((c) => (
                                                            <th key={c.id} className="py-1 px-1.5 text-left font-semibold whitespace-nowrap">{c.label}</th>
                                                        ))}
                                                    </>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-white/5 font-mono text-xs">
                                            {displayRows.length === 0 ? (
                                                <tr>
                                                    <td colSpan={visibleChainCols.length * 2 + 3} className="py-12 text-center text-xs text-gray-400 dark:text-gray-500 font-sans">
                                                        {chainLoading ? "Loading live option chain…" : `No strikes available for ${activeSymbol} on this expiry.`}
                                                    </td>
                                                </tr>
                                            ) : (
                                                displayRows.map((row) => {
                                                    const strikeNum = Number(row.strike);
                                                    const isAtm = atmStrike != null && strikeNum === atmStrike;
                                                    const ceLeg = basketLegs.find((l) => l.strike === strikeNum && l.type === "CE");
                                                    const peLeg = basketLegs.find((l) => l.strike === strikeNum && l.type === "PE");

                                                    return (
                                                        <tr
                                                            key={row.strike}
                                                            ref={isAtm ? atmRowRef : null}
                                                            className={`hover:bg-gray-50/90 dark:hover:bg-white/[0.04] transition-colors ${
                                                                isAtm ? "bg-amber-500/10 dark:bg-amber-500/10 font-bold" : ""
                                                            }`}
                                                        >
                                                            {/* CE Side */}
                                                            {(mobileSide === "both" || mobileSide === "calls") && (
                                                                <>
                                                                    {visibleChainCols.map((c) => {
                                                                        const cell = renderChainCell(row.ce, c.id);
                                                                        return (
                                                                            <td key={c.id} className={`py-1.5 px-1.5 text-right tabular-nums text-[10.5px] whitespace-nowrap ${cell.cls}`}>
                                                                                {cell.text}
                                                                            </td>
                                                                        );
                                                                    })}
                                                                    <td className="py-1.5 px-0.5 text-center w-14">
                                                                        {row.ce?.ltp != null && (
                                                                            <div className="flex items-center justify-center gap-0.5">
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleToggleLeg(row, "CE", "buy")}
                                                                                    className={`px-1.5 py-0.5 min-w-[18px] rounded text-[9.5px] font-black border transition cursor-pointer ${
                                                                                        ceLeg?.action === "buy"
                                                                                            ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                                                                                            : "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                                                                    }`}
                                                                                    title="Buy Call"
                                                                                >
                                                                                    B
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleToggleLeg(row, "CE", "sell")}
                                                                                    className={`px-1.5 py-0.5 min-w-[18px] rounded text-[9.5px] font-black border transition cursor-pointer ${
                                                                                        ceLeg?.action === "sell"
                                                                                            ? "bg-rose-600 text-white border-rose-500 shadow-xs"
                                                                                            : "border-rose-500/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                                                                    }`}
                                                                                    title="Sell Call"
                                                                                >
                                                                                    S
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => openOrderSlip(row, "CE", "buy")}
                                                                                    className="px-1 py-0.5 rounded text-[9px] border border-blue-500/50 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white transition cursor-pointer font-bold"
                                                                                    title="Delta Trade Ticket / Limit Order"
                                                                                >
                                                                                    ⚡
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                </>
                                                            )}

                                                            {/* Strike Column */}
                                                            <td className={`py-1.5 px-1 w-24 min-w-[76px] text-center font-black tabular-nums border-x border-gray-200/60 dark:border-white/5 text-[11.5px] ${
                                                                isAtm
                                                                    ? "text-amber-600 dark:text-amber-400 bg-amber-500/15"
                                                                    : "text-gray-900 dark:text-white bg-gray-50/60 dark:bg-[#070e17]/60"
                                                            }`}>
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <span>{strikeNum}</span>
                                                                    {isAtm && (
                                                                        <span className="text-[8px] px-1 py-0 rounded bg-amber-500 text-black font-black uppercase leading-tight">
                                                                            ATM
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>

                                                            {/* PE Side */}
                                                            {(mobileSide === "both" || mobileSide === "puts") && (
                                                                <>
                                                                    <td className="py-1.5 px-0.5 text-center w-14">
                                                                        {row.pe?.ltp != null && (
                                                                            <div className="flex items-center justify-center gap-0.5">
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => openOrderSlip(row, "PE", "buy")}
                                                                                    className="px-1 py-0.5 rounded text-[9px] border border-blue-500/50 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white transition cursor-pointer font-bold"
                                                                                    title="Delta Trade Ticket / Limit Order"
                                                                                >
                                                                                    ⚡
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleToggleLeg(row, "PE", "buy")}
                                                                                    className={`px-1.5 py-0.5 min-w-[18px] rounded text-[9.5px] font-black border transition cursor-pointer ${
                                                                                        peLeg?.action === "buy"
                                                                                            ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                                                                                            : "border-emerald-500/60 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                                                                    }`}
                                                                                    title="Buy Put"
                                                                                >
                                                                                    B
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleToggleLeg(row, "PE", "sell")}
                                                                                    className={`px-1.5 py-0.5 min-w-[18px] rounded text-[9.5px] font-black border transition cursor-pointer ${
                                                                                        peLeg?.action === "sell"
                                                                                            ? "bg-rose-600 text-white border-rose-500 shadow-xs"
                                                                                            : "border-rose-500/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                                                                    }`}
                                                                                    title="Sell Put"
                                                                                >
                                                                                    S
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    {[...visibleChainCols].reverse().map((c) => {
                                                                        const cell = renderChainCell(row.pe, c.id);
                                                                        return (
                                                                            <td key={c.id} className={`py-1.5 px-1.5 text-left tabular-nums text-[10.5px] whitespace-nowrap ${cell.cls}`}>
                                                                                {cell.text}
                                                                            </td>
                                                                        );
                                                                    })}
                                                                </>
                                                            )}
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* ========================================================= */}
                            {/* RIGHT PANEL: STRATEGY BUILDER, PAYOFF, & EXECUTION */}
                            {/* ========================================================= */}
                            <div className={`flex-1 min-w-0 flex flex-col gap-3.5 ${
                                mobileTradeTab !== "payoff" ? "hidden lg:flex" : "flex"
                            }`}>
                                {/* Strategy Terminal Top Controls Card */}
                                <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm overflow-hidden">
                                    <div className="border-b border-gray-100 dark:border-white/10 bg-gray-50/60 dark:bg-[#070e17]/60 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
                                        {/* Main View Switcher Tabs */}
                                        <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-[#121c2b] p-1 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10">
                                            <button
                                                type="button"
                                                onClick={() => setChartViewTab("presets")}
                                                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                                    chartViewTab === "presets"
                                                        ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                                        : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                                                }`}
                                            >
                                                <span>⚡ Strategies</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setChartViewTab("payoff")}
                                                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                                    chartViewTab === "payoff"
                                                        ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                                        : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                                                }`}
                                            >
                                                <span>📊 Payoff &amp; Risk</span>
                                                {basketLegs.length > 0 && (
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                )}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setChartViewTab("tradingview")}
                                                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                                                    chartViewTab === "tradingview"
                                                        ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                                        : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                                                }`}
                                            >
                                                <span>📈 Technical Chart</span>
                                            </button>
                                        </div>

                                        {/* Quick 1-Click Strategy Presets Bar & Delta Exchange Leverage */}
                                        <div className="flex items-center gap-2 overflow-x-auto text-[11px] font-semibold py-0.5 no-scrollbar">
                                            {isCrypto && (
                                                <div className="flex items-center gap-1 bg-gray-100 dark:bg-[#121c2b] p-0.5 rounded-lg border border-gray-200 dark:border-white/10 text-[10px] font-bold shrink-0">
                                                    <span className="text-gray-400 px-1 uppercase tracking-wider text-[9px]">Leverage:</span>
                                                    {[10, 20, 50, 100].map((lev) => (
                                                        <button
                                                            key={lev}
                                                            type="button"
                                                            onClick={() => setCryptoLeverage(lev)}
                                                            className={`px-1.5 py-0.5 rounded transition cursor-pointer text-[10px] ${
                                                                cryptoLeverage === lev
                                                                    ? "bg-emerald-600 text-white shadow-2xs font-black"
                                                                    : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                                            }`}
                                                            title={`Delta Exchange Option Margin: ${lev}x (${(100/lev).toFixed(0)}% Initial Margin)`}
                                                        >
                                                            {lev}x
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {chartViewTab !== "presets" && (
                                                <div className="flex items-center gap-1">
                                                    <span className="text-[10px] uppercase font-bold text-gray-400 mr-1 hidden sm:inline">Presets:</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => applyPresetHedge("BULL_CALL_SPREAD")}
                                                        className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-[#121c2b] dark:hover:bg-[#1a273b] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 shrink-0 transition cursor-pointer"
                                                    >
                                                        Bull Call
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => applyPresetHedge("BEAR_PUT_SPREAD")}
                                                        className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-[#121c2b] dark:hover:bg-[#1a273b] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:text-rose-600 dark:hover:text-rose-400 shrink-0 transition cursor-pointer"
                                                    >
                                                        Bear Put
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => applyPresetHedge("IRON_CONDOR")}
                                                        className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-[#121c2b] dark:hover:bg-[#1a273b] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400 shrink-0 transition cursor-pointer"
                                                    >
                                                        Iron Condor
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => applyPresetHedge("STRADDLE")}
                                                        className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-[#121c2b] dark:hover:bg-[#1a273b] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400 shrink-0 transition cursor-pointer"
                                                    >
                                                        Straddle
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => applyPresetHedge("SHORT_STRANGLE")}
                                                        className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-[#121c2b] dark:hover:bg-[#1a273b] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:text-teal-600 dark:hover:text-teal-400 shrink-0 transition cursor-pointer"
                                                    >
                                                        Strangle
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Visual Area 1: Ready-Made Strategy Matrix */}
                                    {chartViewTab === "presets" && (
                                        <div className="bg-white dark:bg-[#0b1420] min-h-[420px] max-h-[calc(100vh-300px)] overflow-y-auto custom-scrollbar">
                                            <PresetStrategies
                                                bare
                                                data={chainData}
                                                onApply={(pLegs) => {
                                                    applyFullPreset(pLegs);
                                                    setChartViewTab("payoff");
                                                }}
                                            />
                                        </div>
                                    )}

                                    {/* Visual Area 2: Payoff Chart & Strategy Analytics */}
                                    {chartViewTab === "payoff" && (
                                        <div className="p-4 space-y-3.5">
                                            {/* Horizontal Strategy Analytics KPI Ribbon (6 Clean Cards) */}
                                            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
                                                <div className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70">
                                                    <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Funds Required</div>
                                                    <div className="text-sm font-black tabular-nums text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                                                        {formatActivePrice(payoffData.fundsRequired)}
                                                    </div>
                                                </div>

                                                <div className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70">
                                                    <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Max Profit</div>
                                                    <div className="text-sm font-black tabular-nums text-emerald-600 dark:text-emerald-400 font-mono mt-0.5 truncate">
                                                        {payoffData.maxProfit == null ? "—" : typeof payoffData.maxProfit === "number" ? `+${formatActivePrice(payoffData.maxProfit)}` : payoffData.maxProfit}
                                                    </div>
                                                </div>

                                                <div className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70">
                                                    <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Max Loss</div>
                                                    <div className="text-sm font-black tabular-nums text-rose-600 dark:text-rose-400 font-mono mt-0.5 truncate">
                                                        {payoffData.maxLoss == null ? "—" : typeof payoffData.maxLoss === "number" ? formatActivePrice(payoffData.maxLoss) : payoffData.maxLoss}
                                                    </div>
                                                </div>

                                                <div className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70">
                                                    <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Reward : Risk</div>
                                                    <div className="text-sm font-black tabular-nums text-gray-800 dark:text-gray-200 font-mono mt-0.5">
                                                        {payoffData.riskReward || "—"}
                                                    </div>
                                                </div>

                                                <div className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70">
                                                    <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">POP (Est.)</div>
                                                    <div className="text-sm font-black tabular-nums text-purple-600 dark:text-purple-400 font-mono mt-0.5">
                                                        {payoffData.pop != null ? `${payoffData.pop}%` : "—"}
                                                    </div>
                                                </div>

                                                <div className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70">
                                                    <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Breakevens</div>
                                                    <div className="text-xs font-black tabular-nums text-blue-600 dark:text-blue-400 font-mono mt-0.5 truncate">
                                                        {payoffData.breakevens?.length > 0
                                                            ? payoffData.breakevens.map((b) => (isCrypto ? Number(b).toFixed(1) : Math.round(b))).join(" | ")
                                                            : "—"}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Full-Width Payoff Curve Chart */}
                                            <div className="bg-white dark:bg-[#070e17] rounded-xl border border-gray-200 dark:border-white/10 p-3 min-h-[300px] flex flex-col justify-center">
                                                {basketLegs.length > 0 ? (
                                                    <>
                                                        {renderTargetDateSlider()}
                                                        <PayoffChart
                                                            curve={payoffData.curve}
                                                            spotPrice={spotPrice}
                                                            breakevens={payoffData.breakevens}
                                                            expectedMove={payoffData.expectedMove}
                                                            atmIv={payoffData.atmIv}
                                                            yearsRemaining={payoffData.yearsRemaining}
                                                            height={290}
                                                        />
                                                    </>
                                                ) : (
                                                    <div className="py-14 px-4 text-center text-xs text-gray-400 dark:text-gray-500 space-y-3">
                                                        <div className="text-4xl">📊</div>
                                                        <div className="font-extrabold text-base text-gray-800 dark:text-gray-200">
                                                            No Strategy Selected
                                                        </div>
                                                        <p className="text-xs max-w-sm mx-auto text-gray-500 dark:text-gray-400">
                                                            Click <strong>B</strong> (Buy) or <strong>S</strong> (Sell) on strikes in the Option Chain on the left, or select from Ready-Made Strategies.
                                                        </p>
                                                        <div className="pt-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setChartViewTab("presets")}
                                                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-md shadow-emerald-600/20 transition cursor-pointer inline-flex items-center gap-1.5"
                                                            >
                                                                <span>⚡ Browse Ready-Made Strategies</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Visual Area 3: TradingView Technical Terminal */}
                                    {chartViewTab === "tradingview" && (
                                        <div className="p-4 space-y-2">
                                            <div className="flex items-center justify-between text-xs text-gray-500 px-1">
                                                <span className="font-extrabold text-gray-900 dark:text-white flex items-center gap-1.5">
                                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                                    {activeSymbol} Interactive Chart
                                                </span>
                                                <span className="font-mono text-xs">
                                                    Spot: <strong className="text-gray-900 dark:text-white">{formatActivePrice(spotPrice)}</strong>
                                                </span>
                                            </div>
                                            <div className="h-[420px] w-full rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 bg-[#0b1420]">
                                                <TradingViewChart
                                                    symbol={isCrypto ? cryptoSymbol : symbol}
                                                    height="100%"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* ===================================================== */}
                                {/* STRATEGY BASKET & ORDER EXECUTION PANEL */}
                                {/* ===================================================== */}
                                <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm p-4 space-y-3">
                                    <div className="flex items-center justify-between text-xs border-b border-gray-100 dark:border-white/10 pb-2.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-black text-sm text-gray-900 dark:text-white">
                                                Strategy Legs Basket
                                            </span>
                                            <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-black text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                                                {basketLegs.length} Active {basketLegs.length === 1 ? "Leg" : "Legs"}
                                            </span>
                                        </div>

                                        {basketLegs.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setBasketLegs([])}
                                                className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer flex items-center gap-1"
                                            >
                                                <FiTrash2 size={12} />
                                                <span>Clear Basket</span>
                                            </button>
                                        )}
                                    </div>

                                    {/* Legs List / Table */}
                                    {basketLegs.length === 0 ? (
                                        <div className="p-4 rounded-xl bg-gray-50/70 dark:bg-[#070e17]/70 border border-dashed border-gray-200 dark:border-white/10 text-center text-xs text-gray-400 dark:text-gray-500">
                                            Click <strong>B</strong> (Buy) or <strong>S</strong> (Sell) on any strike in the Option Chain on the left to add legs to your strategy.
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                                            {basketLegs.map((leg) => {
                                                const legTotalShares = leg.qty * (leg.lotSize || lotSize);
                                                const legTotalValue = leg.premium * legTotalShares;

                                                return (
                                                    <div
                                                        key={leg.id}
                                                        className="flex flex-wrap items-center justify-between p-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/70 dark:bg-[#070e17]/70 text-xs shadow-2xs hover:border-emerald-500/40 transition gap-2"
                                                    >
                                                        {/* Left: Action Toggle, Strike, Type */}
                                                        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                                                            <button
                                                                type="button"
                                                                onClick={() => toggleBasketLegAction(leg.id)}
                                                                className={`px-2.5 py-1 rounded-md text-[10.5px] font-black uppercase text-white cursor-pointer shadow-xs transition ${
                                                                    leg.action === "buy" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"
                                                                }`}
                                                                title="Click to toggle Buy/Sell"
                                                            >
                                                                {leg.action}
                                                            </button>

                                                            {/* Strike Stepper */}
                                                            <div className="flex items-center gap-1 bg-white dark:bg-[#121c2b] p-0.5 rounded-lg border border-gray-200 dark:border-white/10">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => rollBasketLegStrike(leg.id, -1)}
                                                                    className="w-5 h-5 rounded flex items-center justify-center bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-[10px] font-bold cursor-pointer"
                                                                    title="Shift Strike Down"
                                                                >
                                                                    ↓
                                                                </button>
                                                                <span className="font-black font-mono text-gray-900 dark:text-white px-1.5 text-xs">
                                                                    {leg.strike} {leg.type}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => rollBasketLegStrike(leg.id, 1)}
                                                                    className="w-5 h-5 rounded flex items-center justify-center bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-[10px] font-bold cursor-pointer"
                                                                    title="Shift Strike Up"
                                                                >
                                                                    ↑
                                                                </button>
                                                            </div>

                                                            <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                                                                @{formatActivePrice(leg.premium)}
                                                            </span>
                                                        </div>

                                                        {/* Right: Lots Stepper, Total Value, Delete */}
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="flex items-center bg-white dark:bg-[#121c2b] rounded-lg border border-gray-200 dark:border-white/10 shadow-2xs">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateBasketLegLots(leg.id, -1)}
                                                                    className="px-2 py-0.5 text-gray-500 hover:text-gray-900 dark:hover:text-white font-bold cursor-pointer"
                                                                >
                                                                    −
                                                                </button>
                                                                <span className="px-1.5 text-xs font-black tabular-nums text-gray-900 dark:text-white font-mono">
                                                                    {leg.qty}{isCrypto ? " Ctr" : "L"}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => updateBasketLegLots(leg.id, 1)}
                                                                    className="px-2 py-0.5 text-gray-500 hover:text-gray-900 dark:hover:text-white font-bold cursor-pointer"
                                                                >
                                                                    +
                                                                </button>
                                                            </div>

                                                            {isCrypto && (
                                                                <span className="text-[10px] text-gray-400 font-mono hidden md:inline">
                                                                    ({(leg.qty * (leg.lotSize || 0.001)).toFixed(3)} {activeSymbol})
                                                                </span>
                                                            )}

                                                            <button
                                                                type="button"
                                                                onClick={() => openLegSl(leg)}
                                                                className={`px-2 py-0.5 rounded-md border text-[10.5px] font-bold font-mono transition cursor-pointer whitespace-nowrap ${
                                                                    toBracket(leg.sl) != null || toBracket(leg.target) != null
                                                                        ? "border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300"
                                                                        : "border-gray-200 dark:border-white/10 bg-white dark:bg-[#121c2b] text-gray-500 dark:text-gray-400 hover:text-rose-600 hover:border-rose-400"
                                                                }`}
                                                                title="Set stop loss / target"
                                                            >
                                                                {toBracket(leg.sl) != null || toBracket(leg.target) != null
                                                                    ? `SL ${leg.sl || "—"} · T ${leg.target || "—"}`
                                                                    : "+ SL"}
                                                            </button>

                                                            <span className="text-[11px] font-mono font-bold text-gray-700 dark:text-gray-300 hidden sm:inline tabular-nums">
                                                                {formatActivePrice(legTotalValue)}
                                                            </span>

                                                            <button
                                                                type="button"
                                                                onClick={() => removeBasketLeg(leg.id)}
                                                                className="text-gray-400 hover:text-rose-600 p-1 cursor-pointer transition"
                                                                title="Delete Leg"
                                                            >
                                                                <FiTrash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Action & Execute Footer */}
                                    <div className="pt-3 border-t border-gray-100 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                                        <div className="text-xs">
                                            <div className="text-[10px] font-bold uppercase text-gray-400 flex items-center gap-1.5">
                                                <span>Virtual Funds Required</span>
                                                {isCrypto && (
                                                    <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                                                        (Delta {cryptoLeverage}x)
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                {formatActivePrice(payoffData.fundsRequired)}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            onClick={handleExecuteHedge}
                                            disabled={isExecuting || basketLegs.length === 0}
                                            className="py-2.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black text-xs sm:text-sm shadow-md shadow-emerald-600/25 transition flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                                        >
                                            <FiCheck size={16} />
                                            <span>{isExecuting ? "Executing Live…" : "⚡ Execute Paper Trade"}</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Floating Mobile Bar (< lg) */}
                        {basketLegs.length > 0 && mobileTradeTab === "chain" && (
                            <div className="lg:hidden fixed bottom-4 inset-x-3 z-30 bg-gray-900/95 text-white p-3 rounded-2xl shadow-2xl border border-gray-700 flex items-center justify-between backdrop-blur-md">
                                <div>
                                    <div className="text-[10px] text-gray-400 font-bold uppercase">{basketLegs.length} Legs in Basket</div>
                                    <div className="font-mono font-black text-xs text-emerald-400">
                                        Req: {formatActivePrice(payoffData.fundsRequired)}
                                    </div>
                                </div>
                                <button
                                    onClick={() => setMobileTradeTab("payoff")}
                                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-black shadow-md flex items-center gap-1.5 cursor-pointer"
                                >
                                    <FiBarChart2 size={13} />
                                    <span>View Strategy →</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* 2. OPEN POSITIONS & REAL-TIME MTM TAB */}
                {/* ----------------------------------------------------------------- */}
                {activeTab === "positions" && (
                    <div className="space-y-4">
                        {/* Summary KPI Ribbon for Open Positions */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Active Positions</div>
                                <div className="text-xl font-black font-mono text-gray-900 dark:text-white mt-1">
                                    {openPositions.length}
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Overall Unrealized P&amp;L</div>
                                <div className={`text-xl font-black font-mono mt-1 ${totalUnrealized >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    {totalUnrealized >= 0 ? "+" : ""}{formatActivePrice(totalUnrealized)}
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Margin Blocked</div>
                                <div className="text-xl font-black font-mono text-gray-900 dark:text-white mt-1">
                                    {formatActivePrice(totalMarginBlocked)}
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Available Capital</div>
                                <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                                    {formatActivePrice(virtualCash)}
                                </div>
                            </div>
                        </div>

                        {/* Positions Table Card */}
                        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm overflow-hidden">
                            <div className="px-4 py-3 bg-gray-50/70 dark:bg-[#070e17]/70 border-b border-gray-100 dark:border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs font-bold">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-black text-gray-900 dark:text-white">Active Positions Ledger</span>
                                    <span className="text-gray-400 font-normal">({openPositions.length} Contracts)</span>
                                </div>

                                <div className="flex items-center gap-2">
                                    {openPositions.length > 0 && (
                                        <>
                                            <button
                                                onClick={() => setShowPositionsPayoff(!showPositionsPayoff)}
                                                className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                                                    showPositionsPayoff
                                                        ? "bg-emerald-600 text-white border-emerald-500 shadow-xs"
                                                        : "bg-white dark:bg-[#121c2b] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-[#18263a]"
                                                }`}
                                            >
                                                <FiBarChart2 size={13} />
                                                <span>{showPositionsPayoff ? "Hide Risk Curve" : "Portfolio Risk Curve"}</span>
                                            </button>
                                            <button
                                                onClick={handleCloseAllPositions}
                                                disabled={closingAll}
                                                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs transition cursor-pointer disabled:opacity-50 shadow-xs"
                                            >
                                                {closingAll ? "Exiting All…" : "Square Off All Positions"}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Collapsible Portfolio Risk Curve */}
                            {showPositionsPayoff && openPositions.length > 0 && (
                                <div className="p-4 bg-gray-50/50 dark:bg-[#070e17]/50 border-b border-gray-100 dark:border-white/10 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <div className="flex items-center gap-2">
                                            <span className="font-extrabold text-gray-900 dark:text-white">Portfolio Curve:</span>
                                            {positionsPayoffData.maxProfit != null && (
                                                <span className="px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold font-mono">
                                                    Max Profit: {typeof positionsPayoffData.maxProfit === "number" ? `+${formatActivePrice(positionsPayoffData.maxProfit)}` : positionsPayoffData.maxProfit}
                                                </span>
                                            )}
                                            {positionsPayoffData.maxLoss != null && (
                                                <span className="px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-bold font-mono">
                                                    Max Loss: {typeof positionsPayoffData.maxLoss === "number" ? formatActivePrice(positionsPayoffData.maxLoss) : positionsPayoffData.maxLoss}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="bg-white dark:bg-[#0b1420] p-3 rounded-xl border border-gray-200 dark:border-white/10">
                                        {renderTargetDateSlider()}
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

                            {/* Positions Table */}
                            {openPositions.length === 0 ? (
                                <div className="py-16 text-center text-gray-400 text-xs space-y-2">
                                    <div className="text-4xl mb-1">📋</div>
                                    <p className="font-bold text-base text-gray-700 dark:text-gray-300">No Open Positions</p>
                                    <p className="text-gray-500">Pick strikes from the Option Chain or a Ready-Made Strategy to start live paper trading.</p>
                                    <div className="pt-2">
                                        <button
                                            onClick={() => setActiveTab("trade")}
                                            className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-extrabold text-xs hover:bg-emerald-700 cursor-pointer shadow-xs"
                                        >
                                            Go to Trade Workstation →
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-xs text-left">
                                        <thead className="bg-gray-100/70 dark:bg-[#070e17]/80 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-white/10 text-[11px] font-extrabold uppercase">
                                            <tr>
                                                <th className="px-4 py-3">Symbol / Strategy</th>
                                                <th className="px-3 py-3 text-center">Side</th>
                                                <th className="px-3 py-3 text-center">Lots</th>
                                                <th className="px-3 py-3">Expiry</th>
                                                <th className="px-3 py-3 text-center">Strike</th>
                                                <th className="px-3 py-3 text-center">Type</th>
                                                <th className="px-4 py-3 text-right">Entry LTP</th>
                                                <th className="px-4 py-3 text-right">Live LTP</th>
                                                <th className="px-4 py-3 text-right">Unrealized P&amp;L</th>
                                                <th className="px-4 py-3 text-center">SL / Target</th>
                                                <th className="px-4 py-3 text-right">Margin Blocked</th>
                                                <th className="px-4 py-3 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-white/5 font-mono text-xs">
                                            {openPositions.map((pos) => {
                                                const pnl = Number(pos.unrealizedPnl || 0);
                                                const isProfit = pnl >= 0;
                                                const entry = Number(pos.entry_price || 0);
                                                const current = Number(pos.current_price || entry);
                                                const pnlPercent = entry > 0 ? ((current - entry) / entry) * 100 : 0;

                                                return (
                                                    <tr key={pos.id} className="hover:bg-gray-50/80 dark:hover:bg-white/[0.03] transition">
                                                        <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">
                                                            <div className="flex items-center gap-1.5">
                                                                <span>{pos.symbol}</span>
                                                                {pos.market === "crypto" && (
                                                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-500/10 text-amber-500 border border-amber-500/30">
                                                                        CRYPTO
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {pos.strategy_name && (
                                                                <div className="text-[10px] text-gray-400 font-sans font-normal truncate max-w-[140px]">
                                                                    {pos.strategy_name}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-3 text-center">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                                pos.side === "long"
                                                                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                                                    : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
                                                            }`}>
                                                                {pos.side === "long" ? "BUY" : "SELL"}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3 text-center font-bold tabular-nums">
                                                            {pos.lots}
                                                        </td>
                                                        <td className="px-3 py-3 font-sans text-gray-700 dark:text-gray-300">
                                                            {formatExpiryShort(pos.expiry)}
                                                        </td>
                                                        <td className="px-3 py-3 text-center font-bold text-gray-900 dark:text-white">
                                                            {pos.strike}
                                                        </td>
                                                        <td className="px-3 py-3 text-center">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                                pos.option_type === "CE"
                                                                    ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400"
                                                                    : "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400"
                                                            }`}>
                                                                {pos.option_type}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-bold tabular-nums text-gray-700 dark:text-gray-300">
                                                            {formatActivePrice(pos.entry_price)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-black tabular-nums text-gray-900 dark:text-white">
                                                            {pos.current_price != null ? formatActivePrice(pos.current_price) : "—"}
                                                        </td>
                                                        <td className={`px-4 py-3 text-right font-black tabular-nums ${
                                                            isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                        }`}>
                                                            {isProfit ? "+" : ""}{formatActivePrice(pnl)}
                                                            <span className="block text-[10px] font-normal opacity-80">
                                                                ({isProfit ? "+" : ""}{pnlPercent.toFixed(1)}%)
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-center font-sans">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openPositionSl(pos)}
                                                                    className="group inline-flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer font-mono text-[11px]"
                                                                    title="Set or change stop loss / target"
                                                                >
                                                                    {pos.stop_loss_price == null && pos.target_price == null ? (
                                                                        <span className="font-sans font-bold text-emerald-600 dark:text-emerald-400 group-hover:underline">+ Add SL</span>
                                                                    ) : (
                                                                        <>
                                                                            <span className="text-rose-600 dark:text-rose-400">
                                                                                SL {pos.stop_loss_price != null ? formatActivePrice(pos.stop_loss_price) : "—"}
                                                                            </span>
                                                                            <span className="text-emerald-600 dark:text-emerald-400">
                                                                                TGT {pos.target_price != null ? formatActivePrice(pos.target_price) : "—"}
                                                                            </span>
                                                                            <span className="font-sans text-[9.5px] text-gray-400 group-hover:text-gray-600">✎ edit</span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 tabular-nums">
                                                            {formatActivePrice(pos.margin_blocked || 0)}
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <button
                                                                onClick={() => handleClosePosition(pos)}
                                                                disabled={closingId === pos.id}
                                                                className="px-3 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-extrabold text-[11px] transition cursor-pointer disabled:opacity-50"
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
                    </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* 2.5 ORDERS & LIMIT ORDER BOOK TAB (Delta Exchange & StockMojo Parity) */}
                {/* ----------------------------------------------------------------- */}
                {activeTab === "orders" && (
                    <div className="space-y-4">
                        {/* Summary KPI Ribbon for Orders */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Total Orders</div>
                                <div className="text-xl font-black font-mono text-gray-900 dark:text-white mt-1">
                                    {orders.length}
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Active Pending</div>
                                <div className="text-xl font-black font-mono text-amber-500 mt-1 flex items-center gap-1.5">
                                    {orders.filter((o) => o.status === "PENDING").length > 0 && (
                                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                    )}
                                    <span>{orders.filter((o) => o.status === "PENDING").length}</span>
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Executed</div>
                                <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                                    {orders.filter((o) => o.status === "EXECUTED").length}
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Cancelled / Rejected</div>
                                <div className="text-xl font-black font-mono text-gray-600 dark:text-gray-400 mt-1">
                                    {orders.filter((o) => o.status === "CANCELLED" || o.status === "REJECTED").length}
                                </div>
                            </div>
                        </div>

                        {/* Orders Table Container */}
                        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs overflow-hidden">
                            {/* Filter Bar */}
                            <div className="p-3 sm:p-4 border-b border-gray-100 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-[#121c2b] p-1 rounded-xl text-xs font-bold">
                                    {["ALL", "PENDING", "EXECUTED", "CANCELLED"].map((filter) => {
                                        const count =
                                            filter === "ALL"
                                                ? orders.length
                                                : filter === "CANCELLED"
                                                ? orders.filter((o) => o.status === "CANCELLED" || o.status === "REJECTED").length
                                                : orders.filter((o) => o.status === filter).length;
                                        return (
                                            <button
                                                key={filter}
                                                type="button"
                                                onClick={() => setOrderFilter(filter)}
                                                className={`px-3 py-1 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                                                    orderFilter === filter
                                                        ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs"
                                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                                }`}
                                            >
                                                <span>{filter}</span>
                                                <span className="text-[10px] text-gray-400 font-mono">({count})</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={loadOrders}
                                        disabled={ordersLoading}
                                        className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer"
                                        title="Refresh Orders"
                                    >
                                        <FiRefreshCw size={13} className={ordersLoading ? "animate-spin" : ""} />
                                    </button>
                                </div>
                            </div>

                            {/* Orders Table */}
                            {(() => {
                                const filteredOrders = orders.filter((o) => {
                                    if (orderFilter === "ALL") return true;
                                    if (orderFilter === "CANCELLED") return o.status === "CANCELLED" || o.status === "REJECTED";
                                    return o.status === orderFilter;
                                });

                                if (filteredOrders.length === 0) {
                                    return (
                                        <div className="py-16 text-center text-gray-400 text-xs space-y-2">
                                            <div className="text-4xl mb-1">📑</div>
                                            <p className="font-bold text-base text-gray-700 dark:text-gray-300">
                                                No {orderFilter !== "ALL" ? orderFilter.toLowerCase() : ""} orders
                                            </p>
                                            <p className="text-gray-500 max-w-sm mx-auto">
                                                Use the fast trade ticket (⚡) in the Option Chain to place Limit and Stop-Loss orders driven by live market ticks.
                                            </p>
                                        </div>
                                    );
                                }

                                return (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-gray-50 dark:bg-[#070e17] text-gray-400 font-bold uppercase text-[10px] border-b border-gray-100 dark:border-white/5 tracking-wider">
                                                <tr>
                                                    <th className="px-4 py-3">Order / Time</th>
                                                    <th className="px-4 py-3">Contract</th>
                                                    <th className="px-4 py-3">Side / Type</th>
                                                    <th className="px-4 py-3 text-right">Quantity</th>
                                                    <th className="px-4 py-3 text-right">Order Price</th>
                                                    <th className="px-4 py-3 text-right">Live LTP</th>
                                                    <th className="px-4 py-3 text-center">SL / Target</th>
                                                    <th className="px-4 py-3 text-center">Status</th>
                                                    <th className="px-4 py-3 text-center">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-white/5 font-mono">
                                                {filteredOrders.map((ord) => {
                                                    const isPending = ord.status === "PENDING";
                                                    const isExecuted = ord.status === "EXECUTED";
                                                    const isCancelled = ord.status === "CANCELLED" || ord.status === "REJECTED";
                                                    const isBuy = (ord.side || "").toLowerCase() === "buy";
                                                    const orderTime = ord.created_at ? new Date(ord.created_at) : new Date();

                                                    // Calculate current LTP for contract if available
                                                    let liveLtp = null;
                                                    if (chainData?.rows?.length && ord.strike) {
                                                        const row = chainData.rows.find((r) => Number(r.strike) === Number(ord.strike));
                                                        if (row) {
                                                            const opt = ord.option_type === "PE" ? row.pe : row.ce;
                                                            if (opt?.ltp) liveLtp = Number(opt.ltp);
                                                        }
                                                    }

                                                    return (
                                                        <tr key={ord.id} className="hover:bg-gray-50/50 dark:hover:bg-white/2 transition">
                                                            <td className="px-4 py-3">
                                                                <div className="font-bold text-gray-900 dark:text-white">
                                                                    #{String(ord.id).slice(-6)}
                                                                </div>
                                                                <div className="text-[10px] text-gray-400 font-sans">
                                                                    {orderTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 font-sans">
                                                                <div className="font-extrabold text-gray-900 dark:text-white flex items-center gap-1.5">
                                                                    <span>{ord.symbol || activeSymbol}</span>
                                                                    <span className="text-gray-400 font-mono text-[11px]">{ord.strike}</span>
                                                                    <span className={`px-1 rounded text-[9.5px] font-black font-mono ${
                                                                        ord.option_type === "CE"
                                                                            ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                                                                            : "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                                                                    }`}>
                                                                        {ord.option_type || "CE"}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[10.5px] text-gray-400">
                                                                    {ord.expiry || chainData?.selectedExpiry || "—"}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-1.5 font-bold">
                                                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                                                                        isBuy
                                                                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                                                                            : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400"
                                                                    }`}>
                                                                        {ord.side?.toUpperCase()}
                                                                    </span>
                                                                    <span className="text-[10.5px] text-gray-500 dark:text-gray-400 font-mono">
                                                                        {ord.order_type || "LIMIT"}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-right">
                                                                <div className="font-bold text-gray-900 dark:text-white">
                                                                    {ord.quantity != null ? ord.quantity : (ord.lots || 1) * (ord.lot_size || lotSize)}
                                                                    <span className="text-[10px] text-gray-400 ml-1 font-sans">
                                                                        {isCrypto ? "Ctr" : "Qty"}
                                                                    </span>
                                                                </div>
                                                                <div className="text-[10px] text-gray-400 font-sans">
                                                                    {ord.lots || 1} {isCrypto ? "contracts" : `lot (${ord.lot_size || lotSize})`}
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-white">
                                                                {ord.order_type === "MARKET" ? (
                                                                    <span className="text-gray-400 font-sans text-xs">Market</span>
                                                                ) : (
                                                                    formatActivePrice(ord.price)
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-right">
                                                                {liveLtp != null ? (
                                                                    <div>
                                                                        <div className="font-bold text-gray-900 dark:text-white">
                                                                            {formatActivePrice(liveLtp)}
                                                                        </div>
                                                                        {isPending && ord.price != null && (
                                                                            <div className={`text-[10px] ${
                                                                                (isBuy && liveLtp <= ord.price) || (!isBuy && liveLtp >= ord.price)
                                                                                    ? "text-emerald-500 font-bold"
                                                                                    : "text-gray-400"
                                                                            }`}>
                                                                                {(((liveLtp - ord.price) / ord.price) * 100).toFixed(1)}% to trg
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-gray-400">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-center text-[10.5px]">
                                                                {ord.stop_loss_price != null || ord.target_price != null ? (
                                                                    <div className="space-y-0.5">
                                                                        {ord.stop_loss_price != null && (
                                                                            <div className="text-rose-500 font-mono">
                                                                                SL: {formatActivePrice(ord.stop_loss_price)}
                                                                            </div>
                                                                        )}
                                                                        {ord.target_price != null && (
                                                                            <div className="text-emerald-500 font-mono">
                                                                                TP: {formatActivePrice(ord.target_price)}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <span className="text-gray-400">—</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                                                                    isPending
                                                                        ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800"
                                                                        : isExecuted
                                                                        ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                                                                        : "bg-gray-100 dark:bg-white/5 text-gray-500 border border-gray-200 dark:border-white/10"
                                                                }`}>
                                                                    {isPending && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                                                                    {ord.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                {isPending ? (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleCancelOrder(ord.id)}
                                                                        disabled={cancellingOrderId === ord.id}
                                                                        className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-extrabold text-[10.5px] transition cursor-pointer disabled:opacity-50"
                                                                    >
                                                                        {cancellingOrderId === ord.id ? "Cancelling…" : "Cancel"}
                                                                    </button>
                                                                ) : (
                                                                    <span className="text-gray-400 text-xs">—</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* 3. CLOSED TRADES & REALIZED P&L TAB */}
                {/* ----------------------------------------------------------------- */}
                {activeTab === "history" && (
                    <div className="space-y-4">
                        {/* Summary KPI Ribbon for Closed Positions */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Total Closed Trades</div>
                                <div className="text-xl font-black font-mono text-gray-900 dark:text-white mt-1">
                                    {closedPositions.length}
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Win Rate</div>
                                <div className={`text-xl font-black font-mono mt-1 ${Number(winRate) >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-700 dark:text-gray-300"}`}>
                                    {winRate}%
                                    <span className="text-xs font-normal text-gray-400 ml-1.5 font-sans">
                                        ({winningTrades}W / {losingTrades}L)
                                    </span>
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Net Realized P&amp;L</div>
                                <div className={`text-xl font-black font-mono mt-1 ${totalRealizedPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                    {totalRealizedPnl >= 0 ? "+" : ""}{formatActivePrice(totalRealizedPnl)}
                                </div>
                            </div>

                            <div className="p-4 rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs">
                                <div className="text-[10.5px] uppercase font-bold text-gray-400">Best Trade P&amp;L</div>
                                <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
                                    {bestTradePnl > 0 ? `+${formatActivePrice(bestTradePnl)}` : "—"}
                                </div>
                            </div>
                        </div>

                        {/* History Table Card */}
                        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm overflow-hidden">
                            <div className="px-4 py-3 bg-gray-50/70 dark:bg-[#070e17]/70 border-b border-gray-100 dark:border-white/10 flex items-center justify-between text-xs font-bold">
                                <span className="text-sm font-black text-gray-900 dark:text-white">Realized P&amp;L History Ledger</span>
                                <span className="text-gray-400 font-normal">({closedPositions.length} Closed Trades)</span>
                            </div>

                            {closedPositions.length === 0 ? (
                                <div className="py-16 text-center text-gray-400 text-xs space-y-1">
                                    <div className="text-4xl mb-1">📜</div>
                                    <p className="font-bold text-base text-gray-700 dark:text-gray-300">No Closed Trades Yet</p>
                                    <p className="text-gray-500">Your squared-off positions and realized returns will appear here.</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-xs text-left">
                                        <thead className="bg-gray-100/70 dark:bg-[#070e17]/80 text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-white/10 text-[11px] font-extrabold uppercase">
                                            <tr>
                                                <th className="px-4 py-3">Symbol</th>
                                                <th className="px-3 py-3 text-center">Side</th>
                                                <th className="px-3 py-3 text-center">Lots</th>
                                                <th className="px-3 py-3">Expiry</th>
                                                <th className="px-3 py-3 text-center">Strike</th>
                                                <th className="px-3 py-3 text-center">Type</th>
                                                <th className="px-4 py-3 text-right">Entry Price</th>
                                                <th className="px-4 py-3 text-right">Exit Price</th>
                                                <th className="px-4 py-3 text-right">Realized Net P&amp;L</th>
                                                <th className="px-4 py-3 text-right">Closed At</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-white/5 font-mono text-xs">
                                            {closedPositions.map((pos) => {
                                                const pnl = Number(pos.realized_pnl || 0);
                                                const isProfit = pnl >= 0;

                                                return (
                                                    <tr key={pos.id} className="hover:bg-gray-50/80 dark:hover:bg-white/[0.03] transition">
                                                        <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">
                                                            <span>{pos.symbol}</span>
                                                        </td>
                                                        <td className="px-3 py-3 text-center">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                                pos.side === "long"
                                                                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                                                                    : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300"
                                                            }`}>
                                                                {pos.side === "long" ? "BUY" : "SELL"}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-3 text-center font-bold tabular-nums">{pos.lots}</td>
                                                        <td className="px-3 py-3 font-sans text-gray-700 dark:text-gray-300">{formatExpiryShort(pos.expiry)}</td>
                                                        <td className="px-3 py-3 text-center font-bold text-gray-900 dark:text-white">{pos.strike}</td>
                                                        <td className="px-3 py-3 text-center font-bold text-blue-600 dark:text-blue-400">{pos.option_type}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatActivePrice(pos.entry_price)}</td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-white">
                                                            {pos.exit_price != null ? formatActivePrice(pos.exit_price) : "—"}
                                                            {pos.exit_reason && (
                                                                <span className={`block mt-0.5 font-sans text-[9.5px] font-black uppercase ${
                                                                    pos.exit_reason === "stop_loss" ? "text-rose-500" : pos.exit_reason === "target" ? "text-emerald-500" : "text-gray-400"
                                                                }`}>
                                                                    {EXIT_REASON_LABELS[pos.exit_reason] || pos.exit_reason}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className={`px-4 py-3 text-right font-black tabular-nums ${
                                                            isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                        }`}>
                                                            {isProfit ? "+" : ""}{formatActivePrice(pnl)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-gray-500 font-sans text-[11px]">
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
                    </div>
                )}

                {/* --------------------------------------------------------------------- */}
                {/* 4. LEADERBOARD TAB */}
                {/* --------------------------------------------------------------------- */}
                {activeTab === "leaderboard" && (
                    <div className="space-y-6 pb-8">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-gray-200 dark:border-white/10 pb-4">
                            <div>
                                <h2 className="text-xl font-black text-gray-900 dark:text-white flex items-center gap-2">
                                    <span>🏆</span>
                                    <span>Paper Trading Trader Leaderboard</span>
                                </h2>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    Real-time rankings based on Net Realized P&amp;L, Win Rate, and Strategy Consistency.
                                </p>
                            </div>

                            <button
                                type="button"
                                onClick={loadLeaderboard}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#121c2b] px-3.5 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#18263a] transition shadow-xs cursor-pointer"
                            >
                                <FiRefreshCw size={12} className={leaderboardLoading ? "animate-spin" : ""} />
                                <span>Refresh Ranking</span>
                            </button>
                        </div>

                        {/* Logged in User's Rank Card */}
                        {leaderboardData?.myRank && (
                            <div className="relative overflow-hidden rounded-2xl border border-emerald-500/40 bg-gradient-to-r from-emerald-500/15 via-teal-500/10 to-transparent p-4 sm:p-5 dark:border-emerald-500/30 dark:from-emerald-950/40 dark:via-teal-950/20 shadow-sm">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white font-black text-lg shadow-md shrink-0">
                                            #{leaderboardData.myRank.rank}
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                                Your Performance Status
                                            </div>
                                            <div className="text-base font-extrabold text-gray-900 dark:text-white">
                                                {leaderboardData.myRank.name} ({leaderboardData.myRank.badge})
                                            </div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                Ranked <strong>#{leaderboardData.myRank.rank}</strong> out of {leaderboardData.leaderboard?.length || 1} registered traders
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6 sm:gap-8 self-end sm:self-center">
                                        <div className="text-right">
                                            <div className="text-[10px] uppercase font-bold text-gray-400">Win Rate</div>
                                            <div className="text-base font-black text-gray-900 dark:text-white">
                                                {leaderboardData.myRank.winRate}%
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] uppercase font-bold text-gray-400">Closed Trades</div>
                                            <div className="text-base font-black text-gray-900 dark:text-white">
                                                {leaderboardData.myRank.closedTrades}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] uppercase font-bold text-gray-400">Realized P&amp;L</div>
                                            <div className={`text-base font-black ${leaderboardData.myRank.netPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                {leaderboardData.myRank.netPnl >= 0 ? "+" : ""}{formatRupees(leaderboardData.myRank.netPnl)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Top 3 Podium */}
                        {leaderboardData?.leaderboard && leaderboardData.leaderboard.length >= 3 && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="rounded-2xl border border-slate-300 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-5 text-center space-y-2 order-2 md:order-1 shadow-xs">
                                    <span className="text-3xl">🥈</span>
                                    <div className="text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">Rank #2</div>
                                    <div className="text-base font-bold text-gray-900 dark:text-white truncate">{leaderboardData.leaderboard[1].name}</div>
                                    <div className={`text-xl font-black ${leaderboardData.leaderboard[1].netPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                        {leaderboardData.leaderboard[1].netPnl >= 0 ? "+" : ""}{formatRupees(leaderboardData.leaderboard[1].netPnl)}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        Win Rate: <strong>{leaderboardData.leaderboard[1].winRate}%</strong> ({leaderboardData.leaderboard[1].closedTrades} Trades)
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-gradient-to-b from-amber-100/60 to-amber-50 dark:from-amber-950/40 dark:to-amber-950/10 p-6 text-center space-y-2 order-1 md:order-2 shadow-md shadow-amber-500/5">
                                    <span className="text-4xl">👑 🥇</span>
                                    <div className="text-[11px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">Rank #1 Leader</div>
                                    <div className="text-lg font-black text-gray-900 dark:text-white truncate">{leaderboardData.leaderboard[0].name}</div>
                                    <div className={`text-2xl font-black ${leaderboardData.leaderboard[0].netPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                        {leaderboardData.leaderboard[0].netPnl >= 0 ? "+" : ""}{formatRupees(leaderboardData.leaderboard[0].netPnl)}
                                    </div>
                                    <div className="text-xs text-amber-800 dark:text-amber-200 font-semibold">
                                        Win Rate: <strong>{leaderboardData.leaderboard[0].winRate}%</strong> ({leaderboardData.leaderboard[0].closedTrades} Trades)
                                    </div>
                                    <div className="inline-block rounded-full bg-amber-500/20 px-3 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                                        {leaderboardData.leaderboard[0].badge}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-amber-300/60 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-5 text-center space-y-2 order-3 shadow-xs">
                                    <span className="text-3xl">🥉</span>
                                    <div className="text-[11px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">Rank #3</div>
                                    <div className="text-base font-bold text-gray-900 dark:text-white truncate">{leaderboardData.leaderboard[2].name}</div>
                                    <div className={`text-xl font-black ${leaderboardData.leaderboard[2].netPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                        {leaderboardData.leaderboard[2].netPnl >= 0 ? "+" : ""}{formatRupees(leaderboardData.leaderboard[2].netPnl)}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        Win Rate: <strong>{leaderboardData.leaderboard[2].winRate}%</strong> ({leaderboardData.leaderboard[2].closedTrades} Trades)
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Leaderboard Table */}
                        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs overflow-hidden">
                            <div className="p-4 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
                                <span className="text-sm font-bold text-gray-900 dark:text-white">
                                    Top Rated Options Traders
                                </span>
                                <span className="text-xs text-gray-500">
                                    {leaderboardData?.leaderboard?.length || 0} Ranked Traders
                                </span>
                            </div>

                            {leaderboardLoading && !leaderboardData && (
                                <div className="p-12 text-center text-xs text-gray-400 animate-pulse">
                                    Loading real-time leaderboard…
                                </div>
                            )}

                            {leaderboardData?.leaderboard && (
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-xs text-left border-collapse">
                                        <thead>
                                            <tr className="bg-gray-50/80 dark:bg-[#070e17]/80 border-b border-gray-200 dark:border-white/10 text-gray-500 font-bold uppercase text-[10px]">
                                                <th className="px-4 py-3">Rank</th>
                                                <th className="px-4 py-3">Trader</th>
                                                <th className="px-4 py-3">Badge / Style</th>
                                                <th className="px-4 py-3 text-right">Trades (W/L)</th>
                                                <th className="px-4 py-3 text-right">Win Rate</th>
                                                <th className="px-4 py-3 text-right">Virtual Balance</th>
                                                <th className="px-4 py-3 text-right">Realized Net P&amp;L</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                                            {leaderboardData.leaderboard.map((trader) => {
                                                const isProfit = trader.netPnl >= 0;
                                                const isMe = leaderboardData?.myRank?.userId === trader.userId;

                                                return (
                                                    <tr
                                                        key={trader.userId}
                                                        className={`hover:bg-gray-50/70 dark:hover:bg-white/[0.03] transition ${
                                                            isMe ? "bg-emerald-50/50 dark:bg-emerald-950/20 font-bold" : ""
                                                        }`}
                                                    >
                                                        <td className="px-4 py-3.5 font-black text-sm">
                                                            {trader.rank === 1 ? "🥇 #1" : trader.rank === 2 ? "🥈 #2" : trader.rank === 3 ? "🥉 #3" : `#${trader.rank}`}
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <div className="flex items-center gap-2.5">
                                                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white overflow-hidden shrink-0">
                                                                    {trader.avatarUrl ? (
                                                                        <img src={trader.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                                                    ) : (
                                                                        trader.name.charAt(0).toUpperCase()
                                                                    )}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="font-bold text-gray-900 dark:text-white truncate max-w-[150px]">
                                                                        {trader.name} {isMe && <span className="text-[10px] text-emerald-600 font-bold">(You)</span>}
                                                                    </div>
                                                                    <div className="text-[10px] text-gray-400">
                                                                        {trader.tradingStyle || "Options Buyer"}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-[#121c2b] px-2.5 py-0.5 text-[10px] font-semibold text-gray-700 dark:text-gray-300">
                                                                {trader.badge}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3.5 text-right tabular-nums text-gray-600 dark:text-gray-300 font-semibold">
                                                            {trader.closedTrades} ({trader.winningTrades}W / {trader.losingTrades}L)
                                                        </td>
                                                        <td className="px-4 py-3.5 text-right tabular-nums">
                                                            <span className={`font-black ${trader.winRate >= 50 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500"}`}>
                                                                {trader.winRate}%
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3.5 text-right font-semibold text-gray-700 dark:text-gray-200 tabular-nums">
                                                            {formatRupees(trader.balance)}
                                                        </td>
                                                        <td className={`px-4 py-3.5 text-right font-black tabular-nums text-sm ${
                                                            isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                        }`}>
                                                            {isProfit ? "+" : ""}{formatRupees(trader.netPnl)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </main>

            {/* --------------------------------------------------------------------- */}
            {/* Symbol Search Modal (7 Indices & 210+ Stocks) */}
            {/* --------------------------------------------------------------------- */}
            {searchOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#121c2b] border border-gray-200 dark:border-gray-700 shadow-2xl p-5 space-y-4 max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
                            <span className="font-extrabold text-gray-900 dark:text-white text-base">Select Asset (7 Indices &amp; 210+ Stocks)</span>
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

                            {filteredStocks.length > 0 && (
                                <div>
                                    <div className="text-[11px] font-bold uppercase text-gray-400 mb-1.5">F&amp;O Stocks ({filteredStocks.length})</div>
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
                                <span>Unlimited Live WebSocket Option Chain (7 Indices &amp; 210+ Stocks)</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <FiCheck className="text-emerald-500 shrink-0 font-bold" />
                                <span>StockMojo Payoff Chart &amp; Advanced Greek Analytics</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <FiCheck className="text-emerald-500 shrink-0 font-bold" />
                                <span>Multi-leg Historical Simulator &amp; Strategy Replay</span>
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
            {/* Stop Loss / Target popup (basket legs + open positions) */}
            {/* --------------------------------------------------------------------- */}
            {slModal && (() => {
                const isLong = slModal.side === "long" || slModal.side === "buy";
                const ref = slModal.ref;
                const err = bracketError(slModal.side, ref, slModal.sl, slModal.target);
                const hasExisting = toBracket(slModal.sl) != null || toBracket(slModal.target) != null;
                const round = (v) => String(Math.max(0.05, Math.round(v * 100) / 100));
                // quick picks as % of the current premium, in the direction that's valid for this side
                const slPicks = [10, 20, 30].map((pct) => ({ pct, v: round(ref * (isLong ? 1 - pct / 100 : 1 + pct / 100)) }));
                const tgtPicks = [25, 50, 100].map((pct) => ({ pct, v: round(isLong ? ref * (1 + pct / 100) : ref * Math.max(0.05, 1 - pct / 200)) }));
                const field = (key, label, tone, picks, hint) => (
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className={`text-[11px] font-extrabold uppercase ${tone}`}>{label}</label>
                            <span className="text-[10px] text-gray-400">{hint}</span>
                        </div>
                        <input
                            type="number"
                            min="0"
                            step="any"
                            value={slModal[key]}
                            autoFocus={key === "sl"}
                            onChange={(e) => setSlModal((m) => ({ ...m, [key]: e.target.value }))}
                            onKeyDown={(e) => e.key === "Enter" && saveSlModal()}
                            placeholder="Not set"
                            className={`w-full px-3 py-2 rounded-lg border bg-white dark:bg-[#121c2b] font-mono text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500 ${
                                err && err.startsWith(key === "sl" ? "SL" : "Target") ? "border-rose-500" : "border-gray-200 dark:border-white/10"
                            }`}
                        />
                        <div className="flex gap-1.5">
                            {picks.map((p) => (
                                <button
                                    key={p.pct}
                                    type="button"
                                    onClick={() => setSlModal((m) => ({ ...m, [key]: p.v }))}
                                    className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-[10.5px] font-bold text-gray-600 dark:text-gray-300 cursor-pointer"
                                >
                                    {key === "sl" ? "−" : "+"}{p.pct}%
                                </button>
                            ))}
                        </div>
                    </div>
                );
                return (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
                        onClick={() => setSlModal(null)}
                        onKeyDown={(e) => e.key === "Escape" && setSlModal(null)}
                    >
                        <div
                            className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 shadow-2xl p-5 space-y-4 text-xs"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-black text-gray-900 dark:text-white">Stop Loss / Target</h3>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                        <span className="font-bold text-gray-700 dark:text-gray-200">{slModal.label}</span> · current premium{" "}
                                        <span className="font-mono font-bold text-gray-900 dark:text-white">{formatActivePrice(ref)}</span>
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSlModal(null)}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer text-base font-bold"
                                >
                                    ✕
                                </button>
                            </div>

                            {field("sl", "Stop Loss", "text-rose-500", slPicks, isLong ? "below current premium" : "above current premium")}
                            {field("target", "Target", "text-emerald-600", tgtPicks, isLong ? "above current premium" : "below current premium")}

                            <p className={`text-[11px] ${err ? "text-rose-500 font-semibold" : "text-gray-400"}`}>
                                {err || "Both are optional. The position exits automatically when the premium reaches either price."}
                            </p>

                            <div className="flex items-center justify-between gap-2 pt-1">
                                {hasExisting ? (
                                    <button
                                        type="button"
                                        onClick={() => saveSlModal(true)}
                                        disabled={savingBracket}
                                        className="text-[11px] font-bold text-gray-500 hover:text-rose-600 cursor-pointer disabled:opacity-50"
                                    >
                                        Remove SL/Target
                                    </button>
                                ) : <span />}
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSlModal(null)}
                                        className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => saveSlModal()}
                                        disabled={!!err || savingBracket}
                                        className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {savingBracket ? "Saving…" : "Save"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* --------------------------------------------------------------------- */}
            {/* Ready-Made Strategies Matrix Modal (Simulator Hedging Parity) */}
            {/* --------------------------------------------------------------------- */}
            {showPresetsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-6">
                    <div className="w-full max-w-4xl max-h-[90vh] rounded-2xl bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 shadow-2xl p-4 sm:p-6 space-y-4 flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/10 pb-3">
                            <div className="flex items-center gap-2.5">
                                <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-black border border-emerald-200 dark:border-emerald-800/60">
                                    ⚡
                                </span>
                                <div>
                                    <h3 className="font-extrabold text-base text-gray-900 dark:text-white">
                                        Ready-Made Hedging Strategy Matrix ({symbol})
                                    </h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        15+ professional multi-leg option strategies with live strike mapping &amp; risk profiles
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowPresetsModal(false)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer text-lg font-bold transition"
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

            {/* --------------------------------------------------------------------- */}
            {/* Fast Trade Ticket Modal (Delta Exchange & StockMojo Parity) */}
            {/* --------------------------------------------------------------------- */}
            {orderModal && (() => {
                const isBuy = orderModal.side === "buy";
                const isMarket = orderModal.orderType === "MARKET";
                const orderPrice = isMarket ? Number(orderModal.ltp || 0) : Number(orderModal.price || 0);
                const totalQty = (orderModal.lots || 1) * (orderModal.lotSize || 1);
                const orderValue = orderPrice * totalQty;
                const notionalUsd = orderModal.isCrypto
                    ? totalQty * (orderModal.spotPrice || orderModal.strike || 0)
                    : totalQty * (orderModal.strike || 0);

                let reqFunds = 0;
                if (isBuy) {
                    reqFunds = orderValue;
                } else {
                    if (orderModal.isCrypto) {
                        reqFunds = Math.max(orderValue, notionalUsd / (orderModal.leverage || 20));
                    } else {
                        reqFunds = Math.max(orderValue, notionalUsd * 0.14);
                    }
                }

                const estFee = orderModal.isCrypto ? notionalUsd * 0.0003 : 20;
                const curBalance = orderModal.isCrypto
                    ? Number(cryptoWallet.balance)
                    : (wallet ? Number(wallet.balance) : 100000);
                const isInsufficient = curBalance < reqFunds;
                const bError = bracketError(orderModal.side, orderPrice, orderModal.sl, orderModal.target);

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4">
                        <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 shadow-2xl p-4 sm:p-5 space-y-4 max-h-[92vh] overflow-y-auto custom-scrollbar">
                            {/* Modal Header */}
                            <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/10 pb-3">
                                <div className="flex items-center gap-2">
                                    <span className={`px-2 py-0.5 rounded text-[10.5px] font-black uppercase font-mono ${
                                        orderModal.optRight === "CE"
                                            ? "bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"
                                            : "bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                                    }`}>
                                        {orderModal.optRight}
                                    </span>
                                    <div>
                                        <h3 className="font-black text-sm text-gray-900 dark:text-white flex items-center gap-1.5">
                                            <span>{orderModal.symbol}</span>
                                            <span className="font-mono text-emerald-600 dark:text-emerald-400">{orderModal.strike}</span>
                                            <span>{orderModal.optRight}</span>
                                        </h3>
                                        <div className="text-[10px] text-gray-400 font-mono">
                                            Exp: {orderModal.expiry || "—"} · Spot: {formatActivePrice(orderModal.spotPrice || spotPrice)}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setOrderModal(null)}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer text-sm font-bold transition"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* BUY / SELL Switcher */}
                            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-gray-100 dark:bg-[#121c2b]">
                                <button
                                    type="button"
                                    onClick={() => setOrderModal((m) => ({ ...m, side: "buy", price: m.ask || m.ltp }))}
                                    className={`py-2 rounded-lg text-xs font-black transition cursor-pointer flex flex-col items-center ${
                                        isBuy
                                            ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/30"
                                            : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                    }`}
                                >
                                    <span>BUY (LONG)</span>
                                    <span className="text-[9.5px] font-normal opacity-85">Pay Premium</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setOrderModal((m) => ({ ...m, side: "sell", price: m.bid || m.ltp }))}
                                    className={`py-2 rounded-lg text-xs font-black transition cursor-pointer flex flex-col items-center ${
                                        !isBuy
                                            ? "bg-rose-600 text-white shadow-md shadow-rose-600/30"
                                            : "text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                    }`}
                                >
                                    <span>SELL (SHORT)</span>
                                    <span className="text-[9.5px] font-normal opacity-85">Block Margin</span>
                                </button>
                            </div>

                            {/* Order Type: MARKET vs LIMIT */}
                            <div className="space-y-1.5">
                                <label className="text-[10.5px] uppercase font-bold text-gray-400">Order Execution Type</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setOrderModal((m) => ({ ...m, orderType: "MARKET" }))}
                                        className={`py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                            isMarket
                                                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                                                : "border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                        }`}
                                    >
                                        Market Order (Instant)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setOrderModal((m) => ({ ...m, orderType: "LIMIT" }))}
                                        className={`py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                                            !isMarket
                                                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400"
                                                : "border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                        }`}
                                    >
                                        Limit Order (Order Book)
                                    </button>
                                </div>
                            </div>

                            {/* Limit Price Input */}
                            {!isMarket && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                        <label className="text-[10.5px] uppercase font-bold text-gray-400">Limit Price</label>
                                        <div className="flex items-center gap-1.5 text-[10px] font-mono">
                                            {orderModal.bid != null && (
                                                <button
                                                    type="button"
                                                    onClick={() => setOrderModal((m) => ({ ...m, price: m.bid }))}
                                                    className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 cursor-pointer"
                                                >
                                                    Bid: {orderModal.bid}
                                                </button>
                                            )}
                                            {orderModal.ask != null && (
                                                <button
                                                    type="button"
                                                    onClick={() => setOrderModal((m) => ({ ...m, price: m.ask }))}
                                                    className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-rose-600 dark:text-rose-400 cursor-pointer"
                                                >
                                                    Ask: {orderModal.ask}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setOrderModal((m) => ({ ...m, price: m.ltp }))}
                                                className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 cursor-pointer"
                                            >
                                                LTP: {orderModal.ltp}
                                            </button>
                                        </div>
                                    </div>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={orderModal.price}
                                        onChange={(e) => setOrderModal((m) => ({ ...m, price: Number(e.target.value) }))}
                                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#121c2b] font-mono text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                                    />
                                </div>
                            )}

                            {/* Quantity / Contracts Input */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <label className="text-[10.5px] uppercase font-bold text-gray-400">
                                        {orderModal.isCrypto ? "Contracts (Ctr)" : "Lots"}
                                    </label>
                                    <span className="text-[10.5px] text-gray-500 dark:text-gray-400 font-mono">
                                        {orderModal.isCrypto
                                            ? `= ${(totalQty * (orderModal.lotSize || 0.001)).toFixed(3)} ${orderModal.symbol}`
                                            : `= ${totalQty} Shares`}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setOrderModal((m) => ({ ...m, lots: Math.max(1, (m.lots || 1) - 1) }))}
                                        className="w-9 h-9 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-gray-700 dark:text-gray-300 flex items-center justify-center cursor-pointer"
                                    >
                                        −
                                    </button>
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        value={orderModal.lots}
                                        onChange={(e) => setOrderModal((m) => ({ ...m, lots: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                                        className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#121c2b] font-mono text-sm text-center text-gray-900 dark:text-white outline-none focus:border-emerald-500 font-black"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setOrderModal((m) => ({ ...m, lots: (m.lots || 1) + 1 }))}
                                        className="w-9 h-9 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 font-bold text-gray-700 dark:text-gray-300 flex items-center justify-center cursor-pointer"
                                    >
                                        +
                                    </button>
                                </div>
                                <div className="flex items-center gap-1.5 pt-1">
                                    {[1, 2, 5, 10, 25, 50].map((num) => (
                                        <button
                                            key={num}
                                            type="button"
                                            onClick={() => setOrderModal((m) => ({ ...m, lots: num }))}
                                            className={`flex-1 py-1 rounded-lg text-[10.5px] font-bold font-mono transition cursor-pointer ${
                                                orderModal.lots === num
                                                    ? "bg-emerald-600 text-white shadow-xs"
                                                    : "bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300"
                                            }`}
                                        >
                                            {num}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Delta Leverage Slider (If Crypto Seller) */}
                            {orderModal.isCrypto && !isBuy && (
                                <div className="p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50 space-y-2">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="text-[10.5px] font-bold uppercase text-gray-400">Delta Short Leverage</span>
                                        <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-xs">
                                            {orderModal.leverage || 20}x
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {[10, 20, 50, 100].map((lev) => (
                                            <button
                                                key={lev}
                                                type="button"
                                                onClick={() => setOrderModal((m) => ({ ...m, leverage: lev }))}
                                                className={`flex-1 py-1 rounded-lg text-xs font-mono font-black transition cursor-pointer ${
                                                    (orderModal.leverage || 20) === lev
                                                        ? "bg-emerald-600 text-white shadow-xs"
                                                        : "bg-gray-200/60 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                                }`}
                                            >
                                                {lev}x
                                            </button>
                                        ))}
                                    </div>
                                    <div className="text-[10px] text-gray-400">
                                        Initial Margin: {(100 / (orderModal.leverage || 20)).toFixed(1)}% of Notional Value
                                    </div>
                                </div>
                            )}

                            {/* Stop-Loss & Target Brackets */}
                            <div className="grid grid-cols-2 gap-2.5">
                                <div className="space-y-1">
                                    <label className="text-[10.5px] uppercase font-bold text-rose-500">Stop-Loss Price</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={orderModal.sl}
                                        onChange={(e) => setOrderModal((m) => ({ ...m, sl: e.target.value }))}
                                        placeholder="Optional"
                                        className="w-full px-3 py-1.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#121c2b] font-mono text-xs text-gray-900 dark:text-white outline-none focus:border-rose-500"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10.5px] uppercase font-bold text-emerald-500">Target Price</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={orderModal.target}
                                        onChange={(e) => setOrderModal((m) => ({ ...m, target: e.target.value }))}
                                        placeholder="Optional"
                                        className="w-full px-3 py-1.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#121c2b] font-mono text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                                    />
                                </div>
                            </div>
                            {bError && (
                                <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                                    {bError}
                                </div>
                            )}

                            {/* Telemetry Matrix: Notional, Value, Required Funds, Available Cash */}
                            <div className="p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#070e17] space-y-2">
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-gray-400">Contract Notional</div>
                                        <div className="font-mono font-bold text-gray-900 dark:text-white mt-0.5">
                                            {formatActivePrice(notionalUsd)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-gray-400">Order Premium Value</div>
                                        <div className="font-mono font-bold text-gray-900 dark:text-white mt-0.5">
                                            {formatActivePrice(orderValue)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-gray-400">Virtual Funds Required</div>
                                        <div className={`font-mono font-black text-sm mt-0.5 ${
                                            isInsufficient ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
                                        }`}>
                                            {formatActivePrice(reqFunds)}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase font-bold text-gray-400">Available Virtual Funds</div>
                                        <div className="font-mono font-bold text-gray-700 dark:text-gray-300 mt-0.5">
                                            {formatActivePrice(curBalance)}
                                        </div>
                                    </div>
                                </div>
                                <div className="pt-2 border-t border-gray-200/60 dark:border-white/5 flex items-center justify-between text-[10.5px] text-gray-400">
                                    <span>Est. Exchange Fee:</span>
                                    <span className="font-mono text-gray-700 dark:text-gray-300">
                                        {formatActivePrice(estFee)}
                                    </span>
                                </div>
                            </div>

                            {/* Insufficient funds warning */}
                            {isInsufficient && (
                                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-bold flex items-center gap-2">
                                    <FiAlertCircle size={15} />
                                    <span>Insufficient Virtual Funds. Required: {formatActivePrice(reqFunds)}, Available: {formatActivePrice(curBalance)}.</span>
                                </div>
                            )}

                            {/* Dual Action Footer */}
                            <div className="flex items-center gap-2.5 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const newLeg = {
                                            id: ++legIdCounter,
                                            action: orderModal.side,
                                            type: orderModal.optRight,
                                            strike: orderModal.strike,
                                            premium: Number(orderModal.ltp),
                                            qty: orderModal.lots,
                                            lotSize: orderModal.lotSize,
                                            expiry: orderModal.expiry,
                                            iv: orderModal.iv,
                                            delta: orderModal.delta,
                                            sl: orderModal.sl || null,
                                            target: orderModal.target || null,
                                        };
                                        setBasketLegs((prev) => [...prev, newLeg]);
                                        setOrderModal(null);
                                        setChartViewTab("payoff");
                                    }}
                                    className="flex-1 py-2.5 px-3 rounded-xl border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 font-extrabold text-xs transition cursor-pointer flex items-center justify-center gap-1.5"
                                >
                                    <FiPlusCircle size={14} />
                                    <span>+ Add to Basket</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleExecuteDirectOrder(orderModal)}
                                    disabled={isExecuting || isInsufficient || !!bError}
                                    className={`flex-1 py-2.5 px-4 rounded-xl text-white font-black text-xs shadow-md transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                        isBuy ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25" : "bg-rose-600 hover:bg-rose-700 shadow-rose-600/25"
                                    }`}
                                >
                                    <FiZap size={14} />
                                    <span>
                                        {isExecuting
                                            ? "Placing…"
                                            : isMarket
                                            ? `⚡ Market ${orderModal.side.toUpperCase()}`
                                            : `⚡ Place Limit Order`}
                                    </span>
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
