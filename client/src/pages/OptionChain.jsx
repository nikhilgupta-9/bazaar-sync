import React from "react";
// pages/OptionChain.jsx — High-Density Institutional StockMojo-Parity Real-Time Option Chain Matrix
// Responsive on Desktop, Tablet, and Mobile with Symmetrical Strike Matrix, Real-time Ticks,
// Compact Ticker Bar, Greeks, Visual OI Bars, Candlestick Strike Charts, and Mobile Segmented Views.

import { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useOptionChain } from "../hooks/useOptionChain";
import { useCryptoOptionChain } from "../hooks/useCryptoOptionChain";
import { CRYPTO_COINS } from "../services/cryptoOptionChainApi";
import { formatPrice, formatPercent, formatOi } from "../utils/format";
import { fetchSymbolList } from "../services/optionChainApi";
import ContractChartModal from "../components/ContractChartModal";
import OptionChainOiChart from "../components/OptionChainOiChart";
import OiBar from "../components/OiBar";
import OptionChainSettingsDrawer from "../components/OptionChainSettingsDrawer";
import PremiumFeaturesModal from "../components/PremiumFeaturesModal";
import { FiSettings, FiSearch, FiCheck, FiChevronDown, FiBarChart2, FiInfo, FiX } from "react-icons/fi";
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-13" -> "13 Oct". Plain string parsing, never new Date(nonISO) (CLAUDE.md Gotcha #12).
function formatExpiryLabel(exp) {
    const [y, m, d] = String(exp || "").slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return exp;
    return `${d} ${MONTHS[m - 1]}`;
}

// Calendar days from today (IST) to an Indian 'YYYY-MM-DD' expiry.
function daysToExpiry(exp) {
    const [y, m, d] = String(exp || "").slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return null;
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
    return Math.round((Date.UTC(y, m - 1, d) - today) / 86400000);
}

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
            <span className="font-mono tabular-nums font-bold text-fg">{formatValue(value)}</span>
            <span className={`text-micro font-mono tabular-nums font-semibold ${change > 0 ? "text-up" : change < 0 ? "text-down" : "text-fg-subtle"}`}>
                {change != null ? `${change >= 0 ? "+" : ""}${formatPercent(change)}` : "-"}
            </span>
        </div>
    );
}

function heatStyle(value, maxAbs) {
    if (value == null || !maxAbs) return {};
    const intensity = Math.min(1, Math.abs(value) / maxAbs);
    if (intensity < 0.05) return {};
    const alpha = 0.08 + intensity * 0.35;
    const color = value >= 0 ? `rgba(16,185,129,${alpha.toFixed(2)})` : `rgba(244,63,94,${alpha.toFixed(2)})`;
    return { backgroundColor: color };
}

const PRESET_CONFIGS = {
    standard: {
        ltpChangePercent: true,
        oi: true,
        oiChange: true,
        oiChangePercent: true,
        volume: true,
        volOi: false,
        iv: true,
        delta: true,
        gamma: false,
        theta: false,
        vega: false,
        pcr: false,
        pcrVol: false,
    },
    greeks: {
        ltpChangePercent: true,
        oi: true,
        oiChange: false,
        oiChangePercent: false,
        volume: false,
        volOi: false,
        iv: true,
        delta: true,
        gamma: true,
        theta: true,
        vega: true,
        pcr: false,
        pcrVol: false,
    },
    volumeOi: {
        ltpChangePercent: true,
        oi: true,
        oiChange: true,
        oiChangePercent: true,
        volume: true,
        volOi: true,
        iv: false,
        delta: false,
        gamma: false,
        theta: false,
        vega: false,
        pcr: true,
        pcrVol: true,
    },
    compact: {
        ltpChangePercent: true,
        oi: true,
        oiChange: false,
        oiChangePercent: false,
        volume: false,
        volOi: false,
        iv: false,
        delta: false,
        gamma: false,
        theta: false,
        vega: false,
        pcr: false,
        pcrVol: false,
    },
};

// /option-chain/:symbol → NSE/BSE chain, /option-chain/crypto/:coin → Delta Exchange chain.
export default function OptionChain() {
    const { symbol: urlSymbol, coin } = useParams();
    if (coin !== undefined) {
        const c = coin.toUpperCase();
        if (!CRYPTO_COINS.some((x) => x.symbol === c)) return <Navigate to="/option-chain/crypto/btc" replace />;
        return <CryptoOptionChainPage key={c} coin={c} />;
    }
    return <IndianOptionChainPage urlSymbol={urlSymbol} />;
}

function IndianOptionChainPage({ urlSymbol }) {
    const navigate = useNavigate();
    const chain = useOptionChain(urlSymbol ? urlSymbol.toUpperCase() : "NIFTY");
    const { symbol } = chain;

    useEffect(() => {
        if (symbol && symbol.toLowerCase() !== urlSymbol) {
            navigate(`/option-chain/${symbol.toLowerCase()}`);
        }
    }, [symbol, urlSymbol, navigate]);

    return <OptionChainView market="indian" {...chain} />;
}

function CryptoOptionChainPage({ coin }) {
    const navigate = useNavigate();
    const chain = useCryptoOptionChain(coin);
    const setSymbol = useCallback((c) => navigate(`/option-chain/crypto/${c.toLowerCase()}`), [navigate]);
    return <OptionChainView market="crypto" {...chain} setSymbol={setSymbol} />;
}

function OptionChainView({ market, symbol, data, loading, error, isLive, lastUpdated, setSymbol, load, refresh }) {
    const navigate = useNavigate();
    const isCrypto = market === "crypto";

    const fmtPrice = useCallback(
        (v) => {
            if (v == null || Number.isNaN(Number(v))) return "-";
            return isCrypto
                ? `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : formatPrice(Number(v));
        },
        [isCrypto]
    );

    const fmtQty = useCallback(
        (v) => {
            if (v == null || Number.isNaN(Number(v))) return "-";
            return isCrypto ? Number(v).toLocaleString("en-US") : formatOi(Number(v));
        },
        [isCrypto]
    );

    const fmtStrike = (v) => (isCrypto ? Number(v).toLocaleString("en-US") : String(Number(v)));

    const [expiryFilter, setExpiryFilter] = useState(null);
    const [chartTarget, setChartTarget] = useState(null);
    const [selectedMobileStrike, setSelectedMobileStrike] = useState(null);
    const [symbolList, setSymbolList] = useState(FALLBACK_SYMBOLS);
    const tableContainerRef = useRef(null);
    const atmRowRef = useRef(null);

    // Symbol dropdown picker state
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");

    // Settings drawer & columns state
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [columnState, setColumns] = useState(PRESET_CONFIGS.standard);
    const columns = useMemo(
        () => (isCrypto ? { ...columnState, oiChange: false, oiChangePercent: false, ltpChangePercent: false } : columnState),
        [columnState, isCrypto]
    );
    const [activePreset, setActivePreset] = useState("standard");
    const [atmBasis, setAtmBasis] = useState("spot");
    const [strikesAroundAtm, setStrikesAroundAtm] = useState(20);

    // View Mode: 'table' (Option Matrix) | 'chart' (OI Bar Chart)
    const [viewMode, setViewMode] = useState("table");

    // Mobile view mode: 'both' (Split) | 'calls' | 'puts'
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

    const centerAtm = useCallback((behavior = "smooth") => {
        const box = tableContainerRef.current;
        const row = atmRowRef.current;
        if (!box || !row || box.clientHeight === 0) return false;
        const headH = box.querySelector("thead")?.offsetHeight || 0;
        const footH = box.querySelector("tfoot")?.offsetHeight || 0;
        const visibleH = box.clientHeight - headH - footH;
        const delta = row.getBoundingClientRect().top - box.getBoundingClientRect().top;
        box.scrollTo({ top: Math.max(0, box.scrollTop + delta - headH - visibleH / 2 + row.offsetHeight / 2), behavior });
        return true;
    }, []);

    function scrollToAtm() {
        centerAtm("smooth");
    }

    const centeredKeyRef = useRef(null);
    const centerKey = `${market}|${symbol}|${data?.selectedExpiry ?? ""}|${strikesAroundAtm}|${effectiveAtmStrike}`;
    useEffect(() => {
        if (!displayRows.length || centeredKeyRef.current === centerKey) return;
        const raf = requestAnimationFrame(() => {
            if (centerAtm("auto")) centeredKeyRef.current = centerKey;
        });
        return () => cancelAnimationFrame(raf);
    }, [centerKey, displayRows, centerAtm]);

    const hasData = !!data;
    useLayoutEffect(() => {
        const fit = () => {
            const box = tableContainerRef.current;
            if (!box) return;
            if (window.innerWidth < 1024) {
                box.style.maxHeight = "";
                return;
            }
            const docTop = box.getBoundingClientRect().top + window.scrollY;
            box.style.maxHeight = `${Math.max(450, window.innerHeight - docTop - 16)}px`;
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [hasData]);

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

    const isMobileSplit = mobileSideView === "both";
    const isMobileCalls = mobileSideView === "calls";
    const isMobilePuts = mobileSideView === "puts";

    // Column Counts for ColSpan calculation
    const ceColCount =
        1 /* Call LTP */ +
        (columns.iv ? 1 : 0) +
        (columns.delta ? 1 : 0) +
        (columns.gamma ? 1 : 0) +
        (columns.vega ? 1 : 0) +
        (columns.theta ? 1 : 0) +
        (columns.volOi ? 1 : 0) +
        (columns.volume ? 1 : 0) +
        (columns.oiChangePercent ? 1 : 0) +
        (columns.oiChange ? 1 : 0) +
        (columns.oi ? 1 : 0);

    const midColCount =
        1 /* Strike */ + (columns.pcr ? 1 : 0) + (columns.pcrVol ? 1 : 0);

    const peColCount =
        1 /* Put LTP */ +
        (columns.iv ? 1 : 0) +
        (columns.delta ? 1 : 0) +
        (columns.gamma ? 1 : 0) +
        (columns.vega ? 1 : 0) +
        (columns.theta ? 1 : 0) +
        (columns.volOi ? 1 : 0) +
        (columns.volume ? 1 : 0) +
        (columns.oiChangePercent ? 1 : 0) +
        (columns.oiChange ? 1 : 0) +
        (columns.oi ? 1 : 0);

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
        <div className="min-h-screen bg-page text-fg pb-12">
            <div className="mx-auto w-full max-w-[1750px] px-2 pt-1.5 pb-8 sm:px-3 sm:pt-2 space-y-1.5 sm:space-y-2">
                {/* 1. TOP RESPONSIVE HEADER BAR & CONTROL PANEL */}
                <div className="rounded-xl border border-line bg-surface p-2 sm:p-2.5 shadow-xs space-y-1.5">
                    {/* Row 1: Market Selector, Quick Indices, Stock Search & Live Spot Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2.5">
                        {/* Left: Quick Symbol Selector */}
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Market switch: NSE/BSE F&O vs Crypto (Delta Exchange) */}
                            <div className="flex items-center rounded-xl border border-line bg-surface-raised p-0.5">
                                <button
                                    onClick={() => isCrypto && navigate("/option-chain/nifty")}
                                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                        !isCrypto ? "bg-emerald-600 text-white shadow-xs" : "text-fg-muted hover:text-fg"
                                    }`}
                                >
                                    <span>🇮🇳</span>
                                    <span>NSE F&amp;O</span>
                                </button>
                                <button
                                    onClick={() => !isCrypto && navigate("/option-chain/crypto/btc")}
                                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                        isCrypto ? "bg-amber-500 text-white shadow-xs" : "text-fg-muted hover:text-fg"
                                    }`}
                                >
                                    <span>⚡</span>
                                    <span>Crypto</span>
                                </button>
                            </div>

                            <span className="hidden sm:block h-5 w-px bg-line" />

                            {/* Quick Symbol Pills */}
                            <div className="-mx-2 px-2 flex items-center gap-1 overflow-x-auto scrollbar-none sm:mx-0 sm:px-0 sm:flex-wrap">
                                {isCrypto
                                    ? CRYPTO_COINS.map((c) => (
                                          <button
                                              key={c.symbol}
                                              onClick={() => setSymbol(c.symbol)}
                                              className={`shrink-0 flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                                  symbol === c.symbol
                                                      ? "bg-amber-500 text-white shadow-xs"
                                                      : "bg-surface-raised text-fg hover:bg-surface-hover"
                                              }`}
                                          >
                                              <span>{c.icon}</span>
                                              <span>{c.symbol}</span>
                                              <span className={`hidden md:inline font-medium ${symbol === c.symbol ? "text-white/80" : "text-fg-subtle"}`}>
                                                  {c.name}
                                              </span>
                                          </button>
                                      ))
                                    : ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"].map((idxSym) => (
                                          <button
                                              key={idxSym}
                                              onClick={() => pickSymbol(idxSym)}
                                              className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                                  symbol === idxSym
                                                      ? "bg-emerald-600 text-white shadow-xs"
                                                      : "bg-surface-raised text-fg hover:bg-surface-hover"
                                              }`}
                                          >
                                              {idxSym}
                                          </button>
                                      ))}
                            </div>

                            {/* Dropdown for All 200+ F&O Stocks (Indian market only) */}
                            {!isCrypto && (
                                <div className="relative">
                                    <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 shadow-xs">
                                        <button
                                            onClick={() => cycleSymbol(-1)}
                                            disabled={allSymbols.length < 2}
                                            className="rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-30 transition"
                                            aria-label="Previous symbol"
                                        >
                                            <IoIosArrowBack size={16} />
                                        </button>

                                        <button
                                            onClick={() => setPickerOpen((v) => !v)}
                                            className="flex items-center gap-1.5 px-2 py-0.5 text-xs font-bold text-fg hover:bg-surface-hover transition"
                                        >
                                            <span>{symbol}</span>
                                            <FiChevronDown
                                                size={13}
                                                className={`text-fg-subtle transition-transform ${pickerOpen ? "rotate-180" : ""}`}
                                            />
                                        </button>

                                        <button
                                            onClick={() => cycleSymbol(1)}
                                            disabled={allSymbols.length < 2}
                                            className="rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg disabled:opacity-30 transition"
                                            aria-label="Next symbol"
                                        >
                                            <IoIosArrowForward size={16} />
                                        </button>
                                    </div>

                                    {pickerOpen && (
                                        <>
                                            <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                                            <div className="absolute left-0 top-full z-50 mt-1.5 max-h-96 w-72 overflow-y-auto rounded-xl border border-line bg-surface shadow-2xl text-xs">
                                                <div className="sticky top-0 border-b border-line bg-surface p-2">
                                                    <div className="relative">
                                                        <FiSearch
                                                            size={14}
                                                            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
                                                        />
                                                        <input
                                                            autoFocus
                                                            value={pickerQuery}
                                                            onChange={(e) => setPickerQuery(e.target.value)}
                                                            placeholder="Search index or stock…"
                                                            className="w-full rounded-lg border border-line bg-surface-raised py-1.5 pl-8 pr-2 text-xs text-fg placeholder:text-fg-subtle outline-none focus:border-emerald-500 focus:bg-surface"
                                                        />
                                                    </div>
                                                </div>

                                                {filteredIndices.length > 0 && (
                                                    <div className="py-1">
                                                        <div className="px-3 pt-2 pb-1 text-micro font-bold uppercase tracking-wider text-fg-subtle">
                                                            Indices
                                                        </div>
                                                        {filteredIndices.map((s) => (
                                                            <button
                                                                key={s}
                                                                onClick={() => pickSymbol(s)}
                                                                className={`flex w-full items-center justify-between px-3 py-1.5 text-left font-medium hover:bg-surface-hover transition ${
                                                                    s === symbol ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold" : "text-fg"
                                                                }`}
                                                            >
                                                                <span className="flex items-center gap-1.5">
                                                                    {s}
                                                                    {symbolList.liveSymbols.includes(s) ? (
                                                                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-micro font-bold text-emerald-600 dark:text-emerald-400">
                                                                            LIVE
                                                                        </span>
                                                                    ) : (
                                                                        <span className="rounded bg-surface-raised px-1.5 py-0.5 text-micro text-fg-subtle">
                                                                            Historical
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                {s === symbol && <FiCheck size={14} className="text-emerald-600 dark:text-emerald-400" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                {filteredStocks.length > 0 && (
                                                    <div className="border-t border-line py-1">
                                                        <div className="px-3 pt-2 pb-1 text-micro font-bold uppercase tracking-wider text-fg-subtle">
                                                            F&amp;O Stocks
                                                        </div>
                                                        {filteredStocks.map((s) => (
                                                            <button
                                                                key={s}
                                                                onClick={() => pickSymbol(s)}
                                                                className={`flex w-full items-center justify-between px-3 py-1.5 text-left font-medium hover:bg-surface-hover transition ${
                                                                    s === symbol ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold" : "text-fg"
                                                                }`}
                                                            >
                                                                <span>{s}</span>
                                                                {s === symbol && <FiCheck size={14} className="text-emerald-600 dark:text-emerald-400" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Right: Live Badge & Action controls */}
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            {isLive && (
                                <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-micro font-bold text-emerald-600 dark:text-emerald-400">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    {isCrypto ? "24/7 LIVE" : "LIVE"}
                                </span>
                            )}

                            {/* Refresh Button & timestamp */}
                            <button
                                onClick={refresh}
                                disabled={loading}
                                className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-fg shadow-xs hover:bg-surface-hover disabled:opacity-50 transition"
                                title={lastUpdated ? `Last updated: ${new Date(lastUpdated).toLocaleTimeString()}` : "Refresh"}
                            >
                                <TbReload size={13} className={loading ? "animate-spin text-emerald-600" : "text-fg-muted"} />
                                <span className="hidden sm:inline">{loading ? "Updating…" : "Refresh"}</span>
                                {lastUpdated && !loading && (
                                    <span className="text-micro text-fg-subtle font-mono tabular-nums hidden lg:inline">
                                        {new Date(lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                )}
                            </button>

                            {/* Settings Gear */}
                            <button
                                onClick={() => setSettingsOpen(true)}
                                className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1.5 text-fg-muted shadow-xs hover:bg-surface-hover hover:text-fg transition"
                                title="Custom Table Columns & ATM Settings"
                            >
                                <FiSettings size={15} />
                            </button>
                        </div>
                    </div>

                    {/* Row 2: Sleek Continuous Market Ticker Strip (StockMojo Parity) */}
                    {data && (
                        <div className="flex items-center gap-2.5 overflow-x-auto scrollbar-none py-1 px-2.5 rounded-lg bg-surface-muted border border-line text-xs font-mono tabular-nums">
                            <div className="flex items-center gap-1.5 shrink-0">
                                <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">Spot</span>
                                <span className="font-bold text-fg">{fmtPrice(data.spotPrice)}</span>
                                {data.spotChange != null && (
                                    <span className={`text-micro font-semibold ${data.spotChange >= 0 ? "text-up" : "text-down"}`}>
                                        {data.spotChange >= 0 ? "▲" : "▼"}{fmtPrice(Math.abs(data.spotChange))} ({formatPercent(data.spotChangePercent)})
                                    </span>
                                )}
                            </div>

                            <span className="h-3.5 w-px bg-line shrink-0" />

                            {!isCrypto && data.futurePrice != null && (
                                <>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">Future</span>
                                        <span className="font-bold text-fg">{fmtPrice(data.futurePrice)}</span>
                                        <span className="text-micro text-fg-subtle">
                                            ({data.futurePrice >= data.spotPrice ? `+${(data.futurePrice - data.spotPrice).toFixed(1)} prem` : `${(data.futurePrice - data.spotPrice).toFixed(1)} disc`})
                                        </span>
                                    </div>
                                    <span className="h-3.5 w-px bg-line shrink-0" />
                                </>
                            )}

                            {!isCrypto && data.vix != null && (
                                <>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">India VIX</span>
                                        <span className="font-bold text-fg">{Number(data.vix).toFixed(2)}</span>
                                    </div>
                                    <span className="h-3.5 w-px bg-line shrink-0" />
                                </>
                            )}

                            {data.maxPainStrike != null && (
                                <>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">Max Pain</span>
                                        <span className="font-bold text-amber-600 dark:text-amber-400">{fmtStrike(data.maxPainStrike)}</span>
                                    </div>
                                    <span className="h-3.5 w-px bg-line shrink-0" />
                                </>
                            )}

                            {data.pcr != null && (
                                <>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">PCR (OI)</span>
                                        <span className={`font-bold ${data.pcr >= 1 ? "text-up" : "text-down"}`}>{data.pcr}</span>
                                        <span className={`rounded px-1.5 py-0.2 text-micro font-bold uppercase ${
                                            data.pcr >= 1.2
                                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                                : data.pcr <= 0.8
                                                ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                                                : "bg-surface-raised text-fg-muted"
                                        }`}>
                                            {data.pcr >= 1.2 ? "Bullish" : data.pcr <= 0.8 ? "Bearish" : "Neutral"}
                                        </span>
                                    </div>
                                    <span className="h-3.5 w-px bg-line shrink-0" />
                                </>
                            )}

                            {totals && (
                                <div className="flex items-center gap-2 shrink-0 min-w-[200px]">
                                    <span className="text-micro font-bold text-emerald-600 dark:text-emerald-400">Call {fmtQty(totals.totalCeOi)}</span>
                                    <div className="h-1.5 w-20 rounded-full bg-surface-raised overflow-hidden flex">
                                        <div className="bg-emerald-500 h-full transition-all" style={{ width: `${totals.ceOiPercent}%` }} />
                                        <div className="bg-rose-500 h-full transition-all" style={{ width: `${totals.peOiPercent}%` }} />
                                    </div>
                                    <span className="text-micro font-bold text-rose-600 dark:text-rose-400">Put {fmtQty(totals.totalPeOi)}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Row 3: Expiries Tabs + ATM Strike Filter Pills + View Preset Bar + Mobile Segmented Switch */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line">
                        {/* Expiry Selector Pills */}
                        <div className="-mx-2 px-2 flex items-center gap-1 overflow-x-auto pb-1 max-w-full scrollbar-none sm:mx-0 sm:px-0">
                            <span className="text-label font-bold uppercase tracking-wider text-fg-subtle mr-1 hidden md:inline">
                                Expiry:
                            </span>
                            {data?.expiries?.slice(0, 8).map((exp) => (
                                <button
                                    key={exp}
                                    onClick={() => handleSelectExpiryTab(exp)}
                                    className={`shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                        exp === (data?.selectedExpiry || expiryFilter)
                                            ? `${isCrypto ? "bg-amber-500" : "bg-emerald-600"} text-white shadow-xs`
                                            : "bg-surface-raised text-fg hover:bg-surface-hover"
                                    }`}
                                >
                                    {isCrypto ? data.expiryMeta?.[exp]?.label || exp : formatExpiryLabel(exp)}
                                    {!isCrypto && daysToExpiry(exp) >= 0 && (
                                        <span className={`ml-1 font-semibold ${exp === (data?.selectedExpiry || expiryFilter) ? "text-white/80" : "text-fg-subtle"}`}>
                                            {daysToExpiry(exp)}d
                                        </span>
                                    )}
                                </button>
                            ))}
                            {data?.expiries && data.expiries.length > 8 && (
                                <select
                                    value={data?.selectedExpiry || expiryFilter || ""}
                                    onChange={handleExpiryChange}
                                    className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold text-fg outline-none"
                                >
                                    {data.expiries.slice(8).map((exp) => (
                                        <option key={exp} value={exp}>
                                            {isCrypto ? data.expiryMeta?.[exp]?.label || exp : formatExpiryLabel(exp)}
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Strikes Around ATM Filter & ATM Jump */}
                        <div className="flex items-center gap-1">
                            <span className="text-label font-bold uppercase tracking-wider text-fg-subtle mr-1 hidden sm:inline">
                                Strikes:
                            </span>
                            {STRIKE_RANGES.map((rng) => (
                                <button
                                    key={rng.label}
                                    onClick={() => setStrikesAroundAtm(rng.value)}
                                    className={`rounded-lg px-2 py-0.5 text-xs font-bold transition-all ${
                                        strikesAroundAtm === rng.value
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "bg-surface-raised text-fg hover:bg-surface-hover"
                                    }`}
                                >
                                    {rng.label}
                                </button>
                            ))}
                            {effectiveAtmStrike != null && (
                                <button
                                    onClick={scrollToAtm}
                                    className="ml-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition"
                                    title="Scroll the table to the ATM strike"
                                >
                                    🎯 ATM {fmtStrike(effectiveAtmStrike)}
                                </button>
                            )}
                        </div>

                        {/* View Mode Switcher: Option Matrix vs OI Bar Chart */}
                        <div className="flex items-center rounded-xl border border-line bg-surface-raised p-0.5 shadow-xs">
                            <button
                                onClick={() => setViewMode("table")}
                                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                    viewMode === "table"
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "text-fg-muted hover:text-fg"
                                }`}
                            >
                                <span>Option Matrix</span>
                            </button>
                            <button
                                onClick={() => setViewMode("chart")}
                                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                                    viewMode === "chart"
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "text-fg-muted hover:text-fg"
                                }`}
                            >
                                <FiBarChart2 size={13} />
                                <span>OI Bar Chart</span>
                            </button>
                        </div>

                        {/* Column Presets (Desktop) */}
                        <div className="hidden lg:flex items-center gap-1 rounded-xl bg-surface-raised p-0.5">
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
                                            ? "bg-surface text-fg font-bold shadow-xs"
                                            : "text-fg-muted hover:text-fg"
                                    }`}
                                >
                                    {pLabel}
                                </button>
                            ))}
                        </div>

                        {/* Mobile Side Selector Switcher (Mobile Only) */}
                        <div className="flex md:hidden w-full items-center justify-between rounded-xl border border-line bg-surface-raised p-0.5 shadow-xs mt-1">
                            {[
                                ["both", "Split View"],
                                ["calls", "Calls (CE) Only"],
                                ["puts", "Puts (PE) Only"],
                            ].map(([sKey, sLabel]) => (
                                <button
                                    key={sKey}
                                    onClick={() => setMobileSideView(sKey)}
                                    className={`flex-1 rounded-lg py-1 text-xs font-bold transition-all ${
                                        mobileSideView === sKey
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "text-fg-muted hover:text-fg"
                                    }`}
                                >
                                    {sLabel}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-xs text-rose-600 dark:text-rose-400">
                        ⚠️ {error}
                    </div>
                )}

                {/* 2. MAIN OPTION CHAIN VIEW (Matrix Table or OI Bar Chart) */}
                {data && data.rows?.length ? (
                    viewMode === "chart" ? (
                        <OptionChainOiChart
                            data={data}
                            displayRows={displayRows}
                            fmtPrice={fmtPrice}
                            fmtQty={fmtQty}
                            fmtStrike={fmtStrike}
                            effectiveAtmStrike={effectiveAtmStrike}
                            isCrypto={isCrypto}
                            onOpenChart={(strike, right) => setChartTarget({ strike, right })}
                        />
                    ) : (
                    <div className="rounded-2xl border border-line bg-surface shadow-xs overflow-hidden">
                        <div className="overflow-auto max-h-[calc(100vh-130px)] min-h-[550px]" ref={tableContainerRef}>
                            <table className="w-full text-left border-collapse text-xs">
                                <thead className="sticky top-0 z-20 bg-surface shadow-xs">
                                    {/* Top Grouping Header */}
                                    <tr className="border-b border-line text-xs font-bold">
                                        <th
                                            colSpan={ceColCount}
                                            className={`${isMobilePuts ? "hidden md:table-cell" : ""} bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-center py-2 border-r border-line font-bold`}
                                        >
                                            CALLS (CE)
                                        </th>
                                        <th
                                            colSpan={midColCount}
                                            className="bg-surface-raised text-fg text-center py-2 border-r border-line font-bold"
                                        >
                                            STRIKE
                                        </th>
                                        <th
                                            colSpan={peColCount}
                                            className={`${isMobileCalls ? "hidden md:table-cell" : ""} bg-rose-500/10 text-rose-700 dark:text-rose-400 text-center py-2 font-bold`}
                                        >
                                            PUTS (PE)
                                        </th>
                                    </tr>

                                    {/* Symmetrical Sub-Column Headers */}
                                    <tr className="border-b border-line bg-surface-muted text-label font-bold text-fg-muted uppercase tracking-wider">
                                        {/* CALL SIDE HEADERS (Left to Center) */}
                                        {columns.oi && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                OI
                                            </th>
                                        )}
                                        {columns.oiChange && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                OI Chg
                                            </th>
                                        )}
                                        {columns.oiChangePercent && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                OI Chg%
                                            </th>
                                        )}
                                        {columns.volume && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                Volume
                                            </th>
                                        )}
                                        {columns.volOi && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                Vol/OI
                                            </th>
                                        )}
                                        {columns.theta && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                Theta
                                            </th>
                                        )}
                                        {columns.vega && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                Vega
                                            </th>
                                        )}
                                        {columns.gamma && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                Gamma
                                            </th>
                                        )}
                                        {columns.delta && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                Delta
                                            </th>
                                        )}
                                        {columns.iv && (
                                            <th className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-right`}>
                                                IV
                                            </th>
                                        )}
                                        <th className={`${isMobilePuts ? "hidden md:table-cell" : "table-cell"} px-3 py-2 text-right font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10`}>
                                            Call LTP
                                        </th>

                                        {/* CENTER STRIKE HEADERS */}
                                        <th className="px-3 py-2 text-center font-bold text-fg bg-surface-raised border-x border-line">
                                            Strike
                                        </th>
                                        {columns.pcr && (
                                            <th className={`${isMobileSplit ? "hidden md:table-cell" : "table-cell"} px-2 py-2 text-right bg-surface-muted text-fg-muted`}>
                                                PCR
                                            </th>
                                        )}
                                        {columns.pcrVol && (
                                            <th className={`${isMobileSplit ? "hidden md:table-cell" : "table-cell"} px-2 py-2 text-right bg-surface-muted text-fg-muted`}>
                                                PCR(Vol)
                                            </th>
                                        )}

                                        {/* PUT SIDE HEADERS (Center to Right) */}
                                        <th className={`${isMobileCalls ? "hidden md:table-cell" : "table-cell"} px-3 py-2 text-left font-bold text-rose-700 dark:text-rose-400 bg-rose-500/10`}>
                                            Put LTP
                                        </th>
                                        {columns.iv && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                IV
                                            </th>
                                        )}
                                        {columns.delta && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                Delta
                                            </th>
                                        )}
                                        {columns.gamma && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                Gamma
                                            </th>
                                        )}
                                        {columns.vega && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                Vega
                                            </th>
                                        )}
                                        {columns.theta && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                Theta
                                            </th>
                                        )}
                                        {columns.volOi && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                Vol/OI
                                            </th>
                                        )}
                                        {columns.volume && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                Volume
                                            </th>
                                        )}
                                        {columns.oiChangePercent && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                OI Chg%
                                            </th>
                                        )}
                                        {columns.oiChange && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                OI Chg
                                            </th>
                                        )}
                                        {columns.oi && (
                                            <th className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-2 text-left`}>
                                                OI
                                            </th>
                                        )}
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-line">
                                    {displayRows.map((row) => {
                                        const ceItm = row.strike < data.spotPrice;
                                        const peItm = row.strike > data.spotPrice;
                                        const isMaxPain = row.strike === data.maxPainStrike;
                                        const isAtm = row.strike === effectiveAtmStrike;

                                        return (
                                            <tr
                                                key={row.strike}
                                                ref={isAtm ? atmRowRef : null}
                                                onClick={() => {
                                                    if (window.innerWidth < 768 && isMobileSplit) {
                                                        setSelectedMobileStrike(row);
                                                    }
                                                }}
                                                className={`transition-colors font-medium ${
                                                    isAtm
                                                        ? "bg-amber-500/15 dark:bg-amber-500/20 font-bold ring-1 ring-inset ring-amber-500/50"
                                                        : "hover:bg-surface-hover"
                                                } ${window.innerWidth < 768 && isMobileSplit ? "cursor-pointer" : ""}`}
                                            >
                                                {/* CALL SIDE CELLS (Left to Center) */}
                                                {columns.oi && (
                                                    <td className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 ${ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""}`}>
                                                        <OiBar value={row.ce.oi} max={scale.maxOi} side="ce" format={fmtQty} />
                                                    </td>
                                                )}
                                                {columns.oiChange && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums font-semibold ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                        style={heatStyle(row.ce.oiChange, scale.maxOiChange)}
                                                    >
                                                        {row.ce.oiChange != null ? fmtQty(row.ce.oiChange) : "-"}
                                                    </td>
                                                )}
                                                {columns.oiChangePercent && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums font-semibold ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        } ${
                                                            row.ce.oiChangePercent >= 0 ? "text-up" : "text-down"
                                                        }`}
                                                    >
                                                        {row.ce.oiChangePercent != null ? formatPercent(row.ce.oiChangePercent) : "-"}
                                                    </td>
                                                )}
                                                {columns.volume && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                        style={heatStyle(row.ce.volume, scale.maxVolume)}
                                                    >
                                                        {fmtQty(row.ce.volume)}
                                                    </td>
                                                )}
                                                {columns.volOi && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatRatio(row.ce.volume, row.ce.oi)}
                                                    </td>
                                                )}
                                                {columns.theta && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-subtle ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.ce.theta)}
                                                    </td>
                                                )}
                                                {columns.vega && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-subtle ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.ce.vega)}
                                                    </td>
                                                )}
                                                {columns.gamma && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-subtle ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.ce.gamma, 4)}
                                                    </td>
                                                )}
                                                {columns.delta && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right tabular-nums font-mono text-fg ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.ce.delta)}
                                                    </td>
                                                )}
                                                {columns.iv && (
                                                    <td
                                                        className={`${isMobileCalls ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted ${
                                                            ceItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {row.iv ?? "-"}
                                                    </td>
                                                )}

                                                {/* Call LTP Cell (Always next to Strike) */}
                                                <td className={`${isMobilePuts ? "hidden md:table-cell" : "table-cell"} px-3 py-1.5 ${ceItm ? "bg-amber-500/[0.06] dark:bg-amber-500/[0.1]" : ""}`}>
                                                    <div className="flex items-center justify-end gap-1.5">

                                                        {!isCrypto && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setChartTarget({ strike: row.strike, right: "CE" });
                                                                }}
                                                                title="View Candlestick Chart"
                                                                className="rounded p-1 text-fg-subtle hover:bg-emerald-500/15 hover:text-emerald-600 transition"
                                                            >
                                                                <FiBarChart2 size={13} />
                                                            </button>
                                                        )}
                                                        <ValueWithChange
                                                            formatValue={fmtPrice}
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

                                                {/* STRIKE PRICE CENTER CELL */}
                                                <td
                                                    className={`px-3 py-1.5 text-center font-bold font-mono tabular-nums border-x border-line ${
                                                        isAtm
                                                            ? "bg-amber-500/20 text-amber-900 dark:text-amber-200"
                                                            : "bg-surface-raised text-fg"
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-center gap-1">
                                                        <span>{fmtStrike(row.strike)}</span>
                                                        {window.innerWidth < 768 && isMobileSplit && (
                                                            <FiInfo size={11} className="text-fg-subtle" />
                                                        )}
                                                    </div>
                                                    {isAtm && (
                                                        <span className="inline-block rounded bg-amber-500/20 px-1 py-0.2 text-micro font-bold uppercase text-amber-700 dark:text-amber-300">
                                                            ATM
                                                        </span>
                                                    )}
                                                    {isMaxPain && !isAtm && (
                                                        <span className="block text-micro font-bold uppercase text-amber-600 dark:text-amber-400">
                                                            Pain
                                                        </span>
                                                    )}
                                                </td>

                                                {/* MIDDLE METRICS (PCR) */}
                                                {columns.pcr && (
                                                    <td className={`${isMobileSplit ? "hidden md:table-cell" : "table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted bg-surface-muted`}>
                                                        {formatStrikeRatio(row.pe.oi, row.ce.oi)}
                                                    </td>
                                                )}
                                                {columns.pcrVol && (
                                                    <td className={`${isMobileSplit ? "hidden md:table-cell" : "table-cell"} px-2 py-1.5 text-right font-mono tabular-nums text-fg-muted bg-surface-muted`}>
                                                        {formatStrikeRatio(row.pe.volume, row.ce.volume)}
                                                    </td>
                                                )}

                                                {/* PUT SIDE CELLS (Center to Right) */}
                                                {/* Put LTP Cell (Always next to Strike) */}
                                                <td className={`${isMobileCalls ? "hidden md:table-cell" : "table-cell"} px-3 py-1.5 ${peItm ? "bg-amber-500/[0.06] dark:bg-amber-500/[0.1]" : ""}`}>
                                                    <div className="flex items-center justify-start gap-1.5">
                                                        <ValueWithChange
                                                            formatValue={fmtPrice}
                                                            value={row.pe.ltp}
                                                            change={
                                                                columns.ltpChangePercent
                                                                    ? row.pe.changePercent
                                                                    : null
                                                            }
                                                            align="left"
                                                        />
                                                        {!isCrypto && (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setChartTarget({ strike: row.strike, right: "PE" });
                                                                }}
                                                                title="View Candlestick Chart"
                                                                className="rounded p-1 text-fg-subtle hover:bg-rose-500/15 hover:text-rose-600 transition"
                                                            >
                                                                <FiBarChart2 size={13} />
                                                            </button>
                                                        )}

                                                    </div>
                                                </td>

                                                {columns.iv && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums text-fg-muted ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {row.iv ?? "-"}
                                                    </td>
                                                )}
                                                {columns.delta && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left tabular-nums font-mono text-fg ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.pe.delta)}
                                                    </td>
                                                )}
                                                {columns.gamma && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums text-fg-subtle ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.pe.gamma, 4)}
                                                    </td>
                                                )}
                                                {columns.vega && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums text-fg-subtle ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.pe.vega)}
                                                    </td>
                                                )}
                                                {columns.theta && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums text-fg-subtle ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatGreek(row.pe.theta)}
                                                    </td>
                                                )}
                                                {columns.volOi && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums text-fg-muted ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                    >
                                                        {formatRatio(row.pe.volume, row.pe.oi)}
                                                    </td>
                                                )}
                                                {columns.volume && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums text-fg-muted ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                        style={heatStyle(row.pe.volume, scale.maxVolume)}
                                                    >
                                                        {fmtQty(row.pe.volume)}
                                                    </td>
                                                )}
                                                {columns.oiChangePercent && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums font-semibold ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        } ${
                                                            row.pe.oiChangePercent >= 0 ? "text-up" : "text-down"
                                                        }`}
                                                    >
                                                        {row.pe.oiChangePercent != null ? formatPercent(row.pe.oiChangePercent) : "-"}
                                                    </td>
                                                )}
                                                {columns.oiChange && (
                                                    <td
                                                        className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 text-left font-mono tabular-nums font-semibold ${
                                                            peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""
                                                        }`}
                                                        style={heatStyle(row.pe.oiChange, scale.maxOiChange)}
                                                    >
                                                        {row.pe.oiChange != null ? fmtQty(row.pe.oiChange) : "-"}
                                                    </td>
                                                )}
                                                {columns.oi && (
                                                    <td className={`${isMobilePuts ? "table-cell" : "hidden md:table-cell"} px-2 py-1.5 ${peItm ? "bg-amber-500/[0.05] dark:bg-amber-500/[0.08]" : ""}`}>
                                                        <OiBar value={row.pe.oi} max={scale.maxOi} side="pe" format={fmtQty} />
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>

                                {/* TOTALS FOOTER */}
                                {totals && (
                                    <tfoot className="sticky bottom-0 z-10 bg-surface-muted font-bold border-t-2 border-line text-xs">
                                        <tr className="border-b border-line">
                                            <td colSpan={ceColCount} className={`${isMobilePuts ? "hidden md:table-cell" : ""} px-3 py-2 text-right text-emerald-700 dark:text-emerald-400 font-mono tabular-nums`}>
                                                ITM: {fmtQty(totals.ceItm.oi)} | OTM: {fmtQty(totals.ceOtm.oi)}
                                            </td>
                                            <td colSpan={midColCount} className="px-3 py-2 text-center bg-surface-raised text-fg border-x border-line">
                                                TOTAL OI
                                            </td>
                                            <td colSpan={peColCount} className={`${isMobileCalls ? "hidden md:table-cell" : ""} px-3 py-2 text-left text-rose-700 dark:text-rose-400 font-mono tabular-nums`}>
                                                ITM: {fmtQty(totals.peItm.oi)} | OTM: {fmtQty(totals.peOtm.oi)}
                                            </td>
                                        </tr>
                                        <tr className="bg-surface-raised text-fg">
                                            <td colSpan={ceColCount} className={`${isMobilePuts ? "hidden md:table-cell" : ""} px-3 py-2 text-right font-bold text-sm font-mono tabular-nums`}>
                                                Total Call OI: {fmtQty(totals.totalCeOi)}
                                            </td>
                                            <td colSpan={midColCount} className="px-3 py-2 text-center font-bold bg-surface-muted border-x border-line">
                                                {displayRows.length} Strikes
                                            </td>
                                            <td colSpan={peColCount} className={`${isMobileCalls ? "hidden md:table-cell" : ""} px-3 py-2 text-left font-bold text-sm font-mono tabular-nums`}>
                                                Total Put OI: {fmtQty(totals.totalPeOi)}
                                            </td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        {isCrypto && (
                            <div className="border-t border-line bg-surface-muted px-3 py-1.5 text-label text-fg-muted">
                                Source: Delta Exchange · prices in USD (mark price) · OI &amp; volume in contracts · refreshes every 5s
                            </div>
                        )}
                    </div>
                    )
                ) : loading ? (
                    <div className="rounded-2xl border border-line bg-surface p-12 text-center text-xs font-semibold text-fg-subtle">
                        {isCrypto ? `Loading ${symbol} option chain from Delta Exchange…` : "Loading live option matrix…"}
                    </div>
                ) : (
                    data && (
                        <div className="rounded-2xl border border-line bg-surface p-12 text-center text-xs text-fg-muted space-y-1">
                            <div className="text-2xl">📭</div>
                            <div className="font-bold text-fg">No option contracts listed for {symbol}</div>
                            <div>
                                {isCrypto
                                    ? "Delta Exchange isn't listing any options for this coin right now — try BTC or ETH."
                                    : "No strikes are available for this symbol and expiry."}
                            </div>
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

                {chartTarget && data && !isCrypto && (
                    <ContractChartModal
                        symbol={data.symbol}
                        strike={chartTarget.strike}
                        expiry={data.selectedExpiry}
                        right={chartTarget.right}
                        onClose={() => setChartTarget(null)}
                    />
                )}

                {/* Mobile Strike Telemetry Bottom Sheet */}
                {selectedMobileStrike && data && (
                    <MobileStrikeModal
                        row={selectedMobileStrike}
                        data={data}
                        isCrypto={isCrypto}
                        fmtPrice={fmtPrice}
                        fmtQty={fmtQty}
                        fmtStrike={fmtStrike}
                        onClose={() => setSelectedMobileStrike(null)}
                        onOpenChart={(strike, right) => setChartTarget({ strike, right })}
                    />
                )}

                {/* 4. EDUCATIONAL & GREEKS ANALYSIS SECTION */}
                <div className="pt-4 space-y-4">
                    <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs space-y-4">
                        <h2 className="text-base font-bold text-fg">
                            {symbol} Option Chain: Greeks Explained (Delta, Theta, Gamma, Vega)
                        </h2>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                            <div className="rounded-xl border border-line bg-surface-muted p-4">
                                <h3 className="font-bold text-fg mb-1">Delta (Δ)</h3>
                                <p className="text-fg-muted leading-relaxed">
                                    Measures option price change per 1-point move in {symbol}. Call delta ranges 0 to 1; Put delta -1 to 0. ATM delta is ~0.50.
                                </p>
                            </div>
                            <div className="rounded-xl border border-line bg-surface-muted p-4">
                                <h3 className="font-bold text-fg mb-1">Theta (θ)</h3>
                                <p className="text-fg-muted leading-relaxed">
                                    Daily time decay. Options lose value each day time passes. Theta is highest at ATM strikes near expiry.
                                </p>
                            </div>
                            <div className="rounded-xl border border-line bg-surface-muted p-4">
                                <h3 className="font-bold text-fg mb-1">Gamma (γ)</h3>
                                <p className="text-fg-muted leading-relaxed">
                                    Rate of change of Delta. Highest near ATM on expiry day, causing rapid explosive premium swings.
                                </p>
                            </div>
                            <div className="rounded-xl border border-line bg-surface-muted p-4">
                                <h3 className="font-bold text-fg mb-1">Vega (ν)</h3>
                                <p className="text-fg-muted leading-relaxed">
                                    Sensitivity to Implied Volatility (IV). Measures price change per 1% rise or fall in volatility.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* FAQ Section */}
                    <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs space-y-3">
                        <h3 className="text-sm font-bold text-fg">Frequently Asked Questions</h3>
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
                                    className="group rounded-xl border border-line p-3 [&_summary::-webkit-details-marker]:hidden"
                                >
                                    <summary className="flex cursor-pointer items-center justify-between font-bold text-fg">
                                        <span>{faq.q}</span>
                                        <span className="transition group-open:rotate-180 text-fg-subtle">▾</span>
                                    </summary>
                                    <p className="mt-2 text-fg-muted leading-relaxed border-t border-line pt-2">
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

function MobileStrikeModal({ row, data, isCrypto, fmtPrice, fmtQty, fmtStrike, onClose, onOpenChart }) {
    if (!row) return null;
    const isAtm = row.strike === data.atmStrike;
    const isMaxPain = row.strike === data.maxPainStrike;
    const ceItm = row.strike < data.spotPrice;
    const peItm = row.strike > data.spotPrice;
    const spotDist = data.spotPrice ? row.strike - data.spotPrice : 0;
    const spotDistPct = data.spotPrice ? (spotDist / data.spotPrice) * 100 : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
            <div className="fixed inset-0" onClick={onClose} />
            <div className="relative w-full max-w-lg rounded-t-2xl sm:rounded-2xl border border-line bg-surface p-4 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-line pb-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-fg">Strike {fmtStrike(row.strike)}</h3>
                            {isAtm && (
                                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-micro font-bold uppercase text-amber-700 dark:text-amber-300">
                                    ATM
                                </span>
                            )}
                            {isMaxPain && (
                                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-micro font-bold uppercase text-amber-600 dark:text-amber-400">
                                    Max Pain
                                </span>
                            )}
                        </div>
                        <p className="text-micro font-mono tabular-nums text-fg-muted mt-0.5">
                            {spotDist >= 0 ? `+${fmtPrice(spotDist)} (+${spotDistPct.toFixed(2)}%)` : `${fmtPrice(spotDist)} (${spotDistPct.toFixed(2)}%)`} from Spot ({fmtPrice(data.spotPrice)})
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-raised hover:text-fg transition"
                    >
                        <FiX size={18} />
                    </button>
                </div>

                {/* Call vs Put Comparison Cards */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                    {/* CALL SIDE */}
                    <div className={`rounded-xl border border-line p-3 space-y-2 ${ceItm ? "bg-amber-500/10 dark:bg-amber-500/10" : "bg-surface-muted"}`}>
                        <div className="flex items-center justify-between">
                            <span className="text-micro font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                CALL (CE) {ceItm ? "• ITM" : "• OTM"}
                            </span>
                            {!isCrypto && (
                                <button
                                    onClick={() => {
                                        onClose();
                                        onOpenChart(row.strike, "CE");
                                    }}
                                    className="rounded p-1 text-fg-subtle hover:text-emerald-600 transition"
                                    title="Open Call Chart"
                                >
                                    <FiBarChart2 size={13} />
                                </button>
                            )}
                        </div>
                        <div>
                            <div className="text-lg font-bold font-mono tabular-nums text-fg">
                                {fmtPrice(row.ce.ltp)}
                            </div>
                            <div className={`text-micro font-mono tabular-nums font-semibold ${row.ce.changePercent > 0 ? "text-up" : row.ce.changePercent < 0 ? "text-down" : "text-fg-subtle"}`}>
                                {row.ce.changePercent != null ? `${row.ce.changePercent >= 0 ? "+" : ""}${formatPercent(row.ce.changePercent)}` : "-"}
                            </div>
                        </div>
                        <div className="space-y-1 pt-1 border-t border-line text-label font-mono tabular-nums">
                            <div className="flex justify-between"><span className="text-fg-muted">OI</span><span className="font-bold text-fg">{fmtQty(row.ce.oi)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">OI Chg%</span><span className={row.ce.oiChangePercent >= 0 ? "text-up" : "text-down"}>{row.ce.oiChangePercent != null ? formatPercent(row.ce.oiChangePercent) : "-"}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Volume</span><span className="text-fg">{fmtQty(row.ce.volume)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Delta</span><span className="text-fg">{formatGreek(row.ce.delta)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Theta</span><span className="text-fg">{formatGreek(row.ce.theta)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Vega</span><span className="text-fg">{formatGreek(row.ce.vega)}</span></div>
                        </div>
                    </div>

                    {/* PUT SIDE */}
                    <div className={`rounded-xl border border-line p-3 space-y-2 ${peItm ? "bg-amber-500/10 dark:bg-amber-500/10" : "bg-surface-muted"}`}>
                        <div className="flex items-center justify-between">
                            <span className="text-micro font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                                PUT (PE) {peItm ? "• ITM" : "• OTM"}
                            </span>
                            {!isCrypto && (
                                <button
                                    onClick={() => {
                                        onClose();
                                        onOpenChart(row.strike, "PE");
                                    }}
                                    className="rounded p-1 text-fg-subtle hover:text-rose-600 transition"
                                    title="Open Put Chart"
                                >
                                    <FiBarChart2 size={13} />
                                </button>
                            )}
                        </div>
                        <div>
                            <div className="text-lg font-bold font-mono tabular-nums text-fg">
                                {fmtPrice(row.pe.ltp)}
                            </div>
                            <div className={`text-micro font-mono tabular-nums font-semibold ${row.pe.changePercent > 0 ? "text-up" : row.pe.changePercent < 0 ? "text-down" : "text-fg-subtle"}`}>
                                {row.pe.changePercent != null ? `${row.pe.changePercent >= 0 ? "+" : ""}${formatPercent(row.pe.changePercent)}` : "-"}
                            </div>
                        </div>
                        <div className="space-y-1 pt-1 border-t border-line text-label font-mono tabular-nums">
                            <div className="flex justify-between"><span className="text-fg-muted">OI</span><span className="font-bold text-fg">{fmtQty(row.pe.oi)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">OI Chg%</span><span className={row.pe.oiChangePercent >= 0 ? "text-up" : "text-down"}>{row.pe.oiChangePercent != null ? formatPercent(row.pe.oiChangePercent) : "-"}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Volume</span><span className="text-fg">{fmtQty(row.pe.volume)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Delta</span><span className="text-fg">{formatGreek(row.pe.delta)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Theta</span><span className="text-fg">{formatGreek(row.pe.theta)}</span></div>
                            <div className="flex justify-between"><span className="text-fg-muted">Vega</span><span className="text-fg">{formatGreek(row.pe.vega)}</span></div>
                        </div>
                    </div>
                </div>

                {/* Strike Summary Metrics */}
                <div className="grid grid-cols-2 gap-2 text-micro">
                    <div className="rounded-lg bg-surface-raised p-2 flex justify-between items-center">
                        <span className="text-fg-muted">Strike PCR (OI)</span>
                        <span className="font-bold font-mono tabular-nums text-fg">{formatStrikeRatio(row.pe.oi, row.ce.oi)}</span>
                    </div>
                    <div className="rounded-lg bg-surface-raised p-2 flex justify-between items-center">
                        <span className="text-fg-muted">Implied Volatility</span>
                        <span className="font-bold font-mono tabular-nums text-fg">{row.iv ?? "-"}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
}