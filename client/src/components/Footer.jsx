import React, { useEffect, useState } from "react";
// components/Footer.jsx — Premier International-Standard Financial Market Footer
// Responsive across Mobile, Tablet, and Desktop with SEBI-compliant Risk Disclosures,
// product catalog, market analytics links, dynamic admin-managed social links, and clean emerald branding.

import { Link } from "react-router-dom";
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
import { FiShield, FiTrendingUp, FiCpu, FiCheckCircle } from "react-icons/fi";
import Logo from "./Logo";
import { fetchSocialLinks } from "../services/contentApi";

const PRODUCTS = [
    { to: "/strategy-builder", label: "Strategy Builder", badge: "Live" },
    { to: "/simulator", label: "Option Backtesting Engine", badge: "Tick Replay" },
    { to: "/option-chain", label: "Live Option Chain Matrix", badge: "Realtime" },
    { to: "/paper-trade", label: "Virtual Paper Trading", badge: "₹50k Virtual" },
    { to: "/historical-chart", label: "Historical Contract Charts", badge: "1-Min" },
];

const EQUITY_ANALYTICS = [
    { to: "/equity-data/sector-rotation", label: "Sector Rotation Tracker" },
    { to: "/equity-data/sector-performance", label: "Sector Performance Matrix" },
    { to: "/equity-data/market-map", label: "Live Market Heatmap" },
    { to: "/equity-data/52-week-high-low", label: "52-Week High / Low Breakouts" },
    { to: "/equity-data/industry-momentum", label: "Industry Momentum Stocks" },
    { to: "/equity-data/most-active", label: "High Activity Options" },
];

const COMPANY_LINKS = [
    { to: "/pricing", label: "Pro Membership Plans" },
    { to: "/events", label: "Market Events & Expiry Calendar" },
    { to: "/terms", label: "Terms & Conditions" },
    { to: "/privacy-policy", label: "Privacy Policy" },
    { to: "/login", label: "Trader Login / Sign Up" },
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

const DEFAULT_SOCIAL_LINKS = [
    { key: "x", label: "X (Twitter)", href: "https://twitter.com", active: true },
    { key: "youtube", label: "YouTube", href: "https://youtube.com", active: true },
    { key: "telegram", label: "Telegram Community", href: "https://t.me", active: true },
    { key: "whatsapp", label: "WhatsApp Channel", href: "https://whatsapp.com", active: true },
    { key: "linkedin", label: "LinkedIn", href: "https://linkedin.com", active: true },
    { key: "instagram", label: "Instagram", href: "https://instagram.com", active: true },
];

export default function Footer() {
    const [socialLinks, setSocialLinks] = useState(DEFAULT_SOCIAL_LINKS);
    const [copyrightText, setCopyrightText] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetchSocialLinks()
            .then((data) => {
                if (!isMounted || !data) return;
                if (Array.isArray(data.links)) {
                    setSocialLinks(data.links);
                } else if (typeof data === "object") {
                    const links = data.links || [];
                    if (Array.isArray(links) && links.length > 0) {
                        setSocialLinks(links);
                    }
                }
                if (data.copyrightText) {
                    setCopyrightText(data.copyrightText);
                }
            })
            .catch(() => {});
        return () => {
            isMounted = false;
        };
    }, []);

    return (
        <footer className="border-t border-gray-200 bg-white text-gray-700 dark:border-gray-800 dark:bg-[#070b12] dark:text-gray-200 transition-colors">
            {/* Top Value Proposition Highlights Bar */}
            <div className="w-full border-b border-gray-200/80 bg-gray-50/90 py-6 px-4 sm:px-8 lg:px-12 dark:border-gray-800 dark:bg-[#0b111c]">
                <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                    <div className="flex items-center gap-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-400 shadow-xs">
                            <FiTrendingUp size={22} />
                        </div>
                        <div>
                            <div className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">Real-Time NSE Stream</div>
                            <div className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">Live ticks &amp; option Greeks</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-400 shadow-xs">
                            <FiCpu size={22} />
                        </div>
                        <div>
                            <div className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">0-Latency Backtesting</div>
                            <div className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">Historical minute replay</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-400 shadow-xs">
                            <FiShield size={22} />
                        </div>
                        <div>
                            <div className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">Risk-Free Paper Trading</div>
                            <div className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">Live forward execution</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3.5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-400 shadow-xs">
                            <FiCheckCircle size={22} />
                        </div>
                        <div>
                            <div className="text-sm sm:text-base font-bold text-gray-900 dark:text-white">Indian Market Focus</div>
                            <div className="text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-300">NIFTY, BANKNIFTY &amp; 200+ F&amp;O</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Navigation Matrix */}
            <div className="w-full px-4 py-12 sm:px-8 lg:px-12">
                <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-5">
                    {/* Brand & Mission Column */}
                    <div className="lg:col-span-2 space-y-4">
                        <Logo showTagline />
                        <p className="text-sm sm:text-base leading-relaxed text-gray-600 dark:text-gray-300 max-w-md font-normal">
                            Bazaar Sync is India&apos;s premier options analytics, strategy building, and tick-by-tick backtesting platform. Designed for retail and institutional traders to simulate, analyze, and master derivatives markets with precision.
                        </p>

                        <div className="pt-2 flex flex-wrap items-center gap-2.5 text-xs sm:text-sm">
                            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3.5 py-1.5 font-bold text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-700/50 dark:text-emerald-300 shadow-xs">
                                <span>🇮🇳</span> Made with precision in India
                            </span>
                            <span className="rounded-full bg-gray-100 border border-gray-200 dark:border-gray-700 dark:bg-gray-800/90 px-3.5 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 shadow-xs">
                                Real-Time Market Feed
                            </span>
                        </div>
                    </div>

                    {/* Column 2: Products */}
                    <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-4">
                            Derivatives Tools
                        </h3>
                        <ul className="space-y-3 text-sm">
                            {PRODUCTS.map((p) => (
                                <li key={p.to}>
                                    <Link
                                        to={p.to}
                                        className="group flex items-center justify-between text-gray-600 hover:text-emerald-600 dark:text-gray-300 dark:hover:text-emerald-400 font-medium transition"
                                    >
                                        <span>{p.label}</span>
                                        {p.badge && (
                                            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:border-emerald-700/50 dark:text-emerald-300 group-hover:bg-emerald-600 group-hover:text-white transition">
                                                {p.badge}
                                            </span>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Column 3: Equity Analytics */}
                    <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-4">
                            Market Analytics
                        </h3>
                        <ul className="space-y-3 text-sm">
                            {EQUITY_ANALYTICS.map((item) => (
                                <li key={item.to}>
                                    <Link
                                        to={item.to}
                                        className="text-gray-600 hover:text-emerald-600 dark:text-gray-300 dark:hover:text-emerald-400 font-medium transition block"
                                    >
                                        {item.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Column 4: Platform & Legal */}
                    <div>
                        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-900 dark:text-white mb-4">
                            Platform &amp; Legal
                        </h3>
                        <ul className="space-y-3 text-sm">
                            {COMPANY_LINKS.map((item) => (
                                <li key={item.to}>
                                    <Link
                                        to={item.to}
                                        className="text-gray-600 hover:text-emerald-600 dark:text-gray-300 dark:hover:text-emerald-400 font-medium transition block"
                                    >
                                        {item.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Regulatory SEBI Risk Disclosure Notice Box */}
                <div className="mt-10 rounded-2xl border border-amber-300/80 bg-amber-50/70 p-5 text-xs sm:text-sm leading-relaxed text-amber-950 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200 shadow-xs">
                    <div className="flex items-center gap-2 font-bold text-amber-950 dark:text-amber-100 mb-2">
                        <span className="rounded-md bg-amber-200 px-2 py-0.5 text-[10px] uppercase font-black tracking-wider text-amber-950 dark:bg-amber-800 dark:text-amber-100">
                            SEBI Risk Warning
                        </span>
                        <span className="text-xs sm:text-sm font-bold">Important Regulatory Disclosure on Derivatives Trading:</span>
                    </div>
                    <p className="text-xs sm:text-sm text-amber-950/90 dark:text-amber-200/90 leading-relaxed font-normal">
                        9 out of 10 individual traders in the equity Futures and Options (F&amp;O) segment incurred net losses as per SEBI study findings. On average, loss-makers registered net trading losses close to ₹50,000. Over and above the net trading losses, loss-makers expended an additional 28% of net trading losses in transaction costs.
                    </p>
                    <p className="mt-2 text-xs text-gray-600 dark:text-gray-300 font-medium">
                        Bazaar Sync is an educational, technical analytics, and backtesting platform. We do not provide investment advice or stock tips.
                    </p>
                </div>

                {/* Bottom Bar with Copyright, Creator Credits and Social Connect */}
                <div className="mt-10 flex flex-col items-center justify-between gap-5 border-t border-gray-200 pt-7 text-xs sm:text-sm text-gray-600 dark:border-gray-800 dark:text-gray-300 sm:flex-row">
                    <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-center sm:text-left font-medium">
                        <span className="text-gray-700 dark:text-gray-200">
                            {copyrightText || `© ${new Date().getFullYear()} Bazaar Sync Technologies. All rights reserved.`}
                        </span>
                        <span className="hidden sm:inline text-gray-400 dark:text-gray-600">•</span>
                        <span className="text-gray-600 dark:text-gray-300">
                            Designed &amp; Developed by{" "}
                            <a
                                href="https://nikhilworks.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 font-semibold transition-colors"
                            >
                                Nikhil Works
                            </a>
                        </span>
                    </div>

                    {/* Dynamic Social Media Link Icons */}
                    <div className="flex items-center gap-3">
                        {socialLinks
                            .filter((s) => s.active !== false && s.href && s.href.trim() !== "")
                            .map((s) => {
                                const Icon = ICON_MAP[s.key?.toLowerCase()] || FaGlobe;
                                return (
                                    <a
                                        key={s.key || s.label}
                                        href={s.href}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={s.label}
                                        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-gray-50 text-gray-700 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-emerald-400 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300 transition-all shadow-xs"
                                    >
                                        <Icon size={15} />
                                    </a>
                                );
                            })}
                    </div>
                </div>
            </div>
        </footer>
    );
}
