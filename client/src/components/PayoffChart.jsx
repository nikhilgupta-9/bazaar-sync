import React, { useMemo } from "react";
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

function CustomTooltip({ active, payload, label, spotPrice, oiData = [] }) {
    if (!active || !payload?.length || label == null) return null;
    const pnlEntry = payload.find((p) => p.dataKey === "pnl");
    const todayEntry = payload.find((p) => p.dataKey === "todayPnl");
    const pctFromSpot = spotPrice ? ((label - spotPrice) / spotPrice) * 100 : null;

    const closestRow = oiData.find((r) => Math.abs(r.strike - label) < 5);

    return (
        <div className="rounded-xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-[#0b1420]/95 backdrop-blur-md px-3.5 py-2.5 text-xs shadow-xl min-w-[170px]">
            <div className="mb-1.5 flex items-center justify-between font-bold text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-white/10 pb-1">
                <span>{Math.round(label).toLocaleString("en-IN")}</span>
                {pctFromSpot != null && (
                    <span className={`text-[11px] font-semibold ${pctFromSpot >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {pctFromSpot >= 0 ? "+" : ""}{pctFromSpot.toFixed(2)}%
                    </span>
                )}
            </div>
            {pnlEntry && (
                <div className="flex items-center justify-between gap-4 py-0.5">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">Expiry P&L:</span>
                    <span className={`font-bold tabular-nums font-mono ${pnlEntry.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {pnlEntry.value >= 0 ? "+" : ""}{formatPrice(pnlEntry.value)}
                    </span>
                </div>
            )}
            {todayEntry?.value != null && (
                <div className="flex items-center justify-between gap-4 py-0.5">
                    <span className="text-gray-500 dark:text-gray-400 font-medium">Today P&L:</span>
                    <span className={`font-bold tabular-nums font-mono ${todayEntry.value >= 0 ? "text-blue-600 dark:text-blue-400" : "text-rose-600 dark:text-rose-400"}`}>
                        {todayEntry.value >= 0 ? "+" : ""}{formatPrice(todayEntry.value)}
                    </span>
                </div>
            )}
            {closestRow && (closestRow.ce?.oi || closestRow.pe?.oi) && (
                <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-white/10 space-y-0.5 text-[11px]">
                    {closestRow.ce?.oi != null && (
                        <div className="flex items-center justify-between gap-4 text-emerald-600 dark:text-emerald-400">
                            <span>Call OI:</span>
                            <span className="font-bold tabular-nums font-mono">{Number(closestRow.ce.oi).toLocaleString("en-IN")}</span>
                        </div>
                    )}
                    {closestRow.pe?.oi != null && (
                        <div className="flex items-center justify-between gap-4 text-rose-600 dark:text-rose-400">
                            <span>Put OI:</span>
                            <span className="font-bold tabular-nums font-mono">{Number(closestRow.pe.oi).toLocaleString("en-IN")}</span>
                        </div>
                    )}
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
    const maxBarH = offset.height * 0.45; // Up to 45% of chart height
    const bottomY = offset.top + offset.height;

    const xAxis = rechartsProps.xAxisMap ? Object.values(rechartsProps.xAxisMap)[0] : null;
    const getX = (strike) => {
        if (xAxis && typeof xAxis.scale === "function") {
            const x = xAxis.scale(strike);
            if (typeof x === "number" && !Number.isNaN(x)) return x;
        }
        return offset.left + ((strike - minPrice) / (maxPrice - minPrice)) * offset.width;
    };

    const barWidth = 6;

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
                        {/* Call OI bar (soft light pastel green) */}
                        {ceH > 0 && (
                            <rect
                                x={xPos - barWidth - 1}
                                y={bottomY - ceH}
                                width={barWidth}
                                height={ceH}
                                rx={1.5}
                                fill="#86efac"
                                fillOpacity={0.45}
                                stroke="#22c55e"
                                strokeOpacity={0.6}
                                strokeWidth={0.5}
                            />
                        )}
                        {/* Put OI bar (soft light pastel red/pink) */}
                        {peH > 0 && (
                            <rect
                                x={xPos + 1}
                                y={bottomY - peH}
                                width={barWidth}
                                height={peH}
                                rx={1.5}
                                fill="#fca5a5"
                                fillOpacity={0.45}
                                stroke="#ef4444"
                                strokeOpacity={0.6}
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

    if (!curve || !curve.length) {
        return (
            <div className="p-16 text-center text-xs text-gray-400">
                Add a leg from the option chain to see the payoff chart.
            </div>
        );
    }

    const minPrice = curve[0]?.price ?? 0;
    const maxPrice = curve[curve.length - 1]?.price ?? 0;

    const max = Math.max(...curve.map((p) => p.pnl));
    const min = Math.min(...curve.map((p) => p.pnl));
    const zeroOffset = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);

    const hasToday = curve.some((p) => p.todayPnl != null);
    const spotExpiryPnl = spotPrice ? interpolateAt(curve, spotPrice, "pnl") : null;
    const spotTodayPnl = spotPrice && hasToday ? interpolateAt(curve, spotPrice, "todayPnl") : null;

    // Filter OI data to what is visible
    const visibleOiData = useMemo(() => {
        if (!oiData?.length || minPrice >= maxPrice) return [];
        return oiData.filter((r) => r.strike >= minPrice && r.strike <= maxPrice);
    }, [oiData, minPrice, maxPrice]);

    const axisColor = isDark ? "#475569" : "#94a3b8";
    const textColor = isDark ? "#94a3b8" : "#64748b";

    const sd1Down = spotPrice && expectedMove ? spotPrice - expectedMove : null;
    const sd2Down = spotPrice && expectedMove ? spotPrice - 2 * expectedMove : null;
    const sd1Up = spotPrice && expectedMove ? spotPrice + expectedMove : null;
    const sd2Up = spotPrice && expectedMove ? spotPrice + 2 * expectedMove : null;

    return (
        <div className="w-full flex flex-col">
            {/* Top SD & Spot Header */}
            <div className="mb-2 flex items-center justify-between px-2 sm:px-6 text-[10.5px] font-bold text-gray-500 dark:text-gray-400">
                <span className="tabular-nums">−2SD {sd2Down ? `(${Math.round(sd2Down).toLocaleString("en-IN")})` : ""}</span>
                <span className="tabular-nums">−1SD {sd1Down ? `(${Math.round(sd1Down).toLocaleString("en-IN")})` : ""}</span>
                <span className="text-xs font-black text-gray-900 dark:text-white px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 shadow-xs">
                    {spotPrice ? `Spot: ${formatPrice(spotPrice)}` : ""}
                </span>
                <span className="tabular-nums">+1SD {sd1Up ? `(${Math.round(sd1Up).toLocaleString("en-IN")})` : ""}</span>
                <span className="tabular-nums">+2SD {sd2Up ? `(${Math.round(sd2Up).toLocaleString("en-IN")})` : ""}</span>
            </div>

            <div className="relative w-full" style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={curve} margin={{ top: 15, right: 25, left: 10, bottom: 5 }}>
                        <defs>
                            {/* Area fill gradient: soft green above zero, soft red below zero */}
                            <linearGradient id="payoffAreaGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.24} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#22c55e" stopOpacity={0.03} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#ef4444" stopOpacity={0.03} />
                                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.24} />
                            </linearGradient>

                            {/* Stroke gradient: green above zero, red below zero */}
                            <linearGradient id="payoffStrokeGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#16a34a" stopOpacity={1} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#16a34a" stopOpacity={1} />
                                <stop offset={`${Math.max(0, Math.min(100, zeroOffset * 100))}%`} stopColor="#dc2626" stopOpacity={1} />
                                <stop offset="100%" stopColor="#dc2626" stopOpacity={1} />
                            </linearGradient>
                        </defs>

                        <XAxis
                            dataKey="price"
                            type="number"
                            domain={[minPrice, maxPrice]}
                            tick={{ fontSize: 10, fill: textColor }}
                            tickFormatter={(v) => Math.round(v).toLocaleString("en-IN")}
                            axisLine={{ stroke: axisColor, strokeWidth: 1 }}
                            tickLine={{ stroke: axisColor, strokeWidth: 1 }}
                        />
                        <YAxis
                            yAxisId="pnl"
                            tick={{ fontSize: 10, fill: textColor }}
                            width={58}
                            axisLine={{ stroke: axisColor, strokeWidth: 1 }}
                            tickLine={{ stroke: axisColor, strokeWidth: 1 }}
                            tickFormatter={(v) => Math.round(v).toLocaleString("en-IN")}
                            label={{
                                value: "P&L",
                                angle: -90,
                                position: "insideLeft",
                                fill: textColor,
                                fontSize: 10,
                                fontWeight: "bold",
                                offset: 12,
                            }}
                        />

                        {/* Background Open Interest (Call & Put) Bars */}
                        {visibleOiData.length > 0 && (
                            <Customized component={<OiBarsLayer oiData={visibleOiData} minPrice={minPrice} maxPrice={maxPrice} />} />
                        )}

                        {/* Zero Line */}
                        <ReferenceLine yAxisId="pnl" y={0} stroke={axisColor} strokeWidth={1} strokeOpacity={0.7} />

                        {/* Spot Price Line */}
                        {spotPrice && (
                            <ReferenceLine
                                yAxisId="pnl"
                                x={spotPrice}
                                stroke={isDark ? "#f8fafc" : "#0f172a"}
                                strokeWidth={1.5}
                            />
                        )}

                        {/* Breakevens */}
                        {breakevens.map((be) => (
                            <ReferenceLine key={be} yAxisId="pnl" x={be} stroke="#8b5cf6" strokeDasharray="3 3" strokeWidth={1} />
                        ))}

                        {/* Standard Deviation Lines */}
                        {expectedMove && (
                            <>
                                <ReferenceLine yAxisId="pnl" x={expectedMove.minus2sd} stroke={axisColor} strokeOpacity={0.35} strokeDasharray="3 3" />
                                <ReferenceLine yAxisId="pnl" x={expectedMove.minus1sd} stroke={axisColor} strokeOpacity={0.35} strokeDasharray="3 3" />
                                <ReferenceLine yAxisId="pnl" x={expectedMove.plus1sd} stroke={axisColor} strokeOpacity={0.35} strokeDasharray="3 3" />
                                <ReferenceLine yAxisId="pnl" x={expectedMove.plus2sd} stroke={axisColor} strokeOpacity={0.35} strokeDasharray="3 3" />
                            </>
                        )}

                        {/* Expiry Payoff Curve (Green / Red gradient line & area) */}
                        <Area
                            yAxisId="pnl"
                            type="monotone"
                            dataKey="pnl"
                            name="Expiry P&L"
                            stroke="url(#payoffStrokeGradient)"
                            strokeWidth={2.2}
                            fill="url(#payoffAreaGradient)"
                            dot={false}
                            isAnimationActive={false}
                        />

                        {/* Today Payoff Curve (Dashed blue) */}
                        {hasToday && (
                            <Line
                                yAxisId="pnl"
                                type="monotone"
                                dataKey="todayPnl"
                                name="Today P&L"
                                stroke="#2563eb"
                                strokeWidth={1.8}
                                strokeDasharray="5 5"
                                dot={false}
                                isAnimationActive={false}
                            />
                        )}

                        {spotExpiryPnl != null && (
                            <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotExpiryPnl} r={4} fill="#22c55e" stroke="#fff" strokeWidth={2} />
                        )}
                        {spotTodayPnl != null && (
                            <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotTodayPnl} r={4} fill="#2563eb" stroke="#fff" strokeWidth={2} />
                        )}

                        <Tooltip content={<CustomTooltip spotPrice={spotPrice} oiData={visibleOiData} />} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
