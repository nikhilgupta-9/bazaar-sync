import { useMemo } from "react";
import { useOptionChain } from "../hooks/useOptionChain";
import { formatPrice, formatPercent } from "../utils/format";
import BuildupBadge from "../components/BuildupBadge";
import OiBar from "../components/OiBar";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

function oiChangePercent(oi, oiChange) {
    if (oi == null || oiChange == null) return null;
    const prevOi = oi - oiChange;
    if (!prevOi) return null;
    return (oiChange / prevOi) * 100;
}

export default function OptionChain() {
    const { symbol, setSymbol, data, loading, error, load } = useOptionChain();

    const maxCeOi = useMemo(() => (data ? Math.max(...data.rows.map((r) => r.ce.oi ?? 0)) : 0), [data]);
    const maxPeOi = useMemo(() => (data ? Math.max(...data.rows.map((r) => r.pe.oi ?? 0)) : 0), [data]);

    return (
        <div className="mx-auto max-w-[1400px] px-4 py-4">
            {/* Control bar */}
            <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
                <div className="flex items-center gap-1">
                    {SYMBOLS.map((s) => (
                        <button
                            key={s}
                            onClick={() => setSymbol(s)}
                            className={`rounded-md px-3 py-1 text-sm font-semibold ${
                                symbol === s ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
                            }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>

                {data && (
                    <>
                        <div className="h-5 w-px bg-gray-200" />
                        <div className="text-sm">
                            <span className="text-gray-500">Spot </span>
                            <span className="font-semibold tabular-nums">{formatPrice(data.spotPrice)}</span>
                        </div>
                        <div className="text-sm">
                            <span className="text-gray-500">PCR </span>
                            <span className="font-semibold tabular-nums">{data.pcr ?? "-"}</span>
                        </div>
                        <div className="text-sm">
                            <span className="text-gray-500">Max Pain </span>
                            <span className="font-semibold tabular-nums">{data.maxPainStrike}</span>
                        </div>

                        <div className="ml-auto">
                            <select
                                value={data.selectedExpiry}
                                onChange={(e) => load(symbol, e.target.value)}
                                className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                            >
                                {data.expiries.map((exp) => (
                                    <option key={exp} value={exp}>{exp}</option>
                                ))}
                            </select>
                        </div>
                    </>
                )}
            </div>

            {error && (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                </div>
            )}

            {loading && !data && (
                <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
                    Loading option chain…
                </div>
            )}

            {data && (
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr>
                                <th colSpan={5} className="border-b border-gray-200 bg-emerald-50 py-1.5 text-emerald-700">Call</th>
                                <th colSpan={2} className="border-b border-gray-200 bg-gray-50" />
                                <th colSpan={5} className="border-b border-gray-200 bg-rose-50 py-1.5 text-rose-700">Put</th>
                            </tr>
                            <tr className="text-gray-500">
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">Buildup</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">Volume</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">OI Chg%</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">OI</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">LTP</th>
                                <th className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 font-semibold text-gray-700">Strike</th>
                                <th className="border-b border-gray-200 bg-gray-50 px-2 py-1.5 font-medium">IV</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">LTP</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">OI</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">OI Chg%</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">Volume</th>
                                <th className="border-b border-gray-200 px-2 py-1.5 font-medium">Buildup</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rows.map((row) => {
                                const isAtm = row.strike === data.atmStrike;
                                const isMaxPain = row.strike === data.maxPainStrike;
                                const ceItm = row.strike < data.spotPrice;
                                const peItm = row.strike > data.spotPrice;
                                const ceChgPct = oiChangePercent(row.ce.oi, row.ce.oiChange);
                                const peChgPct = oiChangePercent(row.pe.oi, row.pe.oiChange);

                                return (
                                    <tr
                                        key={row.strike}
                                        className={isAtm ? "bg-blue-50" : "hover:bg-gray-50"}
                                    >
                                        <td className={`px-2 py-1 text-center ${ceItm ? "bg-amber-50" : ""}`}>
                                            <BuildupBadge code={row.ce.buildup} />
                                        </td>
                                        <td className={`px-2 py-1 text-right tabular-nums ${ceItm ? "bg-amber-50" : ""}`}>
                                            {row.ce.volume?.toLocaleString("en-IN") ?? "-"}
                                        </td>
                                        <td className={`px-2 py-1 text-right tabular-nums ${ceChgPct > 0 ? "text-emerald-600" : "text-rose-600"} ${ceItm ? "bg-amber-50" : ""}`}>
                                            {ceChgPct != null ? formatPercent(ceChgPct) : "-"}
                                        </td>
                                        <td className={`p-0 ${ceItm ? "bg-amber-50" : ""}`}>
                                            <OiBar value={row.ce.oi} max={maxCeOi} side="ce" />
                                        </td>
                                        <td className={`px-2 py-1 text-right font-medium tabular-nums ${ceItm ? "bg-amber-50" : ""}`}>
                                            {formatPrice(row.ce.ltp)}
                                            {row.ce.changePercent != null && (
                                                <span className={`ml-1 text-[10px] ${row.ce.changePercent > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                    {formatPercent(row.ce.changePercent)}
                                                </span>
                                            )}
                                        </td>

                                        <td className="relative bg-gray-50 px-3 py-1 text-center font-semibold tabular-nums">
                                            {row.strike}
                                            {isMaxPain && (
                                                <span className="absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded bg-orange-100 px-1 text-[9px] font-semibold text-orange-700">
                                                    Max Pain
                                                </span>
                                            )}
                                        </td>
                                        <td className="bg-gray-50 px-2 py-1 text-center tabular-nums">{row.iv ?? "-"}</td>

                                        <td className={`px-2 py-1 text-right font-medium tabular-nums ${peItm ? "bg-amber-50" : ""}`}>
                                            {formatPrice(row.pe.ltp)}
                                            {row.pe.changePercent != null && (
                                                <span className={`ml-1 text-[10px] ${row.pe.changePercent > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                    {formatPercent(row.pe.changePercent)}
                                                </span>
                                            )}
                                        </td>
                                        <td className={`p-0 ${peItm ? "bg-amber-50" : ""}`}>
                                            <OiBar value={row.pe.oi} max={maxPeOi} side="pe" />
                                        </td>
                                        <td className={`px-2 py-1 text-right tabular-nums ${peChgPct > 0 ? "text-emerald-600" : "text-rose-600"} ${peItm ? "bg-amber-50" : ""}`}>
                                            {peChgPct != null ? formatPercent(peChgPct) : "-"}
                                        </td>
                                        <td className={`px-2 py-1 text-right tabular-nums ${peItm ? "bg-amber-50" : ""}`}>
                                            {row.pe.volume?.toLocaleString("en-IN") ?? "-"}
                                        </td>
                                        <td className={`px-2 py-1 text-center ${peItm ? "bg-amber-50" : ""}`}>
                                            <BuildupBadge code={row.pe.buildup} />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
