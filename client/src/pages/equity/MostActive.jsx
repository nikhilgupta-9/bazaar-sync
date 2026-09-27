// pages/equity/MostActive.jsx — Most Active Stocks (Volume, Turnover, Top Gainers, Top Losers)
import { useEffect, useState } from "react";
import { fetchMostActive } from "../../services/equityApi";
import { formatPrice } from "../../utils/format";
import { FiRefreshCw, FiTrendingUp, FiTrendingDown, FiActivity, FiDollarSign } from "react-icons/fi";

const TABS = [
    { id: "volume", label: "Volume Leaders", icon: FiActivity },
    { id: "turnover", label: "Highest Turnover", icon: FiDollarSign },
    { id: "gainers", label: "Top Gainers", icon: FiTrendingUp },
    { id: "losers", label: "Top Losers", icon: FiTrendingDown },
];

export default function MostActive() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState("volume");

    function loadData() {
        setLoading(true);
        fetchMostActive()
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

    let activeList = [];
    if (data) {
        if (activeTab === "volume") activeList = data.topVolume || [];
        else if (activeTab === "turnover") activeList = data.topTurnover || [];
        else if (activeTab === "gainers") activeList = data.topGainers || [];
        else if (activeTab === "losers") activeList = data.topLosers || [];
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
                        Most Active Equities
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                        High-liquidity stocks ranked by volume, traded turnover value, and daily % moves.
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

            {/* Tab selection buttons */}
            <div className="flex flex-wrap gap-2">
                {TABS.map((t) => {
                    const Icon = t.icon;
                    const isActive = activeTab === t.id;
                    return (
                        <button
                            key={t.id}
                            onClick={() => setActiveTab(t.id)}
                            className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                                isActive
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                            }`}
                        >
                            <Icon size={14} />
                            <span>{t.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* Responsive Table */}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-900">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="border-b border-gray-200 bg-gray-50/75 text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Rank & Stock</th>
                                <th className="px-4 py-3 font-semibold">Sector</th>
                                <th className="px-4 py-3 font-semibold text-right">LTP (₹)</th>
                                <th className="px-4 py-3 font-semibold text-right">Change (%)</th>
                                <th className="px-4 py-3 font-semibold text-right">Traded Volume</th>
                                <th className="px-4 py-3 font-semibold text-right">Turnover (₹ Cr)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                            {activeList.map((item, idx) => {
                                const isPos = item.pChange >= 0;
                                return (
                                    <tr key={item.symbol} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                                                    {idx + 1}
                                                </span>
                                                <div>
                                                    <span className="font-bold text-gray-900 dark:text-white">
                                                        {item.symbol}
                                                    </span>
                                                    <span className="ml-1.5 rounded-sm bg-gray-100 px-1 py-0.5 text-[9px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                        {item.mcapTier}
                                                    </span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                                            {item.industry}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-gray-900 dark:text-white">
                                            ₹{formatPrice(item.price)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            <span
                                                className={`font-semibold ${
                                                    isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                }`}
                                            >
                                                {isPos ? "+" : ""}{item.pChange}%
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-gray-700 dark:text-gray-300">
                                            {Number(item.volume).toLocaleString("en-IN")}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900 dark:text-white">
                                            ₹{item.turnoverCr > 0 ? item.turnoverCr.toLocaleString("en-IN") : "-"} Cr
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
