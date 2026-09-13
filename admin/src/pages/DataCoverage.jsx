// pages/DataCoverage.jsx — per-symbol, per-month "how much data do we
// actually have vs. how much should exist" for the 2023-onward target
// window. Two levels: a summary table (every symbol, overall stats) and a
// month-by-month grid for whichever symbol is selected — "expected days"
// per month is derived from the data itself (the best-covered symbol that
// month), not a hardcoded holiday calendar; see
// server/services/dataCoverageService.js's header for why.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiRefreshCw, FiSearch } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchCoverageSummary, fetchCoverageDetail, refreshCoverageCache } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const SEVEN_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];

function pctColor(pct) {
    if (pct == null) return "bg-white/5 text-gray-600";
    if (pct >= 90) return "bg-emerald-500/20 text-emerald-300";
    if (pct >= 50) return "bg-amber-500/20 text-amber-300";
    if (pct > 0) return "bg-rose-500/20 text-rose-300";
    return "bg-white/5 text-gray-600";
}

export default function DataCoverage() {
    const { token } = useAdminAuth();
    const [dataType, setDataType] = useState("option_chain");
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(() => {
        fetchCoverageSummary(token, dataType).then((r) => setSummary(r)).catch((err) => setError(err.message));
    }, [token, dataType]);

    useEffect(load, [load]);

    const rows = useMemo(() => {
        if (!summary) return [];
        // VIX is a single series (INDIAVIX), not "7 indices + stocks" — the
        // pinning below doesn't apply, just show whatever summary.symbols
        // has (0 or 1 row).
        if (dataType === "vix") return summary.symbols;
        const bySymbol = new Map(summary.symbols.map((s) => [s.symbol, s]));
        // 7 indices pinned first (even if missing entirely — shows as a blank row), then the rest matching the search.
        const indices = SEVEN_INDICES.map((sym) => bySymbol.get(sym) || { symbol: sym, firstDate: null, lastDate: null, totalRows: 0, totalDays: 0, monthsWithData: 0 });
        const stocks = summary.symbols
            .filter((s) => !SEVEN_INDICES.includes(s.symbol))
            .filter((s) => !search || s.symbol.includes(search.toUpperCase()));
        return [...indices, ...stocks];
    }, [summary, search, dataType]);

    function selectSymbol(symbol) {
        setSelected(symbol);
        setDetail(null);
        fetchCoverageDetail(token, dataType, symbol).then((r) => setDetail(r.months)).catch((err) => setError(err.message));
    }

    async function handleRefresh() {
        setRefreshing(true);
        try {
            await refreshCoverageCache(token);
            load();
            if (selected) selectSymbol(selected);
        } finally {
            setRefreshing(false);
        }
    }

    return (
        <div>
            <TopBar title="Data Coverage" subtitle={`How much ${dataType === "futures" ? "futures" : dataType === "vix" ? "India VIX" : "option-chain"} data exists${dataType === "vix" ? "" : " per symbol"} per month, ${summary?.coverageStart || "2023-01-01"} onward. "Expected" is the best-covered symbol that month, not a hardcoded holiday list.`} />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <select value={dataType} onChange={(e) => { setDataType(e.target.value); setSelected(null); setDetail(null); setSummary(null); }} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                        <option value="option_chain">Option Chain</option>
                        <option value="futures">Futures</option>
                        <option value="vix">India VIX</option>
                    </select>
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                        <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock symbol…" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-violet-500" />
                    </div>
                    <button onClick={handleRefresh} disabled={refreshing} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50">
                        <FiRefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh (cached ~20 min)
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                    <Card title={`Symbols${summary ? ` (${rows.length})` : ""}`} className="lg:col-span-2" bodyClassName="max-h-[70vh] overflow-y-auto p-0">
                        {!summary ? (
                            <div className="py-10 text-center text-xs text-gray-500">Loading (first load can take up to a minute — full-history scan)…</div>
                        ) : (
                            <table className="w-full text-left text-xs">
                                <thead className="sticky top-0 bg-[#101015] text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">Symbol</th>
                                        <th className="px-3 py-2 font-medium">Days</th>
                                        <th className="px-3 py-2 font-medium">Months</th>
                                        <th className="px-3 py-2 font-medium">Last date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r) => (
                                        <tr
                                            key={r.symbol}
                                            onClick={() => selectSymbol(r.symbol)}
                                            className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${selected === r.symbol ? "bg-violet-600/10" : ""} ${SEVEN_INDICES.includes(r.symbol) ? "font-semibold text-gray-200" : "text-gray-300"}`}
                                        >
                                            <td className="px-3 py-2">{r.symbol}</td>
                                            <td className="px-3 py-2">{r.totalDays || "—"}</td>
                                            <td className="px-3 py-2">{r.monthsWithData || "—"}</td>
                                            <td className="px-3 py-2 text-gray-500">{r.lastDate || "no data"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Card>

                    <Card title={selected ? `${selected} — month by month` : "Select a symbol"} className="lg:col-span-3">
                        {!selected ? (
                            <div className="py-10 text-center text-xs text-gray-500">Click a symbol on the left to see its monthly coverage.</div>
                        ) : !detail ? (
                            <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                                {detail.map((m) => (
                                    <div key={m.month} className={`rounded-lg px-2 py-2 text-center ${pctColor(m.coveragePct)}`} title={`${m.days} of ${m.expectedDays ?? "?"} expected days, ${m.rows.toLocaleString()} rows`}>
                                        <div className="text-[10px] font-medium opacity-80">{m.month}</div>
                                        <div className="text-sm font-bold">{m.days}{m.expectedDays != null ? `/${m.expectedDays}` : ""}</div>
                                        {m.missingDays > 0 && <div className="text-[10px] opacity-80">−{m.missingDays}</div>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}
