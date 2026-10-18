import React, { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { fetchMarketMap } from "../../services/equityApi";
import { formatPrice, formatPercent } from "../../utils/format";
import {
    FiRefreshCw,
    FiSearch,
    FiTrendingUp,
    FiTrendingDown,
    FiActivity,
    FiMaximize2,
    FiMinimize2,
    FiLayers,
    FiGrid,
    FiSliders,
    FiInfo,
    FiChevronDown,
    FiExternalLink,
    FiX,
    FiCheckCircle,
} from "react-icons/fi";
import { Link } from "react-router-dom";

// StockMojo Tabs Configuration
const TABS = [
    { id: "turnover", label: "Turnover" },
    { id: "all", label: "All" },
    { id: "price_gainers", label: "Top Gainers" },
    { id: "price_losers", label: "Top Losers" },
    { id: "oi_gainers", label: "OI Gainers" },
    { id: "oi_losers", label: "OI Losers" },
    { id: "long_buildup", label: "Long Buildup" },
    { id: "short_buildup", label: "Short Buildup" },
    { id: "short_covering", label: "Short Covering" },
    { id: "long_unwinding", label: "Long Unwinding" },
];

// Color interpolation for smooth heat shades
function interpolateColor(color1, color2, factor) {
    const f = Math.max(0, Math.min(1, factor));
    const r1 = parseInt(color1.substring(1, 3), 16);
    const g1 = parseInt(color1.substring(3, 5), 16);
    const b1 = parseInt(color1.substring(5, 7), 16);
    const r2 = parseInt(color2.substring(1, 3), 16);
    const g2 = parseInt(color2.substring(3, 5), 16);
    const b2 = parseInt(color2.substring(5, 7), 16);
    const r = Math.round(r1 + (r2 - r1) * f);
    const g = Math.round(g1 + (g2 - g1) * f);
    const b = Math.round(b1 + (b2 - b1) * f);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// StockMojo color mapping
function getTileColor(item, tabId) {
    const pChange = item.pChange || 0;
    const sentiment = item.sentiment || "neutral";

    if (tabId === "short_covering" || sentiment === "short_covering") {
        const factor = Math.min(1, Math.max(0.2, (Math.abs(pChange) || 1) / 3.5));
        return interpolateColor("#0284c7", "#7dd3fc", factor);
    }
    if (tabId === "long_unwinding" || sentiment === "long_unwinding") {
        const factor = Math.min(1, Math.max(0.2, (Math.abs(pChange) || 1) / 3.5));
        return interpolateColor("#b45309", "#fcd34d", factor);
    }
    if (sentiment === "long_buildup" || pChange > 0) {
        const factor = Math.min(1, Math.max(0.2, pChange / 4.0));
        return interpolateColor("#047857", "#34d399", factor);
    }
    if (sentiment === "short_buildup" || pChange < 0) {
        const factor = Math.min(1, Math.max(0.2, Math.abs(pChange) / 4.0));
        return interpolateColor("#be123c", "#fb7185", factor);
    }
    return "#475569";
}

// W3C luminance contrast algorithm for guaranteed legibility
function getContrastColor(hex) {
    if (!hex || hex.length < 7) return "#ffffff";
    try {
        const r = parseInt(hex.substring(1, 3), 16);
        const g = parseInt(hex.substring(3, 5), 16);
        const b = parseInt(hex.substring(5, 7), 16);
        return (299 * r + 587 * g + 114 * b) / 1000 > 145 ? "#0b1420" : "#ffffff";
    } catch {
        return "#ffffff";
    }
}

// Squarified Treemap Layout (Bruls, Huizing, van Wijk algorithm)
function computeSquarifiedTreemap(items, width, height) {
    if (!items || items.length === 0 || width <= 0 || height <= 0) return [];
    if (items.length === 1) {
        return [{ ...items[0], x: 0, y: 0, w: width, h: height }];
    }

    const totalWeight = items.reduce((s, it) => s + (it.size || 1), 0);
    if (totalWeight <= 0) return [];

    const normItems = items.map((it) => ({
        ...it,
        area: ((it.size || 1) / totalWeight) * (width * height),
    }));

    const results = [];
    let curX = 0, curY = 0, curW = width, curH = height;
    let row = [];

    function worst(r, w) {
        if (!r.length || w <= 0) return Infinity;
        const rowArea = r.reduce((s, c) => s + c.area, 0);
        if (rowArea <= 0) return Infinity;
        const s2 = rowArea * rowArea;
        const w2 = w * w;
        let maxR = 0;
        for (const c of r) {
            if (c.area <= 0) continue;
            const r1 = (w2 * c.area) / s2;
            const r2 = s2 / (w2 * c.area);
            const ratio = Math.max(r1, r2);
            if (ratio > maxR) maxR = ratio;
        }
        return maxR;
    }

    function layoutRow(r, sideLength, isHoriz) {
        const rowArea = r.reduce((s, c) => s + c.area, 0);
        if (rowArea <= 0 || sideLength <= 0) return;
        const thickness = rowArea / sideLength;
        let offset = 0;

        for (const item of r) {
            const length = thickness > 0 ? item.area / thickness : 0;
            if (isHoriz) {
                results.push({
                    ...item,
                    x: curX,
                    y: curY + offset,
                    w: Math.max(0, thickness),
                    h: Math.max(0, length),
                });
            } else {
                results.push({
                    ...item,
                    x: curX + offset,
                    y: curY,
                    w: Math.max(0, length),
                    h: Math.max(0, thickness),
                });
            }
            offset += length;
        }

        if (isHoriz) {
            curX += thickness;
            curW -= thickness;
        } else {
            curY += thickness;
            curH -= thickness;
        }
    }

    for (let i = 0; i < normItems.length; i++) {
        const item = normItems[i];
        const isHoriz = curW < curH;
        const side = isHoriz ? curH : curW;

        if (row.length === 0) {
            row.push(item);
        } else {
            const prevWorst = worst(row, side);
            const nextWorst = worst([...row, item], side);
            if (nextWorst <= prevWorst) {
                row.push(item);
            } else {
                layoutRow(row, side, isHoriz);
                row = [item];
            }
        }
    }

    if (row.length > 0) {
        const isHoriz = curW < curH;
        const side = isHoriz ? curH : curW;
        layoutRow(row, side, isHoriz);
    }

    return results;
}

export default function MarketMap() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filter and UI Controls
    const [selectedTab, setSelectedTab] = useState("turnover");
    const [query, setQuery] = useState("");
    const [selectedSector, setSelectedSector] = useState("all");
    const [sizingMode, setSizingMode] = useState("auto"); // 'auto' | 'turnover' | 'price' | 'oi'
    const [displayLimit, setDisplayLimit] = useState(50); // 50 | 100 | 'all'
    const [viewMode, setViewMode] = useState("heatmap"); // 'heatmap' | 'grid'
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [countdown, setCountdown] = useState(10);

    // Hover Tooltip State
    const [hoveredStock, setHoveredStock] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const treemapContainerRef = useRef(null);
    const [canvasDimensions, setCanvasDimensions] = useState({ width: 1200, height: 620 });

    // Clicked Stock Detail Modal
    const [modalStock, setModalStock] = useState(null);

    // Track SVG container size responsively
    useEffect(() => {
        if (!treemapContainerRef.current) return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setCanvasDimensions({
                        width: Math.floor(width),
                        height: Math.floor(height),
                    });
                }
            }
        });
        ro.observe(treemapContainerRef.current);
        return () => ro.disconnect();
    }, [viewMode, isFullscreen]);

    // Data loader
    const loadData = useCallback(() => {
        setLoading(true);
        fetchMarketMap()
            .then((res) => {
                setData(res);
                setError(null);
                setCountdown(10);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        loadData();
        const interval = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    loadData();
                    return 10;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [loadData]);

    // Available sectors from loaded data
    const availableSectors = useMemo(() => {
        if (!data?.sectors) return [];
        return data.sectors.map((s) => s.sector);
    }, [data]);

    // Filter and Sort stocks based on active tab and search query
    const filteredStocks = useMemo(() => {
        if (!data?.stocks) return [];
        let list = [...data.stocks];

        // 1. Sector Filter
        if (selectedSector !== "all") {
            list = list.filter((s) => s.sector === selectedSector);
        }

        // 2. Search Query Filter
        if (query.trim()) {
            const q = query.toLowerCase().trim();
            list = list.filter(
                (s) =>
                    s.symbol.toLowerCase().includes(q) ||
                    (s.name && s.name.toLowerCase().includes(q)) ||
                    (s.industry && s.industry.toLowerCase().includes(q))
            );
        }

        // 3. Tab Filter & Order matching StockMojo
        switch (selectedTab) {
            case "turnover":
                list.sort((a, b) => (b.turnover || 0) - (a.turnover || 0));
                break;
            case "all":
                list.sort((a, b) => Math.abs(b.pChange || 0) - Math.abs(a.pChange || 0));
                break;
            case "price_gainers":
                list = list.filter((s) => (s.pChange || 0) >= 0);
                list.sort((a, b) => (b.pChange || 0) - (a.pChange || 0));
                break;
            case "price_losers":
                list = list.filter((s) => (s.pChange || 0) < 0);
                list.sort((a, b) => (a.pChange || 0) - (b.pChange || 0));
                break;
            case "oi_gainers":
                list = list.filter((s) => (s.oiChangePercent || 0) >= 0);
                list.sort((a, b) => (b.oiChangePercent || 0) - (a.oiChangePercent || 0));
                break;
            case "oi_losers":
                list = list.filter((s) => (s.oiChangePercent || 0) < 0);
                list.sort((a, b) => (a.oiChangePercent || 0) - (b.oiChangePercent || 0));
                break;
            case "long_buildup":
                list = list.filter((s) => s.sentiment === "long_buildup");
                list.sort((a, b) => (b.oiChangePercent || 0) - (a.oiChangePercent || 0));
                break;
            case "short_buildup":
                list = list.filter((s) => s.sentiment === "short_buildup");
                list.sort((a, b) => (b.oiChangePercent || 0) - (a.oiChangePercent || 0));
                break;
            case "short_covering":
                list = list.filter((s) => s.sentiment === "short_covering");
                list.sort((a, b) => (a.oiChangePercent || 0) - (b.oiChangePercent || 0));
                break;
            case "long_unwinding":
                list = list.filter((s) => s.sentiment === "long_unwinding");
                list.sort((a, b) => (a.oiChangePercent || 0) - (b.oiChangePercent || 0));
                break;
            default:
                break;
        }

        // 3.5. Display limit to eliminate clutter & hotch-potch
        if (displayLimit !== "all") {
            const limit = Number(displayLimit);
            if (!isNaN(limit) && limit > 0) {
                list = list.slice(0, limit);
            }
        }

        // 4. Calculate Tile Size Weighting matching StockMojo
        const total = list.length;
        return list.map((item, index) => {
            let f = 1;
            if (sizingMode === "turnover") {
                f = Math.abs(item.turnover || 0) + 1;
            } else if (sizingMode === "price") {
                f = Math.abs(item.pChange || 0) + 1;
            } else if (sizingMode === "oi") {
                f = Math.abs(item.oiChangePercent || 0) + 1;
            } else {
                // Auto mode matching StockMojo
                if (selectedTab === "turnover") {
                    f = Math.abs(item.turnover || 0) + 1;
                } else if (selectedTab === "oi_gainers" || selectedTab === "oi_losers" ||
                           selectedTab === "long_buildup" || selectedTab === "short_buildup" ||
                           selectedTab === "short_covering" || selectedTab === "long_unwinding") {
                    f = Math.abs(item.oiChangePercent || 0) + 1;
                } else {
                    f = Math.abs(item.pChange || 0) + 1;
                }
            }

            // Rank dampening so top symbols stand out proportionately
            const rankMultiplier = 1 + Math.max(0, total - index) / Math.max(1, total);
            const size = Math.max(0.5, f * rankMultiplier);
            const color = getTileColor(item, selectedTab);
            const contrast = getContrastColor(color);

            return {
                ...item,
                size,
                color,
                contrast,
            };
        });
    }, [data, selectedSector, query, selectedTab, sizingMode]);

    // Computed Treemap Layout Rectangles
    const treemapLayout = useMemo(() => {
        if (!filteredStocks.length) return [];
        return computeSquarifiedTreemap(
            filteredStocks,
            canvasDimensions.width,
            canvasDimensions.height
        );
    }, [filteredStocks, canvasDimensions]);

    // Handle mouse movement for rich tooltip
    const handleMouseMove = useCallback((e, stock) => {
        if (!treemapContainerRef.current) return;
        const rect = treemapContainerRef.current.getBoundingClientRect();
        const rawX = e.clientX - rect.left;
        const rawY = e.clientY - rect.top;

        // Smart tooltip placement with boundary clamping
        const tooltipW = 280;
        const tooltipH = 170;
        let x = rawX + 16;
        let y = rawY + 16;

        if (x + tooltipW > rect.width) {
            x = rawX - tooltipW - 12;
        }
        if (y + tooltipH > rect.height) {
            y = rawY - tooltipH - 12;
        }

        setTooltipPos({
            x: Math.max(8, Math.min(rect.width - tooltipW - 8, x)),
            y: Math.max(8, Math.min(rect.height - tooltipH - 8, y)),
        });
        setHoveredStock(stock);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setHoveredStock(null);
    }, []);

    // Summary counts for badges
    const summary = data?.summary || {
        totalScanned: 0,
        advances: 0,
        declines: 0,
        longBuildup: 0,
        shortBuildup: 0,
        shortCovering: 0,
        longUnwinding: 0,
    };

    const tabCounts = data?.tabCounts || {};

    return (
        <div className="mx-auto w-full max-w-[1440px] px-3 sm:px-6 py-4 sm:py-6 space-y-5">
            {/* Header: Title, Breadth Stats & Refresh Controls */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                            <FiActivity size={18} />
                        </span>
                        <h1 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
                            Future Heatmap
                        </h1>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-micro font-bold uppercase tracking-wider text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                            Live F&O
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-fg-muted sm:text-sm">
                        Live visualization of market breadth, momentum, and derivatives buildup across NSE F&O equities.
                    </p>
                </div>

                {/* Right controls: Breadth Pill, Auto-Refresh & Fullscreen */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Market Breadth Pill */}
                    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 shadow-xs text-xs">
                        <span className="flex items-center gap-1 font-semibold text-up">
                            <FiTrendingUp size={13} />
                            <span className="font-mono tabular-nums">{summary.advances}</span> Adv
                        </span>
                        <span className="text-fg-subtle">|</span>
                        <span className="flex items-center gap-1 font-semibold text-down">
                            <FiTrendingDown size={13} />
                            <span className="font-mono tabular-nums">{summary.declines}</span> Dec
                        </span>
                    </div>

                    {/* Live countdown & refresh */}
                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg shadow-xs hover:bg-surface-hover active:scale-95 disabled:opacity-50"
                        title="Auto-refreshes every 10 seconds"
                    >
                        <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                        <FiRefreshCw size={12} className={loading ? "animate-spin text-emerald-600" : ""} />
                        <span>Live ({countdown}s)</span>
                    </button>

                    {/* View Switcher: Heatmap vs Grid */}
                    <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-xs">
                        <button
                            onClick={() => setViewMode("heatmap")}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                                viewMode === "heatmap"
                                    ? "bg-emerald-600 text-white"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                            title="Interactive Squarified Treemap View"
                        >
                            <FiLayers size={13} />
                            <span className="hidden sm:inline">Heatmap</span>
                        </button>
                        <button
                            onClick={() => setViewMode("grid")}
                            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                                viewMode === "grid"
                                    ? "bg-emerald-600 text-white"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                            title="Sector Cards Grid View"
                        >
                            <FiGrid size={13} />
                            <span className="hidden sm:inline">Sectors</span>
                        </button>
                    </div>

                    {/* Fullscreen Button */}
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="rounded-xl border border-line bg-surface p-2 text-fg-muted shadow-xs hover:bg-surface-hover hover:text-fg active:scale-95"
                        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Treemap"}
                    >
                        {isFullscreen ? <FiMinimize2 size={14} /> : <FiMaximize2 size={14} />}
                    </button>
                </div>
            </div>

            {/* Buildup Sentiment Summary Strip */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3">
                <div
                    onClick={() => setSelectedTab("long_buildup")}
                    className={`cursor-pointer rounded-xl border border-line p-3 transition-all hover:scale-[1.01] ${
                        selectedTab === "long_buildup"
                            ? "bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-emerald-500"
                            : "bg-surface"
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                            Long Buildup
                        </span>
                        <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-micro font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Price ↑ · OI ↑
                        </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-base font-bold text-up sm:text-lg font-mono tabular-nums">
                            {summary.longBuildup}
                        </span>
                        <span className="text-label text-fg-muted">Bullish accumulation</span>
                    </div>
                </div>

                <div
                    onClick={() => setSelectedTab("short_buildup")}
                    className={`cursor-pointer rounded-xl border border-line p-3 transition-all hover:scale-[1.01] ${
                        selectedTab === "short_buildup"
                            ? "bg-rose-50 dark:bg-rose-950/40 ring-2 ring-rose-500"
                            : "bg-surface"
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                            Short Buildup
                        </span>
                        <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-micro font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                            Price ↓ · OI ↑
                        </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-base font-bold text-down sm:text-lg font-mono tabular-nums">
                            {summary.shortBuildup}
                        </span>
                        <span className="text-label text-fg-muted">Bearish positioning</span>
                    </div>
                </div>

                <div
                    onClick={() => setSelectedTab("short_covering")}
                    className={`cursor-pointer rounded-xl border border-line p-3 transition-all hover:scale-[1.01] ${
                        selectedTab === "short_covering"
                            ? "bg-sky-50 dark:bg-sky-950/40 ring-2 ring-sky-500"
                            : "bg-surface"
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                            Short Covering
                        </span>
                        <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-micro font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                            Price ↑ · OI ↓
                        </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-base font-bold text-sky-600 dark:text-sky-400 sm:text-lg font-mono tabular-nums">
                            {summary.shortCovering}
                        </span>
                        <span className="text-label text-fg-muted">Shorts exit rally</span>
                    </div>
                </div>

                <div
                    onClick={() => setSelectedTab("long_unwinding")}
                    className={`cursor-pointer rounded-xl border border-line p-3 transition-all hover:scale-[1.01] ${
                        selectedTab === "long_unwinding"
                            ? "bg-amber-50 dark:bg-amber-950/40 ring-2 ring-amber-500"
                            : "bg-surface"
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                            Long Unwinding
                        </span>
                        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            Price ↓ · OI ↓
                        </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-base font-bold text-amber-600 dark:text-amber-400 sm:text-lg font-mono tabular-nums">
                            {summary.longUnwinding}
                        </span>
                        <span className="text-label text-fg-muted">Longs exit / profit booking</span>
                    </div>
                </div>
            </div>

            {/* Primary StockMojo 10 Filter Tabs */}
            <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
                {TABS.map((tab) => {
                    const isActive = selectedTab === tab.id;
                    const count = tabCounts[tab.id] ?? 0;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setSelectedTab(tab.id)}
                            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                                isActive
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "border border-line bg-surface text-fg hover:bg-surface-hover"
                            }`}
                        >
                            <span>{tab.label}</span>
                            <span
                                className={`rounded-full px-1.5 py-0.2 text-micro font-bold font-mono tabular-nums ${
                                    isActive
                                        ? "bg-white/20 text-white"
                                        : "bg-surface-raised text-fg-muted"
                                }`}
                            >
                                {count}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Search & Secondary Filters Bar */}
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3 shadow-xs sm:flex-row sm:items-center sm:justify-between">
                {/* Search Input */}
                <div className="relative flex-1 sm:max-w-xs">
                    <FiSearch className="absolute left-3 top-2.5 text-fg-subtle" size={14} />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search stock symbol or industry..."
                        className="w-full rounded-lg border border-line bg-surface-muted py-1.5 pl-9 pr-3 text-xs text-fg placeholder:text-fg-subtle focus:border-emerald-500 focus:outline-hidden"
                    />
                </div>

                {/* Dropdown Filters */}
                <div className="flex flex-wrap items-center gap-2">
                    {/* Sector Filter */}
                    <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <span>Sector:</span>
                        <select
                            value={selectedSector}
                            onChange={(e) => setSelectedSector(e.target.value)}
                            aria-label="Filter by Sector"
                            className="rounded-lg border border-line bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-fg focus:outline-hidden"
                        >
                            <option value="all">All Sectors</option>
                            {availableSectors.map((sec) => (
                                <option key={sec} value={sec}>
                                    {sec}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Display Density */}
                    <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <span>Show:</span>
                        <select
                            value={displayLimit}
                            onChange={(e) => setDisplayLimit(e.target.value)}
                            aria-label="Display Density"
                            className="rounded-lg border border-line bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-fg focus:outline-hidden"
                        >
                            <option value="50">Top 50 (Clean)</option>
                            <option value="100">Top 100 (Balanced)</option>
                            <option value="all">All 217 (Full Universe)</option>
                        </select>
                    </div>

                    {/* Tile Sizing Mode */}
                    <div className="flex items-center gap-1.5 text-xs text-fg-muted">
                        <span>Tile Size:</span>
                        <select
                            value={sizingMode}
                            onChange={(e) => setSizingMode(e.target.value)}
                            aria-label="Tile Sizing Metric"
                            className="rounded-lg border border-line bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-fg focus:outline-hidden"
                        >
                            <option value="auto">Auto (Category Metric)</option>
                            <option value="turnover">By Turnover</option>
                            <option value="price">By % Price Change</option>
                            <option value="oi">By % OI Change</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="rounded-xl bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                    Failed to refresh live telemetry: {error}
                </div>
            )}

            {/* Main Content Area: Heatmap Treemap OR Sector Grid */}
            {viewMode === "heatmap" ? (
                <div
                    className={`relative rounded-xl border border-line bg-surface shadow-xs transition-all overflow-hidden ${
                        isFullscreen
                            ? "fixed inset-0 z-50 rounded-none p-4 bg-page flex flex-col"
                            : ""
                    }`}
                >
                    {/* Fullscreen Header Bar */}
                    {isFullscreen && (
                        <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-bold text-fg sm:text-base">
                                    Future Heatmap — {TABS.find((t) => t.id === selectedTab)?.label}
                                </h3>
                                <span className="text-xs text-fg-muted">
                                    ({filteredStocks.length} symbols displayed)
                                </span>
                            </div>
                            <button
                                onClick={() => setIsFullscreen(false)}
                                className="flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-fg hover:bg-surface-hover"
                            >
                                <FiX size={14} /> Exit Fullscreen
                            </button>
                        </div>
                    )}

                    {/* Treemap SVG Canvas Container */}
                    <div
                        ref={treemapContainerRef}
                        className={`relative w-full select-none ${
                            isFullscreen
                                ? "flex-1 min-h-[500px]"
                                : "h-[520px] sm:h-[620px] lg:h-[700px]"
                        }`}
                        onMouseLeave={handleMouseLeave}
                    >
                        {treemapLayout.length > 0 ? (
                            <svg
                                width="100%"
                                height="100%"
                                viewBox={`0 0 ${canvasDimensions.width} ${canvasDimensions.height}`}
                                className="h-full w-full block"
                            >
                                {treemapLayout.map((node) => {
                                    const { x, y, w, h, symbol, pChange, oiChangePercent, color, contrast } = node;
                                    const isHovered = hoveredStock?.symbol === symbol;

                                    // Inner padding calculation
                                    const padX = Math.min(6, Math.max(2, w * 0.05));
                                    const padY = Math.min(6, Math.max(2, h * 0.05));
                                    const availW = w - padX * 2;
                                    const availH = h - padY * 2;

                                    const canRenderText = availW >= 26 && availH >= 16;
                                    const symLen = symbol.length;

                                    // Dynamic optimal font size tailored to text length & tile boundaries
                                    const maxFontForSym = Math.floor(availW / (symLen * 0.62));
                                    const maxFontForHeight = Math.floor(availH / 2.5);
                                    const optimalFontSize = Math.min(14, Math.max(8.5, Math.min(maxFontForSym, maxFontForHeight)));

                                    const pChangeStr = `${pChange >= 0 ? "+" : ""}${pChange.toFixed(2)}%`;
                                    const pChangeWidth = pChangeStr.length * (optimalFontSize * 0.55);
                                    const symbolWidth = symLen * (optimalFontSize * 0.62);

                                    // Strict collision-prevention fit tests
                                    const fitsSymbol = availW >= symbolWidth && availH >= optimalFontSize + 4;
                                    const fitsBoth = fitsSymbol && availW >= pChangeWidth && availH >= optimalFontSize * 2.3 + 4;
                                    const fitsPChangeOnly = availW >= pChangeWidth && availH >= optimalFontSize + 4;
                                    const fitsOi = fitsBoth && availW >= 68 && availH >= optimalFontSize * 3.6 + 6;

                                    return (
                                        <svg
                                            key={symbol}
                                            x={x}
                                            y={y}
                                            width={Math.max(0, w)}
                                            height={Math.max(0, h)}
                                            overflow="hidden"
                                            onClick={() => setModalStock(node)}
                                            onMouseMove={(e) => handleMouseMove(e, node)}
                                            className="cursor-pointer transition-opacity"
                                            style={{ opacity: hoveredStock && !isHovered ? 0.75 : 1 }}
                                        >
                                            <rect
                                                x={0.5}
                                                y={0.5}
                                                width={Math.max(0, w - 1)}
                                                height={Math.max(0, h - 1)}
                                                fill={color}
                                                rx={3}
                                                ry={3}
                                                stroke={isHovered ? "#ffffff" : "rgba(15, 23, 42, 0.25)"}
                                                strokeWidth={isHovered ? 2 : 1}
                                                className="transition-all"
                                            />

                                            {/* Dual Label: Symbol + % Change */}
                                            {canRenderText && fitsBoth && (
                                                <>
                                                    <text
                                                        x={w / 2}
                                                        y={h / 2 - (fitsOi ? optimalFontSize * 0.95 : optimalFontSize * 0.45)}
                                                        fill={contrast}
                                                        fontSize={optimalFontSize}
                                                        fontWeight="bold"
                                                        textAnchor="middle"
                                                        dominantBaseline="central"
                                                        className="pointer-events-none select-none font-sans"
                                                    >
                                                        {symbol}
                                                    </text>
                                                    <text
                                                        x={w / 2}
                                                        y={h / 2 + (fitsOi ? optimalFontSize * 0.35 : optimalFontSize * 0.75)}
                                                        fill={contrast}
                                                        fontSize={Math.max(8, optimalFontSize - 1)}
                                                        fontWeight="semibold"
                                                        textAnchor="middle"
                                                        dominantBaseline="central"
                                                        className="pointer-events-none select-none font-mono tabular-nums"
                                                    >
                                                        {pChangeStr}
                                                    </text>
                                                    {fitsOi && (
                                                        <text
                                                            x={w / 2}
                                                            y={h / 2 + optimalFontSize * 1.55}
                                                            fill={contrast}
                                                            fontSize={Math.max(7.5, optimalFontSize - 2.5)}
                                                            opacity={0.9}
                                                            textAnchor="middle"
                                                            dominantBaseline="central"
                                                            className="pointer-events-none select-none font-mono tabular-nums"
                                                        >
                                                            OI {oiChangePercent >= 0 ? "+" : ""}{oiChangePercent.toFixed(1)}%
                                                        </text>
                                                    )}
                                                </>
                                            )}

                                            {/* Single Label: Symbol only (when tile has width for name but not height for both) */}
                                            {canRenderText && !fitsBoth && fitsSymbol && (
                                                <text
                                                    x={w / 2}
                                                    y={h / 2}
                                                    fill={contrast}
                                                    fontSize={optimalFontSize}
                                                    fontWeight="bold"
                                                    textAnchor="middle"
                                                    dominantBaseline="central"
                                                    className="pointer-events-none select-none font-sans"
                                                >
                                                    {symbol}
                                                </text>
                                            )}

                                            {/* Single Label: % Change only (when symbol is too long but % fits cleanly) */}
                                            {canRenderText && !fitsBoth && !fitsSymbol && fitsPChangeOnly && (
                                                <text
                                                    x={w / 2}
                                                    y={h / 2}
                                                    fill={contrast}
                                                    fontSize={Math.max(8, optimalFontSize - 0.5)}
                                                    fontWeight="semibold"
                                                    textAnchor="middle"
                                                    dominantBaseline="central"
                                                    className="pointer-events-none select-none font-mono tabular-nums"
                                                >
                                                    {pChangeStr}
                                                </text>
                                            )}
                                        </svg>
                                    );
                                })}
                            </svg>
                        ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs text-fg-muted">
                                {loading ? "Loading live market heatmap..." : "No stocks match the selected filter."}
                            </div>
                        )}

                        {/* Interactive Rich Tooltip Card */}
                        {hoveredStock && (
                            <div
                                style={{
                                    left: `${tooltipPos.x}px`,
                                    top: `${tooltipPos.y}px`,
                                }}
                                className="pointer-events-none absolute z-40 w-72 rounded-xl border border-line bg-surface/95 p-3.5 shadow-xl backdrop-blur-md transition-all duration-75 text-xs text-fg"
                            >
                                <div className="flex items-start justify-between border-b border-line pb-2">
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm font-bold text-fg">
                                                {hoveredStock.symbol}
                                            </span>
                                            <span className="rounded-md bg-surface-raised px-1.5 py-0.5 text-micro font-medium text-fg-muted">
                                                {hoveredStock.industry}
                                            </span>
                                        </div>
                                        <p className="text-micro text-fg-subtle truncate max-w-[180px]">
                                            {hoveredStock.sector}
                                        </p>
                                    </div>

                                    {/* Sentiment Pill */}
                                    <span
                                        className={`rounded-md px-1.5 py-0.5 text-micro font-bold uppercase tracking-wider ${
                                            hoveredStock.sentiment === "long_buildup"
                                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                                : hoveredStock.sentiment === "short_buildup"
                                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                                                : hoveredStock.sentiment === "short_covering"
                                                ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                                                : hoveredStock.sentiment === "long_unwinding"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                                : "bg-surface-raised text-fg-muted"
                                        }`}
                                    >
                                        {hoveredStock.sentiment?.replace("_", " ")}
                                    </span>
                                </div>

                                <div className="mt-2.5 space-y-1.5">
                                    <div className="flex items-baseline justify-between">
                                        <span className="text-fg-muted">Last Price (LTP):</span>
                                        <div className="flex items-baseline gap-1.5">
                                            <span className="font-bold text-fg font-mono tabular-nums">
                                                ₹{formatPrice(hoveredStock.price)}
                                            </span>
                                            <span
                                                className={`font-semibold font-mono tabular-nums ${
                                                    hoveredStock.pChange >= 0 ? "text-up" : "text-down"
                                                }`}
                                            >
                                                {hoveredStock.pChange >= 0 ? "+" : ""}
                                                {hoveredStock.pChange.toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-baseline justify-between">
                                        <span className="text-fg-muted">Open Interest (OI):</span>
                                        <div className="flex items-baseline gap-1.5">
                                            <span className="font-mono tabular-nums text-fg">
                                                {hoveredStock.oi ? (hoveredStock.oi / 100000).toFixed(2) + " L" : "—"}
                                            </span>
                                            <span
                                                className={`font-semibold font-mono tabular-nums ${
                                                    hoveredStock.oiChangePercent >= 0 ? "text-up" : "text-down"
                                                }`}
                                            >
                                                {hoveredStock.oiChangePercent >= 0 ? "+" : ""}
                                                {hoveredStock.oiChangePercent?.toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-baseline justify-between">
                                        <span className="text-fg-muted">Turnover:</span>
                                        <span className="font-semibold text-fg font-mono tabular-nums">
                                            ₹{hoveredStock.turnover?.toFixed(2)} Cr
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-2.5 border-t border-line pt-1.5 text-center text-micro text-fg-subtle">
                                    Click tile to inspect complete telemetry
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                /* Sector Cards Grid View (Alternative View Mode) */
                <div className="space-y-4">
                    {data?.sectors?.map((s) => {
                        if (selectedSector !== "all" && s.sector !== selectedSector) return null;
                        const sStocks = s.stocks.filter(
                            (st) =>
                                !query.trim() ||
                                st.symbol.toLowerCase().includes(query.toLowerCase()) ||
                                st.industry.toLowerCase().includes(query.toLowerCase())
                        );
                        if (sStocks.length === 0) return null;

                        return (
                            <div key={s.sector} className="rounded-xl border border-line bg-surface p-4 shadow-xs">
                                <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-fg sm:text-base">
                                            {s.sector}
                                        </span>
                                        <span
                                            className={`rounded-md px-1.5 py-0.5 text-micro font-bold font-mono tabular-nums ${
                                                s.avgChange >= 0
                                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                                    : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
                                            }`}
                                        >
                                            {s.avgChange >= 0 ? "+" : ""}
                                            {s.avgChange}%
                                        </span>
                                    </div>
                                    <span className="text-label text-fg-muted">
                                        {sStocks.length} stocks · {s.advances} Adv / {s.declines} Dec
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                                    {sStocks.map((st) => {
                                        const color = getTileColor(st, selectedTab);
                                        const contrast = getContrastColor(color);
                                        return (
                                            <div
                                                key={st.symbol}
                                                onClick={() => setModalStock(st)}
                                                style={{ backgroundColor: color, color: contrast }}
                                                className="flex flex-col justify-between rounded-lg p-2.5 transition-all hover:scale-[1.03] hover:shadow-md cursor-pointer border border-black/10"
                                            >
                                                <div className="flex items-start justify-between">
                                                    <span className="font-bold tracking-tight text-xs">
                                                        {st.symbol}
                                                    </span>
                                                    <span className="text-micro opacity-90 font-mono tabular-nums">
                                                        {st.pChange >= 0 ? "+" : ""}
                                                        {st.pChange.toFixed(2)}%
                                                    </span>
                                                </div>
                                                <div className="mt-2 flex items-baseline justify-between text-label">
                                                    <span className="font-semibold font-mono tabular-nums">
                                                        ₹{formatPrice(st.price)}
                                                    </span>
                                                    <span className="text-micro opacity-75 truncate max-w-[65px]">
                                                        {st.industry}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Educational Section & Buildup Quadrants Matrix */}
            <div className="rounded-xl border border-line bg-surface p-4 sm:p-5 shadow-xs space-y-4">
                <div>
                    <h2 className="text-sm font-bold text-fg sm:text-base">
                        About the F&O Market Heatmap
                    </h2>
                    <p className="mt-1 text-xs text-fg-muted leading-relaxed sm:text-sm">
                        The Future Heatmap provides institutional-grade market breadth and positioning intelligence.
                        By pairing real-time price change with Open Interest (OI) changes, you can immediately identify
                        institutional accumulation, aggressive shorting, short-squeeze rallies, and profit-booking unwinding.
                    </p>
                </div>

                {/* 4 Quadrants Matrix Cards */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg border border-line bg-surface-muted p-3">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            <span className="text-xs font-bold text-fg">Long Buildup</span>
                        </div>
                        <p className="mt-1 text-micro font-semibold text-up">Price ↑ + OI ↑</p>
                        <p className="mt-1 text-micro text-fg-muted leading-snug">
                            Fresh buyers entering with high conviction. Bullish bias indicates strong upward momentum.
                        </p>
                    </div>

                    <div className="rounded-lg border border-line bg-surface-muted p-3">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                            <span className="text-xs font-bold text-fg">Short Buildup</span>
                        </div>
                        <p className="mt-1 text-micro font-semibold text-down">Price ↓ + OI ↑</p>
                        <p className="mt-1 text-micro text-fg-muted leading-snug">
                            Aggressive short positioning by sellers. Bearish bias indicates downside pressure.
                        </p>
                    </div>

                    <div className="rounded-lg border border-line bg-surface-muted p-3">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                            <span className="text-xs font-bold text-fg">Short Covering</span>
                        </div>
                        <p className="mt-1 text-micro font-semibold text-sky-600 dark:text-sky-400">Price ↑ + OI ↓</p>
                        <p className="mt-1 text-micro text-fg-muted leading-snug">
                            Sellers closing out short positions in panic or profit. Causes sharp relief rallies.
                        </p>
                    </div>

                    <div className="rounded-lg border border-line bg-surface-muted p-3">
                        <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                            <span className="text-xs font-bold text-fg">Long Unwinding</span>
                        </div>
                        <p className="mt-1 text-micro font-semibold text-amber-600 dark:text-amber-400">Price ↓ + OI ↓</p>
                        <p className="mt-1 text-micro text-fg-muted leading-snug">
                            Buyers taking profit or cutting losses. Signals momentum exhaustion and consolidation.
                        </p>
                    </div>
                </div>

                {/* Frequently Asked Questions (Accordion) */}
                <div className="pt-2">
                    <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-fg-subtle">
                        Frequently Asked Questions
                    </h3>
                    <div className="space-y-2">
                        <details className="group rounded-lg border border-line bg-surface-muted p-3 open:bg-surface">
                            <summary className="flex cursor-pointer items-center justify-between font-semibold text-fg text-xs sm:text-sm">
                                <span>How do I read the F&O heatmap?</span>
                                <FiChevronDown className="transition-transform group-open:rotate-180 text-fg-muted" />
                            </summary>
                            <p className="mt-2 text-xs text-fg-muted leading-relaxed">
                                Each rectangular tile represents an NSE F&O underlying stock. Tile size reflects trading
                                activity (turnover, price change magnitude, or OI change), while the color immediately shows
                                the price direction and institutional buildup classification.
                            </p>
                        </details>

                        <details className="group rounded-lg border border-line bg-surface-muted p-3 open:bg-surface">
                            <summary className="flex cursor-pointer items-center justify-between font-semibold text-fg text-xs sm:text-sm">
                                <span>What makes the heatmap better than a table?</span>
                                <FiChevronDown className="transition-transform group-open:rotate-180 text-fg-muted" />
                            </summary>
                            <p className="mt-2 text-xs text-fg-muted leading-relaxed">
                                Visual treemaps activate cognitive pattern recognition. Instead of scrolling through 200+
                                rows of tables, you can immediately spot market rotation, dominant sector leadership, and
                                outliers in a split-second glance.
                            </p>
                        </details>

                        <details className="group rounded-lg border border-line bg-surface-muted p-3 open:bg-surface">
                            <summary className="flex cursor-pointer items-center justify-between font-semibold text-fg text-xs sm:text-sm">
                                <span>Can I filter by specific sectors or buildup types?</span>
                                <FiChevronDown className="transition-transform group-open:rotate-180 text-fg-muted" />
                            </summary>
                            <p className="mt-2 text-xs text-fg-muted leading-relaxed">
                                Yes. Use the top pill tabs to filter directly by Long Buildup, Short Buildup, Top Gainers,
                                Top Losers, or Turnover. You can also use the Sector dropdown to focus specifically on
                                Banking, IT, Auto, Energy, or Pharma.
                            </p>
                        </details>

                        <details className="group rounded-lg border border-line bg-surface-muted p-3 open:bg-surface">
                            <summary className="flex cursor-pointer items-center justify-between font-semibold text-fg text-xs sm:text-sm">
                                <span>How often does the heatmap update?</span>
                                <FiChevronDown className="transition-transform group-open:rotate-180 text-fg-muted" />
                            </summary>
                            <p className="mt-2 text-xs text-fg-muted leading-relaxed">
                                The heatmap updates continuously with real-time ticks from Upstox market data feeds every 10
                                seconds during market hours (9:15 AM to 3:30 PM IST), or instantly whenever you click the Live refresh button.
                            </p>
                        </details>
                    </div>
                </div>
            </div>

            {/* Clicked Stock Telemetry Detail Modal */}
            {modalStock && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
                    <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl space-y-4">
                        <div className="flex items-start justify-between border-b border-line pb-3">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-bold text-fg">
                                        {modalStock.symbol}
                                    </h3>
                                    <span
                                        className={`rounded-md px-2 py-0.5 text-micro font-bold uppercase tracking-wider ${
                                            modalStock.sentiment === "long_buildup"
                                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                                : modalStock.sentiment === "short_buildup"
                                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                                                : modalStock.sentiment === "short_covering"
                                                ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                                                : modalStock.sentiment === "long_unwinding"
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                                : "bg-surface-raised text-fg-muted"
                                        }`}
                                    >
                                        {modalStock.sentiment?.replace("_", " ")}
                                    </span>
                                </div>
                                <p className="text-xs text-fg-muted">
                                    {modalStock.name} • {modalStock.industry} ({modalStock.sector})
                                </p>
                            </div>
                            <button
                                onClick={() => setModalStock(null)}
                                className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
                            >
                                <FiX size={18} />
                            </button>
                        </div>

                        {/* Price & Metrics Grid */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <div className="rounded-xl border border-line bg-surface-muted p-2.5">
                                <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                                    Last Price (LTP)
                                </span>
                                <div className="mt-1 text-sm font-bold text-fg font-mono tabular-nums">
                                    ₹{formatPrice(modalStock.price)}
                                </div>
                                <div
                                    className={`text-micro font-semibold font-mono tabular-nums ${
                                        modalStock.pChange >= 0 ? "text-up" : "text-down"
                                    }`}
                                >
                                    {modalStock.pChange >= 0 ? "+" : ""}
                                    {modalStock.pChange.toFixed(2)}% ({modalStock.change >= 0 ? "+" : ""}₹{modalStock.change})
                                </div>
                            </div>

                            <div className="rounded-xl border border-line bg-surface-muted p-2.5">
                                <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                                    Open Interest
                                </span>
                                <div className="mt-1 text-sm font-bold text-fg font-mono tabular-nums">
                                    {modalStock.oi ? (modalStock.oi / 100000).toFixed(2) + " L" : "—"}
                                </div>
                                <div
                                    className={`text-micro font-semibold font-mono tabular-nums ${
                                        modalStock.oiChangePercent >= 0 ? "text-up" : "text-down"
                                    }`}
                                >
                                    {modalStock.oiChangePercent >= 0 ? "+" : ""}
                                    {modalStock.oiChangePercent?.toFixed(2)}% Chg
                                </div>
                            </div>

                            <div className="rounded-xl border border-line bg-surface-muted p-2.5">
                                <span className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                                    Turnover
                                </span>
                                <div className="mt-1 text-sm font-bold text-fg font-mono tabular-nums">
                                    ₹{modalStock.turnover?.toFixed(2)} Cr
                                </div>
                                <div className="text-micro text-fg-muted">
                                    {modalStock.volume ? (modalStock.volume / 100000).toFixed(2) + " L Vol" : "—"}
                                </div>
                            </div>
                        </div>

                        {/* Buildup Interpretation Note */}
                        <div className="rounded-xl border border-line bg-surface-raised p-3 text-xs text-fg-muted">
                            <span className="font-semibold text-fg">Analysis: </span>
                            {modalStock.sentiment === "long_buildup" &&
                                "Strong bullish momentum with active institutional buying and expansion in open interest."}
                            {modalStock.sentiment === "short_buildup" &&
                                "Bearish pressure with heavy short accumulation and rising open interest as sellers press down."}
                            {modalStock.sentiment === "short_covering" &&
                                "Short squeeze bounce driven by bears covering their liabilities rather than fresh long buyers."}
                            {modalStock.sentiment === "long_unwinding" &&
                                "Consolidation or profit taking by previously profitable longs exiting their positions."}
                            {modalStock.sentiment === "neutral" &&
                                "Price and derivatives open interest are flat within range-bound consolidation."}
                        </div>

                        {/* Modal Action Links */}
                        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-line">
                            <Link
                                to="/option-chain"
                                onClick={() => setModalStock(null)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover"
                            >
                                <FiExternalLink size={13} /> Option Chain
                            </Link>
                            <Link
                                to="/equity-data/52-week-high-low"
                                onClick={() => setModalStock(null)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg hover:bg-surface-hover"
                            >
                                <FiTrendingUp size={13} /> 52W Range
                            </Link>
                            <button
                                onClick={() => setModalStock(null)}
                                className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
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
