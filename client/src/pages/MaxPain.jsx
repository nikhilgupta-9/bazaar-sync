import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell } from "recharts";
import { useOptionChain } from "../hooks/useOptionChain";
import SettingsSidebar from "../components/SettingsSidebar";
import { computePayoutCurve } from "../utils/maxPain";
import { formatOi, formatPrice } from "../utils/format";

export default function MaxPain() {
    const { symbol, setSymbol, data, loading, error, load } = useOptionChain();
    const [strikeRange, setStrikeRange] = useState(10);

    const chartRows = useMemo(() => {
        if (!data) return [];
        const rows = strikeRange
            ? data.rows.filter((r) => Math.abs(r.strike - data.atmStrike) <= strikeRange * (data.rows[1]?.strike - data.rows[0]?.strike || 50))
            : data.rows;
        return computePayoutCurve(rows);
    }, [data, strikeRange]);

    function handleSymbolChange(sym) {
        setSymbol(sym);
    }

    return (
        <div className="mx-auto flex max-w-[1400px] gap-4 px-4 py-4">
            <SettingsSidebar
                symbol={symbol}
                onSymbolChange={handleSymbolChange}
                expiries={data?.expiries}
                selectedExpiry={data?.selectedExpiry}
                onExpiryChange={(exp) => load(symbol, exp)}
                strikeRange={strikeRange}
                onStrikeRangeChange={setStrikeRange}
            />

            <div className="flex-1">
                <div className="mb-3 rounded-lg border border-gray-200 bg-white px-5 py-4">
                    <h1 className="flex items-center gap-2 text-base font-semibold text-gray-900">
                        🔥 Max Pain
                    </h1>
                    {data && (
                        <div className="mt-2 flex gap-8 text-sm">
                            <div>
                                <div className="text-gray-500">Max Pain Strike</div>
                                <div className="text-lg font-bold text-orange-600 tabular-nums">{data.maxPainStrike}</div>
                            </div>
                            <div>
                                <div className="text-gray-500">Spot Price</div>
                                <div className="text-lg font-semibold tabular-nums">{formatPrice(data.spotPrice)}</div>
                            </div>
                            <div>
                                <div className="text-gray-500">Distance</div>
                                <div className="text-lg font-semibold tabular-nums">
                                    {(data.maxPainStrike - data.spotPrice).toFixed(2)}
                                </div>
                            </div>
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
                        <p className="mb-3 text-xs text-gray-500">
                            Total intrinsic-value payout to option holders if the underlying settles at each strike.
                            The strike with the <span className="font-semibold text-orange-600">lowest</span> payout
                            is Max Pain — where option writers lose the least.
                        </p>
                        <ResponsiveContainer width="100%" height={360}>
                            <BarChart data={chartRows}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="strike" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatOi(v)} width={70} />
                                <Tooltip formatter={(v) => formatOi(v)} labelFormatter={(l) => `Strike ${l}`} />
                                <ReferenceLine x={data.spotPrice} stroke="#2563eb" strokeDasharray="4 4" label={{ value: "Spot", fontSize: 10, fill: "#2563eb" }} />
                                <Bar dataKey="payout" radius={[3, 3, 0, 0]}>
                                    {chartRows.map((r) => (
                                        <Cell key={r.strike} fill={r.strike === data.maxPainStrike ? "#ea580c" : "#93c5fd"} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
