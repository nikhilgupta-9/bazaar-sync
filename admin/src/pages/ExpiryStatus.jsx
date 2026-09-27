// pages/ExpiryStatus.jsx — per symbol: does the data cover its current/
// upcoming expiry, and how fresh is the latest row? Red flag when either is
// missing (see server/services/dataCoverageService.js's getExpiryStatus for
// the exact rule — a >5-day-old last row, or no expiry >= today at all).
import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiSearch, FiRefreshCw } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchExpiryStatus, refreshCoverageCache } from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";

export default function ExpiryStatus() {
    const { token } = useAdminAuth();
    const [dataType, setDataType] = useState("option_chain");
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState("");
    const [onlyFlags, setOnlyFlags] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(() => {
        fetchExpiryStatus(token, dataType).then((r) => setRows(r.symbols)).catch((err) => setError(err.message));
    }, [token, dataType]);

    useEffect(load, [load]);

    async function handleRefresh() {
        setRefreshing(true);
        try { await refreshCoverageCache(token); load(); } finally { setRefreshing(false); }
    }

    const filtered = (rows || [])
        .filter((r) => !search || r.symbol.includes(search.toUpperCase()))
        .filter((r) => !onlyFlags || r.redFlag)
        .sort((a, b) => (b.isIndex - a.isIndex) || (b.redFlag - a.redFlag) || a.symbol.localeCompare(b.symbol));

    return (
        <div>
            <DataNavHeader
                title="Expiry Status & Contract Timeliness"
                subtitle="Verification of upcoming contract expiries, last recorded snapshot freshness, and cross-checks with Bhavcopy."
            />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4">
                {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium">{error}</div>}

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <select value={dataType} onChange={(e) => { setDataType(e.target.value); setRows(null); }} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                        <option value="option_chain">Option Chain</option>
                        <option value="futures">Futures</option>
                    </select>
                    <div className="relative flex-1 max-w-md">
                        <FiSearch className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol…" className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs sm:text-sm text-white outline-none focus:border-violet-500 placeholder-gray-500" />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} className="rounded border-white/20 bg-white/5 text-violet-600 focus:ring-0" />
                        <span>Only show red flags</span>
                    </label>
                    <button onClick={handleRefresh} disabled={refreshing} className="sm:ml-auto inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 disabled:opacity-50 transition">
                        <FiRefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
                    </button>
                </div>

                <Card bodyClassName="p-0 overflow-x-auto custom-scrollbar">
                    {!rows ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : (
                        <table className="w-full text-left text-xs sm:text-sm whitespace-nowrap">
                            <thead className="bg-white/5 text-xs text-gray-500">
                                <tr>
                                    <th className="px-4 py-2.5 font-medium">Symbol</th>
                                    <th className="px-4 py-2.5 font-medium">Last data date</th>
                                    <th className="px-4 py-2.5 font-medium">Nearest expiry in data</th>
                                    <th className="px-4 py-2.5 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => (
                                    <tr key={r.symbol} className={`border-t border-white/5 ${r.redFlag ? "bg-rose-500/5" : ""}`}>
                                        <td className={`px-4 py-2 ${r.isIndex ? "font-semibold text-gray-100" : "text-gray-300"}`}>{r.symbol}</td>
                                        <td className="px-4 py-2 text-gray-400">{r.lastDataDate || "—"}</td>
                                        <td className="px-4 py-2 text-gray-400">{r.nearestExpiry || "—"}</td>
                                        <td className="px-4 py-2">
                                            {r.redFlag ? (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-300">
                                                    <FiAlertTriangle className="h-3.5 w-3.5" /> {r.reason}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                                                    <FiCheckCircle className="h-3.5 w-3.5" /> current
                                                </span>
                                            )}
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
