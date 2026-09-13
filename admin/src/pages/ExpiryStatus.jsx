// pages/ExpiryStatus.jsx — per symbol: does the data cover its current/
// upcoming expiry, and how fresh is the latest row? Red flag when either is
// missing (see server/services/dataCoverageService.js's getExpiryStatus for
// the exact rule — a >5-day-old last row, or no expiry >= today at all).
import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiCheckCircle, FiSearch, FiRefreshCw } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchExpiryStatus, refreshCoverageCache } from "../services/adminApi";
import TopBar from "../components/TopBar";
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
            <TopBar title="Expiry Status" subtitle="Does each symbol have data for its current/upcoming expiry, and is the latest row recent? Red = a real gap worth investigating." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <select value={dataType} onChange={(e) => { setDataType(e.target.value); setRows(null); }} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                        <option value="option_chain">Option Chain</option>
                        <option value="futures">Futures</option>
                    </select>
                    <div className="relative min-w-[180px] max-w-xs flex-1">
                        <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol…" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-violet-500" />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} className="rounded border-white/20 bg-white/5" />
                        Only show red flags
                    </label>
                    <button onClick={handleRefresh} disabled={refreshing} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50">
                        <FiRefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
                    </button>
                </div>

                <Card bodyClassName="p-0">
                    {!rows ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : (
                        <table className="w-full text-left text-sm">
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
