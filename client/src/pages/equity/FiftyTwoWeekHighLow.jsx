// pages/equity/FiftyTwoWeekHighLow.jsx — Real-time 52-Week High & Low Scanner with Proximity Meters
import { useEffect, useState, useMemo } from "react";
import { fetch52WeekHighLow } from "../../services/equityApi";
import { formatPrice } from "../../utils/format";
import { FiRefreshCw, FiSearch, FiArrowUpRight, FiArrowDownRight } from "react-icons/fi";

export default function FiftyTwoWeekHighLow() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [_error, setError] = useState(null);
    const [tab, setTab] = useState("nearHigh"); // 'nearHigh' | 'nearLow' | 'newHigh' | 'newLow' | 'all'
    const [query, setQuery] = useState("");

    function loadData() {
        setLoading(true);
        fetch52WeekHighLow()
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

    const activeList = useMemo(() => {
        if (!data) return [];
        let list;
        if (tab === "nearHigh") list = data.near52WHigh || [];
        else if (tab === "nearLow") list = data.near52WLow || [];
        else if (tab === "newHigh") list = data.new52WHighToday || [];
        else if (tab === "newLow") list = data.new52WLowToday || [];
        else list = data.all || [];

        if (!query.trim()) return list;
        return list.filter(
            (item) =>
                item.symbol.toLowerCase().includes(query.toLowerCase()) ||
                item.sector.toLowerCase().includes(query.toLowerCase()) ||
                item.industry.toLowerCase().includes(query.toLowerCase())
        );
    }, [data, tab, query]);

    return (
        <div className="space-y-4">
            {/* Header & Quick Stats */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-2xl">
                        52-Week High / Low Tracker
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                        Live proximity scan of stocks trading near multi-month milestones or breaking new price records.
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

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                    onClick={() => setTab("nearHigh")}
                    className={`flex flex-col rounded-xl border p-3 text-left transition ${
                        tab === "nearHigh"
                            ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
                            : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                    }`}
                >
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Near 52W High (&lt;5%)</span>
                    <span className="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {data?.summary?.nearHighCount ?? "-"}
                    </span>
                </button>

                <button
                    onClick={() => setTab("nearLow")}
                    className={`flex flex-col rounded-xl border p-3 text-left transition ${
                        tab === "nearLow"
                            ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20"
                            : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                    }`}
                >
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Near 52W Low (&lt;5%)</span>
                    <span className="mt-1 text-lg font-bold text-rose-600 dark:text-rose-400">
                        {data?.summary?.nearLowCount ?? "-"}
                    </span>
                </button>

                <button
                    onClick={() => setTab("newHigh")}
                    className={`flex flex-col rounded-xl border p-3 text-left transition ${
                        tab === "newHigh"
                            ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
                            : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                    }`}
                >
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">New High Today</span>
                    <span className="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        {data?.summary?.newHighCount ?? "-"}
                    </span>
                </button>

                <button
                    onClick={() => setTab("newLow")}
                    className={`flex flex-col rounded-xl border p-3 text-left transition ${
                        tab === "newLow"
                            ? "border-rose-500 bg-rose-50/50 dark:bg-rose-950/20"
                            : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                    }`}
                >
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">New Low Today</span>
                    <span className="mt-1 text-lg font-bold text-rose-600 dark:text-rose-400">
                        {data?.summary?.newLowCount ?? "-"}
                    </span>
                </button>
            </div>

            {/* Filter Search */}
            <div className="relative">
                <FiSearch className="absolute left-3 top-2.5 text-gray-400" size={14} />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by symbol, sector, or industry..."
                    className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-xs text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-hidden dark:border-gray-800 dark:bg-gray-900 dark:text-white"
                />
            </div>

            {/* Table / List View */}
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-gray-800 dark:bg-gray-900">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                        <thead className="border-b border-gray-200 bg-gray-50/75 text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Stock</th>
                                <th className="px-4 py-3 font-semibold">LTP (₹)</th>
                                <th className="px-4 py-3 font-semibold">Day Change</th>
                                <th className="px-4 py-3 font-semibold">52W Low</th>
                                <th className="px-4 py-3 font-semibold text-center">52W Range & Position</th>
                                <th className="px-4 py-3 font-semibold text-right">52W High</th>
                                <th className="px-4 py-3 font-semibold text-right">Proximity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60">
                            {activeList.map((item) => {
                                const isPos = item.pChange >= 0;
                                return (
                                    <tr key={item.symbol} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition">
                                        <td className="px-4 py-3">
                                            <div className="font-bold text-gray-900 dark:text-white">{item.symbol}</div>
                                            <div className="text-[10px] text-gray-400">{item.industry}</div>
                                        </td>
                                        <td className="px-4 py-3 font-mono font-bold text-gray-900 dark:text-white">
                                            ₹{formatPrice(item.price)}
                                        </td>
                                        <td className="px-4 py-3 font-mono">
                                            <span
                                                className={`inline-flex items-center gap-0.5 font-semibold ${
                                                    isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                                                }`}
                                            >
                                                {isPos ? <FiArrowUpRight size={13} /> : <FiArrowDownRight size={13} />}
                                                {isPos ? "+" : ""}{item.pChange}%
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-gray-500 dark:text-gray-400">
                                            ₹{formatPrice(item.yearLow)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="mx-auto max-w-[140px] space-y-1">
                                                <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden flex">
                                                    <div
                                                        className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 rounded-full"
                                                        style={{ width: `${item.rangePosition}%` }}
                                                    />
                                                </div>
                                                <div className="text-center text-[10px] font-mono text-gray-400">
                                                    {item.rangePosition}% of range
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 font-mono text-right text-gray-500 dark:text-gray-400">
                                            ₹{formatPrice(item.yearHigh)}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">
                                            {tab === "nearHigh" || tab === "newHigh" ? (
                                                <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                                                    -{item.distFromHigh}% from High
                                                </span>
                                            ) : (
                                                <span className="rounded-md bg-rose-50 px-2 py-1 font-semibold text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
                                                    +{item.distFromLow}% from Low
                                                </span>
                                            )}
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
