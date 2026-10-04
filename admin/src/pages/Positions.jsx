import React, { useEffect, useMemo, useState } from "react";
// pages/Positions.jsx — Admin Paper Trading Oversight, Multi-User Trade Inspector & Leaderboard
// Features: Comprehensive Metrics, User-wise Trade History Grouping, Interactive Filters,
// Real-time Mark-to-Market P&L, and Full Paper Trading Leaderboard.

import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchAllPositions } from "../services/adminApi";
import { formatPrice, formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";
import {
    FiTrendingUp,
    FiTrendingDown,
    FiUsers,
    FiAward,
    FiSearch,
    FiFilter,
    FiLayers,
    FiActivity,
    FiClock,
    FiDollarSign,
    FiArrowRight,
    FiCheckCircle,
    FiRefreshCw,
    FiX,
    FiUser,
    FiCheck,
} from "react-icons/fi";

function PositionsTable({ rows, isLive = false }) {
    if (!rows || rows.length === 0) {
        return (
            <div className="py-12 text-center text-xs text-gray-500">
                No positions found matching the criteria.
            </div>
        );
    }

    return (
        <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse text-xs">
                <thead>
                    <tr className="border-b border-white/10 text-gray-400">
                        <th className="pb-3 text-left font-semibold">Trader</th>
                        <th className="pb-3 text-left font-semibold">Contract</th>
                        <th className="pb-3 text-left font-semibold">Side</th>
                        <th className="pb-3 text-right font-semibold">Lots (Qty)</th>
                        <th className="pb-3 text-right font-semibold">Entry Price</th>
                        <th className="pb-3 text-right font-semibold">{isLive ? "Live Price" : "Exit Price"}</th>
                        <th className="pb-3 text-right font-semibold">P&amp;L (₹)</th>
                        <th className="pb-3 text-right font-semibold">{isLive ? "Entry Time" : "Exit Time"}</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {rows.map((p) => {
                        const pnl = isLive ? p.unrealizedPnl : p.realized_pnl;
                        const isProfit = Number(pnl) >= 0;
                        const qty = (p.lots || 1) * (p.lot_size || 50);

                        return (
                            <tr key={p.id} className="hover:bg-white/[0.02] transition">
                                <td className="py-3">
                                    <div className="flex items-center gap-2">
                                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600/20 text-[11px] font-bold text-violet-300 overflow-hidden shrink-0 border border-violet-500/20">
                                            {p.avatar_url ? (
                                                <img src={p.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                            ) : (
                                                (p.user_name || "U").charAt(0).toUpperCase()
                                            )}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-gray-200 truncate max-w-[140px]">
                                                {p.user_name || "Anonymous"}
                                            </div>
                                            <div className="text-[10px] text-gray-500 truncate max-w-[140px]">
                                                {p.user_email}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td className="py-3">
                                    <div className="flex items-center gap-1.5 font-bold text-gray-200">
                                        <span>{p.symbol}</span>
                                        <span className="text-gray-400">{Number(p.strike).toLocaleString("en-IN")}</span>
                                        <span className={`px-1 rounded text-[10px] ${p.opt_right === "CE" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                                            {p.opt_right}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-gray-500 mt-0.5">
                                        Exp: {p.expiry} {p.strategy_name ? `• ${p.strategy_name}` : ""}
                                    </div>
                                </td>
                                <td className="py-3">
                                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                        p.side === "long" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                    }`}>
                                        {p.side}
                                    </span>
                                </td>
                                <td className="py-3 text-right tabular-nums">
                                    <div className="font-semibold text-gray-200">{p.lots} {p.lots === 1 ? "Lot" : "Lots"}</div>
                                    <div className="text-[10px] text-gray-500">({qty} units)</div>
                                </td>
                                <td className="py-3 text-right font-medium text-gray-300 tabular-nums">
                                    {formatPrice(p.entry_price)}
                                </td>
                                <td className="py-3 text-right font-medium text-gray-300 tabular-nums">
                                    {isLive ? (p.livePrice != null ? formatPrice(p.livePrice) : "—") : formatPrice(p.exit_price)}
                                </td>
                                <td className={`py-3 text-right font-bold tabular-nums text-sm ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                                    {pnl != null ? `${isProfit ? "+" : ""}${formatPrice(pnl)}` : "—"}
                                </td>
                                <td className="py-3 text-right text-gray-500 text-[11px] tabular-nums">
                                    {formatDateTime(isLive ? p.entry_time : p.exit_time)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default function Positions() {
    const { token } = useAdminAuth();
    const [activeTab, setActiveTab] = useState("all"); // 'all' | 'users' | 'leaderboard'
    const [positionsData, setPositionsData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [statusFilter, setStatusFilter] = useState("all"); // 'all' | 'open' | 'closed'

    function loadData() {
        setLoading(true);
        setError(null);
        fetchAllPositions(token)
            .then((res) => {
                setPositionsData(res);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }

    useEffect(() => {
        loadData();
    }, [token]);

    const openPositions = positionsData?.positions?.open || [];
    const closedPositions = positionsData?.positions?.closed || [];
    const userSummaries = positionsData?.userSummaries || [];
    const leaderboard = positionsData?.leaderboard || [];

    // Filtered Positions
    const filteredPositions = useMemo(() => {
        let list = [];
        if (statusFilter === "open") list = openPositions;
        else if (statusFilter === "closed") list = closedPositions;
        else list = [...openPositions, ...closedPositions];

        if (selectedUserId) {
            list = list.filter((p) => Number(p.user_id) === Number(selectedUserId));
        }

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(
                (p) =>
                    (p.user_name || "").toLowerCase().includes(q) ||
                    (p.user_email || "").toLowerCase().includes(q) ||
                    (p.symbol || "").toLowerCase().includes(q) ||
                    (p.strategy_name || "").toLowerCase().includes(q)
            );
        }

        return list;
    }, [openPositions, closedPositions, statusFilter, selectedUserId, searchQuery]);

    // Selected user details
    const selectedUser = useMemo(() => {
        if (!selectedUserId) return null;
        return userSummaries.find((u) => Number(u.user_id) === Number(selectedUserId));
    }, [selectedUserId, userSummaries]);

    // Top metrics
    const totalOpenTrades = openPositions.length;
    const totalClosedTrades = closedPositions.length;
    const totalRealizedPnl = closedPositions.reduce((acc, p) => acc + (Number(p.realized_pnl) || 0), 0);
    const totalTradersCount = userSummaries.length;

    return (
        <div>
            <TopBar
                title="Paper Trade Workstation"
                subtitle="Live overview of trader positions, user trade histories, and performance leaderboard."
            />

            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-6">
                {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium flex items-center justify-between">
                        <span>{error}</span>
                        <button onClick={loadData} className="text-rose-400 hover:text-white font-bold underline">
                            Retry
                        </button>
                    </div>
                )}

                {/* Top Metrics Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-gray-400 text-xs">
                            <span>Active Open Trades</span>
                            <FiActivity className="text-emerald-400" size={16} />
                        </div>
                        <div className="text-2xl font-black text-white">{totalOpenTrades}</div>
                        <div className="text-[11px] text-gray-500">Live mark-to-market positions</div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-gray-400 text-xs">
                            <span>Total Closed Trades</span>
                            <FiClock className="text-blue-400" size={16} />
                        </div>
                        <div className="text-2xl font-black text-white">{totalClosedTrades}</div>
                        <div className="text-[11px] text-gray-500">Historical realized orders</div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-gray-400 text-xs">
                            <span>Net Realized P&amp;L</span>
                            <FiDollarSign className={totalRealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"} size={16} />
                        </div>
                        <div className={`text-2xl font-black ${totalRealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {totalRealizedPnl >= 0 ? "+" : ""}{formatPrice(totalRealizedPnl)}
                        </div>
                        <div className="text-[11px] text-gray-500">Across all paper accounts</div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1.5">
                        <div className="flex items-center justify-between text-gray-400 text-xs">
                            <span>Active Paper Traders</span>
                            <FiUsers className="text-violet-400" size={16} />
                        </div>
                        <div className="text-2xl font-black text-white">{totalTradersCount}</div>
                        <div className="text-[11px] text-gray-500">Traders placed orders</div>
                    </div>
                </div>

                {/* Main Navigation Tabs */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => { setActiveTab("all"); setSelectedUserId(null); }}
                            className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                                activeTab === "all"
                                    ? "bg-violet-600 text-white shadow-md shadow-violet-600/20"
                                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                            }`}
                        >
                            All Positions ({openPositions.length + closedPositions.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("users")}
                            className={`rounded-xl px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                                activeTab === "users"
                                    ? "bg-violet-600 text-white shadow-md shadow-violet-600/20"
                                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                            }`}
                        >
                            <FiUsers size={14} />
                            <span>User Trade Inspector ({userSummaries.length})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("leaderboard")}
                            className={`rounded-xl px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                                activeTab === "leaderboard"
                                    ? "bg-violet-600 text-white shadow-md shadow-violet-600/20"
                                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                            }`}
                        >
                            <FiAward size={14} />
                            <span>Leaderboard</span>
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={loadData}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-medium text-gray-300 transition"
                    >
                        <FiRefreshCw size={12} className={loading ? "animate-spin" : ""} />
                        <span>Refresh Data</span>
                    </button>
                </div>

                {/* TAB 1: ALL POSITIONS VIEW */}
                {activeTab === "all" && (
                    <div className="space-y-4">
                        {/* Filters Bar */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                                {[
                                    { key: "all", label: "All Status" },
                                    { key: "open", label: `Open (${openPositions.length})` },
                                    { key: "closed", label: `Closed (${closedPositions.length})` },
                                ].map((t) => (
                                    <button
                                        key={t.key}
                                        type="button"
                                        onClick={() => setStatusFilter(t.key)}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                            statusFilter === t.key ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"
                                        }`}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>

                            <div className="relative w-full sm:w-72">
                                <FiSearch className="absolute left-3 top-2.5 text-gray-400" size={14} />
                                <input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search trader, symbol, email..."
                                    className="w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-violet-500"
                                />
                            </div>
                        </div>

                        {loading ? (
                            <div className="py-16 text-center text-xs text-gray-500">Loading live positions…</div>
                        ) : (
                            <Card title={`Positions List (${filteredPositions.length})`}>
                                <PositionsTable rows={filteredPositions} isLive={statusFilter === "open"} />
                            </Card>
                        )}
                    </div>
                )}

                {/* TAB 2: USER TRADE INSPECTOR & MULTI-TRADE HISTORY */}
                {activeTab === "users" && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left Column: User Selector List */}
                        <div className="space-y-3">
                            <div className="text-xs font-bold uppercase tracking-wider text-gray-400">
                                Select Trader to Inspect ({userSummaries.length})
                            </div>

                            <div className="space-y-2 max-h-[600px] overflow-y-auto custom-scrollbar pr-1">
                                {userSummaries.map((u) => {
                                    const isSelected = selectedUserId === u.user_id;
                                    const netPnl = Number(u.total_realized_pnl) || 0;

                                    return (
                                        <div
                                            key={u.user_id}
                                            onClick={() => setSelectedUserId(u.user_id)}
                                            className={`p-3.5 rounded-2xl border cursor-pointer transition ${
                                                isSelected
                                                    ? "border-violet-500 bg-violet-600/15 shadow-md"
                                                    : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/[0.08]"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600/25 text-xs font-black text-violet-300 overflow-hidden shrink-0 border border-violet-500/30">
                                                        {u.avatar_url ? (
                                                            <img src={u.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                                        ) : (
                                                            (u.user_name || "U").charAt(0).toUpperCase()
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-bold text-white truncate">
                                                            {u.user_name || "Anonymous Trader"}
                                                        </div>
                                                        <div className="text-[10px] text-gray-400 truncate">
                                                            {u.user_email}
                                                        </div>
                                                    </div>
                                                </div>

                                                <span className={`text-xs font-bold tabular-nums ${netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                    {netPnl >= 0 ? "+" : ""}{formatPrice(netPnl)}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between text-[11px] text-gray-400 pt-2 border-t border-white/5">
                                                <span>Open: <strong className="text-emerald-400">{u.open_count}</strong></span>
                                                <span>Closed: <strong className="text-gray-200">{u.closed_count}</strong></span>
                                                <span>Bal: <strong className="text-white">{formatPrice(u.balance)}</strong></span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Right 2 Columns: Multi-Trade Inspector for Selected User */}
                        <div className="lg:col-span-2 space-y-4">
                            {selectedUser ? (
                                <>
                                    {/* User Detail Header Card */}
                                    <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-r from-violet-600/20 via-purple-600/10 to-transparent p-5 space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-base font-black text-white overflow-hidden shadow-md">
                                                    {selectedUser.avatar_url ? (
                                                        <img src={selectedUser.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                                    ) : (
                                                        (selectedUser.user_name || "U").charAt(0).toUpperCase()
                                                    )}
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-black text-white flex items-center gap-2">
                                                        <span>{selectedUser.user_name}</span>
                                                        <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold text-gray-300">
                                                            ID: #{selectedUser.user_id}
                                                        </span>
                                                    </h3>
                                                    <div className="text-xs text-gray-400">{selectedUser.user_email}</div>
                                                </div>
                                            </div>

                                            <div className="text-right">
                                                <div className="text-[10px] uppercase font-bold text-gray-400">Total Realized P&amp;L</div>
                                                <div className={`text-xl font-black ${Number(selectedUser.total_realized_pnl) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                    {Number(selectedUser.total_realized_pnl) >= 0 ? "+" : ""}{formatPrice(selectedUser.total_realized_pnl)}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/10 text-xs">
                                            <div>
                                                <span className="text-gray-400">Virtual Balance:</span>{" "}
                                                <strong className="text-white">{formatPrice(selectedUser.balance)}</strong>
                                            </div>
                                            <div>
                                                <span className="text-gray-400">Open Positions:</span>{" "}
                                                <strong className="text-emerald-400">{selectedUser.open_count}</strong>
                                            </div>
                                            <div>
                                                <span className="text-gray-400">Trading Style:</span>{" "}
                                                <strong className="text-gray-200">{selectedUser.trading_style || "Options Buyer"}</strong>
                                            </div>
                                        </div>
                                    </div>

                                    {/* User's Open Trades */}
                                    <Card title={`Open Trades (${openPositions.filter(p => Number(p.user_id) === Number(selectedUserId)).length})`}>
                                        <PositionsTable
                                            rows={openPositions.filter(p => Number(p.user_id) === Number(selectedUserId))}
                                            isLive={true}
                                        />
                                    </Card>

                                    {/* User's Complete Trade History */}
                                    <Card title={`Closed Trade History (${closedPositions.filter(p => Number(p.user_id) === Number(selectedUserId)).length})`}>
                                        <PositionsTable
                                            rows={closedPositions.filter(p => Number(p.user_id) === Number(selectedUserId))}
                                            isLive={false}
                                        />
                                    </Card>
                                </>
                            ) : (
                                <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-12 text-center text-gray-400 space-y-2">
                                    <FiUser size={32} className="mx-auto text-gray-500 mb-2" />
                                    <div className="text-sm font-bold text-white">Select a Trader from the left panel</div>
                                    <p className="text-xs text-gray-500">Click any trader to inspect their active trades, strategy breakdown, and full historical orders.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TAB 3: LEADERBOARD WORKSTATION */}
                {activeTab === "leaderboard" && (
                    <div className="space-y-6">
                        {/* Top 3 Podium Highlights */}
                        {leaderboard.length >= 3 && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Rank 2 */}
                                <div className="rounded-2xl border border-slate-500/30 bg-slate-500/10 p-5 text-center space-y-2 order-2 md:order-1">
                                    <span className="text-2xl">🥈</span>
                                    <div className="text-xs font-black uppercase tracking-wider text-slate-300">Rank #2</div>
                                    <div className="text-base font-bold text-white truncate">{leaderboard[1].name}</div>
                                    <div className={`text-xl font-black ${leaderboard[1].netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                        {leaderboard[1].netPnl >= 0 ? "+" : ""}{formatPrice(leaderboard[1].netPnl)}
                                    </div>
                                    <div className="text-xs text-gray-400">Win Rate: <strong>{leaderboard[1].winRate}%</strong> ({leaderboard[1].closedTrades} Trades)</div>
                                </div>

                                {/* Rank 1 (Center Prominent) */}
                                <div className="rounded-2xl border border-amber-500/40 bg-gradient-to-b from-amber-500/20 to-amber-500/5 p-6 text-center space-y-2 order-1 md:order-2 shadow-lg shadow-amber-500/10">
                                    <span className="text-3xl">👑 🥇</span>
                                    <div className="text-xs font-black uppercase tracking-wider text-amber-300">Rank #1 Leader</div>
                                    <div className="text-lg font-black text-white truncate">{leaderboard[0].name}</div>
                                    <div className={`text-2xl font-black ${leaderboard[0].netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                        {leaderboard[0].netPnl >= 0 ? "+" : ""}{formatPrice(leaderboard[0].netPnl)}
                                    </div>
                                    <div className="text-xs text-amber-200/90 font-semibold">Win Rate: <strong>{leaderboard[0].winRate}%</strong> ({leaderboard[0].closedTrades} Trades)</div>
                                    <div className="inline-block rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
                                        {leaderboard[0].badge}
                                    </div>
                                </div>

                                {/* Rank 3 */}
                                <div className="rounded-2xl border border-amber-700/30 bg-amber-700/10 p-5 text-center space-y-2 order-3">
                                    <span className="text-2xl">🥉</span>
                                    <div className="text-xs font-black uppercase tracking-wider text-amber-500">Rank #3</div>
                                    <div className="text-base font-bold text-white truncate">{leaderboard[2].name}</div>
                                    <div className={`text-xl font-black ${leaderboard[2].netPnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                        {leaderboard[2].netPnl >= 0 ? "+" : ""}{formatPrice(leaderboard[2].netPnl)}
                                    </div>
                                    <div className="text-xs text-gray-400">Win Rate: <strong>{leaderboard[2].winRate}%</strong> ({leaderboard[2].closedTrades} Trades)</div>
                                </div>
                            </div>
                        )}

                        {/* Full Leaderboard Table */}
                        <Card title={`Paper Trading Leaderboard (${leaderboard.length} Traders)`}>
                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-white/10 text-gray-400">
                                            <th className="pb-3 text-left font-semibold">Rank</th>
                                            <th className="pb-3 text-left font-semibold">Trader</th>
                                            <th className="pb-3 text-left font-semibold">Style / Badge</th>
                                            <th className="pb-3 text-right font-semibold">Closed Trades</th>
                                            <th className="pb-3 text-right font-semibold">Win Rate</th>
                                            <th className="pb-3 text-right font-semibold">Virtual Balance</th>
                                            <th className="pb-3 text-right font-semibold">Net P&amp;L</th>
                                            <th className="pb-3 text-right font-semibold">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5">
                                        {leaderboard.map((trader) => {
                                            const isProfit = trader.netPnl >= 0;
                                            return (
                                                <tr key={trader.userId} className="hover:bg-white/[0.02] transition">
                                                    <td className="py-3 font-bold">
                                                        {trader.rank === 1 ? "🥇 #1" : trader.rank === 2 ? "🥈 #2" : trader.rank === 3 ? "🥉 #3" : `#${trader.rank}`}
                                                    </td>
                                                    <td className="py-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-600/20 text-[11px] font-bold text-violet-300 overflow-hidden shrink-0">
                                                                {trader.avatarUrl ? (
                                                                    <img src={trader.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                                                ) : (
                                                                    trader.name.charAt(0).toUpperCase()
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="font-bold text-white truncate max-w-[130px]">{trader.name}</div>
                                                                <div className="text-[10px] text-gray-500 truncate max-w-[130px]">{trader.email}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-3">
                                                        <div className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-gray-300 border border-white/10">
                                                            <span>{trader.badge}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 text-right tabular-nums text-gray-300">
                                                        {trader.closedTrades} ({trader.winningTrades}W / {trader.losingTrades}L)
                                                    </td>
                                                    <td className="py-3 text-right tabular-nums">
                                                        <span className={`font-bold ${trader.winRate >= 50 ? "text-emerald-400" : "text-gray-400"}`}>
                                                            {trader.winRate}%
                                                        </span>
                                                    </td>
                                                    <td className="py-3 text-right font-semibold text-gray-200 tabular-nums">
                                                        {formatPrice(trader.balance)}
                                                    </td>
                                                    <td className={`py-3 text-right font-black tabular-nums text-sm ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
                                                        {isProfit ? "+" : ""}{formatPrice(trader.netPnl)}
                                                    </td>
                                                    <td className="py-3 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setActiveTab("users");
                                                                setSelectedUserId(trader.userId);
                                                            }}
                                                            className="inline-flex items-center gap-1 rounded-md bg-violet-600/20 hover:bg-violet-600/40 px-2.5 py-1 text-[11px] font-bold text-violet-300 transition"
                                                        >
                                                            <span>Inspect</span>
                                                            <FiArrowRight size={11} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}
