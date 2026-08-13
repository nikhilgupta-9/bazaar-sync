import { useEffect, useState } from "react";
import { FiUsers, FiCreditCard, FiTrendingUp, FiFileText } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchOverview } from "../services/adminApi";
import { formatRupees, formatPaiseAsRupees } from "../utils/format";
import TopBar from "../components/TopBar";
import StatCard from "../components/StatCard";
import Card from "../components/Card";

export default function Overview() {
    const { token } = useAdminAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchOverview(token).then(setData).catch((err) => setError(err.message));
    }, [token]);

    return (
        <div>
            <TopBar title="Overview" subtitle="Site-wide stats, pulled live from the database." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
                {!data ? (
                    <div className="py-16 text-center text-xs text-gray-500">Loading…</div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <StatCard
                                label="Total users"
                                value={data.users.total}
                                icon={FiUsers}
                                tone="violet"
                                trend={data.signupsByDay}
                            />
                            <StatCard
                                label="Active Pro subscribers"
                                value={data.users.proActive}
                                icon={FiCreditCard}
                                tone="emerald"
                            />
                            <StatCard
                                label="Paper capital in circulation"
                                value={formatRupees(data.paperWallets.totalBalance)}
                                icon={FiTrendingUp}
                                tone="amber"
                            />
                            <StatCard
                                label="Saved strategies"
                                value={data.strategies.total}
                                icon={FiFileText}
                                tone="violet"
                            />
                        </div>

                        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Card title="Paper Trade positions">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Open</span>
                                    <span className="font-bold tabular-nums text-white">{data.positions.open}</span>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Closed</span>
                                    <span className="font-bold tabular-nums text-white">{data.positions.closed}</span>
                                </div>
                            </Card>

                            <Card title="Revenue (estimate)">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Pro purchases</span>
                                    <span className="font-bold tabular-nums text-white">{data.revenueEstimate.proPurchases}</span>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-sm">
                                    <span className="text-gray-400">Refill purchases</span>
                                    <span className="font-bold tabular-nums text-white">{data.revenueEstimate.refillPurchases}</span>
                                </div>
                                <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-sm">
                                    <span className="text-gray-400">Total (estimated)</span>
                                    <span className="font-bold tabular-nums text-emerald-400">{formatPaiseAsRupees(data.revenueEstimate.totalPaise)}</span>
                                </div>
                                <p className="mt-3 text-[10px] text-gray-600">{data.revenueEstimate.note}</p>
                            </Card>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
