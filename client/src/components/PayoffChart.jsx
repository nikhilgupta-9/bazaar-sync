import React from "react";
import { ComposedChart, Area, Line, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceDot, ResponsiveContainer } from "recharts";
import { formatPrice } from "../utils/format";
import { computeDensityCurve } from "../utils/payoff";

// Linear-interpolated value of a curve series at an arbitrary price — same
// precision convention as payoff.js's computeBreakevens (only as accurate as
// the curve's sample spacing, fine for a chart marker). Returns null past
// the sampled range's edges or where the series itself is null (e.g. no IV
// snapshot for the "today" curve).
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

function CustomTooltip({ active, payload, label, spotPrice }) {
    if (!active || !payload?.length) return null;
    const pnlEntry = payload.find((p) => p.dataKey === "pnl");
    const todayEntry = payload.find((p) => p.dataKey === "todayPnl");
    const pctFromSpot = spotPrice ? ((label - spotPrice) / spotPrice) * 100 : null;
    return (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md px-3 py-2 text-xs shadow-xl">
            <div className="mb-1 font-bold text-gray-800 dark:text-gray-100">
                {formatPrice(label)}
                {pctFromSpot != null && (
                    <span className={`ml-1.5 font-semibold ${pctFromSpot >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                        ({pctFromSpot >= 0 ? "+" : ""}{pctFromSpot.toFixed(2)}%)
                    </span>
                )}
            </div>
            {pnlEntry && (
                <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-400 dark:text-gray-400">Expiry P&L</span>
                    <span className={`font-bold tabular-nums ${pnlEntry.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatPrice(pnlEntry.value)}</span>
                </div>
            )}
            {todayEntry?.value != null && (
                <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-400 dark:text-gray-400">Today P&L</span>
                    <span className={`font-bold tabular-nums ${todayEntry.value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatPrice(todayEntry.value)}</span>
                </div>
            )}
        </div>
    );
}

// Shows two curves, matching StockMojo's Strategy Builder / Simulator:
// a solid "Expiry" line with green/red profit-loss shading, a dashed blue "Today" line,
// ±1SD/±2SD expected-move references, and a clean spot indicator line.
export default function PayoffChart({ curve, spotPrice, breakevens = [], expectedMove, atmIv, yearsRemaining, height = 340 }) {
    if (!curve || !curve.length) {
        return (
            <div className="p-16 text-center text-xs text-gray-400">
                Add a leg from the option chain to see the payoff chart.
            </div>
        );
    }

    const max = Math.max(...curve.map((p) => p.pnl));
    const min = Math.min(...curve.map((p) => p.pnl));
    const zeroOffset = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);

    const hasToday = curve.some((p) => p.todayPnl != null);
    const spotExpiryPnl = spotPrice ? interpolateAt(curve, spotPrice, "pnl") : null;
    const spotTodayPnl = spotPrice && hasToday ? interpolateAt(curve, spotPrice, "todayPnl") : null;

    const density = atmIv && yearsRemaining != null ? computeDensityCurve(curve, spotPrice, atmIv, yearsRemaining) : null;
    const chartData = density ? curve.map((p, i) => ({ ...p, density: density[i] })) : curve;

    return (
        <div className="w-full">
            {(spotPrice || expectedMove) && (
                <div className="mb-2.5 flex items-center justify-between px-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                    <span className="text-gray-400 dark:text-gray-500">−2SD</span>
                    <span className="text-gray-400 dark:text-gray-500">−1SD</span>
                    <span className="text-xs font-black text-gray-800 dark:text-gray-100 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-md">
                        {spotPrice ? `Spot: ${formatPrice(spotPrice)}` : ""}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500">+1SD</span>
                    <span className="text-gray-400 dark:text-gray-500">+2SD</span>
                </div>
            )}

            <ResponsiveContainer width="100%" height={height}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                    <defs>
                        <linearGradient id="payoffGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset={0} stopColor="#22c55e" stopOpacity={0.25} />
                            <stop offset={zeroOffset} stopColor="#22c55e" stopOpacity={0.03} />
                            <stop offset={zeroOffset} stopColor="#ef4444" stopOpacity={0.03} />
                            <stop offset={1} stopColor="#ef4444" stopOpacity={0.25} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#888888" strokeOpacity={0.12} vertical={true} />
                    <XAxis 
                        dataKey="price" 
                        type="number" 
                        domain={["dataMin", "dataMax"]} 
                        tick={{ fontSize: 10, fill: "#888888" }} 
                        tickFormatter={(v) => Math.round(v)} 
                        axisLine={{ stroke: "#888888", strokeOpacity: 0.2 }}
                        tickLine={{ stroke: "#888888", strokeOpacity: 0.2 }}
                    />
                    <YAxis 
                        yAxisId="pnl" 
                        tick={{ fontSize: 10, fill: "#888888" }} 
                        width={60} 
                        axisLine={{ stroke: "#888888", strokeOpacity: 0.2 }}
                        tickLine={{ stroke: "#888888", strokeOpacity: 0.2 }}
                        tickFormatter={(v) => formatPrice(v)}
                    />
                    {density && <YAxis yAxisId="density" domain={[0, 4]} hide />}
                    <Tooltip content={<CustomTooltip spotPrice={spotPrice} />} />

                    {density && (
                        <Bar yAxisId="density" dataKey="density" barSize={5} isAnimationActive={false} legendType="none">
                            {chartData.map((p, i) => (
                                <Cell key={i} fill={p.pnl >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.15} />
                            ))}
                        </Bar>
                    )}

                    <ReferenceLine yAxisId="pnl" y={0} stroke="#94a3b8" strokeWidth={1} />
                    {spotPrice && <ReferenceLine yAxisId="pnl" x={spotPrice} stroke="#475569" strokeWidth={1.5} />}
                    {breakevens.map((be) => (
                        <ReferenceLine key={be} yAxisId="pnl" x={be} stroke="#8b5cf6" strokeDasharray="3 3" strokeWidth={1} />
                    ))}
                    {expectedMove && (
                        <>
                            <ReferenceLine yAxisId="pnl" x={expectedMove.minus2sd} stroke="#94a3b8" strokeOpacity={0.3} strokeDasharray="2 2" />
                            <ReferenceLine yAxisId="pnl" x={expectedMove.minus1sd} stroke="#94a3b8" strokeOpacity={0.3} strokeDasharray="2 2" />
                            <ReferenceLine yAxisId="pnl" x={expectedMove.plus1sd} stroke="#94a3b8" strokeOpacity={0.3} strokeDasharray="2 2" />
                            <ReferenceLine yAxisId="pnl" x={expectedMove.plus2sd} stroke="#94a3b8" strokeOpacity={0.3} strokeDasharray="2 2" />
                        </>
                    )}

                    <Area 
                        yAxisId="pnl" 
                        type="monotone" 
                        dataKey="pnl" 
                        name="Expiry P&L" 
                        stroke="#22c55e" 
                        strokeWidth={2} 
                        fill="url(#payoffGradient)" 
                        dot={false}
                    />
                    {hasToday && (
                        <Line 
                            yAxisId="pnl" 
                            type="monotone" 
                            dataKey="todayPnl" 
                            name="Today P&L" 
                            stroke="#3b82f6" 
                            strokeWidth={1.5} 
                            strokeDasharray="4 4" 
                            dot={false} 
                        />
                    )}

                    {spotExpiryPnl != null && (
                        <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotExpiryPnl} r={4} fill="#22c55e" stroke="#fff" strokeWidth={2} />
                    )}
                    {spotTodayPnl != null && (
                        <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotTodayPnl} r={4} fill="#3b82f6" stroke="#fff" strokeWidth={2} />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}
