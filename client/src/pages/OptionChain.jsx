import React from "react";
// pages/OptionChain.jsx — Premier StockMojo-parity Real-Time Option Chain Matrix
// Responsive on Desktop, Tablet, and Mobile with ATM strike filtering, Greeks,
// visual OI bars, heatmaps, candlestick contract charts, and mobile tabbed views.

import { useMemo, useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useOptionChain } from "../hooks/useOptionChain";
import { formatPrice, formatPercent, formatOi } from "../utils/format";
import { fetchSymbolList } from "../services/optionChainApi";
import ContractChartModal from "../components/ContractChartModal";
import OiBar from "../components/OiBar";
import OptionChainSettingsDrawer from "../components/OptionChainSettingsDrawer";
import PremiumFeaturesModal from "../components/PremiumFeaturesModal";
import { FiSettings, FiSearch, FiCheck, FiChevronDown, FiBarChart2 } from "react-icons/fi";
import { TbReload } from "react-icons/tb";
import { IoIosArrowBack, IoIosArrowForward } from "react-icons/io";

const FALLBACK_SYMBOLS = { indices: ["NIFTY", "BANKNIFTY", "FINNIFTY"], stocks: [], liveSymbols: ["NIFTY", "BANKNIFTY", "FINNIFTY"] };

const STRIKE_RANGES = [
    { label: "±10", value: 10 },
    { label: "±20", value: 20 },
    { label: "±30", value: 30 },
    { label: "±50", value: 50 },
    { label: "All", value: null },
];

function formatGreek(value, decimals = 2) {
    if (value == null || isNaN(value)) return "-";
    return Number(value).toFixed(decimals);
}

function formatRatio(volume, oi) {
    if (!oi) return "-";
    return ((volume || 0) / oi).toFixed(2);
}

const MIN_RATIO_BASE = 10;
function formatStrikeRatio(numerator, denominator) {
    if (!denominator || denominator < MIN_RATIO_BASE) return "-";
    return (numerator / denominator).toFixed(2);
}

function ValueWithChange({ value, change, formatValue = formatPrice, align = "right" }) {
    return (
        <div className={`flex flex-col ${align === "right" ? "items-end" : align === "left" ? "items-start" : "items-center"} leading-tight`}>
            <span className="tabular-nums font-bold text-gray-900">{formatValue(value)}</span>
            <span className={`text-[10px] tabular-nums font-semibold ${change >= 0 ? "text-emerald-600" : change < 0 ? "text-rose-600" : "text-gray-400"}`}>
                {change != null ? `${change >= 0 ? "+" : ""}${formatPercent(change)}` : "-"}
            </span>
        </div>
    );
}

function heatStyle(value, maxAbs) {
    if (value == null || !maxAbs) return {};
    const intensity = Math.min(1, Math.abs(value) / maxAbs);
    if (intensity < 0.05) return {};
    const alpha = 0.12 + intensity * 0.45;
    const color = value >= 0 ? `rgba(16,185,129,${alpha.toFixed(2)})` : `rgba(244,63,94,${alpha.toFixed(2)})`;
    return { backgroundColor: color };
}

const PRESET_CONFIGS = {
    standard: {
        ltpChangePercent: true,
        oi: true,
        oiChangePercent: true,
        oiChange: true,
        pcr: false,
        volume: true,
        volOi: false,
        pcrVol: false,
        iv: true,
        delta: true,
        gamma: false,
        theta: false,
        vega: false,
    },
    greeks: {
        ltpChangePercent: false,
        oi: true,
        oiChangePercent: false,
        oiChange: false,
        pcr: false,
        volume: false,
        volOi: false,
        pcrVol: false,
        iv: true,
        delta: true,
        gamma: true,
        theta: true,
        vega: true,
    },
    volumeOi: {
        ltpChangePercent: true,
        oi: true,
        oiChangePercent: true,
        oiChange: true,
        pcr: true,
        volume: true,
        volOi: true,
        pcrVol: true,
        iv: true,
        delta: false,
        gamma: false,
        theta: false,
        vega: false,
    },
    compact: {
        ltpChangePercent: true,
        oi: true,
        oiChangePercent: false,
        oiChange: false,
        pcr: false,
        volume: true,
        volOi: false,
        pcrVol: false,
        iv: true,
        delta: false,
        gamma: false,
        theta: false,
        vega: false,
    },
};

export default function OptionChain() {
    const { symbol: urlSymbol } = useParams();
    const navigate = useNavigate();

    const {
        symbol,
        data,
        loading,
        error,
        isLive,
        lastUpdated,
        setSymbol,
        load,
        refresh,
    } = useOptionChain(urlSymbol ? urlSymbol.toUpperCase() : "NIFTY");

    const [expiryFilter, setExpiryFilter] = useState(null);
    const [chartTarget, setChartTarget] = useState(null);
    const [symbolList, setSymbolList] = useState(FALLBACK_SYMBOLS);
    const tableContainerRef = useRef(null);
    const atmRowRef = useRef(null);

    // Symbol dropdown picker state
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");

    // Settings drawer & columns state
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [columns, setColumns] = useState(PRESET_CONFIGS.standard);
    const [activePreset, setActivePreset] = useState("standard");
    const [atmBasis, setAtmBasis] = useState("spot");
    const [strikesAroundAtm, setStrikesAroundAtm] = useState(20);

    // Mobile view mode: 'both' | 'calls' | 'puts'
    const [mobileSideView, setMobileSideView] = useState("both");

    const [premiumModalOpen, setPremiumModalOpen] = useState(false);

    function toggleColumn(key) {
        setColumns((prev) => ({ ...prev, [key]: !prev[key] }));
        setActivePreset("custom");
    }

    function applyPreset(presetName) {
        setActivePreset(presetName);
        if (PRESET_CONFIGS[presetName]) {
            setColumns(PRESET_CONFIGS[presetName]);
        }
    }

    useEffect(() => {
        let cancelled = false;
        fetchSymbolList()
            .then((list) => {
                if (!cancelled) setSymbolList(list);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (symbol && symbol.toLowerCase() !== urlSymbol) {
            navigate(`/option-chain/${symbol.toLowerCase()}`);
        }
    }, [symbol, urlSymbol, navigate]);

    const allSymbols = useMemo(
        () => [...symbolList.indices, ...symbolList.stocks],
        [symbolList]
    );
    const filteredIndices = useMemo(
        () => symbolList.indices.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );
    const filteredStocks = useMemo(
        () => symbolList.stocks.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );

    function cycleSymbol(dir) {
        if (allSymbols.length < 2) return;
        const idx = allSymbols.indexOf(symbol);
        const base = idx >= 0 ? idx : 0;
        setSymbol(allSymbols[(base + dir + allSymbols.length) % allSymbols.length]);
    }

    function pickSymbol(sym) {
        setSymbol(sym);
        setPickerOpen(false);
        setPickerQuery("");
    }

    const effectiveAtmPrice = useMemo(() => {
        if (!data) return null;
        if (atmBasis === "future") return data.futurePrice ?? data.spotPrice;
        if (atmBasis === "synth") {
            const atmRow = data.rows?.find((r) => r.strike === data.atmStrike);
            const synth =
                atmRow && atmRow.ce?.ltp != null && atmRow.pe?.ltp != null
                    ? data.atmStrike + atmRow.ce.ltp - atmRow.pe.ltp
                    : null;
            return synth ?? data.spotPrice;
        }
        return data.spotPrice;
    }, [atmBasis, data]);

    const effectiveAtmStrike = useMemo(() => {
        if (!data?.rows?.length || effectiveAtmPrice == null) return data?.atmStrike ?? null;
        return data.rows.reduce((best, r) =>
            Math.abs(r.strike - effectiveAtmPrice) < Math.abs(best.strike - effectiveAtmPrice) ? r : best
        ).strike;
    }, [data, effectiveAtmPrice]);

    const displayRows = useMemo(() => {
        if (!data?.rows) return [];
        if (strikesAroundAtm == null || effectiveAtmStrike == null) return data.rows;
        const idx = data.rows.findIndex((r) => r.strike === effectiveAtmStrike);
        if (idx < 0) return data.rows;
        return data.rows.slice(Math.max(0, idx - strikesAroundAtm), idx + strikesAroundAtm + 1);
    }, [data, strikesAroundAtm, effectiveAtmStrike]);

    function scrollToAtm() {
        atmRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const totals = useMemo(() => {
        if (!displayRows.length) return null;
        const spot = data?.spotPrice || 0;

        let ceItmOi = 0, ceItmVol = 0, ceOtmOi = 0, ceOtmVol = 0;
        let peItmOi = 0, peItmVol = 0, peOtmOi = 0, peOtmVol = 0;

        displayRows.forEach((r) => {
            if (r.strike < spot) {
                ceItmOi += r.ce.oi || 0;
                ceItmVol += r.ce.volume || 0;
                peOtmOi += r.pe.oi || 0;
                peOtmVol += r.pe.volume || 0;
            } else {
                ceOtmOi += r.ce.oi || 0;
                ceOtmVol += r.ce.volume || 0;
                peItmOi += r.pe.oi || 0;
                peItmVol += r.pe.volume || 0;
            }
        });

        const totalCeOi = ceItmOi + ceOtmOi;
        const totalPeOi = peItmOi + peOtmOi;
        const totalCeVol = ceItmVol + ceOtmVol;
        const totalPeVol = peItmVol + peOtmVol;
        const totalOiAll = totalCeOi + totalPeOi;
        const ceOiPercent = totalOiAll > 0 ? (totalCeOi / totalOiAll) * 100 : 50;
        const peOiPercent = totalOiAll > 0 ? (totalPeOi / totalOiAll) * 100 : 50;

        return {
            ceItm: { oi: ceItmOi, vol: ceItmVol },
            ceOtm: { oi: ceOtmOi, vol: ceOtmVol },
            peItm: { oi: peItmOi, vol: peItmVol },
            peOtm: { oi: peOtmOi, vol: peOtmVol },
            totalCeOi,
            totalPeOi,
            totalCeVol,
            totalPeVol,
            ceOiPercent,
            peOiPercent,
        };
    }, [displayRows, data]);

    const scale = useMemo(() => {
        if (!displayRows.length) return { maxOi: 0, maxVolume: 0, maxOiChange: 0 };
        let maxOi = 0, maxVolume = 0, maxOiChange = 0;
        displayRows.forEach((r) => {
            maxOi = Math.max(maxOi, r.ce.oi || 0, r.pe.oi || 0);
            maxVolume = Math.max(maxVolume, r.ce.volume || 0, r.pe.volume || 0);
            maxOiChange = Math.max(maxOiChange, Math.abs(r.ce.oiChange || 0), Math.abs(r.pe.oiChange || 0));
        });
        return { maxOi, maxVolume, maxOiChange };
    }, [displayRows]);

    const ceColCount =
        1 /* LTP */ +
        (columns.delta ? 1 : 0) +
        (columns.volOi ? 1 : 0) +
        (columns.volume ? 1 : 0) +
        (columns.oiChangePercent ? 1 : 0) +
        (columns.oiChange ? 1 : 0) +
        (columns.oi ? 1 : 0) +
        (columns.theta ? 1 : 0) +
        (columns.vega ? 1 : 0) +
        (columns.gamma ? 1 : 0);

    const midColCount =
        1 /* Strike */ + (columns.iv ? 1 : 0) + (columns.pcr ? 1 : 0) + (columns.pcrVol ? 1 : 0);

    const peColCount =
        1 /* LTP */ +
        (columns.oi ? 1 : 0) +
        (columns.oiChange ? 1 : 0) +
        (columns.oiChangePercent ? 1 : 0) +
        (columns.volume ? 1 : 0) +
        (columns.volOi ? 1 : 0) +
        (columns.theta ? 1 : 0) +
        (columns.vega ? 1 : 0) +
        (columns.gamma ? 1 : 0) +
        (columns.delta ? 1 : 0);

    const handleExpiryChange = (e) => {
        const expiry = e.target.value;
        setExpiryFilter(expiry);
        load(symbol, expiry);
    };

    const handleSelectExpiryTab = (exp) => {
        setExpiryFilter(exp);
        load(symbol, exp);
    };

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900 pb-16">
            <div className="mx-auto max-w-[1750px] px-2 py-3 sm:px-4 space-y-3">
                {/* 1. TOP RESPONSIVE HEADER BAR & CONTROL PANEL */}
                <div className="rounded-2xl border border-gray-200 bg-white p-3 sm:p-4 shadow-xs space-y-3">
                    {/* Row 1: Symbol Switcher, Spot Quote, Refresh & Settings */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        {/* Left: Quick Symbol Selector */}
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Quick Index Pills */}
                            <div className="flex items-center gap-1">
                                {["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"].map((idxSym) => (
                                    <button
                                        key={idxSym}
                                        onClick={() => pickSymbol(idxSym)}
                                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                            symbol === idxSym
                                                ? "bg-emerald-600 text-white shadow-xs"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                        }`}
                                    >
                                        {idxSym}
                                    </button>
                                ))}
                            </div>

                            {/* Dropdown for All 200+ F&O Stocks */}
                            <div className="relative">
                                <div className="flex items-center rounded-lg border border-gray-200 bg-white p-0.5 shadow-xs">
                                    <button
                                        onClick={() => cycleSymbol(-1)}
                                        disabled={allSymbols.length < 2}
                                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                                        aria-label="Previous symbol"
                                    >
                                        <IoIosArrowBack size={16} />
                                    </button>

                                    <button
                                        onClick={() => setPickerOpen((v) => !v)}
                                        className="flex items-center gap-1.5 px-2 py-0.5 text-xs font-extrabold text-gray-900 hover:bg-gray-50"
                                    >
                                        <span>{symbol}</span>
                                        <FiChevronDown
                                            size={13}
                                            className={`text-gray-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`}
                                        />
                                    </button>

                                    <button
                                        onClick={() => cycleSymbol(1)}
                                        disabled={allSymbols.length < 2}
                                        className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                                        aria-label="Next symbol"
                                    >
                                        <IoIosArrowForward size={16} />
                                    </button>
                                </div>

                                {pickerOpen && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                                        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-96 w-72 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl text-xs">
                                            <div className="sticky top-0 border-b border-gray-100 bg-white p-2">
                                                <div className="relative">
                                                    <FiSearch
                                                        size={14}
                                                        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                                                    />
                                                    <input
                                                        autoFocus
                                                        value={pickerQuery}
                                                        onChange={(e) => setPickerQuery(e.target.value)}
                                                        placeholder="Search index or stock…"
                                                        className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-2 text-xs text-gray-900 outline-none focus:border-emerald-500 focus:bg-white"
                                                    />
                                                </div>
                                            </div>

                                            {filteredIndices.length > 0 && (
                                                <div className="py-1">
                                                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                                        Indices
                                                    </div>
                                                    {filteredIndices.map((s) => (
                                                        <button
                                                            key={s}
                                                            onClick={() => pickSymbol(s)}
                                                            className={`flex w-full items-center justify-between px-3 py-1.5 text-left font-medium hover:bg-gray-50 ${
                                                                s === symbol ? "bg-emerald-50 text-emerald-700 font-bold" : "text-gray-800"
                                                            }`}
                                                        >
                                                            <span className="flex items-center gap-1.5">
                                                                {s}
                                                                {symbolList.liveSymbols.includes(s) ? (
                                                                    <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700">
                                                                        LIVE
                                                                    </span>
                                                                ) : (
                                                                    <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[9px] text-gray-400">
                                                                        Historical
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {s === symbol && <FiCheck size={14} className="text-emerald-600" />}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}

                                            {filteredStocks.length > 0 && (
                                                <div className="border-t border-gray-100 py-1">
                                                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                                        F&O Stocks
                                                    </div>
                                                    {filteredStocks.map((s) => (
                                                        <button
                                                            key={s}
                                                            onClick={() => pickSymbol(s)}
                                                            className={`flex w-full items-center justify-between px-3 py-1.5 text-left font-medium hover:bg-gray-50 ${
                                                                s === symbol ? "bg-emerald-50 text-emerald-700 font-bold" : "text-gray-800"
                                                            }`}
                                                        >
                                                            <span>{s}</span>
                                                            {s === symbol && <FiCheck size={14} className="text-emerald-600" />}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Right: Live Spot & Action controls */}
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            {data && (
                                <div className="flex items-baseline gap-2 rounded-xl bg-gray-50 px-3 py-1 border border-gray-200">
                                    <span className="text-xs text-gray-400">SPOT</span>
                                    <span className="text-sm sm:text-base font-black tabular-nums text-gray-900">
                                        {formatPrice(data.spotPrice)}
                                    </span>
                                    {data.spotChange != null && (
                                        <span
                                            className={`text-xs font-bold tabular-nums ${
                                                data.spotChange >= 0 ? "text-emerald-600" : "text-rose-600"
                                            }`}
                                        >
                                            {data.spotChange >= 0 ? "▲" : "▼"} {formatPrice(Math.abs(data.spotChange))} (
                                            {formatPercent(data.spotChangePercent)})
                                        </span>
                                    )}
                                    {isLive && (
                                        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            LIVE
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Refresh Button & timestamp */}
                            <button
                                onClick={refresh}
                                disabled={loading}
                                className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 shadow-xs hover:bg-gray-50 disabled:opacity-50"
                                title={lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleTimeString()}` : "Refresh"}
                            >
                                <TbReload size={14} className={loading ? "animate-spin text-emerald-600" : "text-gray-500"} />
                                <span className="hidden sm:inline">{loading ? "Updating…" : "Refresh"}</span>
                                {lastUpdated && !loading && (
                                    <span className="text-[10px] text-gray-400 font-normal hidden lg:inline">
                                        {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                    </span>
                                )}
                            </button>

                            {/* Settings Gear */}
                            <button
                                onClick={() => setSettingsOpen(true)}
                                className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-2 text-gray-600 shadow-xs hover:bg-gray-50"
                                title="Custom Table Columns & ATM Settings"
                            >
                                <FiSettings size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Row 2: Expiries Tabs + ATM Strike Filter Pills + View Preset Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
                        {/* Expiry Selector Pills */}
                        <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-full scrollbar-none">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1 hidden md:inline">
                                Expiry:
                            </span>
                            {data?.expiries?.slice(0, 8).map((exp) => (
                                <button
                                    key={exp}
                                    onClick={() => handleSelectExpiryTab(exp)}
                                    className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                        exp === (data?.selectedExpiry || expiryFilter)
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                                >
                                    {exp}
                                </button>
                            ))}
                            {data?.expiries && data.expiries.length > 8 && (
                                <select
                                    value={data?.selectedExpiry || expiryFilter || ""}
                                    onChange={handleExpiryChange}
                                    className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-700 outline-none"
                                >
                                    {data.expiries.slice(8).map((exp) => (
                                        <option key={exp} value={exp}>
                                            {exp}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Strikes Around ATM Filter */}
                        <div className="flex items-center gap-1">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1 hidden sm:inline">
                                Strikes:
                            </span>
                            {STRIKE_RANGES.map((rng) => (
                                <button
                                    key={rng.label}
                                    onClick={() => setStrikesAroundAtm(rng.value)}
                                    className={`rounded-lg px-2 py-0.5 text-xs font-bold transition-all ${
                                        strikesAroundAtm === rng.value
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                                >
                                    {rng.label}
                                </button>
                            ))}
                        </div>

                        {/* Column Presets (Standard / Greeks / Volume / Compact) */}
                        <div className="hidden lg:flex items-center gap-1 rounded-xl bg-gray-100 p-0.5">
                            {[
                                ["standard", "Standard"],
                                ["greeks", "Greeks"],
                                ["volumeOi", "Vol & OI"],
                                ["compact", "LTP Only"],
                            ].map(([pKey, pLabel]) => (
                                <button
                                    key={pKey}
                                    onClick={() => applyPreset(pKey)}
                                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                                        activePreset === pKey
                                            ? "bg-white text-gray-900 font-bold shadow-xs"
                                            : "text-gray-600 hover:text-gray-900"
                                    }`}
                                >
                                    {pLabel}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 2. DERIVATIVES MARKET METRICS & SENTIMENT STRIP */}
                {data && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                        {/* Spot Price */}
                        <div className="rounded-xl border border-gray-200 bg-white p-2.5 text-center shadow-xs">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Spot Price</div>
                            <div className="text-sm font-black tabular-nums text-gray-900">{formatPrice(data.spotPrice)}</div>
                        </div>

                        {/* Future Price */}
                        <div className="rounded-xl border border-gray-200 bg-white p-2.5 text-center shadow-xs">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Future Price</div>
                            <div className="text-sm font-black tabular-nums text-gray-900">
                                {data.futurePrice != null ? formatPrice(data.futurePrice) : "—"}
                            </div>
                        </div>

                        {/* India VIX */}
                        <div className="rounded-xl border border-gray-200 bg-white p-2.5 text-center shadow-xs">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">India VIX</div>
                            <div className="text-sm font-black tabular-nums text-gray-900">
                                {data.vix != null ? Number(data.vix).toFixed(2) : "—"}
                            </div>
                        </div>

                        {/* Max Pain */}
                        <div className="rounded-xl border border-gray-200 bg-white p-2.5 text-center shadow-xs">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Max Pain</div>
                            <div className="text-sm font-black tabular-nums text-amber-700">{data.maxPainStrike ?? "—"}</div>
                        </div>

                        {/* Put Call Ratio (PCR) */}
                        <div className="rounded-xl border border-gray-200 bg-white p-2.5 text-center shadow-xs">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">PCR (OI)</div>
                            <div className="flex items-center justify-center gap-1">
                                <span
                                    className={`text-sm font-black tabular-nums ${
                                        data.pcr >= 1 ? "text-emerald-600" : "text-rose-600"
                                    }`}
                                >
                                    {data.pcr ?? "—"}
                                </span>
                                {data.pcr != null && (
                                    <span
                                        className={`rounded px-1 py-0.2 text-[9px] font-bold uppercase ${
                                            data.pcr >= 1.2
                                                ? "bg-emerald-100 text-emerald-800"
                                                : data.pcr <= 0.8
                                                ? "bg-rose-100 text-rose-800"
                                                : "bg-gray-100 text-gray-700"
                                        }`}
                                    >
                                        {data.pcr >= 1.2 ? "Bullish" : data.pcr <= 0.8 ? "Bearish" : "Neutral"}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Total Open Interest Sentiment Bar */}
                        {totals && (
                            <div className="col-span-2 sm:col-span-1 md:col-span-1 rounded-xl border border-gray-200 bg-white p-2.5 text-center shadow-xs flex flex-col justify-between">
                                <div className="flex justify-between text-[10px] font-bold">
                                    <span className="text-emerald-700">CE: {formatOi(totals.totalCeOi)}</span>
                                    <span className="text-rose-700">PE: {formatOi(totals.totalPeOi)}</span>
                                </div>
                                <div className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-gray-200">
                                    <div
                                        className="bg-emerald-500 transition-all"
                                        style={{ width: `${totals.ceOiPercent}%` }}
                                        title={`Call OI: ${totals.ceOiPercent.toFixed(1)}%`}
                                    />
                                    <div
                                        className="bg-rose-500 transition-all"
                                        style={{ width: `${totals.peOiPercent}%` }}
                                        title={`Put OI: ${totals.peOiPercent.toFixed(1)}%`}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Mobile Side Selector Pill (Both / Calls / Puts) */}
                <div className="flex md:hidden items-center justify-between rounded-xl border border-gray-200 bg-white p-1 shadow-xs">
                    {[
                        ["both", "Split (Calls & Puts)"],
                        ["calls", "Calls (CE) Only"],
                        ["puts", "Puts (PE) Only"],
                    ].map(([sKey, sLabel]) => (
                        <button
                            key={sKey}
                            onClick={() => setMobileSideView(sKey)}
                            className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${
                                mobileSideView === sKey
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "text-gray-600 hover:text-gray-900"
                            }`}
                        >
                            {sLabel}
                        </button>
                    ))}
                </div>

                {error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
                        ⚠️ {error}
                    </div>
                )}

                {/* 3. MAIN OPTION CHAIN MATRIX TABLE */}
                {data && data.rows ? (
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden">
                        <div className="overflow-x-auto max-h-[700px]" ref={tableContainerRef}>
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="sticky top-0 z-20 bg-white shadow-xs">
                                    {/* Top Grouping Header */}
                                    <tr className="border-b border-gray-200 text-xs font-black">
                                        {(mobileSideView === "both" || mobileSideView === "calls") && (
                                            <th
                                                colSpan={ceColCount}
                                                className="bg-emerald-50 text-emerald-800 text-center py-2.5 border-r border-gray-200"
                                            >
                                                CALLS (CE)
                                            </th>
                                        )}
                                        <th
                                            colSpan={midColCount}
                                            className="bg-gray-100 text-gray-900 text-center py-2.5 border-r border-gray-200"
                                        >
                                            STRIKE
                                        </th>
                                        {(mobileSideView === "both" || mobileSideView === "puts") && (
                                            <th
                                                colSpan={peColCount}
                                                className="bg-rose-50 text-rose-800 text-center py-2.5"
                                            >
                                                PUTS (PE)
                                            </th>
                                        )}
                                    </tr>

                                    {/* Sub Column Headers */}
                                    <tr className="border-b border-gray-200 bg-gray-50/90 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                                        {/* CALL SIDE HEADERS */}
                                        {(mobileSideView === "both" || mobileSideView === "calls") && (
                                            <>
                                                {columns.theta && <th className="px-2 py-2 text-right">Theta</th>}
                                                {columns.vega && <th className="px-2 py-2 text-right">Vega</th>}
                                                {columns.gamma && <th className="px-2 py-2 text-right">Gamma</th>}
                                                {columns.delta && <th className="px-2 py-2 text-right">Delta</th>}
                                                {columns.volOi && <th className="px-2 py-2 text-right">Vol/OI</th>}
                                                {columns.volume && <th className="px-2 py-2 text-right">Volume</th>}
                                                {columns.oiChangePercent && <th className="px-2 py-2 text-right">OI Chg%</th>}
                                                {columns.oiChange && <th className="px-2 py-2 text-right">OI Chg</th>}
                                                {columns.oi && <th className="px-2 py-2 text-right">OI</th>}
                                                <th className="px-3 py-2 text-right font-black text-emerald-700 bg-emerald-50/40">
                                                    Call LTP
                                                </th>
                                            </>
                                        )}

                                        {/* CENTER STRIKE & PCR HEADERS */}
                                        <th className="px-3 py-2 text-center font-black text-gray-900 bg-gray-100 border-x border-gray-200">
                                            Strike
                                        </th>
                                        {columns.iv && <th className="px-2 py-2 text-right bg-gray-50 text-gray-600">IV</th>}
                                        {columns.pcr && <th className="px-2 py-2 text-right bg-gray-50 text-gray-600">PCR</th>}
                                        {columns.pcrVol && (
                                            <th className="px-2 py-2 text-right bg-gray-50 text-gray-600">PCR(Vol)</th>
                                        )}

                                        {/* PUT SIDE HEADERS */}
                                        {(mobileSideView === "both" || mobileSideView === "puts") && (
                                            <>
                                                <th className="px-3 py-2 text-left font-black text-rose-700 bg-rose-50/40">
                                                    Put LTP
                                                </th>
                                                {columns.oi && <th className="px-2 py-2 text-left">OI</th>}
                                                {columns.oiChange && <th className="px-2 py-2 text-left">OI Chg</th>}
                                                {columns.oiChangePercent && <th className="px-2 py-2 text-left">OI Chg%</th>}
                                                {columns.volume && <th className="px-2 py-2 text-left">Volume</th>}
                                                {columns.volOi && <th className="px-2 py-2 text-left">Vol/OI</th>}
                                                {columns.theta && <th className="px-2 py-2 text-left">Theta</th>}
                                                {columns.vega && <th className="px-2 py-2 text-left">Vega</th>}
                                                {columns.gamma && <th className="px-2 py-2 text-left">Gamma</th>}
                                                {columns.delta && <th className="px-2 py-2 text-left">Delta</th>}
                                            </>
                                        )}
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-gray-100">
                                    {displayRows.map((row) => {
                                        const ceItm = row.strike < data.spotPrice;
                                        const peItm = row.strike > data.spotPrice;
                                        const isMaxPain = row.strike === data.maxPainStrike;
                                        const isAtm = row.strike === effectiveAtmStrike;

                                        return (
                                            <tr
                                                key={row.strike}
                                                ref={isAtm ? atmRowRef : null}
                                                className={`transition-colors font-medium ${
                                                    isAtm
                                                        ? "bg-amber-50/90 font-bold ring-2 ring-inset ring-amber-400"
                                                        : "hover:bg-gray-50"
                                                }`}
                                            >
                                                {/* CALL SIDE CELLS */}
                                                {(mobileSideView === "both" || mobileSideView === "calls") && (
                                                    <>
                                                        {columns.theta && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums text-gray-400 ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.ce.theta)}
                                                            </td>
                                                        )}
                                                        {columns.vega && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums text-gray-400 ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.ce.vega)}
                                                            </td>
                                                        )}
                                                        {columns.gamma && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums text-gray-400 ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.ce.gamma, 4)}
                                                            </td>
                                                        )}
                                                        {columns.delta && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums font-mono text-gray-700 ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.ce.delta)}
                                                            </td>
                                                        )}
                                                        {columns.volOi && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums text-gray-500 ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatRatio(row.ce.volume, row.ce.oi)}
                                                            </td>
                                                        )}
                                                        {columns.volume && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums text-gray-600 ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                                style={heatStyle(row.ce.volume, scale.maxVolume)}
                                                            >
                                                                {formatOi(row.ce.volume)}
                                                            </td>
                                                        )}
                                                        {columns.oiChangePercent && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                } ${
                                                                    row.ce.oiChangePercent >= 0
                                                                        ? "text-emerald-600"
                                                                        : "text-rose-600"
                                                                }`}
                                                            >
                                                                {row.ce.oiChangePercent != null
                                                                    ? formatPercent(row.ce.oiChangePercent)
                                                                    : "-"}
                                                            </td>
                                                        )}
                                                        {columns.oiChange && (
                                                            <td
                                                                className={`px-2 py-1.5 text-right tabular-nums font-semibold ${
                                                                    ceItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                                style={heatStyle(row.ce.oiChange, scale.maxOiChange)}
                                                            >
                                                                {row.ce.oiChange != null ? formatOi(row.ce.oiChange) : "-"}
                                                            </td>
                                                        )}
                                                        {columns.oi && (
                                                            <td className={`px-2 py-1.5 ${ceItm ? "bg-amber-50/50" : ""}`}>
                                                                <OiBar value={row.ce.oi} max={scale.maxOi} side="ce" />
                                                            </td>
                                                        )}

                                                        {/* Call LTP Cell with Chart trigger */}
                                                        <td className={`px-3 py-1.5 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                            <div className="flex items-center justify-end gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setChartTarget({ strike: row.strike, right: "CE" })
                                                                    }
                                                                    title="View Candlestick Chart"
                                                                    className="rounded p-1 text-gray-400 hover:bg-emerald-100 hover:text-emerald-700"
                                                                >
                                                                    <FiBarChart2 size={13} />
                                                                </button>
                                                                <ValueWithChange
                                                                    value={row.ce.ltp}
                                                                    change={
                                                                        columns.ltpChangePercent
                                                                            ? row.ce.changePercent
                                                                            : null
                                                                    }
                                                                    align="right"
                                                                />
                                                            </div>
                                                        </td>
                                                    </>
                                                )}

                                                {/* STRIKE PRICE CENTER CELL */}
                                                <td
                                                    className={`px-3 py-1.5 text-center font-black tabular-nums border-x border-gray-200 ${
                                                        isAtm
                                                            ? "bg-amber-100 text-amber-900"
                                                            : "bg-gray-50 text-gray-900"
                                                    }`}
                                                >
                                                    <div>{row.strike}</div>
                                                    {isAtm && (
                                                        <span className="inline-block rounded bg-amber-500 px-1 py-0.1 text-[9px] font-black uppercase text-gray-950">
                                                            ATM
                                                        </span>
                                                    )}
                                                    {isMaxPain && !isAtm && (
                                                        <span className="block text-[9px] font-black uppercase text-amber-700">
                                                            Pain
                                                        </span>
                                                    )}
                                                </td>

                                                {/* MIDDLE METRICS (IV & PCR) */}
                                                {columns.iv && (
                                                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600 bg-gray-50/40 font-mono">
                                                        {row.iv ?? "-"}
                                                    </td>
                                                )}
                                                {columns.pcr && (
                                                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600 bg-gray-50/40">
                                                        {formatStrikeRatio(row.pe.oi, row.ce.oi)}
                                                    </td>
                                                )}
                                                {columns.pcrVol && (
                                                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-600 bg-gray-50/40">
                                                        {formatStrikeRatio(row.pe.volume, row.ce.volume)}
                                                    </td>
                                                )}

                                                {/* PUT SIDE CELLS */}
                                                {(mobileSideView === "both" || mobileSideView === "puts") && (
                                                    <>
                                                        {/* Put LTP Cell with Chart trigger */}
                                                        <td className={`px-3 py-1.5 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                            <div className="flex items-center justify-start gap-1.5">
                                                                <ValueWithChange
                                                                    value={row.pe.ltp}
                                                                    change={
                                                                        columns.ltpChangePercent
                                                                            ? row.pe.changePercent
                                                                            : null
                                                                    }
                                                                    align="left"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setChartTarget({ strike: row.strike, right: "PE" })
                                                                    }
                                                                    title="View Candlestick Chart"
                                                                    className="rounded p-1 text-gray-400 hover:bg-rose-100 hover:text-rose-700"
                                                                >
                                                                    <FiBarChart2 size={13} />
                                                                </button>
                                                            </div>
                                                        </td>

                                                        {columns.oi && (
                                                            <td className={`px-2 py-1.5 ${peItm ? "bg-amber-50/50" : ""}`}>
                                                                <OiBar value={row.pe.oi} max={scale.maxOi} side="pe" />
                                                            </td>
                                                        )}
                                                        {columns.oiChange && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums font-semibold ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                                style={heatStyle(row.pe.oiChange, scale.maxOiChange)}
                                                            >
                                                                {row.pe.oiChange != null ? formatOi(row.pe.oiChange) : "-"}
                                                            </td>
                                                        )}
                                                        {columns.oiChangePercent && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums font-semibold ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                } ${
                                                                    row.pe.oiChangePercent >= 0
                                                                        ? "text-emerald-600"
                                                                        : "text-rose-600"
                                                                }`}
                                                            >
                                                                {row.pe.oiChangePercent != null
                                                                    ? formatPercent(row.pe.oiChangePercent)
                                                                    : "-"}
                                                            </td>
                                                        )}
                                                        {columns.volume && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums text-gray-600 ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                                style={heatStyle(row.pe.volume, scale.maxVolume)}
                                                            >
                                                                {formatOi(row.pe.volume)}
                                                            </td>
                                                        )}
                                                        {columns.volOi && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums text-gray-500 ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatRatio(row.pe.volume, row.pe.oi)}
                                                            </td>
                                                        )}
                                                        {columns.theta && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums text-gray-400 ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.pe.theta)}
                                                            </td>
                                                        )}
                                                        {columns.vega && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums text-gray-400 ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.pe.vega)}
                                                            </td>
                                                        )}
                                                        {columns.gamma && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums text-gray-400 ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.pe.gamma, 4)}
                                                            </td>
                                                        )}
                                                        {columns.delta && (
                                                            <td
                                                                className={`px-2 py-1.5 text-left tabular-nums font-mono text-gray-700 ${
                                                                    peItm ? "bg-amber-50/50" : ""
                                                                }`}
                                                            >
                                                                {formatGreek(row.pe.delta)}
                                                            </td>
                                                        )}
                                                    </>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>

                                {/* TOTALS FOOTER */}
                                {totals && (
                                    <tfoot className="sticky bottom-0 z-10 bg-gray-100 font-extrabold border-t-2 border-gray-300 text-xs">
                                        <tr className="border-b border-gray-200">
                                            <td colSpan={ceColCount} className="px-3 py-2 text-right text-emerald-800">
                                                ITM: {formatOi(totals.ceItm.oi)} | OTM: {formatOi(totals.ceOtm.oi)}
                                            </td>
                                            <td className="px-3 py-2 text-center bg-gray-200 text-gray-900 border-x border-gray-300">
                                                TOTAL OI
                                            </td>
                                            <td colSpan={peColCount} className="px-3 py-2 text-left text-rose-800">
                                                ITM: {formatOi(totals.peItm.oi)} | OTM: {formatOi(totals.peOtm.oi)}
                                            </td>
                                        </tr>
                                        <tr className="bg-gray-200/90 text-gray-900">
                                            <td colSpan={ceColCount} className="px-3 py-2 text-right font-black text-sm">
                                                Total Call OI: {formatOi(totals.totalCeOi)}
                                            </td>
                                            <td className="px-3 py-2 text-center font-black bg-gray-300 border-x border-gray-400">
                                                {displayRows.length} Strikes
                                            </td>
                                            <td colSpan={peColCount} className="px-3 py-2 text-left font-black text-sm">
                                                Total Put OI: {formatOi(totals.totalPeOi)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        {/* Floating Scroll to ATM Button */}
                        <button
                            onClick={scrollToAtm}
                            className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-xl hover:bg-emerald-700 active:scale-95 transition-all"
                        >
                            🎯 Go to ATM ({effectiveAtmStrike})
                        </button>
                    </div>
                ) : (
                    loading && (
                        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-xs font-semibold text-gray-400">
                            Loading live option matrix…
                        </div>
                    )
                )}

                {/* Modals & Settings Drawer */}
                {premiumModalOpen && <PremiumFeaturesModal onClose={() => setPremiumModalOpen(false)} />}

                <OptionChainSettingsDrawer
                    open={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                    columns={columns}
                    onToggleColumn={toggleColumn}
                    onApplyPreset={applyPreset}
                    atmBasis={atmBasis}
                    onAtmBasisChange={setAtmBasis}
                    strikesAroundAtm={strikesAroundAtm}
                    onStrikesAroundAtmChange={setStrikesAroundAtm}
                />

                {chartTarget && data && (
                    <ContractChartModal
                        symbol={data.symbol}
                        strike={chartTarget.strike}
                        expiry={data.selectedExpiry}
                        right={chartTarget.right}
                        onClose={() => setChartTarget(null)}
                    />
                )}

                {/* 4. EDUCATIONAL & GREEKS ANALYSIS SECTION */}
                <div className="pt-6 space-y-6">
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs space-y-4">
                        <h2 className="text-base font-extrabold text-gray-900">
                            {symbol} Option Chain: Greeks Explained (Delta, Theta, Gamma, Vega)
                        </h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <h3 className="font-extrabold text-gray-900 mb-1">Delta (Δ)</h3>
                                <p className="text-gray-600 leading-relaxed">
                                    Measures option price change per 1-point move in {symbol}. Call delta ranges 0 to 1; Put delta -1 to 0. ATM delta is ~0.50.
                                </p>
                            </div>
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <h3 className="font-extrabold text-gray-900 mb-1">Theta (θ)</h3>
                                <p className="text-gray-600 leading-relaxed">
                                    Daily time decay. Options lose value each day time passes. Theta is highest at ATM strikes near expiry.
                                </p>
                            </div>
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <h3 className="font-extrabold text-gray-900 mb-1">Gamma (γ)</h3>
                                <p className="text-gray-600 leading-relaxed">
                                    Rate of change of Delta. Highest near ATM on expiry day, causing rapid explosive premium swings.
                                </p>
                            </div>
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <h3 className="font-extrabold text-gray-900 mb-1">Vega (ν)</h3>
                                <p className="text-gray-600 leading-relaxed">
                                    Sensitivity to Implied Volatility (IV). Measures price change per 1% rise or fall in volatility.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* FAQ Section */}
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs space-y-3">
                        <h3 className="text-sm font-extrabold text-gray-900">Frequently Asked Questions</h3>
                        <div className="space-y-2 text-xs">
                            {[
                                {
                                    q: "What is an Option Chain and how do professional traders read it?",
                                    a: "An Option Chain is a live matrix displaying all Call (CE) and Put (PE) option contracts mapped around current strike prices. Traders analyze Open Interest (OI) concentration to determine key market support and resistance boundaries.",
                                },
                                {
                                    q: "How to interpret PCR (Put-Call Ratio) on Bazaar Sync?",
                                    a: "A PCR above 1.2 indicates bullish sentiment with heavy put writing (support building), while a PCR below 0.8 indicates bearish resistance. Values between 0.8 and 1.2 represent a neutral/ranging market.",
                                },
                                {
                                    q: "What is Max Pain strike?",
                                    a: "Max Pain is the strike price where option buyers experience maximum collective loss upon expiry, often acting as a gravitational price target.",
                                },
                            ].map((faq, idx) => (
                                <details
                                    key={idx}
                                    className="group rounded-xl border border-gray-200 p-3 [&_summary::-webkit-details-marker]:hidden"
                                >
                                    <summary className="flex cursor-pointer items-center justify-between font-bold text-gray-900">
                                        <span>{faq.q}</span>
                                        <span className="transition group-open:rotate-180 text-gray-400">▾</span>
                                    </summary>
                                    <p className="mt-2 text-gray-600 leading-relaxed border-t border-gray-100 pt-2">
                                        {faq.a}
                                    </p>
                                </details>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}