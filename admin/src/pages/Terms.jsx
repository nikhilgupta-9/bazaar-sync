import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchContent, saveContent } from "../services/adminApi";
import { formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

export default function Terms() {
    const { token } = useAdminAuth();
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        fetchContent(token, "terms")
            .then((r) => { setTitle(r.title || ""); setContent(r.content || ""); setUpdatedAt(r.updated_at); })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [token]);

    useEffect(load, [load]);

    async function handleSave(e) {
        e.preventDefault();
        setError(null);
        setSaved(false);
        setSaving(true);
        try {
            await saveContent(token, "terms", { title, content });
            setSaved(true);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div>
            <TopBar title="T&C" subtitle="Plain-text editor for the Terms & Conditions shown on the public /terms page." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
                {saved && <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">Saved.</div>}

                <Card title="Edit content" action={updatedAt && <span className="text-[11px] text-gray-500">Last updated {formatDateTime(updatedAt)}</span>}>
                    {loading ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : (
                        <form onSubmit={handleSave} className="space-y-3">
                            <div>
                                <label className="mb-1 block text-xs font-medium text-gray-400">Page title</label>
                                <input
                                    value={title} onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Terms & Conditions"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-medium text-gray-400">Content (plain text)</label>
                                <textarea
                                    rows={18} value={content} onChange={(e) => setContent(e.target.value)}
                                    placeholder="Paste or write the Terms & Conditions text here…"
                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-xs text-white outline-none focus:border-violet-500"
                                />
                            </div>
                            <button
                                type="submit" disabled={saving}
                                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                            >
                                {saving ? "Saving…" : "Save"}
                            </button>
                        </form>
                    )}
                </Card>
            </div>
        </div>
    );
}
