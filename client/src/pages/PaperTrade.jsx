// pages/PaperTrade.jsx — Commercial Live Paper Trading & StockMojo Strategy Workstation
// Complete StockMojo Parity:
// Top Header: [50] NIFTY < > symbol switcher, Save, Saved, Reset/New, live clock, Virtual Cash + Refill button, Pro status.
// Left Column: StockMojo Option Chain (SPOT, VIX, FUT, Hide Chain, Expiry pills, OiBars, Center Strike, B/S & LotsInput).
// Right Column (Top): 4 Chart Tabs (Payoff, Strategy Chart, Symbol Chart, Combined) + Payoff Settings (What-If sliders) +
//                     Side-by-side Payoff Area (Left 6 Summary KPI stack + Right PayoffChart).
// Right Column (Bottom): Sub-tabs (Positions [basket], Greeks, Open Trades [live portfolio], Orders, History, Ready-Made, Leaderboard).

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useSpanMargin, spanSourceLabel } from "../hooks/useSpanMargin";
import { useOptionChain, contractStaleness } from "../hooks/useOptionChain";
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
import { getLiveSocket } from "../services/liveSocket";
import { createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";
import { formatRupees, formatPrice, formatOi, formatDateTime, formatPercent } from "../utils/format";
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
    getSpanExposureBreakdown,
    evaluationExpiryOf,
    legMultiplier,
    otherAction,
} from "../utils/payoff";
import { yearsToExpiry, daysUntilExpiry, bsPrice } from "../utils/blackScholes";
import PayoffChart from "../components/PayoffChart";
import StrategyTradingViewChart from "../components/StrategyTradingViewChart";
import TradingViewChart from "../components/TradingViewChart";
import PresetStrategies from "../components/PresetStrategies";
import LotsInput, { MAX_LOTS } from "../components/strategy/LotsInput";
import OiBar from "../components/OiBar";
import PortfolioGreeksTable from "../components/strategy/PortfolioGreeksTable";
import SaveButton from "../components/SaveButton";
import SavedStrategiesModal from "../components/SavedStrategiesModal";
import SlTgModal from "../components/strategy/SlTgModal";
import SquareOffAlertBanner from "../components/strategy/SquareOffAlertBanner";
import ContractChartModal from "../components/ContractChartModal";
import StaleBadge from "../components/strategy/StaleBadge";
import { SymbolLogo, getSymbolMeta } from "../utils/symbolIcons";
import { fetchOptionChain, fetchSymbolList } from "../services/optionChainApi";
import { saveStrategy } from "../services/strategiesApi";
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
    FiFolder,
    FiMaximize,
    FiMinimize,
    FiX,
} from "react-icons/fi";

const BACKEND_BASE = import.meta.env.VITE_API_URL || "http://localhost:5001";
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getPositionMarginBlocked(pos, spot = null) {
    if (!pos) return 0;
    const lots = Number(pos.lots || 1);
    const lotSize = Number(pos.lot_size || 50);
    const totalShares = lots * lotSize;
    const isLong = pos.side === "long" || pos.side === "buy";

    // If margin_blocked was explicitly stored as a positive number
    if (pos.margin_blocked != null && Number(pos.margin_blocked) > 0) {
        return Number(pos.margin_blocked);
    }
    // For long options (buying), the capital / margin required is the premium paid
    if (isLong) {
        const entry = Number(pos.entry_price || 0);
        return Math.round(entry * totalShares * 100) / 100;
    }
    // For short options (selling), calculate standard SPAN/exposure notional margin
    const refPrice = Number(spot || pos.strike || 0);
    const notional = refPrice * totalShares;
    const isCryptoSym = pos.market === "crypto" || ["BTC", "ETH", "SOL"].includes(String(pos.symbol || "").toUpperCase());
    const marginRate = isCryptoSym ? 0.05 : 0.085;
    return Math.round(notional * marginRate * 100) / 100;
}

function formatStockMojoDateTime(d) {
    if (!d) return "";
    const day = d.getDate();
    const month = MONTHS_SHORT[d.getMonth()];
    const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    return `${day} ${month}, ${timeStr}`;
}

function formatExpiryShort(sqlDate) {
    if (!sqlDate) return "";
    const parts = String(sqlDate).slice(0, 10).split("-");
    if (parts.length < 3) return sqlDate;
    const [, m, d] = parts.map(Number);
    return `${d} ${MONTHS_SHORT[m - 1] || ""}`;
}

function formatDelta(value) {
    return value == null || Number.isNaN(value) ? "-" : Number(value).toFixed(2);
}

function formatRiskReward(profit, loss, rewardRiskMode) {
    if (profit == null || loss == null) return "—";
    if (loss === "Unlimited") return rewardRiskMode ? "0.00 : 1" : "1 : ∞";
    if (profit === "Unlimited") return rewardRiskMode ? "∞ : 1" : "1 : 0.00";
    if (typeof profit !== "number" || typeof loss !== "number") return "—";
    const p = Math.abs(profit);
    const l = Math.abs(loss);
    if (l < 0.01) return "∞";
    if (p < 0.01) return "0.00";
    if (rewardRiskMode) {
        return `${(p / l).toFixed(2)} : 1`;
    }
    return `1 : ${(p / l).toFixed(2)}`;
}

const DEFAULT_FAVORITES = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
const FAVORITES_KEY = "bazaarSync.paperTrade.favoriteSymbols";

function loadFavorites() {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_FAVORITES;
    } catch {
        return DEFAULT_FAVORITES;
    }
}

function SymbolOption({ sym, active, isFav, onPick, onToggleFav }) {
    const meta = getSymbolMeta(sym);
    return (
        <div
            onClick={() => onPick(sym)}
            className={`flex items-center justify-between px-3 py-2 cursor-pointer transition rounded-lg mx-1 my-0.5 ${
                active
                    ? "bg-emerald-50/80 text-emerald-900 font-bold dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "hover:bg-gray-50 text-gray-800 dark:text-gray-200 dark:hover:bg-gray-800/60"
            }`}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                <SymbolLogo symbol={sym} size="sm" />
                <div className="truncate">
                    <div className="text-xs font-bold leading-tight">{sym}</div>
                    <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{meta.name || sym}</div>
                </div>
            </div>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleFav(sym);
                }}
                className={`px-1.5 py-0.5 text-xs transition ${
                    isFav ? "text-amber-500 hover:text-amber-600 scale-110" : "text-gray-300 hover:text-gray-400 dark:text-gray-600"
                }`}
                title={isFav ? "Remove from favorites" : "Add to favorites"}
            >
                ★
            </button>
        </div>
    );
}

const DEFAULT_COLUMNS = {
    oi: true, lot: false, callDelta: true, putDelta: true, iv: false,
    theta: false, vega: false, gamma: false,
};

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
    return { balance: 10000, margin_utilized: 0 };
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
    return { balance: 100000, margin_utilized: 0 };
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

let legIdCounter = Date.now();

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
        dataLoadedAt,
        staleNow,
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
    const [cryptoLeverage, setCryptoLeverage] = useState(20);
    const [cryptoWallet, setCryptoWallet] = useState(loadGuestCryptoWallet);

    const isCrypto = marketMode === "crypto";
    const activeSymbol = isCrypto ? cryptoSymbol : symbol;
    const chainData = isCrypto ? cryptoChainData : indianChainData;
    const chainLoading = isCrypto ? cryptoLoading : indianChainLoading;
    const chainError = isCrypto ? cryptoError : indianChainError;
    const changeExpiry = isCrypto
        ? (_sym, exp) => {
            setSelectedCryptoExpiry(exp);
            fetchCryptoOptionChain(cryptoSymbol, exp, false);
        }
        : changeIndianExpiry;
    const marketStatus = isCrypto ? { isOpen: true, nextOpen: null } : indianMarketStatus;
    const isLive = isCrypto ? true : indianIsLive;
    const lastUpdated = isCrypto ? new Date().toISOString() : indianLastUpdated;

    // Fetch Live Crypto Option Chain from Delta Exchange
    const fetchCryptoOptionChain = useCallback(async (coin = cryptoSymbol, exp = selectedCryptoExpiry, isSilent = false) => {
        if (!isSilent) setCryptoLoading(true);
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

            const expiryMeta = {};
            if (Array.isArray(data.expiries)) {
                data.expiries.forEach((e) => {
                    if (e && typeof e === "object" && e.raw) {
                        expiryMeta[e.raw] = e;
                    }
                });
            }

            setCryptoChainData({
                symbol: coin,
                spotPrice: spot,
                spotChange: (spot * (Number(data.spot24hChange) || 0)) / 100,
                spotChangePercent: Number(data.spot24hChange) || 0,
                selectedExpiry: activeExp,
                expiries,
                expiryMeta,
                lotSize: CRYPTO_COINS.find((c) => c.symbol === coin)?.defaultLot || 1,
                atmStrike: closestAtm,
                rows,
            });
        } catch (err) {
            console.error("[PaperTrade] fetchCryptoOptionChain error:", err);
            setCryptoError(err.message);
        } finally {
            if (!isSilent) setCryptoLoading(false);
        }
    }, [cryptoSymbol, selectedCryptoExpiry]);

    // Live tick streamer (Delta Exchange poller every 3s)
    useEffect(() => {
        if (marketMode !== "crypto") return;
        fetchCryptoOptionChain(cryptoSymbol, selectedCryptoExpiry, false);
        const timer = setInterval(() => {
            fetchCryptoOptionChain(cryptoSymbol, selectedCryptoExpiry, true);
        }, 3000);
        return () => clearInterval(timer);
    }, [marketMode, cryptoSymbol, selectedCryptoExpiry, fetchCryptoOptionChain]);

    const staleOpts = useMemo(
        () => ({
            isLive: isCrypto ? true : indianIsLive,
            marketOpen: isCrypto ? true : indianMarketStatus.isOpen,
            feedConnected: isCrypto ? true : indianMarketStatus.feedConnected,
            dataLoadedAt,
            now: staleNow,
        }),
        [isCrypto, indianIsLive, indianMarketStatus, dataLoadedAt, staleNow]
    );

    // Live clock timer
    const [currentTime, setCurrentTime] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Full screen
    const containerRef = useRef(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    useEffect(() => {
        function onFsChange() {
            setIsFullscreen(!!document.fullscreenElement);
        }
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);
    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        } else {
            containerRef.current?.requestFullscreen?.().catch(() => {});
        }
    }

    // Symbol Picker & Favorites
    const [symbolList, setSymbolList] = useState({ indices: DEFAULT_FAVORITES, stocks: [] });
    const [favorites, setFavorites] = useState(loadFavorites);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");

    useEffect(() => {
        fetchSymbolList()
            .then((res) => {
                if (res) {
                    setSymbolList({
                        indices: res.indices?.length ? res.indices : DEFAULT_FAVORITES,
                        stocks: res.stocks || [],
                    });
                }
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        } catch {}
    }, [favorites]);

    const filteredIndices = useMemo(
        () => symbolList.indices.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );
    const filteredStocks = useMemo(
        () => symbolList.stocks.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );

    function toggleFavorite(sym) {
        setFavorites((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
    }
    function cycleSymbol(dir) {
        if (favorites.length < 2) return;
        const idx = favorites.indexOf(activeSymbol);
        const base = idx >= 0 ? idx : 0;
        const next = favorites[(base + dir + favorites.length) % favorites.length];
        setSymbol(next);
    }
    function pickSymbol(sym) {
        setSymbol(sym);
        setPickerOpen(false);
        setPickerQuery("");
    }

    // View Tabs & Workspace states
    const [chartTab, setChartTab] = useState("payoff"); // 'payoff' | 'strategy' | 'nifty' | 'combined'
    const [tab, setTab] = useState("positions"); // 'positions' | 'greeks' | 'open_trades' | 'orders' | 'history' | 'presets' | 'leaderboard'
    const [rewardRiskOrder, setRewardRiskOrder] = useState(false);
    const [payoffSettingsOpen, setPayoffSettingsOpen] = useState(false);
    const [whatIfSpotPct, setWhatIfSpotPct] = useState(0);
    const [whatIfDaysForward, setWhatIfDaysForward] = useState(0);
    const [whatIfIvShift, setWhatIfIvShift] = useState(0);

    // Option Chain states
    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [atmBasis, setAtmBasis] = useState("spot"); // 'spot' | 'future' | 'synth'
    const [showAtmDistance, setShowAtmDistance] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [savedOpen, setSavedOpen] = useState(false);
    const [hideChain, setHideChain] = useState(false);
    const [strikeAsc, setStrikeAsc] = useState(true);
    const [mobileView, setMobileView] = useState("all");
    const [chartModal, setChartModal] = useState(null);

    // Positions Table states
    const [legsTopFirst, setLegsTopFirst] = useState(true);
    const [slTgEditId, setSlTgEditId] = useState(null);
    const [slTgDraft, setSlTgDraft] = useState({ sl: "", tg: "" });
    const [squareOffAlert, setSquareOffAlert] = useState(null);
    const alertedLegsRef = useRef(new Set());

    // 2. Wallet & Paper Positions State
    const [wallet, setWallet] = useState(null);
    const [openPositions, setOpenPositions] = useState([]);
    const [closedPositions, setClosedPositions] = useState([]);
    const [feedback, setFeedback] = useState(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [closingId, setClosingId] = useState(null);
    const [closingAll, setClosingAll] = useState(false);

    // Orders Management State
    const [orders, setOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [orderFilter, setOrderFilter] = useState("ALL");
    const [cancellingOrderId, setCancellingOrderId] = useState(null);

    // Leaderboard
    const [leaderboardData, setLeaderboardData] = useState(null);
    const [leaderboardLoading, setLeaderboardLoading] = useState(false);

    // Modals
    const [refillModalOpen, setRefillModalOpen] = useState(false);
    const [proModalOpen, setProModalOpen] = useState(false);
    const [paymentLoading, setPaymentLoading] = useState(false);
    const [orderModal, setOrderModal] = useState(null);
    const [slModal, setSlModal] = useState(null);
    const [savingBracket, setSavingBracket] = useState(false);

    // 3. Strategy Basket Legs (Matching StrategyBuilder interface)
    const [legs, setLegs] = useState([]);
    const basketLegs = legs;
    const setBasketLegs = setLegs;

    const rowByStrike = useMemo(() => {
        const map = new Map();
        (chainData?.rows || []).forEach((r) => map.set(Number(r.strike), r));
        return map;
    }, [chainData]);

    const strikeGap = useMemo(() => {
        if (!chainData?.rows || chainData.rows.length < 2) return 50;
        return Math.abs(Number(chainData.rows[1].strike) - Number(chainData.rows[0].strike)) || 50;
    }, [chainData]);

    const spotPrice = chainData?.spotPrice ? Number(chainData.spotPrice) : null;
    const currentCryptoCoin = useMemo(() => CRYPTO_COINS.find((c) => c.symbol === cryptoSymbol) || CRYPTO_COINS[0], [cryptoSymbol]);
    const lotSize = isCrypto ? currentCryptoCoin.defaultLot : (chainData?.lotSize ? Number(chainData.lotSize) : 50);

    const effectiveAtmPrice = useMemo(() => {
        if (!chainData) return null;
        if (atmBasis === "future") return chainData.futurePrice ?? chainData.spotPrice;
        if (atmBasis === "synth") {
            const atmRow = chainData.rows?.find((r) => Number(r.strike) === Number(chainData.atmStrike));
            const synth = atmRow && atmRow.ce?.ltp != null && atmRow.pe?.ltp != null
                ? Number(chainData.atmStrike) + Number(atmRow.ce.ltp) - Number(atmRow.pe.ltp)
                : null;
            return synth ?? chainData.spotPrice;
        }
        return chainData.spotPrice;
    }, [atmBasis, chainData]);

    const effectiveAtmStrike = useMemo(() => {
        if (!chainData?.rows?.length || effectiveAtmPrice == null) return chainData?.atmStrike ? Number(chainData.atmStrike) : null;
        return Number(chainData.rows.reduce(
            (best, r) => (Math.abs(Number(r.strike) - effectiveAtmPrice) < Math.abs(Number(best.strike) - effectiveAtmPrice) ? r : best)
        ).strike);
    }, [chainData, effectiveAtmPrice]);

    const displayChainRows = useMemo(() => {
        if (!chainData?.rows) return [];
        return strikeAsc ? chainData.rows : [...chainData.rows].reverse();
    }, [chainData, strikeAsc]);

    const { first3Expiries, remainingExpiries } = useMemo(() => {
        const list = chainData?.expiries || [];
        return {
            first3Expiries: list.slice(0, 4),
            remainingExpiries: list.slice(4),
        };
    }, [chainData?.expiries]);

    const { maxCeOi, maxPeOi } = useMemo(() => {
        if (!chainData || !chainData.rows) return { maxCeOi: 0, maxPeOi: 0 };
        return chainData.rows.reduce(
            (acc, r) => ({
                maxCeOi: Math.max(acc.maxCeOi, Number(r.ce?.oi || 0)),
                maxPeOi: Math.max(acc.maxPeOi, Number(r.pe?.oi || 0)),
            }),
            { maxCeOi: 0, maxPeOi: 0 }
        );
    }, [chainData]);

    const atmRowRef = useRef(null);
    const chainScrollRef = useRef(null);

    function scrollToAtm(behavior = "smooth") {
        const row = atmRowRef.current;
        const container = chainScrollRef.current;
        if (!row || !container) return;
        const target = row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2;
        container.scrollTo({ top: Math.max(0, target), behavior });
    }

    useEffect(() => {
        if (!chainData?.rows?.length) return;
        const raf = requestAnimationFrame(() => scrollToAtm("instant"));
        return () => cancelAnimationFrame(raf);
    }, [chainData?.selectedExpiry, activeSymbol, chainData?.rows?.length]);

    function toggleColumn(key) {
        setColumns((prev) => ({ ...prev, [key]: !prev[key] }));
    }
    function resetChainSettings() {
        setColumns(DEFAULT_COLUMNS);
        setAtmBasis("spot");
        setShowAtmDistance(false);
    }

    const enabledColumnCount = Object.values(columns).filter(Boolean).length;
    const totalColumnCount = Object.keys(columns).length;

    // Refresh FX Rate (Cached with timeout & safe fallback)
    useEffect(() => {
        let active = true;
        async function fetchFx() {
            try {
                const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(3000) });
                if (res.ok) {
                    const d = await res.json();
                    if (active && d?.rates?.INR) setUsdtInrRate(d.rates.INR);
                }
            } catch {
                if (active) setUsdtInrRate(86.50); // Safe local fallback
            }
        }
        fetchFx();
        return () => { active = false; };
    }, []);

    // Format active price
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

    // Load Wallet
    const loadWallet = useCallback(async () => {
        if (token) {
            try {
                const res = await fetchWallet(token);
                const w = res?.wallet || (res?.balance != null ? { balance: Number(res.balance), ...res } : null);
                if (w) setWallet(w);
            } catch (err) {
                console.error("[PaperTrade] loadWallet failed:", err);
            }
        } else {
            setWallet(loadGuestWallet());
        }
    }, [token]);

    // Close positions local helper
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
            const margin = getPositionMarginBlocked(pos);
            const bucket = pos.market === "crypto" ? usd : inr;
            const returnedCash = pos.side === "long" ? (exitPrice * shares) : (margin + realized);
            bucket.delta += returnedCash;
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

    // Load Positions
    const serverOpenIdsRef = useRef(null);
    const loadPositions = useCallback(async () => {
        const sameExpiry = (a, b) => String(a || "").slice(0, 10) === String(b || "").slice(0, 10);
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

        if (token) {
            try {
                const [openRes, closedRes] = await Promise.all([
                    fetchPositions(token, "open"),
                    fetchPositions(token, "closed"),
                ]);
                const norm = (p) => ({
                    ...p,
                    market: "indian",
                    option_type: p.option_type || p.opt_right,
                    current_price: p.livePrice ?? p.current_price ?? null,
                    closed_at: p.closed_at || p.exit_time || null,
                });
                const serverOpen = (openRes.positions || []).map(norm);
                const serverClosed = (closedRes.positions || []).map(norm);
                const { marked, hits } = markLocal(loadGuestPositions().filter((p) => p.market === "crypto"));
                const localClosed = loadGuestClosed().filter((p) => p.market === "crypto");

                setOpenPositions([...serverOpen, ...marked]);
                setClosedPositions(
                    [...serverClosed, ...localClosed].sort((a, b) => String(b.closed_at || "").localeCompare(String(a.closed_at || "")))
                );
                serverOpenIdsRef.current = new Set(serverOpen.map((p) => p.id));
                if (hits.length) {
                    closeLocalPositions(hits);
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
            }
        }
    }, [token, chainData, closeLocalPositions]);

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

    // Initial loading & WebSocket
    useEffect(() => {
        loadWallet();
        loadPositions();
        loadOrders();
    }, [token, loadWallet, loadPositions, loadOrders]);

    useEffect(() => {
        if (!token) return;
        const s = getLiveSocket();
        if (user?.id) {
            s.emit("join_user", { userId: user.id });
        }
        const onPaperUpdate = (payload) => {
            if (payload?.userId && user?.id && Number(payload.userId) !== Number(user.id)) return;
            if (payload?.balance != null) {
                setWallet((prev) => ({ ...(prev || {}), balance: Number(payload.balance) }));
            } else if (payload?.wallet) {
                setWallet((prev) => ({ ...(prev || {}), ...payload.wallet }));
            }
            loadWallet();
            loadPositions();
            loadOrders();
        };

        s.on("paper:wallet_updated", onPaperUpdate);
        s.on("paper:position_opened", onPaperUpdate);
        s.on("paper:position_closed", onPaperUpdate);
        s.on("paper:order_filled", onPaperUpdate);
        s.on("paper:strategy_executed", onPaperUpdate);

        return () => {
            s.off("paper:wallet_updated", onPaperUpdate);
            s.off("paper:position_opened", onPaperUpdate);
            s.off("paper:position_closed", onPaperUpdate);
            s.off("paper:order_filled", onPaperUpdate);
            s.off("paper:strategy_executed", onPaperUpdate);
        };
    }, [token, user?.id, loadWallet, loadPositions, loadOrders]);

    // Leaderboard
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
        if (tab === "leaderboard") {
            loadLeaderboard();
        }
    }, [tab, loadLeaderboard]);

    // Strategy Leg actions
    function addLeg(row, right, action) {
        const side = right === "CE" ? row.ce : row.pe;
        if (!side || side.ltp == null) return;
        const strikeNum = Number(row.strike);

        const existingIdx = legs.findIndex((l) => Number(l.strike) === strikeNum && l.type === right);
        if (existingIdx >= 0) {
            const existing = legs[existingIdx];
            if (existing.action === action) {
                setLegs((prev) => prev.filter((_, i) => i !== existingIdx));
                return;
            } else {
                setLegs((prev) =>
                    prev.map((l, i) =>
                        i === existingIdx ? { ...l, action, premium: Number(side.ltp) } : l
                    )
                );
                setChartTab("payoff");
                setTab("positions");
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
            gamma: side.gamma ? Number(side.gamma) : null,
            theta: side.theta ? Number(side.theta) : null,
            vega: side.vega ? Number(side.vega) : null,
            expiry: chainData?.selectedExpiry,
            active: true,
        };
        setLegs((prev) => [...prev, newLeg]);
        setChartTab("payoff");
        setTab("positions");
    }

    function removeLeg(id) {
        setLegs((prev) => prev.filter((l) => l.id !== id));
    }
    function updateLeg(id, patch) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    }
    function updateQty(id, qty) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_LOTS, Math.max(1, Math.floor(qty) || 1)) } : l)));
    }
    function toggleLegSide(id) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, action: otherAction(l.action) } : l)));
    }
    function resetLegs() {
        setLegs([]);
    }

    async function rollLegExpiry(id, newExpiry) {
        const leg = legs.find((l) => l.id === id);
        if (!leg || newExpiry === leg.expiry) return;
        let rows = [];
        if (chainData && newExpiry === chainData.selectedExpiry) {
            rows = chainData.rows || [];
        } else {
            rows = await fetchOptionChain(activeSymbol, newExpiry).then((res) => res.rows || []);
        }
        const row = rows.find((r) => Number(r.strike) === Number(leg.strike));
        const side = row && (leg.type === "CE" ? row.ce : row.pe);
        if (!side || side.ltp == null) return;
        updateLeg(id, { expiry: newExpiry, premium: Number(side.ltp), iv: side.iv, delta: side.delta, gamma: side.gamma, theta: side.theta, vega: side.vega });
    }

    async function rollLegStrike(id, direction) {
        const leg = legs.find((l) => l.id === id);
        if (!leg) return;
        let rows = chainData?.rows || [];
        if (leg.expiry && chainData?.selectedExpiry !== leg.expiry) {
            rows = await fetchOptionChain(activeSymbol, leg.expiry).then((res) => res.rows || []);
        }
        if (!rows.length) return;
        const sorted = [...rows].sort((a, b) => Number(a.strike) - Number(b.strike));
        const idx = sorted.findIndex((r) => Number(r.strike) === Number(leg.strike));
        const nextRow = sorted[idx + direction];
        const side = nextRow && (leg.type === "CE" ? nextRow.ce : nextRow.pe);
        if (!side || side.ltp == null) return;
        updateLeg(id, { strike: Number(nextRow.strike), premium: Number(side.ltp), iv: side.iv, delta: side.delta, gamma: side.gamma, theta: side.theta, vega: side.vega });
    }

    function resetLegEntryToLtp(id) {
        const leg = legs.find((l) => l.id === id);
        const row = leg && rowByStrike.get(Number(leg.strike));
        const currentLtp = row ? (leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp) : null;
        if (currentLtp == null) return;
        updateLeg(id, { premium: Number(currentLtp) });
    }

    // Legs toolbar helpers
    const activeLegs = useMemo(() => legs.filter((l) => l.active !== false), [legs]);
    const orderedLegs = useMemo(() => (legsTopFirst ? legs : [...legs].reverse()), [legs, legsTopFirst]);
    const allLegsActive = legs.length > 0 && legs.every((l) => l.active !== false);

    function toggleSelectAllLegs() {
        const shouldInclude = !allLegsActive;
        setLegs((prev) => prev.map((l) => ({ ...l, active: shouldInclude })));
    }
    function toggleLegActive(id) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, active: !l.active } : l)));
    }
    function bulkAdjustLots(delta) {
        setLegs((prev) => prev.map((l) => ({ ...l, qty: Math.min(MAX_LOTS, Math.max(1, (l.qty || 1) + delta)) })));
    }
    function setAllLots(n) {
        setLegs((prev) => prev.map((l) => ({ ...l, qty: n })));
    }
    const commonLots = legs.length && legs.every((l) => l.qty === legs[0].qty) ? legs[0].qty : null;
    const totalLots = legs.reduce((sum, l) => sum + (l.qty || 1), 0);

    // Option Chain row inline counts
    function legsAt(strike, right) {
        return legs.filter((l) => Number(l.strike) === Number(strike) && l.type === right && (l.expiry === chainData?.selectedExpiry || !l.expiry));
    }
    function netPositionAt(strike, right) {
        const matches = legsAt(strike, right);
        if (!matches.length) return 0;
        return matches.reduce((sum, l) => sum + (l.action === "buy" ? (l.qty || 1) : -(l.qty || 1)), 0);
    }

    // Live P&L
    const legLivePnl = useCallback((leg) => {
        const row = rowByStrike.get(Number(leg.strike));
        const liveLtp = row ? (leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp) : null;
        const currentLtp = leg.ltpOverride ?? liveLtp;
        if (currentLtp == null) return null;
        const diff = leg.action === "buy" ? currentLtp - leg.premium : leg.premium - currentLtp;
        return diff * (leg.qty || 1) * (leg.lotSize || lotSize || 50);
    }, [rowByStrike, lotSize]);

    const totalLivePnl = useMemo(() => {
        if (!legs.length) return null;
        let sum = 0;
        let any = false;
        for (const leg of legs) {
            const v = legLivePnl(leg);
            if (v != null) {
                sum += v;
                any = true;
            }
        }
        return any ? sum : null;
    }, [legs, legLivePnl]);

    // SPAN margin quote from server (hooks/useSpanMargin.js — shared with Strategy Builder)
    const spanLegs = useMemo(
        () => (isCrypto ? [] : activeLegs.map((l) => ({
            expiry: l.expiry || chainData?.selectedExpiry,
            strike: l.strike,
            type: l.type,
            action: l.action,
            lots: l.qty || 1,
            lotSize: l.lotSize || lotSize,
        }))),
        [isCrypto, activeLegs, chainData?.selectedExpiry, lotSize]
    );
    const spanResult = useSpanMargin(activeSymbol, spotPrice, spanLegs);

    // Payoff and Greek calculations
    const payoffData = useMemo(() => {
        if (!activeLegs.length || !spotPrice) {
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
                estMargin: 0,
                marginBenefit: 0,
                isHedged: false,
                atmIv: null,
                yearsRemaining: null,
            };
        }

        try {
            const strikes = activeLegs.map((l) => l.strike).filter(Boolean);
            const minStrike = strikes.length ? Math.min(...strikes) : spotPrice;
            const maxStrike = strikes.length ? Math.max(...strikes) : spotPrice;
            const minPrice = Math.min(spotPrice * 0.90, minStrike * 0.95);
            const maxPrice = Math.max(spotPrice * 1.10, maxStrike * 1.05);

            let curveData = computePayoffCurve(activeLegs, { minPrice, maxPrice, steps: 150 }) || [];
            const breakEvs = computeBreakevens(curveData) || [];
            const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(activeLegs, curveData);
            const rReward = computeRiskRewardRatio(mxProf, mxLoss);
            const netGrks = computeNetGreeks(activeLegs);
            const marginCalc = computeMarginDetails(activeLegs, spotPrice, activeSymbol, {
                isCrypto,
                leverage: isCrypto ? cryptoLeverage : 1,
            });

            const evaluationExpiry = evaluationExpiryOf(activeLegs) || chainData?.selectedExpiry;
            const yearsRem = evaluationExpiry ? yearsToExpiry(evaluationExpiry) : null;
            const atmRow = chainData?.rows?.find((r) => Number(r.strike) === Number(effectiveAtmStrike));
            const atmIv = atmRow?.ce?.iv ? Number(atmRow.ce.iv) : (atmRow?.pe?.iv ? Number(atmRow.pe.iv) : null);

            if (atmIv && yearsRem) {
                const evalTimestamp = dataLoadedAt || staleNow || null;
                curveData = addMarkToMarketCurve(curveData, activeLegs, yearsRem, evalTimestamp);
            }
            const expMv = (atmIv && yearsRem) ? computeExpectedMove(spotPrice, atmIv, yearsRem) : null;
            const popVal = (atmIv && yearsRem) ? computePOP(curveData, spotPrice, atmIv, yearsRem) : null;

            return {
                curve: curveData,
                breakevens: breakEvs,
                maxProfit: mxProf,
                maxLoss: mxLoss,
                riskReward: rReward,
                netGreeks: netGrks,
                pop: popVal,
                expectedMove: expMv,
                ...(() => {
                    const span = spanResult;
                    if (!span) return { fundsRequired: marginCalc.fundsRequired, estMargin: marginCalc.estMargin, nakedMargin: marginCalc.nakedMargin, marginBenefit: marginCalc.marginBenefit, marginSource: isCrypto ? null : "Estimate", marginDetail: null };
                    const debit = Math.max(0, -marginCalc.netPremium);
                    return {
                        estMargin: span.margin,
                        fundsRequired: Math.round((span.margin + debit) * 100) / 100,
                        nakedMargin: span.standaloneMargin,
                        marginBenefit: Math.max(0, Math.round((span.standaloneMargin - span.margin) * 100) / 100),
                        marginSource: spanSourceLabel(span),
                        marginDetail: span,
                    };
                })(),
                isHedged: marginCalc.isHedged,
                atmIv,
                yearsRemaining: yearsRem,
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
                estMargin: 0,
                marginBenefit: 0,
                isHedged: false,
                atmIv: null,
                yearsRemaining: null,
            };
        }
    }, [activeLegs, spotPrice, activeSymbol, isCrypto, cryptoLeverage, chainData, effectiveAtmStrike, spanResult, dataLoadedAt, staleNow]);

    // What-If Simulation
    const whatIfResult = useMemo(() => {
        if (!payoffSettingsOpen || !legs.length || !spotPrice) return null;
        const evaluationExpiry = evaluationExpiryOf(legs) || chainData?.selectedExpiry;
        const simSpot = spotPrice * (1 + whatIfSpotPct / 100);
        const baseMs = dataLoadedAt || staleNow || Date.now();
        const simMs = baseMs + whatIfDaysForward * 24 * 60 * 60 * 1000;

        let pnl = 0;
        for (const leg of legs) {
            const t = Math.max(
                yearsToExpiry(leg.expiry || evaluationExpiry, simMs),
                1 / (365 * 24 * 4)
            );
            let theoPrice;
            if (leg.iv != null) {
                const vol = Math.max(0.01, (leg.iv + whatIfIvShift) / 100);
                theoPrice = bsPrice({ spot: simSpot, strike: leg.strike, t, vol, right: leg.type });
            } else {
                theoPrice = leg.type === "CE" ? Math.max(0, simSpot - leg.strike) : Math.max(0, leg.strike - simSpot);
            }
            const mult = (leg.qty || 1) * (leg.lotSize || lotSize || 50);
            pnl += (leg.action === "buy" ? theoPrice - leg.premium : leg.premium - theoPrice) * mult;
        }
        return { simSpot, pnl };
    }, [payoffSettingsOpen, legs, spotPrice, chainData?.selectedExpiry, whatIfSpotPct, whatIfDaysForward, whatIfIvShift, dataLoadedAt, staleNow, lotSize]);

    // Presets
    function applyPreset(presetLegs) {
        setLegs(presetLegs.map((l) => ({ active: true, ...l, id: ++legIdCounter })));
        setTab("positions");
        setChartTab("payoff");
    }
    function fetchExpiryRows(expiry) {
        return fetchOptionChain(activeSymbol, expiry).then((res) => res.rows || []);
    }

    // SL/TG Modal handlers
    function openSlTgModal(leg) {
        setSlTgDraft({ sl: leg.slPercent ?? leg.sl ?? "", tg: leg.tgPercent ?? leg.target ?? "" });
        setSlTgEditId(leg.id);
    }
    function closeSlTgModal() {
        setSlTgEditId(null);
    }
    function saveSlTgModal(legId) {
        updateLeg(legId, {
            slPercent: slTgDraft.sl === "" ? null : Number(slTgDraft.sl),
            tgPercent: slTgDraft.tg === "" ? null : Number(slTgDraft.tg),
            sl: slTgDraft.sl === "" ? null : Number(slTgDraft.sl),
            target: slTgDraft.tg === "" ? null : Number(slTgDraft.tg),
        });
        setSlTgEditId(null);
    }

    // =========================================================================
    // EXECUTION & TRADING ACTIONS
    // =========================================================================

    const virtualCash = isCrypto
        ? Number(cryptoWallet?.balance || 10000)
        : (wallet?.balance != null ? Number(wallet.balance) : 100000);

    const totalUnrealized = useMemo(
        () => openPositions.reduce((acc, p) => acc + (Number(p.unrealizedPnl) || 0), 0),
        [openPositions]
    );

    const totalMarginBlocked = useMemo(
        () => openPositions.reduce((acc, p) => acc + getPositionMarginBlocked(p, spotPrice), 0),
        [openPositions, spotPrice]
    );

    function analyzePositionInPayoff(pos) {
        const leg = {
            id: ++legIdCounter,
            strike: Number(pos.strike),
            type: pos.option_type || pos.opt_right,
            action: (pos.side === "long" || pos.side === "buy") ? "buy" : "sell",
            qty: Number(pos.lots || 1),
            lotSize: Number(pos.lot_size || lotSize),
            premium: Number(pos.current_price || pos.entry_price || 0),
            expiry: pos.expiry || chainData?.selectedExpiry,
            active: true,
        };
        setLegs([leg]);
        setChartTab("payoff");
        setTab("positions");
    }

    function analyzeAllOpenPositionsInPayoff() {
        if (!openPositions.length) return;
        const loadedLegs = openPositions.map((pos) => ({
            id: ++legIdCounter,
            strike: Number(pos.strike),
            type: pos.option_type || pos.opt_right,
            action: (pos.side === "long" || pos.side === "buy") ? "buy" : "sell",
            qty: Number(pos.lots || 1),
            lotSize: Number(pos.lot_size || lotSize),
            premium: Number(pos.current_price || pos.entry_price || 0),
            expiry: pos.expiry || chainData?.selectedExpiry,
            active: true,
        }));
        setLegs(loadedLegs);
        setChartTab("payoff");
        setTab("positions");
    }

    async function handleExecuteHedge() {
        if (!legs.length) return;

        const badLeg = legs.find((l) => bracketError(l.action, l.premium, l.sl, l.target));
        if (badLeg) {
            setFeedback({
                type: "error",
                text: `${badLeg.strike} ${badLeg.type}: ${bracketError(badLeg.action, badLeg.premium, badLeg.sl, badLeg.target)}`,
            });
            return;
        }

        const required = Number(payoffData.fundsRequired || 0);
        if (virtualCash < required) {
            setFeedback({
                type: "error",
                text: isCrypto
                    ? `Insufficient Virtual USDT Balance. Required: $${required.toFixed(2)}, Available: $${virtualCash.toFixed(2)}.`
                    : `Insufficient Virtual Cash. Required: ${formatRupees(required)}, Available: ${formatRupees(virtualCash)}. Refill +₹5,00,000 for ₹100 below.`,
            });
            if (!isCrypto) setRefillModalOpen(true);
            return;
        }

        try {
            setIsExecuting(true);
            setFeedback(null);

            const title =
                legs.length === 1
                    ? `${activeSymbol} ${legs[0].strike} ${legs[0].type}`
                    : `${activeSymbol} Hedge Basket (${legs.length} Legs)`;

            if (token && !isCrypto) {
                const res = await openStrategyTrade(token, {
                    symbol: activeSymbol,
                    expiry: chainData?.selectedExpiry,
                    strategy_name: title,
                    strategyName: title,
                    requiredFunds: required,
                    requiredMargin: payoffData.estMargin || required,
                    legs: activeLegs.map((l) => ({
                        optRight: l.type || l.optRight || l.option_type,
                        opt_right: l.type || l.optRight || l.option_type,
                        option_type: l.type || l.optRight || l.option_type,
                        type: l.type || l.optRight || l.option_type,
                        strike: l.strike,
                        side: l.action === "buy" ? "long" : "short",
                        lots: l.qty || l.lots || 1,
                        entry_price: l.premium,
                        ltp: l.premium,
                        lot_size: l.lotSize || lotSize,
                        expiry: l.expiry || chainData?.selectedExpiry,
                        stopLossPrice: toBracket(l.sl),
                        targetPrice: toBracket(l.target),
                    })),
                });
                if (res?.wallet) {
                    setWallet((prev) => ({ ...(prev || {}), ...res.wallet }));
                }
                await loadWallet();
                await loadPositions();
            } else {
                const rawLegMargins = activeLegs.map((l) => {
                    const totalShares = (l.qty || 1) * (l.lotSize || lotSize);
                    if (l.action === "buy") return l.premium * totalShares;
                    const notional = (spotPrice || l.strike) * totalShares;
                    if (isCrypto) return notional / (cryptoLeverage || 20);
                    const { totalPct } = getSpanExposureBreakdown(l, activeSymbol);
                    return notional * totalPct;
                });
                const sumRawMargins = rawLegMargins.reduce((a, b) => a + b, 0);
                const scale = sumRawMargins > 0 ? (payoffData.estMargin / sumRawMargins) : 0;

                const newPositions = activeLegs.map((l, idx) => {
                    const precision = isCrypto ? 10000 : 100;
                    const totalShares = (l.qty || 1) * (l.lotSize || lotSize);
                    const allocatedMargin = l.action === "buy"
                        ? Math.round(l.premium * totalShares * precision) / precision
                        : (scale > 0 ? Math.round(rawLegMargins[idx] * scale * precision) / precision : Math.round(rawLegMargins[idx] * precision) / precision);
                    return {
                        id: ++legIdCounter,
                        symbol: activeSymbol,
                        market: isCrypto ? "crypto" : "indian",
                        expiry: chainData?.selectedExpiry,
                        strategy_name: title,
                        option_type: l.type,
                        strike: l.strike,
                        side: l.action === "buy" ? "long" : "short",
                        lots: l.qty || 1,
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
                await loadPositions();

                const totalBlockedInBasket = newPositions.reduce((s, p) => s + (p.margin_blocked || 0), 0);

                if (isCrypto) {
                    const updatedCryptoWallet = {
                        balance: virtualCash - required,
                        margin_utilized: (cryptoWallet?.margin_utilized || 0) + totalBlockedInBasket,
                    };
                    saveGuestCryptoWallet(updatedCryptoWallet);
                    setCryptoWallet(updatedCryptoWallet);
                } else {
                    const updatedWallet = {
                        balance: virtualCash - required,
                        margin_utilized: (wallet?.margin_utilized || 0) + totalBlockedInBasket,
                    };
                    saveGuestWallet(updatedWallet);
                    setWallet(updatedWallet);
                }
            }

            setFeedback({ type: "success", text: `Paper Trade "${title}" executed successfully!` });
            setLegs([]);
            setTab("open_trades");
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Execution failed." });
        } finally {
            setIsExecuting(false);
        }
    }

    async function handleClosePosition(pos) {
        try {
            setClosingId(pos.id);
            if (token && pos.market !== "crypto") {
                const res = await closePosition(token, pos.id);
                if (res?.wallet) {
                    setWallet((prev) => ({ ...(prev || {}), ...res.wallet }));
                }
                await loadWallet();
                await loadPositions();
            } else {
                closeLocalPositions([pos], "manual");
            }
            setFeedback({ type: "success", text: `Position ${pos.symbol} ${pos.strike} ${pos.option_type} closed successfully.` });
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to close position." });
        } finally {
            setClosingId(null);
        }
    }

    async function handleCloseAllPositions() {
        if (!openPositions.length) return;
        try {
            setClosingAll(true);
            if (token) {
                const serverPos = openPositions.filter((p) => p.market !== "crypto");
                if (serverPos.length) {
                    const res = await closeAllPositions(token);
                    if (res?.wallet) setWallet((prev) => ({ ...(prev || {}), ...res.wallet }));
                }
                const cryptoPos = openPositions.filter((p) => p.market === "crypto");
                if (cryptoPos.length) closeLocalPositions(cryptoPos, "close_all");
                await loadWallet();
                await loadPositions();
            } else {
                closeLocalPositions(openPositions, "close_all");
            }
            setFeedback({ type: "success", text: "All positions squared off successfully." });
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to close all positions." });
        } finally {
            setClosingAll(false);
        }
    }

    function openPositionSl(pos) {
        setSlModal({
            kind: "position",
            id: pos.id,
            pos,
            side: pos.side,
            ref: Number(pos.current_price ?? pos.entry_price),
            label: `${pos.symbol} ${pos.strike} ${pos.option_type}`,
            sl: pos.stop_loss_price != null ? String(pos.stop_loss_price) : "",
            target: pos.target_price != null ? String(pos.target_price) : "",
        });
    }

    async function saveSlModal(remove = false) {
        if (!slModal) return;
        const nextSl = remove ? null : toBracket(slModal.sl);
        const nextTarget = remove ? null : toBracket(slModal.target);
        try {
            setSavingBracket(true);
            if (token && slModal.pos?.market !== "crypto") {
                await updatePositionBracket(token, slModal.id, { stopLossPrice: nextSl, targetPrice: nextTarget });
                await loadPositions();
            } else {
                const updated = openPositions.map((p) =>
                    p.id === slModal.id ? { ...p, stop_loss_price: nextSl, target_price: nextTarget } : p
                );
                saveGuestPositions(updated);
                setOpenPositions(updated);
            }
            setFeedback({ type: "success", text: remove ? "SL & Target removed." : "SL & Target updated." });
            setSlModal(null);
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to update bracket." });
        } finally {
            setSavingBracket(false);
        }
    }

    async function handleCancelOrder(order) {
        try {
            setCancellingOrderId(order.id);
            if (token && order.market !== "crypto") {
                const res = await cancelPaperOrder(token, order.id);
                if (res?.wallet) setWallet((prev) => ({ ...(prev || {}), ...res.wallet }));
                await loadWallet();
                await loadOrders();
            } else {
                const allOrders = loadGuestOrders();
                const updated = allOrders.map((o) =>
                    o.id === order.id ? { ...o, status: "CANCELLED", cancelled_at: new Date().toISOString() } : o
                );
                saveGuestOrders(updated);
                setOrders(updated);
            }
            setFeedback({ type: "success", text: `Order #${order.id} cancelled successfully.` });
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Failed to cancel order." });
        } finally {
            setCancellingOrderId(null);
        }
    }

    // Refill payment
    async function handleBuyRefill() {
        if (!token) {
            setFeedback({ type: "error", text: "Please log in to refill your account balance." });
            navigate("/login");
            return;
        }
        try {
            setPaymentLoading(true);
            const rzp = await loadRazorpayCheckout();
            const orderRes = await createRefillOrder(token);
            if (!orderRes?.orderId) throw new Error("Failed to initialize payment.");

            const rzpInstance = new rzp({
                key: orderRes.keyId,
                amount: orderRes.amount,
                currency: orderRes.currency,
                name: "Bazaar Sync",
                description: "Virtual Capital Refill (+₹5,00,000)",
                order_id: orderRes.orderId,
                handler: async (resp) => {
                    try {
                        const verifyRes = await verifyRefillPayment(token, {
                            orderId: resp.razorpay_order_id,
                            paymentId: resp.razorpay_payment_id,
                            signature: resp.razorpay_signature,
                        });
                        if (verifyRes?.wallet) setWallet(verifyRes.wallet);
                        await loadWallet();
                        setFeedback({ type: "success", text: "Success! +₹5,00,000 Virtual Capital added to your account." });
                        setRefillModalOpen(false);
                    } catch (vErr) {
                        setFeedback({ type: "error", text: vErr.message || "Payment verification failed." });
                    }
                },
                theme: { color: "#10b981" },
            });
            rzpInstance.open();
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Could not launch Razorpay checkout." });
        } finally {
            setPaymentLoading(false);
        }
    }

    // Pro payment
    async function handleBuyPro() {
        if (!token) {
            navigate("/login");
            return;
        }
        try {
            setPaymentLoading(true);
            const rzp = await loadRazorpayCheckout();
            const orderRes = await createProOrder(token);
            if (!orderRes?.orderId) throw new Error("Failed to initialize Pro checkout.");

            const rzpInstance = new rzp({
                key: orderRes.keyId,
                amount: orderRes.amount,
                currency: orderRes.currency,
                name: "Bazaar Sync Pro",
                description: "Pro Membership ₹499/mo (+₹5,00,000 Virtual Capital)",
                order_id: orderRes.orderId,
                handler: async (resp) => {
                    try {
                        await verifyProPayment(token, {
                            orderId: resp.razorpay_order_id,
                            paymentId: resp.razorpay_payment_id,
                            signature: resp.razorpay_signature,
                        });
                        await refreshUser();
                        await loadWallet();
                        setFeedback({ type: "success", text: "Welcome to Bazaar Sync Pro! +₹5,00,000 Virtual Capital activated." });
                        setProModalOpen(false);
                    } catch (vErr) {
                        setFeedback({ type: "error", text: vErr.message || "Pro verification failed." });
                    }
                },
                theme: { color: "#f59e0b" },
            });
            rzpInstance.open();
        } catch (err) {
            setFeedback({ type: "error", text: err.message || "Could not launch checkout." });
        } finally {
            setPaymentLoading(false);
        }
    }

    return (
        <div ref={containerRef} className="min-h-screen bg-[#f8f9fa] dark:bg-[#070e17] text-gray-900 dark:text-gray-100 transition-colors p-2 sm:p-3">
            {/* ========================================================================= */}
            {/* TOP BAR HEADER (StockMojo Parity) */}
            {/* ========================================================================= */}
            <header className="mb-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] p-2.5 shadow-xs transition-colors flex flex-wrap items-center justify-between gap-2.5">
                {/* Left: Market Switcher, Symbol Pill / Crypto Coins, Save, Saved, Reset/New */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {/* Market Switcher: Indian Market vs Crypto */}
                    <div className="flex items-center bg-gray-100 dark:bg-white/5 p-0.5 rounded-lg border border-gray-200 dark:border-white/10 shadow-2xs h-8">
                        <button
                            onClick={() => {
                                if (marketMode !== "indian") {
                                    setMarketMode("indian");
                                    setLegs([]);
                                }
                            }}
                            className={`px-2.5 h-full rounded-md font-bold text-xs transition cursor-pointer flex items-center gap-1.5 ${
                                !isCrypto
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <span>🇮🇳</span>
                            <span className="hidden sm:inline">Indian F&amp;O</span>
                            <span className="sm:hidden">NSE</span>
                        </button>
                        <button
                            onClick={() => {
                                if (marketMode !== "crypto") {
                                    setMarketMode("crypto");
                                    setLegs([]);
                                }
                            }}
                            className={`px-2.5 h-full rounded-md font-bold text-xs transition cursor-pointer flex items-center gap-1.5 ${
                                isCrypto
                                    ? "bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs"
                                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <span>⚡</span>
                            <span className="hidden sm:inline">Crypto Options</span>
                            <span className="sm:hidden">Crypto</span>
                        </button>
                    </div>

                    {!isCrypto ? (
                        /* Indian Market: Symbol Pill with Lot Badge & Cycle Arrows */
                        <div className="relative flex items-center h-8 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2 shadow-xs transition">
                            <span className="w-5 h-5 rounded-full bg-[#182230] text-white flex items-center justify-center text-[10px] font-bold mr-1.5 shadow-xs shrink-0">
                                {lotSize}
                            </span>
                            <button
                                onClick={() => setPickerOpen((v) => !v)}
                                className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1 cursor-pointer pr-1 transition hover:text-blue-600"
                            >
                                <span>{activeSymbol}</span>
                                <span className="text-[9px] text-gray-400">▾</span>
                            </button>
                            <div className="flex items-center border-l border-gray-200 dark:border-white/10 ml-0.5 pl-0.5">
                                <button
                                    onClick={() => cycleSymbol(-1)}
                                    disabled={favorites.length < 2}
                                    className="h-6 w-4 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 transition text-xs font-bold cursor-pointer"
                                    aria-label="Previous symbol"
                                >
                                    ‹
                                </button>
                                <button
                                    onClick={() => cycleSymbol(1)}
                                    disabled={favorites.length < 2}
                                    className="h-6 w-4 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 transition text-xs font-bold cursor-pointer"
                                    aria-label="Next symbol"
                                >
                                    ›
                                </button>
                            </div>

                            {/* Searchable Symbol Picker Dropdown */}
                            {pickerOpen && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                                    <div className="absolute left-0 top-full z-50 mt-1 w-64 max-h-96 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-2xl text-[13px] text-gray-800 dark:text-gray-100">
                                        <div className="sticky top-0 border-b border-gray-100 dark:border-white/10 bg-white dark:bg-[#0b1420] p-2">
                                            <input
                                                autoFocus
                                                value={pickerQuery}
                                                onChange={(e) => setPickerQuery(e.target.value)}
                                                placeholder="Search symbol…"
                                                className="w-full rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] text-gray-900 dark:text-white px-2.5 py-1 text-[13px] outline-none focus:border-emerald-500"
                                            />
                                        </div>
                                        {filteredIndices.length > 0 && (
                                            <div>
                                                <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase text-gray-400">Index</div>
                                                {filteredIndices.map((s) => (
                                                    <SymbolOption key={s} sym={s} active={s === activeSymbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                                                ))}
                                            </div>
                                        )}
                                        {filteredStocks.length > 0 && (
                                            <div>
                                                <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase text-gray-400">Stocks</div>
                                                {filteredStocks.map((s) => (
                                                    <SymbolOption key={s} sym={s} active={s === activeSymbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        /* Crypto Market: Coin Switcher + Leverage + Currency */
                        <>
                            <div className="flex items-center gap-1 bg-gray-100 dark:bg-white/5 p-0.5 rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-2xs">
                                {CRYPTO_COINS.map((c) => (
                                    <button
                                        key={c.symbol}
                                        onClick={() => {
                                            if (cryptoSymbol !== c.symbol) {
                                                setCryptoSymbol(c.symbol);
                                                setSelectedCryptoExpiry(null);
                                                setLegs([]);
                                            }
                                        }}
                                        className={`px-2.5 h-full rounded-md font-bold text-xs transition cursor-pointer flex items-center gap-1.5 ${
                                            cryptoSymbol === c.symbol
                                                ? "bg-amber-500 text-white shadow-xs"
                                                : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                        }`}
                                    >
                                        <span className="font-mono">{c.icon}</span>
                                        <span>{c.symbol}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Crypto Leverage Dropdown */}
                            <div className="flex items-center h-8 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2 shadow-xs gap-1.5">
                                <span className="text-[10px] uppercase font-bold text-gray-400">Lev:</span>
                                <select
                                    value={cryptoLeverage}
                                    onChange={(e) => setCryptoLeverage(Number(e.target.value))}
                                    className="text-xs font-bold text-amber-500 bg-transparent outline-none cursor-pointer"
                                    aria-label="Crypto leverage"
                                >
                                    <option value={100} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">100x</option>
                                    <option value={50} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">50x</option>
                                    <option value={20} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">20x</option>
                                    <option value={10} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">10x</option>
                                    <option value={5} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">5x</option>
                                    <option value={1} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">1x</option>
                                </select>
                            </div>

                            {/* Currency Toggle (USD vs INR) */}
                            <div className="flex items-center bg-gray-100 dark:bg-white/5 p-0.5 rounded-lg border border-gray-200 dark:border-white/10 h-8 shadow-2xs">
                                <button
                                    onClick={() => setCurrency("USD")}
                                    className={`px-2 h-full rounded-md font-bold text-[11px] transition cursor-pointer ${
                                        currency === "USD"
                                            ? "bg-blue-600 text-white shadow-xs"
                                            : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                                    }`}
                                    title="View in US Dollars ($ USD)"
                                >
                                    $ USD
                                </button>
                                <button
                                    onClick={() => setCurrency("INR")}
                                    className={`px-2 h-full rounded-md font-bold text-[11px] transition cursor-pointer ${
                                        currency === "INR"
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                                    }`}
                                    title={`Convert to Indian Rupees (₹ INR) @ 1 USDT = ₹${usdtInrRate.toFixed(2)}`}
                                >
                                    ₹ INR
                                </button>
                            </div>
                        </>
                    )}

                    {/* Expiry Selector Dropdown */}
                    {chainData?.expiries && chainData.expiries.length > 0 && (
                        <select
                            value={chainData.selectedExpiry || ""}
                            onChange={(e) => changeExpiry(activeSymbol, e.target.value)}
                            className="h-8 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2.5 text-xs font-bold text-gray-900 dark:text-white shadow-xs outline-none hover:border-[#1677ff] focus:border-[#1677ff] transition cursor-pointer"
                            aria-label="Select expiry"
                        >
                            {chainData.expiries.map((exp) => (
                                <option key={exp} value={exp} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">
                                    {formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)
                                </option>
                            ))}
                        </select>
                    )}

                    {/* Save Button (StockMojo Green Pill) */}
                    <SaveButton
                        itemLabel="strategy"
                        onSave={(tok, name) => saveStrategy(tok, { name, underlying: activeSymbol, legs })}
                        className="h-8 px-3 text-xs bg-[#00b96b] hover:bg-[#00a860] font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                    />

                    {/* Saved Button */}
                    <button
                        onClick={() => setSavedOpen(true)}
                        className="flex items-center h-8 px-3 text-xs gap-1.5 whitespace-nowrap transition-colors bg-white dark:bg-[#0b1420] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 border border-gray-300 dark:border-white/10 font-bold rounded-lg shadow-xs cursor-pointer"
                    >
                        <FiFolder size={13} className="text-gray-400" />
                        <span>Saved</span>
                    </button>

                    {/* Reset/New Button */}
                    <button
                        onClick={resetLegs}
                        className="flex items-center h-8 px-3 text-xs bg-[#fff1f0] text-[#ff4d4f] dark:bg-rose-950/30 dark:text-rose-400 hover:bg-[#ffe8e6] dark:hover:bg-rose-950/50 border border-[#ffccc7] dark:border-rose-900/50 rounded-lg gap-1.5 shrink-0 whitespace-nowrap transition-colors font-bold shadow-xs cursor-pointer"
                        title="Reset basket legs"
                    >
                        <FiTrash2 size={12} />
                        <span>Reset/New{legs.length > 0 ? ` (${legs.length})` : ""}</span>
                    </button>
                </div>

                {/* Right: Live Clock, Status, Fullscreen, Virtual Cash, Pro */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <div className="flex items-center gap-1.5 h-8 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-xs">
                        <FiClock className="text-gray-400" size={13} />
                        <span className="tabular-nums font-mono text-[11.5px]">
                            {formatStockMojoDateTime(currentTime)}
                        </span>
                    </div>

                    {isLive && marketStatus?.isOpen ? (
                        <span className="flex items-center gap-1 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 px-2.5 text-[10.5px] font-extrabold text-emerald-700 dark:text-emerald-300">
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            LIVE
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 h-8 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-2 text-[10.5px] font-semibold text-gray-600 dark:text-gray-400">
                            <span>◈</span>
                            <span>SNAPSHOT</span>
                        </span>
                    )}

                    {/* Full Screen Mode Toggle */}
                    <button
                        onClick={toggleFullscreen}
                        className="flex items-center gap-1.5 h-8 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-xs hover:bg-gray-50 dark:hover:bg-white/5 transition cursor-pointer"
                        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                    >
                        {isFullscreen ? <FiMinimize size={12} className="text-emerald-500" /> : <FiMaximize size={12} className="text-gray-400" />}
                        <span className="hidden sm:inline">{isFullscreen ? "Exit Fullscreen" : "Full Screen"}</span>
                    </button>

                    {/* Virtual Cash Pill & Refill */}
                    <div className="flex items-center gap-2 h-8 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2.5 shadow-xs">
                        <span className="text-[11px] font-semibold text-gray-400">
                            {isCrypto ? "Virtual USDT:" : isPro ? "Virtual Cash:" : "Trial Cash:"}
                        </span>
                        <span className="text-xs font-bold font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                            {isCrypto ? (
                                currency === "INR" ? `₹${Number(virtualCash * usdtInrRate).toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : `$${Number(virtualCash).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            ) : (
                                formatRupees(virtualCash)
                            )}
                        </span>
                        {!isCrypto && (
                            <button
                                onClick={() => setRefillModalOpen(true)}
                                className="px-1.5 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] cursor-pointer shadow-xs transition"
                                title="Add +₹5,00,000 Virtual Capital for ₹100"
                            >
                                Refill
                            </button>
                        )}
                    </div>

                    {!isPro ? (
                        <button
                            onClick={() => setProModalOpen(true)}
                            className="h-8 px-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-bold text-xs shadow-xs cursor-pointer transition flex items-center gap-1"
                        >
                            <FiAward size={12} />
                            <span>Upgrade Pro</span>
                        </button>
                    ) : (
                        <span className="h-8 px-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 font-bold text-xs flex items-center gap-1">
                            <span>⭐</span>
                            <span>Pro</span>
                        </span>
                    )}
                </div>
            </header>

            {/* Feedback Alerts */}
            {feedback && (
                <div className={`mb-3 p-3 rounded-xl text-xs flex items-center justify-between shadow-xs ${
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

            {/* ========================================================================= */}
            {/* MAIN 2-COLUMN WORKSPACE: LEFT OPTION CHAIN & RIGHT STRATEGY WORKSPACE */}
            {/* ========================================================================= */}
            <div className="flex flex-col xl:flex-row gap-3 items-start">
                {/* ----------------------------------------------------------------- */}
                {/* LEFT PANEL: OPTION CHAIN (StockMojo Layout) */}
                {/* ----------------------------------------------------------------- */}
                {!hideChain && (
                    <div className="w-full xl:w-[480px] 2xl:w-[510px] shrink-0 flex flex-col">
                        {/* Option Chain Top Banner */}
                        <div className="mb-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs overflow-hidden transition-colors">
                            {/* Row 1: SPOT, VIX, FUT, Hide Chain */}
                            <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/10 px-3 py-2 text-xs">
                                {chainData ? (
                                    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                                        <div>
                                            <span className="text-gray-400 font-semibold text-[11px]">SPOT: </span>
                                            <span className="font-mono font-extrabold text-gray-900 dark:text-white tabular-nums">
                                                {formatActivePrice(chainData.spotPrice)}
                                            </span>
                                            {chainData.spotChangePercent != null && (
                                                <span className={`ml-1 text-[11px] font-bold font-mono ${chainData.spotChangePercent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                    {chainData.spotChangePercent >= 0 ? "+" : ""}{Number(chainData.spotChangePercent).toFixed(2)}%
                                                </span>
                                            )}
                                        </div>
                                        {!isCrypto && (
                                            <>
                                                <div className="h-3 w-px bg-gray-200 dark:bg-white/10" />
                                                <div>
                                                    <span className="text-gray-400 font-semibold text-[11px]">VIX: </span>
                                                    <span className="font-mono font-bold text-gray-900 dark:text-white tabular-nums">
                                                        {chainData.vix != null ? Number(chainData.vix).toFixed(2) : "—"}
                                                    </span>
                                                </div>
                                            </>
                                        )}
                                        {!isCrypto && chainData.futurePrice != null && (
                                            <>
                                                <div className="h-3 w-px bg-gray-200 dark:bg-white/10" />
                                                <div className="flex items-center gap-1">
                                                    <span className="text-gray-400 font-semibold text-[11px]">FUT ({chainData.selectedExpiry ? formatExpiryShort(chainData.selectedExpiry) : ""}) </span>
                                                    <span className="font-mono font-bold text-gray-900 dark:text-white tabular-nums">
                                                        {formatPrice(chainData.futurePrice)}
                                                    </span>
                                                    <span className="text-[9px] text-gray-400">▾</span>
                                                </div>
                                            </>
                                        )}
                                        {isCrypto && (
                                            <>
                                                <div className="h-3 w-px bg-gray-200 dark:bg-white/10" />
                                                <div className="flex items-center gap-1.5 text-[11px] font-bold">
                                                    <span className="text-gray-400">FEED:</span>
                                                    <span className="text-amber-500 font-extrabold flex items-center gap-1">
                                                        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                                        Delta Exchange Live (24/7)
                                                    </span>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                ) : (
                                    <span className="text-gray-400">Loading…</span>
                                )}

                                <button
                                    onClick={() => setHideChain(true)}
                                    className="flex items-center gap-1 rounded-md border border-gray-200 dark:border-white/10 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer shadow-xs transition"
                                    title="Hide Option Chain"
                                >
                                    <span>👁</span>
                                    <span>Hide Chain</span>
                                </button>
                            </div>

                            {/* Row 2: First 4 Expiries + Dropdown + Settings Cog */}
                            <div className="flex items-center justify-between gap-1.5 px-3 py-1.5 bg-gray-50/50 dark:bg-[#070e17]/50">
                                {chainData?.expiries && chainData.expiries.length > 0 ? (
                                    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0">
                                        {first3Expiries.map((exp) => (
                                            <button
                                                key={exp}
                                                onClick={() => changeExpiry(activeSymbol, exp)}
                                                className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                                                    exp === chainData.selectedExpiry
                                                        ? "bg-[#1677ff] text-white shadow-xs font-bold"
                                                        : "bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                                                }`}
                                            >
                                                {formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)
                                            </button>
                                        ))}
                                        {remainingExpiries.length > 0 && (
                                            <select
                                                value={remainingExpiries.includes(chainData.selectedExpiry) ? chainData.selectedExpiry : ""}
                                                onChange={(e) => {
                                                    if (e.target.value) changeExpiry(activeSymbol, e.target.value);
                                                }}
                                                className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold border transition cursor-pointer outline-none ${
                                                    remainingExpiries.includes(chainData.selectedExpiry)
                                                        ? "bg-[#1677ff] text-white border-[#1677ff] font-bold"
                                                        : "bg-white dark:bg-[#0b1420] border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100"
                                                }`}
                                            >
                                                <option value="" disabled hidden>
                                                    {remainingExpiries[0] ? `${formatExpiryShort(remainingExpiries[0])} (${daysUntilExpiry(remainingExpiries[0])}d) ▾` : "More ▾"}
                                                </option>
                                                {remainingExpiries.map((exp) => (
                                                    <option key={exp} value={exp} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">
                                                        {formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                ) : (
                                    <div className="text-xs font-bold text-gray-700 dark:text-gray-300">Option Chain</div>
                                )}

                                <div className="flex items-center gap-1 shrink-0 relative">
                                    <button
                                        onClick={() => setSettingsOpen((v) => !v)}
                                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
                                        aria-label="Option chain settings"
                                    >
                                        <FiSettings size={15} />
                                    </button>

                                    {settingsOpen && (
                                        <>
                                            <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                                            <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] text-gray-800 dark:text-gray-100 p-3 shadow-xl text-[13px]">
                                                <div className="mb-3 flex items-center justify-between">
                                                    <span className="font-bold">Chain Settings</span>
                                                    <span className="text-[11px] text-gray-400">{enabledColumnCount}/{totalColumnCount} columns</span>
                                                </div>

                                                <div className="mb-3">
                                                    <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">ATM Based On</div>
                                                    <div className="flex gap-3">
                                                        {[["spot", "Spot"], ["future", "Future"], ["synth", "Synth Future"]].map(([key, label]) => (
                                                            <label key={key} className="flex items-center gap-1 cursor-pointer">
                                                                <input type="radio" name="atmBasis" checked={atmBasis === key} onChange={() => setAtmBasis(key)} />
                                                                {label}
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>

                                                <label className="mb-3 flex items-center justify-between cursor-pointer">
                                                    <span className="font-semibold text-gray-600 dark:text-gray-400">ATM Distance</span>
                                                    <input type="checkbox" checked={showAtmDistance} onChange={() => setShowAtmDistance((v) => !v)} />
                                                </label>

                                                <div className="mb-3">
                                                    <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">Open Interest</div>
                                                    <div className="flex gap-3">
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.oi} onChange={() => toggleColumn("oi")} /> OI
                                                        </label>
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.lot} onChange={() => toggleColumn("lot")} /> Lot
                                                        </label>
                                                    </div>
                                                </div>

                                                <div className="mb-3">
                                                    <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">Delta & IV</div>
                                                    <div className="flex gap-3">
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.callDelta} onChange={() => toggleColumn("callDelta")} /> Call Delta
                                                        </label>
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.putDelta} onChange={() => toggleColumn("putDelta")} /> Put Delta
                                                        </label>
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.iv} onChange={() => toggleColumn("iv")} /> IV
                                                        </label>
                                                    </div>
                                                </div>

                                                <div className="mb-3">
                                                    <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">Greeks</div>
                                                    <div className="flex gap-3">
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.theta} onChange={() => toggleColumn("theta")} /> Theta
                                                        </label>
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.vega} onChange={() => toggleColumn("vega")} /> Vega
                                                        </label>
                                                        <label className="flex items-center gap-1 cursor-pointer">
                                                            <input type="checkbox" checked={columns.gamma} onChange={() => toggleColumn("gamma")} /> Gamma
                                                        </label>
                                                    </div>
                                                </div>

                                                <button onClick={resetChainSettings} className="text-[12px] font-semibold text-[#1677ff] hover:underline cursor-pointer">
                                                    Reset to defaults
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {chainError && (
                            <div className="mb-2 rounded-lg border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">
                                {chainError}
                            </div>
                        )}

                        {/* Option Chain Table */}
                        {chainData && chainData.rows && (
                            <div className="relative">
                                <div ref={chainScrollRef} className="max-h-[80vh] overflow-x-auto overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs custom-scrollbar">
                                    <table className="w-full min-w-[420px] border-collapse text-[12px]">
                                        <thead className="sticky top-0 bg-gray-50 dark:bg-[#070e17] border-b border-gray-200 dark:border-white/10 z-10 shadow-[0_1px_0_0_rgba(229,231,235,1)] dark:shadow-[0_1px_0_0_rgba(255,255,255,0.05)]">
                                            <tr>
                                                {columns.theta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Theta</th>}
                                                {columns.vega && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Vega</th>}
                                                {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Gamma</th>}
                                                {columns.iv && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">IV</th>}
                                                {columns.callDelta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[13%]">CallΔ</th>}
                                                <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[15%]">LTP</th>
                                                {columns.oi && <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[18%]">OI{columns.lot ? " / Lot" : ""}</th>}
                                                <th
                                                    className="py-2 text-center font-bold text-gray-700 dark:text-gray-200 bg-gray-100/80 dark:bg-[#09111c] w-[16%] border-x border-gray-200 dark:border-white/10 cursor-pointer select-none"
                                                    onClick={() => setStrikeAsc((v) => !v)}
                                                    title="Sort strikes"
                                                >
                                                    Strike {strikeAsc ? "↑" : "↓"}
                                                </th>
                                                {columns.oi && <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">OI{columns.lot ? " / Lot" : ""}</th>}
                                                <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">LTP</th>
                                                {columns.putDelta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">PutΔ</th>}
                                                {columns.iv && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">IV</th>}
                                                {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Gamma</th>}
                                                {columns.vega && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Vega</th>}
                                                {columns.theta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Theta</th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {displayChainRows.map((row) => {
                                                const sNum = Number(row.strike);
                                                const ceItm = spotPrice ? sNum < spotPrice : false;
                                                const peItm = spotPrice ? sNum > spotPrice : false;
                                                const isAtm = sNum === effectiveAtmStrike;
                                                const atmOffset = Math.round((sNum - effectiveAtmStrike) / strikeGap);
                                                const lotsCount = lotSize ? Math.round((Number(row.ce?.oi) || 0) / lotSize) : null;
                                                const putLotsCount = lotSize ? Math.round((Number(row.pe?.oi) || 0) / lotSize) : null;

                                                const ceLeg = legsAt(sNum, "CE")[0] || null;
                                                const peLeg = legsAt(sNum, "PE")[0] || null;
                                                const ceNet = netPositionAt(sNum, "CE");
                                                const peNet = netPositionAt(sNum, "PE");
                                                const ceStale = contractStaleness(row.ce, staleOpts);
                                                const peStale = contractStaleness(row.pe, staleOpts);
                                                const ceAge = staleOpts.now - (row.ce?._tickAt || 0);
                                                const peAge = staleOpts.now - (row.pe?._tickAt || 0);
                                                const hasActiveLeg = ceLeg != null || peLeg != null;

                                                return (
                                                    <tr
                                                        key={row.strike}
                                                        ref={isAtm ? atmRowRef : null}
                                                        className={`border-b border-gray-100/70 dark:border-white/5 transition-colors ${
                                                            hasActiveLeg
                                                                ? "bg-[#e6f4ff] dark:bg-[#002b4d]/40 font-semibold"
                                                                : isAtm
                                                                ? "bg-emerald-50/70 dark:bg-emerald-950/40 font-semibold"
                                                                : "hover:bg-gray-50/80 dark:hover:bg-white/[0.03]"
                                                        }`}
                                                    >
                                                        {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.theta ?? "-"}</td>}
                                                        {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.vega ?? "-"}</td>}
                                                        {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.gamma ?? "-"}</td>}
                                                        {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.iv ?? "-"}</td>}
                                                        {columns.callDelta && (
                                                            <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                                {formatDelta(row.ce?.delta)}
                                                                <StaleBadge stale={ceStale.greeksStale} ageMs={staleOpts.now - staleOpts.dataLoadedAt} />
                                                            </td>
                                                        )}

                                                        {/* CALL SIDE */}
                                                        <td className={`group px-1.5 py-1.5 text-right tabular-nums relative ${ceItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                            {ceLeg ? (
                                                                <div className="flex flex-col items-end justify-center py-0.5">
                                                                    <div className="flex items-center gap-1">
                                                                        <span className={`text-[9.5px] font-bold px-1 rounded-full border bg-white dark:bg-[#0c1421] leading-tight ${ceLeg.action === "buy" ? "border-[#52C41A] text-[#52C41A]" : "border-[#FF4D4F] text-[#FF4D4F]"}`}>
                                                                            {ceLeg.action === "buy" ? `+${ceLeg.qty}` : `-${ceLeg.qty}`}
                                                                        </span>
                                                                        <span className="font-bold text-gray-900 dark:text-white tabular-nums text-xs">
                                                                            {formatActivePrice(row.ce?.ltp)}
                                                                        </span>
                                                                        <div className="flex items-center gap-0.5 ml-1">
                                                                            <button
                                                                                onClick={() => updateLeg(ceLeg.id, { action: "buy" })}
                                                                                className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer ${
                                                                                    ceLeg.action === "buy"
                                                                                        ? "bg-[#52c41a] text-white shadow-xs"
                                                                                        : "border border-[#52c41a] text-[#52c41a] hover:bg-[#52c41a] hover:text-white"
                                                                                }`}
                                                                            >
                                                                                B
                                                                            </button>
                                                                            <button
                                                                                onClick={() => updateLeg(ceLeg.id, { action: "sell" })}
                                                                                className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer ${
                                                                                    ceLeg.action === "sell"
                                                                                        ? "bg-[#ff4d4f] text-white shadow-xs"
                                                                                        : "border border-[#ff4d4f] text-[#ff4d4f] hover:bg-[#ff4d4f] hover:text-white"
                                                                                }`}
                                                                            >
                                                                                S
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-center mt-0.5 mr-0.5">
                                                                        <LotsInput
                                                                            size="xs"
                                                                            value={ceLeg.qty}
                                                                            onChange={(n) => updateQty(ceLeg.id, n)}
                                                                            onDecrementAtMin={() => removeLeg(ceLeg.id)}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    {ceNet !== 0 && (
                                                                        <span className={`absolute -top-0.5 right-0.5 z-[1] rounded-full border bg-white dark:bg-[#0c1421] px-1.5 text-[9px] font-bold leading-tight ${ceNet > 0 ? "border-[#52C41A] text-[#52C41A]" : "border-[#FF4D4F] text-[#FF4D4F]"}`}>
                                                                            {ceNet > 0 ? `+${ceNet}` : ceNet}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-gray-700 dark:text-gray-200 group-hover:invisible">
                                                                        {formatActivePrice(row.ce?.ltp)}
                                                                        <StaleBadge stale={ceStale.priceStale} ageMs={ceAge} />
                                                                    </span>
                                                                    <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white dark:bg-[#0c1421]">
                                                                        <button onClick={() => addLeg(row, "CE", "buy")} className="rounded border border-[#52C41A] text-[#52C41A] hover:bg-[#52C41A] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">B</button>
                                                                        <button onClick={() => addLeg(row, "CE", "sell")} className="rounded border border-[#FF4D4F] text-[#FF4D4F] hover:bg-[#FF4D4F] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">S</button>
                                                                        <button onClick={() => setChartModal({ strike: row.strike, right: "CE" })} className="rounded border border-gray-300 dark:border-white/10 px-1 py-0.5 text-[10px] leading-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 cursor-pointer" title="Contract Chart">📈</button>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </td>

                                                        {columns.oi && (
                                                            <td className={`relative p-0 tabular-nums ${ceItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                                <OiBar value={row.ce?.oi} max={maxCeOi} side="ce" />
                                                                {columns.lot && <div className="px-1 pb-0.5 text-[10px] text-gray-400 text-right">{lotsCount ?? "-"} lots</div>}
                                                            </td>
                                                        )}

                                                        {/* STRIKE PRICE */}
                                                        <td className="py-1.5 text-center font-bold text-gray-900 dark:text-white bg-gray-50/40 dark:bg-[#070e17]/80 border-x border-gray-100 dark:border-white/10 text-[13px] tabular-nums">
                                                            {hasActiveLeg ? (
                                                                <span className="inline-block px-2.5 py-0.5 rounded-full font-extrabold bg-white dark:bg-[#0c1a2e] border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100 shadow-xs">
                                                                    {row.strike}
                                                                </span>
                                                            ) : (
                                                                row.strike
                                                            )}
                                                            {showAtmDistance && (
                                                                <div className="text-[10px] font-normal text-gray-400">
                                                                    {atmOffset === 0 ? "ATM" : `ATM${atmOffset > 0 ? "+" : ""}${atmOffset}`}
                                                                </div>
                                                            )}
                                                        </td>

                                                        {/* PUT SIDE */}
                                                        {columns.oi && (
                                                            <td className={`relative p-0 tabular-nums ${peItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                                <OiBar value={row.pe?.oi} max={maxPeOi} side="pe" />
                                                                {columns.lot && <div className="px-1 pb-0.5 text-[10px] text-gray-400">{putLotsCount ?? "-"} lots</div>}
                                                            </td>
                                                        )}

                                                        <td className={`group px-1.5 py-1.5 text-left tabular-nums relative ${peItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                            {peLeg ? (
                                                                <div className="flex flex-col items-start justify-center py-0.5">
                                                                    <div className="flex items-center gap-1">
                                                                        <div className="flex items-center gap-0.5 mr-1">
                                                                            <button
                                                                                onClick={() => updateLeg(peLeg.id, { action: "buy" })}
                                                                                className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer ${
                                                                                    peLeg.action === "buy"
                                                                                        ? "bg-[#52c41a] text-white shadow-xs"
                                                                                        : "border border-[#52c41a] text-[#52c41a] hover:bg-[#52c41a] hover:text-white"
                                                                                }`}
                                                                            >
                                                                                B
                                                                            </button>
                                                                            <button
                                                                                onClick={() => updateLeg(peLeg.id, { action: "sell" })}
                                                                                className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer ${
                                                                                    peLeg.action === "sell"
                                                                                        ? "bg-[#ff4d4f] text-white shadow-xs"
                                                                                        : "border border-[#ff4d4f] text-[#ff4d4f] hover:bg-[#ff4d4f] hover:text-white"
                                                                                }`}
                                                                            >
                                                                                S
                                                                            </button>
                                                                        </div>
                                                                        <span className="font-bold text-gray-900 dark:text-white tabular-nums text-xs">
                                                                            {formatActivePrice(row.pe?.ltp)}
                                                                        </span>
                                                                        <span className={`text-[9.5px] font-bold px-1 rounded-full border bg-white dark:bg-[#0c1421] leading-tight ${peLeg.action === "buy" ? "border-[#52C41A] text-[#52C41A]" : "border-[#FF4D4F] text-[#FF4D4F]"}`}>
                                                                            {peLeg.action === "buy" ? `+${peLeg.qty}` : `-${peLeg.qty}`}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center justify-center mt-0.5 ml-0.5">
                                                                        <LotsInput
                                                                            size="xs"
                                                                            value={peLeg.qty}
                                                                            onChange={(n) => updateQty(peLeg.id, n)}
                                                                            onDecrementAtMin={() => removeLeg(peLeg.id)}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <>
                                                                    {peNet !== 0 && (
                                                                        <span className={`absolute -top-0.5 left-0.5 z-[1] rounded-full border bg-white dark:bg-[#0c1421] px-1.5 text-[9px] font-bold leading-tight ${peNet > 0 ? "border-[#52C41A] text-[#52C41A]" : "border-[#FF4D4F] text-[#FF4D4F]"}`}>
                                                                            {peNet > 0 ? `+${peNet}` : peNet}
                                                                        </span>
                                                                    )}
                                                                    <span className="text-gray-700 dark:text-gray-200 group-hover:invisible">
                                                                        {formatActivePrice(row.pe?.ltp)}
                                                                        <StaleBadge stale={peStale.priceStale} ageMs={peAge} />
                                                                    </span>
                                                                    <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white dark:bg-[#0c1421]">
                                                                        <button onClick={() => addLeg(row, "PE", "buy")} className="rounded border border-[#52C41A] text-[#52C41A] hover:bg-[#52C41A] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">B</button>
                                                                        <button onClick={() => addLeg(row, "PE", "sell")} className="rounded border border-[#FF4D4F] text-[#FF4D4F] hover:bg-[#FF4D4F] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">S</button>
                                                                        <button onClick={() => setChartModal({ strike: row.strike, right: "PE" })} className="rounded border border-gray-300 dark:border-white/10 px-1 py-0.5 text-[10px] leading-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 cursor-pointer" title="Contract Chart">📈</button>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </td>

                                                        {columns.putDelta && (
                                                            <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${peItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                                {formatDelta(row.pe?.delta)}
                                                                <StaleBadge stale={peStale.greeksStale} ageMs={staleOpts.now - staleOpts.dataLoadedAt} />
                                                            </td>
                                                        )}
                                                        {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.pe?.iv ?? "-"}</td>}
                                                        {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.pe?.gamma ?? "-"}</td>}
                                                        {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.pe?.vega ?? "-"}</td>}
                                                        {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.pe?.theta ?? "-"}</td>}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Floating Go to ATM Button */}
                                <button
                                    onClick={() => scrollToAtm("smooth")}
                                    className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full border border-gray-300 dark:border-white/20 bg-white/95 dark:bg-[#0b1420]/95 px-3 py-1 text-[11px] font-bold text-gray-700 dark:text-gray-200 shadow-md hover:bg-gray-50 dark:hover:bg-[#121f33] cursor-pointer transition backdrop-blur-xs"
                                    title="Scroll to ATM strike"
                                >
                                    <span>Go to ATM</span>
                                    <span>🎯</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {hideChain && (
                    <button
                        onClick={() => setHideChain(false)}
                        className="fixed left-3 top-20 z-30 rounded-full border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-3 py-1.5 text-[12px] font-semibold text-gray-600 dark:text-gray-300 shadow-md hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer"
                    >
                        Show Option Chain
                    </button>
                )}

                {/* ----------------------------------------------------------------- */}
                {/* RIGHT PANEL: STRATEGY WORKBENCH, PAYOFF, & TRADING LEDGERS */}
                {/* ----------------------------------------------------------------- */}
                <div className="flex-1 min-w-0 flex flex-col space-y-3">
                    {/* Top Unified Strategy Analysis & Chart Card */}
                    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs overflow-hidden flex flex-col transition-colors">
                        {/* Tab Bar: Payoff, Strategy Chart, Symbol Chart, Combined + Payoff Setting */}
                        <div className="flex items-center justify-between gap-1 border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50 px-3 py-1.5">
                            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                                {[
                                    ["payoff", legs.length > 0 ? "Payoff" : "Ready-Made Strategies"],
                                    ["strategy", "Strategy Chart"],
                                    ["nifty", `${activeSymbol} Chart`],
                                    ["combined", `Strategy Chart + ${activeSymbol} Chart`],
                                ].map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => setChartTab(key)}
                                        className={`shrink-0 rounded-md px-3 py-1 text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                                            chartTab === key
                                                ? "bg-[#e6f4ff] text-[#1677ff] dark:bg-[#002b4d]/60 dark:text-blue-300 shadow-xs"
                                                : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                                        }`}
                                    >
                                        {key === "payoff" && legs.length === 0 && <FiZap size={11} className="text-amber-500" />}
                                        <span>{label}</span>
                                    </button>
                                ))}
                            </div>
                            {chartTab === "payoff" && legs.length > 0 && (
                                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] px-2.5 py-0.5 text-[11px] font-semibold text-gray-600 dark:text-gray-300 shadow-xs">
                                    <span>Payoff setting</span>
                                    <span
                                        role="switch"
                                        aria-checked={payoffSettingsOpen}
                                        onClick={() => setPayoffSettingsOpen((v) => !v)}
                                        className={`relative inline-block h-4 w-7 rounded-full transition-colors cursor-pointer ${payoffSettingsOpen ? "bg-[#1677ff]" : "bg-gray-300 dark:bg-gray-700"}`}
                                    >
                                        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${payoffSettingsOpen ? "translate-x-3.5" : "translate-x-0.5"}`} />
                                    </span>
                                </label>
                            )}
                        </div>

                        {/* What-If Simulation Sliders */}
                        {chartTab === "payoff" && legs.length > 0 && payoffSettingsOpen && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-b border-gray-100 dark:border-white/10 bg-gray-50/60 dark:bg-[#070e17]/60 px-4 py-3 text-[11px]">
                                <div>
                                    <div className="mb-1 flex justify-between font-semibold text-gray-600 dark:text-gray-400">
                                        <span>Underlying</span>
                                        <span className="tabular-nums text-[#1677ff] font-bold">
                                            {whatIfResult ? formatPrice(whatIfResult.simSpot) : "—"} ({whatIfSpotPct > 0 ? "+" : ""}{whatIfSpotPct}%)
                                        </span>
                                    </div>
                                    <input type="range" min={-10} max={10} step={0.5} value={whatIfSpotPct} onChange={(e) => setWhatIfSpotPct(Number(e.target.value))} className="w-full accent-[#1677ff]" />
                                </div>
                                <div>
                                    <div className="mb-1 flex justify-between font-semibold text-gray-600 dark:text-gray-400">
                                        <span>Date/Time</span>
                                        <span className="tabular-nums text-[#1677ff] font-bold">+{whatIfDaysForward}d</span>
                                    </div>
                                    <input type="range" min={0} max={daysUntilExpiry(chainData?.selectedExpiry) || 30} step={1} value={whatIfDaysForward} onChange={(e) => setWhatIfDaysForward(Number(e.target.value))} className="w-full accent-[#1677ff]" />
                                </div>
                                <div>
                                    <div className="mb-1 flex justify-between font-semibold text-gray-600 dark:text-gray-400">
                                        <span>IV</span>
                                        <span className="tabular-nums text-[#1677ff] font-bold">{whatIfIvShift > 0 ? "+" : ""}{whatIfIvShift}pt</span>
                                    </div>
                                    <input type="range" min={-20} max={20} step={1} value={whatIfIvShift} onChange={(e) => setWhatIfIvShift(Number(e.target.value))} className="w-full accent-[#1677ff]" />
                                </div>
                                <div className="sm:col-span-3 flex items-center justify-between rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/60 dark:bg-blue-950/20 px-3 py-2">
                                    <span className="font-semibold text-gray-700 dark:text-gray-300">Simulated P&L at these settings</span>
                                    <span className={`text-sm font-black tabular-nums ${whatIfResult && whatIfResult.pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                        {whatIfResult ? formatPrice(whatIfResult.pnl) : "—"}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Payoff Body: If legs.length === 0, render Ready-Made Strategies by default; otherwise show Payoff Analysis & Chart */}
                        {chartTab === "payoff" ? (
                            legs.length === 0 ? (
                                <div className="p-3">
                                    <PresetStrategies data={chainData} onApply={applyPreset} fetchExpiryRows={fetchExpiryRows} bare />
                                </div>
                            ) : (
                                <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-white/10 bg-white dark:bg-[#0b1420]">
                                    {/* Left Sub-Column: 6 Summary Metrics Stacked Vertically */}
                                    <div className="w-full md:w-[230px] lg:w-[245px] shrink-0 p-3 space-y-3 bg-white dark:bg-[#0b1420] text-xs">
                                        {/* Box 1: P&L */}
                                        <div className="pb-2.5 border-b border-gray-100 dark:border-white/10">
                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">P&L</div>
                                            <div className="flex items-center gap-2">
                                                <span className={`text-sm font-black tabular-nums ${totalLivePnl == null ? "text-gray-500" : totalLivePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                    {totalLivePnl == null ? "0" : `${totalLivePnl >= 0 ? "+" : ""}${Math.round(totalLivePnl).toLocaleString("en-IN")}`}
                                                </span>
                                                <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                                                    totalLivePnl != null && totalLivePnl >= 0
                                                        ? "bg-[#f6ffed] text-[#52c41a] border border-[#b7eb8f] dark:bg-emerald-950/40 dark:border-emerald-800"
                                                        : "bg-[#fff1f0] text-[#ff4d4f] border border-[#ffccc7] dark:bg-rose-950/40 dark:border-rose-800"
                                                }`}>
                                                    {totalLivePnl != null && (payoffData.fundsRequired > 0 || payoffData.estMargin > 0)
                                                        ? `(${((totalLivePnl / (payoffData.fundsRequired || payoffData.estMargin)) * 100).toFixed(2)}%)`
                                                        : "(0.00%)"}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Box 2: Funds Required & Est. Margin */}
                                        <div className="pb-2.5 border-b border-gray-100 dark:border-white/10 space-y-1.5">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-0.5">Funds Required</div>
                                                    <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        {payoffData.fundsRequired == null ? "—" : payoffData.fundsRequired >= 100000 ? `${(payoffData.fundsRequired / 100000).toFixed(2)}L` : formatActivePrice(payoffData.fundsRequired)}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-0.5">Est. Margin</div>
                                                    <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                                                        {payoffData.estMargin == null ? "—" : (payoffData.estMargin > 0 ? (payoffData.estMargin >= 100000 ? `${(payoffData.estMargin / 100000).toFixed(2)}L` : formatActivePrice(payoffData.estMargin)) : (payoffData.fundsRequired > 0 ? (payoffData.fundsRequired >= 100000 ? `${(payoffData.fundsRequired / 100000).toFixed(2)}L` : formatActivePrice(payoffData.fundsRequired)) : "Not required"))}
                                                    </div>
                                                </div>
                                            </div>
                                            {payoffData.marginBenefit > 0 && (
                                                <div className="flex items-center justify-between text-[11px] bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                                    <span className="text-emerald-700 dark:text-emerald-300 font-semibold">Hedge Benefit:</span>
                                                    <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                                        Saved {payoffData.marginBenefit >= 100000 ? `${(payoffData.marginBenefit / 100000).toFixed(2)}L` : formatActivePrice(payoffData.marginBenefit)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                    {/* Box 3: POP & Risk : Reward */}
                                    <div className="pb-2.5 border-b border-gray-100 dark:border-white/10 flex items-start justify-between gap-2">
                                        <div>
                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">POP</div>
                                            <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                                                {payoffData.pop != null ? `${payoffData.pop.toFixed(0)}%` : "—"}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <button
                                                type="button"
                                                onClick={() => setRewardRiskOrder((v) => !v)}
                                                className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#1677ff] dark:text-gray-400 cursor-pointer ml-auto mb-1 transition-colors"
                                            >
                                                <span>{rewardRiskOrder ? "Reward : Risk" : "Risk : Reward"}</span>
                                                <span className="text-[10px]">⇅</span>
                                            </button>
                                            <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                                                {formatRiskReward(payoffData.maxProfit, payoffData.maxLoss, rewardRiskOrder)}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Box 4: Max Profit */}
                                    <div className="pb-2.5 border-b border-gray-100 dark:border-white/10">
                                        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Max Profit</div>
                                        <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                            {payoffData.maxProfit == null ? "—" : typeof payoffData.maxProfit === "number" ? (
                                                <>
                                                    {payoffData.maxProfit >= 0 ? "+" : ""}{formatActivePrice(payoffData.maxProfit)}
                                                    {(payoffData.fundsRequired > 0 || payoffData.estMargin > 0) && (
                                                        <span className="text-[11px] font-normal text-emerald-600/80 dark:text-emerald-400/80 ml-1">
                                                            ({((payoffData.maxProfit / (payoffData.fundsRequired || payoffData.estMargin)) * 100).toFixed(2)}%)
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                payoffData.maxProfit
                                            )}
                                        </div>
                                    </div>

                                    {/* Box 5: Max Loss */}
                                    <div className="pb-2.5 border-b border-gray-100 dark:border-white/10">
                                        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Max Loss</div>
                                        <div className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                                            {payoffData.maxLoss == null ? "—" : typeof payoffData.maxLoss === "number" ? (
                                                <>
                                                    {formatActivePrice(payoffData.maxLoss)}
                                                    {(payoffData.fundsRequired > 0 || payoffData.estMargin > 0) && (
                                                        <span className="text-[11px] font-normal text-rose-600/80 dark:text-rose-400/80 ml-1">
                                                            ({((Math.abs(payoffData.maxLoss) / (payoffData.fundsRequired || payoffData.estMargin)) * 100).toFixed(2)}%)
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                payoffData.maxLoss
                                            )}
                                        </div>
                                    </div>

                                    {/* Box 6: Breakevens */}
                                    <div>
                                        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Breakevens</div>
                                        <div className="text-[11.5px] font-bold text-gray-800 dark:text-gray-200">
                                            {payoffData.breakevens && payoffData.breakevens.length > 0 ? (
                                                payoffData.breakevens.map((be, idx) => {
                                                    const pct = spotPrice ? ((be - spotPrice) / spotPrice) * 100 : null;
                                                    return (
                                                        <span key={idx}>
                                                            {idx > 0 && " - "}
                                                            <span>{isCrypto ? Number(be).toFixed(1) : Math.round(be).toLocaleString("en-IN")}</span>
                                                            {pct != null && (
                                                                <span className="text-[10.5px] font-normal text-gray-500 dark:text-gray-400 ml-0.5">
                                                                    ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)
                                                                </span>
                                                            )}
                                                        </span>
                                                    );
                                                })
                                            ) : (
                                                <span className="text-gray-400 font-normal">None</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Right Sub-Column: Payoff Chart */}
                                <div className="flex-1 min-w-0 p-2 sm:p-3 flex flex-col justify-center">
                                    <PayoffChart
                                        curve={payoffData.curve}
                                        spotPrice={spotPrice}
                                        breakevens={payoffData.breakevens}
                                        expectedMove={payoffData.expectedMove}
                                        oiData={chainData?.rows || []}
                                        yearsRemaining={payoffData.yearsRemaining}
                                        height={340}
                                    />
                                </div>
                            </div>
                            )
                        ) : (
                            <div className="p-3">
                                {chartTab === "strategy" && <StrategyTradingViewChart symbol={activeSymbol} mode="strategy" legs={legs} />}
                                {chartTab === "nifty" && <StrategyTradingViewChart symbol={activeSymbol} mode="nifty" legs={legs} />}
                                {chartTab === "combined" && <StrategyTradingViewChart symbol={activeSymbol} mode="combined" legs={legs} />}
                            </div>
                        )}
                    </div>

                    {/* Bottom Segment Control & Trading Ledgers */}
                    <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs overflow-hidden transition-colors">
                        {/* Tab Headers Strip */}
                        <div className="flex items-center justify-between border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-4 pt-1">
                            <div className="flex items-center gap-4 overflow-x-auto scrollbar-none">
                                <button
                                    onClick={() => setTab("positions")}
                                    className={`py-2 text-xs font-bold transition-colors cursor-pointer border-b-2 ${
                                        tab === "positions"
                                            ? "border-[#1677ff] text-[#1677ff]"
                                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    Positions{legs.length > 0 ? ` (${legs.length})` : ""}
                                </button>
                                <button
                                    onClick={() => setTab("greeks")}
                                    className={`py-2 text-xs font-bold transition-colors cursor-pointer border-b-2 ${
                                        tab === "greeks"
                                            ? "border-[#1677ff] text-[#1677ff]"
                                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    Greeks
                                </button>
                                <button
                                    onClick={() => setTab("open_trades")}
                                    className={`py-2 text-xs font-bold transition-colors cursor-pointer border-b-2 flex items-center gap-1 ${
                                        tab === "open_trades"
                                            ? "border-[#1677ff] text-[#1677ff]"
                                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    <span>Open Trades</span>
                                    {openPositions.length > 0 && (
                                        <span className="rounded-full bg-emerald-600 text-white text-[10px] px-1.5 py-0.2 font-mono">
                                            {openPositions.length}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        setTab("orders");
                                        loadOrders();
                                    }}
                                    className={`py-2 text-xs font-bold transition-colors cursor-pointer border-b-2 flex items-center gap-1 ${
                                        tab === "orders"
                                            ? "border-[#1677ff] text-[#1677ff]"
                                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    <span>Orders</span>
                                    {orders.filter((o) => o.status === "PENDING").length > 0 ? (
                                        <span className="rounded-full bg-amber-500 text-white text-[10px] px-1.5 py-0.2 font-mono font-bold animate-pulse">
                                            {orders.filter((o) => o.status === "PENDING").length}
                                        </span>
                                    ) : orders.length > 0 ? (
                                        <span className="text-[10px] text-gray-400 font-mono">({orders.length})</span>
                                    ) : null}
                                </button>
                                <button
                                    onClick={() => setTab("history")}
                                    className={`py-2 text-xs font-bold transition-colors cursor-pointer border-b-2 flex items-center gap-1 ${
                                        tab === "history"
                                            ? "border-[#1677ff] text-[#1677ff]"
                                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    <span>History</span>
                                    {closedPositions.length > 0 && (
                                        <span className="text-[10px] text-gray-400 font-mono">({closedPositions.length})</span>
                                    )}
                                </button>
                                <button
                                    onClick={() => setTab("presets")}
                                    className={`py-2 text-xs font-bold transition-colors cursor-pointer border-b-2 flex items-center gap-1 ${
                                        tab === "presets"
                                            ? "border-[#1677ff] text-[#1677ff]"
                                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    <FiZap size={11} />
                                    <span>Ready-Made</span>
                                </button>
                                <button
                                    onClick={() => setTab("leaderboard")}
                                    className={`py-2 text-xs font-bold transition-colors cursor-pointer border-b-2 flex items-center gap-1 ${
                                        tab === "leaderboard"
                                            ? "border-[#1677ff] text-[#1677ff]"
                                            : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    <span>🏆</span>
                                    <span>Leaderboard</span>
                                </button>
                            </div>
                        </div>

                        {/* SUB-TAB 1: POSITIONS (Strategy Basket) */}
                        {tab === "positions" && (
                            <>
                                {legs.length === 0 ? (
                                    <div className="p-8 text-center text-xs text-gray-400 space-y-3">
                                        <div className="text-3xl">📋</div>
                                        <div className="font-bold text-gray-700 dark:text-gray-200 text-sm">
                                            No Strategy Selected
                                        </div>
                                        <p className="text-gray-500 max-w-sm mx-auto">
                                            Click <strong>B</strong> (Buy) or <strong>S</strong> (Sell) on strikes in the Option Chain on the left, or explore Ready-Made Strategies.
                                        </p>
                                        <div className="pt-2">
                                            <button
                                                onClick={() => setTab("presets")}
                                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition cursor-pointer"
                                            >
                                                ⚡ Browse Ready-Made Strategies
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* StockMojo Sub-Toolbar Strip */}
                                        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50 px-4 py-2 text-xs">
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={allLegsActive}
                                                    onChange={toggleSelectAllLegs}
                                                    className="accent-[#1677ff] w-4 h-4 rounded cursor-pointer"
                                                    title="Select / Deselect All Legs"
                                                />
                                                <button
                                                    onClick={() => setLegsTopFirst((v) => !v)}
                                                    className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white bg-[#1677ff] hover:bg-blue-600 transition shadow-xs cursor-pointer"
                                                >
                                                    <span>Top</span>
                                                    <span className="w-2.5 h-2.5 rounded-full bg-white inline-block" />
                                                </button>
                                                <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
                                                    <span className="font-medium text-[11.5px]">Multiplier:</span>
                                                    <div className={commonLots ? "flex items-center" : "flex items-center rounded border border-gray-300 dark:border-white/10 bg-white dark:bg-[#070e17] overflow-hidden"}>
                                                        {commonLots ? (
                                                            <LotsInput value={commonLots} onChange={setAllLots} title="Lots for every leg" />
                                                        ) : (
                                                            <>
                                                                <button onClick={() => bulkAdjustLots(-1)} className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 font-bold cursor-pointer">−</button>
                                                                <span className="px-1 text-center font-bold text-gray-500">mixed</span>
                                                                <button onClick={() => bulkAdjustLots(1)} className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 font-bold cursor-pointer">+</button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="text-[11.5px] font-semibold text-gray-700 dark:text-gray-300">
                                                    Qty: <span className="font-bold tabular-nums text-gray-900 dark:text-white">{totalLots * lotSize}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-xs">
                                                <span className="text-sm">🎯</span>
                                                <span className="font-semibold text-gray-600 dark:text-gray-400">Total P&L: </span>
                                                <span className={`font-bold tabular-nums ${totalLivePnl != null && totalLivePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                    {totalLivePnl != null ? `${totalLivePnl >= 0 ? "+" : ""}${Math.round(totalLivePnl).toLocaleString("en-IN")}(${(payoffData.fundsRequired || payoffData.estMargin) > 0 ? ((totalLivePnl / (payoffData.fundsRequired || payoffData.estMargin)) * 100).toFixed(2) : "0.00"}%)` : "+0(0.00%)"}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Table of Strategy Legs */}
                                        <div className="w-full overflow-x-auto scrollbar-thin">
                                            <table className="w-full min-w-[720px] border-collapse text-[12px] sm:text-[13px]">
                                                <thead>
                                                    <tr className="text-gray-400 dark:text-gray-400 bg-gray-50/40 dark:bg-[#070e17]/40 border-b border-gray-100 dark:border-white/10 whitespace-nowrap">
                                                        <th className="px-2 py-2.5 w-8"></th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-left font-medium">Action</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-center font-medium">Lots</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-left font-medium">Expiry</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-center font-medium">Strike</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-center font-medium">Type</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-right font-medium">Entry</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-right font-medium">LTP/Exit</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-right font-medium">P&L</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-center font-medium">SL/TG</th>
                                                        <th className="px-3 sm:px-4 py-2.5 text-center font-medium">Exit</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-white/5 whitespace-nowrap">
                                                    {orderedLegs.map((leg) => {
                                                        const row = rowByStrike.get(Number(leg.strike));
                                                        const liveLtp = row ? (leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp) : null;
                                                        const currentLtp = leg.ltpOverride ?? liveLtp;
                                                        const livePnl = legLivePnl(leg);
                                                        const included = leg.active !== false;

                                                        return (
                                                            <tr key={leg.id} className={`hover:bg-gray-50/40 dark:hover:bg-white/[0.03] transition-colors ${included ? "" : "opacity-50"}`}>
                                                                <td className="px-2 py-2 sm:py-2.5 text-center">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={included}
                                                                        onChange={() => toggleLegActive(leg.id)}
                                                                        className="accent-[#1677ff] w-3.5 h-3.5 rounded cursor-pointer"
                                                                    />
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5">
                                                                    <button
                                                                        onClick={() => toggleLegSide(leg.id)}
                                                                        className={`w-6 h-6 rounded flex items-center justify-center font-extrabold text-[11px] text-white shadow-xs transition-colors cursor-pointer ${
                                                                            leg.action === "buy" ? "bg-[#52c41a]" : "bg-[#ff4d4f]"
                                                                        }`}
                                                                        title="Flip Buy/Sell"
                                                                    >
                                                                        {leg.action === "buy" ? "B" : "S"}
                                                                    </button>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                    <LotsInput
                                                                        value={leg.qty}
                                                                        onChange={(n) => updateQty(leg.id, n)}
                                                                        onDecrementAtMin={() => removeLeg(leg.id)}
                                                                    />
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5">
                                                                    <select
                                                                        value={leg.expiry || chainData?.selectedExpiry || ""}
                                                                        onChange={(e) => rollLegExpiry(leg.id, e.target.value)}
                                                                        className="rounded border border-gray-200 dark:border-white/10 bg-transparent px-1.5 py-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200 outline-none hover:border-[#1677ff] cursor-pointer"
                                                                    >
                                                                        {(chainData?.expiries || [leg.expiry]).map((exp) => (
                                                                            <option key={exp} value={exp} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">
                                                                                {formatExpiryShort(exp)}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center font-bold tabular-nums">
                                                                    <div className="inline-flex items-center gap-1 rounded border border-gray-200 dark:border-white/10 px-1 py-0.5 bg-gray-50/50 dark:bg-[#070e17]/50">
                                                                        <button onClick={() => rollLegStrike(leg.id, -1)} className="px-1 text-gray-400 hover:text-gray-800 dark:hover:text-white font-bold cursor-pointer">−</button>
                                                                        <span className="px-1 text-gray-900 dark:text-white">{leg.strike}</span>
                                                                        <button onClick={() => rollLegStrike(leg.id, 1)} className="px-1 text-gray-400 hover:text-gray-800 dark:hover:text-white font-bold cursor-pointer">+</button>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                    <span className={`px-2 py-0.5 rounded font-bold text-[11px] border ${
                                                                        leg.type === "CE"
                                                                            ? "text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20"
                                                                            : "text-rose-600 border-rose-300 dark:text-rose-400 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20"
                                                                    }`}>
                                                                        {leg.type}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-right font-mono tabular-nums text-gray-800 dark:text-gray-200">
                                                                    {formatActivePrice(leg.premium)}
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">
                                                                    {formatActivePrice(currentLtp)}
                                                                </td>
                                                                <td className={`px-3 sm:px-4 py-2 sm:py-2.5 text-right font-mono font-bold tabular-nums ${
                                                                    livePnl == null ? "text-gray-400" : livePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                                }`}>
                                                                    {livePnl == null ? "—" : `${livePnl >= 0 ? "+" : ""}${Math.round(livePnl).toLocaleString("en-IN")}`}
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                    <button
                                                                        onClick={() => openSlTgModal(leg)}
                                                                        className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-white/10 transition cursor-pointer ${
                                                                            leg.slPercent != null || leg.tgPercent != null ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-gray-400"
                                                                        }`}
                                                                        title={leg.slPercent != null || leg.tgPercent != null ? `SL: ${leg.slPercent ?? "—"}% | Target: ${leg.tgPercent ?? "—"}%` : "Set Stop Loss / Target"}
                                                                    >
                                                                        🎯
                                                                    </button>
                                                                </td>
                                                                <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                    <div className="flex items-center justify-center gap-1">
                                                                        <button onClick={() => resetLegEntryToLtp(leg.id)} className="p-1 text-gray-400 hover:text-blue-500 cursor-pointer" title="Reset entry to current LTP">🔄</button>
                                                                        <button onClick={() => removeLeg(leg.id)} className="p-1 text-gray-400 hover:text-rose-500 cursor-pointer" title="Remove leg">🗑</button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Action Controls & Execution Footer */}
                                        <div className="p-3 bg-gray-50/60 dark:bg-[#070e17]/60 border-t border-gray-100 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                                            <div className="flex items-center gap-4 text-xs font-semibold">
                                                <div>
                                                    <span className="text-gray-400 uppercase text-[10px] block">Funds Required</span>
                                                    <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                                        {formatActivePrice(payoffData.fundsRequired)}
                                                    </span>
                                                </div>
                                                <div className="h-6 w-px bg-gray-200 dark:bg-white/10" />
                                                <div>
                                                    <span className="text-gray-400 uppercase text-[10px] block">Est. Margin</span>
                                                    <span className="text-sm font-bold text-gray-900 dark:text-white font-mono">
                                                        {(payoffData.estMargin && payoffData.estMargin > 0) ? formatActivePrice(payoffData.estMargin) : (payoffData.fundsRequired > 0 ? formatActivePrice(payoffData.fundsRequired) : "Not required")}
                                                    </span>
                                                </div>
                                                {payoffData.marginBenefit > 0 && (
                                                    <>
                                                        <div className="h-6 w-px bg-gray-200 dark:bg-white/10" />
                                                        <div>
                                                            <span className="text-gray-400 uppercase text-[10px] block">Hedge Benefit</span>
                                                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 font-mono bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                                                Saved {formatActivePrice(payoffData.marginBenefit)}
                                                            </span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setLegs([])}
                                                    className="px-3 py-2 rounded-xl border border-gray-300 dark:border-white/10 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer transition"
                                                >
                                                    Clear Basket
                                                </button>
                                                <button
                                                    onClick={handleExecuteHedge}
                                                    disabled={isExecuting || legs.length === 0}
                                                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-extrabold text-xs sm:text-sm shadow-md shadow-emerald-600/20 transition flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                                                >
                                                    <FiCheck size={16} />
                                                    <span>{isExecuting ? "Executing Live…" : "⚡ Execute Live Paper Trade"}</span>
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </>
                        )}

                        {/* SUB-TAB 2: GREEKS */}
                        {tab === "greeks" && (
                            <div className="p-3">
                                <PortfolioGreeksTable legs={activeLegs} netGreeks={payoffData.netGreeks} />
                            </div>
                        )}

                        {/* SUB-TAB 3: OPEN TRADES (Live Paper Positions) */}
                        {tab === "open_trades" && (
                            <div className="space-y-3 p-3">
                                {/* Summary KPI Ribbon */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                                    <div className="p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50">
                                        <div className="text-gray-400 font-semibold uppercase text-[10px]">Active Positions</div>
                                        <div className="text-lg font-bold font-mono text-gray-900 dark:text-white mt-0.5">{openPositions.length}</div>
                                    </div>
                                    <div className="p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50">
                                        <div className="text-gray-400 font-semibold uppercase text-[10px]">Unrealized P&L</div>
                                        <div className={`text-lg font-bold font-mono mt-0.5 ${totalUnrealized >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                            {totalUnrealized >= 0 ? "+" : ""}{formatActivePrice(totalUnrealized)}
                                        </div>
                                    </div>
                                    <div className="p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50">
                                        <div className="text-gray-400 font-semibold uppercase text-[10px]">Margin Blocked</div>
                                        <div className="text-lg font-bold font-mono text-gray-900 dark:text-white mt-0.5">{formatActivePrice(totalMarginBlocked)}</div>
                                    </div>
                                    <div className="p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50">
                                        <div className="text-gray-400 font-semibold uppercase text-[10px]">Available Capital</div>
                                        <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">{formatActivePrice(virtualCash)}</div>
                                    </div>
                                </div>

                                {openPositions.length > 0 && (
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={analyzeAllOpenPositionsInPayoff}
                                            className="px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/60 border border-blue-300 dark:border-blue-800 text-[#1677ff] dark:text-blue-300 font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-xs"
                                            title="Load all active trades into Payoff Chart to analyze combined payoff curve and Greeks"
                                        >
                                            <FiActivity size={13} />
                                            <span>📊 Analyze Payoff</span>
                                        </button>
                                        <button
                                            onClick={handleCloseAllPositions}
                                            disabled={closingAll}
                                            className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs transition cursor-pointer disabled:opacity-50 shadow-xs"
                                        >
                                            {closingAll ? "Exiting All…" : "Square Off All Positions"}
                                        </button>
                                    </div>
                                )}

                                {/* Positions Ledger */}
                                {openPositions.length === 0 ? (
                                    <div className="py-12 text-center text-gray-400 text-xs space-y-2">
                                        <div className="text-3xl mb-1">📋</div>
                                        <p className="font-bold text-gray-700 dark:text-gray-300">No Open Paper Positions</p>
                                        <p className="text-gray-500">Pick strikes from the Option Chain or a Ready-Made Strategy to start live trading.</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto custom-scrollbar">
                                        <table className="w-full text-xs text-left">
                                            <thead className="bg-gray-100/70 dark:bg-[#070e17]/80 text-gray-500 border-b border-gray-200 dark:border-white/10 font-bold uppercase text-[10px]">
                                                <tr>
                                                    <th className="px-3 py-2.5">Symbol</th>
                                                    <th className="px-3 py-2.5 text-center">Side</th>
                                                    <th className="px-3 py-2.5 text-center">Lots</th>
                                                    <th className="px-3 py-2.5">Expiry</th>
                                                    <th className="px-3 py-2.5 text-center">Strike</th>
                                                    <th className="px-3 py-2.5 text-center">Type</th>
                                                    <th className="px-3 py-2.5 text-right">Entry LTP</th>
                                                    <th className="px-3 py-2.5 text-right">Live LTP</th>
                                                    <th className="px-3 py-2.5 text-right">Unrealized P&L</th>
                                                    <th className="px-3 py-2.5 text-center">SL / Target</th>
                                                    <th className="px-3 py-2.5 text-right">Margin Blocked</th>
                                                    <th className="px-3 py-2.5 text-center">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-white/5 font-mono tabular-nums text-xs">
                                                {openPositions.map((pos) => {
                                                    const pnl = Number(pos.unrealizedPnl || 0);
                                                    const isProfit = pnl >= 0;
                                                    const entry = Number(pos.entry_price || 0);
                                                    const current = Number(pos.current_price || entry);
                                                    const pnlPct = entry > 0 ? ((current - entry) / entry) * 100 : 0;

                                                    return (
                                                        <tr key={pos.id} className="hover:bg-gray-50/80 dark:hover:bg-white/[0.03] transition">
                                                            <td className="px-3 py-2.5 font-bold text-gray-900 dark:text-white">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span>{pos.symbol}</span>
                                                                    {pos.market === "crypto" && (
                                                                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/30">
                                                                            CRYPTO
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="px-3 py-2.5 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                                    pos.side === "long"
                                                                        ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                                                                        : "bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300"
                                                                }`}>
                                                                    {pos.side === "long" ? "BUY" : "SELL"}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2.5 text-center font-bold">{pos.lots}</td>
                                                            <td className="px-3 py-2.5 font-sans text-gray-700 dark:text-gray-300">{formatExpiryShort(pos.expiry)}</td>
                                                            <td className="px-3 py-2.5 text-center font-bold text-gray-900 dark:text-white">{pos.strike}</td>
                                                            <td className="px-3 py-2.5 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                                    pos.option_type === "CE"
                                                                        ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                                                                        : "bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400"
                                                                }`}>
                                                                    {pos.option_type}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2.5 text-right font-bold text-gray-700 dark:text-gray-300">{formatActivePrice(pos.entry_price)}</td>
                                                            <td className="px-3 py-2.5 text-right font-bold text-gray-900 dark:text-white">{pos.current_price != null ? formatActivePrice(pos.current_price) : "—"}</td>
                                                            <td className={`px-3 py-2.5 text-right font-bold ${isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                                {isProfit ? "+" : ""}{formatActivePrice(pnl)}
                                                                <span className="block text-[10px] font-normal opacity-80">({isProfit ? "+" : ""}{pnlPct.toFixed(1)}%)</span>
                                                            </td>
                                                            <td className="px-3 py-2.5 text-center font-sans">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openPositionSl(pos)}
                                                                    className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer font-mono text-[11px]"
                                                                >
                                                                    {pos.stop_loss_price == null && pos.target_price == null ? (
                                                                        <span className="font-sans font-bold text-emerald-600 dark:text-emerald-400 hover:underline">+ Add SL</span>
                                                                    ) : (
                                                                        <span>
                                                                            SL {pos.stop_loss_price != null ? formatActivePrice(pos.stop_loss_price) : "—"} · T {pos.target_price != null ? formatActivePrice(pos.target_price) : "—"}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                            </td>
                                                            <td className="px-3 py-2.5 text-right font-medium text-gray-700 dark:text-gray-300">
                                                                {formatActivePrice(getPositionMarginBlocked(pos, spotPrice))}
                                                            </td>
                                                            <td className="px-3 py-2.5 text-center">
                                                                <div className="flex items-center justify-center gap-1.5">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => analyzePositionInPayoff(pos)}
                                                                        className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-950/50 text-[#1677ff] dark:text-blue-400 transition cursor-pointer"
                                                                        title="Analyze in Payoff Chart"
                                                                    >
                                                                        <FiActivity size={13} />
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleClosePosition(pos)}
                                                                        disabled={closingId === pos.id}
                                                                        className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-extrabold text-[11px] transition cursor-pointer disabled:opacity-50"
                                                                    >
                                                                        {closingId === pos.id ? "…" : "Exit"}
                                                                    </button>
                                                                </div>
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

                        {/* SUB-TAB 4: ORDERS */}
                        {tab === "orders" && (
                            <div className="space-y-3 p-3">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-[#070e17] p-1 rounded-xl text-xs font-bold">
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
                                                            ? "bg-white dark:bg-[#0b1420] text-emerald-600 dark:text-emerald-400 shadow-xs font-bold"
                                                            : "text-gray-600 dark:text-gray-400"
                                                    }`}
                                                >
                                                    <span>{filter}</span>
                                                    <span className="text-[10px] text-gray-400 font-mono">({count})</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={loadOrders}
                                        disabled={ordersLoading}
                                        className="p-1.5 rounded-lg border border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-900 dark:hover:text-white transition cursor-pointer"
                                    >
                                        <FiRefreshCw size={13} className={ordersLoading ? "animate-spin" : ""} />
                                    </button>
                                </div>

                                {(() => {
                                    const filtered = orders.filter((o) => {
                                        if (orderFilter === "ALL") return true;
                                        if (orderFilter === "CANCELLED") return o.status === "CANCELLED" || o.status === "REJECTED";
                                        return o.status === orderFilter;
                                    });

                                    if (!filtered.length) {
                                        return (
                                            <div className="py-12 text-center text-gray-400 text-xs">
                                                No {orderFilter !== "ALL" ? orderFilter.toLowerCase() : ""} orders.
                                            </div>
                                        );
                                    }

                                    return (
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left text-xs">
                                                <thead className="bg-gray-50 dark:bg-[#070e17] text-gray-400 font-bold uppercase text-[10px] border-b border-gray-200 dark:border-white/10">
                                                    <tr>
                                                        <th className="px-3 py-2">Order</th>
                                                        <th className="px-3 py-2">Contract</th>
                                                        <th className="px-3 py-2">Side</th>
                                                        <th className="px-3 py-2 text-right">Lots</th>
                                                        <th className="px-3 py-2 text-right">Price</th>
                                                        <th className="px-3 py-2 text-center">Status</th>
                                                        <th className="px-3 py-2 text-center">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-white/5 font-mono tabular-nums">
                                                    {filtered.map((ord) => (
                                                        <tr key={ord.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                                                            <td className="px-3 py-2 font-bold">#{String(ord.id).slice(-6)}</td>
                                                            <td className="px-3 py-2 font-sans font-bold">
                                                                {ord.symbol} {ord.strike} {ord.option_type || ord.optRight}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                                                    (ord.side || "").toLowerCase() === "buy" ? "text-emerald-600 bg-emerald-50" : "text-rose-600 bg-rose-50"
                                                                }`}>
                                                                    {ord.side?.toUpperCase()}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2 text-right">{ord.lots}</td>
                                                            <td className="px-3 py-2 text-right">{formatActivePrice(ord.price || ord.executed_price)}</td>
                                                            <td className="px-3 py-2 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                                    ord.status === "EXECUTED" ? "bg-emerald-100 text-emerald-700" : ord.status === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                                                                }`}>
                                                                    {ord.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2 text-center font-sans">
                                                                {ord.status === "PENDING" && (
                                                                    <button
                                                                        onClick={() => handleCancelOrder(ord)}
                                                                        disabled={cancellingOrderId === ord.id}
                                                                        className="text-rose-600 hover:underline cursor-pointer text-xs font-bold"
                                                                    >
                                                                        {cancellingOrderId === ord.id ? "…" : "Cancel"}
                                                                    </button>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {/* SUB-TAB 5: HISTORY */}
                        {tab === "history" && (
                            <div className="space-y-3 p-3">
                                {closedPositions.length === 0 ? (
                                    <div className="py-12 text-center text-gray-400 text-xs">
                                        No closed trades yet.
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left">
                                            <thead className="bg-gray-50 dark:bg-[#070e17] text-gray-400 font-bold uppercase text-[10px] border-b border-gray-200 dark:border-white/10">
                                                <tr>
                                                    <th className="px-3 py-2">Symbol</th>
                                                    <th className="px-3 py-2">Expiry</th>
                                                    <th className="px-3 py-2 text-center">Strike</th>
                                                    <th className="px-3 py-2 text-center">Side</th>
                                                    <th className="px-3 py-2 text-right">Entry</th>
                                                    <th className="px-3 py-2 text-right">Exit</th>
                                                    <th className="px-3 py-2 text-right">Realized P&L</th>
                                                    <th className="px-3 py-2 text-center">Exit Reason</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-white/5 font-mono tabular-nums">
                                                {closedPositions.map((pos) => {
                                                    const pnl = Number(pos.realized_pnl || 0);
                                                    return (
                                                        <tr key={pos.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                                                            <td className="px-3 py-2 font-bold font-sans">{pos.symbol} {pos.option_type}</td>
                                                            <td className="px-3 py-2 font-sans">{formatExpiryShort(pos.expiry)}</td>
                                                            <td className="px-3 py-2 text-center font-bold">{pos.strike}</td>
                                                            <td className="px-3 py-2 text-center uppercase text-[10px] font-bold">{pos.side}</td>
                                                            <td className="px-3 py-2 text-right">{formatActivePrice(pos.entry_price)}</td>
                                                            <td className="px-3 py-2 text-right">{formatActivePrice(pos.exit_price)}</td>
                                                            <td className={`px-3 py-2 text-right font-bold ${pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                                {pnl >= 0 ? "+" : ""}{formatActivePrice(pnl)}
                                                            </td>
                                                            <td className="px-3 py-2 text-center font-sans text-gray-500 capitalize">{pos.exit_reason || "Manual"}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SUB-TAB 6: READY-MADE STRATEGIES */}
                        {tab === "presets" && (
                            <div className="p-3">
                                <PresetStrategies data={chainData} onApply={applyPreset} fetchExpiryRows={fetchExpiryRows} bare />
                            </div>
                        )}

                        {/* SUB-TAB 7: LEADERBOARD */}
                        {tab === "leaderboard" && (
                            <div className="p-3 space-y-3">
                                {leaderboardData?.leaderboard && (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs text-left">
                                            <thead className="bg-gray-50 dark:bg-[#070e17] text-gray-400 font-bold uppercase text-[10px] border-b border-gray-200 dark:border-white/10">
                                                <tr>
                                                    <th className="px-3 py-2">Rank</th>
                                                    <th className="px-3 py-2">Trader</th>
                                                    <th className="px-3 py-2 text-right">Trades</th>
                                                    <th className="px-3 py-2 text-right">Win Rate</th>
                                                    <th className="px-3 py-2 text-right">Balance</th>
                                                    <th className="px-3 py-2 text-right">Net P&L</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                                                {leaderboardData.leaderboard.map((t) => (
                                                    <tr key={t.userId} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                                                        <td className="px-3 py-2 font-bold">#{t.rank}</td>
                                                        <td className="px-3 py-2 font-bold">{t.name}</td>
                                                        <td className="px-3 py-2 text-right tabular-nums">{t.closedTrades}</td>
                                                        <td className="px-3 py-2 text-right tabular-nums font-bold text-emerald-600">{t.winRate}%</td>
                                                        <td className="px-3 py-2 text-right tabular-nums font-mono">{formatRupees(t.balance)}</td>
                                                        <td className={`px-3 py-2 text-right tabular-nums font-mono font-bold ${t.netPnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                            {t.netPnl >= 0 ? "+" : ""}{formatRupees(t.netPnl)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ========================================================================= */}
            {/* MODALS */}
            {/* ========================================================================= */}

            {/* Saved Strategies Modal */}
            {savedOpen && (
                <SavedStrategiesModal
                    onClose={() => setSavedOpen(false)}
                    onLoad={(loadedLegs, underlying) => {
                        if (underlying !== activeSymbol) setSymbol(underlying);
                        setLegs(loadedLegs.map((l) => ({ ...l, id: ++legIdCounter })));
                        setTab("positions");
                        setChartTab("payoff");
                        setSavedOpen(false);
                    }}
                />
            )}

            {/* Contract Chart Modal */}
            {chartModal && (
                <ContractChartModal
                    symbol={activeSymbol}
                    strike={chartModal.strike}
                    expiry={chainData?.selectedExpiry}
                    right={chartModal.right}
                    onClose={() => setChartModal(null)}
                    onAddLeg={(right, action) => {
                        const row = rowByStrike.get(Number(chartModal.strike));
                        if (row) addLeg(row, right, action);
                    }}
                />
            )}

            {/* Per-Leg SL / TG Modal */}
            {slTgEditId && (() => {
                const leg = legs.find((l) => l.id === slTgEditId);
                return (
                    <SlTgModal
                        leg={leg}
                        symbol={activeSymbol}
                        draft={slTgDraft}
                        onDraftChange={setSlTgDraft}
                        onClose={closeSlTgModal}
                        onSave={() => saveSlTgModal(slTgEditId)}
                        footer="live"
                    />
                );
            })()}

            {/* Open Position SL / TG Modal */}
            {slModal && (() => {
                const isLong = slModal.side === "long" || slModal.side === "buy";
                const ref = slModal.ref;
                const err = bracketError(slModal.side, ref, slModal.sl, slModal.target);
                const hasExisting = toBracket(slModal.sl) != null || toBracket(slModal.target) != null;
                const round = (v) => String(Math.max(0.05, Math.round(v * 100) / 100));
                const slPicks = [10, 20, 30].map((pct) => ({ pct, v: round(ref * (isLong ? 1 - pct / 100 : 1 + pct / 100)) }));
                const tgtPicks = [25, 50, 100].map((pct) => ({ pct, v: round(isLong ? ref * (1 + pct / 100) : ref * Math.max(0.05, 1 - pct / 200)) }));

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4" onClick={() => setSlModal(null)}>
                        <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 shadow-2xl p-5 space-y-4 text-xs" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Stop Loss / Target</h3>
                                    <p className="text-gray-500 mt-0.5">
                                        <span className="font-bold text-gray-700 dark:text-gray-200">{slModal.label}</span> · current premium{" "}
                                        <span className="font-mono tabular-nums font-bold text-gray-900 dark:text-white">{formatActivePrice(ref)}</span>
                                    </p>
                                </div>
                                <button onClick={() => setSlModal(null)} className="text-gray-400 hover:text-gray-700 dark:hover:text-white cursor-pointer font-bold">✕</button>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-rose-500 font-bold uppercase text-[11px]">Stop Loss</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={slModal.sl}
                                    onChange={(e) => setSlModal((m) => ({ ...m, sl: e.target.value }))}
                                    placeholder="Not set"
                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#070e17] font-mono tabular-nums text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                                />
                                <div className="flex gap-1.5">
                                    {slPicks.map((p) => (
                                        <button key={p.pct} type="button" onClick={() => setSlModal((m) => ({ ...m, sl: p.v }))} className="px-2 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-[10px] font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                                            −{p.pct}%
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-emerald-600 font-bold uppercase text-[11px]">Target</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    value={slModal.target}
                                    onChange={(e) => setSlModal((m) => ({ ...m, target: e.target.value }))}
                                    placeholder="Not set"
                                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#070e17] font-mono tabular-nums text-sm text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                                />
                                <div className="flex gap-1.5">
                                    {tgtPicks.map((p) => (
                                        <button key={p.pct} type="button" onClick={() => setSlModal((m) => ({ ...m, target: p.v }))} className="px-2 py-0.5 rounded bg-gray-100 dark:bg-white/5 text-[10px] font-bold text-gray-600 dark:text-gray-300 cursor-pointer">
                                            +{p.pct}%
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-2">
                                {hasExisting ? (
                                    <button type="button" onClick={() => saveSlModal(true)} disabled={savingBracket} className="font-bold text-gray-500 hover:text-rose-600 cursor-pointer text-xs">
                                        Remove SL/Target
                                    </button>
                                ) : <span />}
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => setSlModal(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/10 text-gray-600 dark:text-gray-300 font-bold cursor-pointer">
                                        Cancel
                                    </button>
                                    <button type="button" onClick={() => saveSlModal()} disabled={!!err || savingBracket} className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer disabled:opacity-40">
                                        {savingBracket ? "Saving…" : "Save"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Refill Virtual Balance Modal */}
            {refillModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 shadow-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/10 pb-3">
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
                            <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono tabular-nums">
                                +₹5,00,000 Virtual Cash
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-300">
                                Continue practicing your options strategies without downtime.
                            </div>
                        </div>

                        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 px-1 font-semibold">
                            <span>Cost:</span>
                            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">₹100 Only</span>
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={() => setRefillModalOpen(false)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer"
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

            {/* Pro Membership Modal */}
            {proModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 shadow-2xl p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-100 dark:border-white/10 pb-3">
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
                            <div className="text-2xl font-bold text-gray-900 dark:text-white font-mono tabular-nums">
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
                        </ul>

                        <div className="flex items-center gap-3 pt-2">
                            <button
                                onClick={() => setProModalOpen(false)}
                                className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-white/10 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer"
                            >
                                Maybe Later
                            </button>
                            <button
                                onClick={handleBuyPro}
                                disabled={paymentLoading}
                                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white text-xs font-bold shadow-md shadow-amber-600/20 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                                {paymentLoading ? "Processing…" : "Subscribe for ₹499/mo"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
