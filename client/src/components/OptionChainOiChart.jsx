import React, { useState, useMemo } from "react";
// components/OptionChainOiChart.jsx — StockMojo-Parity Interactive Open Interest (OI) Distribution Chart
// Visualizes Call OI (emerald) vs Put OI (rose) across strikes with Spot, ATM & Max Pain reference markers.
// Clicking any strike bar immediately opens the bottom-docked candlestick chart drawer.

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ReferenceLine,
    ResponsiveContainer,
} from "recharts";
import { formatPrice, formatPercent, formatOi } from "../utils/format";
import { FiTrendingUp, FiBarChart2, FiInfo, FiActivity } from "react-icons/fi";

export default function OptionChainOiChart({
    data,
    displayRows,
    fmtPrice,
    fmtQty,
    fmtStrike,
    effectiveAtmStrike,
    isCrypto,
    onOpenChart,
}) {
    // Metric mode: "totalOi" (Total Open Interest) | "oiChange" (Change in Open Interest)
    const [metricMode, setMetricMode] = useState("totalOi");

    // Prepare chart data
    const chartData = useMemo(() => {
        if (!displayRows || !displayRows.length) return [];

        return displayRows.map((r) => {
            const isAtm = r.strike === effectiveAtmStrike;
            const ceOi = Number(r.ce?.oi || 0);
            const peOi = Number(r.pe?.oi || 0);
            const ceOiChange = Number(r.ce?.oiChange || 0);
            const peOiChange = Number(r.pe?.oiChange || 0);
            const strikePcr = ceOi > 0 ? (peOi / ceOi).toFixed(2) : "-";

            return {
                strike: r.strike,
                strikeLabel: String(r.strike),
                ceOi,
                peOi,
                ceOiChange,
                peOiChange,
                ceLtp: r.ce?.ltp,
                peLtp: r.pe?.ltp,
                ceChangePct: r.ce?.changePercent,
                peChangePct: r.pe?.changePercent,
                pcr: strikePcr,
                isAtm,
            };
        });
    }, [displayRows, effectiveAtmStrike]);

    // Key Insights: Highest Call OI (Resistance), Highest Put OI (Support)
    const insights = useMemo(() => {
        if (!chartData.length) return null;

        let maxCe = chartData[0];
        let maxPe = chartData[0];

        for (const row of chartData) {
            if (row.ceOi > maxCe.ceOi) maxCe = row;
            if (row.peOi > maxPe.peOi) maxPe = row;
        }

        return {
            resistanceStrike: maxCe.strike,
            resistanceOi: maxCe.ceOi,
            supportStrike: maxPe.strike,
            supportOi: maxPe.peOi,
        };
    }, [chartData]);

    const spot = data?.spotPrice;
    const maxPain = data?.maxPainStrike;

    // Custom Tooltip
    function CustomTooltip({ active, payload, label }) {
        if (!active || !payload || !payload.length) return null;
        const row = payload[0]?.payload;
        if (!row) return null;

        const isCallItm = spot != null ? row.strike < spot : false;
        const isPutItm = spot != null ? row.strike > spot : false;

        return (
            <div className="rounded-xl border border-line bg-surface p-3 shadow-2xl text-xs space-y-2 min-w-[220px]">
                <div className="flex items-center justify-between border-b border-line pb-1.5 font-mono tabular-nums">
                    <span className="font-bold text-fg text-sm">Strike: {fmtStrike(row.strike)}</span>
                    {row.isAtm && (
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-micro font-bold text-amber-600 dark:text-amber-400">
                            ATM
                        </span>
                    )}
                </div>

                <div className="space-y-1 font-mono tabular-nums">
                    {/* Call Details */}
                    <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                        <span className="font-semibold">Call (CE):</span>
                        <span className="font-bold">
                            {metricMode === "totalOi" ? fmtQty(row.ceOi) : fmtQty(row.ceOiChange)}
                            {row.ceLtp != null && (
                                <span className="ml-1 text-fg-muted font-normal">(@ {fmtPrice(row.ceLtp)})</span>
                            )}
                        </span>
                    </div>

                    {/* Put Details */}
                    <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                        <span className="font-semibold">Put (PE):</span>
                        <span className="font-bold">
                            {metricMode === "totalOi" ? fmtQty(row.peOi) : fmtQty(row.peOiChange)}
                            {row.peLtp != null && (
                                <span className="ml-1 text-fg-muted font-normal">(@ {fmtPrice(row.peLtp)})</span>
                            )}
                        </span>
                    </div>

                    {/* PCR */}
                    <div className="flex items-center justify-between text-fg-muted pt-1 border-t border-line">
                        <span>Strike PCR:</span>
                        <span className="font-bold text-fg">{row.pcr}</span>
                    </div>
                </div>

                {!isCrypto && onOpenChart && (
                    <div className="pt-1.5 border-t border-line text-micro text-center text-fg-subtle">
                        💡 Click bar to view candlestick chart
                    </div>
                )}
            </div>
        );
    }

    if (!chartData.length) {
        return (
            <div className="rounded-2xl border border-line bg-surface p-12 text-center text-xs font-semibold text-fg-subtle">
                No open interest data available for this expiry.
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-line bg-surface p-2.5 sm:p-3.5 shadow-xs space-y-2.5">
            {/* 1. Header Toolbar: Mode selector & Key Market Anchors */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <div className="flex items-center gap-2">
                    <div className="flex items-center rounded-xl border border-line bg-surface-raised p-0.5">
                        <button
                            onClick={() => setMetricMode("totalOi")}
                            className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                                metricMode === "totalOi"
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                        >
                            Total Open Interest (OI)
                        </button>
                        <button
                            onClick={() => setMetricMode("oiChange")}
                            className={`rounded-lg px-3 py-1 text-xs font-bold transition-all ${
                                metricMode === "oiChange"
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                        >
                            Change in OI (Chg OI)
                        </button>
                    </div>

                    <span className="text-micro text-fg-subtle hidden sm:inline">
                        {metricMode === "totalOi"
                            ? "Cumulative contracts open across strikes"
                            : "Fresh writing vs unwinding in current session"}
                    </span>
                </div>

                {/* Legend badges */}
                <div className="flex items-center gap-3 text-xs font-semibold">
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                        <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
                        <span>Calls (CE)</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                        <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
                        <span>Puts (PE)</span>
                    </span>
                    {spot != null && (
                        <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 hidden sm:flex">
                            <span className="h-0.5 w-3 bg-amber-500 border border-dashed border-amber-500" />
                            <span>Spot: {fmtPrice(spot)}</span>
                        </span>
                    )}
                </div>
            </div>

            {/* 2. Key Insights Strip: Resistance, Support, Max Pain */}
            {insights && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-xl border border-line bg-surface-muted p-2.5 space-y-0.5 font-mono tabular-nums">
                        <div className="text-micro font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                            Major Resistance
                        </div>
                        <div className="text-sm font-bold text-fg">
                            {fmtStrike(insights.resistanceStrike)} CE
                        </div>
                        <div className="text-micro text-fg-subtle">
                            Max Call OI: {fmtQty(insights.resistanceOi)}
                        </div>
                    </div>

                    <div className="rounded-xl border border-line bg-surface-muted p-2.5 space-y-0.5 font-mono tabular-nums">
                        <div className="text-micro font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Major Support
                        </div>
                        <div className="text-sm font-bold text-fg">
                            {fmtStrike(insights.supportStrike)} PE
                        </div>
                        <div className="text-micro text-fg-subtle">
                            Max Put OI: {fmtQty(insights.supportOi)}
                        </div>
                    </div>

                    {maxPain != null && (
                        <div className="rounded-xl border border-line bg-surface-muted p-2.5 space-y-0.5 font-mono tabular-nums">
                            <div className="text-micro font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                Max Pain Strike
                            </div>
                            <div className="text-sm font-bold text-fg">
                                {fmtStrike(maxPain)}
                            </div>
                            <div className="text-micro text-fg-subtle">
                                Equilibrium settlement point
                            </div>
                        </div>
                    )}

                    {data?.pcr != null && (
                        <div className="rounded-xl border border-line bg-surface-muted p-2.5 space-y-0.5 font-mono tabular-nums">
                            <div className="text-micro font-bold uppercase tracking-wider text-fg-subtle">
                                Overall PCR (OI)
                            </div>
                            <div className={`text-sm font-bold ${data.pcr >= 1 ? "text-up" : "text-down"}`}>
                                {data.pcr}
                            </div>
                            <div className="text-micro text-fg-subtle">
                                {data.pcr >= 1.2 ? "Bullish trend bias" : data.pcr <= 0.8 ? "Bearish trend bias" : "Neutral range"}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 3. Recharts Responsive Bar Chart */}
            <div className="w-full h-[660px] sm:h-[740px] lg:h-[calc(100vh-170px)] min-h-[620px] pt-1">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                        data={chartData}
                        margin={{ top: 20, right: 10, left: 10, bottom: 25 }}
                        barGap={2}
                        onClick={(state) => {
                            if (state && state.activePayload && state.activePayload.length && onOpenChart && !isCrypto) {
                                const row = state.activePayload[0].payload;
                                // If clicked closer to Call or Put, or default to CE
                                onOpenChart(row.strike, "CE");
                            }
                        }}
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
                        <XAxis
                            dataKey="strikeLabel"
                            stroke="#888888"
                            fontSize={11}
                            tickLine={false}
                            axisLine={{ stroke: "#e5e7eb", opacity: 0.3 }}
                            interval={chartData.length > 30 ? 2 : 0}
                            angle={-45}
                            textAnchor="end"
                            height={45}
                        />
                        <YAxis
                            stroke="#888888"
                            fontSize={11}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => fmtQty(v)}
                        />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                            verticalAlign="top"
                            align="right"
                            height={30}
                            iconType="circle"
                            formatter={(value) => (
                                <span className="text-xs font-semibold text-fg">
                                    {value === "ceOi" || value === "ceOiChange" ? "Call (CE)" : "Put (PE)"}
                                </span>
                            )}
                        />

                        {/* Dashed Reference Line for Spot */}
                        {spot != null && (
                            <ReferenceLine
                                x={String(effectiveAtmStrike)}
                                stroke="#f59e0b"
                                strokeDasharray="4 4"
                                strokeWidth={2}
                                label={{
                                    value: `Spot ${fmtPrice(spot)}`,
                                    position: "top",
                                    fill: "#f59e0b",
                                    fontSize: 10,
                                    fontWeight: "bold",
                                }}
                            />
                        )}

                        {/* Dashed Reference Line for Max Pain */}
                        {maxPain != null && maxPain !== effectiveAtmStrike && (
                            <ReferenceLine
                                x={String(maxPain)}
                                stroke="#8b5cf6"
                                strokeDasharray="3 3"
                                strokeWidth={1.5}
                                label={{
                                    value: `Max Pain`,
                                    position: "top",
                                    fill: "#8b5cf6",
                                    fontSize: 10,
                                    fontWeight: "bold",
                                }}
                            />
                        )}

                        {/* Call OI Bar */}
                        <Bar
                            dataKey={metricMode === "totalOi" ? "ceOi" : "ceOiChange"}
                            name={metricMode === "totalOi" ? "ceOi" : "ceOiChange"}
                            fill="#10b981"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                        />

                        {/* Put OI Bar */}
                        <Bar
                            dataKey={metricMode === "totalOi" ? "peOi" : "peOiChange"}
                            name={metricMode === "totalOi" ? "peOi" : "peOiChange"}
                            fill="#f43f5e"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                        />
                    </BarChart>
                </ResponsiveContainer>
            </div>

            {/* 4. Chart Footer Navigation Tip */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-micro text-fg-subtle pt-2 border-t border-line">
                <span>
                    💡 Tip: Click on any strike bar to slide up the live candlestick chart drawer for that contract.
                </span>
                <span className="font-semibold text-fg-muted">
                    {chartData.length} Strikes visualized around Spot
                </span>
            </div>
        </div>
    );
}
