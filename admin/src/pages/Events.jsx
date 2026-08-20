import { useCallback, useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchAllEvents, createEvent, updateEvent, deleteEvent } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const EMPTY_FORM = { title: "", description: "", eventDate: "", eventTime: "", link: "" };

export default function Events() {
    const { token } = useAdminAuth();
    const [events, setEvents] = useState(null);
    const [error, setError] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(() => {
        fetchAllEvents(token).then((r) => setEvents(r.events)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleCreate(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await createEvent(token, { ...form, isPublished: true });
            setForm(EMPTY_FORM);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function togglePublished(ev) {
        try {
            await updateEvent(token, ev.id, {
                title: ev.title, description: ev.description, eventDate: ev.event_date,
                eventTime: ev.event_time, link: ev.link, isPublished: !ev.is_published,
            });
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDelete(id) {
        try {
            await deleteEvent(token, id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div>
            <TopBar title="Events" subtitle="Simple announcement/webinar listing — shown on the public /events page when published. No registration or ticketing." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="Create an event" className="mb-4">
                    <form onSubmit={handleCreate} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Title</label>
                            <input
                                required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Link (optional)</label>
                            <input
                                value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })}
                                placeholder="https://…"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Date</label>
                            <input
                                required type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Time (optional)</label>
                            <input
                                type="time" value={form.eventTime} onChange={(e) => setForm({ ...form, eventTime: e.target.value })}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Description</label>
                            <textarea
                                rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <button
                            type="submit" disabled={submitting}
                            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 sm:col-span-2 sm:w-fit"
                        >
                            {submitting ? "Creating…" : "Create event"}
                        </button>
                    </form>
                </Card>

                <Card title={`Events${events ? ` (${events.length})` : ""}`}>
                    {!events ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : events.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500">No events yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {events.map((ev) => (
                                <div key={ev.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm">
                                    <div>
                                        <div className="font-medium text-gray-200">{ev.title}</div>
                                        <div className="text-xs text-gray-500">{ev.event_date}{ev.event_time ? ` · ${ev.event_time}` : ""}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => togglePublished(ev)}
                                            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${ev.is_published ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-gray-500"}`}
                                        >
                                            {ev.is_published ? "Published" : "Draft"}
                                        </button>
                                        <button onClick={() => handleDelete(ev.id)} className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Delete">
                                            <FiTrash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
