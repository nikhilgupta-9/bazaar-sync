import { useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchAllPositions } from "../services/adminApi";
import { formatPrice, formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

function PositionsTable({ rows, showPnlCol }) {
    if (rows.length === 0) return <div className="py-10 text-center text-xs text-gray-500">None.</div>;
    return (
        <table className="w-full border-collapse text-xs">
            <thead>
                <tr className="text-gray-600">
                    <th className="pb-2 text-left font-medium">User</th>
                    <th className="pb-2 text-left font-medium">Contract</th>
                    <th className="pb-2 text-left font-medium">Side</th>
                    <th className="pb-2 text-right font-medium">Lots</th>
                    <th className="pb-2 text-right font-medium">Entry</th>
                    <th className="pb-2 text-right font-medium">{showPnlCol === "open" ? "Live" : "Exit"}</th>
                    <th className="pb-2 text-right font-medium">P&L</th>
                    <th className="pb-2 text-right font-medium">{showPnlCol === "open" ? "Entered" : "Closed"}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
                {rows.map((p) => {
                    const pnl = showPnlCol === "open" ? p.unrealizedPnl : p.realized_pnl;
                    return (
                        <tr key={p.id}>
                            <td className="py-2">
                                <div className="font-medium text-gray-200">{p.user_name}</div>
                                <div className="text-gray-500">{p.user_email}</div>
                            </td>
                            <td className="py-2 text-gray-300">{p.symbol} {p.strike} {p.opt_right}</td>
                            <td className="py-2 capitalize text-gray-500">{p.side}</td>
                            <td className="py-2 text-right tabular-nums text-gray-400">{p.lots}</td>
                            <td className="py-2 text-right tabular-nums text-gray-400">{formatPrice(p.entry_price)}</td>
                            <td className="py-2 text-right tabular-nums text-gray-400">
                                {showPnlCol === "open" ? (p.livePrice != null ? formatPrice(p.livePrice) : "-") : formatPrice(p.exit_price)}
                            </td>
                            <td className={`py-2 text-right font-medium tabular-nums ${pnl >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                {pnl != null ? formatPrice(pnl) : "-"}
                            </td>
                            <td className="py-2 text-right text-gray-500">{formatDateTime(showPnlCol === "open" ? p.entry_time : p.exit_time)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

export default function Positions() {
    const { token } = useAdminAuth();
    const [positions, setPositions] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchAllPositions(token).then((res) => setPositions(res.positions)).catch((err) => setError(err.message));
    }, [token]);

    return (
        <div>
            <TopBar title="Paper Trade" subtitle="Every open and recently-closed paper position across all users." />
            <div className="p-6 space-y-4">
                {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
                {!positions ? (
                    <div className="py-16 text-center text-xs text-gray-500">Loading…</div>
                ) : (
                    <>
                        <Card title={`Open Positions (${positions.open.length})`}>
                            <PositionsTable rows={positions.open} showPnlCol="open" />
                        </Card>
                        <Card title={`Recently Closed (${positions.closed.length})`}>
                            <PositionsTable rows={positions.closed} showPnlCol="closed" />
                        </Card>
                    </>
                )}
            </div>
        </div>
    );
}
