import { useCallback, useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchAllSeoMeta, upsertSeoMeta, deleteSeoMeta } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const EMPTY_FORM = { path: "", title: "", description: "", ogImage: "" };

export default function Seo() {
    const { token } = useAdminAuth();
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(() => {
        fetchAllSeoMeta(token).then((r) => setEntries(r.entries)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleSave(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await upsertSeoMeta(token, form);
            setForm(EMPTY_FORM);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDelete(id) {
        try {
            await deleteSeoMeta(token, id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div>
            <TopBar
                title="SEO Tool"
                subtitle="Per-page meta title/description/OG image, applied client-side on route change (client/src/hooks/usePageSeo.js). This is a client-rendered SPA with no server-side rendering, so this helps JS-executing crawlers (e.g. Googlebot) but isn't full SSR-grade SEO."
            />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="Add / update a page's meta tags" className="mb-4">
                    <form onSubmit={handleSave} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Path</label>
                            <input
                                required value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })}
                                placeholder="/pricing"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">OG image URL (optional)</label>
                            <input
                                value={form.ogImage} onChange={(e) => setForm({ ...form, ogImage: e.target.value })}
                                placeholder="https://…"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Title</label>
                            <input
                                value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Description</label>
                            <input
                                value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <button
                            type="submit" disabled={submitting}
                            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 sm:col-span-2 sm:w-fit"
                        >
                            {submitting ? "Saving…" : "Save"}
                        </button>
                    </form>
                </Card>

                <Card title={`Pages${entries ? ` (${entries.length})` : ""}`}>
                    {!entries ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : entries.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500">No pages configured yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {entries.map((s) => (
                                <div key={s.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm">
                                    <div>
                                        <div className="font-mono font-medium text-gray-200">{s.path}</div>
                                        <div className="text-xs text-gray-500">{s.title || "—"}</div>
                                    </div>
                                    <button onClick={() => handleDelete(s.id)} className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Delete">
                                        <FiTrash2 className="h-3.5 w-3.5" />
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
