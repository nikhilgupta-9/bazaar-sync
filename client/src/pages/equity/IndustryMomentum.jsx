import React from "react";
// pages/equity/IndustryMomentum.jsx — Industry and Sector Momentum Leaderboard
import { useEffect, useState, useMemo } from "react";
import { fetchIndustryMomentum } from "../../services/equityApi";
import { formatPrice } from "../../utils/format";
import { FiRefreshCw, FiSearch, FiTrendingUp, FiTrendingDown, FiAward } from "react-icons/fi";

export default function IndustryMomentum() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState("");

    function loadData() {
        setLoading(true);
        fetchIndustryMomentum()
            .then((res) => {
                setData(res);
                setError(null);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadData();
    }, []);

    const filteredIndustries = useMemo(() => {
        if (!data?.industries) return [];
        if (!query.trim()) return data.industries;
        return data.industries.filter(
            (ind) =>
                ind.industry.toLowerCase().includes(query.toLowerCase()) ||
                ind.sector.toLowerCase().includes(query.toLowerCase()) ||
                ind.stocks.some((s) => s.symbol.toLowerCase().includes(query.toLowerCase()))
        );
    }, [data, query]);

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
                        Industry Momentum Ranking
                    </h2>
                    <p className="text-xs text-fg-muted sm:text-sm">
                        Industry groups and sub-sectors ranked by average momentum, with their leading constituent.
                    </p>
                </div>

                <button
                    onClick={loadData}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 self-start rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-fg shadow-xs transition hover:bg-surface-hover active:scale-95 disabled:opacity-50 sm:self-auto"
                >
                    <FiRefreshCw size={13} className={loading ? "animate-spin text-emerald-600" : ""} />
                    <span>Refresh</span>
                </button>
            </div>

            {/* Search */}
            <div className="relative">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" size={14} />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by industry name, sector, or constituent stock..."
                    className="w-full rounded-xl border border-line bg-surface py-2.5 pl-9 pr-3 text-xs text-fg placeholder-fg-subtle focus:border-emerald-500 focus:outline-hidden"
                />
            </div>

            {loading && !data && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-40 animate-pulse rounded-xl border border-line bg-surface-muted" />
                    ))}
                </div>
            )}

            {error && !loading && (
                <div className="rounded-xl border border-line bg-surface p-6 text-center text-xs text-fg-muted">
                    Couldn't load industry momentum data. {error}
                </div>
            )}

            {!loading && !error && filteredIndustries.length === 0 && (
                <div className="rounded-xl border border-line bg-surface p-6 text-center text-xs text-fg-muted">
                    No industries match "{query}".
                </div>
            )}

            {/* Industries Cards Grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredIndustries.map((ind, index) => {
                    const isPos = ind.avgMomentum >= 0;
                    const rank = index + 1;
                    return (
                        <div
                            key={ind.industry}
                            className="group flex flex-col justify-between rounded-xl border border-line bg-surface p-4 shadow-xs transition hover:-translate-y-0.5 hover:border-emerald-500/50 hover:shadow-md"
                        >
                            <div>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        <span
                                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-bold ${
                                                rank <= 3
                                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                                                    : "bg-surface-raised text-fg-muted"
                                            }`}
                                        >
                                            {rank}
                                        </span>
                                        <h3 className="truncate text-sm font-bold text-fg" title={ind.industry}>
                                            {ind.industry}
                                        </h3>
                                    </div>
                                    <span
                                        className={`flex shrink-0 items-center gap-0.5 rounded-md px-2 py-0.5 text-xs font-bold font-mono tabular-nums ${
                                            isPos
                                                ? "bg-emerald-50 text-up dark:bg-emerald-950/60"
                                                : "bg-rose-50 text-down dark:bg-rose-950/40"
                                        }`}
                                    >
                                        {isPos ? <FiTrendingUp size={11} /> : <FiTrendingDown size={11} />}
                                        {isPos ? "+" : ""}{ind.avgMomentum}%
                                    </span>
                                </div>
                                <div className="mt-1 pl-8 text-label text-fg-subtle">{ind.sector}</div>

                                {/* Top Performer Badge */}
                                {ind.topPerformer && (
                                    <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-muted px-2.5 py-2 text-xs">
                                        <span className="flex items-center gap-1 text-label font-medium text-fg-muted">
                                            <FiAward className="text-amber-500" size={13} /> Leader
                                        </span>
                                        <span className="font-bold text-fg">{ind.topPerformer.symbol}</span>
                                        <span
                                            className={`font-semibold font-mono tabular-nums text-label ${
                                                ind.topPerformer.pChange >= 0 ? "text-up" : "text-down"
                                            }`}
                                        >
                                            {ind.topPerformer.pChange >= 0 ? "+" : ""}{ind.topPerformer.pChange}%
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Constituent stock pills */}
                            <div className="mt-3 border-t border-line pt-2.5">
                                <div className="mb-1.5 text-micro font-bold uppercase tracking-wider text-fg-subtle">
                                    Constituents ({ind.stockCount})
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {ind.stocks.map((st) => (
                                        <span
                                            key={st.symbol}
                                            className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-raised px-2 py-0.5 text-label font-medium text-fg"
                                        >
                                            <span>{st.symbol}</span>
                                            <span
                                                className={`text-micro font-mono tabular-nums ${
                                                    st.pChange >= 0 ? "text-up" : "text-down"
                                                }`}
                                            >
                                                {st.pChange >= 0 ? "+" : ""}{st.pChange}%
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
