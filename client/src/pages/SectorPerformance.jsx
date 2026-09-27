// pages/SectorPerformance.jsx
// Sector-wise performance board with Live Upstox Real-Time Index Quotes & historical base
import { useEffect, useMemo, useState } from "react";
import { FiArrowUp, FiArrowDown, FiRefreshCw, FiTrendingUp } from "react-icons/fi";
import { buildSectorPerformance, TIMEFRAMES } from "../utils/sectorPerformanceData";
import { fetchSectorIndices } from "../services/equityApi";
import { formatPercent } from "../utils/format";

const BASE_ROWS = buildSectorPerformance();

function toneClass(v) {
    if (v > 0) return "text-emerald-600 dark:text-emerald-400";
    if (v < 0) return "text-rose-600 dark:text-rose-400";
    return "text-gray-400";
}

export default function SectorPerformance() {
    const [tf, setTf] = useState("1D");
    const [sortKey, setSortKey] = useState("1D");
    const [sortDir, setSortDir] = useState("desc");
    const [liveSectors, setLiveSectors] = useState([]);
    const [loading, setLoading] = useState(false);

    function loadLiveSectors() {
        setLoading(true);
        fetchSectorIndices()
            .then((res) => {
                if (res.sectors?.length) setLiveSectors(res.sectors);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadLiveSectors();
    }, []);

    // Merge live 1D change from Upstox when available
    const rows = useMemo(() => {
        const liveMap = new Map(
            liveSectors.map((s) => [s.label.toUpperCase().replace(/\s+/g, ""), s.pChange])
        );

        return BASE_ROWS.map((r) => {
            const keyNorm = r.label.toUpperCase().replace(/\s+/g, "");
            const live1D = liveMap.get(keyNorm);
            if (live1D != null) {
                return {
                    ...r,
                    returns: {
                        ...r.returns,
                        "1D": live1D,
                    },
                    isLive: true,
                };
            }
            return r;
        });
    }, [liveSectors]);

    function selectTimeframe(next) {
        setTf(next);
        setSortKey(next);
        setSortDir("desc");
    }

    function toggleSort(key) {
        if (sortKey === key) {
            setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        } else {
            setSortKey(key);
            setSortDir(key === "name" ? "asc" : "desc");
        }
    }

    const sortedRows = useMemo(() => {
        const list = [...rows];
        list.sort((a, b) => {
            let cmp;
            if (sortKey === "name") cmp = a.label.localeCompare(b.label);
            else cmp = a.returns[sortKey] - b.returns[sortKey];
            return sortDir === "asc" ? cmp : -cmp;
        });
        return list;
    }, [rows, sortKey, sortDir]);

    // Bar chart is always ordered by the selected timeframe, best → worst.
    const barRows = useMemo(() => {
        return [...rows].sort((a, b) => b.returns[tf] - a.returns[tf]);
    }, [rows, tf]);

    const maxAbs = useMemo(
        () => Math.max(...rows.map((r) => Math.abs(r.returns[tf]))) || 1,
        [rows, tf]
    );

    const advancing = rows.filter((r) => r.returns[tf] > 0).length;
    const declining = rows.filter((r) => r.returns[tf] < 0).length;
    const best = barRows[0];
    const worst = barRows[barRows.length - 1];

    function sortIcon(key) {
        if (sortKey !== key) return null;
        return sortDir === "desc" ? <FiArrowDown size={11} /> : <FiArrowUp size={11} />;
    }

    return (
        <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6">
            {/* Header */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
                            Sector Performance
                        </h1>
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400">
                            Live Quotes Active
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                        Sector-wise index returns across timeframes with Upstox live feed integration.
                    </p>
                </div>

                <button
                    onClick={loadLiveSectors}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50 active:scale-95 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                    <FiRefreshCw size={13} className={loading ? "animate-spin text-emerald-600" : ""} />
                    <span>Refresh</span>
                </button>
            </div>

            {/* Timeframe selector */}
            <div className="mb-4 flex flex-wrap gap-1.5">
                {TIMEFRAMES.map((t) => (
                    <button
                        key={t}
                        onClick={() => selectTimeframe(t)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            tf === t
                                ? "bg-emerald-600 text-white shadow-xs"
                                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                        }`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {/* Summary */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Advancing ({tf})</div>
                    <div className="mt-0.5 text-lg font-bold text-emerald-600 dark:text-emerald-400">{advancing}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Declining ({tf})</div>
                    <div className="mt-0.5 text-lg font-bold text-rose-600 dark:text-rose-400">{declining}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Top Gainer ({tf})</div>
                    <div className="mt-0.5 truncate text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {best ? `${best.label} (${formatPercent(best.returns[tf])})` : "-"}
                    </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                    <div className="text-xs text-gray-500 dark:text-gray-400">Top Drag ({tf})</div>
                    <div className="mt-0.5 truncate text-sm font-bold text-rose-600 dark:text-rose-400">
                        {worst ? `${worst.label} (${formatPercent(worst.returns[tf])})` : "-"}
                    </div>
                </div>
            </div>

            {/* Main content: Table + Bar Chart */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                {/* Full sortable table */}
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-900 lg:col-span-7">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="border-b border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-300">
                                <tr>
                                    <th className="px-4 py-2.5 font-semibold">
                                        <button
                                            onClick={() => toggleSort("name")}
                                            className="inline-flex items-center gap-1 font-semibold hover:text-gray-900 dark:hover:text-white"
                                        >
                                            Sector {sortIcon("name")}
                                        </button>
                                    </th>
                                    {TIMEFRAMES.map((t) => (
                                        <th key={t} className="px-3 py-2.5 text-right font-semibold">
                                            <button
                                                onClick={() => toggleSort(t)}
                                                className={`inline-flex items-center gap-1 font-semibold hover:text-gray-900 dark:hover:text-white ${
                                                    tf === t ? "text-emerald-600 dark:text-emerald-400 font-bold" : ""
                                                }`}
                                            >
                                                {t} {sortIcon(t)}
                                            </button>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                                {sortedRows.map((r) => (
                                    <tr key={r.key} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                                        <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">
                                            {r.label}
                                        </td>
                                        {TIMEFRAMES.map((t) => (
                                            <td
                                                key={t}
                                                className={`px-3 py-2.5 text-right font-semibold tabular-nums font-mono ${toneClass(
                                                    r.returns[t]
                                                )} ${
                                                    tf === t
                                                        ? "bg-emerald-50/40 dark:bg-emerald-950/20 font-bold"
                                                        : ""
                                                }`}
                                            >
                                                {formatPercent(r.returns[t])}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Diverging bar chart for the selected window */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs dark:border-gray-800 dark:bg-gray-900 lg:col-span-5">
                    <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">Returns — {tf}</h2>
                    <div className="space-y-1.5">
                        {barRows.map((r) => {
                            const v = r.returns[tf];
                            const w = (Math.abs(v) / maxAbs) * 50;
                            return (
                                <div key={r.key} className="flex items-center gap-2 text-xs">
                                    <span
                                        className="w-24 shrink-0 truncate text-right text-gray-600 dark:text-gray-300 sm:w-28"
                                        title={r.label}
                                    >
                                        {r.label}
                                    </span>
                                    <div className="relative h-4 flex-1 rounded-xs bg-gray-50 dark:bg-gray-800/40">
                                        <span className="absolute left-1/2 top-0 h-full w-px bg-gray-200 dark:bg-gray-700" />
                                        <span
                                            className={`absolute top-0 h-full rounded-xs ${
                                                v >= 0 ? "bg-emerald-500" : "bg-rose-500"
                                            }`}
                                            style={
                                                v >= 0
                                                    ? { left: "50%", width: `${w}%` }
                                                    : { right: "50%", width: `${w}%` }
                                            }
                                        />
                                    </div>
                                    <span
                                        className={`w-14 shrink-0 text-right font-semibold tabular-nums font-mono ${toneClass(
                                            v
                                        )}`}
                                    >
                                        {formatPercent(v)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
