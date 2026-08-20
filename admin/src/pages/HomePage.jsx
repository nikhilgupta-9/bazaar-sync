// pages/HomePage.jsx — editor for the public Home page's copy and images
// (client/src/pages/Home.jsx). Saves one JSON blob to the 'home' slug of
// the existing generic site_content table (same table/pattern Terms.jsx
// already uses for T&C, see contentController.js) — Home.jsx fetches it and
// deep-merges over its own hardcoded defaults, so any field left blank here
// falls back to the original copy rather than rendering empty.
//
// The 6 tool cards (shown in both the pinned walkthrough and the feature
// carousel) are fixed to this app's real routes/tools.js — this editor can
// only override each one's title/description/image, never add a card
// pointing at a page that doesn't exist.
import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchContent, saveContent } from "../services/adminApi";
import { formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";
import ImageUploadField from "../components/ImageUploadField";

const TOOL_SLOTS = [
    { to: "/option-chain", label: "Option Chain" },
    { to: "/strategy-builder", label: "Strategy Builder" },
    { to: "/simulator", label: "Simulator" },
    { to: "/paper-trade", label: "Paper Trade" },
    { to: "/historical-chart", label: "Historical Chart" },
    { to: "/equity-data", label: "Equity Data" },
];

const EMPTY_HERO = { eyebrow: "", headline: "", headlineMuted: "", subtext: "", ctaLabel: "", ctaLink: "", image: null };
const EMPTY_ABOUT = { heading: "", paragraphs: ["", ""], image: null };

function emptyTools() {
    return Object.fromEntries(TOOL_SLOTS.map((t) => [t.to, { title: "", desc: "", image: null }]));
}

const inputClass =
    "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500";
const labelClass = "mb-1 block text-xs font-medium text-gray-400";

export default function HomePage() {
    const { token } = useAdminAuth();
    const [hero, setHero] = useState(EMPTY_HERO);
    const [about, setAbout] = useState(EMPTY_ABOUT);
    const [tools, setTools] = useState(emptyTools);
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        fetchContent(token, "home")
            .then((r) => {
                setUpdatedAt(r.updated_at);
                if (!r.content) return;
                try {
                    const parsed = JSON.parse(r.content);
                    setHero({ ...EMPTY_HERO, ...(parsed.hero || {}) });
                    setAbout({
                        ...EMPTY_ABOUT,
                        ...(parsed.about || {}),
                        paragraphs: Array.isArray(parsed.about?.paragraphs) && parsed.about.paragraphs.length
                            ? parsed.about.paragraphs
                            : EMPTY_ABOUT.paragraphs,
                    });
                    setTools({ ...emptyTools(), ...(parsed.tools || {}) });
                } catch {
                    /* corrupt/never-saved content — keep the empty form */
                }
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [token]);

    useEffect(load, [load]);

    function setToolField(to, field, value) {
        setTools((prev) => ({ ...prev, [to]: { ...prev[to], [field]: value } }));
    }
    function setParagraph(i, value) {
        setAbout((prev) => ({ ...prev, paragraphs: prev.paragraphs.map((p, idx) => (idx === i ? value : p)) }));
    }

    async function handleSave(e) {
        e.preventDefault();
        setError(null);
        setSaved(false);
        setSaving(true);
        try {
            await saveContent(token, "home", { title: null, content: JSON.stringify({ hero, about, tools }) });
            setSaved(true);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div>
                <TopBar title="Home Page" subtitle="Edit the public homepage's copy and images." />
                <div className="p-6"><div className="py-10 text-center text-xs text-gray-500">Loading…</div></div>
            </div>
        );
    }

    return (
        <div>
            <TopBar title="Home Page" subtitle="Edit the public homepage's hero, tool cards and about section. Blank fields keep the original copy." />
            <form onSubmit={handleSave} className="space-y-4 p-6">
                {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}
                {saved && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">Saved.</div>}

                <Card title="Hero section">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <label className={labelClass}>Eyebrow</label>
                            <input className={inputClass} placeholder="NSE Options Analytics" value={hero.eyebrow} onChange={(e) => setHero({ ...hero, eyebrow: e.target.value })} />
                        </div>
                        <div>
                            <label className={labelClass}>CTA button label</label>
                            <input className={inputClass} placeholder="Explore Option Chain" value={hero.ctaLabel} onChange={(e) => setHero({ ...hero, ctaLabel: e.target.value })} />
                        </div>
                        <div>
                            <label className={labelClass}>Headline (line 1)</label>
                            <input className={inputClass} placeholder="Build and backtest" value={hero.headline} onChange={(e) => setHero({ ...hero, headline: e.target.value })} />
                        </div>
                        <div>
                            <label className={labelClass}>Headline (line 2, muted)</label>
                            <input className={inputClass} placeholder="options strategies on real NSE data." value={hero.headlineMuted} onChange={(e) => setHero({ ...hero, headlineMuted: e.target.value })} />
                        </div>
                        <div className="sm:col-span-2">
                            <label className={labelClass}>Subtext</label>
                            <textarea rows={2} className={inputClass} placeholder="Live option chain, a multi-leg strategy builder…" value={hero.subtext} onChange={(e) => setHero({ ...hero, subtext: e.target.value })} />
                        </div>
                        <div>
                            <label className={labelClass}>CTA link</label>
                            <input className={inputClass} placeholder="/option-chain" value={hero.ctaLink} onChange={(e) => setHero({ ...hero, ctaLink: e.target.value })} />
                        </div>
                        <div className="sm:col-span-2">
                            <ImageUploadField label="Hero image (replaces the default mock dashboard graphic)" value={hero.image} onChange={(url) => setHero({ ...hero, image: url })} token={token} />
                        </div>
                    </div>
                </Card>

                <Card title="Tool cards" className="overflow-visible">
                    <div className="space-y-4">
                        {TOOL_SLOTS.map((slot) => (
                            <div key={slot.to} className="rounded-lg border border-white/10 p-3">
                                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-violet-400">{slot.label} <span className="font-normal normal-case text-gray-600">({slot.to})</span></div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className={labelClass}>Title override</label>
                                        <input className={inputClass} placeholder={slot.label} value={tools[slot.to]?.title || ""} onChange={(e) => setToolField(slot.to, "title", e.target.value)} />
                                    </div>
                                    <div>
                                        <label className={labelClass}>Description override</label>
                                        <input className={inputClass} value={tools[slot.to]?.desc || ""} onChange={(e) => setToolField(slot.to, "desc", e.target.value)} />
                                    </div>
                                    <div className="sm:col-span-2">
                                        <ImageUploadField label="Card image (replaces the default icon)" value={tools[slot.to]?.image} onChange={(url) => setToolField(slot.to, "image", url)} token={token} />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card title="About section">
                    <div className="space-y-3">
                        <div>
                            <label className={labelClass}>Heading</label>
                            <input className={inputClass} placeholder="About Bazaar Sync" value={about.heading} onChange={(e) => setAbout({ ...about, heading: e.target.value })} />
                        </div>
                        {about.paragraphs.map((p, i) => (
                            <div key={i}>
                                <label className={labelClass}>Paragraph {i + 1}</label>
                                <textarea rows={3} className={inputClass} value={p} onChange={(e) => setParagraph(i, e.target.value)} />
                            </div>
                        ))}
                        <ImageUploadField label="Banner image (shown above the heading)" value={about.image} onChange={(url) => setAbout({ ...about, image: url })} token={token} />
                    </div>
                </Card>

                <div className="flex items-center gap-3">
                    <button type="submit" disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                        {saving ? "Saving…" : "Save"}
                    </button>
                    {updatedAt && <span className="text-[11px] text-gray-500">Last updated {formatDateTime(updatedAt)}</span>}
                </div>
            </form>
        </div>
    );
}
