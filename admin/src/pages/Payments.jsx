import { useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchPayments } from "../services/adminApi";
import { formatRupees, formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const TYPE_LABELS = {
    pro_purchase_grant: "Pro membership purchase",
    refill_purchase: "Paper capital refill",
};

export default function Payments() {
    const { token } = useAdminAuth();
    const [payments, setPayments] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchPayments(token).then((res) => setPayments(res.payments)).catch((err) => setError(err.message));
    }, [token]);

    return (
        <div>
            <TopBar title="Subscriptions & Payments" subtitle="Every Pro-purchase / refill ledger row across all users, newest first." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
                <Card>
                    {!payments ? (
                        <div className="py-16 text-center text-xs text-gray-500">Loading…</div>
                    ) : payments.length === 0 ? (
                        <div className="py-16 text-center text-xs text-gray-500">No payments yet.</div>
                    ) : (
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr className="text-gray-600">
                                    <th className="pb-2 text-left font-medium">User</th>
                                    <th className="pb-2 text-left font-medium">Type</th>
                                    <th className="pb-2 text-right font-medium">Paper Capital Granted</th>
                                    <th className="pb-2 text-left font-medium">Razorpay Payment ID</th>
                                    <th className="pb-2 text-right font-medium">Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {payments.map((p) => (
                                    <tr key={p.id}>
                                        <td className="py-2">
                                            <div className="font-medium text-gray-200">{p.user_name}</div>
                                            <div className="text-gray-500">{p.user_email}</div>
                                        </td>
                                        <td className="py-2 text-gray-300">{TYPE_LABELS[p.type] || p.type}</td>
                                        <td className="py-2 text-right font-medium tabular-nums text-emerald-400">{formatRupees(p.amount)}</td>
                                        <td className="py-2 text-gray-500">{p.razorpay_payment_id || "-"}</td>
                                        <td className="py-2 text-right text-gray-400">{formatDateTime(p.created_at)}</td>
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
