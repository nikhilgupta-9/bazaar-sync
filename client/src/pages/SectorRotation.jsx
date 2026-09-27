// pages/SectorRotation.jsx
//
// Relative Rotation Graph (RRG) — shows each NSE sector's relative Trend (RS-Ratio)
// vs Momentum (RS-Momentum) against a benchmark (Major Indices & Heavyweight Stocks),
// with historical rotation tails showing sector rotation between 4 market quadrants:
// Leading, Weakening, Lagging, and Improving.
//
// Connected to live Upstox & database quotes API (/api/equity/sectors).

import { useEffect, useMemo, useState, useRef } from "react";
import { NavLink } from "react-router-dom";
import {
    FiPlay,
    FiPause,
    FiZoomIn,
    FiZoomOut,
    FiMaximize2,
    FiRefreshCw,
    FiGrid,
    FiActivity,
    FiTrendingUp,
    FiBarChart2,
    FiSearch,
    FiSliders,
    FiX,
    FiHelpCircle,
} from "react-icons/fi";
import {
    BENCHMARKS,
    SECTOR_CATEGORIES,
    buildLiveRrgDataset,
    classifyQuadrant,
    QUADRANT_COLORS,
    TAIL_LENGTH,
} from "../utils/rrgData";
import { fetchSectorIndices } from "../services/equityApi";
import { formatPrice } from "../utils/format";

const EQUITY_TABS = [
    { to: "/equity-data/market-map", label: "Market Map", icon: FiGrid },
    { to: "/equity-data/52-week-high-low", label: "52-Week High/Low", icon: FiActivity },
    { to: "/equity-data/industry-momentum", label: "Industry Momentum", icon: FiTrendingUp },
    { to: "/equity-data/most-active", label: "High Activity Options", icon: FiBarChart2 },
    { to: "/equity-data/sector-performance", label: "Sector Performance", icon: FiTrendingUp },
    { to: "/equity-data/sector-rotation", label: "Sector Rotation (RRG)", icon: FiActivity, active: true },
];

const QUADRANT_ORDER = ["Leading", "Weakening", "Lagging", "Improving"];

const QUADRANT_CONFIG = {
    Leading: {
        badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700",
        pill: "text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800",
        action: "Bullish Outperformer • Look for continuation & long setups",
        tag: "Leading ↗",
        direction: "↗",
    },
    Weakening: {
        badge: "bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-700",
        pill: "text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800",
        action: "Mature Trend • Momentum slowing, tighten trailing stop-loss",
        tag: "Weakening ↘",
        direction: "↘",
    },
    Lagging: {
        badge: "bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-300 dark:border-rose-700",
        pill: "text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800",
        action: "Underperformer • Avoid fresh longs / hedge downside",
        tag: "Lagging ↙",
        direction: "↙",
    },
    Improving: {
        badge: "bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300 dark:border-blue-700",
        pill: "text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800",
        action: "Early Turnaround • Accumulate quality leaders on dips",
        tag: "Improving ↖",
        direction: "↖",
    },
};

function niceTicks(min, max, targetCount) {
    const span = max - min;
    if (!Number.isFinite(span) || span <= 0) return [min];
    const rawStep = span / targetCount;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : norm >= 1 ? 1 : 0.5) * mag;
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(6)));
    return ticks;
}

function computeDomain(dataset) {
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    dataset.forEach((s) => s.path.forEach((p) => {
        xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
        yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
    }));
    // Center domain nicely around 100 with adequate visual breathing room
    xMin = Math.min(xMin, 98.2);
    xMax = Math.max(xMax, 101.8);
    yMin = Math.min(yMin, 98.2);
    yMax = Math.max(yMax, 101.8);

    const padX = (xMax - xMin) * 0.15 || 2;
    const padY = (yMax - yMin) * 0.15 || 2;
    return { xMin: xMin - padX, xMax: xMax + padX, yMin: yMin - padY, yMax: yMax + padY };
}

export default function SectorRotation() {
    const [liveSectors, setLiveSectors] = useState([]);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [benchmark, setBenchmark] = useState("NIFTY_50");
    const [timeframe, setTimeframe] = useState("daily"); // 'daily' | 'weekly' | 'monthly'
    const [categoryFilter, setCategoryFilter] = useState("ALL");
    const [tailWindow, setTailWindow] = useState(8);
    const [scrubIndex, setScrubIndex] = useState(TAIL_LENGTH - 1);
    const [playing, setPlaying] = useState(false);
    const [playSpeed, setPlaySpeed] = useState(1); // 1x, 2x
    const [zoom, setZoom] = useState(1);
    const [searchQuery, setSearchQuery] = useState("");
    const [quadrantFilter, setQuadrantFilter] = useState("ALL");
    const [focusKey, setFocusKey] = useState(null);
    const [hoveredSector, setHoveredSector] = useState(null);
    const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
    const [viewMode, setViewMode] = useState("chart"); // 'chart' | 'matrix' | 'both'
    const [guideOpen, setGuideOpen] = useState(false);

    const refreshTimerRef = useRef(null);

    // Fetch live quotes from backend API
    function loadData() {
        setLoading(true);
        fetchSectorIndices()
            .then((res) => {
                if (res?.sectors && Array.isArray(res.sectors)) {
                    setLiveSectors(res.sectors);
                    setLastUpdated(res.timestamp || new Date().toISOString());
                }
            })
            .catch((err) => {
                console.error("[SectorRotation] Failed to load sector data:", err);
            })
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadData();
        refreshTimerRef.current = setInterval(loadData, 45000);
        return () => clearInterval(refreshTimerRef.current);
    }, []);

    // Generate dynamic RRG dataset
    const fullDataset = useMemo(() => {
        return buildLiveRrgDataset(liveSectors, benchmark, timeframe);
    }, [liveSectors, benchmark, timeframe]);

    const [visibleKeys, setVisibleKeys] = useState(() => new Set(fullDataset.map((s) => s.key)));

    useEffect(() => {
        setVisibleKeys((prev) => {
            const next = new Set(prev);
            fullDataset.forEach((s) => {
                if (!prev.size) next.add(s.key);
            });
            return next;
        });
    }, [fullDataset]);

    const domain = useMemo(() => computeDomain(fullDataset), [fullDataset]);

    // Replay scrubber animation loop
    useEffect(() => {
        if (!playing) return;
        const intervalMs = Math.round(650 / playSpeed);
        const id = setInterval(() => {
            setScrubIndex((i) => (i >= TAIL_LENGTH - 1 ? 0 : i + 1));
        }, intervalMs);
        return () => clearInterval(id);
    }, [playing, playSpeed]);

    function toggleSector(key) {
        setVisibleKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function showAll() {
        setVisibleKeys(new Set(fullDataset.map((s) => s.key)));
    }

    function hideAll() {
        setVisibleKeys(new Set());
    }

    // Filtered sectors for chart
    const filteredDataset = useMemo(() => {
        return fullDataset.filter((s) => {
            const matchesSearch = s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (s.category && s.category.toLowerCase().includes(searchQuery.toLowerCase()));
            const matchesCategory = categoryFilter === "ALL" || s.category === categoryFilter;
            const matchesQuadrant = quadrantFilter === "ALL" || s.quadrant === quadrantFilter;
            const matchesFocus = !focusKey || s.key === focusKey;
            const isVisible = visibleKeys.has(s.key);
            return matchesSearch && matchesCategory && matchesQuadrant && matchesFocus && isVisible;
        });
    }, [fullDataset, searchQuery, categoryFilter, quadrantFilter, focusKey, visibleKeys]);

    // Benchmark metadata
    const selectedBenchmarkObj = useMemo(() => {
        return BENCHMARKS.find((b) => b.key === benchmark) || BENCHMARKS[0];
    }, [benchmark]);

    // Layout coordinate mapping (1000x560 viewBox)
    const W = 1000, H = 560, PAD = 56;
    const plotW = W - PAD * 2, plotH = H - PAD * 2;
    const vbX = W / 2 - (W / 2) / zoom;
    const vbY = H / 2 - (H / 2) / zoom;
    const viewBox = `${vbX} ${vbY} ${W / zoom} ${H / zoom}`;

    function sx(x) { return PAD + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * plotW; }
    function sy(y) { return PAD + plotH - ((y - domain.yMin) / (domain.yMax - domain.yMin)) * plotH; }
    const zeroX = sx(100), zeroY = sy(100);
    const xTicks = useMemo(() => niceTicks(domain.xMin, domain.xMax, 8), [domain]);
    const yTicks = useMemo(() => niceTicks(domain.yMin, domain.yMax, 7), [domain]);
    const tickDecimals = (v) => (Number.isInteger(v) ? 0 : 1);

    // Current quadrant groups based on active scrub position
    const currentQuadrants = useMemo(() => {
        const groups = { Leading: [], Weakening: [], Lagging: [], Improving: [] };
        fullDataset.forEach((s) => {
            const pt = s.path[scrubIndex] || s.currentPoint;
            const q = classifyQuadrant(pt);
            groups[q].push({
                ...s,
                scrubPoint: pt,
            });
        });
        return groups;
    }, [fullDataset, scrubIndex]);

    const daysAgo = TAIL_LENGTH - 1 - scrubIndex;
    const timelineLabel = daysAgo === 0
        ? "Current (Latest Session)"
        : `${daysAgo} ${timeframe === "daily" ? "days" : timeframe === "weekly" ? "weeks" : "months"} ago`;

    const isLiveConnected = liveSectors.length > 0;

    return (
        <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6 sm:py-6">
            {/* Top Equity Hub Navigation Ribbon */}
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3.5 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {EQUITY_TABS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = tab.active;
                        return (
                            <NavLink
                                key={tab.to}
                                to={tab.to}
                                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-all sm:px-3.5 sm:text-xs ${
                                    isActive
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800"
                                }`}
                            >
                                <Icon size={14} />
                                <span>{tab.label}</span>
                            </NavLink>
                        );
                    })}
                </div>

                {/* Live Status & Controls */}
                <div className="flex items-center gap-2">
                    <div className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-2xs dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                        <span className={`h-2 w-2 rounded-full ${isLiveConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
                        <span className="font-bold">{isLiveConnected ? "Upstox Live Quotes" : "Local Data Feed"}</span>
                        {lastUpdated && (
                            <span className="hidden text-[10px] text-gray-400 sm:inline">
                                ({new Date(lastUpdated).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })})
                            </span>
                        )}
                    </div>

                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 disabled:opacity-50"
                        title="Refresh live quotes"
                    >
                        <FiRefreshCw size={13} className={loading ? "animate-spin text-emerald-600" : ""} />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>

                    <button
                        onClick={() => setGuideOpen(!guideOpen)}
                        className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                            guideOpen
                                ? "bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                : "bg-white border-gray-200 text-gray-700 dark:bg-gray-900 dark:border-gray-800 dark:text-gray-300"
                        }`}
                        title="How to read RRG chart"
                    >
                        <FiHelpCircle size={13} />
                        <span className="hidden md:inline">How to Read RRG</span>
                    </button>

                    <button
                        onClick={() => setMobileControlsOpen(!mobileControlsOpen)}
                        className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-800 dark:bg-gray-800 dark:text-gray-200 lg:hidden"
                    >
                        <FiSliders size={13} />
                        <span>Sectors</span>
                    </button>
                </div>
            </div>

            {/* Collapsible Educational Guide */}
            {guideOpen && (
                <div className="mb-5 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50/70 via-teal-50/50 to-blue-50/70 p-4 shadow-xs dark:border-emerald-800/60 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-blue-950/40">
                    <div className="flex items-center justify-between pb-2 border-b border-emerald-200/60 dark:border-emerald-800/40 mb-3">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                            <FiHelpCircle size={15} />
                            <span>How to Read Relative Rotation Graph (RRG)</span>
                        </div>
                        <button onClick={() => setGuideOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <FiX size={16} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                        <div className="rounded-xl border border-emerald-200 bg-white/80 p-3 dark:border-emerald-800/50 dark:bg-gray-900/80">
                            <div className="font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-1">
                                <span>1. LEADING ↗</span>
                                <span className="text-[10px] font-mono">(Top-Right)</span>
                            </div>
                            <p className="text-gray-600 dark:text-gray-300 text-[11px] leading-relaxed">
                                RS-Ratio &gt; 100 &amp; RS-Momentum &gt; 100. Strong trend outperforming the benchmark with rising speed. High probability long momentum leaders.
                            </p>
                        </div>

                        <div className="rounded-xl border border-amber-200 bg-white/80 p-3 dark:border-amber-800/50 dark:bg-gray-900/80">
                            <div className="font-black text-amber-600 dark:text-amber-400 flex items-center gap-1.5 mb-1">
                                <span>2. WEAKENING ↘</span>
                                <span className="text-[10px] font-mono">(Bottom-Right)</span>
                            </div>
                            <p className="text-gray-600 dark:text-gray-300 text-[11px] leading-relaxed">
                                RS-Ratio &gt; 100 &amp; RS-Momentum &lt; 100. Outperforming trend but losing velocity. Mature rallies — consider profit booking or trailing stop loss.
                            </p>
                        </div>

                        <div className="rounded-xl border border-rose-200 bg-white/80 p-3 dark:border-rose-800/50 dark:bg-gray-900/80">
                            <div className="font-black text-rose-600 dark:text-rose-400 flex items-center gap-1.5 mb-1">
                                <span>3. LAGGING ↙</span>
                                <span className="text-[10px] font-mono">(Bottom-Left)</span>
                            </div>
                            <p className="text-gray-600 dark:text-gray-300 text-[11px] leading-relaxed">
                                RS-Ratio &lt; 100 &amp; RS-Momentum &lt; 100. Underperforming benchmark with falling momentum. Avoid fresh longs or use for defensive hedging.
                            </p>
                        </div>

                        <div className="rounded-xl border border-blue-200 bg-white/80 p-3 dark:border-blue-800/50 dark:bg-gray-900/80">
                            <div className="font-black text-blue-600 dark:text-blue-400 flex items-center gap-1.5 mb-1">
                                <span>4. IMPROVING ↖</span>
                                <span className="text-[10px] font-mono">(Top-Left)</span>
                            </div>
                            <p className="text-gray-600 dark:text-gray-300 text-[11px] leading-relaxed">
                                RS-Ratio &lt; 100 &amp; RS-Momentum &gt; 100. Underperforming base but gaining upward momentum. Early reversal turnarounds ready to enter Leading.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Layout */}
            <div className="flex flex-col gap-5 lg:flex-row items-start">
                {/* Left Sidebar Controls */}
                <aside
                    className={`w-full shrink-0 flex-col rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-xs backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/95 lg:w-72 ${
                        mobileControlsOpen ? "flex" : "hidden lg:flex"
                    }`}
                >
                    <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800 mb-3">
                        <h2 className="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                            <FiSliders className="text-emerald-600 dark:text-emerald-400" />
                            <span>Configuration</span>
                        </h2>
                        <button
                            onClick={() => setMobileControlsOpen(false)}
                            className="text-gray-400 hover:text-gray-600 lg:hidden"
                        >
                            <FiX size={18} />
                        </button>
                    </div>

                    {/* Benchmark Selector: Indices & Top Stocks */}
                    <div className="mb-4">
                        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center justify-between">
                            <span>Benchmark Reference</span>
                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                {selectedBenchmarkObj.type === "stock" ? "Heavyweight Stock" : "Index"}
                            </span>
                        </label>
                        <select
                            value={benchmark}
                            onChange={(e) => setBenchmark(e.target.value)}
                            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-800 outline-none transition focus:border-emerald-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        >
                            <optgroup label="Major Market Indices">
                                {BENCHMARKS.filter((b) => b.type === "index").map((b) => (
                                    <option key={b.key} value={b.key}>{b.label}</option>
                                ))}
                            </optgroup>
                            <optgroup label="Top Heavyweight Equities (Stock Benchmark)">
                                {BENCHMARKS.filter((b) => b.type === "stock").map((b) => (
                                    <option key={b.key} value={b.key}>{b.label}</option>
                                ))}
                            </optgroup>
                        </select>
                    </div>

                    {/* Timeframe Selector */}
                    <div className="mb-4">
                        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Calculation Horizon
                        </label>
                        <div className="grid grid-cols-3 gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-850">
                            {[
                                { key: "daily", label: "Daily (1D)" },
                                { key: "weekly", label: "Weekly (1W)" },
                                { key: "monthly", label: "Monthly (1M)" },
                            ].map((tf) => (
                                <button
                                    key={tf.key}
                                    onClick={() => setTimeframe(tf.key)}
                                    className={`rounded-lg py-1.5 text-[11px] font-bold transition ${
                                        timeframe === tf.key
                                            ? "bg-emerald-600 text-white shadow-2xs"
                                            : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
                                    }`}
                                >
                                    {tf.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tail Length Slider */}
                    <div className="mb-4">
                        <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            <span>Tail Length</span>
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-emerald-600 dark:bg-gray-800 dark:text-emerald-400">
                                {tailWindow} periods
                            </span>
                        </div>
                        <input
                            type="range"
                            min={2}
                            max={TAIL_LENGTH}
                            value={tailWindow}
                            onChange={(e) => setTailWindow(Number(e.target.value))}
                            className="w-full accent-emerald-600 cursor-pointer"
                        />
                    </div>

                    {/* Quadrant Quick Filter */}
                    <div className="mb-4">
                        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                            Quadrant Focus
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {["ALL", ...QUADRANT_ORDER].map((q) => {
                                const isSelected = quadrantFilter === q;
                                return (
                                    <button
                                        key={q}
                                        onClick={() => setQuadrantFilter(q)}
                                        className={`rounded-lg px-2 py-1.5 text-[11px] font-bold transition text-left flex items-center justify-between border ${
                                            isSelected
                                                ? "bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-950/60 dark:border-emerald-500 dark:text-emerald-300"
                                                : "bg-gray-50/70 border-gray-200 text-gray-600 hover:bg-gray-100 dark:bg-gray-800/60 dark:border-gray-700/60 dark:text-gray-400"
                                        }`}
                                    >
                                        <span>{q}</span>
                                        {q !== "ALL" && (
                                            <span className="text-[10px] font-mono opacity-80">
                                                ({currentQuadrants[q]?.length || 0})
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Sector Search & Checklist */}
                    <div className="flex flex-col flex-1 min-h-0">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                Sectors ({visibleKeys.size}/{fullDataset.length})
                            </span>
                            <div className="flex items-center gap-2 text-[11px]">
                                <button onClick={showAll} className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
                                    All
                                </button>
                                <span className="text-gray-300 dark:text-gray-700">|</span>
                                <button onClick={hideAll} className="font-semibold text-gray-400 hover:underline">
                                    None
                                </button>
                            </div>
                        </div>

                        {/* Search Input */}
                        <div className="relative mb-2">
                            <FiSearch className="absolute left-2.5 top-2.5 text-gray-400" size={13} />
                            <input
                                type="text"
                                placeholder="Filter sector index..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-xl border border-gray-200 bg-gray-50 pl-8 pr-3 py-1.5 text-xs text-gray-800 outline-none focus:border-emerald-500 focus:bg-white dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            />
                        </div>

                        {/* Sector Checklist */}
                        <div className="max-h-60 overflow-y-auto pr-1 space-y-1 custom-scrollbar">
                            <button
                                onClick={() => setFocusKey(null)}
                                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-bold transition ${
                                    !focusKey
                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                        : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-xs">▦</span>
                                    <span>All Active Sectors</span>
                                </div>
                            </button>

                            {fullDataset.map((s) => {
                                const isVisible = visibleKeys.has(s.key);
                                const isFocused = focusKey === s.key;
                                return (
                                    <div
                                        key={s.key}
                                        className={`group flex items-center justify-between rounded-lg px-2 py-1.5 transition ${
                                            isFocused
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                                : "hover:bg-gray-50 dark:hover:bg-gray-850 text-gray-700 dark:text-gray-300"
                                        }`}
                                    >
                                        <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0 pr-1">
                                            <input
                                                type="checkbox"
                                                checked={isVisible}
                                                onChange={() => toggleSector(s.key)}
                                                className="rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600"
                                            />
                                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                                            <span className="text-xs font-medium truncate">{s.label}</span>
                                        </label>
                                        <button
                                            onClick={() => setFocusKey(isFocused ? null : s.key)}
                                            className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-emerald-600 hover:underline dark:text-emerald-400 px-1 py-0.5"
                                            title="Solo focus on chart"
                                        >
                                            {isFocused ? "Clear" : "Solo"}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </aside>

                {/* Main Visualizer Area */}
                <div className="flex-1 w-full min-w-0 space-y-4">
                    {/* View Controls & Hero Card */}
                    <div className="rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-xs backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/95">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-3 dark:border-gray-800">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-base font-black text-gray-900 dark:text-gray-100">
                                        Relative Rotation Graph (RRG)
                                    </h1>
                                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                                        Benchmark: {selectedBenchmarkObj.label}
                                    </span>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                    Visualizing sector trend &amp; momentum cycles. Sectors rotate clockwise through Leading $\to$ Weakening $\to$ Lagging $\to$ Improving.
                                </p>
                            </div>

                            {/* View Mode & Zoom Buttons */}
                            <div className="flex items-center gap-2">
                                <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
                                    <button
                                        onClick={() => setViewMode("chart")}
                                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                                            viewMode === "chart"
                                                ? "bg-white text-emerald-600 shadow-2xs dark:bg-gray-900 dark:text-emerald-400"
                                                : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                                        }`}
                                    >
                                        Chart View
                                    </button>
                                    <button
                                        onClick={() => setViewMode("matrix")}
                                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                                            viewMode === "matrix"
                                                ? "bg-white text-emerald-600 shadow-2xs dark:bg-gray-900 dark:text-emerald-400"
                                                : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                                        }`}
                                    >
                                        Matrix Table
                                    </button>
                                    <button
                                        onClick={() => setViewMode("both")}
                                        className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                                            viewMode === "both"
                                                ? "bg-white text-emerald-600 shadow-2xs dark:bg-gray-900 dark:text-emerald-400"
                                                : "text-gray-500 hover:text-gray-800 dark:text-gray-400"
                                        }`}
                                    >
                                        Dual View
                                    </button>
                                </div>

                                <div className="flex items-center gap-1 border-l border-gray-200 pl-2 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                                    <button
                                        onClick={() => setZoom((z) => Math.min(3.0, z * 1.25))}
                                        className="rounded-lg p-1.5 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                                        title="Zoom in"
                                    >
                                        <FiZoomIn size={15} />
                                    </button>
                                    <button
                                        onClick={() => setZoom((z) => Math.max(0.8, z / 1.25))}
                                        className="rounded-lg p-1.5 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                                        title="Zoom out"
                                    >
                                        <FiZoomOut size={15} />
                                    </button>
                                    <button
                                        onClick={() => setZoom(1)}
                                        className="rounded-lg p-1.5 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                                        title="Reset zoom"
                                    >
                                        <FiMaximize2 size={15} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Category Filter Chips Bar */}
                        <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs">
                            <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider shrink-0 mr-1">
                                Category:
                            </span>
                            {SECTOR_CATEGORIES.map((cat) => {
                                const isSelected = categoryFilter === cat.key;
                                return (
                                    <button
                                        key={cat.key}
                                        onClick={() => setCategoryFilter(cat.key)}
                                        className={`shrink-0 rounded-full px-3 py-1 font-bold transition-all text-xs border ${
                                            isSelected
                                                ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                                                : "bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:bg-gray-800/80 dark:text-gray-300 dark:hover:bg-gray-700 border-gray-200 dark:border-gray-700/60"
                                        }`}
                                    >
                                        {cat.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Interactive Timeline Replay Scrubber */}
                        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/80 px-3.5 py-2.5 dark:border-gray-800 dark:bg-gray-850">
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPlaying((v) => !v)}
                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-xs transition ${
                                        playing
                                            ? "bg-amber-600 hover:bg-amber-700"
                                            : "bg-emerald-600 hover:bg-emerald-700"
                                    }`}
                                    aria-label={playing ? "Pause rotation replay" : "Play rotation replay"}
                                >
                                    {playing ? <FiPause size={13} /> : <FiPlay size={13} className="ml-0.5" />}
                                </button>
                                <button
                                    onClick={() => setPlaySpeed((s) => (s === 1 ? 2 : 1))}
                                    className="rounded-md bg-gray-200/70 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-mono font-bold text-gray-700 dark:text-gray-300"
                                    title="Replay Speed"
                                >
                                    {playSpeed}x
                                </button>
                            </div>

                            <span className="w-24 shrink-0 text-xs font-mono text-gray-500 dark:text-gray-400">
                                {TAIL_LENGTH - 1} {timeframe === "daily" ? "days" : timeframe === "weekly" ? "weeks" : "months"} ago
                            </span>

                            <input
                                type="range"
                                min={0}
                                max={TAIL_LENGTH - 1}
                                value={scrubIndex}
                                onChange={(e) => {
                                    setPlaying(false);
                                    setScrubIndex(Number(e.target.value));
                                }}
                                className="flex-1 accent-emerald-600 cursor-pointer"
                            />

                            <div className="w-36 shrink-0 text-right">
                                <span className="inline-block rounded-md bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                    {timelineLabel}
                                </span>
                            </div>
                        </div>

                        {/* RRG SVG Canvas */}
                        {(viewMode === "chart" || viewMode === "both") && (
                            <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-slate-950 p-1 dark:border-gray-800 select-none shadow-inner">
                                <svg
                                    viewBox={viewBox}
                                    className="h-[480px] sm:h-[540px] w-full"
                                    style={{ cursor: "crosshair" }}
                                >
                                    <defs>
                                        <radialGradient id="leadingGlow" cx="100%" cy="0%" r="90%">
                                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.01" />
                                        </radialGradient>
                                        <radialGradient id="weakeningGlow" cx="100%" cy="100%" r="90%">
                                            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.22" />
                                            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.01" />
                                        </radialGradient>
                                        <radialGradient id="laggingGlow" cx="0%" cy="100%" r="90%">
                                            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.22" />
                                            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.01" />
                                        </radialGradient>
                                        <radialGradient id="improvingGlow" cx="0%" cy="0%" r="90%">
                                            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                                            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.01" />
                                        </radialGradient>
                                    </defs>

                                    {/* Quadrant Backgrounds */}
                                    {/* Top-Right: Leading (Green) */}
                                    <rect x={zeroX} y={PAD} width={PAD + plotW - zeroX} height={zeroY - PAD} fill="url(#leadingGlow)" />
                                    {/* Bottom-Right: Weakening (Amber) */}
                                    <rect x={zeroX} y={zeroY} width={PAD + plotW - zeroX} height={PAD + plotH - zeroY} fill="url(#weakeningGlow)" />
                                    {/* Bottom-Left: Lagging (Red) */}
                                    <rect x={PAD} y={zeroY} width={zeroX - PAD} height={PAD + plotH - zeroY} fill="url(#laggingGlow)" />
                                    {/* Top-Left: Improving (Blue) */}
                                    <rect x={PAD} y={PAD} width={zeroX - PAD} height={zeroY - PAD} fill="url(#improvingGlow)" />

                                    {/* Grid Lines & Ticks */}
                                    {xTicks.map((t) => (
                                        <g key={`x-${t}`}>
                                            <line x1={sx(t)} x2={sx(t)} y1={PAD} y2={PAD + plotH} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                                            <text x={sx(t)} y={PAD + plotH + 18} textAnchor="middle" fontSize="10" fill="#64748b" fontFamily="monospace">
                                                {t.toFixed(tickDecimals(t))}
                                            </text>
                                        </g>
                                    ))}

                                    {yTicks.map((t) => (
                                        <g key={`y-${t}`}>
                                            <line x1={PAD} x2={PAD + plotW} y1={sy(t)} y2={sy(t)} stroke="#334155" strokeWidth="1" strokeDasharray="3 3" opacity="0.35" />
                                            <text x={PAD - 8} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="#64748b" fontFamily="monospace">
                                                {t.toFixed(tickDecimals(t))}
                                            </text>
                                        </g>
                                    ))}

                                    {/* Neutral 100 Baseline Crosshairs */}
                                    <line x1={PAD} x2={PAD + plotW} y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.75" />
                                    <line x1={zeroX} x2={zeroX} y1={PAD} y2={PAD + plotH} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.75" />

                                    {/* Center 100 Neutral Origin Marker */}
                                    <circle cx={zeroX} cy={zeroY} r="4.5" fill="#38bdf8" />
                                    <text x={zeroX + 7} y={zeroY - 6} fontSize="10" fontWeight="800" fill="#94a3b8">
                                        100 (Neutral Benchmark)
                                    </text>

                                    {/* Quadrant Big Badges */}
                                    <g transform={`translate(${PAD + plotW - 14}, ${PAD + 22})`}>
                                        <text textAnchor="end" fontSize="13" fontWeight="900" fill="#10b981">
                                            LEADING ↗
                                        </text>
                                        <text textAnchor="end" y="14" fontSize="9" fontWeight="600" fill="#6ee7b7" opacity="0.8">
                                            High Trend • High Momentum
                                        </text>
                                    </g>

                                    <g transform={`translate(${PAD + plotW - 14}, ${PAD + plotH - 24})`}>
                                        <text textAnchor="end" fontSize="13" fontWeight="900" fill="#f59e0b">
                                            WEAKENING ↘
                                        </text>
                                        <text textAnchor="end" y="14" fontSize="9" fontWeight="600" fill="#fcd34d" opacity="0.8">
                                            High Trend • Slowing Momentum
                                        </text>
                                    </g>

                                    <g transform={`translate(${PAD + 14}, ${PAD + plotH - 24})`}>
                                        <text fontSize="13" fontWeight="900" fill="#ef4444">
                                            ↙ LAGGING
                                        </text>
                                        <text y="14" fontSize="9" fontWeight="600" fill="#fca5a5" opacity="0.8">
                                            Low Trend • Low Momentum
                                        </text>
                                    </g>

                                    <g transform={`translate(${PAD + 14}, ${PAD + 22})`}>
                                        <text fontSize="13" fontWeight="900" fill="#3b82f6">
                                            ↖ IMPROVING
                                        </text>
                                        <text y="14" fontSize="9" fontWeight="600" fill="#93c5fd" opacity="0.8">
                                            Low Trend • Accelerating Momentum
                                        </text>
                                    </g>

                                    {/* Axis Titles */}
                                    <text x={PAD + plotW / 2} y={H - 12} textAnchor="middle" fontSize="11" fontWeight="700" fill="#94a3b8">
                                        JdK RS-Ratio (Relative Trend vs {selectedBenchmarkObj.label})
                                    </text>
                                    <text x={18} y={PAD + plotH / 2} textAnchor="middle" fontSize="11" fontWeight="700" fill="#94a3b8" transform={`rotate(-90 18 ${PAD + plotH / 2})`}>
                                        JdK RS-Momentum (Momentum vs {selectedBenchmarkObj.label})
                                    </text>

                                    {/* Sector Trajectory Lines and Head Nodes */}
                                    {filteredDataset.map((s) => {
                                        const start = Math.max(0, scrubIndex - tailWindow + 1);
                                        const pts = s.path.slice(start, scrubIndex + 1);
                                        const linePts = pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
                                        const cur = pts[pts.length - 1] || s.currentPoint;
                                        const isHovered = hoveredSector?.key === s.key;
                                        const isFocused = focusKey === s.key;

                                        return (
                                            <g
                                                key={s.key}
                                                className="cursor-pointer transition-opacity"
                                                onMouseEnter={() => setHoveredSector(s)}
                                                onMouseLeave={() => setHoveredSector(null)}
                                                onClick={() => setFocusKey(isFocused ? null : s.key)}
                                            >
                                                {/* Trajectory Tail Polyline */}
                                                <polyline
                                                    points={linePts}
                                                    fill="none"
                                                    stroke={s.color}
                                                    strokeWidth={isHovered || isFocused ? "3.5" : "2.2"}
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    opacity={isHovered || isFocused ? "1" : "0.85"}
                                                />

                                                {/* Historical Tail Dots */}
                                                {pts.slice(0, -1).map((p, i) => (
                                                    <circle
                                                        key={i}
                                                        cx={sx(p.x)}
                                                        cy={sy(p.y)}
                                                        r={isHovered || isFocused ? "3.2" : "2.2"}
                                                        fill={s.color}
                                                        opacity={0.3 + (i / pts.length) * 0.55}
                                                    />
                                                ))}

                                                {/* Current Head Node */}
                                                <circle
                                                    cx={sx(cur.x)}
                                                    cy={sy(cur.y)}
                                                    r={isHovered || isFocused ? "8.5" : "6.5"}
                                                    fill={s.color}
                                                    stroke="#ffffff"
                                                    strokeWidth="2.2"
                                                />

                                                {/* Pulsing ring if active */}
                                                {(isHovered || isFocused) && (
                                                    <circle
                                                        cx={sx(cur.x)}
                                                        cy={sy(cur.y)}
                                                        r="12"
                                                        fill="none"
                                                        stroke={s.color}
                                                        strokeWidth="1.5"
                                                        opacity="0.8"
                                                    />
                                                )}

                                                {/* Sector Text Label with High-Contrast Background Stroke */}
                                                <text
                                                    x={sx(cur.x) + 11}
                                                    y={sy(cur.y) + 4}
                                                    fontSize={isHovered || isFocused ? "12" : "10"}
                                                    fontWeight="800"
                                                    fill={isHovered || isFocused ? "#ffffff" : s.color}
                                                    style={{
                                                        paintOrder: "stroke",
                                                        stroke: "#020617",
                                                        strokeWidth: 3.5,
                                                    }}
                                                >
                                                    {s.label}
                                                </text>
                                            </g>
                                        );
                                    })}
                                </svg>

                                {/* Hovered Sector Info Overlay */}
                                {hoveredSector && (
                                    <div className="absolute top-3 left-3 rounded-2xl border border-gray-700 bg-slate-900/95 p-3.5 text-xs text-white shadow-2xl backdrop-blur-md z-10 max-w-xs">
                                        <div className="flex items-center justify-between gap-2 font-bold mb-1.5">
                                            <div className="flex items-center gap-2">
                                                <span className="h-3.5 w-3.5 rounded-full" style={{ background: hoveredSector.color }} />
                                                <span className="text-sm font-black">{hoveredSector.label}</span>
                                            </div>
                                            <span className={`rounded-md px-2 py-0.5 text-[10px] font-black border ${QUADRANT_CONFIG[hoveredSector.quadrant]?.badge}`}>
                                                {hoveredSector.quadrant}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono mt-1 border-t border-gray-800 pt-1.5">
                                            <div>Price: <b className="text-white">{hoveredSector.price ? formatPrice(hoveredSector.price) : "—"}</b></div>
                                            <div>Change: <b className={hoveredSector.pChange >= 0 ? "text-emerald-400" : "text-rose-400"}>{hoveredSector.pChange >= 0 ? "+" : ""}{hoveredSector.pChange?.toFixed(2)}%</b></div>
                                            <div>RS-Ratio: <b className="text-blue-300">{hoveredSector.rsRatio?.toFixed(2)}</b></div>
                                            <div>RS-Momentum: <b className="text-purple-300">{hoveredSector.rsMomentum?.toFixed(2)}</b></div>
                                        </div>
                                        <div className="mt-2 text-[10px] text-gray-400 border-t border-gray-800 pt-1.5 font-medium">
                                            Strategy: <span className="text-emerald-300 font-semibold">{QUADRANT_CONFIG[hoveredSector.quadrant]?.action}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Quadrant Summary Grid */}
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                        {QUADRANT_ORDER.map((q) => {
                            const c = QUADRANT_COLORS[q];
                            const config = QUADRANT_CONFIG[q];
                            const items = currentQuadrants[q] || [];

                            return (
                                <div
                                    key={q}
                                    className="overflow-hidden rounded-2xl border transition-all shadow-xs"
                                    style={{
                                        borderColor: c.border,
                                        background: c.bg,
                                    }}
                                >
                                    <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-black" style={{ color: c.text }}>{q}</span>
                                                <span className="rounded-full bg-white/50 dark:bg-black/40 px-2 py-0.2 text-[10px] font-black" style={{ color: c.text }}>
                                                    {items.length}
                                                </span>
                                            </div>
                                            <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{c.desc}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5 p-3 max-h-52 overflow-y-auto bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm custom-scrollbar">
                                        {items.length === 0 ? (
                                            <div className="py-4 text-center text-xs text-gray-400 font-medium">
                                                No sectors in this quadrant
                                            </div>
                                        ) : (
                                            items.map((s) => (
                                                <div
                                                    key={s.key}
                                                    onClick={() => setFocusKey(focusKey === s.key ? null : s.key)}
                                                    className="flex items-center justify-between rounded-lg p-1.5 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs font-semibold transition"
                                                >
                                                    <div className="flex items-center gap-2 truncate pr-1">
                                                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                                                        <span className="text-gray-800 dark:text-gray-200 truncate">{s.label}</span>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <span className={`font-mono text-[11px] font-bold ${s.pChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                                            {s.pChange >= 0 ? "+" : ""}{s.pChange?.toFixed(2)}%
                                                        </span>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <div className="px-3 py-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400 border-t border-black/5 dark:border-white/5">
                                        {config.action}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Sector Rotation & Performance Matrix Table */}
                    {(viewMode === "matrix" || viewMode === "both") && (
                        <div className="rounded-2xl border border-gray-200 bg-white/95 shadow-xs overflow-hidden backdrop-blur-md dark:border-gray-800 dark:bg-gray-900/95">
                            <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/50 px-4 py-3 dark:border-gray-800 dark:bg-gray-850">
                                <h3 className="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                    <span>Sector Momentum &amp; Rotation Matrix</span>
                                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                        Relative to {selectedBenchmarkObj.label}
                                    </span>
                                </h3>
                                <div className="text-xs text-gray-400 font-medium hidden sm:block">
                                    Click any row to solo focus on chart
                                </div>
                            </div>

                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full border-collapse text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-gray-200 bg-gray-50/70 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:border-gray-800 dark:bg-gray-800/40">
                                            <th className="px-4 py-3">Sector Index</th>
                                            <th className="px-4 py-3 text-right">LTP (₹)</th>
                                            <th className="px-4 py-3 text-right">Today Change</th>
                                            <th className="px-4 py-3 text-right">RS-Ratio (Trend)</th>
                                            <th className="px-4 py-3 text-right">RS-Momentum</th>
                                            <th className="px-4 py-3 text-center">Quadrant</th>
                                            <th className="px-4 py-3">Technical Strategy</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {fullDataset.map((s) => {
                                            const isFocused = focusKey === s.key;
                                            const config = QUADRANT_CONFIG[s.quadrant];

                                            return (
                                                <tr
                                                    key={s.key}
                                                    onClick={() => setFocusKey(isFocused ? null : s.key)}
                                                    className={`cursor-pointer transition-colors hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 ${
                                                        isFocused ? "bg-emerald-50/60 dark:bg-emerald-950/40 font-bold" : ""
                                                    }`}
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2">
                                                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                                                            <div>
                                                                <span className="font-black text-gray-900 dark:text-gray-100">{s.label}</span>
                                                                <span className="block text-[10px] font-normal text-gray-400">{s.category}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold text-gray-800 dark:text-gray-200">
                                                        {s.price ? formatPrice(s.price) : "—"}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono font-bold">
                                                        <span className={s.pChange >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                                                            {s.pChange >= 0 ? "+" : ""}{s.pChange?.toFixed(2)}%
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                                                        {s.rsRatio?.toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                                                        {s.rsMomentum?.toFixed(2)}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-black ${config.pill}`}>
                                                            {config.tag}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                                                        {config.action}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
