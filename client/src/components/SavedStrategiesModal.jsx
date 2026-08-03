import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { listStrategies, deleteStrategy } from "../services/strategiesApi";

// Shared "Saved" list popover for Strategy Builder / Simulator — listing and
// deleting only require being logged in (not Pro; see strategiesController.js),
// matching the reference's "Saved" button. Creating new saves is still
// Pro-gated via SaveButton elsewhere.
export default function SavedStrategiesModal({ onClose, onLoad }) {
    const { user, token } = useAuth();
    const [strategies, setStrategies] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!user || !token) return;
        listStrategies(token)
            .then((res) => setStrategies(res.strategies || []))
            .catch((err) => setError(err.message));
    }, [user, token]);

    async function handleDelete(id) {
        try {
            await deleteStrategy(token, id);
            setStrategies((prev) => prev.filter((s) => s.id !== id));
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
            <div className="fixed left-1/2 top-1/2 z-50 w-[420px] max-h-[70vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <span className="text-sm font-bold text-gray-800">Saved Strategies</span>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
                </div>

                <div className="max-h-[55vh] overflow-y-auto p-2">
                    {!user && (
                        <div className="px-3 py-8 text-center text-xs text-gray-400">Log in to see your saved strategies.</div>
                    )}
                    {user && error && (
                        <div className="mx-2 my-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
                    )}
                    {user && strategies == null && !error && (
                        <div className="px-3 py-8 text-center text-xs text-gray-400">Loading…</div>
                    )}
                    {user && strategies && strategies.length === 0 && (
                        <div className="px-3 py-8 text-center text-xs text-gray-400">Nothing saved yet.</div>
                    )}
                    {user && strategies && strategies.length > 0 && (
                        <div className="divide-y divide-gray-100">
                            {strategies.map((s) => {
                                const legs = typeof s.legs === "string" ? JSON.parse(s.legs) : s.legs;
                                return (
                                    <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-50">
                                        <div className="min-w-0">
                                            <div className="truncate text-xs font-semibold text-gray-800">{s.name}</div>
                                            <div className="text-[10px] text-gray-400">
                                                {s.underlying} · {legs.length} leg{legs.length === 1 ? "" : "s"} · {new Date(s.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1.5">
                                            <button
                                                onClick={() => onLoad(legs, s.underlying)}
                                                className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                                            >
                                                Load
                                            </button>
                                            <button
                                                onClick={() => handleDelete(s.id)}
                                                className="rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-rose-50 hover:text-rose-600"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
