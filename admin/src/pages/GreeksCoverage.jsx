// pages/GreeksCoverage.jsx — per symbol, what fraction of its last-90-days
// option-chain rows have Greeks (delta/gamma/theta/vega/IV) computed.
// Option-chain only — futures never carry Greeks by design (no strike, no
// IV to solve for), so there's nothing to report there.
import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiSearch, FiRefreshCw } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchGreeksCoverage, refreshCoverageCache } from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";

function barColor(pct) {
    if (pct >= 90) return "bg-emerald-500";
    if (pct >= 50) return "bg-amber-500";
    if (pct > 0) return "bg-rose-500";
    return "bg-white/10";
}

export default function GreeksCoverage() {
    const { token } = useAdminAuth();
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(() => {
        fetchGreeksCoverage(token).then((r) => setRows(r.symbols)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleRefresh() {
        setRefreshing(true);
        try { await refreshCoverageCache(token); load(); } finally { setRefreshing(false); }
    }

    const filtered = (rows || [])
        .filter((r) => !search || r.symbol.includes(search.toUpperCase()))
        .sort((a, b) => a.pct - b.pct);

    return (
        <div>
            <DataNavHeader
                title="Black-Scholes Greeks Health Audit"
                subtitle="Percentage of each symbol's last 90 days of option-chain rows that have delta/gamma/theta/vega/IV computed."
            />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4">
                {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium">{error}</div>}

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="relative flex-1 max-w-md">
                        <FiSearch className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol…" className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs sm:text-sm text-white outline-none focus:border-violet-500 placeholder-gray-500" />
                    </div>
                    <button onClick={handleRefresh} disabled={refreshing} className="sm:ml-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 disabled:opacity-50 transition">
                        <FiRefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
                    </button>
                </div>

                <Card bodyClassName="p-0 overflow-x-auto custom-scrollbar">
                    {!rows ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading (full-table scan, can take a while on first load)…</div>
                    ) : (
                        <table className="w-full text-left text-xs sm:text-sm whitespace-nowrap">
                            <thead className="bg-white/5 text-xs text-gray-500">
                                <tr>
                                    <th className="px-4 py-2.5 font-medium">Symbol</th>
                                    <th className="px-4 py-2.5 font-medium">Rows (90d)</th>
                                    <th className="px-4 py-2.5 font-medium">With Greeks</th>
                                    <th className="w-48 sm:w-64 px-4 py-2.5 font-medium">Coverage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => (
                                    <tr key={r.symbol} className={`border-t border-white/5 ${r.redFlag ? "bg-rose-500/5" : ""}`}>
                                        <td className="px-4 py-2 font-medium text-gray-200">{r.symbol}</td>
                                        <td className="px-4 py-2 text-gray-400">{r.totalRows.toLocaleString()}</td>
                                        <td className="px-4 py-2 text-gray-400">{r.rowsWithGreeks.toLocaleString()}</td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-2 min-w-[140px]">
                                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                                                    <div className={`h-full rounded-full ${barColor(r.pct)}`} style={{ width: `${Math.max(r.pct, r.pct > 0 ? 2 : 0)}%` }} />
                                                </div>
                                                <span className="w-10 shrink-0 text-right text-xs text-gray-400">{r.pct}%</span>
                                                {r.redFlag && <FiAlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" title="no Greeks at all in the last 90 days" />}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Card>
            </div>
        </div>
    );
}
