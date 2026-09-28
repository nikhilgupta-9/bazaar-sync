import React from "react";
// pages/equity/FiftyTwoWeekHighLow.jsx — 52-Week High & Low Scanner with Infinite Scroll & F&O/Equity Universe
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { fetch52WeekHighLow } from "../../services/equityApi";
import { formatPrice, formatPercent, formatNumber } from "../../utils/format";
import {
    FiRefreshCw,
    FiSearch,
    FiArrowUpRight,
    FiArrowDownRight,
    FiArrowUp,
    FiArrowDown,
    FiLayers,
    FiFilter,
    FiDownload,
    FiActivity,
    FiTrendingUp,
    FiTrendingDown,
} from "react-icons/fi";

const BATCH_SIZE = 30;

export default function FiftyTwoWeekHighLow() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState("all"); // 'all' | 'nearHigh' | 'nearLow' | 'newHigh' | 'newLow'
    const [categoryFilter, setCategoryFilter] = useState("all"); // 'all' | 'fno' | 'equity' | 'indices' | 'Large Cap' | 'Mid Cap'
    const [query, setQuery] = useState("");
    const [sortKey, setSortKey] = useState("distFromHigh");
    const [sortDir, setSortDir] = useState("asc");
    const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);

    // Infinite scroll observer target
    const observerRef = useRef(null);

    function loadData() {
        setLoading(true);
        fetch52WeekHighLow()
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

    // Reset pagination when filter/search/tab changes
    useEffect(() => {
        setVisibleCount(BATCH_SIZE);
    }, [tab, categoryFilter, query, sortKey, sortDir]);

    // Handle column sorting
    function handleSort(key) {
        if (sortKey === key) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "pChange" || key === "rangePosition" ? "desc" : "asc");
        }
    }

    // Filter by Tab
    const baseList = useMemo(() => {
        if (!data) return [];
        switch (tab) {
            case "nearHigh":
                return data.near52WHigh || [];
            case "nearLow":
                return data.near52WLow || [];
            case "newHigh":
                return data.new52WHighToday || [];
            case "newLow":
                return data.new52WLowToday || [];
            case "all":
            default:
                return data.all || [];
        }
    }, [data, tab]);

    // Filter by Category and Search
    const filteredList = useMemo(() => {
        return baseList.filter((item) => {
            // Category Filter
            if (categoryFilter === "fno" && !item.isFno) return false;
            if (categoryFilter === "equity" && (item.isFno || item.type === "index")) return false;
            if (categoryFilter === "indices" && item.type !== "index") return false;
            if (categoryFilter === "Large Cap" && item.mcapTier !== "Large Cap") return false;
            if (categoryFilter === "Mid Cap" && item.mcapTier !== "Mid Cap") return false;

            // Search Query
            if (query.trim()) {
                const q = query.toLowerCase().trim();
                const matchSym = item.symbol?.toLowerCase().includes(q);
                const matchName = item.name?.toLowerCase().includes(q);
                const matchSector = item.sector?.toLowerCase().includes(q);
                const matchIndustry = item.industry?.toLowerCase().includes(q);
                return matchSym || matchName || matchSector || matchIndustry;
            }

            return true;
        });
    }, [baseList, categoryFilter, query]);

    // Sorted List
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

    // Visible sliced items for progressive rendering
    const visibleItems = useMemo(() => {
        return sortedList.slice(0, visibleCount);
    }, [sortedList, visibleCount]);

    const hasMore = visibleCount < sortedList.length;

    // IntersectionObserver for infinite scroll
    const handleObserver = useCallback(
        (entries) => {
            const target = entries[0];
            if (target.isIntersecting && hasMore) {
                setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, sortedList.length));
            }
        },
        [hasMore, sortedList.length]
    );

    useEffect(() => {
        const option = { root: null, rootMargin: "200px", threshold: 0.1 };
        const observer = new IntersectionObserver(handleObserver, option);
        const currentRef = observerRef.current;
        if (currentRef) observer.observe(currentRef);
        return () => {
            if (currentRef) observer.unobserve(currentRef);
        };
    }, [handleObserver]);

    // Export to CSV
    function exportToCsv() {
        if (!sortedList.length) return;
        const headers = ["Symbol", "Name", "Type", "F&O", "Sector", "LTP (INR)", "Change (%)", "52W High", "52W Low", "% From High", "% From Low"];
        const rows = sortedList.map((i) => [
            i.symbol,
            `"${i.name || i.symbol}"`,
            i.type,
            i.isFno ? "Yes" : "No",
            `"${i.sector || ''}"`,
            i.price,
            i.pChange,
            i.yearHigh,
            i.yearLow,
            i.distFromHigh,
            i.distFromLow,
        ]);
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `52_week_high_low_${new Date().toISOString().split("T")[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    const summary = data?.summary || {
        totalScanned: 0,
        totalFno: 217,
        totalEquities: 0,
        nearHighCount: 0,
        nearLowCount: 0,
        newHighCount: 0,
        newLowCount: 0,
    };

    return (
        <div className="space-y-5 pb-16">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
                            52-Week High / Low Scanner
                        </h2>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-400">
                            Equity & Options Universe
                        </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm mt-0.5">
                        Live proximity scan of {summary.totalScanned || "thousands of"} Indian equities & F&O contracts trading near milestone levels.
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

            {/* Error Banner */}
            {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-400">
                    Failed to fetch live scanner data: {error}. Showing fallback records.
                </div>
            )}

            {/* Milestone Summary Cards */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {/* Near High */}
                <button
                    onClick={() => setTab("nearHigh")}
                    className={`flex flex-col rounded-xl border p-3.5 text-left transition ${
                        tab === "nearHigh"
                            ? "border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500 dark:bg-emerald-950/30"
                            : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                    }`}
                >
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">Near 52W High</span>
                        <FiTrendingUp className="text-emerald-500" size={14} />
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 sm:text-2xl">
                            {summary.nearHighCount}
                        </span>
                        <span className="text-[11px] text-gray-400">&lt;5% away</span>
                    </div>
                </button>

                {/* Near Low */}
                <button
                    onClick={() => setTab("nearLow")}
                    className={`flex flex-col rounded-xl border p-3.5 text-left transition ${
                        tab === "nearLow"
                            ? "border-rose-500 bg-rose-50/60 ring-1 ring-rose-500 dark:bg-rose-950/30"
                            : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                    }`}
                >
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">Near 52W Low</span>
                        <FiTrendingDown className="text-rose-500" size={14} />
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-xl font-bold text-rose-600 dark:text-rose-400 sm:text-2xl">
                            {summary.nearLowCount}
                        </span>
                        <span className="text-[11px] text-gray-400">&lt;5% away</span>
                    </div>
                </button>

                {/* New High Today */}
                <button
                    onClick={() => setTab("newHigh")}
                    className={`flex flex-col rounded-xl border p-3.5 text-left transition ${
                        tab === "newHigh"
                            ? "border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500 dark:bg-emerald-950/30"
                            : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                    }`}
                >
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">New High Today</span>
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Record
                        </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 sm:text-2xl">
                            {summary.newHighCount}
                        </span>
                        <span className="text-[11px] text-gray-400">Stocks</span>
                    </div>
                </button>

                {/* New Low Today */}
                <button
                    onClick={() => setTab("newLow")}
                    className={`flex flex-col rounded-xl border p-3.5 text-left transition ${
                        tab === "newLow"
                            ? "border-rose-500 bg-rose-50/60 ring-1 ring-rose-500 dark:bg-rose-950/30"
                            : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                    }`}
                >
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">New Low Today</span>
                        <span className="rounded-full bg-rose-100 px-1.5 py-0.2 text-[9px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            Record
                        </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-xl font-bold text-rose-600 dark:text-rose-400 sm:text-2xl">
                            {summary.newLowCount}
                        </span>
                        <span className="text-[11px] text-gray-400">Stocks</span>
                    </div>
                </button>
            </div>

            {/* Filter Pills, Search Bar, & Tab Selector */}
            <div className="flex flex-col gap-3">
                {/* Main Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3 dark:border-gray-800">
                    <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {[
                            { id: "all", label: "All Universe", count: summary.totalScanned },
                            { id: "nearHigh", label: "Near 52W High", count: summary.nearHighCount },
                            { id: "nearLow", label: "Near 52W Low", count: summary.nearLowCount },
                            { id: "newHigh", label: "New High Today", count: summary.newHighCount },
                            { id: "newLow", label: "New Low Today", count: summary.newLowCount },
                        ].map((t) => (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                                    tab === t.id
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                                }`}
                            >
                                <span>{t.label}</span>
                                {t.count > 0 && (
                                    <span
                                        className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                                            tab === t.id
                                                ? "bg-white/20 text-white"
                                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                        }`}
                                    >
                                        {t.count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="text-xs text-gray-500 dark:text-gray-400">
                        Showing <strong className="text-gray-900 dark:text-white font-mono">{visibleItems.length}</strong> of{" "}
                        <strong className="text-gray-900 dark:text-white font-mono">{sortedList.length}</strong>
                    </div>
                </div>

                {/* Sub-Filters: F&O vs Cash Equity vs Indices */}
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 mr-1">Universe:</span>
                        {[
                            { id: "all", label: "All Assets" },
                            { id: "fno", label: "F&O (Options Stocks)" },
                            { id: "equity", label: "Cash Equities" },
                            { id: "indices", label: "7 Indices" },
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
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search symbol, sector..."
                            className="w-full rounded-xl border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
                        />
                        {query && (
                            <button
                                onClick={() => setQuery("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Infinite Scroll Responsive Table */}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-900">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[720px]">
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
                                    className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <span>Day Change</span>
                                        {sortKey === "pChange" && (
                                            sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                        )}
                                    </div>
                                </th>
                                <th
                                    onClick={() => handleSort("yearLow")}
                                    className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <span>52W Low</span>
                                        {sortKey === "yearLow" && (
                                            sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                        )}
                                    </div>
                                </th>
                                <th
                                    onClick={() => handleSort("yearHigh")}
                                    className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <span>52W High</span>
                                        {sortKey === "yearHigh" && (
                                            sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                        )}
                                    </div>
                                </th>
                                <th
                                    onClick={() => handleSort("distFromHigh")}
                                    className="cursor-pointer px-4 py-3 font-semibold text-right hover:text-gray-900 dark:hover:text-white select-none"
                                >
                                    <div className="flex items-center justify-end gap-1">
                                        <span>Proximity</span>
                                        {sortKey === "distFromHigh" && (
                                            sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                        )}
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                            {visibleItems.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                                        {loading ? "Scanning 52-week high & low universe..." : "No matching securities found."}
                                    </td>
                                </tr>
                            ) : (
                                visibleItems.map((item, idx) => {
                                    const isPos = item.pChange >= 0;
                                    const isIndex = item.type === "index";
                                    const isNearHigh = item.distFromHigh <= 5.0;
                                    const isNearLow = item.distFromLow <= 5.0;

                                    return (
                                        <tr
                                            key={item.symbol}
                                            className={`hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition ${
                                                isIndex ? "bg-blue-50/20 dark:bg-blue-950/10" : ""
                                            }`}
                                        >
                                            {/* Stock & Sector */}
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
                                                            ) : item.isFno ? (
                                                                <span className="rounded-sm bg-emerald-100 px-1 py-0.2 text-[9px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                                    F&O
                                                                </span>
                                                            ) : null}
                                                            <span className="rounded-sm bg-gray-100 px-1 py-0.2 text-[9px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                                {item.mcapTier}
                                                            </span>
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

                                            {/* Day Change */}
                                            <td className="px-4 py-3 text-right font-mono">
                                                <div
                                                    className={`inline-flex items-center gap-0.5 font-bold ${
                                                        isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                    }`}
                                                >
                                                    {isPos ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
                                                    {isPos ? "+" : ""}{item.pChange}%
                                                </div>
                                            </td>

                                            {/* 52W Low */}
                                            <td className="px-4 py-3 text-right font-mono text-gray-500 dark:text-gray-400">
                                                ₹{formatPrice(item.yearLow)}
                                            </td>

                                            {/* 52W High */}
                                            <td className="px-4 py-3 text-right font-mono text-gray-500 dark:text-gray-400">
                                                ₹{formatPrice(item.yearHigh)}
                                            </td>

                                            {/* Proximity Badge */}
                                            <td className="px-4 py-3 text-right font-mono">
                                                {item.isNewHighToday ? (
                                                    <span className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white shadow-xs">
                                                        ★ New High
                                                    </span>
                                                ) : item.isNewLowToday ? (
                                                    <span className="rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white shadow-xs">
                                                        ★ New Low
                                                    </span>
                                                ) : isNearHigh ? (
                                                    <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                                        -{item.distFromHigh}% from High
                                                    </span>
                                                ) : isNearLow ? (
                                                    <span className="rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                                        +{item.distFromLow}% from Low
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 text-[11px]">
                                                        -{item.distFromHigh}% / +{item.distFromLow}%
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

                {/* Infinite Scroll Trigger Sentinel & Loading Indicator */}
                <div ref={observerRef} className="py-4 text-center">
                    {hasMore ? (
                        <div className="inline-flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                            <FiRefreshCw className="animate-spin text-emerald-600" size={13} />
                            <span>Loading more stocks on scroll ({visibleItems.length} / {sortedList.length})...</span>
                        </div>
                    ) : sortedList.length > 0 ? (
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                            ✓ All {sortedList.length} securities loaded
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
