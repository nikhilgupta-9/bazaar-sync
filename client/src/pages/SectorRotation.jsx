// pages/SectorRotation.jsx
//
// Relative Rotation Graph (RRG) — shows each NSE sector's relative Trend
// (JdK RS-Ratio) vs Momentum (JdK RS-Momentum) against a benchmark, with a
// historical tail so you can watch sectors rotate between the four
// quadrants (Leading / Weakening / Lagging / Improving) over time.
//
// IMPORTANT: this renders utils/rrgData.js's DEMO dataset, not real sector
// index prices — see that file's header for why (no sector-index history
// exists anywhere in this codebase yet; a real version needs a new Angel
// One token-discovery + backfill effort, not started). The "Demo data"
// badge in the header must stay visible; don't wire this to a fake "live"
// timestamp or drop the badge without a real data source behind it.
import { useEffect, useMemo, useState } from "react";
import { FiPlay, FiPause, FiZoomIn, FiZoomOut, FiMaximize2 } from "react-icons/fi";
import { SECTORS, buildDemoDataset, classifyQuadrant, QUADRANT_COLORS } from "../utils/rrgData";

const DATASET = buildDemoDataset();
const TAIL_LENGTH = DATASET[0].path.length;

const QUADRANT_ORDER = ["Leading", "Weakening", "Lagging", "Improving"];

// Evenly-spaced "nice" tick values (step rounded to 1/2/5 * a power of 10)
// so the axis reads e.g. 97, 98, 99, 100... instead of ugly fractional steps.
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
    const padX = (xMax - xMin) * 0.18 || 2;
    const padY = (yMax - yMin) * 0.18 || 2;
    return { xMin: xMin - padX, xMax: xMax + padX, yMin: yMin - padY, yMax: yMax + padY };
}

export default function SectorRotation() {
    const [visible, setVisible] = useState(() => new Set(SECTORS.map((s) => s.key)));
    const [focusKey, setFocusKey] = useState(null); // "All Sectors" (null) or one sector key from the sidebar list
    const [tailWindow, setTailWindow] = useState(8);
    const [scrubIndex, setScrubIndex] = useState(TAIL_LENGTH - 1);
    const [playing, setPlaying] = useState(false);
    const [timeframe, setTimeframe] = useState("daily"); // 'daily' | 'weekly' — cosmetic on demo data
    const [zoom, setZoom] = useState(1);

    const domain = useMemo(() => computeDomain(DATASET), []);

    useEffect(() => {
        if (!playing) return;
        const id = setInterval(() => {
            setScrubIndex((i) => (i >= TAIL_LENGTH - 1 ? 0 : i + 1));
        }, 700);
        return () => clearInterval(id);
    }, [playing]);

    function toggleSector(key) {
        setVisible((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }
    function showAll() { setVisible(new Set(SECTORS.map((s) => s.key))); }
    function hideAll() { setVisible(new Set()); }

    const shownDataset = DATASET.filter((s) => visible.has(s.key) && (!focusKey || s.key === focusKey));

    // Layout / coordinate mapping (fixed viewBox, zoom scales it around center).
    const W = 1000, H = 560, PAD = 56;
    const plotW = W - PAD * 2, plotH = H - PAD * 2;
    const half = 1 / zoom / 2;
    const vbX = W / 2 - (W / 2) / zoom;
    const vbY = H / 2 - (H / 2) / zoom;
    const viewBox = `${vbX} ${vbY} ${W / zoom} ${H / zoom}`;
    void half;

    function sx(x) { return PAD + ((x - domain.xMin) / (domain.xMax - domain.xMin)) * plotW; }
    function sy(y) { return PAD + plotH - ((y - domain.yMin) / (domain.yMax - domain.yMin)) * plotH; }
    const zeroX = sx(100), zeroY = sy(100);
    const xTicks = useMemo(() => niceTicks(domain.xMin, domain.xMax, 8), [domain]);
    const yTicks = useMemo(() => niceTicks(domain.yMin, domain.yMax, 7), [domain]);
    const tickDecimals = (v) => (Number.isInteger(v) ? 0 : 1);

    const currentQuadrants = useMemo(() => {
        const groups = { Leading: [], Weakening: [], Lagging: [], Improving: [] };
        DATASET.filter((s) => visible.has(s.key)).forEach((s) => {
            const pt = s.path[scrubIndex];
            groups[classifyQuadrant(pt)].push(s);
        });
        return groups;
    }, [scrubIndex, visible]);

    const daysAgo = TAIL_LENGTH - 1 - scrubIndex;
    const timelineLabel = daysAgo === 0 ? "Today" : `${daysAgo} ${timeframe === "daily" ? "days" : "weeks"} ago`;

    return (
        <div className="mx-auto max-w-[1600px] px-3 py-4">
            <div className="flex flex-col gap-4 lg:flex-row">
                {/* Sidebar */}
                <aside className="w-full shrink-0 rounded-xl border border-gray-200 bg-white p-4 lg:w-64">
                    <h2 className="mb-4 text-sm font-bold text-gray-900">RRG Settings</h2>

                    <div className="mb-4">
                        <label className="mb-1.5 block text-xs font-medium text-gray-500">Benchmark</label>
                        <select className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none focus:border-blue-400">
                            <option>Nifty 50</option>
                        </select>
                    </div>

                    <div className="mb-4">
                        <label className="mb-1.5 block text-xs font-medium text-gray-500">Timeframe</label>
                        <div className="inline-flex w-full rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                            {["daily", "weekly"].map((tf) => (
                                <button
                                    key={tf}
                                    onClick={() => setTimeframe(tf)}
                                    className={`flex-1 rounded-md py-1 text-xs font-semibold capitalize transition ${
                                        timeframe === tf ? "bg-blue-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-700"
                                    }`}
                                >
                                    {tf}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mb-5">
                        <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-gray-500">
                            <span>Tail</span>
                            <span className="font-bold text-gray-700">{tailWindow}</span>
                        </label>
                        <input
                            type="range" min={2} max={TAIL_LENGTH} value={tailWindow}
                            onChange={(e) => setTailWindow(Number(e.target.value))}
                            className="w-full accent-blue-600"
                        />
                    </div>

                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Index</div>
                    <div className="max-h-[420px] overflow-y-auto pr-1">
                        <button
                            onClick={() => setFocusKey(null)}
                            className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium transition ${
                                !focusKey ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
                            }`}
                        >
                            <span className="flex h-4 w-4 items-center justify-center rounded bg-gray-200 text-[9px]">▦</span>
                            All Sectors
                        </button>
                        {DATASET.map((s) => (
                            <button
                                key={s.key}
                                onClick={() => setFocusKey(s.key)}
                                className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium transition ${
                                    focusKey === s.key ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                                {s.label}
                            </button>
                        ))}
                    </div>
                </aside>

                {/* Main */}
                <div className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <h1 className="text-base font-bold text-gray-900">Relative Rotation Graph</h1>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                Demo data — not live
                            </span>
                        </div>
                        <div className="flex items-center gap-1 text-gray-400">
                            <button onClick={() => setZoom((z) => Math.min(3, z * 1.3))} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-700" title="Zoom in">
                                <FiZoomIn size={15} />
                            </button>
                            <button onClick={() => setZoom((z) => Math.max(1, z / 1.3))} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-700" title="Zoom out">
                                <FiZoomOut size={15} />
                            </button>
                            <button onClick={() => setZoom(1)} className="rounded-md p-1.5 hover:bg-gray-100 hover:text-gray-700" title="Reset zoom">
                                <FiMaximize2 size={15} />
                            </button>
                        </div>
                    </div>

                    {/* Timeline */}
                    <div className="mb-4 flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                        <button
                            onClick={() => setPlaying((v) => !v)}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
                            aria-label={playing ? "Pause" : "Play"}
                        >
                            {playing ? <FiPause size={12} /> : <FiPlay size={12} className="ml-0.5" />}
                        </button>
                        <span className="w-20 shrink-0 text-xs text-gray-400">{TAIL_LENGTH - 1} {timeframe === "daily" ? "days" : "weeks"} ago</span>
                        <input
                            type="range" min={0} max={TAIL_LENGTH - 1} value={scrubIndex}
                            onChange={(e) => { setPlaying(false); setScrubIndex(Number(e.target.value)); }}
                            className="flex-1 accent-blue-600"
                        />
                        <span className="w-16 shrink-0 text-right text-xs font-semibold text-gray-700">{timelineLabel}</span>
                    </div>

                    {/* Legend */}
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-gray-100 pb-3">
                        <button onClick={showAll} className="text-xs font-semibold text-blue-600 hover:underline">Show all</button>
                        <button onClick={hideAll} className="text-xs font-semibold text-gray-400 hover:underline">Hide all</button>
                        <span className="text-gray-200">|</span>
                        {DATASET.map((s) => (
                            <button
                                key={s.key}
                                onClick={() => toggleSector(s.key)}
                                className={`flex items-center gap-1 text-xs font-medium transition ${visible.has(s.key) ? "text-gray-600" : "text-gray-300"}`}
                            >
                                <span className="h-2 w-2 rounded-full" style={{ background: visible.has(s.key) ? s.color : "#d1d5db" }} />
                                {s.label}
                            </button>
                        ))}
                    </div>

                    {/* Chart */}
                    <svg viewBox={viewBox} className="h-[520px] w-full select-none">
                        {/* Quadrant backgrounds */}
                        <rect x={zeroX} y={PAD} width={PAD + plotW - zeroX} height={zeroY - PAD} fill="#22c55e" opacity="0.14" />
                        <rect x={zeroX} y={zeroY} width={PAD + plotW - zeroX} height={PAD + plotH - zeroY} fill="#eab308" opacity="0.14" />
                        <rect x={PAD} y={zeroY} width={zeroX - PAD} height={PAD + plotH - zeroY} fill="#ef4444" opacity="0.14" />
                        <rect x={PAD} y={PAD} width={zeroX - PAD} height={zeroY - PAD} fill="#3b82f6" opacity="0.14" />

                        {/* Trend (x-axis) ticks — light vertical gridlines + numeric labels below the plot */}
                        {xTicks.map((t) => (
                            <g key={`x-${t}`}>
                                <line x1={sx(t)} x2={sx(t)} y1={PAD} y2={PAD + plotH} stroke="#9ca3af" strokeWidth="1" opacity="0.15" />
                                <text x={sx(t)} y={PAD + plotH + 18} textAnchor="middle" fontSize="10" fill="#9ca3af">{t.toFixed(tickDecimals(t))}</text>
                            </g>
                        ))}
                        {/* Momentum (y-axis) ticks — light horizontal gridlines + numeric labels left of the plot */}
                        {yTicks.map((t) => (
                            <g key={`y-${t}`}>
                                <line x1={PAD} x2={PAD + plotW} y1={sy(t)} y2={sy(t)} stroke="#9ca3af" strokeWidth="1" opacity="0.15" />
                                <text x={PAD - 8} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{t.toFixed(tickDecimals(t))}</text>
                            </g>
                        ))}

                        <line x1={PAD} x2={PAD + plotW} y1={zeroY} y2={zeroY} stroke="#9ca3af" strokeWidth="1" />
                        <line x1={zeroX} x2={zeroX} y1={PAD} y2={PAD + plotH} stroke="#9ca3af" strokeWidth="1" />

                        <text x={PAD + plotW - 6} y={PAD + 16} textAnchor="end" fontSize="11" fontWeight="700" fill="#16a34a">Leading</text>
                        <text x={PAD + plotW - 6} y={PAD + plotH - 8} textAnchor="end" fontSize="11" fontWeight="700" fill="#ca8a04">Weakening</text>
                        <text x={PAD + 6} y={PAD + plotH - 8} fontSize="11" fontWeight="700" fill="#dc2626">Lagging</text>
                        <text x={PAD + 6} y={PAD + 16} fontSize="11" fontWeight="700" fill="#2563eb">Improving</text>

                        <text x={PAD + plotW / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="#9ca3af">Trend (RS-Ratio)</text>
                        <text x={16} y={PAD + plotH / 2} textAnchor="middle" fontSize="11" fill="#9ca3af" transform={`rotate(-90 16 ${PAD + plotH / 2})`}>Momentum (RS-Momentum)</text>

                        {shownDataset.map((s) => {
                            const start = Math.max(0, scrubIndex - tailWindow + 1);
                            const pts = s.path.slice(start, scrubIndex + 1);
                            const linePts = pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
                            const cur = pts[pts.length - 1];
                            return (
                                <g key={s.key}>
                                    <polyline points={linePts} fill="none" stroke={s.color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
                                    {pts.slice(0, -1).map((p, i) => (
                                        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="2.2" fill={s.color} opacity={0.35 + (i / pts.length) * 0.4} />
                                    ))}
                                    <circle cx={sx(cur.x)} cy={sy(cur.y)} r="5.5" fill={s.color} stroke="#fff" strokeWidth="1.5" />
                                    <text x={sx(cur.x) + 9} y={sy(cur.y) + 4} fontSize="11" fontWeight="700" fill={s.color} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>
                                        {s.label}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>
                </div>
            </div>

            {/* Bottom quadrant summary */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {QUADRANT_ORDER.map((q) => {
                    const c = QUADRANT_COLORS[q];
                    const items = currentQuadrants[q];
                    return (
                        <div key={q} className="overflow-hidden rounded-xl border border-gray-200" style={{ background: c.bg }}>
                            <div className="flex items-center justify-between px-4 py-2.5" style={{ color: c.text }}>
                                <span className="text-sm font-bold">{q}</span>
                                <span className="rounded bg-white/15 px-2 py-0.5 text-xs font-bold">{items.length}</span>
                            </div>
                            <div className="space-y-1.5 bg-white px-4 py-3">
                                {items.length === 0 && <div className="text-xs text-gray-400">No sectors</div>}
                                {items.map((s) => (
                                    <div key={s.key} className="flex items-center gap-2 text-sm text-gray-700">
                                        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                                        {s.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
