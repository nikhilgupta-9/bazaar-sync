import { useCallback, useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchInstituteIps, addInstituteIp, removeInstituteIp } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

export default function InstituteAccess() {
    const { token } = useAdminAuth();
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);
    const [ipOrCidr, setIpOrCidr] = useState("");
    const [label, setLabel] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(() => {
        fetchInstituteIps(token).then((r) => setEntries(r.entries)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleAdd(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await addInstituteIp(token, { ipOrCidr, label });
            setIpOrCidr("");
            setLabel("");
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRemove(id) {
        try {
            await removeInstituteIp(token, id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div>
            <TopBar
                title="Institute Access"
                subtitle="A logged-in user connecting from an allowlisted IP or CIDR range gets Pro-equivalent access — their account tier is never changed, only requests from that network are let through."
            />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="Add an entry" className="mb-4">
                    <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
                        <div className="flex-1 min-w-[200px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">IP address or CIDR range</label>
                            <input
                                required value={ipOrCidr} onChange={(e) => setIpOrCidr(e.target.value)}
                                placeholder="203.0.113.5 or 203.0.113.0/24"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="flex-1 min-w-[160px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Label (optional)</label>
                            <input
                                value={label} onChange={(e) => setLabel(e.target.value)}
                                placeholder="e.g. ABC Institute"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <button
                            type="submit" disabled={submitting}
                            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                            {submitting ? "Adding…" : "Add"}
                        </button>
                    </form>
                </Card>

                <Card title={`Allowlisted entries${entries ? ` (${entries.length})` : ""}`}>
                    {!entries ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : entries.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500">No entries yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {entries.map((e) => (
                                <div key={e.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm">
                                    <div>
                                        <div className="font-mono font-medium text-gray-200">{e.ip_or_cidr}</div>
                                        <div className="text-xs text-gray-500">{e.label || "—"} · added by {e.created_by_name || "unknown"}</div>
                                    </div>
                                    <button onClick={() => handleRemove(e.id)} className="rounded-lg p-2 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Remove">
                                        <FiTrash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
