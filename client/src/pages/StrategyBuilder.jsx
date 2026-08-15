import { useEffect, useMemo, useRef, useState } from "react";
import { useOptionChain } from "../hooks/useOptionChain";
import { fetchOptionChain, fetchSymbolList } from "../services/optionChainApi";
import { formatPrice } from "../utils/format";
import {
    computePayoffCurve, computeBreakevens, computeMaxProfitLoss, computeNetGreeks,
    addMarkToMarketCurve, computeExpectedMove, computePOP, evaluationExpiryOf,
} from "../utils/payoff";
import { yearsToExpiry, daysUntilExpiry } from "../utils/blackScholes";
import PayoffChart from "../components/PayoffChart";
import StrategyValueChart from "../components/StrategyValueChart";
import UnderlyingChart from "../components/UnderlyingChart";
import PresetStrategies from "../components/PresetStrategies";
import SaveButton from "../components/SaveButton";
import SavedStrategiesModal from "../components/SavedStrategiesModal";
import OiBar from "../components/OiBar";
import ContractChartModal from "../components/ContractChartModal";
import { saveStrategy } from "../services/strategiesApi";
import { FiSettings } from "react-icons/fi";


function formatDelta(value) {
    return value == null || Number.isNaN(value) ? "-" : Number(value).toFixed(2);
}

// Expiries now arrive as plain 'YYYY-MM-DD' (Angel One era, see CLAUDE.md
// Gotcha #12) — this is just a display formatter, parsed manually.
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatExpiryShort(sqlDate) {
    if (!sqlDate) return "";
    const [, m, d] = sqlDate.split("-").map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]}`;
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

// One row in the searchable underlying-selector dropdown — a star toggles
// membership in the favorites list the chevrons cycle through.
function SymbolOption({ sym, active, isFav, onPick, onToggleFav }) {
    return (
        <div className={`flex items-center justify-between px-2 py-1.5 hover:bg-gray-50 ${active ? "bg-blue-50" : ""}`}>
            <button onClick={() => onPick(sym)} className="flex-1 text-left font-medium text-gray-700">{sym}</button>
            <button
                onClick={(e) => { e.stopPropagation(); onToggleFav(sym); }}
                className={`px-1 ${isFav ? "text-amber-500" : "text-gray-300 hover:text-gray-400"}`}
                title={isFav ? "Remove from favorites" : "Add to favorites"}
            >
                ★
            </button>
        </div>
    );
}

function legFromRow(row, right, action, expiry) {
    const side = right === "CE" ? row.ce : row.pe;
    return {
        id: ++legIdCounter,
        action, // 'buy' | 'sell'
        type: right, // 'CE' | 'PE'
        strike: row.strike,
        premium: side.ltp,
        qty: 1,
        iv: side.iv,
        delta: side.delta,
        gamma: side.gamma,
        theta: side.theta,
        vega: side.vega,
        expiry, // which expiry this leg's premium/greeks came from — see payoff.js
    };
}

function Stat({ label, value, tone, hint }) {
    return (
        <div title={hint} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
            <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{label}</div>
            <div className={`text-sm font-bold tabular-nums mt-0.5 ${tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : "text-gray-800"}`}>
                {value}
            </div>
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

export default function StrategyBuilder() {
    const { symbol, setSymbol, data, loading, error, load } = useOptionChain();
    const [legs, setLegs] = useState([]);
    const [tab, setTab] = useState("positions"); // 'positions' | 'greeks'
    const [chartTab, setChartTab] = useState("payoff"); // 'payoff' | 'strategy' | 'underlying'

    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [atmBasis, setAtmBasis] = useState("spot"); // 'spot' | 'future' | 'synth'
    const [showAtmDistance, setShowAtmDistance] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [savedOpen, setSavedOpen] = useState(false);
    const [hideChain, setHideChain] = useState(false);
    const [strikeAsc, setStrikeAsc] = useState(true);
    const atmRowRef = useRef(null);

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
        resetLegs();
    }

    function pickSymbol(sym) {
        setSymbol(sym);
        resetLegs();
        setPickerOpen(false);
        setPickerQuery("");
    }

    function toggleFavorite(sym) {
        setFavorites((prev) => (prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]));
    }

    function addLeg(row, right, action) {
        setLegs((prev) => {
            if (prev.length >= 6) return prev;
            return [...prev, legFromRow(row, right, action, data?.selectedExpiry)];
        });
    }

    // Fetches a DIFFERENT expiry's chain than the one currently displayed —
    // needed for calendar-spread presets, whose far leg comes from a later
    // expiry. Doesn't touch `data`/the visible chain table; returns rows only.
    function fetchExpiryRows(expiry) {
        return fetchOptionChain(symbol, expiry).then((res) => res.rows || []);
    }

    function removeLeg(id) {
        setLegs((prev) => prev.filter((l) => l.id !== id));
        setSelectedLegIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    }

    function updateQty(id, qty) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
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
        setSelectedLegIds(new Set());
    }

    // --- Positions table: selection, bulk lots, expiry/strike rolling, SL/TG ---
    const [selectedLegIds, setSelectedLegIds] = useState(new Set());
    const [legsTopFirst, setLegsTopFirst] = useState(true);
    const [slTgEditId, setSlTgEditId] = useState(null);

    const orderedLegs = useMemo(() => (legsTopFirst ? legs : [...legs].reverse()), [legs, legsTopFirst]);
    const allSelected = legs.length > 0 && legs.every((l) => selectedLegIds.has(l.id));

    function toggleSelectAll() {
        setSelectedLegIds(allSelected ? new Set() : new Set(legs.map((l) => l.id)));
    }
    function toggleLegSelected(id) {
        setSelectedLegIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    // Scales EVERY leg's lot count by the same delta at once (min 1) —
    // "lots multiplier stepper (+/-) that scales every leg at once".
    function bulkAdjustLots(delta) {
        setLegs((prev) => prev.map((l) => ({ ...l, qty: Math.max(1, l.qty + delta) })));
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

    // SL/TG here are a planning note stored on the leg, NOT an executed
    // order — this workspace has no live monitoring/auto-exit engine.
    // Automatic SL%/target% exits DO exist, but only in the separate
    // Backtest engine (server/services/backtestEngine.js), which runs
    // against stored historical data, not this live/interactive builder.
    function setLegSlTg(id, slPercent, tgPercent) {
        updateLeg(id, {
            slPercent: slPercent === "" ? null : Number(slPercent),
            tgPercent: tgPercent === "" ? null : Number(tgPercent),
        });
    }

    function applyPreset(presetLegs) {
        setLegs(presetLegs.map((l) => ({ ...l, id: ++legIdCounter })));
    }

    const rowByStrike = useMemo(() => {
        const map = new Map();
        (data?.rows || []).forEach((r) => map.set(r.strike, r));
        return map;
    }, [data]);

    // Rows in display order — "sortable by clicking a sort icon" on the
    // Strike header just reverses the (already-strike-ordered) row list.
    const displayChainRows = useMemo(() => {
        if (!data?.rows) return [];
        return strikeAsc ? data.rows : [...data.rows].slice().reverse();
    }, [data, strikeAsc]);

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

    function scrollToAtm(behavior = "smooth") {
        atmRowRef.current?.scrollIntoView({ behavior, block: "center" });
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
    }, [data?.selectedExpiry, symbol]);

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

    function legLivePnl(leg) {
        const row = rowByStrike.get(leg.strike);
        const currentLtp = row ? (leg.type === "CE" ? row.ce.ltp : row.pe.ltp) : null;
        if (currentLtp == null) return null;
        const diff = leg.action === "buy" ? currentLtp - leg.premium : leg.premium - currentLtp;
        return diff * leg.qty;
    }

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
    }, [legs, rowByStrike]);

    const { curve, breakevens, maxProfit, maxLoss, netGreeks, currentPnl, pop, expectedMove } = useMemo(() => {
        if (!legs.length || !data || !data.spotPrice) {
            return { curve: [], breakevens: [], maxProfit: null, maxLoss: null, netGreeks: null, currentPnl: null, pop: null, expectedMove: null };
        }

        try {
            const spread = data.spotPrice * 0.08;
            let curveData = computePayoffCurve(legs, { minPrice: data.spotPrice - spread, maxPrice: data.spotPrice + spread }) || [];
            const breakEvs = computeBreakevens(curveData) || [];
            const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(legs, curveData);
            const netGrks = computeNetGreeks(legs);

            // For a single-expiry strategy this is just data.selectedExpiry; for
            // a calendar spread it's the near leg's expiry — the meaningful
            // horizon for "at expiry" (see payoff.js's evaluationExpiryOf).
            const evaluationExpiry = evaluationExpiryOf(legs) || data.selectedExpiry;
            const yearsRemaining = yearsToExpiry(evaluationExpiry);
            const atmRow = data.rows ? data.rows.find((r) => r.strike === data.atmStrike) : null;
            const atmIv = atmRow?.iv ?? null;

            curveData = (atmIv && typeof addMarkToMarketCurve === "function") ? addMarkToMarketCurve(curveData, legs, yearsRemaining, Date.now()) : curveData;
            const expMv = (atmIv && typeof computeExpectedMove === "function") ? computeExpectedMove(data.spotPrice, atmIv, yearsRemaining) : null;
            const popVal = (atmIv && typeof computePOP === "function") ? computePOP(curveData, data.spotPrice, atmIv, yearsRemaining) : null;

            const closest = curveData.length > 0
                ? curveData.reduce((a, b) => (Math.abs(b.price - data.spotPrice) < Math.abs(a.price - data.spotPrice) ? b : a))
                : { pnl: 0 };

            return { curve: curveData, breakevens: breakEvs, maxProfit: mxProf, maxLoss: mxLoss, netGreeks: netGrks, currentPnl: closest.pnl, pop: popVal, expectedMove: expMv };
        } catch (err) {
            console.error(err);
            return { curve: [], breakevens: [], maxProfit: null, maxLoss: null, netGreeks: null, currentPnl: null, pop: null, expectedMove: null };
        }
    }, [legs, data]);

    return (
        <div className="mx-auto flex max-w-[1600px] gap-5 px-5 py-5 bg-gray-50/40 min-h-screen">
            {/* Left Column: Option Chain Window */}
            {!hideChain && (
            <div className="w-[540px] shrink-0 flex flex-col">
                <div className="mb-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 relative">
                            <button
                                onClick={() => cycleSymbol(-1)}
                                disabled={favorites.length < 2}
                                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                                aria-label="Previous favorite symbol"
                            >
                                ‹
                            </button>
                            {data?.lotSize && (
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                                    {data.lotSize}
                                </span>
                            )}
                            <button
                                onClick={() => setPickerOpen((v) => !v)}
                                className="text-sm font-bold text-gray-900 hover:underline"
                            >
                                {symbol}
                            </button>
                            <button
                                onClick={() => cycleSymbol(1)}
                                disabled={favorites.length < 2}
                                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                                aria-label="Next favorite symbol"
                            >
                                ›
                            </button>

                            {pickerOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                                    <div className="absolute left-0 top-full z-20 mt-1 w-64 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl text-xs">
                                        <div className="sticky top-0 border-b border-gray-100 bg-white p-2">
                                            <input
                                                autoFocus
                                                value={pickerQuery}
                                                onChange={(e) => setPickerQuery(e.target.value)}
                                                placeholder="Search symbol…"
                                                className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-500"
                                            />
                                        </div>
                                        {filteredIndices.length > 0 && (
                                            <div>
                                                <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase text-gray-400">Index</div>
                                                {filteredIndices.map((s) => (
                                                    <SymbolOption key={s} sym={s} active={s === symbol} isFav={favorites.includes(s)} onPick={pickSymbol} onToggleFav={toggleFavorite} />
                                                ))}
                                            </div>
                                        )}
                                        {filteredStocks.length > 0 && (
                                            <div>
                                                <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase text-gray-400">Stocks</div>
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

                        <div className="flex items-center gap-1 relative">
                            <button
                                onClick={() => setHideChain(true)}
                                className="rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-100"
                                title="Hide Chain — give the right panel full width"
                            >
                                Hide Chain
                            </button>
                            <button
                                onClick={() => setSettingsOpen((v) => !v)}
                                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                aria-label="Option chain settings"
                                title="Column & ATM settings"
                            >
                                <FiSettings size={20} />
                            </button>

                            {settingsOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setSettingsOpen(false)} />
                                    <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-xl text-xs">
                                        <div className="mb-3 flex items-center justify-between">
                                            <span className="font-bold text-gray-800">Chain Settings</span>
                                            <span className="text-[10px] text-gray-400">{enabledColumnCount}/{totalColumnCount} columns</span>
                                        </div>

                                        <div className="mb-3">
                                            <div className="mb-1.5 font-semibold text-gray-600">ATM Based On</div>
                                            <div className="flex gap-3">
                                                {[["spot", "Spot"], ["future", "Future"], ["synth", "Synth Future"]].map(([key, label]) => (
                                                    <label key={key} className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                        <input type="radio" name="atmBasis" checked={atmBasis === key} onChange={() => setAtmBasis(key)} />
                                                        {label}
                                                    </label>
                                                ))}
                                            </div>
                                        </div>

                                        <label className="mb-3 flex items-center justify-between cursor-pointer">
                                            <span className="font-semibold text-gray-600">ATM Distance</span>
                                            <input type="checkbox" checked={showAtmDistance} onChange={() => setShowAtmDistance((v) => !v)} />
                                        </label>

                                        <div className="mb-3">
                                            <div className="mb-1.5 font-semibold text-gray-600">Open Interest</div>
                                            <div className="flex gap-3">
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.oi} onChange={() => toggleColumn("oi")} /> OI
                                                </label>
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.lot} onChange={() => toggleColumn("lot")} /> Lot
                                                </label>
                                            </div>
                                        </div>

                                        <div className="mb-3">
                                            <div className="mb-1.5 font-semibold text-gray-600">Delta & IV</div>
                                            <div className="flex gap-3">
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.callDelta} onChange={() => toggleColumn("callDelta")} /> Call Delta
                                                </label>
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.putDelta} onChange={() => toggleColumn("putDelta")} /> Put Delta
                                                </label>
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.iv} onChange={() => toggleColumn("iv")} /> IV
                                                </label>
                                            </div>
                                        </div>

                                        <div className="mb-3">
                                            <div className="mb-1.5 font-semibold text-gray-600">Greeks</div>
                                            <div className="flex gap-3">
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.theta} onChange={() => toggleColumn("theta")} /> Theta
                                                </label>
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.vega} onChange={() => toggleColumn("vega")} /> Vega
                                                </label>
                                                <label className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                                    <input type="checkbox" checked={columns.gamma} onChange={() => toggleColumn("gamma")} /> Gamma
                                                </label>
                                            </div>
                                        </div>

                                        <button onClick={resetChainSettings} className="text-[11px] font-semibold text-blue-600 hover:underline">
                                            Reset to defaults
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {data && data.expiries && data.expiries.length > 0 && (
                        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                            {data.expiries.map((exp) => (
                                <button
                                    key={exp}
                                    onClick={() => load(symbol, exp)}
                                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                                        exp === data.selectedExpiry
                                            ? "bg-blue-600 text-white"
                                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                    }`}
                                >
                                    {formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {data && (
                    <div className="mb-3 flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs shadow-sm">
                        <div>
                            <span className="text-gray-400">SPOT: </span>
                            <span className="font-bold tabular-nums text-gray-900">{formatPrice(data.spotPrice)}</span>
                        </div>
                        <div className="h-4 w-px bg-gray-200" />
                        <div>
                            <span className="text-gray-400">VIX: </span>
                            <span className="font-bold tabular-nums text-gray-900">
                                {data.vix != null ? Number(data.vix).toFixed(2) : "—"}
                            </span>
                        </div>
                        <div className="h-4 w-px bg-gray-200" />
                        <div>
                            <span className="text-gray-400">
                                FUT{data.futureExpiry ? ` (${formatExpiryShort(data.futureExpiry)})` : ""}:{" "}
                            </span>
                            <span className="font-bold tabular-nums text-gray-900">
                                {data.futurePrice != null ? formatPrice(data.futurePrice) : "—"}
                            </span>
                        </div>
                    </div>
                )}

                {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
                {loading && !data && <div className="rounded-xl border border-gray-200 bg-white px-3 py-12 text-center text-xs text-gray-400">Fetching option matrix...</div>}

                {data && data.rows && (
                    <div className="relative">
                        <div className="max-h-[82vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm custom-scrollbar">
                            <table className="w-full border-collapse text-[11px]">
                                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10 shadow-[0_1px_0_0_rgba(229,231,235,1)]">
                                    <tr>
                                        {columns.theta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Theta</th>}
                                        {columns.vega && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Vega</th>}
                                        {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Gamma</th>}
                                        {columns.iv && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">IV</th>}
                                        {columns.callDelta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[13%]">Call Δ</th>}
                                        <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[15%]">LTP</th>
                                        {columns.oi && <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[18%]">OI{columns.lot ? " / Lot" : ""}</th>}
                                        <th
                                            className="py-2 text-center font-bold text-gray-700 bg-gray-100/80 w-[16%] border-x border-gray-200 cursor-pointer select-none"
                                            onClick={() => setStrikeAsc((v) => !v)}
                                            title="Sort strikes"
                                        >
                                            Strike {strikeAsc ? "↑" : "↓"}
                                        </th>
                                        {columns.oi && <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">OI{columns.lot ? " / Lot" : ""}</th>}
                                        <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">LTP</th>
                                        {columns.putDelta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Put Δ</th>}
                                        {columns.iv && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">IV</th>}
                                        {columns.gamma && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Gamma</th>}
                                        {columns.vega && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Vega</th>}
                                        {columns.theta && <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Theta</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayChainRows.map((row) => {
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
                                        return (
                                            <tr
                                                key={row.strike}
                                                ref={isAtm ? atmRowRef : null}
                                                className={`border-b border-gray-100/70 transition-colors ${isAtm ? "bg-blue-50/60 font-semibold" : "hover:bg-gray-50/80"}`}
                                            >
                                                {columns.theta && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.theta ?? "-"}</td>}
                                                {columns.vega && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.vega ?? "-"}</td>}
                                                {columns.gamma && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.gamma ?? "-"}</td>}
                                                {columns.iv && <td className="px-1.5 py-1.5 text-center tabular-nums text-gray-400">{row.ce?.iv ?? "-"}</td>}
                                                {columns.callDelta && (
                                                    <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                        {formatDelta(row.ce?.delta)}
                                                    </td>
                                                )}
                                                {/* CALL SIDE */}
                                                <td className={`group px-1.5 py-1.5 text-right tabular-nums relative ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                    {ceNet !== 0 && (
                                                        <span className={`absolute -top-0.5 right-0.5 z-[1] rounded px-1 text-[8px] font-bold leading-tight ${ceNet > 0 ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"}`}>
                                                            {ceNet > 0 ? `+${ceNet}` : ceNet}
                                                        </span>
                                                    )}
                                                    <span className="text-gray-700 group-hover:invisible">{formatPrice(row.ce?.ltp)}</span>
                                                    <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white">
                                                        {ceLeg ? (
                                                            <>
                                                                <button onClick={() => updateQty(ceLeg.id, ceLeg.qty - 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">−</button>
                                                                <span className="w-4 text-center text-[9px] font-bold tabular-nums text-gray-700">{ceLeg.qty}</span>
                                                                <button onClick={() => updateQty(ceLeg.id, ceLeg.qty + 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">+</button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => addLeg(row, "CE", "buy")} className="rounded border border-emerald-500 text-emerald-600 hover:bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold">B</button>
                                                                <button onClick={() => addLeg(row, "CE", "sell")} className="rounded border border-rose-500 text-rose-600 hover:bg-rose-50 px-1.5 py-0.5 text-[9px] font-extrabold">S</button>
                                                            </>
                                                        )}
                                                        <button onClick={() => setChartModal({ strike: row.strike, right: "CE" })} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] leading-none text-gray-500 hover:bg-gray-100" title="View contract chart">📈</button>
                                                    </div>
                                                </td>
                                                {columns.oi && (
                                                    <td className={`p-0 tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                        <OiBar value={row.ce?.oi} max={maxCeOi} side="ce" />
                                                        {columns.lot && <div className="px-1 pb-0.5 text-[9px] text-gray-400 text-right">{lots ?? "-"} lots</div>}
                                                    </td>
                                                )}

                                                {/* STRIKE PRICE */}
                                                <td className="py-1.5 text-center font-bold text-gray-900 bg-gray-50/40 border-x border-gray-100 text-xs tabular-nums">
                                                    {row.strike}
                                                    {showAtmDistance && (
                                                        <div className="text-[9px] font-normal text-gray-400">
                                                            {atmOffset === 0 ? "ATM" : `ATM${atmOffset > 0 ? "+" : ""}${atmOffset}`}
                                                        </div>
                                                    )}
                                                </td>

                                                {/* PUT SIDE */}
                                                {columns.oi && (
                                                    <td className={`p-0 tabular-nums ${peItm ? "bg-amber-50/60" : ""}`}>
                                                        <OiBar value={row.pe?.oi} max={maxPeOi} side="pe" />
                                                        {columns.lot && <div className="px-1 pb-0.5 text-[9px] text-gray-400">{putLots ?? "-"} lots</div>}
                                                    </td>
                                                )}
                                                <td className={`group px-1.5 py-1.5 text-left tabular-nums relative ${peItm ? "bg-amber-50/60" : ""}`}>
                                                    {peNet !== 0 && (
                                                        <span className={`absolute -top-0.5 left-0.5 z-[1] rounded px-1 text-[8px] font-bold leading-tight ${peNet > 0 ? "bg-blue-100 text-blue-700" : "bg-rose-100 text-rose-700"}`}>
                                                            {peNet > 0 ? `+${peNet}` : peNet}
                                                        </span>
                                                    )}
                                                    <span className="text-gray-700 group-hover:invisible">{formatPrice(row.pe?.ltp)}</span>
                                                    <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-1 bg-white">
                                                        {peLeg ? (
                                                            <>
                                                                <button onClick={() => updateQty(peLeg.id, peLeg.qty - 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">−</button>
                                                                <span className="w-4 text-center text-[9px] font-bold tabular-nums text-gray-700">{peLeg.qty}</span>
                                                                <button onClick={() => updateQty(peLeg.id, peLeg.qty + 1)} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] font-bold text-gray-600 hover:bg-gray-100">+</button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <button onClick={() => addLeg(row, "PE", "buy")} className="rounded border border-emerald-500 text-emerald-600 hover:bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold">B</button>
                                                                <button onClick={() => addLeg(row, "PE", "sell")} className="rounded border border-rose-500 text-rose-600 hover:bg-rose-50 px-1.5 py-0.5 text-[9px] font-extrabold">S</button>
                                                            </>
                                                        )}
                                                        <button onClick={() => setChartModal({ strike: row.strike, right: "PE" })} className="rounded border border-gray-300 px-1 py-0.5 text-[9px] leading-none text-gray-500 hover:bg-gray-100" title="View contract chart">📈</button>
                                                    </div>
                                                </td>
                                                {columns.putDelta && (
                                                    <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                        {formatDelta(row.pe?.delta)}
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
                            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-900/85 px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg hover:bg-gray-900"
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
                    className="fixed left-3 top-20 z-30 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-600 shadow-md hover:bg-gray-50"
                >
                    Show Option Chain
                </button>
            )}

            {/* Right Column: Analytics, Chart, Profiles */}
            <div className="flex-1 flex flex-col">
                {legs.length === 0 ? (
                    <div className="flex-1 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <PresetStrategies data={data} onApply={applyPreset} fetchExpiryRows={fetchExpiryRows} />
                    </div>
                ) : (
                    <>
                        <div className="mb-3 flex items-center justify-end gap-2">
                            <SaveButton
                                itemLabel="strategy"
                                onSave={(token, name) => saveStrategy(token, { name, underlying: symbol, legs })}
                            />
                            <button
                                onClick={() => setSavedOpen(true)}
                                className="rounded-xl border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 shadow-sm transition"
                            >
                                Saved
                            </button>
                            <button onClick={resetLegs} className="rounded-xl border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 shadow-sm transition">
                                Reset Workspace
                            </button>
                        </div>

                        {savedOpen && (
                            <SavedStrategiesModal
                                onClose={() => setSavedOpen(false)}
                                onLoad={(loadedLegs, underlying) => {
                                    if (underlying !== symbol) setSymbol(underlying);
                                    setLegs(loadedLegs.map((l) => ({ ...l, id: ++legIdCounter })));
                                    setSavedOpen(false);
                                }}
                            />
                        )}

                        <div className="mb-4 flex gap-4 items-stretch">
                            {/* StockMojo Matched Vertical Status Column */}
                            <div className="w-48 shrink-0 flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                                <Stat label="Strategy P&L" value={formatPrice(currentPnl)} tone={currentPnl == null ? undefined : currentPnl >= 0 ? "positive" : "negative"} />
                                <Stat label="Probability of Profit (POP)" value={pop != null ? `${pop.toFixed(0)}%` : "—"} hint="Normal distribution assumption breakdown strategy" />
                                <Stat label="Max Profit Potential" value={maxProfit == null ? "—" : typeof maxProfit === "number" ? formatPrice(maxProfit) : maxProfit} tone="positive" />
                                <Stat label="Max Loss Risk" value={maxLoss == null ? "—" : typeof maxLoss === "number" ? formatPrice(maxLoss) : maxLoss} tone="negative" />
                                <Stat label="Breakeven Thresholds" value={breakevens && breakevens.length ? breakevens.join(", ") : "None"} />
                                <Stat label="Workspace Constraints" value={`${legs.length} of 6 active legs`} />
                            </div>

                            <div className="flex-1 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col">
                                <div className="flex gap-1 border-b border-gray-100 bg-gray-50/50 px-3 pt-2">
                                    {[
                                        ["payoff", "Payoff"],
                                        ["strategy", "Strategy Chart"],
                                        ["underlying", "Underlying Chart"],
                                    ].map(([key, label]) => (
                                        <button
                                            key={key}
                                            onClick={() => setChartTab(key)}
                                            className={`rounded-t-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                                                chartTab === key
                                                    ? "bg-white text-blue-600 border border-b-0 border-gray-200"
                                                    : "text-gray-500 hover:text-gray-800"
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <div className="flex-1 p-4 flex flex-col justify-center">
                                    {chartTab === "payoff" && (
                                        <PayoffChart curve={curve} spotPrice={data?.spotPrice} breakevens={breakevens} expectedMove={expectedMove} />
                                    )}
                                    {chartTab === "strategy" && (
                                        <StrategyValueChart totalPnl={totalLivePnl} resetKey={legs.map((l) => l.id).join(",")} />
                                    )}
                                    {chartTab === "underlying" && <UnderlyingChart symbol={symbol} />}
                                </div>
                            </div>
                        </div>

                        {/* Interactive Position and Greeks Segment Control */}
                        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                            <div className="flex border-b border-gray-200 bg-gray-50/50 text-xs font-semibold">
                                <button
                                    onClick={() => setTab("positions")}
                                    className={`px-5 py-3 transition-colors ${tab === "positions" ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-800"}`}
                                >
                                    Active Positions ({legs.length})
                                </button>
                                <button
                                    onClick={() => setTab("greeks")}
                                    className={`px-5 py-3 transition-colors ${tab === "greeks" ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-800"}`}
                                >
                                    Portfolio Greeks
                                </button>
                            </div>

                            {tab === "positions" ? (
                                <>
                                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/40 px-4 py-2 text-[11px]">
                                        <div className="flex items-center gap-3">
                                            <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer">
                                                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} /> Select All
                                            </label>
                                            <button
                                                onClick={() => setLegsTopFirst((v) => !v)}
                                                className="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-100"
                                            >
                                                {legsTopFirst ? "Top ↓" : "Bottom ↑"}
                                            </button>
                                            <div className="flex items-center gap-1">
                                                <span className="text-gray-400">Lots:</span>
                                                <button onClick={() => bulkAdjustLots(-1)} className="rounded border border-gray-200 px-1.5 py-0.5 font-bold text-gray-600 hover:bg-gray-100">−</button>
                                                <span className="w-6 text-center font-bold tabular-nums text-gray-800">{commonLots ?? "—"}</span>
                                                <button onClick={() => bulkAdjustLots(1)} className="rounded border border-gray-200 px-1.5 py-0.5 font-bold text-gray-600 hover:bg-gray-100">+</button>
                                            </div>
                                            <div>
                                                <span className="text-gray-400">Total Qty: </span>
                                                <span className="font-bold tabular-nums text-gray-800">{totalLots}</span>
                                            </div>
                                        </div>
                                        <div>
                                            <span className="text-gray-400">Total P&L: </span>
                                            <span className={`font-bold tabular-nums ${totalLivePnl != null && totalLivePnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                {totalLivePnl != null ? formatPrice(totalLivePnl) : "-"}
                                            </span>
                                            {totalLivePnl != null && (
                                                <span className="ml-1 text-gray-400" title="vs. total premium across all legs">
                                                    ({(() => {
                                                        const exposure = legs.reduce((s, l) => s + Math.abs(l.premium * l.qty), 0);
                                                        return exposure > 0 ? `${((totalLivePnl / exposure) * 100).toFixed(1)}%` : "—";
                                                    })()})
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <table className="w-full border-collapse text-xs">
                                        <thead>
                                            <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-100">
                                                <th className="px-2 py-2.5 w-8"></th>
                                                <th className="px-4 py-2.5 text-left font-medium">Action</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Lots</th>
                                                <th className="px-4 py-2.5 text-left font-medium">Expiry</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Strike</th>
                                                <th className="px-4 py-2.5 text-left font-medium">Type</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Entry Price</th>
                                                <th className="px-4 py-2.5 text-right font-medium">LTP</th>
                                                <th className="px-4 py-2.5 text-right font-medium">Live P&L</th>
                                                <th className="px-4 py-2.5 text-center font-medium">SL/TG</th>
                                                <th className="px-4 py-2.5 text-center font-medium">Exit</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {orderedLegs.map((leg) => {
                                                const row = rowByStrike.get(leg.strike);
                                                const currentLtp = row ? (leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp) : null;
                                                const livePnl = legLivePnl(leg);
                                                return (
                                                    <tr key={leg.id} className="hover:bg-gray-50/40 transition-colors">
                                                        <td className="px-2 py-2.5 text-center">
                                                            <input type="checkbox" checked={selectedLegIds.has(leg.id)} onChange={() => toggleLegSelected(leg.id)} />
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold text-white shadow-sm ${leg.action === "buy" ? "bg-emerald-500" : "bg-rose-500"}`}>
                                                                {leg.action === "buy" ? "B" : "S"}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right">
                                                            <input
                                                                type="number"
                                                                min={1}
                                                                value={leg.qty}
                                                                onChange={(e) => updateQty(leg.id, Number(e.target.value))}
                                                                className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-right font-medium text-gray-800 focus:border-blue-500 outline-none"
                                                            />
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            <select
                                                                value={leg.expiry || ""}
                                                                onChange={(e) => rollLegExpiry(leg.id, e.target.value)}
                                                                className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[11px] font-medium text-gray-700 outline-none focus:border-blue-500"
                                                            >
                                                                {(data?.expiries || [leg.expiry]).map((exp) => (
                                                                    <option key={exp} value={exp}>{formatExpiryShort(exp)} ({daysUntilExpiry(exp)}d)</option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <button onClick={() => rollLegStrike(leg.id, -1)} className="rounded border border-gray-200 px-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100" title="Roll to lower strike">−</button>
                                                                <span className="font-bold tabular-nums text-gray-900">{leg.strike}</span>
                                                                <button onClick={() => rollLegStrike(leg.id, 1)} className="rounded border border-gray-200 px-1 text-[10px] font-bold text-gray-500 hover:bg-gray-100" title="Roll to higher strike">+</button>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${leg.type === "CE" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}>
                                                                {leg.type}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{formatPrice(leg.premium)}</td>
                                                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{currentLtp != null ? formatPrice(currentLtp) : "-"}</td>
                                                        <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${livePnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                            {livePnl != null ? formatPrice(livePnl) : "-"}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-center relative">
                                                            <button
                                                                onClick={() => setSlTgEditId(slTgEditId === leg.id ? null : leg.id)}
                                                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                                                                title={leg.slPercent != null || leg.tgPercent != null ? `SL ${leg.slPercent ?? "—"}% / TG ${leg.tgPercent ?? "—"}%` : "Set SL/TG"}
                                                            >
                                                                ⚙
                                                            </button>
                                                            {(leg.slPercent != null || leg.tgPercent != null) && (
                                                                <div className="text-[9px] text-gray-400">SL {leg.slPercent ?? "—"}% / TG {leg.tgPercent ?? "—"}%</div>
                                                            )}
                                                            {slTgEditId === leg.id && (
                                                                <>
                                                                    <div className="fixed inset-0 z-10" onClick={() => setSlTgEditId(null)} />
                                                                    <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-xl">
                                                                        <div className="mb-2 text-[10px] text-gray-400">
                                                                            Planning note only — not auto-executed here. Use Backtest for SL%/target%-driven exits.
                                                                        </div>
                                                                        <label className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                                                                            SL %
                                                                            <input
                                                                                type="number"
                                                                                defaultValue={leg.slPercent ?? ""}
                                                                                onBlur={(e) => setLegSlTg(leg.id, e.target.value, leg.tgPercent ?? "")}
                                                                                className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right outline-none focus:border-blue-500"
                                                                            />
                                                                        </label>
                                                                        <label className="flex items-center justify-between gap-2 text-[11px]">
                                                                            TG %
                                                                            <input
                                                                                type="number"
                                                                                defaultValue={leg.tgPercent ?? ""}
                                                                                onBlur={(e) => setLegSlTg(leg.id, leg.slPercent ?? "", e.target.value)}
                                                                                className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right outline-none focus:border-blue-500"
                                                                            />
                                                                        </label>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2.5">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button onClick={() => resetLegEntryToLtp(leg.id)} className="text-gray-400 hover:text-blue-600 transition" title="Reset entry to current LTP">⟳</button>
                                                                <button onClick={() => removeLeg(leg.id)} className="text-gray-400 hover:text-rose-600 font-bold transition" title="Remove leg">✕</button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </>
                            ) : (
                                <table className="w-full border-collapse text-xs">
                                    <thead>
                                        <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-100">
                                            <th className="px-4 py-2.5 text-left font-medium">Leg Matrix</th>
                                            <th className="px-4 py-2.5 text-right font-medium">IV %</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Delta</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Gamma</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Theta</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Vega</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {legs.map((leg) => (
                                            <tr key={leg.id} className="hover:bg-gray-50/40 transition-colors">
                                                <td className="px-4 py-2.5 font-medium text-gray-700">{leg.action === "buy" ? "B" : "S"} {leg.strike} {leg.type}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.iv ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.delta ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.gamma ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.theta ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.vega ?? "-"}</td>
                                            </tr>
                                        ))}
                                        {netGreeks && (
                                            <tr className="font-bold bg-blue-50/30 border-t-2 border-gray-200 text-gray-900">
                                                <td className="px-4 py-3">Net Risk Aggregates</td>
                                                <td className="px-4 py-3"></td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.delta || 0).toFixed(3)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.gamma || 0).toFixed(6)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.theta || 0).toFixed(3)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.vega || 0).toFixed(3)}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>

            {chartModal && (
                <ContractChartModal
                    symbol={symbol}
                    strike={chartModal.strike}
                    right={chartModal.right}
                    expiry={data?.selectedExpiry}
                    onClose={() => setChartModal(null)}
                />
            )}
        </div>
    );
}