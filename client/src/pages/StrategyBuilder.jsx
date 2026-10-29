import React from "react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useOptionChain, contractStaleness } from "../hooks/useOptionChain";
import { useSpanMargin, spanSourceLabel } from "../hooks/useSpanMargin";
import StaleBadge from "../components/strategy/StaleBadge";
import SlTgModal from "../components/strategy/SlTgModal";
import SquareOffAlertBanner from "../components/strategy/SquareOffAlertBanner";
import PortfolioGreeksTable from "../components/strategy/PortfolioGreeksTable";
import LotsInput, { MAX_LOTS } from "../components/strategy/LotsInput";
import { fetchOptionChain, fetchSymbolList } from "../services/optionChainApi";
import { formatPrice, formatPercent } from "../utils/format";
import {
    computePayoffCurve, computeBreakevens, computeMaxProfitLoss, computeRiskRewardRatio, computeNetGreeks,
    addMarkToMarketCurve, computeExpectedMove, computePOP, computeEstMargin, computeMarginDetails, evaluationExpiryOf, legMultiplier, otherAction,
} from "../utils/payoff";
import { yearsToExpiry, daysUntilExpiry, bsPrice } from "../utils/blackScholes";
import PayoffChart from "../components/PayoffChart";
import StrategyTradingViewChart from "../components/StrategyTradingViewChart";
import PresetStrategies from "../components/PresetStrategies";
import SaveButton from "../components/SaveButton";
import SavedStrategiesModal from "../components/SavedStrategiesModal";
import PaperExecuteModal from "../components/strategy/PaperExecuteModal";
import OiBar from "../components/OiBar";
import ContractChartModal from "../components/ContractChartModal";
import { SymbolLogo, getSymbolMeta } from "../utils/symbolIcons";
import { saveStrategy } from "../services/strategiesApi";
import { useTheme } from "../context/ThemeContext";
import { FiSettings, FiTrash2, FiRefreshCw, FiClock, FiTrendingUp, FiFolder, FiZap, FiGrid, FiBarChart2, FiDollarSign, FiEyeOff, FiEye } from "react-icons/fi";
import { Link } from "react-router-dom";


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

// Expiries now arrive as plain 'YYYY-MM-DD' (Angel One era, see CLAUDE.md
// Gotcha #12) — this is just a display formatter, parsed manually.
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatExpiryShort(sqlDate) {
    if (!sqlDate) return "";
    const [, m, d] = sqlDate.split("-").map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]}`;
}

function formatStockMojoDateTime(d) {
    if (!d) return "";
    const day = d.getDate();
    const month = MONTHS_SHORT[d.getMonth()];
    const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
    return `${day} ${month}, ${timeStr}`;
}

const DEFAULT_FAVORITES = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
const FAVORITES_KEY = "bazaarSync.strategyBuilder.favoriteSymbols";

function loadFavorites() {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_FAVORITES;
    } catch {
        return DEFAULT_FAVORITES;
    }
}

let legIdCounter = 0;

// Legs the user built survive symbol switches and leaving the page — stored
// per symbol in localStorage, same convention as Simulator.jsx's
// SIM_LEGS_KEY_PREFIX (and a shared prefix so a strategy built here can be
// replayed in Simulator's Historical view for the same symbol and back).
// Only the explicit "Reset Workspace" button clears a symbol's legs.
const SB_LEGS_KEY_PREFIX = "bazaarSync.strategyBuilder.legs.";

function loadSavedLegs(sym) {
    try {
        const raw = localStorage.getItem(SB_LEGS_KEY_PREFIX + sym);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(parsed)) return [];
        const maxId = parsed.reduce((m, l) => Math.max(m, l.id || 0), 0);
        if (maxId >= legIdCounter) legIdCounter = maxId + 1;
        return parsed;
    } catch {
        return [];
    }
}

function saveLegs(sym, legsToSave) {
    try {
        if (legsToSave.length) {
            localStorage.setItem(SB_LEGS_KEY_PREFIX + sym, JSON.stringify(legsToSave));
        } else {
            localStorage.removeItem(SB_LEGS_KEY_PREFIX + sym);
        }
    } catch {
        /* localStorage unavailable — legs just won't survive navigation this session */
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

function legFromRow(row, right, action, expiry, lotSize) {
    const side = right === "CE" ? row.ce : row.pe;
    return {
        id: ++legIdCounter,
        action, // 'buy' | 'sell'
        type: right, // 'CE' | 'PE'
        strike: row.strike,
        premium: side.ltp,
        qty: 1, // lots, not shares — see payoff.js's legMultiplier
        lotSize, // real per-lot share count at the moment this leg was built (see payoff.js)
        iv: side.iv,
        delta: side.delta,
        gamma: side.gamma,
        theta: side.theta,
        vega: side.vega,
        expiry, // which expiry this leg's premium/greeks came from — see payoff.js
        active: true, // unchecked in the Positions table = kept but excluded from payoff/metrics (see Simulator.jsx's identical convention)
    };
}

function Stat({ label, value, tone, hint }) {
    return (
        <div title={hint} className="border-b border-gray-100 dark:border-white/5 pb-2 last:border-0 last:pb-0">
            <div className="text-[12px] font-medium text-gray-400 dark:text-gray-400 uppercase tracking-wider">{label}</div>
            <div className={`text-sm font-bold tabular-nums mt-0.5 ${tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : tone === "negative" ? "text-rose-600 dark:text-rose-400" : "text-gray-800 dark:text-gray-100"}`}>
                {value}
            </div>
        </div>
    );
}

function OptionChainSkeleton({ columns }) {
    return (
        <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs overflow-hidden animate-pulse">
            <div className="p-2 border-b border-gray-100 dark:border-white/10 flex items-center justify-between bg-gray-50/50 dark:bg-[#070e17]/50">
                <div className="flex gap-1.5">
                    <div className="h-5 w-9 bg-gray-200 dark:bg-gray-800 rounded" />
                    <div className="h-5 w-9 bg-gray-200 dark:bg-gray-800 rounded" />
                    <div className="h-5 w-9 bg-gray-200 dark:bg-gray-800 rounded" />
                    <div className="h-5 w-9 bg-gray-200 dark:bg-gray-800 rounded" />
                </div>
                <div className="h-3.5 w-16 bg-gray-200 dark:bg-gray-800 rounded" />
            </div>
            <table className="w-full border-collapse text-[12px]">
                <thead className="bg-gray-50 dark:bg-[#070e17] border-b border-gray-200 dark:border-white/10">
                    <tr>
                        {columns.callDelta && <th className="px-1.5 py-2 text-center text-gray-400 w-[13%]">CallΔ</th>}
                        <th className="px-1.5 py-2 text-right text-gray-400 w-[15%]">LTP</th>
                        {columns.oi && <th className="px-1.5 py-2 text-right text-gray-400 w-[18%]">OI</th>}
                        <th className="py-2 text-center text-gray-700 dark:text-gray-200 bg-gray-100/80 dark:bg-[#09111c] w-[16%] border-x border-gray-200 dark:border-white/10">Strike</th>
                        {columns.oi && <th className="px-1.5 py-2 text-left text-gray-400 w-[18%]">OI</th>}
                        <th className="px-1.5 py-2 text-left text-gray-400 w-[18%]">LTP</th>
                        {columns.putDelta && <th className="px-1.5 py-2 text-center text-gray-400 w-[10%]">PutΔ</th>}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                    {Array.from({ length: 14 }).map((_, i) => {
                        const isAtm = i === 6 || i === 7;
                        return (
                            <tr key={i} className={isAtm ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""}>
                                {columns.callDelta && (
                                    <td className="px-1.5 py-2 text-center">
                                        <div className="h-3 w-7 bg-gray-200 dark:bg-gray-800 rounded mx-auto" />
                                    </td>
                                )}
                                <td className="px-1.5 py-2 text-right">
                                    <div className="h-3 w-10 bg-gray-200 dark:bg-gray-800 rounded ml-auto" />
                                </td>
                                {columns.oi && (
                                    <td className="px-1.5 py-2">
                                        <div className="h-2.5 bg-gray-200 dark:bg-gray-800 rounded ml-auto" style={{ width: `${30 + (i * 9) % 60}%` }} />
                                    </td>
                                )}
                                <td className="py-2 text-center border-x border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/80">
                                    <div className={`h-3.5 w-12 rounded mx-auto ${isAtm ? "bg-emerald-300 dark:bg-emerald-800/80" : "bg-gray-300 dark:bg-gray-700"}`} />
                                </td>
                                {columns.oi && (
                                    <td className="px-1.5 py-2">
                                        <div className="h-2.5 bg-gray-200 dark:bg-gray-800 rounded" style={{ width: `${35 + ((14 - i) * 8) % 55}%` }} />
                                    </td>
                                )}
                                <td className="px-1.5 py-2 text-left">
                                    <div className="h-3 w-10 bg-gray-200 dark:bg-gray-800 rounded" />
                                </td>
                                {columns.putDelta && (
                                    <td className="px-1.5 py-2 text-center">
                                        <div className="h-3 w-7 bg-gray-200 dark:bg-gray-800 rounded mx-auto" />
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// Option-chain column toggles — defaults match the table's original fixed
// layout (Call Delta / LTP / OI each side); everything else starts hidden.
// gamma/theta/vega/iv are already returned per-strike by the backend (see
// optionChainService.js), so every one of these toggles is frontend-only.
const DEFAULT_COLUMNS = {
    oi: true, lot: false, callDelta: true, putDelta: true, iv: false,
    theta: false, vega: false, gamma: false,
};

const STRIKE_RANGES = [
    { label: "±10", value: 10 },
    { label: "±20", value: 20 },
    { label: "±30", value: 30 },
    { label: "All", value: null },
];

export default function StrategyBuilder() {
    const { symbol, setSymbol, data, loading, error, load, marketStatus, isLive, dataLoadedAt, staleNow } = useOptionChain();

    // Passed to contractStaleness for every chain row — recomputed only when
    // one of these changes (staleNow ticks every 5s while live).
    const staleOpts = useMemo(
        () => ({
            isLive,
            marketOpen: marketStatus.isOpen,
            feedConnected: marketStatus.feedConnected,
            dataLoadedAt,
            now: staleNow,
        }),
        [isLive, marketStatus.isOpen, marketStatus.feedConnected, dataLoadedAt, staleNow],
    );

    const [legs, setLegs] = useState(() => loadSavedLegs("NIFTY")); // useOptionChain defaults to NIFTY
    // Persist legs per symbol on every change (see SB_LEGS_KEY_PREFIX).
    useEffect(() => {
        saveLegs(symbol, legs);
    }, [symbol, legs]);
    const [tab, setTab] = useState("positions"); // 'positions' | 'greeks'
    const [chartTab, setChartTab] = useState("payoff"); // 'payoff' | 'strategy' | 'nifty' | 'combined'
    const [rewardRiskOrder, setRewardRiskOrder] = useState(false); // false = Risk : Reward, true = Reward : Risk
    // "Payoff setting" what-if simulator — lets you drag Underlying/Date-Time/
    // IV without waiting for the real market to move. Percent/day/point OFFSETS
    // from today's real values (0 = no change), not absolute inputs, so the
    // sliders always start centered on "now" regardless of symbol/expiry.
    const [payoffSettingsOpen, setPayoffSettingsOpen] = useState(false);
    const [whatIfSpotPct, setWhatIfSpotPct] = useState(0); // -10..+10 (%)
    const [whatIfDaysForward, setWhatIfDaysForward] = useState(0); // 0..days-to-expiry
    const [whatIfIvShift, setWhatIfIvShift] = useState(0); // -20..+20 (percentage points)

    const [currentTime, setCurrentTime] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [atmBasis, setAtmBasis] = useState("spot"); // 'spot' | 'future' | 'synth'
    const [showAtmDistance, setShowAtmDistance] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [expiryDropdownOpen, setExpiryDropdownOpen] = useState(false);
    const [savedOpen, setSavedOpen] = useState(false);
    const [paperExecuteOpen, setPaperExecuteOpen] = useState(false);
    const [hideChain, setHideChain] = useState(false);
    const [mobileView, setMobileView] = useState("all"); // 'all' | 'chain' | 'payoff' | 'positions' | 'presets'
    const [strikeAsc, setStrikeAsc] = useState(true);
    const [strikesAroundAtm, setStrikesAroundAtm] = useState(20);
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

    const atmRowRef = useRef(null);
    const chainScrollRef = useRef(null);

    function toggleColumn(key) {
        setColumns((prev) => ({ ...prev, [key]: !prev[key] }));
    }
    function resetChainSettings() {
        setColumns(DEFAULT_COLUMNS);
        setAtmBasis("spot");
        setShowAtmDistance(false);
    }

    // Every symbol with real data (indices + F&O stocks Bhavcopy/Breeze
    // backfilled) — same endpoint Simulator.jsx and the Option Chain page's
    // Select Asset dropdown use. Falls back to the 3 original indices if
    // this fails, so symbol switching still works even if the list
    // endpoint is down.
    const [symbolList, setSymbolList] = useState({ indices: DEFAULT_FAVORITES, stocks: [] });
    const [favorites, setFavorites] = useState(loadFavorites);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");

    useEffect(() => {
        fetchSymbolList()
            .then((res) => setSymbolList({ indices: res.indices?.length ? res.indices : DEFAULT_FAVORITES, stocks: res.stocks || [] }))
            .catch(() => { /* keep the fallback list */ });
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        } catch {
            /* localStorage unavailable (private mode, etc) — favorites just won't persist */
        }
    }, [favorites]);

    const filteredIndices = useMemo(
        () => symbolList.indices.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );
    const filteredStocks = useMemo(
        () => symbolList.stocks.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );

    // Chevrons cycle through favorites only (not the full symbol universe);
    // the pill itself opens the full searchable dropdown to jump anywhere.
    function cycleSymbol(dir) {
        if (favorites.length < 2) return;
        const idx = favorites.indexOf(symbol);
        const base = idx >= 0 ? idx : 0;
        const next = favorites[(base + dir + favorites.length) % favorites.length];
        setSymbol(next);
        setLegs(loadSavedLegs(next)); // restore that symbol's saved legs, not a blank slate
    }

    function pickSymbol(sym) {
        setSymbol(sym);
        setLegs(loadSavedLegs(sym));
        setPickerOpen(false);
        setPickerQuery("");
    }

    function toggleFavorite(sym) {
        setFavorites((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
    }

    function addLeg(row, right, action) {
        setLegs((prev) => {
            if (prev.length >= 6) return prev;
            return [...prev, legFromRow(row, right, action, data?.selectedExpiry, data?.lotSize)];
        });
        setChartTab("payoff");
        setTab("positions");
        if (mobileView === "presets" || mobileView === "chain") {
            setMobileView("payoff");
        }
    }

    // Fetches a DIFFERENT expiry's chain than the one currently displayed —
    // needed for calendar-spread presets, whose far leg comes from a later
    // expiry. Doesn't touch `data`/the visible chain table; returns rows only.
    function fetchExpiryRows(expiry) {
        return fetchOptionChain(symbol, expiry).then((res) => res.rows || []);
    }

    function removeLeg(id) {
        setLegs((prev) => prev.filter((l) => l.id !== id));
    }

    // Flips a leg's side in place (Buy <-> Sell) — the Positions table's B/S
    // chip and the chain row's hover B/S buttons both add legs, but only the
    // Positions table chip flips an EXISTING leg without deleting/re-adding
    // it. SL/TG (if set) are left untouched on flip — they're a % threshold
    // on premium, not something that needs to reset/invert with the side.
    function toggleLegSide(id) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, action: otherAction(l.action) } : l)));
    }

    function updateQty(id, qty) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_LOTS, Math.max(1, Math.floor(qty) || 1)) } : l)));
    }

    // Chain-row inline position display: which leg (if any) matches this
    // exact strike/right in the CURRENTLY DISPLAYED expiry, plus the signed
    // net lots across every leg at that strike/right (buy=+qty, sell=-qty) —
    // matches the reference screenshot's small "-1"/"+2" badge on the chain
    // row itself, not just the bottom Positions table.
    function legsAt(strike, right) {
        return legs.filter((l) => l.strike === strike && l.type === right && l.expiry === data?.selectedExpiry);
    }
    function netPositionAt(strike, right) {
        const matches = legsAt(strike, right);
        if (!matches.length) return 0;
        return matches.reduce((sum, l) => sum + (l.action === "buy" ? l.qty : -l.qty), 0);
    }

    // Mini contract-chart popup, opened from the small chart icon on hover —
    // reuses ContractChartModal.jsx (already built for the live Option Chain
    // page), reading from the same option_chain_history-backed endpoint.
    const [chartModal, setChartModal] = useState(null); // { strike, right } | null

    function updateLeg(id, patch) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    }

    function resetLegs() {
        setLegs([]);
    }

    // --- Positions table: active/include-in-calc, bulk lots, expiry/strike rolling, SL/TG ---
    const [legsTopFirst, setLegsTopFirst] = useState(true);
    const [slTgEditId, setSlTgEditId] = useState(null);
    const [slTgDraft, setSlTgDraft] = useState({ sl: "", tg: "" });
    // Live SL/TG watch — when a leg's live P&L crosses ±its threshold (% of
    // that leg's own entry notional) a square-off alert appears. Nothing is
    // closed automatically (no live auto-exit engine exists) — this only
    // surfaces the crossing. Ref-keyed by leg id + thresholds so editing an
    // SL/TG re-arms it, and it fires once per crossing, not every tick.
    const [squareOffAlert, setSquareOffAlert] = useState(null);
    const alertedLegsRef = useRef(new Set());

    const orderedLegs = useMemo(() => (legsTopFirst ? legs : [...legs].reverse()), [legs, legsTopFirst]);

    // Positions table checkbox — doesn't delete the leg, just excludes it
    // from the payoff curve / Greeks / POP / max-profit-loss calculation
    // below (see the activeLegs filter), same "what-if" toggle Simulator.jsx
    // already has (this page's checkbox used to be purely cosmetic — fixed).
    function toggleLegActive(id) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, active: !l.active } : l)));
    }
    const allLegsActive = legs.length > 0 && legs.every((l) => l.active !== false);
    function toggleSelectAllLegs() {
        const shouldInclude = !allLegsActive;
        setLegs((prev) => prev.map((l) => ({ ...l, active: shouldInclude })));
    }

    // Scales EVERY leg's lot count by the same delta at once (min 1) —
    // "lots multiplier stepper (+/-) that scales every leg at once".
    function bulkAdjustLots(delta) {
        setLegs((prev) => prev.map((l) => ({ ...l, qty: Math.min(MAX_LOTS, Math.max(1, l.qty + delta)) })));
    }
    // Typed multiplier: sets every leg to the same lot count.
    function setAllLots(n) {
        setLegs((prev) => prev.map((l) => ({ ...l, qty: n })));
    }
    const commonLots = legs.length && legs.every((l) => l.qty === legs[0].qty) ? legs[0].qty : null;
    const totalLots = legs.reduce((sum, l) => sum + l.qty, 0);

    // Looks up the rows for whichever expiry a leg actually belongs to —
    // reuses the already-loaded chain if it's the same expiry being viewed,
    // otherwise fetches that expiry's chain on demand (same pattern as the
    // calendar-spread presets' fetchExpiryRows).
    async function rowsForExpiry(expiry) {
        if (data && expiry === data.selectedExpiry) return data.rows || [];
        return fetchExpiryRows(expiry);
    }

    // "Roll" a leg to a different expiry OR strike: re-stamps its entry
    // premium/greeks from the real chain at the new expiry/strike — this is
    // "rebuild this leg as if I'd picked it there", not a realized trade
    // (no fill/slippage ledger exists in this workspace), consistent with
    // how every other leg here is built from a live chain snapshot.
    async function rollLegExpiry(id, newExpiry) {
        const leg = legs.find((l) => l.id === id);
        if (!leg || newExpiry === leg.expiry) return;
        const rows = await rowsForExpiry(newExpiry);
        const row = rows.find((r) => r.strike === leg.strike);
        const side = row && (leg.type === "CE" ? row.ce : row.pe);
        if (!side || side.ltp == null) return; // strike doesn't trade at that expiry — leave leg unchanged
        updateLeg(id, { expiry: newExpiry, premium: side.ltp, iv: side.iv, delta: side.delta, gamma: side.gamma, theta: side.theta, vega: side.vega });
    }

    async function rollLegStrike(id, direction) {
        const leg = legs.find((l) => l.id === id);
        if (!leg) return;
        const rows = await rowsForExpiry(leg.expiry);
        if (!rows.length) return;
        const sorted = [...rows].sort((a, b) => a.strike - b.strike);
        const idx = sorted.findIndex((r) => r.strike === leg.strike);
        const nextRow = sorted[idx + direction];
        const side = nextRow && (leg.type === "CE" ? nextRow.ce : nextRow.pe);
        if (!side || side.ltp == null) return; // no adjacent strike in that direction
        updateLeg(id, { strike: nextRow.strike, premium: side.ltp, iv: side.iv, delta: side.delta, gamma: side.gamma, theta: side.theta, vega: side.vega });
    }

    // Re-bases the entry price to the current LTP (zeroes out this leg's
    // live P&L going forward) — the Exit column's "refresh" icon.
    function resetLegEntryToLtp(id) {
        const leg = legs.find((l) => l.id === id);
        const row = leg && rowByStrike.get(leg.strike);
        const currentLtp = row ? (leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp) : null;
        if (currentLtp == null) return;
        updateLeg(id, { premium: currentLtp });
    }

    // SL/TG are stored per leg as a % of that leg's own entry notional and
    // watched live (see the square-off effect below) — a crossing raises an
    // alert; nothing is auto-closed (no live auto-exit engine). Simulator
    // applies the same per-leg thresholds during its Run Simulation replay.
    function setLegSlTg(id, slPercent, tgPercent) {
        updateLeg(id, {
            slPercent: slPercent === "" ? null : Number(slPercent),
            tgPercent: tgPercent === "" ? null : Number(tgPercent),
        });
    }

    function openSlTgModal(leg) {
        setSlTgDraft({ sl: leg.slPercent ?? "", tg: leg.tgPercent ?? "" });
        setSlTgEditId(leg.id);
    }
    function closeSlTgModal() {
        setSlTgEditId(null);
    }
    function saveSlTgModal(legId) {
        setLegSlTg(legId, slTgDraft.sl, slTgDraft.tg);
        setSlTgEditId(null);
    }

    function applyPreset(presetLegs) {
        setLegs(presetLegs.map((l) => ({ active: true, ...l, id: ++legIdCounter })));
        setTab("positions");
        setChartTab("payoff");
        if (mobileView === "presets" || mobileView === "chain") {
            setMobileView("payoff");
        }
    }

    const rowByStrike = useMemo(() => {
        const map = new Map();
        (data?.rows || []).forEach((r) => map.set(r.strike, r));
        return map;
    }, [data]);

    const strikeGap = useMemo(() => {
        if (!data?.rows || data.rows.length < 2) return 50;
        return Math.abs(data.rows[1].strike - data.rows[0].strike) || 50;
    }, [data]);

    // "ATM Based On" — which reference price decides which single strike is
    // flagged ATM. ITM/OTM tinting still uses raw spot (moneyness doesn't
    // change), only the ATM highlight/Go-to-ATM target moves.
    const effectiveAtmPrice = useMemo(() => {
        if (!data) return null;
        if (atmBasis === "future") return data.futurePrice ?? data.spotPrice;
        if (atmBasis === "synth") {
            const atmRow = data.rows?.find((r) => r.strike === data.atmStrike);
            const synth = atmRow && atmRow.ce?.ltp != null && atmRow.pe?.ltp != null
                ? data.atmStrike + atmRow.ce.ltp - atmRow.pe.ltp
                : null;
            return synth ?? data.spotPrice;
        }
        return data.spotPrice;
    }, [atmBasis, data]);

    const effectiveAtmStrike = useMemo(() => {
        if (!data?.rows?.length || effectiveAtmPrice == null) return data?.atmStrike ?? null;
        return data.rows.reduce(
            (best, r) => (Math.abs(r.strike - effectiveAtmPrice) < Math.abs(best.strike - effectiveAtmPrice) ? r : best)
        ).strike;
    }, [data, effectiveAtmPrice]);

    // Rows in display order — filtered to ±strikesAroundAtm around effectiveAtmStrike
    const displayChainRows = useMemo(() => {
        if (!data?.rows?.length) return [];
        const baseRows = strikeAsc ? data.rows : [...data.rows].reverse();
        if (strikesAroundAtm == null || effectiveAtmStrike == null) return baseRows;
        const atmIdx = baseRows.findIndex((r) => r.strike === effectiveAtmStrike);
        if (atmIdx === -1) return baseRows;
        return baseRows.slice(Math.max(0, atmIdx - strikesAroundAtm), atmIdx + strikesAroundAtm + 1);
    }, [data, strikeAsc, strikesAroundAtm, effectiveAtmStrike]);

    const { first3Expiries, remainingExpiries } = useMemo(() => {
        const list = data?.expiries || [];
        return {
            first3Expiries: list.slice(0, 3),
            remainingExpiries: list.slice(3),
        };
    }, [data?.expiries]);

    // Scrolls only the chain table's own container, never the page — native
    // scrollIntoView({block:"center"}) walks up every scrollable ancestor
    // including the window, so on a tall page it was also yanking the whole
    // page down (hiding the top navbar) whenever the ATM row wasn't already
    // within the window's viewport, not just within the table.
    function scrollToAtm(behavior = "smooth") {
        const row = atmRowRef.current;
        const container = chainScrollRef.current;
        if (!row || !container) return;
        const target = row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2;
        container.scrollTo({ top: Math.max(0, target), behavior });
    }

    // Auto-center the chain on the SPOT/ATM row whenever a fresh chain loads
    // (symbol switch, expiry switch, or the very first load) — previously
    // this only happened if the user manually clicked the Strike column's
    // "go to ATM" arrow, so the table opened scrolled to the top (lowest
    // strike) instead of the price range a trader actually cares about.
    // "instant" (not "smooth") on auto-trigger so switching symbols/expiries
    // doesn't visibly animate-scroll every time — only the manual button
    // click below still smooth-scrolls.
    useEffect(() => {
        if (!data?.rows?.length) return;
        const raf = requestAnimationFrame(() => scrollToAtm("instant"));
        return () => cancelAnimationFrame(raf);
    }, [data?.selectedExpiry, symbol, data?.rows?.length]);

    const enabledColumnCount = Object.values(columns).filter(Boolean).length;
    const totalColumnCount = Object.keys(columns).length;

    const { maxCeOi, maxPeOi } = useMemo(() => {
        if (!data || !data.rows) return { maxCeOi: 0, maxPeOi: 0 };
        return data.rows.reduce(
            (acc, r) => ({
                maxCeOi: Math.max(acc.maxCeOi, r.ce?.oi || 0),
                maxPeOi: Math.max(acc.maxPeOi, r.pe?.oi || 0),
            }),
            { maxCeOi: 0, maxPeOi: 0 }
        );
    }, [data]);

    // ltpOverride (manually typed into the Positions table's LTP input,
    // see updateLeg below) takes priority over the live-chain value — every
    // P&L number for that leg re-derives from whatever's actually shown in
    // the LTP column, not silently from the real feed underneath it.
    const legLivePnl = useCallback((leg) => {
        const row = rowByStrike.get(leg.strike);
        const liveLtp = row ? (leg.type === "CE" ? row.ce.ltp : row.pe.ltp) : null;
        const currentLtp = leg.ltpOverride ?? liveLtp;
        if (currentLtp == null) return null;
        const diff = leg.action === "buy" ? currentLtp - leg.premium : leg.premium - currentLtp;
        return diff * legMultiplier(leg);
    }, [rowByStrike]);

    // Combined live P&L across all legs, for the Strategy Chart tab's
    // session trend line — null until every leg's current LTP is known.
    const totalLivePnl = useMemo(() => {
        if (!legs.length) return null;
        let sum = 0;
        for (const leg of legs) {
            const v = legLivePnl(leg);
            if (v == null) return null;
            sum += v;
        }
        return sum;
    }, [legs, legLivePnl]);

    // Legs the Positions table checkbox has left checked — the payoff curve,
    // Greeks, POP, and max-profit/loss below are recalculated from only
    // these, so unchecking a leg removes it from every metric without
    // deleting the row (see toggleLegActive). Live P&L per row/total stays
    // based on ALL legs, same convention as Simulator.jsx.
    const activeLegs = useMemo(() => legs.filter((l) => l.active !== false), [legs]);

    // Exchange margin from NSE's SPAN file (server-side). While a quote is pending or SPAN
    // can't price the legs, the payoff.js estimate below is shown instead, labelled "Estimate".
    const spanLegs = useMemo(
        () => activeLegs.map((l) => ({
            expiry: l.expiry || data?.selectedExpiry,
            strike: l.strike,
            type: l.type,
            action: l.action,
            lots: l.qty || 1,
            lotSize: l.lotSize || data?.lotSize,
        })),
        [activeLegs, data?.selectedExpiry, data?.lotSize]
    );
    const span = useSpanMargin(symbol, data?.spotPrice, spanLegs);
    const spanMarginByLegId = useMemo(() => {
        if (!span?.perLeg) return null;
        const m = new Map();
        activeLegs.forEach((l, i) => m.set(l.id, span.perLeg[i]));
        return m;
    }, [span, activeLegs]);

    // Live SL/TG watch — on every chain update, check each leg's live P&L
    // against ±(threshold% × its own entry notional). First crossing per
    // (leg, thresholds) raises the square-off alert once. The alert setState
    // is deferred to a microtask so it never cascades a render inside this
    // effect's commit.
    useEffect(() => {
        const live = new Set();
        let breach = null;
        for (const leg of legs) {
            if (leg.slPercent == null && leg.tgPercent == null) continue;
            const key = `${leg.id}:${leg.slPercent ?? ""}:${leg.tgPercent ?? ""}`;
            live.add(key);
            if (alertedLegsRef.current.has(key)) continue;
            const pnl = legLivePnl(leg);
            if (pnl == null) continue;
            const notional = Math.abs(leg.premium * legMultiplier(leg));
            const slHit = leg.slPercent != null && pnl <= -(leg.slPercent / 100) * notional;
            const tgHit = leg.tgPercent != null && pnl >= (leg.tgPercent / 100) * notional;
            if (slHit || tgHit) {
                alertedLegsRef.current.add(key);
                breach = { reason: tgHit ? "target" : "stop_loss", action: leg.action, strike: leg.strike, type: leg.type };
            }
        }
        if (breach) queueMicrotask(() => setSquareOffAlert(breach));
        // Forget keys for legs/thresholds that no longer exist so re-adding
        // an identical leg can re-arm.
        for (const key of [...alertedLegsRef.current]) {
            if (!live.has(key)) alertedLegsRef.current.delete(key);
        }
        // legLivePnl is a render-fresh closure over rowByStrike (already a dep);
        // listing it would re-run this every render for no benefit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [legs, rowByStrike]);

    const { curve, breakevens, maxProfit, maxLoss, netGreeks, pop, expectedMove, estMargin, fundsRequired, marginBenefit, isHedged, riskReward, yearsRemaining } = useMemo(() => {
        if (!activeLegs.length || !data || !data.spotPrice) {
            return { curve: [], breakevens: [], maxProfit: null, maxLoss: null, netGreeks: null, pop: null, expectedMove: null, estMargin: null, fundsRequired: null, marginBenefit: 0, isHedged: false, riskReward: null, yearsRemaining: 0 };
        }

        try {
            const allStrikes = activeLegs.map((l) => l.strike).filter(Boolean);
            const minStrike = allStrikes.length ? Math.min(...allStrikes) : data.spotPrice;
            const maxStrike = allStrikes.length ? Math.max(...allStrikes) : data.spotPrice;
            const minPrice = Math.min(data.spotPrice * 0.90, minStrike * 0.95);
            const maxPrice = Math.max(data.spotPrice * 1.10, maxStrike * 1.05);

            let curveData = computePayoffCurve(activeLegs, { minPrice, maxPrice, steps: 150 }) || [];
            const breakEvs = computeBreakevens(curveData) || [];
            const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(activeLegs, curveData);
            const rReward = computeRiskRewardRatio(mxProf, mxLoss);
            const netGrks = computeNetGreeks(activeLegs);

            // For a single-expiry strategy this is just data.selectedExpiry; for
            // a calendar spread it's the near leg's expiry — the meaningful
            // horizon for "at expiry" (see payoff.js's evaluationExpiryOf).
            const evaluationExpiry = evaluationExpiryOf(activeLegs) || data.selectedExpiry;
            const yearsRem = yearsToExpiry(evaluationExpiry);
            const atmRow = data.rows ? data.rows.find((r) => r.strike === data.atmStrike) : null;
            const atmIv = atmRow?.iv ?? null;
            const evalTimestamp = dataLoadedAt || staleNow || null;
            curveData = (atmIv && typeof addMarkToMarketCurve === "function") ? addMarkToMarketCurve(curveData, activeLegs, yearsRem, evalTimestamp) : curveData;
            const expMv = (atmIv && typeof computeExpectedMove === "function") ? computeExpectedMove(data.spotPrice, atmIv, yearsRem) : null;
            const popVal = (atmIv && typeof computePOP === "function") ? computePOP(curveData, data.spotPrice, atmIv, yearsRem) : null;
            const marginDetails = computeMarginDetails(activeLegs, data.spotPrice, symbol);
            if (span) {
                const debit = Math.max(0, -(marginDetails.netPremium || 0));
                marginDetails.estMargin = span.margin;
                marginDetails.fundsRequired = Math.round((span.margin + debit) * 100) / 100;
                marginDetails.marginBenefit = Math.max(0, Math.round((span.standaloneMargin - span.margin) * 100) / 100);
            }

            return {
                curve: curveData,
                breakevens: breakEvs,
                maxProfit: mxProf,
                maxLoss: mxLoss,
                netGreeks: netGrks,
                pop: popVal,
                expectedMove: expMv,
                estMargin: marginDetails.estMargin,
                fundsRequired: marginDetails.fundsRequired,
                marginBenefit: marginDetails.marginBenefit,
                isHedged: marginDetails.isHedged,
                riskReward: rReward,
                yearsRemaining: yearsRem,
            };
        } catch (err) {
            console.error(err);
            return { curve: [], breakevens: [], maxProfit: null, maxLoss: null, netGreeks: null, pop: null, expectedMove: null, estMargin: null, fundsRequired: null, marginBenefit: 0, isHedged: false, riskReward: null, yearsRemaining: 0 };
        }
    }, [activeLegs, data, symbol, dataLoadedAt, span]);

    // "Payoff setting" what-if readout — reprices every leg via Black-Scholes
    // at the simulated spot/date/IV instead of the real ones, using each
    // leg's entry IV + the slider's shift as the stand-in volatility (same
    // approximation class as the "Today" curve above). Legs missing an IV
    // snapshot fall back to intrinsic value (no time value) rather than being
    // silently dropped from the total.
    const whatIfResult = useMemo(() => {
        if (!payoffSettingsOpen || !legs.length || !data?.spotPrice) return null;
        const evaluationExpiry = evaluationExpiryOf(legs) || data.selectedExpiry;
        const simSpot = data.spotPrice * (1 + whatIfSpotPct / 100);
        const baseMs = dataLoadedAt || staleNow || 0;
        const simMs = baseMs + whatIfDaysForward * 24 * 60 * 60 * 1000;

        let pnl = 0;
        for (const leg of legs) {
            const t = Math.max(
                yearsToExpiry(leg.expiry || evaluationExpiry, simMs),
                1 / (365 * 24 * 4) // floor at 15 minutes, matches blackScholes.js's own convention
            );
            let theoPrice;
            if (leg.iv != null) {
                const vol = Math.max(0.01, (leg.iv + whatIfIvShift) / 100);
                theoPrice = bsPrice({ spot: simSpot, strike: leg.strike, t, vol, right: leg.type });
            } else {
                theoPrice = Math.max(0, leg.type === "CE" ? simSpot - leg.strike : leg.strike - simSpot);
            }
            // qty * lotSize (legMultiplier), never qty alone — every other
            // P&L number on this page already does; this what-if readout was
            // the last spot still missing the lot-size multiplier (so it was
            // understating P&L ~50-75x for index options).
            pnl += (leg.action === "buy" ? theoPrice - leg.premium : leg.premium - theoPrice) * legMultiplier(leg);
        }
        return { simSpot, pnl };
    }, [payoffSettingsOpen, legs, data, whatIfSpotPct, whatIfDaysForward, whatIfIvShift, dataLoadedAt, staleNow]);

    const daysToExpiry = data?.selectedExpiry ? Math.max(1, daysUntilExpiry(data.selectedExpiry)) : 30;

    return (
        <div
            ref={containerRef}
            className={`w-full max-w-[1920px] mx-auto px-2 sm:px-3 lg:px-4 pt-1.5 pb-3 text-gray-900 dark:text-gray-100 transition-colors flex-1 flex flex-col overflow-x-hidden ${
                isFullscreen
                    ? "fixed inset-0 z-50 bg-[#f8fafc] dark:bg-[#070a11] overflow-y-auto p-2 sm:p-3"
                    : "bg-gray-50/40 dark:bg-[#070a11] min-h-screen"
            }`}
        >
            {/* Minimal & Compact Top Control Bar — a 3-column grid on sm+ so
                Save/Saved/Reset sit centered between the symbol picker and
                the clock (stockmojo layout), independent of how wide either
                side is; stacks to plain full-width rows on mobile. */}
            <div className="mb-2 flex flex-col sm:grid sm:grid-cols-[1fr_auto_1fr] items-stretch sm:items-center gap-1.5 sm:gap-2">
                {/* Left: Symbol Picker + Expiry */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 justify-self-start">
                    {/* Unified Symbol Pill Container (StockMojo style) */}
                    <div className="flex items-center h-8 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#0b1420] px-1.5 shadow-xs relative">
                        <span className="w-5 h-5 rounded-full bg-[#182230] text-white flex items-center justify-center text-[10px] font-bold mr-1.5 shadow-xs shrink-0">
                            {data?.lotSize || 50}
                        </span>
                        <button
                            onClick={() => setPickerOpen((v) => !v)}
                            className="font-bold text-xs text-gray-900 dark:text-white flex items-center gap-1 cursor-pointer pr-1 transition hover:text-blue-600"
                        >
                            <span>{symbol}</span>
                            <span className="text-[9px] text-gray-400">▾</span>
                        </button>
                        <div className="flex items-center border-l border-gray-200 dark:border-white/10 ml-0.5 pl-0.5">
                            <button
                                onClick={() => cycleSymbol(-1)}
                                disabled={favorites.length < 2}
                                className="h-6 w-4 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 transition text-xs font-bold cursor-pointer"
                                aria-label="Previous favorite symbol"
                            >
                                ‹
                            </button>
                            <button
                                onClick={() => cycleSymbol(1)}
                                disabled={favorites.length < 2}
                                className="h-6 w-4 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-20 transition text-xs font-bold cursor-pointer"
                                aria-label="Next favorite symbol"
                            >
                                ›
                            </button>
                        </div>

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
                                                <SymbolOption key={s} sym={s} active={s === symbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                                            ))}
                                        </div>
                                    )}
                                    {filteredStocks.length > 0 && (
                                        <div>
                                            <div className="px-2 pt-2 pb-1 text-[11px] font-bold uppercase text-gray-400">Stocks</div>
                                            {filteredStocks.map((s) => (
                                                <SymbolOption key={s} sym={s} active={s === symbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                                            ))}
                                        </div>
                                    )}
                                    {!filteredIndices.length && !filteredStocks.length && (
                                        <div className="px-3 py-6 text-center text-gray-400">No matches</div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    {/* Expiry Selector Dropdown */}
                    {data?.expiries && data.expiries.length > 0 && (
                        <select
                            value={data.selectedExpiry || ""}
                            onChange={(e) => load(symbol, e.target.value)}
                            className="h-8 rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2.5 text-xs font-bold text-gray-900 dark:text-white shadow-xs outline-none hover:border-[#1677ff] focus:border-[#1677ff] transition cursor-pointer"
                            aria-label="Select expiry"
                        >
                            {data.expiries.map((exp) => (
                                <option key={exp} value={exp} className="bg-white dark:bg-[#0b1420] text-gray-900 dark:text-white">
                                    {formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)
                                </option>
                            ))}
                        </select>
                    )}

                </div>

                {/* Center: Save + Saved (kept together as one tight group) + Reset/New — stockmojo centers this trio between the symbol picker and the clock */}
                <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 justify-self-center">
                    <div className="flex items-center gap-1">
                        {/* Save Button (StockMojo Green Pill) */}
                        <SaveButton
                            itemLabel="strategy"
                            onSave={(token, name) => saveStrategy(token, { name, underlying: symbol, legs })}
                            className="h-8 px-3 text-xs bg-[#00b96b] hover:bg-[#00a860] font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
                        />

                        {/* Saved Button (White pill with folder) */}
                        <button
                            onClick={() => setSavedOpen(true)}
                            className="flex items-center h-8 px-3 text-xs gap-1.5 whitespace-nowrap transition-colors bg-white dark:bg-[#0b1420] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 border border-gray-300 dark:border-white/10 font-bold rounded-lg shadow-xs cursor-pointer"
                        >
                            <FiFolder size={13} className="text-gray-400" />
                            <span>Saved</span>
                        </button>
                    </div>

                    {/* Reset/New Button (Light Red Pill) */}
                    <button
                        onClick={resetLegs}
                        className="flex items-center h-8 px-3 text-xs bg-[#fff1f0] text-[#ff4d4f] dark:bg-rose-950/30 dark:text-rose-400 hover:bg-[#ffe8e6] dark:hover:bg-rose-950/50 border border-[#ffccc7] dark:border-rose-900/50 rounded-lg gap-1.5 shrink-0 whitespace-nowrap transition-colors font-bold shadow-xs cursor-pointer"
                        title="Reset all positions and return to ready-made strategies"
                    >
                        <FiTrash2 size={12} />
                        <span>Reset/New{legs.length > 0 ? ` (${legs.length})` : ""}</span>
                    </button>
                </div>

                {/* Right: Clock, feed status & Full Screen (SPOT / VIX / FUT live in the chain panel) */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 justify-end sm:justify-self-end">
                    <div className="flex items-center gap-1.5 h-8 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200 shadow-xs">
                        <FiClock className="text-gray-400" size={13} />
                        <span className="tabular-nums font-mono text-[11.5px]">
                            {formatStockMojoDateTime(currentTime)}
                        </span>
                    </div>

                    {(
                        isLive && marketStatus?.isOpen ? (
                            <span className="flex items-center gap-1 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 px-2.5 text-[10.5px] font-extrabold text-emerald-700 dark:text-emerald-300">
                                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                LIVE
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 h-8 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-2 text-[10.5px] font-semibold text-gray-600 dark:text-gray-400">
                                <span>◈</span>
                                <span>SNAPSHOT</span>
                            </span>
                        )
                    )}

                    {/* Full Screen button removed — stockmojo.in's action row doesn't have one. */}
                </div>
            </div>

            {(
            <div>
                {/* Mobile View Segmented Controller (< lg) */}
                <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-none">
                    {[
                        ["all", "All View"],
                        ["chain", "⛓ Option Chain"],
                        ["payoff", "📈 Payoff & Stats"],
                        ["positions", `📋 Positions (${legs.length})`],
                        ["presets", "⚡ Ready-Made"],
                    ].map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => {
                                setMobileView(key);
                                if (key === "presets") setTab("presets");
                                if (key === "positions") setTab("positions");
                                if (key === "payoff") setChartTab("payoff");
                            }}
                            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                mobileView === key
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <div className="flex flex-col lg:flex-row gap-4 items-start">
                {/* Left Column: Option Chain Window */}
                {!hideChain && (
                <div className={`w-full lg:w-[480px] xl:w-[540px] shrink-0 flex flex-col ${mobileView !== "all" && mobileView !== "chain" ? "hidden lg:flex" : ""}`}>
                    {/* Compact Option Chain Control Bar (StockMojo style) — no
                        overflow-hidden here: it was clipping the Settings and
                        expiry "More ▾" popovers below (they're absolutely
                        positioned inside this box), so clicking them appeared
                        to do nothing. Rounded corners instead come from the
                        border-radius on this div plus rounded-b-xl on the
                        last row below. */}
                    <div className="mb-2 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-xs flex flex-col">
                        {/* Row 1: SPOT / VIX / FUT + Hide Chain */}
                        <div className="flex items-center justify-between gap-2 rounded-t-xl px-3 py-2 border-b border-gray-100 dark:border-white/5 text-xs">
                            {data ? (
                                <div className="flex flex-wrap items-center gap-x-2.5 sm:gap-x-3 gap-y-1">
                                    <div>
                                        <span className="text-gray-400 font-semibold text-[11px]">SPOT: </span>
                                        <span className="font-mono font-bold text-gray-900 dark:text-white tabular-nums">{formatPrice(data.spotPrice)}</span>
                                    </div>
                                    <div className="h-3 w-px bg-gray-200 dark:bg-white/10" />
                                    <div>
                                        <span className="text-gray-400 font-semibold text-[11px]">VIX: </span>
                                        <span className="font-mono font-bold text-gray-900 dark:text-white tabular-nums">
                                            {data.vix != null ? Number(data.vix).toFixed(2) : "—"}
                                        </span>
                                    </div>
                                    {data.futurePrice != null && (
                                        <>
                                            <div className="h-3 w-px bg-gray-200 dark:bg-white/10" />
                                            <div className="flex items-center gap-1">
                                                <span className="text-gray-400 font-semibold text-[11px]">FUT ({data.selectedExpiry ? formatExpiryShort(data.selectedExpiry) : ""}) </span>
                                                <span className="font-mono font-bold text-gray-900 dark:text-white tabular-nums">
                                                    {formatPrice(data.futurePrice)}
                                                </span>
                                                <span className="text-[9px] text-gray-400">▾</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ) : loading ? (
                                <div className="flex items-center gap-2 animate-pulse">
                                    <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
                                    <div className="h-3 w-14 bg-gray-200 dark:bg-gray-800 rounded" />
                                    <div className="h-3 w-20 bg-gray-200 dark:bg-gray-800 rounded" />
                                </div>
                            ) : (
                                <span className="text-gray-400">—</span>
                            )}

                            <button
                                onClick={() => setHideChain(true)}
                                className="flex items-center gap-1 rounded-md border border-[#00b96b]/40 bg-[#00b96b]/10 dark:bg-emerald-950/30 px-2 py-0.5 text-[11px] font-semibold text-[#00b96b] dark:text-emerald-400 hover:bg-[#00b96b]/20 dark:hover:bg-emerald-950/50 cursor-pointer shadow-xs transition"
                                title="Hide Chain — give the right panel full width"
                            >
                                <FiEyeOff size={12} />
                                <span>Hide Chain</span>
                            </button>
                        </div>

                        {/* Row 2: First 3 Expiry Pills + Dropdown for remaining + Settings Cog */}
                        <div className="flex items-center justify-between gap-1.5 rounded-b-xl px-3 py-1.5 bg-gray-50/50 dark:bg-[#070e17]/50">
                            {data && data.expiries && data.expiries.length > 0 ? (
                                <div className="flex items-center gap-1 flex-1 min-w-0">
                                    {/* Only the pills scroll horizontally — the "More" dropdown below is
                                        a SIBLING of this, not nested inside it, because an overflow-x-auto
                                        ancestor also clips absolutely-positioned children vertically
                                        (overflow-y computes to "auto" once overflow-x isn't "visible"),
                                        which was silently hiding the dropdown panel on open. */}
                                    <div className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">
                                        {first3Expiries.map((exp) => (
                                            <button
                                                key={exp}
                                                onClick={() => load(symbol, exp)}
                                                className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                                                    exp === data.selectedExpiry
                                                        ? "bg-[#1677ff] text-white shadow-xs font-bold"
                                                        : "bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                                                }`}
                                            >
                                                {formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)
                                            </button>
                                        ))}
                                    </div>
                                    {remainingExpiries.length > 0 && (
                                        <div className="relative shrink-0">
                                            <button
                                                onClick={() => setExpiryDropdownOpen((v) => !v)}
                                                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                                                    remainingExpiries.includes(data.selectedExpiry)
                                                        ? "bg-[#1677ff] text-white shadow-xs font-bold"
                                                        : "bg-white dark:bg-[#0b1420] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                                                }`}
                                            >
                                                <span>
                                                    {remainingExpiries.includes(data.selectedExpiry)
                                                        ? `${formatExpiryShort(data.selectedExpiry)} (${daysUntilExpiry(data.selectedExpiry)}d)`
                                                        : "More"}
                                                </span>
                                                <span className={`text-[9px] transition-transform ${expiryDropdownOpen ? "rotate-180" : ""}`}>▾</span>
                                            </button>

                                            {expiryDropdownOpen && (
                                                <>
                                                    <div className="fixed inset-0 z-40" onClick={() => setExpiryDropdownOpen(false)} />
                                                    <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-2xl p-1">
                                                        {remainingExpiries.map((exp) => {
                                                            const active = exp === data.selectedExpiry;
                                                            return (
                                                                <button
                                                                    key={exp}
                                                                    onClick={() => {
                                                                        load(symbol, exp);
                                                                        setExpiryDropdownOpen(false);
                                                                    }}
                                                                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[12px] font-semibold transition cursor-pointer ${
                                                                        active
                                                                            ? "bg-[#1677ff] text-white"
                                                                            : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10"
                                                                    }`}
                                                                >
                                                                    <span>{formatExpiryShort(exp)}</span>
                                                                    <span className={active ? "text-blue-100" : "text-gray-400"}>{daysUntilExpiry(exp)}d</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs font-bold text-gray-700 dark:text-gray-300">Option Chain</div>
                            )}

                            {/* ATM jump button removed from beside Settings per user request — strikes-around-ATM count already lives in the Settings popup. */}

                            <div className="flex items-center gap-1 shrink-0 relative">
                                <button
                                    onClick={() => setSettingsOpen((v) => !v)}
                                    className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
                                    aria-label="Option chain settings"
                                    title="Column & ATM settings"
                                >
                                    <FiSettings size={15} />
                                </button>

                                {settingsOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                                        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] text-gray-800 dark:text-gray-100 p-3 shadow-xl text-[13px]">
                                            <div className="mb-3 flex items-center justify-between">
                                                <span className="font-bold text-gray-800 dark:text-gray-100">Chain Settings</span>
                                                <span className="text-[11px] text-gray-400">{enabledColumnCount}/{totalColumnCount} columns</span>
                                            </div>

                                            <div className="mb-3">
                                                <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">Strikes Around ATM</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {STRIKE_RANGES.map((rng) => (
                                                        <button
                                                            key={rng.label}
                                                            onClick={() => setStrikesAroundAtm(rng.value)}
                                                            className={`rounded px-2 py-1 text-[11px] font-bold transition-all cursor-pointer ${
                                                                strikesAroundAtm === rng.value
                                                                    ? "bg-[#1677ff] text-white shadow-xs"
                                                                    : "bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/10"
                                                            }`}
                                                        >
                                                            {rng.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="mb-3">
                                                <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">ATM Based On</div>
                                                <div className="flex gap-3">
                                                    {[["spot", "Spot"], ["future", "Future"], ["synth", "Synth Future"]].map(([key, label]) => (
                                                        <label key={key} className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
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
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
                                                        <input type="checkbox" checked={columns.oi} onChange={() => toggleColumn("oi")} /> OI
                                                    </label>
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
                                                        <input type="checkbox" checked={columns.lot} onChange={() => toggleColumn("lot")} /> Lot
                                                    </label>
                                                </div>
                                            </div>

                                            <div className="mb-3">
                                                <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">Delta & IV</div>
                                                <div className="flex gap-3">
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
                                                        <input type="checkbox" checked={columns.callDelta} onChange={() => toggleColumn("callDelta")} /> Call Delta
                                                    </label>
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
                                                        <input type="checkbox" checked={columns.putDelta} onChange={() => toggleColumn("putDelta")} /> Put Delta
                                                    </label>
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
                                                        <input type="checkbox" checked={columns.iv} onChange={() => toggleColumn("iv")} /> IV
                                                    </label>
                                                </div>
                                            </div>

                                            <div className="mb-3">
                                                <div className="mb-1.5 font-semibold text-gray-600 dark:text-gray-400">Greeks</div>
                                                <div className="flex gap-3">
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
                                                        <input type="checkbox" checked={columns.theta} onChange={() => toggleColumn("theta")} /> Theta
                                                    </label>
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
                                                        <input type="checkbox" checked={columns.vega} onChange={() => toggleColumn("vega")} /> Vega
                                                    </label>
                                                    <label className="flex items-center gap-1 text-gray-700 dark:text-gray-300 cursor-pointer">
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

                    {error &&<div className="mb-2 rounded-lg border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/20 px-3 py-2 text-[12px] text-rose-700 dark:text-rose-300">{error}</div>}

                    {loading && !data && (
                        <OptionChainSkeleton columns={columns} />
                    )}

                    {data && data.rows && (
                        <div className="relative">
                        <div ref={chainScrollRef} className="max-h-[82vh] overflow-x-auto overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm custom-scrollbar">
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
                                    {displayChainRows.map((row, rowIdx) => {
                                        const ceItm = row.strike < data.spotPrice;
                                        const peItm = row.strike > data.spotPrice;
                                        const isAtm = row.strike === effectiveAtmStrike;
                                        const atmOffset = Math.round((row.strike - effectiveAtmStrike) / strikeGap);
                                        const lots = data.lotSize ? Math.round((row.ce?.oi || 0) / data.lotSize) : null;
                                        const putLots = data.lotSize ? Math.round((row.pe?.oi || 0) / data.lotSize) : null;
                                        const ceLeg = legsAt(row.strike, "CE")[0] || null;
                                        const peLeg = legsAt(row.strike, "PE")[0] || null;
                                        const ceNet = netPositionAt(row.strike, "CE");
                                        const peNet = netPositionAt(row.strike, "PE");
                                        // Live-feed staleness for this strike's CE/PE — drives
                                        // the amber ⚠ on the LTP/OI/Δ cells (see StaleBadge).
                                        const ceStale = contractStaleness(row.ce, staleOpts);
                                        const peStale = contractStaleness(row.pe, staleOpts);
                                        const ceAge = staleOpts.now - (row.ce?._tickAt || 0);
                                        const peAge = staleOpts.now - (row.pe?._tickAt || 0);
                                        const rowStale = ceStale.priceStale || peStale.priceStale;
                                        const hasActiveLeg = ceLeg != null || peLeg != null;
                                        // In a border-collapse table, a row's border-top loses to the
                                        // previous row's border-bottom in the conflict resolution — that's
                                        // why only the ATM row's own bottom edge was showing green. Fixed
                                        // by giving the row ABOVE the ATM row the green border-bottom
                                        // instead (the edge that actually wins), so both the top and
                                        // bottom line around the ATM row render.
                                        const nextIsAtm = displayChainRows[rowIdx + 1]?.strike === effectiveAtmStrike;
                                        return (
                                            <tr
                                                key={row.strike}
                                                ref={isAtm ? atmRowRef : null}
                                                className={`transition-colors ${
                                                    isAtm || nextIsAtm
                                                        ? "border-b border-[#00b96b]"
                                                        : "border-b border-gray-100/70 dark:border-white/5"
                                                } ${
                                                    hasActiveLeg
                                                        ? "bg-[#e6f4ff] dark:bg-[#002b4d]/40 font-semibold"
                                                        : isAtm
                                                        ? "bg-[#00b96b]/[0.06] dark:bg-[#00b96b]/[0.08] font-semibold"
                                                        : "hover:bg-gray-50/80 dark:hover:bg-white/[0.03]"
                                                } ${rowStale ? "border-l-2 border-l-amber-300" : ""}`}
                                            >
                                                {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.theta ?? "-"}</td>}
                                                {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.vega ?? "-"}</td>}
                                                {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.gamma ?? "-"}</td>}
                                                {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.iv ?? "-"}</td>}
                                                {columns.callDelta && (
                                                    <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                        {formatDelta(row.ce?.delta)}
                                                        <StaleBadge stale={ceStale.greeksStale} ageMs={staleOpts.now - staleOpts.dataLoadedAt} label="greeks/IV don't stream live — last refreshed a while ago" />
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
                                                                    {formatPrice(row.ce?.ltp)}
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
                                                                <span className={`absolute -top-0.5 right-0.5 z-[1] rounded-full border bg-white dark:bg-[#0c1421] px-1.5 text-[9px] font-bold leading-tight ${ceNet > 0 ? "border-[#52C41A] dark:border-emerald-500 text-[#52C41A] dark:text-emerald-400" : "border-[#FF4D4F] dark:border-rose-500 text-[#FF4D4F] dark:text-rose-400"}`}>
                                                                    {ceNet > 0 ? `+${ceNet}` : ceNet}
                                                                </span>
                                                            )}
                                                            <span className="text-gray-700 dark:text-gray-200 group-hover:invisible">
                                                                {formatPrice(row.ce?.ltp)}
                                                                <StaleBadge stale={ceStale.priceStale} ageMs={ceAge} />
                                                            </span>
                                                            <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white dark:bg-[#0c1421]">
                                                                <button onClick={() => addLeg(row, "CE", "buy")} className="rounded border border-[#52C41A] dark:border-emerald-500 text-[#52C41A] dark:text-emerald-400 hover:bg-[#52C41A] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">B</button>
                                                                <button onClick={() => addLeg(row, "CE", "sell")} className="rounded border border-[#FF4D4F] dark:border-rose-500 text-[#FF4D4F] dark:text-rose-400 hover:bg-[#FF4D4F] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">S</button>
                                                                <button onClick={() => setChartModal({ strike: row.strike, right: "CE" })} className="rounded border border-gray-300 dark:border-white/10 px-1 py-0.5 text-[10px] leading-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 cursor-pointer" title="View contract chart">📈</button>
                                                            </div>
                                                        </>
                                                    )}
                                                </td>
                                                {columns.oi && (
                                                    <td className={`relative p-0 tabular-nums ${ceItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                        <OiBar value={row.ce?.oi} max={maxCeOi} side="ce" />
                                                        {ceStale.priceStale && (
                                                             <span className="absolute right-0.5 top-0.5"><StaleBadge stale ageMs={ceAge} /></span>
                                                        )}
                                                        {columns.lot && <div className="px-1 pb-0.5 text-[10px] text-gray-400 text-right">{lots ?? "-"} lots</div>}
                                                    </td>
                                                )}

                                                {/* STRIKE PRICE — just a light, plain-background tint at ATM
                                                    (no pill/badge, no border) — stockmojo's own chain keeps the
                                                    strike cell a simple bordered box at every row, ATM included,
                                                    so only the background wash changes, nothing else. */}
                                                <td className={`py-1.5 text-center font-bold text-gray-900 dark:text-white border-x border-gray-100 dark:border-white/10 text-[13px] tabular-nums ${
                                                    hasActiveLeg
                                                        ? "bg-gray-50/40 dark:bg-[#070e17]/80"
                                                        : isAtm
                                                        ? "bg-[#00b96b]/10 dark:bg-[#00b96b]/15"
                                                        : "bg-gray-50/40 dark:bg-[#070e17]/80"
                                                }`}>
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
                                                        {peStale.priceStale && (
                                                            <span className="absolute left-0.5 top-0.5"><StaleBadge stale ageMs={peAge} /></span>
                                                        )}
                                                        {columns.lot && <div className="px-1 pb-0.5 text-[10px] text-gray-400">{putLots ?? "-"} lots</div>}
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
                                                                    {formatPrice(row.pe?.ltp)}
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
                                                                <span className={`absolute -top-0.5 left-0.5 z-[1] rounded-full border bg-white dark:bg-[#0c1421] px-1.5 text-[9px] font-bold leading-tight ${peNet > 0 ? "border-[#52C41A] dark:border-emerald-500 text-[#52C41A] dark:text-emerald-400" : "border-[#FF4D4F] dark:border-rose-500 text-[#FF4D4F] dark:text-rose-400"}`}>
                                                                    {peNet > 0 ? `+${peNet}` : peNet}
                                                                </span>
                                                            )}
                                                            <span className="text-gray-700 dark:text-gray-200 group-hover:invisible">
                                                                {formatPrice(row.pe?.ltp)}
                                                                <StaleBadge stale={peStale.priceStale} ageMs={peAge} />
                                                            </span>
                                                            <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white dark:bg-[#0c1421]">
                                                                <button onClick={() => addLeg(row, "PE", "buy")} className="rounded border border-[#52C41A] dark:border-emerald-500 text-[#52C41A] dark:text-emerald-400 hover:bg-[#52C41A] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">B</button>
                                                                <button onClick={() => addLeg(row, "PE", "sell")} className="rounded border border-[#FF4D4F] dark:border-rose-500 text-[#FF4D4F] dark:text-rose-400 hover:bg-[#FF4D4F] hover:text-white px-1.5 py-0.5 text-[10px] font-extrabold transition-colors cursor-pointer">S</button>
                                                                <button onClick={() => setChartModal({ strike: row.strike, right: "PE" })} className="rounded border border-gray-300 dark:border-white/10 px-1 py-0.5 text-[10px] leading-none text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 cursor-pointer" title="View contract chart">📈</button>
                                                            </div>
                                                        </>
                                                    )}
                                                </td>
                                                {columns.putDelta && (
                                                    <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${peItm ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                                                        {formatDelta(row.pe?.delta)}
                                                        <StaleBadge stale={peStale.greeksStale} ageMs={staleOpts.now - staleOpts.dataLoadedAt} label="greeks/IV don't stream live — last refreshed a while ago" />
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

                        {/* Floating "Go to ATM" pill */}
                        <button
                            onClick={() => scrollToAtm("smooth")}
                            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-900/85 hover:bg-gray-900 dark:bg-emerald-600 dark:hover:bg-emerald-500 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-lg transition"
                        >
                            Go to ATM
                        </button>
                    </div>
                )}
            </div>
            )}

            {hideChain && (
                <button
                    onClick={() => setHideChain(false)}
                    className="fixed left-3 top-20 z-30 flex items-center gap-1.5 rounded-full border border-[#00b96b]/40 bg-[#00b96b]/10 dark:bg-emerald-950/40 px-3 py-1.5 text-[12px] font-semibold text-[#00b96b] dark:text-emerald-400 shadow-md hover:bg-[#00b96b]/20 dark:hover:bg-emerald-950/60"
                >
                    <FiEye size={13} />
                    <span>Show Option Chain</span>
                </button>
            )}

            {/* Right Column: Analytics, Chart, Profiles */}
            <div className={`flex-1 min-w-0 flex flex-col ${mobileView !== "all" && mobileView !== "payoff" && mobileView !== "positions" && mobileView !== "presets" ? "hidden lg:flex" : ""}`}>
                {savedOpen && (
                    <SavedStrategiesModal
                        onClose={() => setSavedOpen(false)}
                        onLoad={(loadedLegs, underlying) => {
                            if (underlying !== symbol) setSymbol(underlying);
                            setLegs(loadedLegs.map((l) => ({ ...l, id: ++legIdCounter })));
                            setTab("positions");
                            setChartTab("payoff");
                            setSavedOpen(false);
                        }}
                    />
                )}

                <SquareOffAlertBanner
                    alert={squareOffAlert}
                    onDismiss={() => setSquareOffAlert(null)}
                    context="live"
                />

                {/* If NO strategy legs are added: Directly render Ready-Made Strategies catalog */}
                {legs.length === 0 ? (
                    <div className="flex flex-col min-h-[82vh] rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm overflow-hidden transition-colors">
                        <PresetStrategies data={data} onApply={applyPreset} fetchExpiryRows={fetchExpiryRows} bare />
                    </div>
                ) : (
                    /* When strategy legs ARE present: Open Payoff Chart and Active Positions */
                    <>
                        {/* Unified Strategy Analysis & Chart Card */}
                        <div className={`mb-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm overflow-hidden flex flex-col transition-colors ${mobileView === "positions" || mobileView === "presets" ? "hidden lg:flex" : "flex"}`}>
                            {/* Card Top Tab Bar (StockMojo style) */}
                            <div className="flex items-center justify-between gap-1 border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-[#070e17]/50 px-3 py-1.5">
                                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                                    {[
                                        ["payoff", "Payoff"],
                                        ["strategy", "Strategy Chart"],
                                        ["nifty", `${symbol} Chart`],
                                        ["combined", `Strategy Chart + ${symbol} Chart`],
                                    ].map(([key, label]) => (
                                        <button
                                            key={key}
                                            onClick={() => setChartTab(key)}
                                            className={`shrink-0 rounded-md px-3 py-1 text-xs font-bold transition cursor-pointer ${
                                                chartTab === key
                                                    ? "bg-[#e6f4ff] text-[#1677ff] dark:bg-[#002b4d]/60 dark:text-blue-300 shadow-xs"
                                                    : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {chartTab === "payoff" && (
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
                            {chartTab === "payoff" && payoffSettingsOpen && (
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
                                        <input type="range" min={0} max={daysToExpiry} step={1} value={whatIfDaysForward} onChange={(e) => setWhatIfDaysForward(Number(e.target.value))} className="w-full accent-[#1677ff]" />
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

                            {/* Card Body: Side-By-Side Layout (StockMojo style) */}
                            {chartTab === "payoff" ? (
                                <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-white/10 bg-white dark:bg-[#0b1420]">
                                    {/* Left Column: 6 Summary Metrics Stacked Vertically */}
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
                                                    {totalLivePnl != null && (fundsRequired > 0 || estMargin > 0) ? `(${((totalLivePnl / (fundsRequired || estMargin)) * 100).toFixed(2)}%)` : "(0.00%)"}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Box 2: Est. Margin (stockmojo.in shows only this one figure here —
                                            fundsRequired still drives the P&L % denominator below, just not
                                            shown as its own line in this box) */}
                                        <div className="pb-2.5 border-b border-gray-100 dark:border-white/10 space-y-1.5">
                                            <div>
                                                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-0.5">Est. Margin</div>
                                                <div
                                                    className="text-sm font-bold text-gray-900 dark:text-white tabular-nums"
                                                    title={span ? `SPAN ${formatPrice(span.scanRisk + span.calendarCharge)} + Exposure ${formatPrice(span.exposure)}${span.expiryDayExposure ? ` + Expiry-day ELM ${formatPrice(span.expiryDayExposure)}` : ""}` : "Approximate — NSE SPAN quote unavailable"}
                                                >
                                                    {estMargin == null ? "—" : estMargin === 0 ? "Not required" : estMargin >= 100000 ? `${(estMargin / 100000).toFixed(2)}L` : formatPrice(estMargin)}
                                                </div>
                                                {estMargin > 0 && (
                                                    <div className={`text-[10px] font-medium whitespace-nowrap ${span ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                                                        {spanSourceLabel(span)}
                                                    </div>
                                                )}
                                            </div>
                                            {marginBenefit > 0 && (
                                                <div className="flex items-center justify-between text-[11px] bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                                                    <span className="text-emerald-700 dark:text-emerald-300 font-semibold">Hedge Benefit:</span>
                                                    <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                                                        Saved {marginBenefit >= 100000 ? `${(marginBenefit / 100000).toFixed(2)}L` : formatPrice(marginBenefit)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Box 3: POP & Risk : Reward */}
                                        <div className="pb-2.5 border-b border-gray-100 dark:border-white/10 flex items-start justify-between gap-2">
                                            <div>
                                                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">POP</div>
                                                <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                                                    {pop != null ? `${pop.toFixed(0)}%` : "—"}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => setRewardRiskOrder((v) => !v)}
                                                    className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#1677ff] dark:text-gray-400 cursor-pointer ml-auto mb-1 transition-colors"
                                                    title="Switch between Risk : Reward and Reward : Risk"
                                                >
                                                    <span>{rewardRiskOrder ? "Reward : Risk" : "Risk : Reward"}</span>
                                                    <span className="text-[10px]">⇅</span>
                                                </button>
                                                <div className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
                                                    {formatRiskReward(maxProfit, maxLoss, rewardRiskOrder)}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Box 4: Max Profit */}
                                        <div className="pb-2.5 border-b border-gray-100 dark:border-white/10">
                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Max Profit</div>
                                            <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                {maxProfit == null ? "—" : typeof maxProfit === "number" ? (
                                                    <>
                                                        {maxProfit >= 0 ? "+" : ""}{formatPrice(maxProfit)}
                                                        {(fundsRequired > 0 || estMargin > 0) && (
                                                            <span className="text-[11px] font-normal text-emerald-600/80 dark:text-emerald-400/80 ml-1">
                                                                ({((maxProfit / (fundsRequired || estMargin)) * 100).toFixed(2)}%)
                                                            </span>
                                                        )}
                                                    </>
                                                ) : (
                                                    maxProfit
                                                )}
                                            </div>
                                        </div>

                                        {/* Box 5: Max Loss */}
                                        <div className="pb-2.5 border-b border-gray-100 dark:border-white/10">
                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Max Loss</div>
                                            <div className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                                                {maxLoss == null ? "—" : typeof maxLoss === "number" ? (
                                                    <>
                                                        {formatPrice(maxLoss)}
                                                        {(fundsRequired > 0 || estMargin > 0) && (
                                                            <span className="text-[11px] font-normal text-rose-600/80 dark:text-rose-400/80 ml-1">
                                                                ({((Math.abs(maxLoss) / (fundsRequired || estMargin)) * 100).toFixed(2)}%)
                                                            </span>
                                                        )}
                                                    </>
                                                ) : (
                                                    maxLoss
                                                )}
                                            </div>
                                        </div>

                                        {/* Box 6: Breakevens */}
                                        <div>
                                            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Breakevens</div>
                                            <div className="text-[11.5px] font-bold text-gray-800 dark:text-gray-200">
                                                {breakevens && breakevens.length > 0 ? (
                                                    breakevens.map((be, idx) => {
                                                        const pct = data?.spotPrice ? ((be - data.spotPrice) / data.spotPrice) * 100 : null;
                                                        return (
                                                            <span key={idx}>
                                                                {idx > 0 && " - "}
                                                                <span>{Math.round(be).toLocaleString("en-IN")}</span>
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

                                    {/* Right Payoff Chart Area */}
                                    <div className="flex-1 min-w-0 p-2 sm:p-3 flex flex-col justify-center">
                                        <PayoffChart
                                            curve={curve}
                                            spotPrice={data?.spotPrice}
                                            breakevens={breakevens}
                                            expectedMove={expectedMove}
                                            oiData={data?.rows || []}
                                            yearsRemaining={yearsRemaining}
                                            height={340}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <div className="p-4 flex flex-col justify-center">
                                    {/* Local TradingView Charting Library on every chart tab (full toolset). */}
                                    {chartTab === "strategy" && <StrategyTradingViewChart symbol={symbol} mode="strategy" legs={legs} />}
                                    {chartTab === "nifty" && <StrategyTradingViewChart symbol={symbol} mode="nifty" legs={legs} />}
                                    {chartTab === "combined" && <StrategyTradingViewChart symbol={symbol} mode="combined" legs={legs} />}
                                </div>
                            )}
                        </div>

                        {/* Interactive Position and Greeks Segment Control (StockMojo style) */}
                        <div className={`rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] shadow-sm overflow-hidden transition-colors ${mobileView === "payoff" ? "hidden lg:block" : "block"}`}>
                            {/* Card Top Tabs */}
                            <div className="flex items-center justify-between border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-4 pt-1">
                                <div className="flex gap-4">
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
                                </div>
                                <button
                                    onClick={() => setSettingsOpen((v) => !v)}
                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 cursor-pointer"
                                    title="Chain Settings"
                                >
                                    <FiSettings size={15} />
                                </button>
                            </div>

                            {tab === "positions" && (
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
                                                        // Legs have different lot counts — typing one number would
                                                        // flatten them, so only the relative ± step is offered.
                                                        <>
                                                            <button onClick={() => bulkAdjustLots(-1)} className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 font-bold cursor-pointer" title="−1 lot on every leg">−</button>
                                                            <span className="px-1 text-center font-bold text-label text-fg-subtle" title="Legs have different lot counts">mixed</span>
                                                            <button onClick={() => bulkAdjustLots(1)} className="px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 font-bold cursor-pointer" title="+1 lot on every leg">+</button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="text-[11.5px] font-semibold text-gray-700 dark:text-gray-300">
                                                Qty: <span className="font-bold tabular-nums text-gray-900 dark:text-white">{totalLots * (data?.lotSize || 50)}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs">
                                            <span className="text-sm">🎯</span>
                                            <span className="font-semibold text-gray-600 dark:text-gray-400">Total P&L: </span>
                                            <span className={`font-bold tabular-nums ${totalLivePnl != null && totalLivePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                {totalLivePnl != null ? `${totalLivePnl >= 0 ? "+" : ""}${Math.round(totalLivePnl).toLocaleString("en-IN")}(${(fundsRequired || estMargin) > 0 ? ((totalLivePnl / (fundsRequired || estMargin)) * 100).toFixed(2) : "0.00"}%)` : "+0(0.00%)"}
                                            </span>
                                        </div>
                                    </div>

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
                                                    <th className="px-3 sm:px-4 py-2.5 text-right font-medium">Margin</th>
                                                    <th className="px-3 sm:px-4 py-2.5 text-center font-medium">SL/TG</th>
                                                    <th className="px-3 sm:px-4 py-2.5 text-center font-medium">Exit</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-white/5 whitespace-nowrap">
                                                {orderedLegs.map((leg) => {
                                                    const row = rowByStrike.get(leg.strike);
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
                                                                    title={included ? "Included in payoff calculation — uncheck to exclude" : "Excluded from payoff calculation — check to include"}
                                                                    className="cursor-pointer accent-[#1677ff]"
                                                                />
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5">
                                                                <button
                                                                    onClick={() => toggleLegSide(leg.id)}
                                                                    title="Click to flip Buy/Sell"
                                                                    className={`w-6 h-6 rounded flex items-center justify-center text-xs font-black shadow-xs cursor-pointer border ${
                                                                        leg.action === "buy"
                                                                            ? "bg-white dark:bg-[#0b1420] border-[#52c41a] text-[#52c41a]"
                                                                            : "bg-white dark:bg-[#0b1420] border-[#ff4d4f] text-[#ff4d4f]"
                                                                    }`}
                                                                >
                                                                    {leg.action === "buy" ? "B" : "S"}
                                                                </button>
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                <LotsInput value={leg.qty} onChange={(n) => updateQty(leg.id, n)} />
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5">
                                                                <select
                                                                    value={leg.expiry || ""}
                                                                    onChange={(e) => rollLegExpiry(leg.id, e.target.value)}
                                                                    className="rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] px-2 py-1 text-xs font-semibold text-gray-700 dark:text-gray-200 outline-none focus:border-[#1677ff] cursor-pointer"
                                                                >
                                                                    {(data?.expiries || [leg.expiry]).map((exp) => (
                                                                        <option key={exp} value={exp}>{formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)</option>
                                                                    ))}
                                                                </select>
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <button onClick={() => rollLegStrike(leg.id, -1)} className="rounded border border-gray-200 dark:border-white/10 px-1.5 py-0.5 text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer" title="Roll to lower strike">−</button>
                                                                    <span className="font-bold tabular-nums text-gray-900 dark:text-white px-1">{leg.strike}</span>
                                                                    <button onClick={() => rollLegStrike(leg.id, 1)} className="rounded border border-gray-200 dark:border-white/10 px-1.5 py-0.5 text-xs font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 transition cursor-pointer" title="Roll to higher strike">+</button>
                                                                </div>
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                <span className={`rounded px-2 py-0.5 text-xs font-bold border ${
                                                                    leg.type === "CE"
                                                                        ? "border-[#52c41a] text-[#52c41a] bg-emerald-50/50 dark:bg-emerald-950/20"
                                                                        : "border-[#ff4d4f] text-[#ff4d4f] bg-rose-50/50 dark:bg-rose-950/20"
                                                                }`}>
                                                                    {leg.type}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-right">
                                                                <input
                                                                    type="number"
                                                                    step="0.05"
                                                                    min="0"
                                                                    value={leg.premium}
                                                                    onChange={(e) => updateLeg(leg.id, { premium: Math.max(0, Number(e.target.value) || 0) })}
                                                                    title="Entry price — editable"
                                                                    className="w-20 rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] px-2 py-1 text-right tabular-nums text-gray-800 dark:text-gray-200 focus:border-[#1677ff] outline-none text-xs font-semibold"
                                                                />
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-right">
                                                                <input
                                                                    type="number"
                                                                    step="0.05"
                                                                    min="0"
                                                                    value={currentLtp ?? ""}
                                                                    onChange={(e) => updateLeg(leg.id, { ltpOverride: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
                                                                    title="LTP — editable"
                                                                    className={`w-20 rounded border px-2 py-1 text-right tabular-nums outline-none focus:border-[#1677ff] text-xs font-semibold ${leg.ltpOverride != null ? "border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 text-gray-900 dark:text-white" : "border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] text-gray-900 dark:text-white"}`}
                                                                />
                                                            </td>
                                                            <td className={`px-3 sm:px-4 py-2 sm:py-2.5 text-right font-bold tabular-nums text-xs ${livePnl != null && livePnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                                {livePnl != null ? `${livePnl >= 0 ? "+" : ""}${Math.round(livePnl).toLocaleString("en-IN")}` : "0"}
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300 text-xs">
                                                                {leg.action === "sell" && data?.spotPrice
                                                                    ? (() => {
                                                                        const m = spanMarginByLegId?.get(leg.id) ?? computeEstMargin([leg], data.spotPrice, symbol);
                                                                        return m >= 100000 ? `${(m / 100000).toFixed(2)}L` : formatPrice(m);
                                                                    })()
                                                                    : <span className="text-gray-300 dark:text-gray-600">—</span>}
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5 text-center">
                                                                <button
                                                                    onClick={() => openSlTgModal(leg)}
                                                                    className="p-1 text-sm hover:scale-110 transition cursor-pointer"
                                                                    title={leg.slPercent != null || leg.tgPercent != null ? `SL ${leg.slPercent ?? "—"}% / TG ${leg.tgPercent ?? "—"}%` : "Configure SL/TG"}
                                                                >
                                                                    🎯
                                                                </button>
                                                                {(leg.slPercent != null || leg.tgPercent != null) && (
                                                                    <div className="text-[10px] text-gray-400 dark:text-gray-500">SL {leg.slPercent ?? "—"}% / TG {leg.tgPercent ?? "—"}%</div>
                                                                )}
                                                            </td>
                                                            <td className="px-3 sm:px-4 py-2 sm:py-2.5">
                                                                <div className="flex items-center justify-center gap-1.5">
                                                                    <select
                                                                        value={leg.qty}
                                                                        onChange={(e) => updateQty(leg.id, Number(e.target.value))}
                                                                        className="rounded border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] px-1 py-0.5 text-xs font-bold text-gray-700 dark:text-gray-300 cursor-pointer"
                                                                        title="Exit Lots"
                                                                    >
                                                                        {Array.from({ length: Math.max(10, leg.qty) }, (_, i) => i + 1).map((q) => (
                                                                            <option key={q} value={q}>{q}</option>
                                                                        ))}
                                                                    </select>
                                                                    <button onClick={() => resetLegEntryToLtp(leg.id)} className="p-1 text-gray-400 hover:text-[#1677ff] dark:hover:text-[#1677ff] transition cursor-pointer" title="Reset entry to current LTP"><FiRefreshCw size={12} /></button>
                                                                    <button onClick={() => removeLeg(leg.id)} className="p-1 text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer" title="Remove leg"><FiTrash2 size={13} /></button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}

                            {tab === "greeks" && (
                                <div className="p-3">
                                    {activeLegs.length > 0 ? (
                                        <PortfolioGreeksTable legs={legs} netGreeks={netGreeks} />
                                    ) : (
                                        <div className="py-8 text-center text-xs text-gray-400">
                                            Add option legs to calculate and inspect portfolio Greeks.
                                        </div>
                                    )}
                                </div>
                            )}

                            {tab === "presets" && (
                                <PresetStrategies data={data} onApply={applyPreset} fetchExpiryRows={fetchExpiryRows} bare />
                            )}
                        </div>
                    </>
                )}
            </div>
            </div>
            </div>
            )}

            {/* How to Build an Option Strategy — stockmojo.in's builder page
                ends with this numbered educational guide before its related
                tools row (confirmed from a real fetch of their page). Numbers
                reflect our actual product (up to 6 legs, not their 4). */}
            {!isFullscreen && (
                <div className="mt-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-4 py-3.5 shadow-xs">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2.5">
                        How to Build an Option Strategy
                    </h2>
                    <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
                        The payoff diagram above plots profit/loss across underlying prices at expiry, with max profit/loss zones shaded and breakeven points marked. Est. Margin is an approximation of what a broker would block, based on NSE's SPAN risk file where available.
                    </p>
                    <ol className="space-y-1.5 text-[11.5px] text-gray-600 dark:text-gray-300 list-decimal list-inside">
                        <li>Select a symbol and expiry from the picker above.</li>
                        <li>Add your first leg — click Buy or Sell on a Call or Put at any strike in the chain.</li>
                        <li>Build up to 6 legs to construct a multi-leg strategy, or start from a Ready-Made template.</li>
                        <li>Review the payoff diagram — Max Profit, Max Loss, and Breakevens update live.</li>
                        <li>Check the Greeks tab for combined Delta, Theta, Vega, and Gamma across every leg.</li>
                    </ol>
                </div>
            )}

            {/* Related Tools — stockmojo.in's builder page ends with a row of
                cards linking to adjacent tools (Simulator, Option Chain,
                Straddle Chart, F&O Lot Size). We don't have a Straddle Chart
                page anymore (removed Phase 8.1) or an F&O Lot Size tool, so
                this links to real existing routes instead of copying theirs
                verbatim — same "never link to what isn't there" rule Home.jsx
                already follows via data/tools.js. Hidden in fullscreen mode. */}
            {!isFullscreen && (
                <div className="mt-4">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
                        Related Tools
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {[
                            { to: "/simulator", label: "Simulator", desc: "Minute-by-minute tick replay", Icon: FiClock },
                            { to: "/option-chain", label: "Option Chain", desc: "Live LTP, PCR & Max Pain", Icon: FiGrid },
                            { to: "/paper-trade", label: "Paper Trade", desc: "Virtual order execution", Icon: FiDollarSign },
                            { to: "/historical-chart", label: "Historical Chart", desc: "Multi-timeframe candles", Icon: FiBarChart2 },
                        ].map(({ to, label, desc, Icon }) => (
                            <Link
                                key={to}
                                to={to}
                                className="group flex items-start gap-2.5 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] px-3 py-2.5 shadow-xs hover:border-[#1677ff] hover:shadow-sm transition"
                            >
                                <span className="shrink-0 w-7 h-7 rounded-lg bg-[#e6f4ff] dark:bg-[#002b4d]/60 text-[#1677ff] dark:text-blue-300 flex items-center justify-center">
                                    <Icon size={14} />
                                </span>
                                <span className="flex flex-col min-w-0">
                                    <span className="text-xs font-bold text-gray-900 dark:text-white group-hover:text-[#1677ff] transition">
                                        {label}
                                    </span>
                                    <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                        {desc}
                                    </span>
                                </span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {slTgEditId != null && (
                <SlTgModal
                    leg={legs.find((l) => l.id === slTgEditId)}
                    symbol={symbol}
                    draft={slTgDraft}
                    onDraftChange={setSlTgDraft}
                    onClose={closeSlTgModal}
                    onSave={() => saveSlTgModal(slTgEditId)}
                    footer="live"
                />
            )}

            {chartModal && (
                <ContractChartModal
                    symbol={symbol}
                    strike={chartModal.strike}
                    right={chartModal.right}
                    expiry={data?.selectedExpiry}
                    onClose={() => setChartModal(null)}
                />
            )}

            {paperExecuteOpen && (
                <PaperExecuteModal
                    isOpen={paperExecuteOpen}
                    onClose={() => setPaperExecuteOpen(false)}
                    symbol={symbol}
                    legs={legs}
                    lotSize={data?.lotSize}
                    requiredFunds={fundsRequired}
                    requiredMargin={estMargin}
                />
            )}
        </div>
    );
}