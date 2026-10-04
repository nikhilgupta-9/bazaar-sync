import React, { useEffect, useMemo, useState } from "react";
// pages/Events.jsx — Premier Trading Events, Webinars & Derivatives Expiry Calendar
// Fully responsive across Mobile, Tablet, and Desktop with Dark/Light theme,
// live event status indicators, calendar reminder generator, and index expiry schedule.

import { fetchEvents } from "../services/eventsApi";
import {
    FiCalendar,
    FiClock,
    FiExternalLink,
    FiVideo,
    FiSearch,
    FiTag,
    FiUsers,
    FiArrowRight,
    FiCheckCircle,
    FiPlayCircle,
    FiShare2,
    FiTrendingUp,
    FiBookmark,
    FiPlus,
} from "react-icons/fi";
import { FaYoutube, FaTelegram } from "react-icons/fa6";
import PageShell from "../components/PageShell";

function parseDate(dateStr) {
    if (!dateStr) return new Date();
    // Handle YYYY-MM-DD or ISO
    const cleanStr = String(dateStr).split("T")[0];
    const [y, m, d] = cleanStr.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

function formatDateBadge(dateStr) {
    const d = parseDate(dateStr);
    const month = d.toLocaleString("en-IN", { month: "short" }).toUpperCase();
    const day = d.getDate();
    const weekday = d.toLocaleString("en-IN", { weekday: "short" });
    const year = d.getFullYear();
    return { month, day, weekday, year };
}

function formatFullDate(dateStr) {
    const d = parseDate(dateStr);
    return d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

function formatTime(timeStr) {
    if (!timeStr) return "7:00 PM IST";
    const parts = timeStr.split(":");
    const h = Number(parts[0]);
    const m = Number(parts[1] || 0);
    const period = h >= 12 ? "PM" : "AM";
    const displayH = h % 12 || 12;
    const displayM = m < 10 ? `0${m}` : m;
    return `${displayH}:${displayM} ${period} IST`;
}

function getEventStatus(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = parseDate(dateStr);
    eventDate.setHours(0, 0, 0, 0);

    const diffDays = Math.round((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return { label: "Live Today", type: "live" };
    if (diffDays > 0 && diffDays <= 7) return { label: `In ${diffDays} Days`, type: "soon" };
    if (diffDays > 7) return { label: "Upcoming", type: "upcoming" };
    return { label: "Completed", type: "past" };
}

function createGoogleCalendarLink(ev) {
    const title = encodeURIComponent(ev.title || "Bazaar Sync Trading Webinar");
    const details = encodeURIComponent(`${ev.description || ""}\n\nPlatform: Bazaar Sync (https://bazaarsync.com)`);
    const d = parseDate(ev.event_date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    let startHour = "19";
    let startMin = "30";
    if (ev.event_time) {
        const parts = ev.event_time.split(":");
        startHour = String(parts[0]).padStart(2, "0");
        startMin = String(parts[1] || "00").padStart(2, "0");
    }

    const endHour = String((Number(startHour) + 1) % 24).padStart(2, "0");
    const dates = `${yyyy}${mm}${dd}T${startHour}${startMin}00/${yyyy}${mm}${dd}T${endHour}${startMin}00`;

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&location=Online+Live+Stream`;
}

const WEEKLY_EXPIRIES = [
    { symbol: "FINNIFTY", day: "Tuesday", exchange: "NSE", type: "Weekly F&O", color: "text-purple-600 bg-purple-500/10 border-purple-500/20" },
    { symbol: "BANKNIFTY", day: "Wednesday", exchange: "NSE", type: "Monthly / Weekly", color: "text-blue-600 bg-blue-500/10 border-blue-500/20" },
    { symbol: "NIFTY 50", day: "Thursday", exchange: "NSE", type: "Weekly F&O (Key Benchmark)", color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
    { symbol: "SENSEX", day: "Friday", exchange: "BSE", type: "Weekly F&O", color: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
    { symbol: "MIDCPNIFTY", day: "Monday", exchange: "NSE", type: "Weekly F&O", color: "text-teal-600 bg-teal-500/10 border-teal-500/20" },
    { symbol: "BANKEX", day: "Monday", exchange: "BSE", type: "Weekly F&O", color: "text-rose-600 bg-rose-500/10 border-rose-500/20" },
];

export default function Events() {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState("all"); // 'all' | 'upcoming' | 'past'
    const [searchQuery, setSearchQuery] = useState("");
    const [copiedId, setCopiedId] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetchEvents()
            .then((res) => {
                if (isMounted) setEvents(res.events || []);
            })
            .catch((err) => {
                if (isMounted) setError(err.message);
            })
            .finally(() => {
                if (isMounted) setLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, []);

    // Filter & Search Logic
    const filteredEvents = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return events.filter((ev) => {
            const evDate = parseDate(ev.event_date);
            evDate.setHours(0, 0, 0, 0);

            const isUpcoming = evDate.getTime() >= today.getTime();

            if (filter === "upcoming" && !isUpcoming) return false;
            if (filter === "past" && isUpcoming) return false;

            if (searchQuery.trim()) {
                const query = searchQuery.toLowerCase();
                const matchTitle = (ev.title || "").toLowerCase().includes(query);
                const matchDesc = (ev.description || "").toLowerCase().includes(query);
                if (!matchTitle && !matchDesc) return false;
            }

            return true;
        });
    }, [events, filter, searchQuery]);

    // Featured Next Event
    const featuredEvent = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return events.find((ev) => {
            const evDate = parseDate(ev.event_date);
            evDate.setHours(0, 0, 0, 0);
            return evDate.getTime() >= today.getTime();
        });
    }, [events]);

    function handleShare(ev) {
        if (navigator.share) {
            navigator.share({
                title: ev.title,
                text: `${ev.title} on Bazaar Sync - ${formatFullDate(ev.event_date)}`,
                url: window.location.href,
            }).catch(() => {});
        } else {
            navigator.clipboard.writeText(`${ev.title} - ${formatFullDate(ev.event_date)} at ${window.location.href}`);
            setCopiedId(ev.id);
            setTimeout(() => setCopiedId(null), 2000);
        }
    }

    return (
        <PageShell className="max-w-6xl">
            {/* Header Area */}
            <div className="border-b border-gray-200 pb-8 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <FiVideo size={13} /> Live Masterclasses &amp; Workshops
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        <FiTrendingUp size={13} /> F&amp;O Derivatives Strategy
                    </span>
                </div>

                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                        <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
                            Events &amp; Market Expiry Hub
                        </h1>
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-2xl leading-relaxed">
                            Join live backtesting masterclasses, options trading strategy workshops, and access Indian market expiry calendars designed for serious traders.
                        </p>
                    </div>

                    {/* Quick Stats / Community Pill */}
                    <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-xs dark:border-gray-800 dark:bg-gray-900 shrink-0">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <FiUsers size={18} />
                        </div>
                        <div className="pr-2">
                            <div className="text-xs font-bold text-gray-900 dark:text-white">100% Free Workshops</div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">Interactive live Q&amp;A</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Featured Event Hero Banner */}
            {featuredEvent && (
                <div className="mt-8 relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent p-6 sm:p-8 dark:border-emerald-500/20 dark:from-emerald-950/40 dark:via-teal-950/20">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="space-y-3 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-white animate-pulse">
                                    Next Upcoming Live Event
                                </span>
                                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                                    {formatFullDate(featuredEvent.event_date)} • {formatTime(featuredEvent.event_time)}
                                </span>
                            </div>
                            <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white leading-snug">
                                {featuredEvent.title}
                            </h2>
                            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 max-w-3xl leading-relaxed">
                                {featuredEvent.description}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 pt-2">
                                <a
                                    href={featuredEvent.link || "https://zoom.us"}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-700 transition active:scale-95"
                                >
                                    <FiVideo size={15} />
                                    <span>Join Session / Register</span>
                                    <FiExternalLink size={13} />
                                </a>
                                <a
                                    href={createGoogleCalendarLink(featuredEvent)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition"
                                >
                                    <FiCalendar size={14} className="text-emerald-500" />
                                    <span>Add to Calendar</span>
                                </a>
                            </div>
                        </div>

                        {/* Date Big Box */}
                        <div className="hidden sm:flex lg:flex flex-col items-center justify-center rounded-2xl border border-emerald-500/30 bg-white/80 dark:bg-gray-900/80 p-5 shadow-sm text-center min-w-[130px] shrink-0">
                            {(() => {
                                const { month, day, weekday } = formatDateBadge(featuredEvent.event_date);
                                return (
                                    <>
                                        <span className="text-[11px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                            {month}
                                        </span>
                                        <span className="text-4xl font-black text-gray-900 dark:text-white my-0.5">
                                            {day}
                                        </span>
                                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                            {weekday}
                                        </span>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* Filter Tabs & Search Bar */}
            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                {/* Filter Pills */}
                <div className="flex items-center gap-1 rounded-2xl bg-gray-200/70 p-1 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700/50 overflow-x-auto">
                    {[
                        { key: "all", label: "All Sessions" },
                        { key: "upcoming", label: "Upcoming Live" },
                        { key: "past", label: "Past / Recordings" },
                    ].map((t) => (
                        <button
                            key={t.key}
                            type="button"
                            onClick={() => setFilter(t.key)}
                            className={`rounded-xl px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                                filter === t.key
                                    ? "bg-white text-emerald-600 shadow-xs dark:bg-gray-900 dark:text-emerald-400"
                                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Search Input */}
                <div className="relative w-full sm:w-72">
                    <FiSearch className="absolute left-3.5 top-2.5 text-gray-400" size={15} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search topics (e.g. Greeks, Nifty)..."
                        className="w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3.5 py-2 text-xs text-gray-900 placeholder-gray-400 shadow-xs focus:border-emerald-500 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
                    />
                </div>
            </div>

            {/* Main Content Layout Grid (Events List + Market Expiry Sidebar) */}
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left 2 Columns: Events Grid */}
                <div className="lg:col-span-2 space-y-4">
                    {error && (
                        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-medium text-rose-600 dark:text-rose-300">
                            Failed to load events: {error}
                        </div>
                    )}

                    {loading && (
                        <div className="space-y-4 py-8">
                            {[1, 2, 3].map((n) => (
                                <div key={n} className="h-36 rounded-2xl border border-gray-200 bg-white p-5 animate-pulse dark:border-gray-800 dark:bg-gray-900" />
                            ))}
                        </div>
                    )}

                    {!loading && filteredEvents.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center shadow-xs dark:border-gray-800 dark:bg-gray-900">
                            <FiCalendar size={32} className="mx-auto text-gray-400 mb-2" />
                            <div className="text-sm font-bold text-gray-900 dark:text-white">No events match your criteria</div>
                            <p className="text-xs text-gray-500 mt-1">Try changing your search term or switching to "All Sessions".</p>
                        </div>
                    )}

                    {!loading && filteredEvents.map((ev) => {
                        const { month, day, weekday, year } = formatDateBadge(ev.event_date);
                        const status = getEventStatus(ev.event_date);

                        return (
                            <div
                                key={ev.id}
                                className="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-5 shadow-xs transition duration-200 hover:border-emerald-500/50 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-emerald-500/40"
                            >
                                <div className="flex flex-col sm:flex-row items-start gap-4">
                                    {/* Date Badge */}
                                    <div className="flex sm:flex-col items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-center shrink-0 w-full sm:w-16 dark:border-gray-800 dark:bg-gray-800/80">
                                        <span className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400">
                                            {month}
                                        </span>
                                        <span className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white px-2 sm:px-0">
                                            {day}
                                        </span>
                                        <span className="text-[10px] font-semibold text-gray-400">
                                            {weekday}
                                        </span>
                                    </div>

                                    {/* Event Details */}
                                    <div className="flex-1 min-w-0 space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {status.type === "live" && (
                                                <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" /> Live Today
                                                </span>
                                            )}
                                            {status.type === "soon" && (
                                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                                    {status.label}
                                                </span>
                                            )}
                                            {status.type === "upcoming" && (
                                                <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                                                    Upcoming
                                                </span>
                                            )}
                                            {status.type === "past" && (
                                                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                                    Completed Archive
                                                </span>
                                            )}

                                            <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                                <FiClock size={12} /> {formatTime(ev.event_time)}
                                            </span>
                                        </div>

                                        <h3 className="text-base font-bold text-gray-900 dark:text-white leading-snug group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                                            {ev.title}
                                        </h3>

                                        {ev.description && (
                                            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">
                                                {ev.description}
                                            </p>
                                        )}

                                        {/* Action Bar */}
                                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-gray-800/80">
                                            <div className="flex items-center gap-2">
                                                {ev.link ? (
                                                    <a
                                                        href={ev.link}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 px-3 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 transition"
                                                    >
                                                        {status.type === "past" ? <FiPlayCircle size={13} /> : <FiVideo size={13} />}
                                                        <span>{status.type === "past" ? "Watch Recording" : "Join Webinar"}</span>
                                                        <FiExternalLink size={11} />
                                                    </a>
                                                ) : (
                                                    <span className="text-xs font-semibold text-gray-400">
                                                        Stream link available on event day
                                                    </span>
                                                )}

                                                {status.type !== "past" && (
                                                    <a
                                                        href={createGoogleCalendarLink(ev)}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        title="Add to Google Calendar"
                                                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 px-2.5 py-1.5 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-750 transition"
                                                    >
                                                        <FiCalendar size={12} className="text-emerald-500" />
                                                        <span className="hidden sm:inline">Remind Me</span>
                                                    </a>
                                                )}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => handleShare(ev)}
                                                className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition"
                                            >
                                                <FiShare2 size={12} />
                                                <span>{copiedId === ev.id ? "Link Copied!" : "Share"}</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Right 1 Column: NSE / BSE Expiry Calendar Schedule & Host Workshop CTA */}
                <div className="space-y-6">
                    {/* Weekly Expiry Schedule Card */}
                    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                                    <FiCalendar size={16} />
                                </div>
                                <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                                    Indian Indices Expiry Days
                                </h3>
                            </div>
                            <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                                NSE / BSE
                            </span>
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                            Standard derivatives contracts expiry cycle for major underlying indices in India:
                        </p>

                        <div className="space-y-2">
                            {WEEKLY_EXPIRIES.map((item) => (
                                <div
                                    key={item.symbol}
                                    className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/70 p-2.5 dark:border-gray-800 dark:bg-gray-800/40"
                                >
                                    <div className="flex items-center gap-2">
                                        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-black ${item.color}`}>
                                            {item.symbol}
                                        </span>
                                        <span className="text-xs font-bold text-gray-900 dark:text-white">
                                            {item.day}
                                        </span>
                                    </div>
                                    <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                                        {item.type}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Community & Masterclass Host Banner */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent p-5 dark:border-emerald-500/15 dark:bg-emerald-950/20 space-y-3">
                        <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
                            <FiUsers size={16} />
                            <span>Algorithmic Traders &amp; Institutes</span>
                        </div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                            Host a Trading Workshop with Us
                        </h4>
                        <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                            Are you a financial educator, quantitative analyst, or trading community leader? Partner with Bazaar Sync to host collaborative backtesting workshops.
                        </p>
                        <a
                            href="mailto:partners@bazaarsync.com?subject=Host%20a%20Trading%20Workshop"
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-sm hover:bg-emerald-700 transition"
                        >
                            <span>Propose a Session</span>
                            <FiArrowRight size={13} />
                        </a>
                    </div>
                </div>
            </div>
        </PageShell>
    );
}
