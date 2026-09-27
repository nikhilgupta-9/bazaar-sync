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
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
                        Industry Momentum Ranking
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                        Discover which industry groups and sub-sectors are seeing institutional capital inflows.
                    </p>
                </div>

                <button
                    onClick={loadData}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50 active:scale-95 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                    <FiRefreshCw size={13} className={loading ? "animate-spin text-emerald-600" : ""} />
                    <span>Refresh</span>
                </button>
            </div>

            {/* Search */}
            <div className="relative">
                <FiSearch className="absolute left-3 top-2.5 text-gray-400" size={14} />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by industry name, sector, or constituent stock..."
                    className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-xs text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-hidden dark:border-gray-800 dark:bg-gray-900 dark:text-white"
                />
            </div>

            {/* Industries Cards Grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredIndustries.map((ind, index) => {
                    const isPos = ind.avgMomentum >= 0;
                    return (
                        <div
                            key={ind.industry}
                            className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-xs transition hover:border-emerald-500/50 dark:border-gray-800 dark:bg-gray-900"
                        >
                            <div>
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                            #{index + 1}
                                        </span>
                                        <h3 className="font-bold text-sm text-gray-900 dark:text-white">
                                            {ind.industry}
                                        </h3>
                                    </div>
                                    <span
                                        className={`rounded-md px-2 py-0.5 text-xs font-bold ${
                                            isPos
                                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                                : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
                                        }`}
                                    >
                                        {isPos ? "+" : ""}{ind.avgMomentum}%
                                    </span>
                                </div>
                                <div className="mt-1 text-[11px] text-gray-400">{ind.sector}</div>

                                {/* Top Performer Badge */}
                                {ind.topPerformer && (
                                    <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-800/50">
                                        <span className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                                            <FiAward className="text-amber-500" size={13} /> Leader:
                                        </span>
                                        <span className="font-bold text-gray-900 dark:text-white">
                                            {ind.topPerformer.symbol}
                                        </span>
                                        <span
                                            className={`font-semibold font-mono text-[11px] ${
                                                ind.topPerformer.pChange >= 0
                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                    : "text-rose-600 dark:text-rose-400"
                                            }`}
                                        >
                                            {ind.topPerformer.pChange >= 0 ? "+" : ""}{ind.topPerformer.pChange}%
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Constituent stock pills */}
                            <div className="mt-3 border-t border-gray-100 pt-2.5 dark:border-gray-800">
                                <div className="mb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                    Constituents ({ind.stockCount})
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {ind.stocks.map((st) => (
                                        <span
                                            key={st.symbol}
                                            className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                        >
                                            <span>{st.symbol}</span>
                                            <span
                                                className={`text-[10px] font-mono ${
                                                    st.pChange >= 0
                                                        ? "text-emerald-600 dark:text-emerald-400"
                                                        : "text-rose-600 dark:text-rose-400"
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
