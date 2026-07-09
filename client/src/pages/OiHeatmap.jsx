import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { useOptionChain } from "../hooks/useOptionChain";
import SettingsSidebar from "../components/SettingsSidebar";
import { formatOi } from "../utils/format";

export default function OiHeatmap() {
    const { symbol, setSymbol, data, loading, error, load } = useOptionChain();
    const [strikeRange, setStrikeRange] = useState(10);

    const chartRows = useMemo(() => {
        if (!data) return [];
        const strikeGap = data.rows[1]?.strike - data.rows[0]?.strike || 50;
        const rows = strikeRange
            ? data.rows.filter((r) => Math.abs(r.strike - data.atmStrike) <= strikeRange * strikeGap)
            : data.rows;
        return rows.map((r) => ({ strike: r.strike, callOi: r.ce.oi ?? 0, putOi: r.pe.oi ?? 0 }));
    }, [data, strikeRange]);

    const topStrike = useMemo(() => {
        if (!chartRows.length) return null;
        return chartRows.reduce((best, r) => (r.callOi + r.putOi > best.callOi + best.putOi ? r : best), chartRows[0]);
    }, [chartRows]);

    return (
        <div className="mx-auto flex max-w-[1400px] gap-4 px-4 py-4">
            <SettingsSidebar
                symbol={symbol}
                onSymbolChange={setSymbol}
                expiries={data?.expiries}
                selectedExpiry={data?.selectedExpiry}
                onExpiryChange={(exp) => load(symbol, exp)}
                strikeRange={strikeRange}
                onStrikeRangeChange={setStrikeRange}
            />

            <div className="flex-1">
                <div className="mb-3 rounded-lg border border-gray-200 bg-white px-5 py-4">
                    <h1 className="text-base font-semibold text-gray-900">OI Heatmap</h1>
                    <p className="mt-1 text-xs text-gray-500">
                        Call vs Put open interest concentration by strike — taller bars mark where the market has
                        built the most positioning.
                    </p>
                    {topStrike && (
                        <div className="mt-2 text-sm">
                            <span className="text-gray-500">Highest combined OI </span>
                            <span className="text-lg font-bold text-indigo-600 tabular-nums">{topStrike.strike}</span>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                    </div>
                )}

                {loading && !data && (
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
                        Loading…
                    </div>
                )}

                {data && (
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <ResponsiveContainer width="100%" height={400}>
                            <BarChart data={chartRows}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="strike" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatOi(v)} width={70} />
                                <Tooltip formatter={(v) => formatOi(v)} labelFormatter={(l) => `Strike ${l}`} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <ReferenceLine x={data.atmStrike} stroke="#2563eb" strokeDasharray="4 4" label={{ value: "ATM", fontSize: 10, fill: "#2563eb" }} />
                                <Bar dataKey="callOi" name="Call OI" fill="#10b981" radius={[3, 3, 0, 0]} />
                                <Bar dataKey="putOi" name="Put OI" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
