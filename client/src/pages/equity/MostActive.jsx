// pages/equity/MostActive.jsx — Most Active Equities & Indices (7 Indices + 210 F&O Stocks)
import { useEffect, useState, useMemo } from "react";
import { fetchMostActive } from "../../services/equityApi";
import { formatPrice, formatPercent, formatNumber } from "../../utils/format";
import {
    FiRefreshCw,
    FiTrendingUp,
    FiTrendingDown,
    FiActivity,
    FiDollarSign,
    FiSearch,
    FiDownload,
    FiLayers,
    FiGrid,
    FiList,
    FiArrowUp,
    FiArrowDown,
    FiBarChart2,
} from "react-icons/fi";

const TABS = [
    { id: "all", label: "All Universe", icon: FiLayers },
    { id: "indices", label: "7 Major Indices", icon: FiBarChart2 },
    { id: "advances", label: "Advances", icon: FiTrendingUp },
    { id: "declines", label: "Declines", icon: FiTrendingDown },
    { id: "volume", label: "Volume Leaders", icon: FiActivity },
    { id: "turnover", label: "Highest Turnover", icon: FiDollarSign },
];

export default function MostActive() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [sortKey, setSortKey] = useState("pChange");
    const [sortDir, setSortDir] = useState("desc");
    const [viewMode, setViewMode] = useState("table"); // 'table' | 'grid'

    function loadData() {
        setLoading(true);
        fetchMostActive()
            .then((res) => {
                setData(res);
                setError(null);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadData();
    }, []);

    // Toggle column sorting (asc <-> desc)
    function handleSort(key) {
        if (sortKey === key) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir("desc");
        }
    }

    // Base list according to tab
    const baseList = useMemo(() => {
        if (!data) return [];
        switch (activeTab) {
            case "indices":
                return data.indices || [];
            case "advances":
                return (data.stocks || data.all || []).filter((s) => s.pChange > 0.05);
            case "declines":
                return (data.stocks || data.all || []).filter((s) => s.pChange < -0.05);
            case "unchanged":
                return (data.stocks || data.all || []).filter((s) => Math.abs(s.pChange) <= 0.05);
            case "gainers":
                return data.topGainers || [];
            case "losers":
                return data.topLosers || [];
            case "volume":
                return data.topVolume || [];
            case "turnover":
                return data.topTurnover || [];
            case "all":
            default:
                return data.all || [];
        }
    }, [data, activeTab]);

    // Filter & Search
    const filteredList = useMemo(() => {
        return baseList.filter((item) => {
            // Category Filter
            if (categoryFilter === "indices" && item.type !== "index") return false;
            if (categoryFilter === "stocks" && item.type !== "stock") return false;
            if (categoryFilter === "Large Cap" && item.mcapTier !== "Large Cap") return false;
            if (categoryFilter === "Mid Cap" && item.mcapTier !== "Mid Cap") return false;

            // Search Query
            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase().trim();
                const matchSym = item.symbol?.toLowerCase().includes(query);
                const matchName = item.name?.toLowerCase().includes(query);
                const matchSector = item.sector?.toLowerCase().includes(query);
                const matchIndustry = item.industry?.toLowerCase().includes(query);
                return matchSym || matchName || matchSector || matchIndustry;
            }

            return true;
        });
    }, [baseList, categoryFilter, searchQuery]);

    // Sorting
    const sortedList = useMemo(() => {
        const sorted = [...filteredList];
        sorted.sort((a, b) => {
            let aVal = a[sortKey];
            let bVal = b[sortKey];

            if (typeof aVal === "string") {
                return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }

            aVal = Number(aVal) || 0;
            bVal = Number(bVal) || 0;
            return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        });
        return sorted;
    }, [filteredList, sortKey, sortDir]);

    // Export to CSV
    function exportToCsv() {
        if (!sortedList.length) return;
        const headers = ["Symbol", "Name", "Type", "Sector", "Industry", "LTP (INR)", "Change (%)", "Change (INR)", "High", "Low", "Volume", "Turnover (Cr)", "Day Range Pos (%)"];
        const rows = sortedList.map((i) => [
            i.symbol,
            `"${i.name || i.symbol}"`,
            i.type,
            `"${i.sector || ''}"`,
            `"${i.industry || ''}"`,
            i.price,
            i.pChange,
            i.change,
            i.high,
            i.low,
            i.volume,
            i.turnoverCr,
            i.dayRangePosition,
        ]);
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `bazaar_most_active_${new Date().toISOString().split("T")[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    const summary = data?.summary || {
        totalIndices: 7,
        totalStocks: 210,
        advances: 0,
        declines: 0,
        unchanged: 0,
        totalTurnoverCr: 0,
        totalVolume: 0,
    };

    const advanceRatio = summary.totalStocks > 0
        ? Math.round((summary.advances / (summary.advances + summary.declines || 1)) * 100)
        : 50;

    return (
        <div className="space-y-5 pb-12">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
                            High Activity Options
                        </h2>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-400">
                            7 Indices + 210 Stocks
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm mt-0.5">
                        High activity F&O universe analytics across 7 major indices and 210 equities, featuring turnover leaderboards, volume surges, and StockMojo intraday range metrics.
                    </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <button
                        onClick={exportToCsv}
                        disabled={loading || !sortedList.length}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-xs hover:bg-gray-50 active:scale-95 disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                        title="Download CSV"
                    >
                        <FiDownload size={13} />
                        <span className="hidden sm:inline">Export CSV</span>
                    </button>
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50 active:scale-95 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                        <FiRefreshCw size={13} className={loading ? "animate-spin text-emerald-600" : ""} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Error banner if any */}
            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-400">
                    Failed to fetch live quotes: {error}. Showing cached fallback data.
                </div>
            )}

            {/* StockMojo Market Breadth & Summary Cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {/* Card 1: Market Breadth */}
                <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs dark:border-gray-800 dark:bg-gray-900 transition">
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">Market Breadth (F&O)</span>
                        <button
                            onClick={() => {
                                setActiveTab("all");
                                setCategoryFilter("stocks");
                            }}
                            className="font-semibold text-gray-700 hover:text-emerald-600 dark:text-gray-300 dark:hover:text-emerald-400 underline decoration-dotted transition"
                            title="Click to view all 210 F&O stocks"
                        >
                            {summary.totalStocks} Stocks
                        </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-1">
                        {/* Advances Button */}
                        <button
                            onClick={() => {
                                setActiveTab("advances");
                                setSortKey("pChange");
                                setSortDir("desc");
                            }}
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition ${
                                activeTab === "advances"
                                    ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-500 dark:bg-emerald-950/80 dark:text-emerald-300"
                                    : "hover:bg-emerald-50 text-emerald-600 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                            }`}
                            title="Click to show all Advancing stocks"
                        >
                            <span className="text-base font-bold sm:text-lg">{summary.advances}</span>
                            <span className="text-[11px] font-semibold">Advances</span>
                        </button>

                        {/* Declines Button */}
                        <button
                            onClick={() => {
                                setActiveTab("declines");
                                setSortKey("pChange");
                                setSortDir("asc");
                            }}
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition ${
                                activeTab === "declines"
                                    ? "bg-rose-100 text-rose-800 ring-1 ring-rose-500 dark:bg-rose-950/80 dark:text-rose-300"
                                    : "hover:bg-rose-50 text-rose-600 dark:text-rose-400 dark:hover:bg-rose-950/30"
                            }`}
                            title="Click to show all Declining stocks"
                        >
                            <span className="text-base font-bold sm:text-lg">{summary.declines}</span>
                            <span className="text-[11px] font-semibold">Declines</span>
                        </button>

                        {/* Unchanged Button */}
                        <button
                            onClick={() => {
                                setActiveTab("unchanged");
                            }}
                            className={`flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] transition ${
                                activeTab === "unchanged"
                                    ? "bg-gray-200 text-gray-900 ring-1 ring-gray-400 dark:bg-gray-800 dark:text-white"
                                    : "text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                            }`}
                            title="Click to show Unchanged stocks"
                        >
                            <span>{summary.unchanged}</span>
                            <span>Unchanged</span>
                        </button>
                    </div>
                    {/* Visual Advance/Decline bar */}
                    <div
                        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800 flex cursor-pointer"
                        onClick={() => {
                            setActiveTab(activeTab === "advances" ? "declines" : "advances");
                        }}
                        title="Click to switch between Advances and Declines"
                    >
                        <div
                            className="bg-emerald-500 transition-all duration-500 hover:brightness-110"
                            style={{ width: `${advanceRatio}%` }}
                        />
                        <div
                            className="bg-rose-500 transition-all duration-500 hover:brightness-110"
                            style={{ width: `${100 - advanceRatio}%` }}
                        />
                    </div>
                </div>

                {/* Card 2: Total Market Turnover */}
                <div className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Total F&O Turnover</span>
                    <div className="mt-1 flex items-baseline gap-1">
                        <span className="text-base font-bold text-gray-900 dark:text-white sm:text-lg">
                            ₹{formatNumber(summary.totalTurnoverCr || 0)}
                        </span>
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Cr</span>
                    </div>
                    <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                        Vol: {formatNumber(summary.totalVolume || 0)} shares
                    </p>
                </div>

                {/* Card 3: Top Gainer */}
                <div
                    onClick={() => {
                        if (summary.topGainer) {
                            setSearchQuery(summary.topGainer.symbol);
                        }
                    }}
                    className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs dark:border-gray-800 dark:bg-gray-900 cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-800 transition"
                    title="Click to search this stock"
                >
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Top Gainer Today</span>
                    {summary.topGainer ? (
                        <div className="mt-1 flex items-center justify-between">
                            <div>
                                <span className="font-bold text-gray-900 dark:text-white text-sm sm:text-base">
                                    {summary.topGainer.symbol}
                                </span>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                    ₹{formatPrice(summary.topGainer.price)}
                                </div>
                            </div>
                            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                                +{summary.topGainer.pChange}%
                            </span>
                        </div>
                    ) : (
                        <div className="mt-1 text-xs text-gray-400">-</div>
                    )}
                </div>

                {/* Card 4: Top Loser */}
                <div
                    onClick={() => {
                        if (summary.topLoser) {
                            setSearchQuery(summary.topLoser.symbol);
                        }
                    }}
                    className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs dark:border-gray-800 dark:bg-gray-900 cursor-pointer hover:border-rose-300 dark:hover:border-rose-800 transition"
                    title="Click to search this stock"
                >
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Top Loser Today</span>
                    {summary.topLoser ? (
                        <div className="mt-1 flex items-center justify-between">
                            <div>
                                <span className="font-bold text-gray-900 dark:text-white text-sm sm:text-base">
                                    {summary.topLoser.symbol}
                                </span>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                    ₹{formatPrice(summary.topLoser.price)}
                                </div>
                            </div>
                            <span className="rounded-md bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                                {summary.topLoser.pChange}%
                            </span>
                        </div>
                    ) : (
                        <div className="mt-1 text-xs text-gray-400">-</div>
                    )}
                </div>
            </div>

            {/* Filter, Tabs, & Search Bar */}
            <div className="flex flex-col gap-3">
                {/* Primary Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {TABS.map((t) => {
                            const Icon = t.icon;
                            const isActive = activeTab === t.id;
                            let count = 0;
                            if (data) {
                                if (t.id === "all") count = data.all?.length || 217;
                                else if (t.id === "indices") count = data.indices?.length || 7;
                                else if (t.id === "advances") count = summary.advances || 0;
                                else if (t.id === "declines") count = summary.declines || 0;
                                else if (t.id === "volume") count = data.topVolume?.length || 0;
                                else if (t.id === "turnover") count = data.topTurnover?.length || 0;
                            }
                            return (
                                <button
                                    key={t.id}
                                    onClick={() => {
                                        setActiveTab(t.id);
                                        // Reset category filter if switching tabs to avoid empty tables
                                        if (t.id === "indices") setCategoryFilter("all");
                                    }}
                                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                                        isActive
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                                    }`}
                                >
                                    <Icon size={13} />
                                    <span>{t.label}</span>
                                    {count > 0 && (
                                        <span
                                            className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                                                isActive
                                                    ? "bg-white/20 text-white"
                                                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                            }`}
                                        >
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* View mode toggle (table vs mobile card) */}
                    <div className="hidden sm:flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-800 dark:bg-gray-900">
                        <button
                            onClick={() => setViewMode("table")}
                            className={`rounded-md p-1.5 transition ${
                                viewMode === "table"
                                    ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            }`}
                            title="Table View"
                        >
                            <FiList size={14} />
                        </button>
                        <button
                            onClick={() => setViewMode("grid")}
                            className={`rounded-md p-1.5 transition ${
                                viewMode === "grid"
                                    ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            }`}
                            title="Grid Card View"
                        >
                            <FiGrid size={14} />
                        </button>
                    </div>
                </div>

                {/* Sub Filters & Search */}
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    {/* Category Filter Pills */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 mr-1">Filter:</span>
                        {[
                            { id: "all", label: "All" },
                            { id: "indices", label: "Indices" },
                            { id: "stocks", label: "Stocks" },
                            { id: "Large Cap", label: "Large Cap" },
                            { id: "Mid Cap", label: "Mid Cap" },
                        ].map((c) => (
                            <button
                                key={c.id}
                                onClick={() => setCategoryFilter(c.id)}
                                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                                    categoryFilter === c.id
                                        ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                                        : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800"
                                }`}
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>

                    {/* Search Input */}
                    <div className="relative w-full sm:w-64">
                        <FiSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search symbol, sector..."
                            className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Content Display: Table or Grid */}
            {viewMode === "table" ? (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-900">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs min-w-[700px]">
                            <thead className="border-b border-gray-200 bg-gray-50/75 text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                                <tr>
                                    <th
                                        onClick={() => handleSort("symbol")}
                                        className="cursor-pointer px-4 py-3 font-semibold hover:text-gray-900 dark:hover:text-white select-none"
                                    >
                                        <div className="flex items-center gap-1">
                                            <span>Asset & Sector</span>
                                            {sortKey === "symbol" && (
                                                sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                            )}
                                        </div>
                                    </th>
                                    <th
                                        onClick={() => handleSort("price")}
                                        className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none"
                                    >
                                        <div className="flex items-center justify-end gap-1">
                                            <span>LTP (₹)</span>
                                            {sortKey === "price" && (
                                                sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                            )}
                                        </div>
                                    </th>
                                    <th
                                        onClick={() => handleSort("pChange")}
                                        className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none bg-emerald-50/30 dark:bg-emerald-950/10"
                                    >
                                        <div className="flex items-center justify-end gap-1 text-emerald-700 dark:text-emerald-400">
                                            <span>Change (%)</span>
                                            {sortKey === "pChange" && (
                                                sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                            )}
                                        </div>
                                    </th>
                                    <th
                                        onClick={() => handleSort("dayRangePosition")}
                                        className="cursor-pointer px-4 py-3 font-semibold text-center hover:text-gray-900 dark:hover:text-white select-none hidden md:table-cell"
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            <span>Intraday Range (L - H)</span>
                                            {sortKey === "dayRangePosition" && (
                                                sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                            )}
                                        </div>
                                    </th>
                                    <th
                                        onClick={() => handleSort("volume")}
                                        className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none"
                                    >
                                        <div className="flex items-center justify-end gap-1">
                                            <span>Traded Volume</span>
                                            {sortKey === "volume" && (
                                                sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                            )}
                                        </div>
                                    </th>
                                    <th
                                        onClick={() => handleSort("turnoverCr")}
                                        className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none"
                                    >
                                        <div className="flex items-center justify-end gap-1">
                                            <span>Turnover (₹ Cr)</span>
                                            {sortKey === "turnoverCr" && (
                                                sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                            )}
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                                {sortedList.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                            {loading ? "Loading live universe quotes..." : "No matching securities found."}
                                        </td>
                                    </tr>
                                ) : (
                                    sortedList.map((item, idx) => {
                                        const isPos = item.pChange >= 0;
                                        const isIndex = item.type === "index";

                                        return (
                                            <tr
                                                key={item.symbol}
                                                className={`hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition ${
                                                    isIndex ? "bg-blue-50/20 dark:bg-blue-950/10" : ""
                                                }`}
                                            >
                                                {/* Asset & Sector */}
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                                            {idx + 1}
                                                        </span>
                                                        <div>
                                                            <div className="flex items-center gap-1.5">
                                                                <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm">
                                                                    {item.symbol}
                                                                </span>
                                                                {isIndex ? (
                                                                    <span className="rounded-sm bg-blue-100 px-1 py-0.2 text-[9px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                                                        INDEX
                                                                    </span>
                                                                ) : (
                                                                    <span className="rounded-sm bg-gray-100 px-1 py-0.2 text-[9px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                                        {item.mcapTier}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-[160px] sm:max-w-[220px]">
                                                                {item.name !== item.symbol ? item.name : item.sector}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* LTP */}
                                                <td className="px-4 py-3 text-right font-mono font-bold text-gray-900 dark:text-white">
                                                    ₹{formatPrice(item.price)}
                                                </td>

                                                {/* Change (%) */}
                                                <td className="px-4 py-3 text-right font-mono bg-emerald-50/10 dark:bg-emerald-950/5">
                                                    <div
                                                        className={`inline-flex items-center gap-0.5 font-bold ${
                                                            isPos
                                                                ? "text-emerald-600 dark:text-emerald-400"
                                                                : "text-rose-600 dark:text-rose-400"
                                                        }`}
                                                    >
                                                        {isPos ? "+" : ""}{item.pChange}%
                                                    </div>
                                                    <div className="text-[10px] text-gray-400">
                                                        {isPos ? "+" : ""}{formatPrice(item.change)}
                                                    </div>
                                                </td>

                                                {/* Intraday Range (StockMojo Low-High Bar) */}
                                                <td className="px-4 py-3 text-center hidden md:table-cell">
                                                    <div className="mx-auto w-36">
                                                        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
                                                            <span>₹{formatPrice(item.low)}</span>
                                                            <span>₹{formatPrice(item.high)}</span>
                                                        </div>
                                                        <div className="relative h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                                                            <div
                                                                className={`absolute top-0 bottom-0 rounded-full ${
                                                                    isPos ? "bg-emerald-500" : "bg-rose-500"
                                                                }`}
                                                                style={{ width: `${Math.max(5, Math.min(100, item.dayRangePosition))}%` }}
                                                            />
                                                            <div
                                                                className="absolute -top-1 h-3.5 w-1.5 rounded-full bg-gray-900 dark:bg-white shadow-xs"
                                                                style={{ left: `calc(${Math.max(2, Math.min(96, item.dayRangePosition))}% - 3px)` }}
                                                            />
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Traded Volume */}
                                                <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                                                    {formatNumber(item.volume)}
                                                </td>

                                                {/* Turnover (Cr) */}
                                                <td className="px-4 py-3 text-right font-mono font-bold text-gray-900 dark:text-white">
                                                    ₹{item.turnoverCr > 0 ? formatNumber(item.turnoverCr) : "-"} Cr
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                /* Grid Cards View (Optimized for Mobile/Cards) */
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {sortedList.map((item, idx) => {
                        const isPos = item.pChange >= 0;
                        const isIndex = item.type === "index";

                        return (
                            <div
                                key={item.symbol}
                                className={`rounded-xl border border-gray-200 bg-white p-4 shadow-xs transition hover:shadow-md dark:border-gray-800 dark:bg-gray-900 ${
                                    isIndex ? "ring-1 ring-blue-400/30" : ""
                                }`}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                            {idx + 1}
                                        </span>
                                        <div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-bold text-gray-900 dark:text-white text-sm">
                                                    {item.symbol}
                                                </span>
                                                {isIndex ? (
                                                    <span className="rounded-sm bg-blue-100 px-1.5 py-0.2 text-[9px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                                        INDEX
                                                    </span>
                                                ) : (
                                                    <span className="rounded-sm bg-gray-100 px-1.5 py-0.2 text-[9px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                        {item.mcapTier}
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-gray-400 truncate block max-w-[150px]">
                                                {item.name !== item.symbol ? item.name : item.sector}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="text-right">
                                        <div className="font-mono font-bold text-gray-900 dark:text-white text-sm">
                                            ₹{formatPrice(item.price)}
                                        </div>
                                        <div
                                            className={`font-mono text-xs font-semibold ${
                                                isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                            }`}
                                        >
                                            {isPos ? "+" : ""}{item.pChange}%
                                        </div>
                                    </div>
                                </div>

                                {/* Low-High Progress Bar */}
                                <div className="mt-3.5">
                                    <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mb-1">
                                        <span>L: ₹{formatPrice(item.low)}</span>
                                        <span>H: ₹{formatPrice(item.high)}</span>
                                    </div>
                                    <div className="relative h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                                        <div
                                            className={`absolute top-0 bottom-0 rounded-full ${
                                                isPos ? "bg-emerald-500" : "bg-rose-500"
                                            }`}
                                            style={{ width: `${Math.max(5, Math.min(100, item.dayRangePosition))}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2.5 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                                    <span>Vol: <strong className="font-mono text-gray-700 dark:text-gray-300">{formatNumber(item.volume)}</strong></span>
                                    <span>Turnover: <strong className="font-mono text-gray-900 dark:text-white">₹{formatNumber(item.turnoverCr)} Cr</strong></span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
