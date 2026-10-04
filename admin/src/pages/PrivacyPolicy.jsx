import React, { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchContent, saveContent } from "../services/adminApi";
import { formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";
import MarkdownEditor from "../components/MarkdownEditor";
import { FiExternalLink, FiFileText, FiCheck, FiRefreshCw } from "react-icons/fi";

const DEFAULT_PRIVACY_TEMPLATE = `## 1. Introduction & Overview
Welcome to **Bazaar Sync** ("we", "our", or "us"). We are committed to safeguarding the personal, financial, and analytical data of traders, investors, and visitors who use our derivatives backtesting platform, website, and related financial software applications.

This Privacy Policy explains how we collect, process, store, and protect your information when you interact with **bazaarsync.com** and its associated services.

---

## 2. Information We Collect
We collect information strictly necessary to provide high-performance backtesting, paper trading, and options analytical services:

### A. Account & Profile Information
- **Personal Details:** Full name, email address, profile avatar.
- **Contact Details:** Phone number, city, state, postal code, country (if voluntarily provided for invoicing or account verification).
- **Trader Preferences:** Preferred trading style (Intraday, Positional, Scalping), primary indices (NIFTY, BANKNIFTY, SENSEX), capital range, default risk %, and preferred broker for analytical compatibility.

### B. Analytical & Usage Data
- Strategies saved in Strategy Builder, historical backtest logs, simulated paper trade orders, and watchlist configurations.
- Technical logs: IP address, device identifier, browser type, and active single-device session tokens.

### C. Authentication & Third-Party Logins
- If you authenticate via **Google OAuth / Google Identity Services (GIS)**, we receive your verified email, display name, and avatar URL provided by Google. We **never** have access to your Google account password.

---

## 3. How We Use Your Data
We utilize collected information to:
- Deliver real-time option chain data, tick replay, and automated Greek calculations.
- Maintain and synchronize paper trading wallets and virtual position ledgers.
- Enforce strict **Single-Device Session Security** to protect your subscription and account integrity.
- Process subscription payments via Razorpay (we never store your raw credit/debit card numbers or UPI PINs).
- Provide customer assistance and send essential transactional updates.

---

## 4. Financial & Trading Data Safeguards
- **No Demat / Broker Trading Access:** Bazaar Sync does **not** execute live orders in real demat accounts. We do not store broker trading PINs or sensitive 2FA passwords.
- **Data Encryption:** All data in transit is encrypted using industry-standard TLS 1.3/HTTPS encryption.
- **Session Tokens:** Authentication tokens are cryptographically signed with unique session IDs to prevent replay attacks and session theft.

---

## 5. Cookies & Local Storage
We use essential cookies and browser LocalStorage solely to:
- Maintain your signed-in state.
- Retain your UI preferences (Dark / Light theme, strike range selections).
- Cache lightweight option chain symbols and market parameters for latency reduction.

---

## 6. Sharing & Third-Party Disclosure
We do not sell, rent, or trade your personal data to third parties or marketing brokers. We only share information with trusted service providers under confidentiality agreements:
- **Payment Gateways:** Razorpay for secure Indian Rupee (INR) transaction processing.
- **Cloud Infrastructure:** Google Cloud Platform & AWS for server hosting and data backup pipelines.

---

## 7. Your Data Rights & Choices
You have full control over your personal data:
- **Access & Edit:** Update your profile, contact details, and trading parameters at any time via [/profile](/profile).
- **Account Deletion:** Request permanent erasure of your account, saved strategies, and paper trade history by contacting our support team.

---

## 8. Regulatory & Compliance Notice
Bazaar Sync is an educational, technical analytics, and backtesting technology platform. As per SEBI regulations, derivatives (Futures & Options) trading involves substantial risk of capital loss. Past backtested performance is not a guarantee of future returns.

---

## 9. Contact Our Grievance & Privacy Team
If you have any questions, concerns, or requests regarding this Privacy Policy or your data, please reach out to:

- **Platform:** Bazaar Sync Technologies
- **Email:** privacy@bazaarsync.com / support@bazaarsync.com
- **Website:** [https://bazaarsync.com](https://bazaarsync.com)`;

export default function PrivacyPolicy() {
    const { token } = useAdminAuth();
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [updatedAt, setUpdatedAt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => {
        fetchContent(token, "privacy-policy")
            .then((r) => {
                setTitle(r.title || "Privacy Policy");
                setContent(r.content || "");
                setUpdatedAt(r.updated_at);
            })
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
            await saveContent(token, "privacy-policy", { title: title.trim() || "Privacy Policy", content });
            // Also mirror to "privacy" slug for convenience
            await saveContent(token, "privacy", { title: title.trim() || "Privacy Policy", content }).catch(() => {});
            setSaved(true);
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    function handleLoadTemplate() {
        if (content.trim() && !window.confirm("Replace current editor content with the Standard Financial Privacy Policy Template?")) {
            return;
        }
        setContent(DEFAULT_PRIVACY_TEMPLATE);
        if (!title) setTitle("Privacy Policy");
    }

    return (
        <div>
            <TopBar
                title="Privacy Policy"
                subtitle="Markdown editor for the Privacy Policy shown on the public /privacy-policy page."
            />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4">
                {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium">
                        {error}
                    </div>
                )}
                {saved && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-semibold flex items-center gap-2">
                        <FiCheck className="text-emerald-400" />
                        Privacy Policy saved and published successfully to live site!
                    </div>
                )}

                <Card
                    title="Edit Privacy Policy Content"
                    action={
                        <div className="flex items-center gap-3">
                            {updatedAt && (
                                <span className="text-[11px] text-gray-500">
                                    Last updated {formatDateTime(updatedAt)}
                                </span>
                            )}
                            <a
                                href="http://localhost:5173/privacy-policy"
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg bg-white/5 hover:bg-white/10 px-2.5 py-1 text-xs font-medium text-gray-300 transition"
                            >
                                <span>View Live Page</span>
                                <FiExternalLink size={12} />
                            </a>
                        </div>
                    }
                >
                    {loading ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading Privacy Policy content…</div>
                    ) : (
                        <form onSubmit={handleSave} className="space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex-1">
                                    <label className="mb-1 block text-xs font-medium text-gray-400">Page Title</label>
                                    <input
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="Privacy Policy"
                                        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                                    />
                                </div>
                                <div className="sm:self-end">
                                    <button
                                        type="button"
                                        onClick={handleLoadTemplate}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 px-3 py-2 text-xs font-semibold text-violet-300 transition"
                                    >
                                        <FiFileText size={13} />
                                        <span>Load Standard Template</span>
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="mb-1 block text-xs font-medium text-gray-400">
                                    Privacy Policy Content (Markdown)
                                </label>
                                <MarkdownEditor
                                    value={content}
                                    onChange={setContent}
                                    rows={22}
                                    placeholder="Paste or write the Privacy Policy text here… supports **bold**, _italic_, ## headings, - lists, [links](url)."
                                />
                            </div>

                            <div className="flex items-center justify-between pt-2">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition shadow-md shadow-violet-600/20 flex items-center gap-2"
                                >
                                    {saving && <FiRefreshCw className="animate-spin" size={14} />}
                                    <span>{saving ? "Saving & Publishing…" : "Save & Publish Changes"}</span>
                                </button>
                                <span className="text-xs text-gray-500">
                                    Changes will immediately reflect on the public website.
                                </span>
                            </div>
                        </form>
                    )}
                </Card>
            </div>
        </div>
    );
}
