// pages/Events.jsx — public listing of admin-created events (see
// admin/src/pages/Events.jsx). Simple announcement/webinar list, no
// registration/ticketing.
import { useEffect, useState } from "react";
import { FiCalendar, FiClock, FiExternalLink } from "react-icons/fi";
import { fetchEvents } from "../services/eventsApi";

function formatDate(dateStr) {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(timeStr) {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(":");
    const d = new Date();
    d.setHours(Number(h), Number(m));
    return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export default function Events() {
    const [events, setEvents] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchEvents().then((r) => setEvents(r.events)).catch((err) => setError(err.message));
    }, []);

    return (
        <div className="mx-auto max-w-3xl px-6 py-12">
            <h1 className="text-2xl font-bold text-gray-900">Events</h1>
            <p className="mt-1 text-sm text-gray-500">Webinars and announcements from Bazaar Sync.</p>

            {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {!events && !error && <div className="mt-10 text-center text-sm text-gray-400">Loading…</div>}
            {events && events.length === 0 && (
                <div className="mt-10 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center text-sm text-gray-400">
                    No events scheduled right now — check back soon.
                </div>
            )}

            {events && events.length > 0 && (
                <div className="mt-8 space-y-3">
                    {events.map((ev) => (
                        <div key={ev.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                            <h2 className="text-base font-semibold text-gray-900">{ev.title}</h2>
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                                <span className="flex items-center gap-1"><FiCalendar className="h-3.5 w-3.5" /> {formatDate(ev.event_date)}</span>
                                {ev.event_time && <span className="flex items-center gap-1"><FiClock className="h-3.5 w-3.5" /> {formatTime(ev.event_time)}</span>}
                            </div>
                            {ev.description && <p className="mt-3 text-sm text-gray-600">{ev.description}</p>}
                            {ev.link && (
                                <a href={ev.link} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline">
                                    Learn more <FiExternalLink className="h-3.5 w-3.5" />
                                </a>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
