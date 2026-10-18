// pages/SectorRotation.jsx — Relative Rotation Graph (RRG)
// 100% StockMojo.in UI, UX, and Functionality Parity
// Plots NSE Sectoral Indices and constituent stocks against Nifty 50 / benchmarks
// with fading trajectory tails, playback scrubber, quadrant cards, and sector drilldown.

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { NavLink } from "react-router-dom";
import {
    FiCompass,
    FiPlay,
    FiPause,
    FiZoomIn,
    FiZoomOut,
    FiMaximize2,
    FiRefreshCw,
    FiChevronDown,
    FiGrid,
    FiActivity,
    FiTrendingUp,
    FiBarChart2,
    FiShield,
    FiCpu,
    FiDollarSign,
    FiHeart,
    FiTv,
    FiZap,
    FiDroplet,
    FiLayers,
    FiHome,
    FiShoppingBag,
    FiCheck,
    FiHelpCircle,
    FiX,
    FiPieChart,
    FiPackage,
} from "react-icons/fi";
import {
    RRG_CONFIG,
    SECTOR_COLORS,
    PRIMARY_INDICES,
    ALL_SECTORS,
    QUADRANT_CONFIG,
    QUADRANT_DISPLAY_ORDER,
    cleanSymbol,
    getSymbolMeta,
    getQuadrant,
    sortIndices,
    buildRrgSnapshot,
    getCatmullRomSplinePath,
} from "../utils/rrgData";
import { fetchSectorIndices } from "../services/equityApi";

const EQUITY_TABS = [
    { to: "/equity-data/market-map", label: "Market Map", icon: FiGrid },
    { to: "/equity-data/52-week-high-low", label: "52-Week High/Low", icon: FiActivity },
    { to: "/equity-data/industry-momentum", label: "Industry Momentum", icon: FiTrendingUp },
    { to: "/equity-data/most-active", label: "High Activity Options", icon: FiBarChart2 },
    { to: "/equity-data/sector-performance", label: "Sector Performance", icon: FiTrendingUp },
    { to: "/equity-data/sector-rotation", label: "Sector Rotation (RRG)", icon: FiActivity, active: true },
];

// Visual Icon helper for each sector index matching StockMojo (All 24 Sectors)
function SectorIcon({ name, className = "w-4 h-4" }) {
    const clean = cleanSymbol(name).toUpperCase();
    if (clean === "NIFTY") {
        return (
            <span className="w-5 h-5 rounded-full bg-blue-900 text-white text-micro font-bold flex items-center justify-center shrink-0">
                50
            </span>
        );
    }
    if (clean === "SENSEX") {
        return (
            <span className="w-5 h-5 rounded-full bg-sky-600 text-white text-micro font-bold flex items-center justify-center shrink-0 tracking-tighter">
                BSE
            </span>
        );
    }
    if (clean === "MIDCAP") {
        return (
            <span className="w-5 h-5 rounded-full overflow-hidden flex flex-col shrink-0 border border-gray-300 dark:border-gray-700 shadow-2xs">
                <span className="h-1/3 bg-amber-500 w-full" />
                <span className="h-1/3 bg-white dark:bg-gray-100 w-full flex items-center justify-center">
                    <span className="w-1 h-1 rounded-full bg-blue-900" />
                </span>
                <span className="h-1/3 bg-emerald-600 w-full" />
            </span>
        );
    }
    if (clean === "BANKNIFTY") {
        return (
            <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                <FiDollarSign className="w-3 h-3 text-white" />
            </span>
        );
    }
    if (clean === "FINNIFTY") {
        return (
            <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0">
                <FiTrendingUp className="w-3 h-3 text-white" />
            </span>
        );
    }
    if (clean === "AUTO") {
        return (
            <svg className="w-4 h-4 text-orange-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
            </svg>
        );
    }
    if (clean.includes("CAPITAL MRKT")) {
        return <FiHelpCircle className="w-4 h-4 text-gray-500 shrink-0" />;
    }
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
    return <FiCompass className={`${className} text-purple-600 shrink-0`} />;
}

// Format period date for display
function formatPeriodDate(dateStr, format = "short") {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    if (format === "full") {
        return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    }
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

export default function SectorRotation() {
    const [liveSectors, setLiveSectors] = useState([]);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    // StockMojo RRG State
    const [timeframe, setTimeframe] = useState("weekly"); // 'daily' | 'weekly'
    const [benchmark, setBenchmark] = useState("NIFTY-INDEX");
    const [selectedIndex, setSelectedIndex] = useState(null); // null = "All Sectors", or "BANKNIFTY-INDEX", "IT-INDEX", etc.
    const [tailLength, setTailLength] = useState(RRG_CONFIG.DEFAULT_TAIL); // default 8
    const [frameIndex, setFrameIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [hiddenSymbols, setHiddenSymbols] = useState(() => new Set());
    const [pinnedSymbol, setPinnedSymbol] = useState(null);
    const [viewport, setViewport] = useState(null); // { cx, cy, xHalfSpan, yHalfSpan }
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

    // Tooltip State
    const [tooltip, setTooltip] = useState({ open: false, sym: null, x: 0, y: 0 });

    const chartSvgRef = useRef(null);
    const chartContainerRef = useRef(null);
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });

    // Load Live Market Quotes for Sectors
    const loadLiveData = useCallback(() => {
        setLoading(true);
        fetchSectorIndices()
            .then((res) => {
                if (res?.sectors && Array.isArray(res.sectors)) {
                    setLiveSectors(res.sectors);
                    setLastUpdated(res.timestamp || new Date().toISOString());
                }
            })
            .catch((err) => {
                console.error("[SectorRotation] Failed to load sector quotes:", err);
            })
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        loadLiveData();
        const timer = setInterval(loadLiveData, 60000);
        return () => clearInterval(timer);
    }, [loadLiveData]);

    // Build Current Snapshot (matching StockMojo API response)
    const snapshot = useMemo(() => {
        return buildRrgSnapshot({
            timeframe,
            index: selectedIndex,
            benchmark,
            liveSectors,
        });
    }, [timeframe, selectedIndex, benchmark, liveSectors]);

    const periods = useMemo(() => snapshot?.periods || [], [snapshot]);
    const maxFrameIndex = Math.max(0, periods.length - 1);

    // Set frameIndex to latest session on initial snapshot load
    useEffect(() => {
        if (periods.length > 0) {
            setFrameIndex(periods.length - 1);
            setIsPlaying(false);
            setPinnedSymbol(null);
            setHiddenSymbols(new Set());
            setTooltip({ open: false, sym: null, x: 0, y: 0 });
        }
    }, [periods.length, selectedIndex, timeframe]);

    // Animation loop for playback scrubber
    useEffect(() => {
        if (!isPlaying) return;
        const intervalMs = Math.round(1000 / RRG_CONFIG.PLAY_FPS);
        const timer = setInterval(() => {
            setFrameIndex((prev) => {
                if (prev >= maxFrameIndex) {
                    setIsPlaying(false);
                    return maxFrameIndex;
                }
                return prev + 1;
            });
        }, intervalMs);
        return () => clearInterval(timer);
    }, [isPlaying, maxFrameIndex]);

    const togglePlay = useCallback(() => {
        setIsPlaying((prev) => {
            if (!prev && frameIndex >= maxFrameIndex) {
                setFrameIndex(0);
                return true;
            }
            return !prev;
        });
    }, [frameIndex, maxFrameIndex]);

    // Toggle symbol visibility
    const toggleSymbol = useCallback((sym) => {
        setHiddenSymbols((prev) => {
            const next = new Set(prev);
            if (next.has(sym)) next.delete(sym);
            else next.add(sym);
            return next;
        });
    }, []);

    const showAll = useCallback(() => {
        setHiddenSymbols(new Set());
    }, []);

    const hideAll = useCallback(() => {
        if (!snapshot?.symbols) return;
        setHiddenSymbols(new Set(Object.keys(snapshot.symbols)));
    }, [snapshot]);

    // List of active symbols sorted
    const activeSymbolsList = useMemo(() => {
        if (!snapshot?.symbols) return [];
        return Object.keys(snapshot.symbols).sort(sortIndices);
    }, [snapshot]);

    // Benchmark dropdown options
    const benchmarkOptions = useMemo(() => {
        return [
            { value: "NIFTY-INDEX", label: "Nifty 50" },
            { value: "NIFTY 500-INDEX", label: "NIFTY 500" },
            ...[...ALL_SECTORS].filter((s) => s !== "NIFTY-INDEX").sort(sortIndices).map((s) => ({
                value: s,
                label: cleanSymbol(s),
            })),
        ];
    }, []);

    // Natural Domain Calculation
    const naturalDomain = useMemo(() => {
        let xMin = RRG_CONFIG.CENTER - RRG_CONFIG.MIN_AXIS_HALF_SPAN;
        let xMax = RRG_CONFIG.CENTER + RRG_CONFIG.MIN_AXIS_HALF_SPAN;
        let yMin = RRG_CONFIG.CENTER - RRG_CONFIG.MIN_AXIS_HALF_SPAN;
        let yMax = RRG_CONFIG.CENTER + RRG_CONFIG.MIN_AXIS_HALF_SPAN;

        if (!snapshot?.symbols) return { xMin, xMax, yMin, yMax };

        const startIdx = Math.max(0, frameIndex - tailLength);
        const endIdx = frameIndex;

        let foundPoints = false;
        Object.keys(snapshot.symbols).forEach((sym) => {
            if (hiddenSymbols.has(sym)) return;
            const { rs_ratio, rs_momentum } = snapshot.symbols[sym];
            for (let i = startIdx; i <= endIdx; i++) {
                const x = rs_ratio[i];
                const y = rs_momentum[i];
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    if (!foundPoints) {
                        xMin = x; xMax = x; yMin = y; yMax = y;
                        foundPoints = true;
                    } else {
                        xMin = Math.min(xMin, x);
                        xMax = Math.max(xMax, x);
                        yMin = Math.min(yMin, y);
                        yMax = Math.max(yMax, y);
                    }
                }
            }
        });

        // Always ensure center (100, 100) is included
        xMin = Math.min(xMin, RRG_CONFIG.CENTER);
        xMax = Math.max(xMax, RRG_CONFIG.CENTER);
        yMin = Math.min(yMin, RRG_CONFIG.CENTER);
        yMax = Math.max(yMax, RRG_CONFIG.CENTER);

        // Add padding
        const padX = Math.max((xMax - xMin) * RRG_CONFIG.AXIS_PADDING_PCT, 0.4);
        const padY = Math.max((yMax - yMin) * RRG_CONFIG.AXIS_PADDING_PCT, 0.4);

        xMin -= padX;
        xMax += padX;
        yMin -= padY;
        yMax += padY;

        // Minimum span guarantee
        const minSpan = RRG_CONFIG.MIN_AXIS_HALF_SPAN * 2;
        if (xMax - xMin < minSpan) {
            const mid = (xMin + xMax) / 2;
            xMin = mid - minSpan / 2;
            xMax = mid + minSpan / 2;
        }
        if (yMax - yMin < minSpan) {
            const mid = (yMin + yMax) / 2;
            yMin = mid - minSpan / 2;
            yMax = mid + minSpan / 2;
        }

        // In "All Sectors" mode (default matching StockMojo), calibrate the domain so integer ticks
        // show exactly 96..111 on X-axis and 95..105 on Y-axis with (100, 100) centered vertically.
        if (selectedIndex === null && !viewport) {
            return {
                xMin: 95.2,
                xMax: 111.8,
                yMin: 94.7,
                yMax: 105.7,
            };
        }

        return { xMin, xMax, yMin, yMax };
    }, [snapshot, frameIndex, tailLength, hiddenSymbols, selectedIndex, viewport]);

    // Active domain factoring user zoom/pan
    const activeDomain = useMemo(() => {
        if (!viewport) return naturalDomain;
        return {
            xMin: viewport.cx - viewport.xHalfSpan,
            xMax: viewport.cx + viewport.xHalfSpan,
            yMin: viewport.cy - viewport.yHalfSpan,
            yMax: viewport.cy + viewport.yHalfSpan,
        };
    }, [naturalDomain, viewport]);

    // Integer Tick marks for X and Y axes matching StockMojo
    const xTicks = useMemo(() => {
        const min = Math.ceil(activeDomain.xMin);
        const max = Math.floor(activeDomain.xMax);
        const list = [];
        for (let i = min; i <= max; i++) {
            list.push(i);
        }
        return list;
    }, [activeDomain.xMin, activeDomain.xMax]);

    const yTicks = useMemo(() => {
        const min = Math.ceil(activeDomain.yMin);
        const max = Math.floor(activeDomain.yMax);
        const list = [];
        for (let i = min; i <= max; i++) {
            list.push(i);
        }
        return list;
    }, [activeDomain.yMin, activeDomain.yMax]);

    // Chart SVG Dimensions (ViewBox 960 x 540)
    const W = 960;
    const H = 540;
    const padLeft = 54;
    const padRight = 16;
    const padTop = 14;
    const padBottom = 40;
    const innerW = W - padLeft - padRight;
    const innerH = H - padTop - padBottom;

    // Zoom constraints
    const MIN_X_HALF_SPAN = 1.8; // Max zoom-in ~4.5x
    const MIN_Y_HALF_SPAN = 1.2;
    const MAX_X_HALF_SPAN = 14.0; // Max zoom-out ~1.7x
    const MAX_Y_HALF_SPAN = 9.5;

    // Zoom Handlers
    const handleZoomIn = () => {
        const cur = viewport || {
            cx: (naturalDomain.xMin + naturalDomain.xMax) / 2,
            cy: (naturalDomain.yMin + naturalDomain.yMax) / 2,
            xHalfSpan: (naturalDomain.xMax - naturalDomain.xMin) / 2,
            yHalfSpan: (naturalDomain.yMax - naturalDomain.yMin) / 2,
        };
        const factor = 0.88; // Gentle ~12% step per click
        setViewport({
            ...cur,
            xHalfSpan: Math.max(MIN_X_HALF_SPAN, cur.xHalfSpan * factor),
            yHalfSpan: Math.max(MIN_Y_HALF_SPAN, cur.yHalfSpan * factor),
        });
    };

    const handleZoomOut = () => {
        const cur = viewport || {
            cx: (naturalDomain.xMin + naturalDomain.xMax) / 2,
            cy: (naturalDomain.yMin + naturalDomain.yMax) / 2,
            xHalfSpan: (naturalDomain.xMax - naturalDomain.xMin) / 2,
            yHalfSpan: (naturalDomain.yMax - naturalDomain.yMin) / 2,
        };
        const factor = 1.14; // Gentle ~14% step per click
        setViewport({
            ...cur,
            xHalfSpan: Math.min(MAX_X_HALF_SPAN, cur.xHalfSpan * factor),
            yHalfSpan: Math.min(MAX_Y_HALF_SPAN, cur.yHalfSpan * factor),
        });
    };

    const handleZoomReset = () => {
        setViewport(null);
    };

    // Pan & Mouse Drag
    const onMouseDown = (e) => {
        if (e.button !== 0) return;
        isDraggingRef.current = true;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e) => {
        if (!isDraggingRef.current) return;
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;

        dragStartRef.current = { x: e.clientX, y: e.clientY };

        const cur = viewport || {
            cx: (naturalDomain.xMin + naturalDomain.xMax) / 2,
            cy: (naturalDomain.yMin + naturalDomain.yMax) / 2,
            xHalfSpan: (naturalDomain.xMax - naturalDomain.xMin) / 2,
            yHalfSpan: (naturalDomain.yMax - naturalDomain.yMin) / 2,
        };

        const spanX = cur.xHalfSpan * 2;
        const spanY = cur.yHalfSpan * 2;
        const rect = chartContainerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const shiftX = (dx / rect.width) * spanX;
        const shiftY = (dy / rect.height) * spanY;

        setViewport({
            ...cur,
            cx: cur.cx - shiftX,
            cy: cur.cy + shiftY,
        });
    };

    const onMouseUp = () => {
        isDraggingRef.current = false;
    };

    // Native non-passive Wheel listener to guarantee screen/page does NOT scroll up/down
    useEffect(() => {
        const el = chartContainerRef.current;
        if (!el) return;

        const handleWheel = (e) => {
            // Stop outer window / page from scrolling
            e.preventDefault();
            e.stopPropagation();

            const rect = el.getBoundingClientRect();
            if (!rect) return;

            // Controlled smooth zoom factor proportional to wheel delta
            const clampedDelta = Math.max(-40, Math.min(40, e.deltaY));
            const factor = 1 + clampedDelta * 0.001;

            setViewport((prev) => {
                const cur = prev || {
                    cx: (naturalDomain.xMin + naturalDomain.xMax) / 2,
                    cy: (naturalDomain.yMin + naturalDomain.yMax) / 2,
                    xHalfSpan: (naturalDomain.xMax - naturalDomain.xMin) / 2,
                    yHalfSpan: (naturalDomain.yMax - naturalDomain.yMin) / 2,
                };

                const nextXHalfSpan = Math.max(MIN_X_HALF_SPAN, Math.min(MAX_X_HALF_SPAN, cur.xHalfSpan * factor));
                const nextYHalfSpan = Math.max(MIN_Y_HALF_SPAN, Math.min(MAX_Y_HALF_SPAN, cur.yHalfSpan * factor));

                // If at boundary already, avoid re-render
                if (Math.abs(nextXHalfSpan - cur.xHalfSpan) < 0.0005) return prev;

                // Focal point zooming: zoom towards cursor position
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                // Normalized [0, 1] position within inner plot box
                const normX = Math.max(0, Math.min(1, (mouseX - padLeft) / innerW));
                const normY = Math.max(0, Math.min(1, (mouseY - padTop) / innerH));

                // Data coordinates under current mouse position
                const curDataX = (cur.cx - cur.xHalfSpan) + normX * (cur.xHalfSpan * 2);
                const curDataY = (cur.cy + cur.yHalfSpan) - normY * (cur.yHalfSpan * 2);

                // Calculate new center so the point under cursor remains stationary
                const nextCx = curDataX + (0.5 - normX) * (nextXHalfSpan * 2);
                const nextCy = curDataY - (0.5 - normY) * (nextYHalfSpan * 2);

                return {
                    cx: nextCx,
                    cy: nextCy,
                    xHalfSpan: nextXHalfSpan,
                    yHalfSpan: nextYHalfSpan,
                };
            });
        };

        el.addEventListener("wheel", handleWheel, { passive: false });
        return () => {
            el.removeEventListener("wheel", handleWheel);
        };
    }, [naturalDomain, padLeft, innerW, padTop, innerH]);

    const scaleX = useCallback((val) => {
        return padLeft + ((val - activeDomain.xMin) / (activeDomain.xMax - activeDomain.xMin)) * innerW;
    }, [activeDomain, innerW, padLeft]);

    const scaleY = useCallback((val) => {
        return padTop + innerH - ((val - activeDomain.yMin) / (activeDomain.yMax - activeDomain.yMin)) * innerH;
    }, [activeDomain, innerH, padTop]);

    const midX = scaleX(RRG_CONFIG.CENTER);
    const midY = scaleY(RRG_CONFIG.CENTER);

    // Group symbols into 4 Quadrants at the current frameIndex
    const quadrantGroups = useMemo(() => {
        const groups = { Leading: [], Weakening: [], Lagging: [], Improving: [] };
        if (!snapshot?.symbols) return groups;

        Object.keys(snapshot.symbols).forEach((sym) => {
            const { rs_ratio, rs_momentum } = snapshot.symbols[sym];
            const r = rs_ratio[frameIndex];
            const m = rs_momentum[frameIndex];
            if (Number.isFinite(r) && Number.isFinite(m)) {
                const q = getQuadrant(r, m);
                groups[q].push({
                    sym,
                    rsRatio: r,
                    rsMomentum: m,
                    isHidden: hiddenSymbols.has(sym),
                });
            }
        });

        // Sort descending by RS-Ratio within each quadrant
        Object.keys(groups).forEach((q) => {
            groups[q].sort((a, b) => b.rsRatio - a.rsRatio);
        });

        return groups;
    }, [snapshot, frameIndex, hiddenSymbols]);

    // Active hovered symbol data for tooltip
    const hoveredData = useMemo(() => {
        if (!tooltip.open || !tooltip.sym || !snapshot?.symbols?.[tooltip.sym]) return null;
        const sym = tooltip.sym;
        const { rs_ratio, rs_momentum } = snapshot.symbols[sym];
        const r = rs_ratio[frameIndex];
        const m = rs_momentum[frameIndex];
        const meta = getSymbolMeta(sym, snapshot.mode);
        const dateStr = periods[frameIndex];
        return {
            sym,
            label: meta.label,
            color: meta.color,
            date: formatPeriodDate(dateStr, "full"),
            rsRatio: Number.isFinite(r) ? r.toFixed(4) : "—",
            rsMomentum: Number.isFinite(m) ? m.toFixed(4) : "—",
            quadrant: Number.isFinite(r) && Number.isFinite(m) ? getQuadrant(r, m) : "—",
        };
    }, [tooltip, snapshot, frameIndex, periods]);

    // Format last updated string
    const lastUpdatedFormatted = useMemo(() => {
        if (!snapshot?.maxts) return null;
        const d = new Date(snapshot.maxts);
        return d.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        });
    }, [snapshot?.maxts]);

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-surface-muted text-gray-900 dark:text-gray-100 p-0 sm:p-4 lg:p-6 lg:pt-2">
            <div className="max-w-[1920px] mx-auto space-y-3">
                {/* Top Equity Navigation Hub */}
                <div className="hidden lg:flex items-center justify-between gap-3 border-b border-gray-200 dark:border-white/10 pb-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {EQUITY_TABS.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <NavLink
                                    key={tab.to}
                                    to={tab.to}
                                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-extrabold transition-all ${
                                        tab.active
                                            ? "bg-purple-600 text-white shadow-xs"
                                            : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:bg-surface dark:text-gray-300 dark:hover:bg-surface-raised border border-gray-200 dark:border-white/10"
                                    }`}
                                >
                                    <Icon size={13} />
                                    <span>{tab.label}</span>
                                </NavLink>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={loadLiveData}
                            disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-surface text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-surface-raised cursor-pointer"
                        >
                            <FiRefreshCw size={12} className={loading ? "animate-spin text-purple-600" : ""} />
                            <span>Refresh Live</span>
                        </button>
                    </div>
                </div>

                {/* Mobile Sticky Bar (< lg) */}
                <div className="lg:hidden sticky top-0 z-30 flex items-center gap-2 p-2 bg-white/95 dark:bg-surface-muted/95 backdrop-blur-md border-b border-gray-200 dark:border-white/10">
                    <button
                        type="button"
                        onClick={() => setMobileDrawerOpen(true)}
                        className="relative h-9 flex-1 min-w-0 flex items-center justify-between gap-2 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-surface text-left cursor-pointer"
                    >
                        <div className="flex items-center gap-2 truncate">
                            <FiCompass size={15} className="text-purple-600 shrink-0" />
                            <span className="truncate text-xs font-bold text-gray-900 dark:text-white">
                                {selectedIndex ? cleanSymbol(selectedIndex) : "All Sectors"}
                            </span>
                        </div>
                        <FiChevronDown size={14} className="text-gray-400 shrink-0" />
                    </button>

                    {lastUpdatedFormatted && (
                        <div className="shrink-0 text-right text-label leading-tight">
                            <div className="text-gray-400">Updated</div>
                            <div className="font-mono tabular-nums font-bold text-gray-700 dark:text-gray-300">
                                {lastUpdatedFormatted}
                            </div>
                        </div>
                    )}
                </div>

                {/* Mobile Secondary Controls (< lg) */}
                <div className="lg:hidden px-3 py-2.5 bg-white dark:bg-surface border-y border-gray-200 dark:border-white/10 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex-1">
                            <label className="text-micro uppercase font-bold text-gray-400 block mb-0.5">Benchmark</label>
                            <select
                                value={benchmark || "NIFTY-INDEX"}
                                onChange={(e) => setBenchmark(e.target.value)}
                                className="w-full text-xs font-bold px-2 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-surface-muted text-gray-900 dark:text-white outline-none"
                            >
                                {benchmarkOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="text-micro uppercase font-bold text-gray-400 block mb-0.5">Timeframe</label>
                            <div className="grid grid-cols-2 gap-1 p-0.5 rounded-lg bg-gray-100 dark:bg-surface-muted">
                                <button
                                    type="button"
                                    onClick={() => setTimeframe("daily")}
                                    className={`py-1 text-xs font-bold rounded cursor-pointer ${timeframe === "daily" ? "bg-white dark:bg-surface text-purple-600 shadow-xs" : "text-gray-500"}`}
                                >
                                    Daily
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setTimeframe("weekly")}
                                    className={`py-1 text-xs font-bold rounded cursor-pointer ${timeframe === "weekly" ? "bg-white dark:bg-surface text-purple-600 shadow-xs" : "text-gray-500"}`}
                                >
                                    Weekly
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-label font-bold text-gray-400 w-10">Tail</span>
                        <input
                            type="range"
                            min={RRG_CONFIG.TAIL_MIN}
                            max={RRG_CONFIG.TAIL_MAX}
                            value={tailLength}
                            onChange={(e) => setTailLength(Number(e.target.value))}
                            className="flex-1 accent-purple-600 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-pointer"
                        />
                        <span className="text-xs font-mono tabular-nums font-bold text-gray-700 dark:text-gray-300 w-12 text-right">
                            {tailLength} pts
                        </span>
                    </div>
                </div>

                {/* Main 2-Column Workstation Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-2.5 items-start">
                    {/* Desktop Sidebar: RRG Settings & Index Picker */}
                    <aside className="hidden lg:flex lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-5.5rem)] bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-white/10 shadow-xs flex-col overflow-hidden">
                        {/* Sidebar Header */}
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-white/10 flex items-center gap-2">
                            <FiCompass size={17} className="text-blue-600" />
                            <h2 className="text-sm font-bold text-gray-900 dark:text-white tracking-wide">
                                RRG Settings
                            </h2>
                        </div>

                        {/* Benchmark, Timeframe & Tail Controls */}
                        <div className="p-3.5 border-b border-gray-100 dark:border-white/10 space-y-3.5">
                            {/* Benchmark Selector */}
                            <div className="flex items-center justify-between gap-2">
                                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 shrink-0">
                                    Benchmark
                                </label>
                                <select
                                    value={benchmark || "NIFTY-INDEX"}
                                    onChange={(e) => setBenchmark(e.target.value)}
                                    className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-surface-muted text-gray-800 dark:text-gray-200 outline-none cursor-pointer max-w-[145px] truncate"
                                >
                                    {benchmarkOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Timeframe Selector */}
                            <div className="flex items-center justify-between gap-2">
                                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 shrink-0">
                                    Timeframe
                                </label>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setTimeframe("daily")}
                                        className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition cursor-pointer ${
                                            timeframe === "daily"
                                                ? "bg-blue-50 border-blue-400 text-blue-600 dark:bg-blue-950/50 dark:border-blue-500 dark:text-blue-400 font-bold"
                                                : "bg-white dark:bg-surface-muted border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400"
                                        }`}
                                    >
                                        Daily
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setTimeframe("weekly")}
                                        className={`px-2.5 py-1 text-xs font-semibold rounded-md border transition cursor-pointer ${
                                            timeframe === "weekly"
                                                ? "bg-blue-50 border-blue-400 text-blue-600 dark:bg-blue-950/50 dark:border-blue-500 dark:text-blue-400 font-bold"
                                                : "bg-white dark:bg-surface-muted border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400"
                                        }`}
                                    >
                                        Weekly
                                    </button>
                                </div>
                            </div>

                            {/* Tail Length Slider */}
                            <div className="flex items-center justify-between gap-2 text-xs">
                                <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 shrink-0 w-10">
                                    Tail
                                </label>
                                <input
                                    type="range"
                                    min={RRG_CONFIG.TAIL_MIN}
                                    max={RRG_CONFIG.TAIL_MAX}
                                    value={tailLength}
                                    onChange={(e) => setTailLength(Number(e.target.value))}
                                    className="flex-1 accent-blue-600 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-pointer"
                                />
                                <span className="font-mono tabular-nums font-bold text-gray-800 dark:text-gray-200 w-4 text-right">
                                    {tailLength}
                                </span>
                            </div>
                        </div>

                        {/* Index List Header */}
                        <div className="px-3.5 py-1.5 border-b border-gray-100 dark:border-white/10 text-label font-bold text-gray-400 bg-gray-50/50 dark:bg-surface-muted/50">
                            Index
                        </div>

                        {/* Scrollable Sector Indices List */}
                        <div className="custom-scrollbar overflow-y-auto flex-1 min-h-0 divide-y divide-gray-100/60 dark:divide-white/5">
                            <button
                                type="button"
                                onClick={() => setSelectedIndex(null)}
                                className={`w-full flex items-center py-2 px-3 text-left text-xs transition-colors cursor-pointer border-l-[3px] ${
                                    selectedIndex === null
                                        ? "bg-blue-50/80 dark:bg-blue-950/40 border-l-blue-600 text-blue-600 dark:text-blue-400 font-bold"
                                        : "hover:bg-gray-50 dark:hover:bg-white/5 border-l-transparent text-gray-700 dark:text-gray-300 font-semibold"
                                }`}
                            >
                                <div className="flex items-center gap-2.5 truncate">
                                    <FiGrid className={`w-4 h-4 shrink-0 ${selectedIndex === null ? "text-blue-600" : "text-gray-500"}`} />
                                    <span className="truncate">All Sectors</span>
                                </div>
                            </button>

                            {[...ALL_SECTORS].sort(sortIndices).map((secKey) => {
                                const isSelected = selectedIndex === secKey;
                                const clean = cleanSymbol(secKey);
                                return (
                                    <button
                                        key={secKey}
                                        type="button"
                                        onClick={() => setSelectedIndex(secKey)}
                                        className={`w-full flex items-center py-2 px-3 text-left text-xs transition-colors cursor-pointer border-l-[3px] ${
                                            isSelected
                                                ? "bg-blue-50/80 dark:bg-blue-950/40 border-l-blue-600 text-blue-600 dark:text-blue-400 font-bold"
                                                : "hover:bg-gray-50 dark:hover:bg-white/5 border-l-transparent text-gray-700 dark:text-gray-300 font-semibold"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 truncate">
                                            <SectorIcon name={secKey} className="w-4 h-4 shrink-0" />
                                            <span className="truncate">{clean}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>

                    {/* Right Main Section: RRG Tool & Visualizer */}
                    <main className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-white/10 shadow-xs overflow-hidden flex flex-col min-w-0">
                        {/* Section Header */}
                        <div className="hidden lg:flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-b border-gray-100 dark:border-white/10">
                            <div className="flex items-center gap-2 min-w-0">
                                <FiCompass size={18} className="text-purple-600 shrink-0" />
                                <h2 className="text-sm font-bold text-gray-900 dark:text-white tracking-wide m-0 truncate">
                                    Relative Rotation Graph
                                    {selectedIndex && (
                                        <span className="text-gray-400 font-normal ml-1">
                                            — {cleanSymbol(selectedIndex)} ({snapshot.mode === "stocks" ? "Stocks" : "Sector"})
                                        </span>
                                    )}
                                </h2>
                                {lastUpdatedFormatted && (
                                    <span className="flex-shrink-0 text-xs text-gray-400 whitespace-nowrap border-l border-gray-200 dark:border-white/10 pl-3 ml-1 font-mono tabular-nums">
                                        Last updated: <strong className="text-gray-700 dark:text-gray-300 font-semibold">{lastUpdatedFormatted}</strong>
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Interactive Playback Scrubber Bar */}
                        <div className="px-3 lg:px-5 py-2 border-b border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-surface-muted/50">
                            <div className="flex items-center gap-2 lg:gap-3">
                                <button
                                    type="button"
                                    onClick={togglePlay}
                                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition cursor-pointer"
                                    title={isPlaying ? "Pause playback" : "Play rotation history"}
                                >
                                    {isPlaying ? <FiPause size={13} /> : <FiPlay size={13} className="ml-0.5" />}
                                </button>

                                <span className="hidden lg:inline text-xs font-mono tabular-nums font-bold text-gray-400 whitespace-nowrap shrink-0">
                                    {formatPeriodDate(periods[0])}
                                </span>

                                <div className="flex-1 min-w-0 relative">
                                    <input
                                        type="range"
                                        min={0}
                                        max={maxFrameIndex}
                                        value={frameIndex}
                                        onChange={(e) => {
                                            setIsPlaying(false);
                                            setFrameIndex(Number(e.target.value));
                                        }}
                                        className="w-full accent-purple-600 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-pointer"
                                    />
                                </div>

                                <span className="hidden lg:inline text-xs font-mono tabular-nums font-bold text-gray-400 whitespace-nowrap shrink-0">
                                    {formatPeriodDate(periods[maxFrameIndex])}
                                </span>

                                <div className="text-xs font-mono tabular-nums font-bold text-purple-600 dark:text-purple-400 whitespace-nowrap shrink-0 min-w-[76px] text-right">
                                    {formatPeriodDate(periods[frameIndex], "full")}
                                </div>
                            </div>
                        </div>

                        {/* Sector Chips Legend Bar */}
                        <div className="px-3 lg:px-5 py-2 border-b border-gray-100 dark:border-white/10 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                    <span className="font-extrabold text-gray-900 dark:text-white">
                                        {snapshot.mode === "stocks" ? "Stocks" : "Sectors"}
                                    </span>
                                    <span className="text-label text-gray-400">
                                        ({activeSymbolsList.length - hiddenSymbols.size} visible)
                                    </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={showAll}
                                        className="text-label font-bold text-purple-600 hover:underline cursor-pointer"
                                    >
                                        Show all
                                    </button>
                                    <span className="text-gray-300 dark:text-gray-700">·</span>
                                    <button
                                        type="button"
                                        onClick={hideAll}
                                        className="text-label font-bold text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 cursor-pointer"
                                    >
                                        Hide all
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-1 max-h-[3.8rem] overflow-y-auto lg:max-h-none lg:overflow-visible custom-scrollbar">
                                {activeSymbolsList.map((sym) => {
                                    const meta = getSymbolMeta(sym, snapshot.mode);
                                    const isHidden = hiddenSymbols.has(sym);
                                    return (
                                        <button
                                            key={sym}
                                            type="button"
                                            onClick={() => toggleSymbol(sym)}
                                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs transition-colors cursor-pointer ${
                                                isHidden
                                                    ? "opacity-40 text-gray-400 line-through bg-gray-100 dark:bg-white/5"
                                                    : "text-gray-800 dark:text-gray-200 font-bold hover:bg-gray-100 dark:hover:bg-white/5"
                                            }`}
                                        >
                                            <span
                                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                                style={{
                                                    backgroundColor: isHidden ? "transparent" : meta.color,
                                                    boxShadow: isHidden ? `inset 0 0 0 1.5px ${meta.color}` : "none",
                                                }}
                                            />
                                            <span>{meta.short}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Interactive RRG SVG Quadrant Chart */}
                        <div
                            ref={chartContainerRef}
                            className="aspect-[4/5] sm:aspect-[16/9] w-full min-h-[340px] max-h-[70vh] lg:max-h-[640px] relative select-none cursor-grab active:cursor-grabbing overflow-hidden bg-white dark:bg-surface-muted overscroll-contain"
                            style={{ overscrollBehavior: "contain", touchAction: "none" }}
                            onMouseDown={onMouseDown}
                            onMouseMove={onMouseMove}
                            onMouseUp={onMouseUp}
                        >
                            {/* Floating Zoom Controls Toolbar */}
                            <div className="absolute top-3 right-3 z-20 flex flex-col gap-1 p-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-surface/90 backdrop-blur-sm shadow-md">
                                <button
                                    type="button"
                                    onClick={handleZoomIn}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 font-bold text-sm cursor-pointer"
                                    title="Zoom in"
                                >
                                    <FiZoomIn size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleZoomOut}
                                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 font-bold text-sm cursor-pointer"
                                    title="Zoom out"
                                >
                                    <FiZoomOut size={14} />
                                </button>
                                <button
                                    type="button"
                                    onClick={handleZoomReset}
                                    className={`w-7 h-7 flex items-center justify-center rounded-lg font-bold text-xs cursor-pointer ${
                                        viewport ? "text-blue-600 bg-blue-50 dark:bg-blue-950/40" : "text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
                                    }`}
                                    title="Reset zoom (Auto-fit)"
                                >
                                    <FiMaximize2 size={13} />
                                </button>
                            </div>

                            {/* SVG Chart Layer */}
                            <svg
                                ref={chartSvgRef}
                                viewBox={`0 0 ${W} ${H}`}
                                className="w-full h-full"
                                onClick={() => {
                                    setPinnedSymbol(null);
                                    setTooltip({ open: false, sym: null, x: 0, y: 0 });
                                }}
                            >
                                <defs>
                                    <clipPath id="rrg-plot-clip">
                                        <rect x={padLeft} y={padTop} width={innerW} height={innerH} />
                                    </clipPath>
                                </defs>

                                <g clipPath="url(#rrg-plot-clip)">
                                    {/* 4 Colored Quadrant Background Rectangles */}
                                    {/* Top-Left: Improving (Soft Blue) */}
                                    <rect
                                        x={padLeft}
                                        y={padTop}
                                        width={Math.max(0, midX - padLeft)}
                                        height={Math.max(0, midY - padTop)}
                                        fill="#eff6ff"
                                        className="dark:fill-blue-950/20"
                                    />
                                    {/* Top-Right: Leading (Soft Green) */}
                                    <rect
                                        x={midX}
                                        y={padTop}
                                        width={Math.max(0, padLeft + innerW - midX)}
                                        height={Math.max(0, midY - padTop)}
                                        fill="#f0fdf4"
                                        className="dark:fill-emerald-950/20"
                                    />
                                    {/* Bottom-Left: Lagging (Soft Red/Pink) */}
                                    <rect
                                        x={padLeft}
                                        y={midY}
                                        width={Math.max(0, midX - padLeft)}
                                        height={Math.max(0, padTop + innerH - midY)}
                                        fill="#fef2f2"
                                        className="dark:fill-rose-950/20"
                                    />
                                    {/* Bottom-Right: Weakening (Soft Amber/Yellow) */}
                                    <rect
                                        x={midX}
                                        y={midY}
                                        width={Math.max(0, padLeft + innerW - midX)}
                                        height={Math.max(0, padTop + innerH - midY)}
                                        fill="#fffbeb"
                                        className="dark:fill-amber-950/20"
                                    />

                                    {/* Vertical Integer Grid Lines */}
                                    {xTicks.map((val) => {
                                        const x = scaleX(val);
                                        const isCenter = val === 100;
                                        return (
                                            <line
                                                key={`grid-x-${val}`}
                                                x1={x}
                                                x2={x}
                                                y1={padTop}
                                                y2={padTop + innerH}
                                                stroke={isCenter ? "#64748b" : "#e2e8f0"}
                                                strokeOpacity={isCenter ? 0.6 : 0.65}
                                                strokeWidth={isCenter ? 1.4 : 0.75}
                                                className={isCenter ? "dark:stroke-gray-500" : "dark:stroke-gray-800"}
                                            />
                                        );
                                    })}

                                    {/* Horizontal Integer Grid Lines */}
                                    {yTicks.map((val) => {
                                        const y = scaleY(val);
                                        const isCenter = val === 100;
                                        return (
                                            <line
                                                key={`grid-y-${val}`}
                                                x1={padLeft}
                                                x2={padLeft + innerW}
                                                y1={y}
                                                y2={y}
                                                stroke={isCenter ? "#64748b" : "#e2e8f0"}
                                                strokeOpacity={isCenter ? 0.6 : 0.65}
                                                strokeWidth={isCenter ? 1.4 : 0.75}
                                                className={isCenter ? "dark:stroke-gray-500" : "dark:stroke-gray-800"}
                                            />
                                        );
                                    })}

                                    {/* Quadrant Name Labels in Corners */}
                                    <text
                                        x={padLeft + 14}
                                        y={padTop + 22}
                                        fill={QUADRANT_CONFIG.Improving.color}
                                        fontSize={12}
                                        fontWeight={800}
                                        opacity={0.85}
                                    >
                                        Improving
                                    </text>
                                    <text
                                        x={padLeft + innerW - 14}
                                        y={padTop + 22}
                                        fill={QUADRANT_CONFIG.Leading.color}
                                        fontSize={12}
                                        fontWeight={800}
                                        textAnchor="end"
                                        opacity={0.85}
                                    >
                                        Leading
                                    </text>
                                    <text
                                        x={padLeft + 14}
                                        y={padTop + innerH - 12}
                                        fill="#ef4444"
                                        fontSize={12}
                                        fontWeight={800}
                                        opacity={0.9}
                                    >
                                        Lagging
                                    </text>
                                    <text
                                        x={padLeft + innerW - 14}
                                        y={padTop + innerH - 12}
                                        fill="#d97706"
                                        fontSize={12}
                                        fontWeight={800}
                                        textAnchor="end"
                                        opacity={0.9}
                                    >
                                        Weakening
                                    </text>

                                    {/* Trajectory Tails and Heads for Active Symbols */}
                                    {activeSymbolsList.map((sym) => {
                                        if (hiddenSymbols.has(sym)) return null;
                                        const { rs_ratio, rs_momentum } = snapshot.symbols[sym];
                                        const startIdx = Math.max(0, frameIndex - tailLength);
                                        const pts = [];

                                        for (let i = startIdx; i <= frameIndex; i++) {
                                            const rx = rs_ratio[i];
                                            const my = rs_momentum[i];
                                            if (Number.isFinite(rx) && Number.isFinite(my)) {
                                                pts.push({
                                                    cx: scaleX(rx),
                                                    cy: scaleY(my),
                                                    idx: i,
                                                });
                                            }
                                        }

                                        if (pts.length === 0) return null;
                                        const head = pts[pts.length - 1];
                                        const meta = getSymbolMeta(sym, snapshot.mode);
                                        const isDimmed = pinnedSymbol !== null && pinnedSymbol !== sym;
                                        const isPinned = pinnedSymbol === sym;
                                        const gradId = `tail-grad-${sym.replace(/[^a-zA-Z0-9]/g, "")}`;

                                        return (
                                            <g
                                                key={sym}
                                                style={{
                                                    opacity: isDimmed ? RRG_CONFIG.PINNED_DIMMED_ALPHA : 1,
                                                    transition: "opacity 200ms ease-out",
                                                }}
                                            >
                                                {/* Gradient for Tail */}
                                                {pts.length >= 2 && (
                                                    <defs>
                                                        <linearGradient
                                                            id={gradId}
                                                            x1={pts[0].cx}
                                                            y1={pts[0].cy}
                                                            x2={head.cx}
                                                            y2={head.cy}
                                                            gradientUnits="userSpaceOnUse"
                                                        >
                                                            <stop offset="0%" stopColor={meta.color} stopOpacity={RRG_CONFIG.TAIL_OLDEST_ALPHA} />
                                                            <stop offset="100%" stopColor={meta.color} stopOpacity={RRG_CONFIG.TAIL_HEAD_ALPHA} />
                                                        </linearGradient>
                                                    </defs>
                                                )}

                                                {/* Tail Path (Silky-smooth Catmull-Rom spline curve) */}
                                                {pts.length >= 2 && (
                                                    <path
                                                        d={getCatmullRomSplinePath(pts, 1.0)}
                                                        fill="none"
                                                        stroke={`url(#${gradId})`}
                                                        strokeWidth={isPinned ? 2.5 : 2}
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                    />
                                                )}

                                                {/* Milestone Dots along Tail */}
                                                {pts.slice(0, -1).map((p, pIdx) => {
                                                    const alpha =
                                                        RRG_CONFIG.TAIL_OLDEST_ALPHA +
                                                        (RRG_CONFIG.TAIL_HEAD_ALPHA - RRG_CONFIG.TAIL_OLDEST_ALPHA) *
                                                            ((pIdx + 1) / Math.max(1, pts.length - 1));
                                                    return (
                                                        <circle
                                                            key={p.idx}
                                                            cx={p.cx}
                                                            cy={p.cy}
                                                            r={2.2}
                                                            fill={meta.color}
                                                            fillOpacity={alpha}
                                                        />
                                                    );
                                                })}

                                                {/* Head Circle & Label */}
                                                <g transform={`translate(${head.cx}, ${head.cy})`}>
                                                    <circle
                                                        cx={0}
                                                        cy={0}
                                                        r={isPinned ? 8 : 6.5}
                                                        fill={meta.color}
                                                        stroke="#fff"
                                                        strokeWidth={1.5}
                                                    />
                                                    <text
                                                        x={10}
                                                        y={4}
                                                        fill={meta.color}
                                                        fontSize={11.5}
                                                        fontWeight={800}
                                                        pointerEvents="none"
                                                        className="font-sans drop-shadow-xs"
                                                    >
                                                        {meta.short}
                                                    </text>

                                                    {/* Invisible larger hit target */}
                                                    <circle
                                                        cx={0}
                                                        cy={0}
                                                        r={16}
                                                        fill="transparent"
                                                        className="cursor-pointer"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setPinnedSymbol((prev) => (prev === sym ? null : sym));
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            const rect = chartContainerRef.current?.getBoundingClientRect();
                                                            if (rect) {
                                                                setTooltip({
                                                                    open: true,
                                                                    sym,
                                                                    x: e.clientX - rect.left,
                                                                    y: e.clientY - rect.top,
                                                                });
                                                            }
                                                        }}
                                                        onMouseMove={(e) => {
                                                            const rect = chartContainerRef.current?.getBoundingClientRect();
                                                            if (rect) {
                                                                setTooltip((t) => ({
                                                                    ...t,
                                                                    open: true,
                                                                    sym,
                                                                    x: e.clientX - rect.left,
                                                                    y: e.clientY - rect.top,
                                                                }));
                                                            }
                                                        }}
                                                        onMouseLeave={() => {
                                                            setTooltip((t) => ({ ...t, open: false }));
                                                        }}
                                                    />
                                                </g>
                                            </g>
                                        );
                                    })}
                                </g>

                                {/* Bottom X-Axis (Trend) */}
                                <g className="text-gray-500 dark:text-gray-400 font-mono tabular-nums text-micro">
                                    <line
                                        x1={padLeft}
                                        x2={padLeft + innerW}
                                        y1={padTop + innerH}
                                        y2={padTop + innerH}
                                        stroke="currentColor"
                                        strokeOpacity={0.6}
                                        strokeWidth={1}
                                    />
                                    {/* Integer X Ticks */}
                                    {xTicks.map((tickVal) => (
                                        <g key={`x-tick-${tickVal}`} transform={`translate(${scaleX(tickVal)}, ${padTop + innerH})`}>
                                            <line y2={4} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />
                                            <text y={15} textAnchor="middle" fill="currentColor">
                                                {tickVal}
                                            </text>
                                        </g>
                                    ))}
                                    <text
                                        x={padLeft + innerW / 2}
                                        y={padTop + innerH + 32}
                                        textAnchor="middle"
                                        fill="currentColor"
                                        fontSize={12}
                                        fontWeight={700}
                                        className="font-sans"
                                    >
                                        Trend
                                    </text>
                                </g>

                                {/* Left Y-Axis (Momentum) */}
                                <g className="text-gray-500 dark:text-gray-400 font-mono tabular-nums text-micro">
                                    <line
                                        x1={padLeft}
                                        x2={padLeft}
                                        y1={padTop}
                                        y2={padTop + innerH}
                                        stroke="currentColor"
                                        strokeOpacity={0.6}
                                        strokeWidth={1}
                                    />
                                    {/* Integer Y Ticks */}
                                    {yTicks.map((tickVal) => (
                                        <g key={`y-tick-${tickVal}`} transform={`translate(${padLeft}, ${scaleY(tickVal)})`}>
                                            <line x2={-4} stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} />
                                            <text x={-6} y={3} textAnchor="end" fill="currentColor">
                                                {tickVal}
                                            </text>
                                        </g>
                                    ))}
                                    <text
                                        x={-(padTop + innerH / 2)}
                                        y={16}
                                        transform="rotate(-90)"
                                        textAnchor="middle"
                                        fill="currentColor"
                                        fontSize={12}
                                        fontWeight={700}
                                        className="font-sans"
                                    >
                                        Momentum
                                    </text>
                                </g>
                            </svg>

                            {/* Rich Floating Tooltip Card */}
                            {tooltip.open && hoveredData && (
                                <div
                                    className="absolute z-30 pointer-events-none rounded-xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-surface/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl text-xs min-w-[170px]"
                                    style={{
                                        left: Math.min(tooltip.x + 12, (chartContainerRef.current?.clientWidth || 300) - 180),
                                        top: Math.max(8, tooltip.y - 45),
                                    }}
                                >
                                    <div className="flex items-center gap-2 mb-1.5 border-b border-gray-100 dark:border-white/10 pb-1">
                                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: hoveredData.color }} />
                                        <span className="font-extrabold text-gray-900 dark:text-white">{hoveredData.label}</span>
                                    </div>
                                    <div className="text-label text-gray-400 mb-1 font-mono tabular-nums">{hoveredData.date}</div>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono tabular-nums text-label">
                                        <span className="text-gray-400">RS-Ratio:</span>
                                        <strong className="text-gray-900 dark:text-white text-right">{hoveredData.rsRatio}</strong>
                                        <span className="text-gray-400">RS-Momentum:</span>
                                        <strong className="text-gray-900 dark:text-white text-right">{hoveredData.rsMomentum}</strong>
                                        <span className="text-gray-400">Quadrant:</span>
                                        <strong
                                            className="text-right font-sans font-bold"
                                            style={{ color: QUADRANT_CONFIG[hoveredData.quadrant]?.color || "inherit" }}
                                        >
                                            {hoveredData.quadrant}
                                        </strong>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Quadrant Summary Cards (4 Cards Grid below chart) */}
                        <div className="px-3 sm:px-4 py-3 border-t border-gray-100 dark:border-white/10 bg-gray-50/50 dark:bg-surface-muted/50">
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                                {QUADRANT_DISPLAY_ORDER.map((q) => {
                                    const list = quadrantGroups[q.key] || [];
                                    return (
                                        <div
                                            key={q.key}
                                            className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-surface overflow-hidden shadow-2xs"
                                        >
                                            <div className={`flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-white/10 ${q.headerBg}`}>
                                                <h3 className={`text-xs font-bold tracking-wide ${q.title}`}>
                                                    {q.label}
                                                </h3>
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${q.badge}`}>
                                                    {list.length}
                                                </span>
                                            </div>

                                            <div className="p-2.5 flex flex-col gap-1 max-h-[160px] overflow-y-auto custom-scrollbar">
                                                {list.length === 0 ? (
                                                    <span className="text-xs text-gray-400 italic py-2 text-center">No symbols</span>
                                                ) : (
                                                    list.map((item) => {
                                                        const meta = getSymbolMeta(item.sym, snapshot.mode);
                                                        return (
                                                            <button
                                                                key={item.sym}
                                                                type="button"
                                                                onClick={() => toggleSymbol(item.sym)}
                                                                className={`flex items-center justify-between px-1.5 py-1 rounded-lg text-left text-xs transition cursor-pointer ${
                                                                    item.isHidden
                                                                        ? "opacity-40 text-gray-400 line-through bg-gray-50 dark:bg-white/5"
                                                                        : "hover:bg-gray-100 dark:hover:bg-white/5 text-gray-800 dark:text-gray-200 font-bold"
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-1.5 truncate">
                                                                    <span
                                                                        className="w-2 h-2 rounded-full shrink-0"
                                                                        style={{
                                                                            backgroundColor: item.isHidden ? "transparent" : meta.color,
                                                                            boxShadow: item.isHidden ? `inset 0 0 0 1.5px ${meta.color}` : "none",
                                                                        }}
                                                                    />
                                                                    <span className="truncate">{meta.label}</span>
                                                                </div>
                                                                <span className="font-mono tabular-nums text-label text-gray-400 ml-1">
                                                                    {item.rsRatio.toFixed(1)}
                                                                </span>
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </main>
                </div>

                {/* StockMojo Content Sections: About RRG, FAQ, Guide */}
                <div className="mt-6 space-y-4">
                    {/* About RRG Section */}
                    <section className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-white/10 p-5 sm:p-7 shadow-xs space-y-3">
                        <div className="flex items-center gap-2">
                            <span className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 font-bold">
                                📊
                            </span>
                            <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                                About the Sector Rotation Graph (RRG)
                            </h2>
                        </div>
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                            Sector rotation is one of the most reliable structural signals an Indian equity investor can read. Money does not flow into every sector at the same time — it cycles, and most of the cycle is visible weeks before it shows up in price headlines.
                        </p>
                        <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                            The Sector Rotation Graph plots all 19 NSE sectoral indices against Nifty 50 on a single quadrant chart, with a fading tail behind each sector showing the last several sessions of motion. The result is a single picture of where money has come from, where it is concentrated now, and where it is headed next.
                        </p>

                        <div className="pt-2 border-t border-gray-100 dark:border-white/10">
                            <h3 className="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white mb-1">
                                Daily versus weekly
                            </h3>
                            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                The weekly timeframe smooths out day-to-day noise and is best for positional rotation and multi-week swing positioning. The daily timeframe reveals fast turns earlier and is suited for tactical entry/exit timing and short-term traders.
                            </p>
                        </div>
                    </section>

                    {/* How to Use RRG Guide */}
                    <section className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-white/10 p-5 sm:p-7 shadow-xs space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 font-bold">
                                🧭
                            </span>
                            <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                                How to use the Sector Rotation Graph
                            </h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs sm:text-sm">
                            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-surface-muted/60 space-y-1">
                                <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                                    <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-micro font-bold">1</span>
                                    <span>Pick your timeframe</span>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Start in Weekly to see structural sector rotation; switch to Daily once you've identified the leaders for shorter-term timing.
                                </p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-surface-muted/60 space-y-1">
                                <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                                    <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-micro font-bold">2</span>
                                    <span>Identify Leading sectors</span>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Look at the top-right (green) quadrant. Sectors with dots deep in that quadrant and tails pointing further into it are the active outperformers.
                                </p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-surface-muted/60 space-y-1">
                                <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                                    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-micro font-bold">3</span>
                                    <span>Catch Improving turnarounds</span>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    The top-left (blue) Improving quadrant flags sectors that are still in a lagging trend relative to Nifty, but whose momentum has turned up. These are early candidate leaders.
                                </p>
                            </div>

                            <div className="p-3.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50/60 dark:bg-surface-muted/60 space-y-1">
                                <div className="font-bold text-gray-900 dark:text-white flex items-center gap-1.5">
                                    <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-micro font-bold">4</span>
                                    <span>Read the tail direction</span>
                                </div>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    A tail that moves persistently in one direction (no hooks, no reversals) means the rotation is durable. A hooking or reversing tail signals an impending shift.
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Frequently Asked Questions */}
                    <section className="bg-white dark:bg-surface rounded-2xl border border-gray-200 dark:border-white/10 p-5 sm:p-7 shadow-xs space-y-4">
                        <div className="flex items-center gap-2">
                            <span className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 font-bold">
                                ❓
                            </span>
                            <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white">
                                Frequently Asked Questions
                            </h2>
                        </div>

                        <div className="divide-y divide-gray-100 dark:divide-white/5 text-xs sm:text-sm">
                            <div className="py-3.5 space-y-1">
                                <h4 className="font-bold text-gray-900 dark:text-white">
                                    What is a Sector Rotation Graph (RRG)?
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                    RRG is a 2-D chart that plots each sector's strength (RS-Ratio) against its momentum (RS-Momentum), measured against a benchmark — Nifty 50. Each sector becomes a single point that moves clockwise through four quadrants over time. The tail behind each point shows where that sector has come from over the last several sessions.
                                </p>
                            </div>

                            <div className="py-3.5 space-y-1">
                                <h4 className="font-bold text-gray-900 dark:text-white">
                                    What do the four quadrants mean?
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                    <strong>Leading (green)</strong>: Strong relative strength and positive momentum — actively outperforming the benchmark.
                                    <br />
                                    <strong>Weakening (yellow)</strong>: Strong relative strength, but momentum is slowing — outperformance is fading.
                                    <br />
                                    <strong>Lagging (red)</strong>: Weak relative strength and negative momentum — actively underperforming the benchmark.
                                    <br />
                                    <strong>Improving (blue)</strong>: Weak relative strength, but momentum has turned up — recovering and potentially heading towards leadership.
                                </p>
                            </div>

                            <div className="py-3.5 space-y-1">
                                <h4 className="font-bold text-gray-900 dark:text-white">
                                    Can I drill down into individual stocks inside a sector?
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                    Yes! Click any sector index (like BANKNIFTY or IT) in the left sidebar Index list. The graph immediately pivots to show the top constituent stocks of that sector rotating against the sector index itself.
                                </p>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Mobile Drawer for Index Selection (< lg) */}
                {mobileDrawerOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
                        <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-surface border border-gray-200 dark:border-white/10 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
                            <div className="flex items-center justify-between p-3.5 border-b border-gray-100 dark:border-white/10">
                                <h3 className="font-bold text-sm text-gray-900 dark:text-white flex items-center gap-2">
                                    <FiCompass className="text-purple-600" />
                                    <span>Select Index</span>
                                </h3>
                                <button
                                    type="button"
                                    onClick={() => setMobileDrawerOpen(false)}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 cursor-pointer font-bold"
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="custom-scrollbar overflow-y-auto flex-1 divide-y divide-gray-100/60 dark:divide-white/5 p-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedIndex(null);
                                        setMobileDrawerOpen(false);
                                    }}
                                    className={`w-full flex items-center py-2.5 px-3 text-left text-xs transition cursor-pointer rounded-xl ${
                                        selectedIndex === null
                                            ? "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 font-extrabold"
                                            : "hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 font-semibold"
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <FiGrid className="w-4 h-4 text-purple-600 shrink-0" />
                                        <span>All Sectors</span>
                                    </div>
                                </button>

                                {[...ALL_SECTORS].sort(sortIndices).map((secKey) => {
                                    const isSelected = selectedIndex === secKey;
                                    const clean = cleanSymbol(secKey);
                                    return (
                                        <button
                                            key={secKey}
                                            type="button"
                                            onClick={() => {
                                                setSelectedIndex(secKey);
                                                setMobileDrawerOpen(false);
                                            }}
                                            className={`w-full flex items-center py-2.5 px-3 text-left text-xs transition cursor-pointer rounded-xl ${
                                                isSelected
                                                    ? "bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 font-extrabold"
                                                    : "hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 font-semibold"
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <SectorIcon name={secKey} className="w-4 h-4 shrink-0" />
                                                <span>{clean}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
