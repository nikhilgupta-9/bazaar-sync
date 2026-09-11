// pages/SectorPerformance.jsx
//
// Sector-wise performance board — each NSE sector's return across 1D / 1W /
// 1M / 3M / 6M / 1Y / YTD windows, as a sortable table plus a diverging bar
// chart for the selected window.
//
// IMPORTANT: renders utils/sectorPerformanceData.js's DEMO dataset, not real
// sector-index prices — see that file's header (no sector-index history
// exists anywhere in this codebase yet; same gap SectorRotation.jsx has).
// The "Demo data — not live" badge must stay visible; don't wire this to a
// fake "live" timestamp or drop the badge without a real data source.
//
// Themed with plain Tailwind semantic classes (bg-white / text-gray-900 /
// emerald / rose) so it follows the app-wide light/dark toggle
// (ThemeContext.jsx) for free, and it's mobile-responsive (summary grid
// collapses, the wide table scrolls in its own container).
import { useMemo, useState } from "react";
import { FiArrowUp, FiArrowDown } from "react-icons/fi";
import { buildSectorPerformance, TIMEFRAMES } from "../utils/sectorPerformanceData";
import { formatPercent } from "../utils/format";

const ROWS = buildSectorPerformance();

function toneClass(v) {
    if (v > 0) return "text-emerald-600";
    if (v < 0) return "text-rose-600";
    return "text-gray-400";
}

export default function SectorPerformance() {
    const [tf, setTf] = useState("1D");
    const [sortKey, setSortKey] = useState("1D"); // a timeframe, or "name"
    const [sortDir, setSortDir] = useState("desc");

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
        const rows = [...ROWS];
        rows.sort((a, b) => {
            let cmp;
            if (sortKey === "name") cmp = a.label.localeCompare(b.label);
            else cmp = a.returns[sortKey] - b.returns[sortKey];
            return sortDir === "asc" ? cmp : -cmp;
        });
        return rows;
    }, [sortKey, sortDir]);

    // Bar chart is always ordered by the selected timeframe, best → worst.
    const barRows = useMemo(() => {
        return [...ROWS].sort((a, b) => b.returns[tf] - a.returns[tf]);
    }, [tf]);
    const maxAbs = useMemo(
        () => Math.max(...ROWS.map((r) => Math.abs(r.returns[tf]))) || 1,
        [tf]
    );

    const advancing = ROWS.filter((r) => r.returns[tf] > 0).length;
    const declining = ROWS.filter((r) => r.returns[tf] < 0).length;
    const best = barRows[0];
    const worst = barRows[barRows.length - 1];

    function sortIcon(key) {
        if (sortKey !== key) return null;
        return sortDir === "desc" ? <FiArrowDown size={11} /> : <FiArrowUp size={11} />;
    }

    return (
        <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 sm:py-6">
            {/* Header */}
            <div className="mb-1 flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-bold text-gray-900 sm:text-xl">Sector Performance</h1>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                    Demo data — not live
                </span>
            </div>
            <p className="mb-4 text-sm text-gray-500">
                Sector-wise returns across timeframes. Pick a window to sort and chart by it.
            </p>

            {/* Timeframe selector */}
            <div className="mb-4 flex flex-wrap gap-1.5">
                {TIMEFRAMES.map((t) => (
                    <button
                        key={t}
                        onClick={() => selectTimeframe(t)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                            tf === t
                                ? "bg-blue-600 text-white shadow-sm"
                                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
                        }`}
                    >
                        {t}
                    </button>
                ))}
            </div>

            {/* Summary */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Advancing ({tf})</div>
                    <div className="mt-0.5 text-lg font-bold text-emerald-600">{advancing}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Declining ({tf})</div>
                    <div className="mt-0.5 text-lg font-bold text-rose-600">{declining}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Top gainer</div>
                    <div className="mt-0.5 truncate text-sm font-bold text-gray-900">{best.label}</div>
                    <div className="text-xs font-semibold text-emerald-600">{formatPercent(best.returns[tf])}</div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white p-3">
                    <div className="text-xs text-gray-500">Top loser</div>
                    <div className="mt-0.5 truncate text-sm font-bold text-gray-900">{worst.label}</div>
                    <div className="text-xs font-semibold text-rose-600">{formatPercent(worst.returns[tf])}</div>
                </div>
            </div>

            <div className="space-y-4">
                {/* Sortable table */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="mb-3 text-sm font-bold text-gray-900">All timeframes</h2>
                    <div className="-mx-4 overflow-x-auto">
                        <table className="w-full min-w-[560px] text-xs">
                            <thead>
                                <tr className="border-b border-gray-200 text-gray-500">
                                    <th className="px-4 py-2 text-left">
                                        <button
                                            onClick={() => toggleSort("name")}
                                            className="inline-flex items-center gap-1 font-semibold hover:text-gray-800"
                                        >
                                            Sector {sortIcon("name")}
                                        </button>
                                    </th>
                                    {TIMEFRAMES.map((t) => (
                                        <th key={t} className="px-3 py-2 text-right">
                                            <button
                                                onClick={() => toggleSort(t)}
                                                className={`inline-flex items-center gap-1 font-semibold hover:text-gray-800 ${
                                                    tf === t ? "text-blue-600" : ""
                                                }`}
                                            >
                                                {t} {sortIcon(t)}
                                            </button>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRows.map((r) => (
                                    <tr key={r.key} className="border-b border-gray-100 last:border-0">
                                        <td className="px-4 py-2 font-medium text-gray-700">{r.label}</td>
                                        {TIMEFRAMES.map((t) => (
                                            <td
                                                key={t}
                                                className={`px-3 py-2 text-right font-semibold tabular-nums ${toneClass(r.returns[t])} ${
                                                    tf === t ? "bg-blue-50" : ""
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
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h2 className="mb-3 text-sm font-bold text-gray-900">Returns — {tf}</h2>
                    <div className="space-y-1.5">
                        {barRows.map((r) => {
                            const v = r.returns[tf];
                            const w = (Math.abs(v) / maxAbs) * 50; // % of half the track
                            return (
                                <div key={r.key} className="flex items-center gap-2 text-xs">
                                    <span className="w-24 shrink-0 truncate text-right text-gray-600 sm:w-28" title={r.label}>
                                        {r.label}
                                    </span>
                                    <div className="relative h-4 flex-1">
                                        <span className="absolute left-1/2 top-0 h-full w-px bg-gray-200" />
                                        <span
                                            className={`absolute top-0 h-full rounded-sm ${v >= 0 ? "bg-emerald-500" : "bg-rose-500"}`}
                                            style={v >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }}
                                        />
                                    </div>
                                    <span className={`w-14 shrink-0 text-right font-semibold tabular-nums ${toneClass(v)}`}>
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
