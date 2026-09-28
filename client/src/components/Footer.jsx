import React from "react";
// components/Footer.jsx — Premier International-Standard Financial Market Footer
// Responsive across Mobile, Tablet, and Desktop with SEBI-compliant Risk Disclosures,
// product catalog, market analytics links, and clean emerald branding.

import { Link } from "react-router-dom";
import { FaWhatsapp, FaTelegram, FaXTwitter, FaYoutube, FaInstagram, FaLinkedinIn } from "react-icons/fa6";
import { FiShield, FiTrendingUp, FiCpu, FiCheckCircle } from "react-icons/fi";
import Logo from "./Logo";

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
    { to: "/login", label: "Trader Login / Sign Up" },
];

const SOCIAL_LINKS = [
    { key: "x", label: "X (Twitter)", Icon: FaXTwitter, href: "https://twitter.com" },
    { key: "youtube", label: "YouTube", Icon: FaYoutube, href: "https://youtube.com" },
    { key: "telegram", label: "Telegram Community", Icon: FaTelegram, href: "https://t.me" },
    { key: "whatsapp", label: "WhatsApp Channel", Icon: FaWhatsapp, href: "https://whatsapp.com" },
    { key: "linkedin", label: "LinkedIn", Icon: FaLinkedinIn, href: "https://linkedin.com" },
    { key: "instagram", label: "Instagram", Icon: FaInstagram, href: "https://instagram.com" },
];

export default function Footer() {
    return (
        <footer className="border-t border-gray-200 bg-white text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400 transition-colors">
            {/* Top Value Proposition Highlights Bar */}
            <div className="w-full border-b border-gray-100 bg-gray-50/70 py-6 px-4 sm:px-8 lg:px-12 dark:border-gray-800 dark:bg-gray-900/60">
                <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-400">
                            <FiTrendingUp size={20} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-gray-900 dark:text-gray-100">Real-Time NSE Stream</div>
                            <div className="text-[11px] text-gray-400">Live ticks & option Greeks</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-400">
                            <FiCpu size={20} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-gray-900 dark:text-gray-100">0-Latency Backtesting</div>
                            <div className="text-[11px] text-gray-400">Historical minute replay</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-400">
                            <FiShield size={20} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-gray-900 dark:text-gray-100">Risk-Free Paper Trading</div>
                            <div className="text-[11px] text-gray-400">Live forward execution</div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-400">
                            <FiCheckCircle size={20} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-gray-900 dark:text-gray-100">Indian Market Focus</div>
                            <div className="text-[11px] text-gray-400">NIFTY, BANKNIFTY & 200+ F&O</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Navigation Matrix */}
            <div className="w-full px-4 py-10 sm:px-8 lg:px-12">
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-5">
                    {/* Brand & Mission Column */}
                    <div className="lg:col-span-2 space-y-4">
                        <Logo showTagline />
                        <p className="text-xs leading-relaxed text-gray-500 max-w-sm">
                            Bazaar Sync is India&apos;s premier options analytics, strategy building, and tick-by-tick backtesting platform. Designed for retail and institutional traders to simulate, analyze, and master derivatives markets with precision.
                        </p>

                        <div className="pt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200/60 px-3 py-1 font-bold text-emerald-700">
                                <span>🇮🇳</span> Made with precision in India
                            </span>
                            <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1 text-[11px] font-semibold text-gray-600 dark:text-gray-400">
                                Real-Time Market Feed
                            </span>
                        </div>
                    </div>

                    {/* Column 2: Products */}
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-gray-100 mb-3.5">
                            Derivatives Tools
                        </h3>
                        <ul className="space-y-2.5 text-xs">
                            {PRODUCTS.map((p) => (
                                <li key={p.to}>
                                    <Link
                                        to={p.to}
                                        className="group flex items-center justify-between text-gray-600 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-400 transition"
                                    >
                                        <span>{p.label}</span>
                                        {p.badge && (
                                            <span className="rounded bg-emerald-50 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700 border border-emerald-100 dark:bg-emerald-950/60 dark:border-emerald-800/60 dark:text-emerald-300 group-hover:bg-emerald-600 group-hover:text-white transition">
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
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-gray-100 mb-3.5">
                            Market Analytics
                        </h3>
                        <ul className="space-y-2.5 text-xs">
                            {EQUITY_ANALYTICS.map((item) => (
                                <li key={item.to}>
                                    <Link
                                        to={item.to}
                                        className="text-gray-600 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-400 transition block"
                                    >
                                        {item.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Column 4: Platform & Legal */}
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-gray-900 dark:text-gray-100 mb-3.5">
                            Platform & Legal
                        </h3>
                        <ul className="space-y-2.5 text-xs">
                            {COMPANY_LINKS.map((item) => (
                                <li key={item.to}>
                                    <Link
                                        to={item.to}
                                        className="text-gray-600 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-400 transition block"
                                    >
                                        {item.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                {/* Regulatory SEBI Risk Disclosure Notice Box */}
                <div className="mt-8 rounded-2xl border border-amber-200/80 bg-amber-50/40 p-4 text-[11px] leading-relaxed text-amber-900/80 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300/80">
                    <div className="flex items-center gap-2 font-bold text-amber-950 dark:text-amber-200 mb-1">
                        <span className="rounded bg-amber-200 px-1.5 py-0.2 text-[9px] uppercase font-black tracking-wider text-amber-900 dark:bg-amber-800 dark:text-amber-100">
                            SEBI Risk Warning
                        </span>
                        <span>Important Regulatory Disclosure on Derivatives Trading:</span>
                    </div>
                    <p className="text-[11px] text-amber-900/90 dark:text-amber-300/90">
                        9 out of 10 individual traders in the equity Futures and Options (F&O) segment incurred net losses as per SEBI study findings. On average, loss-makers registered net trading losses close to ₹50,000. Over and above the net trading losses, loss-makers expended an additional 28% of net trading losses in transaction costs.
                    </p>
                    <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                        Bazaar Sync is an educational, technical analytics, and backtesting platform. We do not provide investment advice or stock tips.
                    </p>
                </div>

                {/* Bottom Bar with Copyright and Social Connect */}
                <div className="mt-8 flex flex-col items-center justify-between gap-4 border-t border-gray-100 pt-6 text-xs text-gray-400 dark:border-gray-800 sm:flex-row">
                    <div>
                        © {new Date().getFullYear()} Bazaar Sync Technologies. All rights reserved.
                    </div>

                    {/* Social Media Link Icons */}
                    <div className="flex items-center gap-3">
                        {SOCIAL_LINKS.map(({ key, label, Icon, href }) => (
                            <a
                                key={key}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                title={label}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300 transition"
                            >
                                <Icon size={14} />
                            </a>
                        ))}
                    </div>
                </div>
            </div>
        </footer>
    );
}
