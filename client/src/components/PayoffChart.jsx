import React, { useMemo, useState } from "react";
import {
    ComposedChart,
    Area,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    ReferenceLine,
    ReferenceDot,
    ResponsiveContainer,
    Customized,
    CartesianGrid,
} from "recharts";
import { formatPrice } from "../utils/format";
import { useTheme } from "../context/ThemeContext";

function interpolateAt(curve, price, key) {
    if (!curve.length || price == null) return null;
    if (price <= curve[0].price) return curve[0][key];
    const last = curve[curve.length - 1];
    if (price >= last.price) return last[key];
    for (let i = 1; i < curve.length; i++) {
        if (curve[i].price >= price) {
            const a = curve[i - 1], b = curve[i];
            if (a[key] == null || b[key] == null) return null;
            const t = a.price === b.price ? 0 : (price - a.price) / (b.price - a.price);
            return a[key] + t * (b[key] - a[key]);
        }
    }
    return null;
}

function CustomTooltip({ active, payload, label, spotPrice, oiData = [], breakevens = [] }) {
    if (!active || !payload?.length || label == null) return null;
    const pnlEntry = payload.find((p) => p.dataKey === "pnl");
    const todayEntry = payload.find((p) => p.dataKey === "todayPnl");
    const pctFromSpot = spotPrice ? ((label - spotPrice) / spotPrice) * 100 : null;

    // Find closest strike row within reasonable range for OI display
    let closestRow = null;
    let minDiff = Infinity;
    for (const r of oiData) {
        const diff = Math.abs(r.strike - label);
        if (diff < minDiff) {
            minDiff = diff;
            closestRow = r;
        }
    }
    const showOiRow = closestRow && minDiff <= 60 && ((closestRow.ce?.oi || 0) > 0 || (closestRow.pe?.oi || 0) > 0);

    // Check if near any breakeven
    const isNearBe = breakevens.some((be) => Math.abs(be - label) <= Math.max(20, (spotPrice || 20000) * 0.0012));

    return (
        <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-[#070e17]/95 backdrop-blur-md px-3.5 py-2.5 text-xs shadow-2xl min-w-[200px] pointer-events-none z-50">
            {/* Header: Strike & % from Spot */}
            <div className="mb-2 flex items-center justify-between font-bold text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-white/10 pb-1.5">
                <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-black font-mono tracking-tight">{Math.round(label).toLocaleString("en-IN")}</span>
                    {isNearBe && (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            BE
                        </span>
                    )}
                </div>
                {pctFromSpot != null && (
                    <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                        pctFromSpot >= 0
                            ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40"
                            : "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40"
                    }`}>
                        {pctFromSpot >= 0 ? "+" : ""}{pctFromSpot.toFixed(2)}%
                    </span>
                )}
            </div>

            {/* PnL entries */}
            <div className="space-y-1.5">
                {pnlEntry && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 font-medium">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            Expiry P&L:
                        </span>
                        <span className={`font-black tabular-nums font-mono text-[12px] ${pnlEntry.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {pnlEntry.value >= 0 ? "+" : ""}{formatPrice(pnlEntry.value)}
                        </span>
                    </div>
                )}
                {todayEntry?.value != null && (
                    <div className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 font-medium">
                            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                            Today (T+0):
                        </span>
                        <span className={`font-black tabular-nums font-mono text-[12px] ${todayEntry.value >= 0 ? "text-blue-600 dark:text-blue-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {todayEntry.value >= 0 ? "+" : ""}{formatPrice(todayEntry.value)}
                        </span>
                    </div>
                )}
            </div>

            {/* OI Metrics if available */}
            {showOiRow && (
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/10 space-y-1 text-[11px]">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">OI at {closestRow.strike}</div>
                    <div className="flex items-center justify-between gap-4 text-emerald-600 dark:text-emerald-400">
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-xs bg-emerald-500" />
                            Call OI:
                        </span>
                        <span className="font-bold tabular-nums font-mono">{Number(closestRow.ce?.oi || 0).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-rose-600 dark:text-rose-400">
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-xs bg-rose-500" />
                            Put OI:
                        </span>
                        <span className="font-bold tabular-nums font-mono">{Number(closestRow.pe?.oi || 0).toLocaleString("en-IN")}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

// Background Open Interest (OI) bars at each strike along the X-axis
function OiBarsLayer({ oiData = [], minPrice, maxPrice, ...rechartsProps }) {
    const offset = rechartsProps.offset;
    if (!offset || !offset.width || !offset.height || !oiData?.length || minPrice == null || maxPrice == null || minPrice >= maxPrice) {
        return null;
    }

    const visibleRows = oiData.filter(
        (r) => r.strike >= minPrice && r.strike <= maxPrice && ((r.ce?.oi || 0) > 0 || (r.pe?.oi || 0) > 0)
    );
    if (!visibleRows.length) return null;

    const maxOi = Math.max(...visibleRows.map((r) => Math.max(r.ce?.oi || 0, r.pe?.oi || 0)), 1);
    const maxBarH = offset.height * 0.38; // Up to 38% of chart height
    const bottomY = offset.top + offset.height;

    const xAxis = rechartsProps.xAxisMap ? Object.values(rechartsProps.xAxisMap)[0] : null;
    const getX = (strike) => {
        if (xAxis && typeof xAxis.scale === "function") {
            const x = xAxis.scale(strike);
            if (typeof x === "number" && !Number.isNaN(x)) return x;
        }
        return offset.left + ((strike - minPrice) / (maxPrice - minPrice)) * offset.width;
    };

    const barWidth = 5;

    return (
        <g className="oi-bars-layer" style={{ pointerEvents: "none" }}>
            {visibleRows.map((r) => {
                const xPos = getX(r.strike);
                if (xPos < offset.left - 5 || xPos > offset.left + offset.width + 5) return null;

                const ceOi = r.ce?.oi || 0;
                const peOi = r.pe?.oi || 0;
                const ceH = ceOi > 0 ? Math.max(2, (ceOi / maxOi) * maxBarH) : 0;
                const peH = peOi > 0 ? Math.max(2, (peOi / maxOi) * maxBarH) : 0;

                return (
                    <g key={r.strike}>
                        {/* Call OI bar (soft emerald green) */}
                        {ceH > 0 && (
                            <rect
                                x={xPos - barWidth - 1}
                                y={bottomY - ceH}
                                width={barWidth}
                                height={ceH}
                                rx={1.5}
                                fill="#10b981"
                                fillOpacity={0.35}
                                stroke="#10b981"
                                strokeOpacity={0.65}
                                strokeWidth={0.5}
                            />
                        )}
                        {/* Put OI bar (soft rose red) */}
                        {peH > 0 && (
                            <rect
                                x={xPos + 1}
                                y={bottomY - peH}
                                width={barWidth}
                                height={peH}
                                rx={1.5}
                                fill="#ef4444"
                                fillOpacity={0.35}
                                stroke="#ef4444"
                                strokeOpacity={0.65}
                                strokeWidth={0.5}
                            />
                        )}
                    </g>
                );
            })}
        </g>
    );
}

export default function PayoffChart({
    curve,
    spotPrice,
    breakevens = [],
    expectedMove,
    atmIv,
    yearsRemaining,
    oiData = [],
    height = 360,
}) {
    const { isDark } = useTheme();

    // StockMojo Interactive Layer Toggles
    const [showExpiry, setShowExpiry] = useState(true);
    const [showToday, setShowToday] = useState(true);
    const [showOi, setShowOi] = useState(true);
    const [showBreakevens, setShowBreakevens] = useState(true);
    const [showSd, setShowSd] = useState(true);

    const minPrice = curve?.[0]?.price ?? 0;
    const maxPrice = curve?.[curve.length - 1]?.price ?? 0;

    const visibleOiData = useMemo(() => {
        if (!oiData?.length || minPrice >= maxPrice) return [];
        return oiData.filter((r) => r.strike >= minPrice && r.strike <= maxPrice);
    }, [oiData, minPrice, maxPrice]);

    if (!curve || !curve.length) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 flex items-center justify-center text-xl mb-3 shadow-xs">
                    📊
                </div>
                <div className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">
                    No Positions Selected
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm">
                    Select strikes to buy or sell from the Option Chain, or choose a Readymade Strategy to view the interactive payoff chart.
                </p>
            </div>
        );
    }

    const max = Math.max(...curve.map((p) => p.pnl));
    const min = Math.min(...curve.map((p) => p.pnl));
    const zeroOffset = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);

    const hasToday = curve.some((p) => p.todayPnl != null);
    const spotExpiryPnl = spotPrice ? interpolateAt(curve, spotPrice, "pnl") : null;
    const spotTodayPnl = spotPrice && hasToday ? interpolateAt(curve, spotPrice, "todayPnl") : null;

    const axisColor = isDark ? "#334155" : "#cbd5e1";
    const textColor = isDark ? "#94a3b8" : "#64748b";

    const em = expectedMove && typeof expectedMove === "object" ? expectedMove : null;
    const sigma = typeof expectedMove === "number" && Number.isFinite(expectedMove) ? expectedMove : null;
    const sd1Down = em ? em.minus1sd : spotPrice && sigma ? spotPrice - sigma : null;
    const sd2Down = em ? em.minus2sd : spotPrice && sigma ? spotPrice - 2 * sigma : null;
    const sd1Up = em ? em.plus1sd : spotPrice && sigma ? spotPrice + sigma : null;
    const sd2Up = em ? em.plus2sd : spotPrice && sigma ? spotPrice + 2 * sigma : null;

    return (
        <div className="w-full flex flex-col">
            {/* Top Ribbon: SD levels + Spot Indicator (StockMojo style) */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl bg-gray-50/80 dark:bg-[#070e17]/80 border border-gray-200/80 dark:border-white/5 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-2 sm:gap-3">
                    <span className="hidden sm:inline tabular-nums">
                        −2SD {sd2Down ? <span className="font-mono text-gray-700 dark:text-gray-300">({Math.round(sd2Down).toLocaleString("en-IN")})</span> : ""}
                    </span>
                    <span className="tabular-nums">
                        −1SD {sd1Down ? <span className="font-mono text-gray-700 dark:text-gray-300">({Math.round(sd1Down).toLocaleString("en-IN")})</span> : ""}
                    </span>
                </div>

                <div className="flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                    <span>Spot: {spotPrice ? formatPrice(spotPrice) : "—"}</span>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                    <span className="tabular-nums">
                        +1SD {sd1Up ? <span className="font-mono text-gray-700 dark:text-gray-300">({Math.round(sd1Up).toLocaleString("en-IN")})</span> : ""}
                    </span>
                    <span className="hidden sm:inline tabular-nums">
                        +2SD {sd2Up ? <span className="font-mono text-gray-700 dark:text-gray-300">({Math.round(sd2Up).toLocaleString("en-IN")})</span> : ""}
                    </span>
                </div>
            </div>

            {/* Interactive Legend / Controls Toolbar (StockMojo style) */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={() => setShowExpiry((v) => !v)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                            showExpiry
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 shadow-2xs"
                                : "bg-gray-100 text-gray-400 border-transparent dark:bg-white/5 dark:text-gray-500 opacity-60"
                        }`}
                        title="Toggle Expiry Payoff Curve"
                    >
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span>Expiry</span>
                    </button>

                    {hasToday && (
                        <button
                            type="button"
                            onClick={() => setShowToday((v) => !v)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                                showToday
                                    ? "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800 shadow-2xs"
                                    : "bg-gray-100 text-gray-400 border-transparent dark:bg-white/5 dark:text-gray-500 opacity-60"
                            }`}
                            title="Toggle Today (T+0) Curve"
                        >
                            <span className="w-3 border-t-2 border-dashed border-blue-500" />
                            <span>Today (T+0)</span>
                        </button>
                    )}

                    {visibleOiData.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowOi((v) => !v)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                                showOi
                                    ? "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 shadow-2xs"
                                    : "bg-gray-100 text-gray-400 border-transparent dark:bg-white/5 dark:text-gray-500 opacity-60"
                            }`}
                            title="Toggle Open Interest (OI) Bars"
                        >
                            <span className="flex items-end gap-0.5 h-3">
                                <span className="w-1 h-2 bg-emerald-500 rounded-2xs" />
                                <span className="w-1 h-3 bg-rose-500 rounded-2xs" />
                            </span>
                            <span>OI Bars</span>
                        </button>
                    )}

                    {breakevens.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowBreakevens((v) => !v)}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                                showBreakevens
                                    ? "bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800 shadow-2xs"
                                    : "bg-gray-100 text-gray-400 border-transparent dark:bg-white/5 dark:text-gray-500 opacity-60"
                            }`}
                            title="Toggle Breakeven Lines"
                        >
                            <span className="w-3 border-t-2 border-dashed border-purple-500" />
                            <span>Breakevens</span>
                        </button>
                    )}

                    {expectedMove && (
                        <button
                            type="button"
                            onClick={() => setShowSd((v) => !v)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold transition cursor-pointer border ${
                                showSd
                                    ? "bg-gray-200/90 text-gray-800 border-gray-300 dark:bg-white/10 dark:text-gray-200 dark:border-white/15 shadow-2xs"
                                    : "bg-gray-100 text-gray-400 border-transparent dark:bg-white/5 dark:text-gray-500 opacity-60"
                            }`}
                            title="Toggle Standard Deviation Lines"
                        >
                            <span>± SD</span>
                        </button>
                    )}
                </div>

                {/* Sub-Legend for OI bars when visible */}
                {showOi && visibleOiData.length > 0 && (
                    <div className="hidden sm:flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400 font-semibold">
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-xs bg-emerald-500" />
                            Call OI
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-xs bg-rose-500" />
                            Put OI
                        </span>
                    </div>
                )}
            </div>

            {/* Payoff Chart Canvas */}
            <div className={`relative w-full ${!height ? "h-[270px] sm:h-[330px] md:h-[370px]" : ""}`} style={height ? { height } : undefined}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={curve} margin={{ top: 8, right: 15, left: 0, bottom: 2 }}>
                        <defs>
                            {/* Area fill gradient: soft green above zero, soft red below zero */}
                            <linearGradient id="payoffAreaGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.32} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#10b981" stopOpacity={0.03} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#ef4444" stopOpacity={0.03} />
                                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.32} />
                            </linearGradient>

                            {/* Stroke gradient: green above zero, red below zero */}
                            <linearGradient id="payoffStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#10b981" stopOpacity={1} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#ef4444" stopOpacity={1} />
                                <stop offset="100%" stopColor="#ef4444" stopOpacity={1} />
                            </linearGradient>
                        </defs>

                        {/* Subtle Horizontal Grid lines (StockMojo style) */}
                        <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}
                        />

                        <XAxis
                            dataKey="price"
                            type="number"
                            domain={[minPrice, maxPrice]}
                            tick={{ fontSize: 9.5, fill: textColor }}
                            tickFormatter={(v) => Math.round(v).toLocaleString("en-IN")}
                            axisLine={{ stroke: axisColor, strokeWidth: 1 }}
                            tickLine={{ stroke: axisColor, strokeWidth: 1 }}
                        />
                        <YAxis
                            yAxisId="pnl"
                            tick={{ fontSize: 9.5, fill: textColor }}
                            width={52}
                            axisLine={{ stroke: axisColor, strokeWidth: 1 }}
                            tickLine={{ stroke: axisColor, strokeWidth: 1 }}
                            tickFormatter={(v) => Math.round(v).toLocaleString("en-IN")}
                            label={{
                                value: "P&L (₹)",
                                angle: -90,
                                position: "insideLeft",
                                fill: textColor,
                                fontSize: 9.5,
                                fontWeight: "bold",
                                offset: 8,
                            }}
                        />

                        {/* Background Open Interest (Call & Put) Bars */}
                        {showOi && visibleOiData.length > 0 && (
                            <Customized component={<OiBarsLayer oiData={visibleOiData} minPrice={minPrice} maxPrice={maxPrice} />} />
                        )}

                        {/* Prominent Zero Line dividing Profit and Loss */}
                        <ReferenceLine
                            yAxisId="pnl"
                            y={0}
                            stroke={isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.3)"}
                            strokeWidth={1.2}
                            strokeDasharray="4 2"
                        />

                        {/* Spot Price Line */}
                        {spotPrice && (
                            <ReferenceLine
                                yAxisId="pnl"
                                x={spotPrice}
                                stroke={isDark ? "#38bdf8" : "#0284c7"}
                                strokeWidth={1.8}
                            />
                        )}

                        {/* Breakeven lines */}
                        {showBreakevens &&
                            breakevens.map((be) => (
                                <ReferenceLine
                                    key={be}
                                    yAxisId="pnl"
                                    x={be}
                                    stroke="#a855f7"
                                    strokeDasharray="4 3"
                                    strokeWidth={1.5}
                                />
                            ))}

                        {/* Standard Deviation Lines */}
                        {showSd && expectedMove && (
                            <>
                                <ReferenceLine yAxisId="pnl" x={expectedMove.minus2sd} stroke={axisColor} strokeOpacity={0.4} strokeDasharray="3 3" />
                                <ReferenceLine yAxisId="pnl" x={expectedMove.minus1sd} stroke={axisColor} strokeOpacity={0.4} strokeDasharray="3 3" />
                                <ReferenceLine yAxisId="pnl" x={expectedMove.plus1sd} stroke={axisColor} strokeOpacity={0.4} strokeDasharray="3 3" />
                                <ReferenceLine yAxisId="pnl" x={expectedMove.plus2sd} stroke={axisColor} strokeOpacity={0.4} strokeDasharray="3 3" />
                            </>
                        )}

                        {/* Expiry Payoff Curve (Green / Red gradient line & area) */}
                        {showExpiry && (
                            <Area
                                yAxisId="pnl"
                                type="monotone"
                                dataKey="pnl"
                                name="Expiry P&L"
                                stroke="url(#payoffStrokeGradient)"
                                strokeWidth={2.4}
                                fill="url(#payoffAreaGradient)"
                                dot={false}
                                isAnimationActive={false}
                            />
                        )}

                        {/* Today Payoff Curve (Dashed blue) */}
                        {showToday && hasToday && (
                            <Line
                                yAxisId="pnl"
                                type="monotone"
                                dataKey="todayPnl"
                                name="Today P&L"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                strokeDasharray="4 4"
                                dot={false}
                                isAnimationActive={false}
                            />
                        )}

                        {/* Intersection dots at spot price */}
                        {showExpiry && spotExpiryPnl != null && (
                            <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotExpiryPnl} r={4.5} fill="#10b981" stroke="#ffffff" strokeWidth={2} />
                        )}
                        {showToday && spotTodayPnl != null && (
                            <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotTodayPnl} r={4.5} fill="#3b82f6" stroke="#ffffff" strokeWidth={2} />
                        )}

                        <Tooltip content={<CustomTooltip spotPrice={spotPrice} oiData={visibleOiData} breakevens={breakevens} />} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* Bottom Real-Time Metric Strip (StockMojo style) */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 rounded-xl bg-gray-50/80 dark:bg-[#070e17]/80 border border-gray-200/80 dark:border-white/5 text-[11px]">
                <div className="flex items-center gap-3.5">
                    <span className="flex items-center gap-1.5 font-bold text-gray-700 dark:text-gray-300">
                        <span className="w-2.5 h-1.5 rounded-xs bg-emerald-500 inline-block" />
                        Expiry P&amp;L
                    </span>
                    {hasToday && (
                        <span className="flex items-center gap-1.5 font-bold text-blue-600 dark:text-blue-400">
                            <span className="w-3 border-t-2 border-dashed border-blue-500 inline-block" />
                            Today P&amp;L
                        </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs font-mono font-bold">
                    {spotExpiryPnl != null && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-gray-500 dark:text-gray-400 font-sans font-medium text-[11px]">P&amp;L at spot (Expiry):</span>
                            <span className={`tabular-nums ${spotExpiryPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                {spotExpiryPnl >= 0 ? "+" : ""}{formatPrice(spotExpiryPnl)}
                            </span>
                        </div>
                    )}
                    {spotTodayPnl != null && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-gray-500 dark:text-gray-400 font-sans font-medium text-[11px]">P&amp;L at spot (Today):</span>
                            <span className={`tabular-nums ${spotTodayPnl >= 0 ? "text-blue-600 dark:text-blue-400" : "text-rose-600 dark:text-rose-400"}`}>
                                {spotTodayPnl >= 0 ? "+" : ""}{formatPrice(spotTodayPnl)}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
