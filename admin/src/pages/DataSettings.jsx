// pages/DataSettings.jsx — Broker & API Secret Tokens Operations Command Center
// Manage access tokens, API keys, client secrets, and TOTP keys for Upstox, Angel One,
// Dhan v2, Kotak Neo, and ICICI Breeze directly from the Admin Panel.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    FiCheckCircle,
    FiAlertTriangle,
    FiEdit2,
    FiCopy,
    FiEye,
    FiEyeOff,
    FiSearch,
    FiCheck,
    FiExternalLink,
    FiRefreshCw,
    FiLock,
} from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchEnvStatus, updateEnvValue } from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";

const PROVIDER_METADATA = {
    upstox: {
        title: "Upstox API",
        subtitle: "Real-time market feeds & recent-window historical option data",
        tag: "Real-Time / 1-Min Replay",
        color: "from-blue-600 to-indigo-700",
        border: "border-blue-500/30",
        badgeBg: "bg-blue-500/10 text-blue-300 border-blue-500/30",
        icon: "⚡",
        portalUrl: "https://service.upstox.com/developer/apps",
        portalLabel: "Upstox Developer Apps",
        guide: "Generate API Key & Secret on Upstox portal. Access tokens can be generated daily or refreshed automatically.",
    },
    angelone: {
        title: "Angel One SmartAPI",
        subtitle: "Live feed quotes, historical catch-up & TOTP-authenticated broker engine",
        tag: "Live Quotes / TOTP",
        color: "from-indigo-600 to-violet-700",
        border: "border-indigo-500/30",
        badgeBg: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
        icon: "🛡️",
        portalUrl: "https://smartapi.angelone.in/",
        portalLabel: "SmartAPI Dashboard",
        guide: "Requires API Key, Client Code, MPIN/Password, and Authenticator TOTP Secret for automated token generation.",
    },
    dhan: {
        title: "Dhan API v2",
        subtitle: "Primary 2023+ minute option chain, equity index/VIX & daily futures",
        tag: "Primary Historical Source",
        color: "from-teal-600 to-emerald-700",
        border: "border-teal-500/30",
        badgeBg: "bg-teal-500/10 text-teal-300 border-teal-500/30",
        icon: "📊",
        portalUrl: "https://web.dhan.co/",
        portalLabel: "Dhan Access Portal",
        guide: "Client ID + 30-day Long-Lived Access Token. Generates deep historical option chain snapshots from 2023 onward.",
    },
    kotak: {
        title: "Kotak Neo API",
        subtitle: "Secondary live quotes and single snapshot pipeline validator",
        tag: "Secondary Live Quote",
        color: "from-rose-600 to-pink-700",
        border: "border-rose-500/30",
        badgeBg: "bg-rose-500/10 text-rose-300 border-rose-500/30",
        icon: "🏦",
        portalUrl: "https://www.kotaksecurities.com/",
        portalLabel: "Kotak Neo Portal",
        guide: "Consumer Key & Secret from Kotak Neo API manager with registered mobile number and password.",
    },
    icici_breeze: {
        title: "ICICI Breeze API",
        subtitle: "Deep multi-year historical option chain archives & Bhavcopy resolver",
        tag: "Deep 2023+ Archive",
        color: "from-amber-600 to-orange-700",
        border: "border-amber-500/30",
        badgeBg: "bg-amber-500/10 text-amber-300 border-amber-500/30",
        icon: "🏛️",
        portalUrl: "https://api.icicidirect.com/apiuser/home",
        portalLabel: "ICICI Developer Console",
        guide: "App Key + Secret Key. Note: Session token expires daily and requires manual refresh via login URL when running Breeze pipelines.",
    },
};

function KeyRow({ item, onSave }) {
    const [editing, setEditing] = useState(false);
    const [revealed, setRevealed] = useState(false);
    const [value, setValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState(null);
    const [savedNote, setSavedNote] = useState(null);

    async function submit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const result = await onSave(item.key, value);
            setEditing(false);
            setValue("");
            setSavedNote(result.restartNote || `Updated in ${result.updatedFiles} env file${result.updatedFiles === 1 ? "" : "s"}`);
            setTimeout(() => setSavedNote(null), 5000);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    function handleCopy(text) {
        if (!text || text === "not set") return;
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    const primaryPreview = item.files[0]?.preview || (item.isSet ? "••••••••••••••••" : "not set");

    return (
        <div className="rounded-xl border border-white/5 bg-[#12121a]/80 p-3.5 transition-all hover:border-white/10 hover:bg-[#151520]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-gray-100">{item.key}</span>
                        <span className="text-xs text-gray-400 font-medium">— {item.label}</span>
                        {!item.inSync && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                                <FiAlertTriangle className="h-3 w-3" /> Out of sync
                            </span>
                        )}
                    </div>

                    {/* Value preview & File Sync Badges */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1 font-mono text-[11px]">
                            <FiLock className="h-3 w-3 text-gray-500" />
                            {item.isSet ? (
                                <span className="text-gray-200">
                                    {revealed ? primaryPreview : "••••••••••••••••"}
                                </span>
                            ) : (
                                <span className="font-semibold text-rose-400">NOT CONFIGURED</span>
                            )}
                            {item.isSet && (
                                <button
                                    onClick={() => setRevealed((v) => !v)}
                                    className="ml-1 text-gray-400 hover:text-gray-200"
                                    title={revealed ? "Mask secret" : "Reveal preview"}
                                >
                                    {revealed ? <FiEyeOff size={13} /> : <FiEye size={13} />}
                                </button>
                            )}
                        </div>

                        {item.files.map((f) => (
                            <span
                                key={f.file}
                                className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                    f.isSet
                                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                                        : "border-rose-500/20 bg-rose-500/10 text-rose-400"
                                }`}
                            >
                                {f.file}: {f.isSet ? "SET" : "EMPTY"}
                            </span>
                        ))}
                    </div>

                    {item.restartNote && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                            <span>ℹ️</span> {item.restartNote}
                        </div>
                    )}
                </div>

                {/* Right Action Buttons */}
                <div className="flex shrink-0 items-center gap-2">
                    {item.isSet && primaryPreview && primaryPreview !== "not set" && (
                        <button
                            onClick={() => handleCopy(primaryPreview)}
                            className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-gray-300 hover:bg-white/10 transition"
                            title="Copy masked preview"
                        >
                            {copied ? <FiCheck className="h-3.5 w-3.5 text-emerald-400" /> : <FiCopy className="h-3.5 w-3.5" />}
                            <span>{copied ? "Copied" : "Copy"}</span>
                        </button>
                    )}

                    <button
                        onClick={() => { setEditing((v) => !v); setError(null); }}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shadow-xs transition ${
                            editing
                                ? "border border-violet-500 bg-violet-600 text-white"
                                : item.isSet
                                ? "border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10 hover:border-violet-500"
                                : "border border-rose-500/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
                        }`}
                    >
                        <FiEdit2 className="h-3.5 w-3.5" />
                        <span>{editing ? "Cancel" : item.isSet ? "Update" : "Set Value"}</span>
                    </button>
                </div>
            </div>

            {/* Quick Edit Input Form */}
            {editing && (
                <form onSubmit={submit} className="mt-3 border-t border-white/5 pt-3 animate-in fade-in duration-150">
                    <div className="text-[11px] text-gray-400 mb-1.5 font-semibold">
                        Enter new value for <code className="text-violet-300 font-mono">{item.key}</code>:
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                            autoFocus
                            type="text"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={`Paste or type new ${item.key} here…`}
                            className="flex-1 rounded-xl border border-violet-500/40 bg-black/50 px-3.5 py-2 font-mono text-xs text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setEditing(false)}
                                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-400 hover:bg-white/10 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving || !value.trim()}
                                className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-bold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 shadow-md shadow-violet-600/20 transition"
                            >
                                {saving ? "Saving…" : "Save & Update .env"}
                            </button>
                        </div>
                    </div>
                </form>
            )}

            {error && (
                <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 font-medium">
                    {error}
                </div>
            )}
            {savedNote && (
                <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 font-medium">
                    ✓ Saved successfully — {savedNote}
                </div>
            )}
        </div>
    );
}

export default function DataSettings() {
    const { token } = useAdminAuth();
    const [sources, setSources] = useState(null);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(() => {
        setRefreshing(true);
        fetchEnvStatus(token)
            .then((r) => setSources(r.sources))
            .catch((err) => setError(err.message))
            .finally(() => setRefreshing(false));
    }, [token]);

    useEffect(load, [load]);

    async function handleSave(key, value) {
        const result = await updateEnvValue(token, key, value);
        load();
        return result;
    }

    // Computed Stats
    const stats = useMemo(() => {
        if (!sources) return { totalProviders: 0, totalKeys: 0, configuredKeys: 0, missingKeys: 0 };
        const providerKeys = Object.keys(sources);
        let total = 0;
        let configured = 0;
        Object.values(sources).forEach((items) => {
            items.forEach((item) => {
                total++;
                if (item.isSet) configured++;
            });
        });
        return {
            totalProviders: providerKeys.length,
            totalKeys: total,
            configuredKeys: configured,
            missingKeys: total - configured,
        };
    }, [sources]);

    // Filtered by Search Query
    const filteredSources = useMemo(() => {
        if (!sources) return null;
        if (!searchQuery.trim()) return sources;
        const q = searchQuery.toLowerCase();
        const res = {};
        Object.entries(sources).forEach(([srcKey, items]) => {
            const matchesProvider = srcKey.toLowerCase().includes(q) || PROVIDER_METADATA[srcKey]?.title.toLowerCase().includes(q);
            const matchingItems = items.filter(
                (item) =>
                    item.key.toLowerCase().includes(q) ||
                    item.label.toLowerCase().includes(q) ||
                    matchesProvider
            );
            if (matchingItems.length > 0) {
                res[srcKey] = matchingItems;
            }
        });
        return res;
    }, [sources, searchQuery]);

    return (
        <div className="min-h-screen bg-[#0b0b0f] text-gray-200">
            {/* Unified Data Nav Header */}
            <DataNavHeader
                title="Broker Credentials & API Secret Tokens"
                subtitle="Live status, secret management, and 1-click updates for Upstox, Angel One, Dhan, Kotak, and ICICI Breeze .env files."
            />

            <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
                {/* 1. TOP SUMMARY STATS DOCK */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                    <div className="rounded-2xl border border-white/10 bg-[#12121a] p-4 shadow-xs">
                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Configured Providers</div>
                        <div className="mt-1 text-2xl font-black text-white">{stats.totalProviders}</div>
                        <div className="mt-0.5 text-[11px] text-gray-500">Active broker integrations</div>
                    </div>

                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-xs">
                        <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Active Keys</div>
                        <div className="mt-1 text-2xl font-black text-emerald-300">{stats.configuredKeys}</div>
                        <div className="mt-0.5 text-[11px] text-emerald-400/70">Properly set in .env</div>
                    </div>

                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 shadow-xs">
                        <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">Missing Keys</div>
                        <div className="mt-1 text-2xl font-black text-rose-300">{stats.missingKeys}</div>
                        <div className="mt-0.5 text-[11px] text-rose-400/70">Needs admin setup</div>
                    </div>

                    <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 shadow-xs flex flex-col justify-between">
                        <div>
                            <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">Status Sync</div>
                            <div className="mt-1 text-xs font-bold text-violet-300 flex items-center gap-1.5">
                                <FiCheckCircle className="h-4 w-4 text-violet-400" />
                                <span>Multi-file Synchronized</span>
                            </div>
                        </div>
                        <button
                            onClick={load}
                            disabled={refreshing}
                            className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-500/20 px-3 py-1 text-xs font-bold text-violet-200 hover:bg-violet-500/30 transition disabled:opacity-50"
                        >
                            <FiRefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
                            <span>{refreshing ? "Checking…" : "Reload Status"}</span>
                        </button>
                    </div>
                </div>

                {/* 2. SEARCH & FILTER BAR */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                        <FiSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={15} />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search API keys, secrets, or brokers (e.g. UPSTOX, TOTP, DHAN)…"
                            className="w-full rounded-xl border border-white/10 bg-[#12121a] py-2 pl-9 pr-3 text-xs text-white placeholder-gray-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition"
                        />
                    </div>

                    <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>Protected file write: updates both <code className="text-gray-300">.env</code> & <code className="text-gray-300">data-downloader/.env</code></span>
                    </div>
                </div>

                {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300 font-medium">
                        {error}
                    </div>
                )}

                {/* 3. PROVIDER CARDS MATRIX */}
                {!sources ? (
                    <div className="py-20 text-center text-xs font-medium text-gray-500 animate-pulse">
                        Inspecting environment files & API tokens…
                    </div>
                ) : filteredSources && Object.keys(filteredSources).length === 0 ? (
                    <div className="py-16 text-center text-xs text-gray-400">
                        No credentials matching &quot;{searchQuery}&quot;.
                    </div>
                ) : (
                    <div className="space-y-5">
                        {Object.entries(filteredSources).map(([sourceKey, items]) => {
                            const meta = PROVIDER_METADATA[sourceKey] || {
                                title: sourceKey.toUpperCase(),
                                subtitle: "Broker Integration",
                                tag: "Broker",
                                color: "from-gray-700 to-gray-800",
                                border: "border-white/10",
                                badgeBg: "bg-white/10 text-gray-300",
                                icon: "🔑",
                            };

                            const configuredCount = items.filter((i) => i.isSet).length;
                            const isFullyConfigured = configuredCount === items.length;

                            return (
                                <div
                                    key={sourceKey}
                                    className={`rounded-2xl border ${meta.border} bg-[#0e0e16] p-4 sm:p-5 shadow-lg transition-all`}
                                >
                                    {/* Provider Header Banner */}
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/5 pb-4 mb-4">
                                        <div className="flex items-start gap-3">
                                            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${meta.color} text-xl shadow-md`}>
                                                {meta.icon}
                                            </div>
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h2 className="text-base font-black text-white">{meta.title}</h2>
                                                    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-tight ${meta.badgeBg}`}>
                                                        {meta.tag}
                                                    </span>
                                                    <span
                                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                                            isFullyConfigured
                                                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                                                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                                        }`}
                                                    >
                                                        {configuredCount}/{items.length} Configured
                                                    </span>
                                                </div>
                                                <p className="text-xs text-gray-400 mt-1">{meta.subtitle}</p>
                                                {meta.guide && <p className="text-[11px] text-gray-500 mt-0.5">{meta.guide}</p>}
                                            </div>
                                        </div>

                                        {meta.portalUrl && (
                                            <a
                                                href={meta.portalUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-violet-500/50 hover:bg-white/10 hover:text-white transition"
                                            >
                                                <span>{meta.portalLabel}</span>
                                                <FiExternalLink size={13} />
                                            </a>
                                        )}
                                    </div>

                                    {/* Provider Keys Grid */}
                                    <div className="space-y-2.5">
                                        {items.map((item) => (
                                            <KeyRow key={item.key} item={item} onSave={handleSave} />
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
