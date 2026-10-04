import React, { useEffect, useState } from "react";
// pages/PrivacyPolicy.jsx — Public Privacy Policy page for Bazaar Sync.
// Content is managed dynamically by Admins via /admin/privacy-policy and stored in site_content table.
// Supports full Markdown rendering, Dark/Light theme, and fallback policy template.

import { fetchContent } from "../services/contentApi";
import { renderMarkdown } from "../utils/markdown";
import { formatDateTime } from "../utils/format";
import PageShell from "../components/PageShell";
import { FiShield, FiLock, FiCheckCircle, FiClock, FiMail } from "react-icons/fi";

const FALLBACK_PRIVACY_MARKDOWN = `## 1. Introduction & Overview
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
    const [contentData, setContentData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetchContent("privacy-policy")
            .then((res) => {
                if (isMounted) {
                    setContentData(res);
                }
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

    const title = contentData?.title || "Privacy Policy";
    const markdownBody = contentData?.content || FALLBACK_PRIVACY_MARKDOWN;
    const updatedAt = contentData?.updated_at;

    return (
        <PageShell>
            {/* Header Area */}
            <div className="border-b border-gray-200 pb-8 dark:border-gray-800">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        <FiShield size={13} /> Official Legal Policy
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-600 dark:text-blue-400 border border-blue-500/20">
                        <FiLock size={13} /> 256-Bit SSL Encrypted
                    </span>
                    {updatedAt && (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ml-auto">
                            <FiClock size={13} /> Last updated: {formatDateTime(updatedAt)}
                        </span>
                    )}
                </div>

                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
                    {title}
                </h1>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-2xl leading-relaxed">
                    How Bazaar Sync collects, encrypts, and handles your account, preferences, and backtesting data in compliance with financial data privacy standards.
                </p>
            </div>

            {/* Error / Loading notices */}
            {error && (
                <div className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-medium text-rose-600 dark:text-rose-300">
                    Failed to fetch customized policy from server: {error}. Displaying standard policy template.
                </div>
            )}

            {loading && !contentData && (
                <div className="mt-12 text-center text-sm text-gray-400 animate-pulse">
                    Loading privacy policy documentation…
                </div>
            )}

            {/* Rendered Markdown Body */}
            <div className="mt-8">
                <style>{`
                    .privacy-md h1, .privacy-md h2, .privacy-md h3, .privacy-md h4 { 
                        font-weight: 800; 
                        color: inherit; 
                        letter-spacing: -0.02em; 
                    }
                    .privacy-md h1 { 
                        font-size: 1.5rem; 
                        margin: 1.6em 0 0.6em; 
                    }
                    .privacy-md h2 { 
                        font-size: 1.25rem; 
                        margin: 1.5em 0 0.5em; 
                        padding-bottom: 0.3em;
                        border-bottom: 1px solid rgba(156, 163, 175, 0.2);
                    }
                    .privacy-md h3 { 
                        font-size: 1.05rem; 
                        margin: 1.2em 0 0.4em; 
                    }
                    .privacy-md p { 
                        margin: 0.85em 0; 
                        line-height: 1.75; 
                    }
                    .privacy-md ul, .privacy-md ol { 
                        margin: 0.8em 0; 
                        padding-left: 1.5em; 
                    }
                    .privacy-md li { 
                        margin: 0.35em 0; 
                        line-height: 1.65; 
                    }
                    .privacy-md a { 
                        color: #10b981; 
                        text-decoration: underline; 
                        text-underline-offset: 3px; 
                        font-weight: 600; 
                    }
                    .privacy-md a:hover { 
                        color: #059669; 
                    }
                    .privacy-md strong { 
                        font-weight: 700; 
                    }
                    .privacy-md hr { 
                        margin: 2em 0; 
                        border-color: rgba(156, 163, 175, 0.2); 
                    }
                    .privacy-md blockquote { 
                        border-left: 3px solid #10b981; 
                        padding-left: 1em; 
                        color: #6b7280; 
                        margin: 1em 0; 
                        font-style: italic; 
                    }
                    .privacy-md code { 
                        background: rgba(156, 163, 175, 0.15); 
                        padding: 0.15em 0.4em; 
                        border-radius: 4px; 
                        font-size: 0.85em; 
                    }
                `}</style>
                <div
                    className="privacy-md text-sm text-gray-700 dark:text-gray-300 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(markdownBody) }}
                />
            </div>

            {/* Security Guarantee Box */}
            <div className="mt-12 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 dark:bg-emerald-950/20">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white font-bold">
                            <FiCheckCircle size={20} />
                        </div>
                        <div>
                            <div className="text-sm font-bold text-gray-900 dark:text-white">
                                Questions about your Data or Account?
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                Contact our Data Privacy Officer for immediate assistance.
                            </div>
                        </div>
                    </div>
                    <a
                        href="mailto:support@bazaarsync.com"
                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition shadow-xs"
                    >
                        <FiMail size={14} />
                        <span>Email Privacy Team</span>
                    </a>
                </div>
            </div>
        </PageShell>
    );
}
