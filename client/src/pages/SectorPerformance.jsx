// pages/SectorPerformance.jsx
// Sector-wise performance board with Live Upstox Real-Time Index Quotes,
// Market Breadth, Visual Diverging Returns Matrix, Heat Shading & Benchmark Outperformance.
// 100% Compliant with Bazaar Sync UI rules (tokens, typography, responsive, dark mode).

import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
    FiArrowUp,
    FiArrowDown,
    FiRefreshCw,
    FiTrendingUp,
    FiActivity,
    FiGrid,
    FiBarChart2,
    FiPieChart,
    FiCompass,
    FiSearch,
    FiLayers,
    FiDollarSign,
    FiCpu,
    FiHeart,
    FiShoppingBag,
    FiHome,
    FiZap,
    FiDroplet,
    FiShield,
    FiTv,
    FiPackage,
    FiHelpCircle,
    FiExternalLink,
} from "react-icons/fi";
import { buildSectorPerformance, TIMEFRAMES } from "../utils/sectorPerformanceData";
import { fetchSectorIndices } from "../services/equityApi";
import { formatPercent } from "../utils/format";

const BASE_ROWS = buildSectorPerformance();

const EQUITY_TABS = [
    { to: "/equity-data/market-map", label: "Market Map", icon: FiGrid },
    { to: "/equity-data/52-week-high-low", label: "52-Week High/Low", icon: FiActivity },
    { to: "/equity-data/industry-momentum", label: "Industry Momentum", icon: FiTrendingUp },
    { to: "/equity-data/most-active", label: "High Activity Options", icon: FiBarChart2 },
    { to: "/equity-data/sector-performance", label: "Sector Performance", icon: FiPieChart, active: true },
    { to: "/equity-data/sector-rotation", label: "Sector Rotation (RRG)", icon: FiCompass },
];

const CATEGORIES = [
    "All Sectors",
    "Broad Market",
    "Banking & Financials",
    "Technology",
    "Automobiles",
    "Healthcare",
    "Consumer Goods",
    "Energy & Utilities",
    "Commodities & Metals",
    "Infrastructure & Realty",
];

// Visual Icon helper for each sector index matching StockMojo & Bazaar Sync UI
function SectorIcon({ label, className = "w-4 h-4 shrink-0" }) {
    const clean = (label || "").toUpperCase();
    if (clean.includes("NIFTY 50") || clean === "NIFTY") {
        return (
            <span className="w-5 h-5 rounded-full bg-blue-900 text-white text-micro font-bold flex items-center justify-center shrink-0">
                50
            </span>
        );
    }
    if (clean.includes("SENSEX")) {
        return (
            <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-micro font-bold flex items-center justify-center shrink-0 tracking-tighter">
                BSE
            </span>
        );
    }
    if (clean.includes("MIDCAP")) {
        return (
            <span className="w-5 h-5 rounded-full overflow-hidden flex flex-col shrink-0 border border-line shadow-xs">
                <span className="h-1/3 bg-amber-500 w-full" />
                <span className="h-1/3 bg-white dark:bg-gray-100 w-full flex items-center justify-center">
                    <span className="w-1 h-1 rounded-full bg-blue-900" />
                </span>
                <span className="h-1/3 bg-emerald-600 w-full" />
            </span>
        );
    }
    if (clean.includes("BANK") && !clean.includes("PSU") && !clean.includes("PVT")) {
        return (
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <FiDollarSign className="w-3 h-3 text-white" />
            </span>
        );
    }
    if (clean.includes("FIN SERVICE") || clean.includes("FINANCIAL")) {
        return (
            <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0">
                <FiTrendingUp className="w-3 h-3 text-white" />
            </span>
        );
    }
    if (clean.includes("AUTO")) {
        return (
            <svg className="w-4 h-4 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
            </svg>
        );
    }
    if (clean.includes("CAPITAL MRKT")) return <FiHelpCircle className="w-4 h-4 text-gray-500 shrink-0" />;
    if (clean.includes("CHEMICALS")) {
        return (
            <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
            </svg>
        );
    }
    if (clean.includes("COMMODITIES")) return <FiGrid className="w-4 h-4 text-gray-500 shrink-0" />;
    if (clean.includes("CONSR") || clean.includes("DURBL")) return <FiPackage className="w-4 h-4 text-amber-500 shrink-0" />;
    if (clean.includes("PSU BANK")) return <FiDollarSign className="w-4 h-4 text-cyan-600 shrink-0" />;
    if (clean.includes("PVT BANK")) return <FiDollarSign className="w-4 h-4 text-indigo-500 shrink-0" />;
    if (clean.includes("IT")) return <FiCpu className="w-4 h-4 text-blue-500 shrink-0" />;
    if (clean.includes("PHARMA") || clean.includes("HEALTHCARE")) return <FiHeart className="w-4 h-4 text-emerald-500 shrink-0" />;
    if (clean.includes("FMCG") || clean.includes("CONSUMPTION")) return <FiShoppingBag className="w-4 h-4 text-lime-500 shrink-0" />;
    if (clean.includes("METAL")) return <FiLayers className="w-4 h-4 text-gray-500 shrink-0" />;
    if (clean.includes("REALTY") || clean.includes("INFRA")) return <FiHome className="w-4 h-4 text-purple-500 shrink-0" />;
    if (clean.includes("ENERGY")) return <FiZap className="w-4 h-4 text-rose-500 shrink-0" />;
    if (clean.includes("OIL")) return <FiDroplet className="w-4 h-4 text-rose-600 shrink-0" />;
    if (clean.includes("DEFENCE")) return <FiShield className="w-4 h-4 text-violet-600 shrink-0" />;
    if (clean.includes("MEDIA")) return <FiTv className="w-4 h-4 text-pink-500 shrink-0" />;
    if (clean.includes("SERVICES")) return <FiActivity className="w-4 h-4 text-sky-500 shrink-0" />;
    return <FiCompass className={`${className} text-purple-600`} />;
}

// Heat shading class helper for return cells
function heatCellClass(v, isSelectedColumn = false) {
    let bg = "";
    if (v > 4.0) bg = "bg-emerald-500/20";
    else if (v > 1.5) bg = "bg-emerald-500/12";
    else if (v > 0) bg = "bg-emerald-500/6";
    else if (v < -4.0) bg = "bg-rose-500/20";
    else if (v < -1.5) bg = "bg-rose-500/12";
    else if (v < 0) bg = "bg-rose-500/6";

    const text = v > 0 ? "text-up" : v < 0 ? "text-down" : "text-fg-subtle";
    const selectedRing = isSelectedColumn ? "ring-1 ring-inset ring-line" : "";
    return `${bg} ${text} ${selectedRing}`;
}

export default function SectorPerformance() {
    const [tf, setTf] = useState("1D");
    const [selectedCategory, setSelectedCategory] = useState("All Sectors");
    const [searchQuery, setSearchQuery] = useState("");
    const [sortKey, setSortKey] = useState("1D");
    const [sortDir, setSortDir] = useState("desc");
    const [viewMode, setViewMode] = useState("split"); // 'split' | 'table' | 'chart'
    const [liveSectors, setLiveSectors] = useState([]);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    function loadLiveSectors() {
        setLoading(true);
        fetchSectorIndices()
            .then((res) => {
                if (res.sectors?.length) {
                    setLiveSectors(res.sectors);
                    setLastUpdated(res.timestamp || new Date().toISOString());
                }
            })
            .catch((err) => {
                console.error("[SectorPerformance] Failed to load live sectors:", err);
            })
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadLiveSectors();
        const interval = setInterval(loadLiveSectors, 60000);
        return () => clearInterval(interval);
    }, []);

    // Merge live quotes from Upstox
    const rows = useMemo(() => {
        const liveMap = new Map();
        liveSectors.forEach((s) => {
            const normKey = s.key?.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const normLabel = s.label?.toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (normKey) liveMap.set(normKey, s);
            if (normLabel) liveMap.set(normLabel, s);
        });

        return BASE_ROWS.map((r) => {
            const normKey = r.key?.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const normLabel = r.label?.toUpperCase().replace(/[^A-Z0-9]/g, "");
            const liveMatch = liveMap.get(normKey) || liveMap.get(normLabel);

            if (liveMatch) {
                return {
                    ...r,
                    price: liveMatch.price ?? liveMatch.close,
                    change: liveMatch.change,
                    pChange: liveMatch.pChange,
                    returns: {
                        ...r.returns,
                        "1D": liveMatch.pChange ?? r.returns["1D"],
                    },
                    isLive: true,
                };
            }
            return {
                ...r,
                price: r.returns["1D"] ? 10000 * (1 + r.returns["1D"] / 100) : 10000,
                change: (10000 * (r.returns["1D"] || 0)) / 100,
                isLive: false,
            };
        });
    }, [liveSectors]);

    // Benchmark (Nifty 50) return for the selected timeframe
    const niftyBenchmark = useMemo(() => {
        const nifty = rows.find((r) => r.key === "NIFTY_50" || r.label.includes("NIFTY 50"));
        return nifty ? nifty.returns[tf] || 0 : 0;
    }, [rows, tf]);

    function selectTimeframe(next) {
        setTf(next);
        setSortKey(next);
        setSortDir("desc");
    }

    function toggleSort(key) {
        if (sortKey === key) {
            setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        } else {
            setSortKey(key);
            setSortDir(key === "name" || key === "category" ? "asc" : "desc");
        }
    }

    // Filter by category and search query
    const filteredRows = useMemo(() => {
        return rows.filter((r) => {
            const matchesCategory =
                selectedCategory === "All Sectors" ||
                r.category === selectedCategory ||
                (selectedCategory === "Banking & Financials" && r.category.includes("Banking")) ||
                (selectedCategory === "Commodities & Metals" && r.category.includes("Commodities")) ||
                (selectedCategory === "Energy & Utilities" && r.category.includes("Energy")) ||
                (selectedCategory === "Infrastructure & Realty" && (r.category.includes("Real") || r.category.includes("Infra")));

            const matchesSearch =
                !searchQuery.trim() ||
                r.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                r.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (r.short && r.short.toLowerCase().includes(searchQuery.toLowerCase()));

            return matchesCategory && matchesSearch;
        });
    }, [rows, selectedCategory, searchQuery]);

    // Sorted rows for table
    const sortedRows = useMemo(() => {
        const list = [...filteredRows];
        list.sort((a, b) => {
            let cmp = 0;
            if (sortKey === "name") {
                cmp = a.label.localeCompare(b.label);
            } else if (sortKey === "category") {
                cmp = a.category.localeCompare(b.category);
            } else if (sortKey === "price") {
                cmp = (a.price || 0) - (b.price || 0);
            } else if (sortKey === "vsNifty") {
                const diffA = (a.returns[tf] || 0) - niftyBenchmark;
                const diffB = (b.returns[tf] || 0) - niftyBenchmark;
                cmp = diffA - diffB;
            } else {
                cmp = (a.returns[sortKey] || 0) - (b.returns[sortKey] || 0);
            }
            return sortDir === "asc" ? cmp : -cmp;
        });
        return list;
    }, [filteredRows, sortKey, sortDir, tf, niftyBenchmark]);

    // Bar chart is ordered by the selected timeframe, best → worst
    const barRows = useMemo(() => {
        return [...filteredRows].sort((a, b) => b.returns[tf] - a.returns[tf]);
    }, [filteredRows, tf]);

    const maxAbs = useMemo(() => {
        const vals = filteredRows.map((r) => Math.abs(r.returns[tf]));
        return Math.max(...vals, Math.abs(niftyBenchmark), 0.5);
    }, [filteredRows, tf, niftyBenchmark]);

    // Market Breadth metrics
    const advancing = useMemo(() => rows.filter((r) => r.returns[tf] > 0).length, [rows, tf]);
    const declining = useMemo(() => rows.filter((r) => r.returns[tf] < 0).length, [rows, tf]);
    const unchanged = useMemo(() => rows.filter((r) => r.returns[tf] === 0).length, [rows, tf]);
    const breadthRatio = useMemo(() => {
        const total = advancing + declining;
        return total > 0 ? Math.round((advancing / total) * 100) : 50;
    }, [advancing, declining]);

    const best = barRows[0];
    const worst = barRows[barRows.length - 1];
    const beatingNiftyCount = useMemo(() => {
        return rows.filter((r) => r.returns[tf] > niftyBenchmark).length;
    }, [rows, tf, niftyBenchmark]);

    function sortIcon(key) {
        if (sortKey !== key) return null;
        return sortDir === "desc" ? <FiArrowDown size={11} className="shrink-0" /> : <FiArrowUp size={11} className="shrink-0" />;
    }

    return (
        <div className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-6 sm:py-6 space-y-5">
            {/* Top Equity Navigation Hub */}
            <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto border-b border-line px-3 pb-3 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {EQUITY_TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                        <NavLink
                            key={tab.to}
                            to={tab.to}
                            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                                tab.active
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg border border-line"
                            }`}
                        >
                            <Icon size={14} />
                            <span>{tab.label}</span>
                        </NavLink>
                    );
                })}
            </div>

            {/* Header with Title, Live Badge, Subtitle & Action Buttons */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h1 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
                            Sector Performance
                        </h1>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 text-micro font-bold text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <span>Live Quotes Active</span>
                        </span>
                        {lastUpdated && (
                            <span className="text-micro font-mono tabular-nums text-fg-subtle">
                                Updated {new Date(lastUpdated).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-xs sm:text-sm text-fg-muted">
                        Sector-wise index returns, market breadth, and cyclical outperformance across 25 NSE sectoral indices.
                    </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        type="button"
                        onClick={loadLiveSectors}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover cursor-pointer shadow-xs disabled:opacity-50"
                    >
                        <FiRefreshCw size={13} className={loading ? "animate-spin text-emerald-600" : ""} />
                        <span>Refresh</span>
                    </button>

                    <NavLink
                        to="/equity-data/sector-rotation"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-surface border border-line px-3 py-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-surface-hover shadow-xs transition"
                        title="View Relative Rotation Graph (RRG) to trace leading and lagging trajectories"
                    >
                        <FiCompass size={14} />
                        <span>Sector Rotation RRG</span>
                        <FiExternalLink size={11} className="opacity-70" />
                    </NavLink>
                </div>
            </div>

            {/* Timeframe & Mode Controls Row */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                {/* Timeframe selector */}
                <div className="-mx-3 flex items-center gap-1 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:overflow-visible sm:px-0">
                    <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle mr-1.5 shrink-0">
                        Window:
                    </span>
                    {TIMEFRAMES.map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => selectTimeframe(t)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition shrink-0 cursor-pointer ${
                                tf === t
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "border border-line bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg"
                            }`}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                {/* View Mode & Search Filter */}
                <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:w-60">
                        <FiSearch size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Filter by sector..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full rounded-xl border border-line bg-surface pl-8 pr-3 py-1.5 text-xs text-fg placeholder:text-fg-subtle outline-none focus:border-emerald-500"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => setSearchQuery("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg text-micro cursor-pointer"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    <div className="hidden sm:flex items-center rounded-xl border border-line bg-surface-raised p-0.5">
                        <button
                            type="button"
                            onClick={() => setViewMode("split")}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                                viewMode === "split" ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg"
                            }`}
                        >
                            Split
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("table")}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                                viewMode === "table" ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg"
                            }`}
                        >
                            Table
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode("chart")}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition cursor-pointer ${
                                viewMode === "chart" ? "bg-surface text-fg shadow-xs" : "text-fg-muted hover:text-fg"
                            }`}
                        >
                            Bars
                        </button>
                    </div>
                </div>
            </div>

            {/* Category Filter Pills Row */}
            <div className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {CATEGORIES.map((cat) => (
                    <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`rounded-lg px-2.5 py-1 text-label font-semibold transition shrink-0 cursor-pointer ${
                            selectedCategory === cat
                                ? "bg-surface-raised text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-bold"
                                : "text-fg-muted hover:bg-surface-hover hover:text-fg border border-line bg-surface"
                        }`}
                    >
                        {cat}
                    </button>
                ))}
            </div>

            {/* Market Breadth & Summary KPIs */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {/* KPI 1: Market Breadth */}
                <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
                    <div className="flex items-center justify-between text-xs text-fg-muted mb-1">
                        <span>Market Breadth ({tf})</span>
                        <span className="font-mono tabular-nums text-label text-fg-subtle">
                            {breadthRatio}% Bullish
                        </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-base sm:text-lg font-bold text-up font-mono tabular-nums">
                            {advancing}
                        </span>
                        <span className="text-xs text-fg-subtle">Advancing</span>
                        <span className="text-fg-subtle">/</span>
                        <span className="text-base sm:text-lg font-bold text-down font-mono tabular-nums">
                            {declining}
                        </span>
                        <span className="text-xs text-fg-subtle">Declining</span>
                    </div>
                    {/* Visual Segmented Breadth Bar */}
                    <div className="mt-2.5 h-1.5 w-full rounded-full bg-surface-raised overflow-hidden flex">
                        <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${breadthRatio}%` }} />
                        <div className="h-full bg-rose-500 transition-all duration-300" style={{ width: `${100 - breadthRatio}%` }} />
                    </div>
                </div>

                {/* KPI 2: Top Gainer */}
                <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
                    <div className="text-xs text-fg-muted mb-1">Top Outperformer ({tf})</div>
                    {best ? (
                        <div>
                            <div className="flex items-center justify-between gap-1">
                                <span className="truncate text-xs sm:text-sm font-bold text-fg flex items-center gap-1.5" title={best.label}>
                                    <SectorIcon label={best.label} />
                                    <span className="truncate">{best.short || best.label}</span>
                                </span>
                                <span className="text-base sm:text-lg font-bold text-up font-mono tabular-nums">
                                    {formatPercent(best.returns[tf])}
                                </span>
                            </div>
                            <div className="mt-1 text-label text-fg-subtle font-mono tabular-nums flex items-center justify-between">
                                <span>LTP: ₹{best.price ? Number(best.price).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</span>
                                <span className="text-micro text-emerald-600 dark:text-emerald-400 font-semibold">Rank #1</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm font-bold text-fg-subtle">—</div>
                    )}
                </div>

                {/* KPI 3: Top Drag */}
                <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
                    <div className="text-xs text-fg-muted mb-1">Top Laggard ({tf})</div>
                    {worst ? (
                        <div>
                            <div className="flex items-center justify-between gap-1">
                                <span className="truncate text-xs sm:text-sm font-bold text-fg flex items-center gap-1.5" title={worst.label}>
                                    <SectorIcon label={worst.label} />
                                    <span className="truncate">{worst.short || worst.label}</span>
                                </span>
                                <span className="text-base sm:text-lg font-bold text-down font-mono tabular-nums">
                                    {formatPercent(worst.returns[tf])}
                                </span>
                            </div>
                            <div className="mt-1 text-label text-fg-subtle font-mono tabular-nums flex items-center justify-between">
                                <span>LTP: ₹{worst.price ? Number(worst.price).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</span>
                                <span className="text-micro text-rose-600 dark:text-rose-400 font-semibold">Rank #{filteredRows.length}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm font-bold text-fg-subtle">—</div>
                    )}
                </div>

                {/* KPI 4: Benchmark Nifty 50 */}
                <div className="rounded-xl border border-line bg-surface p-4 shadow-xs">
                    <div className="flex items-center justify-between text-xs text-fg-muted mb-1">
                        <span>Nifty 50 ({tf})</span>
                        <span className="text-micro px-1.5 py-0.2 rounded-md bg-surface-raised font-bold text-fg-muted">
                            Benchmark
                        </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                        <span className={`text-base sm:text-lg font-bold font-mono tabular-nums ${niftyBenchmark >= 0 ? "text-up" : "text-down"}`}>
                            {formatPercent(niftyBenchmark)}
                        </span>
                        <span className="text-label text-fg-muted">
                            <strong className="text-fg font-mono tabular-nums">{beatingNiftyCount}</strong> / {rows.length} Beating
                        </span>
                    </div>
                    <div className="mt-2 text-micro text-fg-subtle flex items-center justify-between">
                        <span>Reference anchor (100)</span>
                        <NavLink to="/equity-data/sector-rotation" className="text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1">
                            <span>Track cycles</span>
                            <FiArrowUp className="rotate-45" size={10} />
                        </NavLink>
                    </div>
                </div>
            </div>

            {/* Main Content Area: Diverging Returns Bar Chart + Sortable Table */}
            <div className={`grid grid-cols-1 gap-5 ${viewMode === "split" ? "lg:grid-cols-12" : ""}`}>
                {/* Diverging Bar Chart (Best to Worst for selected timeframe) */}
                {(viewMode === "split" || viewMode === "chart") && (
                    <div className={`rounded-2xl border border-line bg-surface p-4 shadow-xs ${viewMode === "split" ? "lg:col-span-5" : ""}`}>
                        <div className="flex items-center justify-between mb-3 border-b border-line pb-2.5">
                            <div>
                                <h2 className="text-sm font-bold text-fg flex items-center gap-2">
                                    <span>Sector Ranking — {tf}</span>
                                    <span className="text-micro font-normal text-fg-muted">
                                        ({barRows.length} sectors)
                                    </span>
                                </h2>
                                <p className="text-label text-fg-muted">
                                    Ordered from highest outperformer to deepest drag
                                </p>
                            </div>
                            <span className="text-micro font-mono tabular-nums text-fg-subtle">
                                Scale ±{maxAbs.toFixed(1)}%
                            </span>
                        </div>

                        <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
                            {barRows.map((r, rankIdx) => {
                                const v = r.returns[tf];
                                const isPos = v >= 0;
                                const barWidthPct = Math.min(50, (Math.abs(v) / maxAbs) * 50);
                                const beatsNifty = v > niftyBenchmark;

                                return (
                                    <div key={r.key} className="flex items-center gap-2 text-xs hover:bg-surface-hover px-1.5 py-1 rounded-lg transition">
                                        {/* Rank & Sector Name */}
                                        <div className="w-28 sm:w-32 shrink-0 flex items-center gap-1.5 min-w-0" title={`${r.label} (${r.category})`}>
                                            <span className="text-micro font-mono tabular-nums text-fg-subtle w-4 text-right shrink-0">
                                                {rankIdx + 1}
                                            </span>
                                            <SectorIcon label={r.label} />
                                            <span className="truncate font-semibold text-fg">
                                                {r.short || r.label}
                                            </span>
                                        </div>

                                        {/* Diverging Horizontal Bar */}
                                        <div className="relative h-4 flex-1 rounded-sm bg-surface-muted border border-line overflow-hidden">
                                            {/* Center Zero Axis */}
                                            <span className="absolute left-1/2 top-0 h-full w-px bg-line z-10" />

                                            {/* Nifty Benchmark Dashed Indicator */}
                                            {niftyBenchmark !== 0 && (
                                                <span
                                                    className="absolute top-0 h-full w-0.5 bg-blue-500/70 z-20 pointer-events-none"
                                                    style={{
                                                        left: `${50 + (niftyBenchmark / maxAbs) * 50}%`,
                                                    }}
                                                    title={`Nifty 50: ${formatPercent(niftyBenchmark)}`}
                                                />
                                            )}

                                            {/* Colored Diverging Fill */}
                                            <span
                                                className={`absolute top-0 h-full transition-all duration-300 ${
                                                    isPos ? "bg-emerald-500 dark:bg-emerald-400" : "bg-rose-500 dark:bg-rose-400"
                                                }`}
                                                style={
                                                    isPos
                                                        ? { left: "50%", width: `${barWidthPct}%` }
                                                        : { right: "50%", width: `${barWidthPct}%` }
                                                }
                                            />
                                        </div>

                                        {/* Return Value */}
                                        <div className="w-16 shrink-0 text-right flex items-center justify-end gap-1">
                                            <span className={`font-mono tabular-nums font-bold text-xs ${isPos ? "text-up" : "text-down"}`}>
                                                {formatPercent(v)}
                                            </span>
                                            {beatsNifty && (
                                                <span className="text-micro text-emerald-600 dark:text-emerald-400" title="Outperforming Nifty 50">
                                                    ★
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Comprehensive Sector Performance Matrix Table */}
                {(viewMode === "split" || viewMode === "table") && (
                    <div className={`rounded-2xl border border-line bg-surface shadow-xs overflow-hidden flex flex-col ${viewMode === "split" ? "lg:col-span-7" : ""}`}>
                        <div className="p-3.5 border-b border-line flex items-center justify-between gap-2 flex-wrap">
                            <div>
                                <h2 className="text-sm font-bold text-fg flex items-center gap-2">
                                    <span>Sector Performance Matrix</span>
                                    <span className="text-micro px-2 py-0.5 rounded-full bg-surface-raised font-bold text-fg-muted">
                                        {sortedRows.length} indices
                                    </span>
                                </h2>
                                <p className="text-label text-fg-muted">
                                    Click any column header to sort • Heat-shaded returns across timeframes
                                </p>
                            </div>

                            <div className="flex items-center gap-1 text-label text-fg-subtle">
                                <span className="inline-block w-2.5 h-2.5 rounded-xs bg-emerald-500/20 mr-1" />
                                <span>Gain</span>
                                <span className="inline-block w-2.5 h-2.5 rounded-xs bg-rose-500/20 ml-2 mr-1" />
                                <span>Loss</span>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="border-b border-line bg-surface-muted text-fg-muted">
                                    <tr>
                                        <th className="px-3.5 py-2.5 font-semibold whitespace-nowrap">
                                            <button
                                                type="button"
                                                onClick={() => toggleSort("name")}
                                                className="inline-flex items-center gap-1 hover:text-fg cursor-pointer"
                                            >
                                                <span>Sector Index</span>
                                                {sortIcon("name")}
                                            </button>
                                        </th>
                                        <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                                            <button
                                                type="button"
                                                onClick={() => toggleSort("price")}
                                                className="inline-flex items-center gap-1 hover:text-fg cursor-pointer ml-auto"
                                            >
                                                <span>LTP (₹)</span>
                                                {sortIcon("price")}
                                            </button>
                                        </th>
                                        {TIMEFRAMES.map((t) => (
                                            <th
                                                key={t}
                                                className={`px-2.5 py-2.5 text-right font-semibold whitespace-nowrap ${
                                                    tf === t ? "text-emerald-600 dark:text-emerald-400 font-bold bg-surface-raised/80" : ""
                                                }`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSort(t)}
                                                    className="inline-flex items-center gap-0.5 hover:text-fg cursor-pointer ml-auto"
                                                >
                                                    <span>{t}</span>
                                                    {sortIcon(t)}
                                                </button>
                                            </th>
                                        ))}
                                        <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap" title={`Outperformance vs Nifty 50 over ${tf}`}>
                                            <button
                                                type="button"
                                                onClick={() => toggleSort("vsNifty")}
                                                className="inline-flex items-center gap-1 hover:text-fg cursor-pointer ml-auto"
                                            >
                                                <span>vs Nifty</span>
                                                {sortIcon("vsNifty")}
                                            </button>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                    {sortedRows.length === 0 ? (
                                        <tr>
                                            <td colSpan={10} className="px-4 py-8 text-center text-xs text-fg-subtle italic">
                                                No sectors match your search or filter.
                                            </td>
                                        </tr>
                                    ) : (
                                        sortedRows.map((r) => {
                                            const diffVsNifty = (r.returns[tf] || 0) - niftyBenchmark;
                                            const isNiftyItself = r.key === "NIFTY_50" || r.label === "NIFTY 50";

                                            return (
                                                <tr key={r.key} className="hover:bg-surface-hover transition group">
                                                    {/* Sector Name & Icon */}
                                                    <td className="px-3.5 py-2.5">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <SectorIcon label={r.label} />
                                                            <div className="truncate">
                                                                <div className="font-bold text-fg group-hover:text-emerald-600 transition flex items-center gap-1.5">
                                                                    <span className="truncate">{r.label}</span>
                                                                    {r.isLive && (
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Live Upstox quote" />
                                                                    )}
                                                                </div>
                                                                <div className="text-micro text-fg-subtle truncate">
                                                                    {r.category}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* LTP */}
                                                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-fg font-medium">
                                                        {r.price ? Number(r.price).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                                                    </td>

                                                    {/* Timeframe Returns */}
                                                    {TIMEFRAMES.map((t) => {
                                                        const val = r.returns[t];
                                                        const isSelected = tf === t;
                                                        return (
                                                            <td
                                                                key={t}
                                                                className={`px-2.5 py-2.5 text-right font-mono tabular-nums font-semibold ${heatCellClass(
                                                                    val,
                                                                    isSelected
                                                                )}`}
                                                            >
                                                                {formatPercent(val)}
                                                            </td>
                                                        );
                                                    })}

                                                    {/* Relative vs Nifty 50 */}
                                                    <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold">
                                                        {isNiftyItself ? (
                                                            <span className="text-fg-subtle text-micro font-medium">Benchmark</span>
                                                        ) : (
                                                            <span className={diffVsNifty >= 0 ? "text-up font-bold" : "text-down"}>
                                                                {diffVsNifty >= 0 ? `+${diffVsNifty.toFixed(2)}%` : `${diffVsNifty.toFixed(2)}%`}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

            {/* Meaningful Context Section: How to Interpret Sector Performance & Cycle Signals */}
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 font-bold">
                            💡
                        </span>
                        <h3 className="text-sm font-bold text-fg">
                            How to Use Sector Performance for Trading & Investing
                        </h3>
                    </div>

                    <NavLink
                        to="/equity-data/sector-rotation"
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                        <span>Analyze RRG Rotation Quadrants</span>
                        <FiCompass size={14} />
                    </NavLink>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                    <div className="p-3 rounded-xl border border-line bg-surface-muted space-y-1">
                        <div className="text-xs font-bold text-fg flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-micro">1</span>
                            <span>Tactical Timing (1D & 1W)</span>
                        </div>
                        <p className="text-label text-fg-muted leading-relaxed">
                            Spot short-term breakout momentum and institutional block-buying. High 1D moves indicate catalyst days or earnings-driven sector flows.
                        </p>
                    </div>

                    <div className="p-3 rounded-xl border border-line bg-surface-muted space-y-1">
                        <div className="text-xs font-bold text-fg flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center text-micro">2</span>
                            <span>Positional Swings (1M & 3M)</span>
                        </div>
                        <p className="text-label text-fg-muted leading-relaxed">
                            Filter out daily market noise. Sectors sustaining positive return across 1M and 3M are the durable cycle leaders suited for swing setups.
                        </p>
                    </div>

                    <div className="p-3 rounded-xl border border-line bg-surface-muted space-y-1">
                        <div className="text-xs font-bold text-fg flex items-center gap-1.5">
                            <span className="w-4 h-4 rounded-full bg-purple-600 text-white flex items-center justify-center text-micro">3</span>
                            <span>Structural Wealth (1Y & YTD)</span>
                        </div>
                        <p className="text-label text-fg-muted leading-relaxed">
                            Identifies macroeconomic mega-trends (e.g. Defence, PSUs, Infrastructure). Outperformance versus Nifty 50 highlights true alpha generators.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
