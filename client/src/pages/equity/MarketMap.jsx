// pages/equity/MarketMap.jsx — Interactive Sector Heatmap / Treemap with real-time Upstox ticks
import { useEffect, useState, useMemo } from "react";
import { fetchMarketMap } from "../../services/equityApi";
import { formatPrice, formatPercent } from "../../utils/format";
import { FiRefreshCw, FiSearch, FiFilter, FiTrendingUp, FiTrendingDown, FiActivity } from "react-icons/fi";

function getColorClass(pChange) {
    if (pChange >= 3.0) return "bg-emerald-600 text-white border-emerald-700";
    if (pChange >= 1.5) return "bg-emerald-500 text-white border-emerald-600";
    if (pChange > 0.05) return "bg-emerald-500/80 text-white border-emerald-500";
    if (pChange <= -3.0) return "bg-rose-600 text-white border-rose-700";
    if (pChange <= -1.5) return "bg-rose-500 text-white border-rose-600";
    if (pChange < -0.05) return "bg-rose-500/80 text-white border-rose-500";
    return "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700";
}

export default function MarketMap() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState("");
    const [selectedSector, setSelectedSector] = useState("all");
    const [sortBy, setSortBy] = useState("weight"); // 'weight' | 'pChange' | 'volume'

    function loadData() {
        setLoading(true);
        fetchMarketMap()
            .then((res) => {
                setData(res);
                setError(null);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 10000); // 10s auto-refresh
        return () => clearInterval(interval);
    }, []);

    const filteredSectors = useMemo(() => {
        if (!data?.sectors) return [];
        return data.sectors
            .filter((s) => selectedSector === "all" || s.sector === selectedSector)
            .map((s) => {
                let stocks = s.stocks.filter(
                    (st) =>
                        st.symbol.toLowerCase().includes(query.toLowerCase()) ||
                        st.industry.toLowerCase().includes(query.toLowerCase())
                );
                if (sortBy === "pChange") {
                    stocks = [...stocks].sort((a, b) => b.pChange - a.pChange);
                } else if (sortBy === "volume") {
                    stocks = [...stocks].sort((a, b) => b.volume - a.volume);
                } else {
                    stocks = [...stocks].sort((a, b) => b.weight - a.weight);
                }
                return { ...s, stocks };
            })
            .filter((s) => s.stocks.length > 0);
    }, [data, query, selectedSector, sortBy]);

    const totalAdvances = useMemo(() => {
        if (!data?.sectors) return 0;
        return data.sectors.reduce((sum, s) => sum + s.advances, 0);
    }, [data]);

    const totalDeclines = useMemo(() => {
        if (!data?.sectors) return 0;
        return data.sectors.reduce((sum, s) => sum + s.declines, 0);
    }, [data]);

    return (
        <div className="space-y-4">
            {/* Header & Market Pulse Banner */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
                        Market Heatmap
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                        Real-time visualization of market breadth and sector performance powered by Upstox.
                    </p>
                </div>

                {/* Market Breadth Pill */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-xs dark:border-gray-800 dark:bg-gray-900 text-xs">
                        <span className="flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                            <FiTrendingUp size={14} /> {totalAdvances} Adv
                        </span>
                        <span className="text-gray-300 dark:text-gray-700">|</span>
                        <span className="flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                            <FiTrendingDown size={14} /> {totalDeclines} Dec
                        </span>
                    </div>

                    <button
                        onClick={loadData}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-xs hover:bg-gray-50 active:scale-95 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                        title="Refresh Live Quotes"
                    >
                        <FiRefreshCw size={13} className={loading ? "animate-spin text-emerald-600" : ""} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Controls Bar */}
            <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-xs dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
                {/* Search */}
                <div className="relative flex-1 sm:max-w-xs">
                    <FiSearch className="absolute left-3 top-2.5 text-gray-400" size={14} />
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search stock, sector, or industry..."
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-9 pr-3 text-xs text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        value={selectedSector}
                        onChange={(e) => setSelectedSector(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 focus:outline-hidden"
                    >
                        <option value="all">All Sectors</option>
                        {data?.sectors?.map((s) => (
                            <option key={s.sector} value={s.sector}>
                                {s.sector}
                            </option>
                        ))}
                    </select>

                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 focus:outline-hidden"
                    >
                        <option value="weight">Sort by Weight</option>
                        <option value="pChange">Sort by % Change</option>
                        <option value="volume">Sort by Volume</option>
                    </select>
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <div className="rounded-lg bg-rose-50 p-3 text-xs font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                    Failed to load real-time market map: {error}
                </div>
            )}

            {/* Sector Cards Grid */}
            <div className="space-y-4">
                {filteredSectors.map((s) => (
                    <div
                        key={s.sector}
                        className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs dark:border-gray-800 dark:bg-gray-900"
                    >
                        {/* Sector Header */}
                        <div className="mb-2.5 flex items-center justify-between border-b border-gray-100 pb-2 dark:border-gray-800">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-900 dark:text-white">
                                    {s.sector}
                                </span>
                                <span
                                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                                        s.avgChange >= 0
                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                            : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
                                    }`}
                                >
                                    {s.avgChange >= 0 ? "+" : ""}
                                    {s.avgChange}%
                                </span>
                            </div>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                {s.stocks.length} stocks • {s.advances} Adv / {s.declines} Dec
                            </span>
                        </div>

                        {/* Stocks Tiles Grid */}
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                            {s.stocks.map((st) => {
                                const color = getColorClass(st.pChange);
                                return (
                                    <div
                                        key={st.symbol}
                                        className={`flex flex-col justify-between rounded-lg border p-2.5 transition-all hover:scale-[1.02] hover:shadow-md cursor-pointer ${color}`}
                                    >
                                        <div className="flex items-start justify-between">
                                            <span className="font-bold tracking-tight text-xs">
                                                {st.symbol}
                                            </span>
                                            <span className="text-[10px] opacity-85 font-mono">
                                                {st.pChange >= 0 ? "+" : ""}
                                                {st.pChange.toFixed(2)}%
                                            </span>
                                        </div>
                                        <div className="mt-2 flex items-baseline justify-between text-[11px]">
                                            <span className="font-semibold font-mono">
                                                ₹{formatPrice(st.price)}
                                            </span>
                                            <span className="text-[9px] opacity-75 truncate max-w-[60px]">
                                                {st.industry}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
