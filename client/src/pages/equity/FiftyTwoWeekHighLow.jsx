import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
// pages/equity/FiftyTwoWeekHighLow.jsx — 52-Week High & Low Interactive Scanner Cockpit with Lazy Loading
import { Link } from "react-router-dom";
import { fetch52WeekHighLow } from "../../services/equityApi";
import { formatPrice, formatNumber } from "../../utils/format";
import {
    FiRefreshCw,
    FiSearch,
    FiArrowUpRight,
    FiArrowDownRight,
    FiArrowUp,
    FiArrowDown,
    FiDownload,
    FiTrendingUp,
    FiTrendingDown,
    FiList,
    FiGrid,
    FiExternalLink,
    FiX,
    FiCheck,
    FiCopy,
    FiSliders,
    FiMaximize2,
    FiZap,
} from "react-icons/fi";

const DEFAULT_BATCH_SIZE = 30;
const SKELETON_ROWS = 10;

// Skeleton pulse placeholder for initial and chunk loading
function Bone({ className = "" }) {
    return <div className={`animate-pulse rounded-md bg-gray-200/80 dark:bg-gray-800 ${className}`} />;
}

// 52-Week Range position formula: 0 (at 52W Low) to 100 (at 52W High)
function getRangePosition(price, yearLow, yearHigh) {
    const low = Number(yearLow) || 0;
    const high = Number(yearHigh) || low || 1;
    const current = Number(price) || low;
    const span = high - low;
    if (span <= 0) return 50;
    const pos = Math.round(((current - low) / span) * 100);
    return Math.max(0, Math.min(100, pos));
}

// Annual spread between 52W Low and 52W High in %
function getAnnualSpread(yearLow, yearHigh) {
    const low = Number(yearLow) || 0;
    const high = Number(yearHigh) || 0;
    if (low <= 0) return 0;
    return (((high - low) / low) * 100).toFixed(1);
}

// Interactive mini-gauge showing 52-week price position
function RangeGauge({ yearLow, yearHigh, rangePos }) {
    const isBreakout = rangePos >= 85;
    const isBreakdown = rangePos <= 15;

    return (
        <div className="flex flex-col gap-1 w-full max-w-[190px]">
            <div className="flex items-center justify-between text-micro text-fg-subtle font-mono tabular-nums">
                <span>₹{formatPrice(yearLow)}</span>
                <span className={`font-semibold ${isBreakout ? "text-up" : isBreakdown ? "text-down" : "text-fg-muted"}`}>
                    {rangePos}%
                </span>
                <span>₹{formatPrice(yearHigh)}</span>
            </div>
            <div className="relative h-2 w-full rounded-full bg-surface-raised overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-500/25 via-amber-500/15 to-emerald-500/25 w-full" />
                <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
                        isBreakout ? "bg-emerald-500" : isBreakdown ? "bg-rose-500" : "bg-emerald-600/70"
                    }`}
                    style={{ width: `${Math.max(2, Math.min(100, rangePos))}%` }}
                />
                <div
                    className="absolute top-0 bottom-0 w-1.5 -ml-0.75 bg-fg rounded-full shadow-xs"
                    style={{ left: `${Math.max(1, Math.min(99, rangePos))}%` }}
                />
            </div>
        </div>
    );
}

export default function FiftyTwoWeekHighLow() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState("all"); // 'all' | 'nearHigh' | 'nearLow' | 'newHigh' | 'newLow'
    const [categoryFilter, setCategoryFilter] = useState("all"); // 'all' | 'fno' | 'equity' | 'indices' | 'Large Cap' | 'Mid Cap'
    const [sectorFilter, setSectorFilter] = useState("all"); // 'all' | specific sector
    const [proximityFilter, setProximityFilter] = useState("all"); // 'all' | '2' | '5' | '10'
    const [viewMode, setViewMode] = useState("table"); // 'table' | 'grid'
    const [query, setQuery] = useState("");
    const [sortKey, setSortKey] = useState("distFromHigh");
    const [sortDir, setSortDir] = useState("asc");

    // Progressive Lazy Loading State
    const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
    const [visibleCount, setVisibleCount] = useState(DEFAULT_BATCH_SIZE);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    // Selected stock for telemetry modal & copy toast
    const [selectedStock, setSelectedStock] = useState(null);
    const [copiedSymbol, setCopiedSymbol] = useState(null);

    // Infinite scroll observer sentinel target
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

    // Escape key closes modal
    useEffect(() => {
        function onKeyDown(e) {
            if (e.key === "Escape") setSelectedStock(null);
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    // Reset pagination when filter/search/tab/batch size changes
    useEffect(() => {
        setVisibleCount(batchSize);
    }, [tab, categoryFilter, sectorFilter, proximityFilter, query, sortKey, sortDir, viewMode, batchSize]);

    // Handle column sorting
    function handleSort(key) {
        if (sortKey === key) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "pChange" || key === "rangePosition" ? "desc" : "asc");
        }
    }

    // Copy symbol helper with toast timer
    function copySymbol(sym) {
        if (!sym) return;
        navigator.clipboard.writeText(sym);
        setCopiedSymbol(sym);
        setTimeout(() => setCopiedSymbol(null), 1500);
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

    // Extract dynamic unique sectors with counts from all universe
    const sectorsList = useMemo(() => {
        if (!data?.all) return [];
        const counts = {};
        data.all.forEach((s) => {
            if (s.sector) {
                counts[s.sector] = (counts[s.sector] || 0) + 1;
            }
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }, [data]);

    // Enriched list with pre-computed range position
    const enrichedBaseList = useMemo(() => {
        return baseList.map((item) => ({
            ...item,
            rangePosition: getRangePosition(item.price, item.yearLow, item.yearHigh),
        }));
    }, [baseList]);

    // Filter by Category, Sector, Proximity, and Search
    const filteredList = useMemo(() => {
        return enrichedBaseList.filter((item) => {
            // Category Filter
            if (categoryFilter === "fno" && !item.isFno) return false;
            if (categoryFilter === "equity" && (item.isFno || item.type === "index")) return false;
            if (categoryFilter === "indices" && item.type !== "index") return false;
            if (categoryFilter === "Large Cap" && item.mcapTier !== "Large Cap") return false;
            if (categoryFilter === "Mid Cap" && item.mcapTier !== "Mid Cap") return false;

            // Sector Filter
            if (sectorFilter !== "all" && item.sector !== sectorFilter) return false;

            // Proximity Filter
            if (proximityFilter !== "all") {
                const thresh = Number(proximityFilter);
                if (tab === "nearHigh" || tab === "newHigh") {
                    if (item.distFromHigh > thresh) return false;
                } else if (tab === "nearLow" || tab === "newLow") {
                    if (item.distFromLow > thresh) return false;
                } else {
                    if (item.distFromHigh > thresh && item.distFromLow > thresh) return false;
                }
            }

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
    }, [enrichedBaseList, categoryFilter, sectorFilter, proximityFilter, tab, query]);

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

    // Visible sliced items for progressive lazy rendering
    const visibleItems = useMemo(() => {
        return sortedList.slice(0, visibleCount);
    }, [sortedList, visibleCount]);

    const hasMore = visibleCount < sortedList.length;

    // Load next progressive chunk
    const loadNextBatch = useCallback(() => {
        if (visibleCount >= sortedList.length || isLoadingMore) return;
        setIsLoadingMore(true);
        setTimeout(() => {
            setVisibleCount((prev) => Math.min(prev + batchSize, sortedList.length));
            setIsLoadingMore(false);
        }, 200);
    }, [visibleCount, sortedList.length, batchSize, isLoadingMore]);

    // IntersectionObserver for infinite scroll lazy loading
    const handleObserver = useCallback(
        (entries) => {
            const target = entries[0];
            if (target.isIntersecting && hasMore && !isLoadingMore) {
                loadNextBatch();
            }
        },
        [hasMore, isLoadingMore, loadNextBatch]
    );

    useEffect(() => {
        const option = { root: null, rootMargin: "300px", threshold: 0.1 };
        const observer = new IntersectionObserver(handleObserver, option);
        const currentRef = observerRef.current;
        if (currentRef) observer.observe(currentRef);
        return () => {
            if (currentRef) observer.unobserve(currentRef);
        };
    }, [handleObserver]);

    // Active filters count & reset
    const activeFiltersCount =
        (categoryFilter !== "all" ? 1 : 0) +
        (sectorFilter !== "all" ? 1 : 0) +
        (proximityFilter !== "all" ? 1 : 0) +
        (query.trim() ? 1 : 0);

    function resetFilters() {
        setCategoryFilter("all");
        setSectorFilter("all");
        setProximityFilter("all");
        setQuery("");
    }

    // Export to CSV
    function exportToCsv() {
        if (!sortedList.length) return;
        const headers = [
            "Symbol",
            "Name",
            "Type",
            "F&O",
            "Sector",
            "LTP (INR)",
            "Change (%)",
            "52W High",
            "52W Low",
            "52W Range Position (%)",
            "% From High",
            "% From Low",
        ];
        const rows = sortedList.map((i) => [
            i.symbol,
            `"${i.name || i.symbol}"`,
            i.type,
            i.isFno ? "Yes" : "No",
            `"${i.sector || ""}"`,
            i.price,
            i.pChange,
            i.yearHigh,
            i.yearLow,
            i.rangePosition,
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

    const lazyProgressPercent = sortedList.length > 0 ? Math.round((visibleItems.length / sortedList.length) * 100) : 100;

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
                    {/* View Switcher: Table vs Cards */}
                    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5 shadow-xs">
                        <button
                            onClick={() => setViewMode("table")}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                                viewMode === "table"
                                    ? "bg-surface-raised text-fg shadow-xs font-semibold"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                            title="Table View"
                        >
                            <FiList size={13} />
                            <span className="hidden sm:inline">Table</span>
                        </button>
                        <button
                            onClick={() => setViewMode("grid")}
                            className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                                viewMode === "grid"
                                    ? "bg-surface-raised text-fg shadow-xs font-semibold"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                            title="Visual Cards Grid"
                        >
                            <FiGrid size={13} />
                            <span className="hidden sm:inline">Cards</span>
                        </button>
                    </div>

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
            {loading && !data ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {[0, 1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className="flex flex-col rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs dark:border-gray-800 dark:bg-gray-900"
                        >
                            <div className="flex items-center justify-between">
                                <Bone className="h-3.5 w-24" />
                                <Bone className="h-3.5 w-3.5 rounded-full" />
                            </div>
                            <div className="mt-2 flex items-baseline gap-2">
                                <Bone className="h-7 w-16" />
                                <Bone className="h-3 w-12" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {/* Near High */}
                    <button
                        onClick={() => setTab(tab === "nearHigh" ? "all" : "nearHigh")}
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
                            <span className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-2xl">
                                {summary.nearHighCount}
                            </span>
                            <span className="text-label text-gray-400">&lt;5% away</span>
                        </div>
                    </button>

                    {/* Near Low */}
                    <button
                        onClick={() => setTab(tab === "nearLow" ? "all" : "nearLow")}
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
                            <span className="text-xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 sm:text-2xl">
                                {summary.nearLowCount}
                            </span>
                            <span className="text-label text-gray-400">&lt;5% away</span>
                        </div>
                    </button>

                    {/* New High Today */}
                    <button
                        onClick={() => setTab(tab === "newHigh" ? "all" : "newHigh")}
                        className={`flex flex-col rounded-xl border p-3.5 text-left transition ${
                            tab === "newHigh"
                                ? "border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500 dark:bg-emerald-950/30"
                                : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                        }`}
                    >
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-medium">New High Today</span>
                            <span className="rounded-full bg-emerald-100 px-1.5 py-0.2 text-micro font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                Record
                            </span>
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5">
                            <span className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 sm:text-2xl">
                                {summary.newHighCount}
                            </span>
                            <span className="text-label text-gray-400">Stocks</span>
                        </div>
                    </button>

                    {/* New Low Today */}
                    <button
                        onClick={() => setTab(tab === "newLow" ? "all" : "newLow")}
                        className={`flex flex-col rounded-xl border p-3.5 text-left transition ${
                            tab === "newLow"
                                ? "border-rose-500 bg-rose-50/60 ring-1 ring-rose-500 dark:bg-rose-950/30"
                                : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                        }`}
                    >
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                            <span className="font-medium">New Low Today</span>
                            <span className="rounded-full bg-rose-100 px-1.5 py-0.2 text-micro font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                Record
                            </span>
                        </div>
                        <div className="mt-1 flex items-baseline gap-1.5">
                            <span className="text-xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 sm:text-2xl">
                                {summary.newLowCount}
                            </span>
                            <span className="text-label text-gray-400">Stocks</span>
                        </div>
                    </button>
                </div>
            )}

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
                                {loading && !data ? (
                                    <Bone className="h-3.5 w-6 rounded-full" />
                                ) : (
                                    t.count > 0 && (
                                        <span
                                            className={`rounded-full px-1.5 py-0.2 text-micro font-mono tabular-nums ${
                                                tab === t.id
                                                    ? "bg-white/20 text-white"
                                                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                            }`}
                                        >
                                            {t.count}
                                        </span>
                                    )
                                )}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        {loading && !data ? (
                            <Bone className="h-4 w-28" />
                        ) : (
                            <div className="inline-flex items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-md bg-surface-raised px-2 py-0.5 text-micro font-medium text-fg-muted">
                                    <FiZap size={11} className="text-emerald-500" />
                                    <span>Lazy Loaded</span>
                                </span>
                                <span>
                                    <strong className="text-gray-900 dark:text-white font-mono tabular-nums">{visibleItems.length}</strong> of{" "}
                                    <strong className="text-gray-900 dark:text-white font-mono tabular-nums">{sortedList.length}</strong>
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sub-Filters: Universe, Sector Dropdown, Proximity Chips & Search */}
                <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        {/* Universe Pills */}
                        <div className="flex items-center gap-1">
                            <span className="text-xs font-medium text-gray-400 dark:text-gray-500 mr-0.5">Universe:</span>
                            {[
                                { id: "all", label: "All" },
                                { id: "fno", label: "F&O" },
                                { id: "equity", label: "Equities" },
                                { id: "indices", label: "Indices" },
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

                        {/* Sector Dropdown */}
                        <div className="flex items-center gap-1">
                            <span className="text-xs font-medium text-gray-400 dark:text-gray-500">Sector:</span>
                            <select
                                value={sectorFilter}
                                onChange={(e) => setSectorFilter(e.target.value)}
                                aria-label="Filter by Sector"
                                className="rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-fg focus:border-emerald-500 focus:outline-none"
                            >
                                <option value="all">All Sectors ({data?.all?.length || 0})</option>
                                {sectorsList.map(([sectorName, count]) => (
                                    <option key={sectorName} value={sectorName}>
                                        {sectorName} ({count})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Proximity Distance Chips */}
                        <div className="flex items-center gap-1">
                            <FiSliders size={12} className="text-gray-400" />
                            <span className="text-xs font-medium text-gray-400 dark:text-gray-500">Distance:</span>
                            {[
                                { id: "all", label: "All" },
                                { id: "2", label: "≤2% Breakout" },
                                { id: "5", label: "≤5% Target" },
                                { id: "10", label: "≤10%" },
                            ].map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => setProximityFilter(p.id)}
                                    className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                                        proximityFilter === p.id
                                            ? "bg-emerald-600 text-white"
                                            : "border border-line bg-surface text-fg-muted hover:bg-surface-hover"
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>

                        {/* Search Input */}
                        <div className="relative w-full sm:w-56">
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

                        {/* Active Filters Clear Button */}
                        {activeFiltersCount > 0 && (
                            <button
                                onClick={resetFilters}
                                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-hover transition"
                                title="Reset all active filters"
                            >
                                <FiX size={12} />
                                <span>Clear ({activeFiltersCount})</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Content View: Interactive Table OR Cards Grid */}
            {viewMode === "table" ? (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-900">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs min-w-[760px]">
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
                                        onClick={() => handleSort("rangePosition")}
                                        className="cursor-pointer px-4 py-3 font-semibold text-center hover:text-gray-900 dark:hover:text-white select-none"
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            <span>52-Week Range (L - H)</span>
                                            {sortKey === "rangePosition" && (
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
                                            <span>Proximity Status</span>
                                            {sortKey === "distFromHigh" && (
                                                sortDir === "asc" ? <FiArrowUp size={12} /> : <FiArrowDown size={12} />
                                            )}
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                                {loading && !data ? (
                                    Array.from({ length: SKELETON_ROWS }, (_, i) => (
                                        <tr key={i} className="border-b border-gray-100 dark:border-gray-800/60">
                                            {/* Stock & Sector */}
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <Bone className="h-5 w-5 shrink-0 rounded-full" />
                                                    <div className="space-y-1.5">
                                                        <div className="flex items-center gap-1.5">
                                                            <Bone className="h-3.5 w-20" />
                                                            <Bone className="h-3 w-10 rounded-sm" />
                                                        </div>
                                                        <Bone className="h-2.5 w-28" />
                                                    </div>
                                                </div>
                                            </td>
                                            {/* LTP */}
                                            <td className="px-4 py-3 text-right">
                                                <Bone className="ml-auto h-4 w-16" />
                                            </td>
                                            {/* Day Change */}
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex flex-col items-end gap-1">
                                                    <Bone className="h-3.5 w-14" />
                                                    <Bone className="h-2.5 w-10" />
                                                </div>
                                            </td>
                                            {/* 52W Range Gauge */}
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col items-center gap-1.5 mx-auto max-w-[180px]">
                                                    <div className="flex justify-between w-full">
                                                        <Bone className="h-2.5 w-12" />
                                                        <Bone className="h-2.5 w-12" />
                                                    </div>
                                                    <Bone className="h-2 w-full rounded-full" />
                                                </div>
                                            </td>
                                            {/* 52W High */}
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex flex-col items-end gap-1">
                                                    <Bone className="h-3.5 w-16" />
                                                    <Bone className="h-2.5 w-12" />
                                                </div>
                                            </td>
                                            {/* Proximity */}
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex flex-col items-end gap-1.5">
                                                    <Bone className="h-5 w-20 rounded-md" />
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                ) : visibleItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-10 text-center text-gray-500 dark:text-gray-400">
                                            <p className="text-sm font-semibold text-fg">No matching securities found</p>
                                            <p className="text-label text-fg-subtle mt-1">Try clearing proximity, sector, or search filters.</p>
                                            {activeFiltersCount > 0 && (
                                                <button
                                                    onClick={resetFilters}
                                                    className="mt-3 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                                                >
                                                    Reset All Filters
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    <>
                                        {visibleItems.map((item, idx) => {
                                            const isPos = item.pChange >= 0;
                                            const isIndex = item.type === "index";
                                            const isNearHigh = item.distFromHigh <= 5.0;
                                            const isNearLow = item.distFromLow <= 5.0;

                                            return (
                                                <tr
                                                    key={item.symbol}
                                                    onClick={() => setSelectedStock(item)}
                                                    className={`group cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-800/50 transition ${
                                                        isIndex ? "bg-blue-50/20 dark:bg-blue-950/10" : ""
                                                    }`}
                                                >
                                                    {/* Stock & Sector */}
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-micro font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                                                {idx + 1}
                                                            </span>
                                                            <div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="font-bold text-gray-900 dark:text-white text-xs sm:text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                                                        {item.symbol}
                                                                    </span>
                                                                    {isIndex ? (
                                                                        <span className="rounded-sm bg-blue-100 px-1 py-0.2 text-micro font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                                                            INDEX
                                                                        </span>
                                                                    ) : item.isFno ? (
                                                                        <span className="rounded-sm bg-emerald-100 px-1 py-0.2 text-micro font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                                            F&O
                                                                        </span>
                                                                    ) : null}
                                                                    <span className="rounded-sm bg-gray-100 px-1 py-0.2 text-micro font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                                        {item.mcapTier}
                                                                    </span>
                                                                </div>
                                                                <div className="text-label text-gray-400 dark:text-gray-500 truncate max-w-[160px] sm:max-w-[220px]">
                                                                    {item.name !== item.symbol ? item.name : item.sector}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* LTP */}
                                                    <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-gray-900 dark:text-white">
                                                        ₹{formatPrice(item.price)}
                                                    </td>

                                                    {/* Day Change */}
                                                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                                                        <div
                                                            className={`inline-flex items-center gap-0.5 font-bold ${
                                                                isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                            }`}
                                                        >
                                                            {isPos ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
                                                            {isPos ? "+" : ""}{item.pChange}%
                                                        </div>
                                                    </td>

                                                    {/* 52-Week Range Mini-Gauge */}
                                                    <td className="px-4 py-3">
                                                        <div className="flex justify-center">
                                                            <RangeGauge
                                                                yearLow={item.yearLow}
                                                                yearHigh={item.yearHigh}
                                                                rangePos={item.rangePosition}
                                                            />
                                                        </div>
                                                    </td>

                                                    {/* 52W High */}
                                                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                                                        <div className="font-semibold text-fg">₹{formatPrice(item.yearHigh)}</div>
                                                        <div className="text-micro text-fg-subtle">
                                                            Low: ₹{formatPrice(item.yearLow)}
                                                        </div>
                                                    </td>

                                                    {/* Proximity Status & Inspect Action */}
                                                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                                                        <div className="inline-flex items-center gap-1.5">
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
                                                                    -{item.distFromHigh}% High
                                                                </span>
                                                            ) : isNearLow ? (
                                                                <span className="rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                                                    +{item.distFromLow}% Low
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400 text-label">
                                                                    -{item.distFromHigh}% / +{item.distFromLow}%
                                                                </span>
                                                            )}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedStock(item);
                                                                }}
                                                                className="rounded-md p-1 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg hover:bg-surface-raised transition"
                                                                title="Inspect Telemetry"
                                                            >
                                                                <FiMaximize2 size={13} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}

                                        {/* Streaming Skeleton Rows when next chunk is loading */}
                                        {isLoadingMore &&
                                            Array.from({ length: 3 }, (_, i) => (
                                                <tr key={`loading-chunk-${i}`} className="border-b border-line/40 bg-surface-muted/30">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <Bone className="h-5 w-5 shrink-0 rounded-full" />
                                                            <div className="space-y-1">
                                                                <Bone className="h-3.5 w-20" />
                                                                <Bone className="h-2.5 w-24" />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right"><Bone className="ml-auto h-4 w-16" /></td>
                                                    <td className="px-4 py-3 text-right"><Bone className="ml-auto h-3.5 w-14" /></td>
                                                    <td className="px-4 py-3"><Bone className="mx-auto h-2 w-36 rounded-full" /></td>
                                                    <td className="px-4 py-3 text-right"><Bone className="ml-auto h-3.5 w-16" /></td>
                                                    <td className="px-4 py-3 text-right"><Bone className="ml-auto h-5 w-20 rounded-md" /></td>
                                                </tr>
                                            ))}
                                    </>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                /* Visual Cards Grid View */
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {loading && !data ? (
                        Array.from({ length: 6 }, (_, i) => (
                            <div
                                key={i}
                                className="rounded-xl border border-line bg-surface p-4 shadow-xs space-y-3"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <Bone className="h-5 w-5 rounded-full" />
                                        <div className="space-y-1.5">
                                            <Bone className="h-3.5 w-24" />
                                            <Bone className="h-2.5 w-16" />
                                        </div>
                                    </div>
                                    <Bone className="h-6 w-16" />
                                </div>
                                <Bone className="h-2 w-full rounded-full" />
                                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line">
                                    <Bone className="h-8" />
                                    <Bone className="h-8" />
                                </div>
                            </div>
                        ))
                    ) : visibleItems.length === 0 ? (
                        <div className="col-span-full rounded-xl border border-line bg-surface p-12 text-center text-fg-muted">
                            <p className="text-sm font-semibold text-fg">No matching securities found in Grid view</p>
                            <p className="text-label text-fg-subtle mt-1">Try clearing active filters to see all available securities.</p>
                            {activeFiltersCount > 0 && (
                                <button
                                    onClick={resetFilters}
                                    className="mt-3 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                                >
                                    Reset All Filters
                                </button>
                            )}
                        </div>
                    ) : (
                        <>
                            {visibleItems.map((item, idx) => {
                                const isPos = item.pChange >= 0;
                                const isIndex = item.type === "index";
                                const isNearHigh = item.distFromHigh <= 5.0;
                                const isNearLow = item.distFromLow <= 5.0;

                                return (
                                    <div
                                        key={item.symbol}
                                        onClick={() => setSelectedStock(item)}
                                        className={`group cursor-pointer rounded-xl border border-line bg-surface p-4 shadow-xs transition hover:border-emerald-500/50 hover:shadow-md ${
                                            isIndex ? "ring-1 ring-blue-400/30" : ""
                                        }`}
                                    >
                                        {/* Card Header: Symbol, Badges & Price */}
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-micro font-bold text-fg-muted">
                                                    {idx + 1}
                                                </span>
                                                <div>
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-bold text-fg text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                                            {item.symbol}
                                                        </span>
                                                        {isIndex ? (
                                                            <span className="rounded-sm bg-blue-100 px-1.5 py-0.2 text-micro font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                                                INDEX
                                                            </span>
                                                        ) : item.isFno ? (
                                                            <span className="rounded-sm bg-emerald-100 px-1.5 py-0.2 text-micro font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                                                F&O
                                                            </span>
                                                        ) : null}
                                                        <span className="rounded-sm bg-surface-raised px-1.5 py-0.2 text-micro font-medium text-fg-muted">
                                                            {item.mcapTier}
                                                        </span>
                                                    </div>
                                                    <div className="text-label text-fg-muted truncate max-w-[160px]">
                                                        {item.name !== item.symbol ? item.name : item.sector}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="text-right">
                                                <div className="font-mono tabular-nums font-bold text-fg text-sm">
                                                    ₹{formatPrice(item.price)}
                                                </div>
                                                <div
                                                    className={`inline-flex items-center gap-0.5 text-label font-bold font-mono tabular-nums ${
                                                        isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                    }`}
                                                >
                                                    {isPos ? <FiArrowUpRight size={11} /> : <FiArrowDownRight size={11} />}
                                                    {isPos ? "+" : ""}{item.pChange}%
                                                </div>
                                            </div>
                                        </div>

                                        {/* 52-Week Range Gauge Visual */}
                                        <div className="mt-3.5 space-y-1">
                                            <RangeGauge
                                                yearLow={item.yearLow}
                                                yearHigh={item.yearHigh}
                                                rangePos={item.rangePosition}
                                            />
                                        </div>

                                        {/* Milestone & Annual Spread Footer */}
                                        <div className="mt-3.5 flex items-center justify-between border-t border-line pt-2.5">
                                            <div className="text-micro text-fg-subtle">
                                                Swing: <strong className="text-fg font-mono tabular-nums">{getAnnualSpread(item.yearLow, item.yearHigh)}%</strong>
                                            </div>
                                            <div>
                                                {item.isNewHighToday ? (
                                                    <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-micro font-bold text-white shadow-xs">
                                                        ★ New High
                                                    </span>
                                                ) : item.isNewLowToday ? (
                                                    <span className="rounded-md bg-rose-600 px-2 py-0.5 text-micro font-bold text-white shadow-xs">
                                                        ★ New Low
                                                    </span>
                                                ) : isNearHigh ? (
                                                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-micro font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                                                        -{item.distFromHigh}% High
                                                    </span>
                                                ) : isNearLow ? (
                                                    <span className="rounded-md bg-rose-50 px-2 py-0.5 text-micro font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                                                        +{item.distFromLow}% Low
                                                    </span>
                                                ) : (
                                                    <span className="text-micro text-fg-subtle font-mono tabular-nums">
                                                        -{item.distFromHigh}% H
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Streaming Skeleton Cards when next chunk is loading in grid */}
                            {isLoadingMore &&
                                Array.from({ length: 3 }, (_, i) => (
                                    <div key={`loading-chunk-grid-${i}`} className="rounded-xl border border-line bg-surface p-4 shadow-xs space-y-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-2">
                                                <Bone className="h-5 w-5 rounded-full" />
                                                <div className="space-y-1">
                                                    <Bone className="h-3.5 w-24" />
                                                    <Bone className="h-2.5 w-16" />
                                                </div>
                                            </div>
                                            <Bone className="h-5 w-14" />
                                        </div>
                                        <Bone className="h-2 w-full rounded-full" />
                                        <div className="pt-2 border-t border-line"><Bone className="h-4 w-28" /></div>
                                    </div>
                                ))}
                        </>
                    )}
                </div>
            )}

            {/* Infinite Scroll / Lazy Loading Sentinel & Bulk Control */}
            <div ref={observerRef} className="py-6 text-center space-y-3">
                {/* Progress Bar & Counter */}
                <div className="space-y-1 max-w-xs mx-auto">
                    <div className="flex items-center justify-between text-micro text-fg-subtle font-mono tabular-nums">
                        <span>Lazy Loaded: {visibleItems.length} of {sortedList.length}</span>
                        <span>{lazyProgressPercent}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-surface-raised overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 transition-all duration-300"
                            style={{ width: `${lazyProgressPercent}%` }}
                        />
                    </div>
                </div>

                {hasMore ? (
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                        <button
                            onClick={loadNextBatch}
                            disabled={isLoadingMore}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover shadow-xs active:scale-95 transition"
                        >
                            <FiRefreshCw size={12} className={isLoadingMore ? "animate-spin text-emerald-600" : ""} />
                            <span>Load Next {batchSize}</span>
                        </button>
                        <button
                            onClick={() => setVisibleCount(sortedList.length)}
                            className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg hover:bg-surface-hover transition"
                        >
                            <span>Load All ({sortedList.length})</span>
                        </button>
                        <div className="flex items-center gap-1 text-micro text-fg-subtle ml-2">
                            <span>Batch:</span>
                            {[30, 60, 100].map((b) => (
                                <button
                                    key={b}
                                    onClick={() => setBatchSize(b)}
                                    className={`rounded px-1.5 py-0.5 font-mono tabular-nums transition ${
                                        batchSize === b
                                            ? "bg-emerald-600 text-white font-bold"
                                            : "bg-surface-raised text-fg-muted hover:text-fg"
                                    }`}
                                >
                                    {b}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : sortedList.length > 0 ? (
                    <div className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <FiCheck size={14} />
                        <span>All {sortedList.length} securities loaded</span>
                    </div>
                ) : null}
            </div>

            {/* Interactive Stock Telemetry Quick Modal */}
            {selectedStock && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
                    onClick={() => setSelectedStock(null)}
                >
                    <div
                        className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl space-y-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base sm:text-lg font-bold text-fg">
                                        {selectedStock.symbol}
                                    </h3>
                                    {selectedStock.type === "index" ? (
                                        <span className="rounded-sm bg-blue-100 px-1.5 py-0.2 text-micro font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                            INDEX
                                        </span>
                                    ) : selectedStock.isFno ? (
                                        <span className="rounded-sm bg-emerald-100 px-1.5 py-0.2 text-micro font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                            F&O
                                        </span>
                                    ) : null}
                                    <span className="rounded-sm bg-surface-raised px-1.5 py-0.2 text-micro font-medium text-fg-muted">
                                        {selectedStock.mcapTier}
                                    </span>
                                </div>
                                <p className="text-label text-fg-muted mt-0.5">
                                    {selectedStock.name !== selectedStock.symbol ? selectedStock.name : selectedStock.sector}
                                    {selectedStock.industry ? ` • ${selectedStock.industry}` : ""}
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => copySymbol(selectedStock.symbol)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-fg-muted hover:text-fg hover:bg-surface-hover transition"
                                    title="Copy Symbol"
                                >
                                    {copiedSymbol === selectedStock.symbol ? (
                                        <>
                                            <FiCheck size={12} className="text-emerald-600" />
                                            <span className="text-micro text-emerald-600 font-semibold">Copied</span>
                                        </>
                                    ) : (
                                        <>
                                            <FiCopy size={12} />
                                            <span className="text-micro">Copy</span>
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={() => setSelectedStock(null)}
                                    className="rounded-lg p-1 text-fg-muted hover:text-fg hover:bg-surface-hover transition"
                                    title="Close"
                                >
                                    <FiX size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Price & Change Banner */}
                        <div className="flex items-center justify-between rounded-xl bg-surface-muted p-3.5 border border-line">
                            <div>
                                <span className="text-micro font-medium text-fg-subtle uppercase">Current Market Price</span>
                                <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-fg">
                                    ₹{formatPrice(selectedStock.price)}
                                </div>
                            </div>
                            <div className="text-right">
                                <span className="text-micro font-medium text-fg-subtle uppercase">Day Change</span>
                                <div
                                    className={`flex items-center justify-end gap-1 text-sm font-bold font-mono tabular-nums ${
                                        selectedStock.pChange >= 0 ? "text-up" : "text-down"
                                    }`}
                                >
                                    {selectedStock.pChange >= 0 ? <FiArrowUpRight size={15} /> : <FiArrowDownRight size={15} />}
                                    <span>
                                        {selectedStock.change > 0 ? "+" : ""}
                                        ₹{formatPrice(selectedStock.change)} ({selectedStock.pChange >= 0 ? "+" : ""}
                                        {selectedStock.pChange}%)
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* 52-Week Range Detailed Visual Box */}
                        <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-fg">52-Week Range Telemetry</span>
                                <span
                                    className={`rounded-full px-2 py-0.5 text-micro font-bold font-mono tabular-nums ${
                                        selectedStock.rangePosition >= 85
                                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                            : selectedStock.rangePosition <= 15
                                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                                            : "bg-surface-raised text-fg-muted"
                                    }`}
                                >
                                    {selectedStock.rangePosition}% of 52W Range
                                </span>
                            </div>

                            {/* Range Bar with Needle */}
                            <div className="space-y-1.5">
                                <div className="relative h-2.5 w-full rounded-full bg-surface-raised overflow-hidden">
                                    <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 w-full opacity-30" />
                                    <div
                                        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
                                            selectedStock.rangePosition >= 85
                                                ? "bg-emerald-500"
                                                : selectedStock.rangePosition <= 15
                                                ? "bg-rose-500"
                                                : "bg-emerald-600/70"
                                        }`}
                                        style={{ width: `${Math.max(2, Math.min(100, selectedStock.rangePosition))}%` }}
                                    />
                                    <div
                                        className="absolute top-0 bottom-0 w-2 -ml-1 bg-fg rounded-full shadow-md"
                                        style={{ left: `${Math.max(1, Math.min(99, selectedStock.rangePosition))}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-xs font-mono tabular-nums text-fg-muted">
                                    <div>
                                        <span className="text-micro text-fg-subtle block">52W Low</span>
                                        <span className="font-semibold text-fg">₹{formatPrice(selectedStock.yearLow)}</span>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-micro text-fg-subtle block">52W High</span>
                                        <span className="font-semibold text-fg">₹{formatPrice(selectedStock.yearHigh)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Distance Grid */}
                            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-line text-center">
                                <div className="rounded-lg bg-surface-muted p-2">
                                    <span className="text-micro text-fg-subtle block">From 52W High</span>
                                    <span className="text-xs font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                                        -{selectedStock.distFromHigh}%
                                    </span>
                                </div>
                                <div className="rounded-lg bg-surface-muted p-2">
                                    <span className="text-micro text-fg-subtle block">From 52W Low</span>
                                    <span className="text-xs font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                                        +{selectedStock.distFromLow}%
                                    </span>
                                </div>
                                <div className="rounded-lg bg-surface-muted p-2">
                                    <span className="text-micro text-fg-subtle block">Annual Swing</span>
                                    <span className="text-xs font-bold font-mono tabular-nums text-fg">
                                        {getAnnualSpread(selectedStock.yearLow, selectedStock.yearHigh)}%
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Quick Navigation Links */}
                        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-line">
                            {selectedStock.isFno && (
                                <Link
                                    to={`/option-chain?symbol=${selectedStock.symbol}`}
                                    onClick={() => setSelectedStock(null)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover transition"
                                >
                                    <FiExternalLink size={13} /> Option Chain
                                </Link>
                            )}
                            <Link
                                to="/equity-data/market-map"
                                onClick={() => setSelectedStock(null)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover transition"
                            >
                                <FiTrendingUp size={13} /> Market Map
                            </Link>
                            <a
                                href={`https://in.tradingview.com/chart/?symbol=NSE:${selectedStock.symbol}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover transition"
                            >
                                <FiExternalLink size={13} /> Chart
                            </a>
                            <button
                                onClick={() => setSelectedStock(null)}
                                className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
