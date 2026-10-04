import React, { useCallback, useEffect, useState } from "react";
// pages/SocialLinks.jsx — Admin Social Media & Footer Links Station
// Allows the admin to configure, enable/disable, test, and live-preview all social channels
// and copyright text rendered in the user-facing footer.

import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchContent, saveContent } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";
import {
    FaWhatsapp,
    FaTelegram,
    FaXTwitter,
    FaYoutube,
    FaInstagram,
    FaLinkedinIn,
    FaFacebookF,
    FaDiscord,
    FaGithub,
    FaThreads,
    FaRedditAlien,
    FaGlobe,
} from "react-icons/fa6";
import {
    FiCheck,
    FiExternalLink,
    FiRefreshCw,
    FiSave,
    FiPlus,
    FiTrash2,
    FiShare2,
    FiEye,
    FiLayers,
    FiCheckCircle,
} from "react-icons/fi";

const PRESET_CHANNELS = [
    {
        key: "x",
        label: "X (Twitter)",
        Icon: FaXTwitter,
        defaultUrl: "https://twitter.com",
        placeholder: "https://x.com/your_handle",
        color: "hover:text-sky-400 hover:border-sky-500/40",
    },
    {
        key: "youtube",
        label: "YouTube",
        Icon: FaYoutube,
        defaultUrl: "https://youtube.com",
        placeholder: "https://youtube.com/@your_channel",
        color: "hover:text-red-500 hover:border-red-500/40",
    },
    {
        key: "telegram",
        label: "Telegram Community",
        Icon: FaTelegram,
        defaultUrl: "https://t.me",
        placeholder: "https://t.me/your_group_or_channel",
        color: "hover:text-blue-400 hover:border-blue-500/40",
    },
    {
        key: "whatsapp",
        label: "WhatsApp Channel",
        Icon: FaWhatsapp,
        defaultUrl: "https://whatsapp.com",
        placeholder: "https://whatsapp.com/channel/your_channel_id",
        color: "hover:text-emerald-400 hover:border-emerald-500/40",
    },
    {
        key: "linkedin",
        label: "LinkedIn",
        Icon: FaLinkedinIn,
        defaultUrl: "https://linkedin.com",
        placeholder: "https://linkedin.com/company/your_company",
        color: "hover:text-blue-500 hover:border-blue-600/40",
    },
    {
        key: "instagram",
        label: "Instagram",
        Icon: FaInstagram,
        defaultUrl: "https://instagram.com",
        placeholder: "https://instagram.com/your_handle",
        color: "hover:text-pink-500 hover:border-pink-500/40",
    },
    {
        key: "facebook",
        label: "Facebook",
        Icon: FaFacebookF,
        defaultUrl: "https://facebook.com",
        placeholder: "https://facebook.com/your_page",
        color: "hover:text-blue-600 hover:border-blue-600/40",
    },
    {
        key: "discord",
        label: "Discord Community",
        Icon: FaDiscord,
        defaultUrl: "https://discord.gg",
        placeholder: "https://discord.gg/your_invite_code",
        color: "hover:text-indigo-400 hover:border-indigo-500/40",
    },
    {
        key: "github",
        label: "GitHub",
        Icon: FaGithub,
        defaultUrl: "https://github.com",
        placeholder: "https://github.com/your_org",
        color: "hover:text-gray-200 hover:border-gray-500/40",
    },
];

const ICON_MAP = {
    x: FaXTwitter,
    twitter: FaXTwitter,
    youtube: FaYoutube,
    telegram: FaTelegram,
    whatsapp: FaWhatsapp,
    linkedin: FaLinkedinIn,
    instagram: FaInstagram,
    facebook: FaFacebookF,
    discord: FaDiscord,
    github: FaGithub,
    threads: FaThreads,
    reddit: FaRedditAlien,
    website: FaGlobe,
    globe: FaGlobe,
};

const DEFAULT_LINKS_ARRAY = PRESET_CHANNELS.slice(0, 6).map((c) => ({
    key: c.key,
    label: c.label,
    href: c.defaultUrl,
    active: true,
}));

export default function SocialLinks() {
    const { token } = useAdminAuth();
    const [links, setLinks] = useState(DEFAULT_LINKS_ARRAY);
    const [copyrightText, setCopyrightText] = useState(
        `© ${new Date().getFullYear()} Bazaar Sync Technologies. All rights reserved.`
    );
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState(null);
    const [updatedAt, setUpdatedAt] = useState(null);

    // Custom link draft
    const [newCustomLabel, setNewCustomLabel] = useState("");
    const [newCustomUrl, setNewCustomUrl] = useState("");
    const [newCustomKey, setNewCustomKey] = useState("website");

    const loadData = useCallback(() => {
        setLoading(true);
        setError(null);
        fetchContent(token, "social-links")
            .then((res) => {
                if (res?.content) {
                    try {
                        const parsed = JSON.parse(res.content);
                        if (Array.isArray(parsed.links) && parsed.links.length > 0) {
                            setLinks(parsed.links);
                        }
                        if (parsed.copyrightText) {
                            setCopyrightText(parsed.copyrightText);
                        }
                    } catch (e) {
                        console.error("Could not parse social-links JSON", e);
                    }
                }
                setUpdatedAt(res?.updated_at || null);
            })
            .catch((err) => {
                setError(err.message || "Failed to load social links");
            })
            .finally(() => setLoading(false));
    }, [token]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    function handleToggle(key) {
        setLinks((prev) =>
            prev.map((item) =>
                item.key === key ? { ...item, active: !item.active } : item
            )
        );
        setSaved(false);
    }

    function handleUrlChange(key, value) {
        setLinks((prev) =>
            prev.map((item) =>
                item.key === key ? { ...item, href: value } : item
            )
        );
        setSaved(false);
    }

    function handleLabelChange(key, value) {
        setLinks((prev) =>
            prev.map((item) =>
                item.key === key ? { ...item, label: value } : item
            )
        );
        setSaved(false);
    }

    function handleAddPreset(preset) {
        if (links.some((l) => l.key === preset.key)) return;
        setLinks((prev) => [
            ...prev,
            {
                key: preset.key,
                label: preset.label,
                href: preset.defaultUrl,
                active: true,
            },
        ]);
        setSaved(false);
    }

    function handleRemove(key) {
        setLinks((prev) => prev.filter((item) => item.key !== key));
        setSaved(false);
    }

    function handleAddCustomLink(e) {
        e.preventDefault();
        const label = newCustomLabel.trim();
        const url = newCustomUrl.trim();
        if (!label || !url) return;

        const key = `${newCustomKey}_${Date.now()}`;
        setLinks((prev) => [
            ...prev,
            {
                key,
                label,
                href: url,
                active: true,
            },
        ]);
        setNewCustomLabel("");
        setNewCustomUrl("");
        setSaved(false);
    }

    function handleResetDefaults() {
        if (
            window.confirm(
                "Reset all social links to default configuration? You will still need to click Save Changes to persist."
            )
        ) {
            setLinks(DEFAULT_LINKS_ARRAY);
            setCopyrightText(
                `© ${new Date().getFullYear()} Bazaar Sync Technologies. All rights reserved.`
            );
            setSaved(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
            const payload = {
                title: "Footer & Social Media Links",
                content: JSON.stringify({
                    links,
                    copyrightText,
                    updatedAt: new Date().toISOString(),
                }),
            };
            await saveContent(token, "social-links", payload);
            setSaved(true);
            setUpdatedAt(new Date().toISOString());
            setTimeout(() => setSaved(false), 4000);
        } catch (err) {
            setError(err.message || "Failed to save social links");
        } finally {
            setSaving(false);
        }
    }

    const availablePresets = PRESET_CHANNELS.filter(
        (p) => !links.some((l) => l.key === p.key)
    );

    return (
        <div className="min-h-screen bg-[#07070a] text-gray-200">
            <TopBar
                title="Social Media & Footer Links"
                subtitle="Manage social media icons, community channels, and copyright text displayed in the client website footer."
            />

            <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
                {/* Header Action Bar */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#0e0e15] p-4 shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/15 border border-violet-500/30 text-violet-400">
                            <FiShare2 size={20} />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-white">
                                Live Footer Links Configuration
                            </div>
                            <div className="text-xs text-gray-400">
                                {updatedAt
                                    ? `Last updated: ${new Date(updatedAt).toLocaleString("en-IN")}`
                                    : "Default baseline active"}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2.5 w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={handleResetDefaults}
                            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition cursor-pointer"
                        >
                            <FiRefreshCw size={13} />
                            <span>Reset Defaults</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={saving || loading}
                            className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-xs font-bold text-white hover:bg-violet-500 transition shadow-lg shadow-violet-600/20 disabled:opacity-50 cursor-pointer"
                        >
                            {saving ? (
                                <FiRefreshCw className="animate-spin" size={14} />
                            ) : saved ? (
                                <FiCheck size={14} className="text-emerald-300" />
                            ) : (
                                <FiSave size={14} />
                            )}
                            <span>{saving ? "Saving…" : saved ? "Saved Successfully!" : "Save Changes"}</span>
                        </button>
                    </div>
                </div>

                {/* Notifications */}
                {saved && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs font-bold text-emerald-400">
                        <FiCheckCircle size={16} />
                        <span>Changes saved! The public footer on the main website has been updated in real time.</span>
                    </div>
                )}
                {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-bold text-rose-400">
                        {error}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Left 2 Columns: Social Media Channels Editor */}
                    <div className="lg:col-span-2 space-y-6">
                        <Card
                            title="Active Social Channels"
                            action={
                                <span className="text-xs font-semibold text-gray-400">
                                    {links.filter((l) => l.active).length} of {links.length} Active
                                </span>
                            }
                        >
                            {loading ? (
                                <div className="py-12 text-center text-xs text-gray-500">
                                    <FiRefreshCw className="animate-spin mx-auto mb-2" size={20} />
                                    Loading social links…
                                </div>
                            ) : links.length === 0 ? (
                                <div className="py-8 text-center text-xs text-gray-500">
                                    No social links configured. Add channels from the preset selector below.
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {links.map((item) => {
                                        const Icon = ICON_MAP[item.key?.toLowerCase()] || FaGlobe;
                                        const presetInfo = PRESET_CHANNELS.find((p) => p.key === item.key);

                                        return (
                                            <div
                                                key={item.key}
                                                className={`rounded-xl border p-4 transition-all ${
                                                    item.active
                                                        ? "border-white/10 bg-[#14141d] shadow-xs"
                                                        : "border-white/5 bg-[#0e0e14] opacity-50"
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-3 mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-white">
                                                            <Icon size={16} />
                                                        </div>
                                                        <div>
                                                            <div className="text-xs font-bold text-white flex items-center gap-2">
                                                                <span>{item.label}</span>
                                                                <span
                                                                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider ${
                                                                        item.active
                                                                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                                                            : "bg-gray-800 text-gray-400"
                                                                    }`}
                                                                >
                                                                    {item.active ? "Visible" : "Hidden"}
                                                                </span>
                                                            </div>
                                                            <div className="text-[10px] text-gray-400">
                                                                Key: <code className="text-violet-300">{item.key}</code>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Actions: Toggle & Remove */}
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggle(item.key)}
                                                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                                                                item.active ? "bg-violet-600" : "bg-gray-700"
                                                            }`}
                                                            title={item.active ? "Disable link" : "Enable link"}
                                                        >
                                                            <span
                                                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                                                    item.active ? "translate-x-4" : "translate-x-0"
                                                                }`}
                                                            />
                                                        </button>

                                                        {item.href && (
                                                            <a
                                                                href={item.href}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                title="Test Link in new tab"
                                                                className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white transition"
                                                            >
                                                                <FiExternalLink size={14} />
                                                            </a>
                                                        )}

                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemove(item.key)}
                                                            title="Remove link from list"
                                                            className="rounded-lg p-1.5 text-gray-400 hover:bg-rose-500/20 hover:text-rose-400 transition cursor-pointer"
                                                        >
                                                            <FiTrash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Input Fields */}
                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                                            Display Label
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={item.label || ""}
                                                            onChange={(e) => handleLabelChange(item.key, e.target.value)}
                                                            className="w-full rounded-lg border border-white/10 bg-[#09090d] px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none"
                                                        />
                                                    </div>

                                                    <div className="sm:col-span-2">
                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                                            Destination URL
                                                        </label>
                                                        <input
                                                            type="url"
                                                            value={item.href || ""}
                                                            onChange={(e) => handleUrlChange(item.key, e.target.value)}
                                                            placeholder={presetInfo?.placeholder || "https://..."}
                                                            className="w-full rounded-lg border border-white/10 bg-[#09090d] px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none font-mono"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </Card>

                        {/* Add More Preset Channels */}
                        {availablePresets.length > 0 && (
                            <Card title="Add More Preset Social Channels">
                                <p className="text-xs text-gray-400 mb-3">
                                    Click any channel below to add it directly to your active footer links.
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                    {availablePresets.map((preset) => {
                                        const Icon = preset.Icon;
                                        return (
                                            <button
                                                key={preset.key}
                                                type="button"
                                                onClick={() => handleAddPreset(preset)}
                                                className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#14141d] p-3 text-left hover:border-violet-500/50 hover:bg-violet-600/10 transition group cursor-pointer"
                                            >
                                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-gray-300 group-hover:text-violet-400">
                                                    <Icon size={16} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-xs font-bold text-white truncate">
                                                        {preset.label}
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 flex items-center gap-1 group-hover:text-violet-300">
                                                        <FiPlus size={10} /> Add
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </Card>
                        )}

                        {/* Custom Link Creator */}
                        <Card title="Add Custom Platform or Website Link">
                            <form onSubmit={handleAddCustomLink} className="space-y-3">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                            Platform Icon
                                        </label>
                                        <select
                                            value={newCustomKey}
                                            onChange={(e) => setNewCustomKey(e.target.value)}
                                            className="w-full rounded-lg border border-white/10 bg-[#09090d] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                                        >
                                            <option value="website">🌐 General Website / Link</option>
                                            <option value="threads">🧵 Threads</option>
                                            <option value="reddit">🤖 Reddit</option>
                                            <option value="discord">💬 Discord</option>
                                            <option value="facebook">📘 Facebook</option>
                                            <option value="github">🐙 GitHub</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                            Label / Title
                                        </label>
                                        <input
                                            type="text"
                                            value={newCustomLabel}
                                            onChange={(e) => setNewCustomLabel(e.target.value)}
                                            placeholder="e.g. Substack Blog"
                                            className="w-full rounded-lg border border-white/10 bg-[#09090d] px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                            URL Link
                                        </label>
                                        <input
                                            type="url"
                                            value={newCustomUrl}
                                            onChange={(e) => setNewCustomUrl(e.target.value)}
                                            placeholder="https://..."
                                            className="w-full rounded-lg border border-white/10 bg-[#09090d] px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end pt-1">
                                    <button
                                        type="submit"
                                        disabled={!newCustomLabel.trim() || !newCustomUrl.trim()}
                                        className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 transition disabled:opacity-40 cursor-pointer"
                                    >
                                        <FiPlus size={14} /> Add Custom Link
                                    </button>
                                </div>
                            </form>
                        </Card>
                    </div>

                    {/* Right Column: Live Footer Preview & Global Footer Settings */}
                    <div className="space-y-6">
                        {/* Live Preview Card */}
                        <Card
                            title="Live Footer Preview"
                            action={
                                <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                                    <FiEye size={11} /> Realtime
                                </div>
                            }
                        >
                            <p className="text-xs text-gray-400 mb-3">
                                This is an exact visual preview of the social media icons as they will appear at the bottom of the client website.
                            </p>

                            {/* Mock Footer Light / Dark Switcher Preview */}
                            <div className="rounded-2xl border border-white/10 bg-[#07070a] p-5 space-y-4">
                                <div className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                                    Client Footer Bar Simulation
                                </div>

                                {/* Simulated Icons Row */}
                                <div className="flex flex-wrap items-center gap-2.5 pt-1">
                                    {links
                                        .filter((s) => s.active && s.href)
                                        .map((s) => {
                                            const Icon = ICON_MAP[s.key?.toLowerCase()] || FaGlobe;
                                            return (
                                                <a
                                                    key={s.key}
                                                    href={s.href}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    title={s.label}
                                                    className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-800 bg-[#0e0e16] text-gray-300 hover:border-emerald-500 hover:text-emerald-400 transition"
                                                >
                                                    <Icon size={14} />
                                                </a>
                                            );
                                        })}
                                </div>

                                {/* Simulated Copyright */}
                                <div className="pt-3 border-t border-white/5 text-[11px] text-gray-400 space-y-1">
                                    <div>{copyrightText}</div>
                                    <div className="text-[10px] text-gray-500">
                                        Designed &amp; Developed by{" "}
                                        <span className="text-gray-400">Nikhil Works</span>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {/* Copyright Text Editor */}
                        <Card title="Footer Copyright & Legal Text">
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                        Copyright Line
                                    </label>
                                    <input
                                        type="text"
                                        value={copyrightText}
                                        onChange={(e) => {
                                            setCopyrightText(e.target.value);
                                            setSaved(false);
                                        }}
                                        className="w-full rounded-lg border border-white/10 bg-[#09090d] px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none"
                                    />
                                </div>
                                <p className="text-[11px] text-gray-500 leading-relaxed">
                                    This text appears on the left side of the bottom footer bar across all pages.
                                </p>
                            </div>
                        </Card>

                        {/* Quick Tips */}
                        <div className="rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 text-xs text-violet-300 space-y-2">
                            <div className="font-bold flex items-center gap-1.5 text-violet-200">
                                <FiLayers size={14} /> Admin Guidelines
                            </div>
                            <ul className="list-disc pl-4 space-y-1 text-[11px] text-violet-300/80">
                                <li>Toggle any channel off to hide it instantly from the public footer without deleting its URL.</li>
                                <li>Use the "Test" external icon to verify that links open to your intended profile.</li>
                                <li>Remember to click <strong>"Save Changes"</strong> to sync with the database.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
