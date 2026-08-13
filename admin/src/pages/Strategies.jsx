import { useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchAllStrategies } from "../services/adminApi";
import { formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

function legCount(legsJson) {
    try {
        return JSON.parse(legsJson).length;
    } catch {
        return "?";
    }
}

export default function Strategies() {
    const { token } = useAdminAuth();
    const [strategies, setStrategies] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchAllStrategies(token).then((res) => setStrategies(res.strategies)).catch((err) => setError(err.message));
    }, [token]);

    return (
        <div>
            <TopBar title="Strategies" subtitle="Every saved strategy across all users, newest first." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
                <Card>
                    {!strategies ? (
                        <div className="py-16 text-center text-xs text-gray-500">Loading…</div>
                    ) : strategies.length === 0 ? (
                        <div className="py-16 text-center text-xs text-gray-500">No strategies saved yet.</div>
                    ) : (
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr className="text-gray-600">
                                    <th className="pb-2 text-left font-medium">User</th>
                                    <th className="pb-2 text-left font-medium">Name</th>
                                    <th className="pb-2 text-left font-medium">Underlying</th>
                                    <th className="pb-2 text-right font-medium">Legs</th>
                                    <th className="pb-2 text-right font-medium">Saved</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {strategies.map((s) => (
                                    <tr key={s.id}>
                                        <td className="py-2">
                                            <div className="font-medium text-gray-200">{s.user_name}</div>
                                            <div className="text-gray-500">{s.user_email}</div>
                                        </td>
                                        <td className="py-2 text-gray-300">{s.name}</td>
                                        <td className="py-2 text-gray-400">{s.underlying}</td>
                                        <td className="py-2 text-right tabular-nums text-gray-400">{legCount(s.legs)}</td>
                                        <td className="py-2 text-right text-gray-500">{formatDateTime(s.created_at)}</td>
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
