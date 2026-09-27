// components/landing/Hero.jsx — 3D Glassmorphic Hero with high-impact visual depth and responsive metrics
import { Link } from "react-router-dom";
import SectionVisual from "./SectionVisual";
import FloatingBadge from "./FloatingBadge";
import { FiTrendingUp, FiCpu, FiShield, FiArrowRight } from "react-icons/fi";

export default function Hero({ eyebrow, headline, headlineMuted, subtext, ctaLabel, ctaLink, image = "/images/hero_3d.jpg" }) {
    return (
        <section className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24 sm:pb-16 lg:pt-28">
            {/* Ambient Lighting Orbs in Background */}
            <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[350px] bg-emerald-500/10 blur-[120px] rounded-full dark:bg-emerald-500/15" />

            {/* Pill Eyebrow */}
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-50/70 px-4 py-1.5 text-xs font-bold text-emerald-700 backdrop-blur-md dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="tracking-wide uppercase">{eyebrow || "Next-Gen Derivatives Analytics"}</span>
            </div>

            {/* 3D Impact Headline */}
            <h1 className="headline mx-auto mt-6 max-w-4xl text-3xl sm:text-5xl lg:text-6xl font-black text-gray-900 dark:text-white">
                <span>{headline || "Build, Replay & Master"}</span>{" "}
                <span className="bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400 bg-clip-text text-transparent dark:from-emerald-400 dark:via-teal-300 dark:to-emerald-200">
                    {headlineMuted || "Options with Real Market Precision."}
                </span>
            </h1>

            {/* Description Subtext */}
            <p className="mx-auto mt-5 max-w-2xl text-xs sm:text-sm md:text-base leading-relaxed text-gray-600 dark:text-gray-300">
                {subtext || "Experience institutional-grade option chain analytics, multi-leg strategy modeling with real-time Greeks, and tick-by-tick historical backtesting on authentic NSE datasets."}
            </p>

            {/* CTA Action Cluster */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                <Link
                    to={ctaLink || "/strategy-builder"}
                    className="landing-cta inline-flex items-center gap-2 rounded-xl px-6 py-3 text-xs sm:text-sm font-bold text-white shadow-lg transition"
                >
                    <span>{ctaLabel || "Launch Strategy Builder"}</span>
                    <FiArrowRight size={16} />
                </Link>

                <Link
                    to="/simulator"
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white/80 px-6 py-3 text-xs sm:text-sm font-semibold text-gray-700 backdrop-blur-md hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900/80 dark:text-gray-200 dark:hover:bg-gray-800 transition"
                >
                    <span>Try 1-Min Replay Simulator</span>
                </Link>
            </div>

            {/* 3D Glassmorphic Terminal Card Showcase */}
            <div className="mockup-3d-wrapper relative mx-auto mt-12 sm:mt-16 max-w-4xl">
                <div className="mockup-3d-card relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white/70 p-2 shadow-2xl backdrop-blur-xl dark:border-emerald-500/20 dark:bg-gray-900/80 sm:p-3">
                    <SectionVisual image={image || "/images/hero_3d.jpg"} variant={0} className="rounded-xl overflow-hidden shadow-inner" />
                </div>

                {/* Floating 3D Micro-Badges */}
                <FloatingBadge
                    icon="⚡"
                    label="Live Upstox & Angel Feed"
                    className="-left-3 sm:-left-6 top-8 hidden sm:flex border border-emerald-500/20 bg-white/90 dark:bg-gray-900/90 text-xs shadow-xl"
                    delayMs={200}
                />
                <FloatingBadge
                    icon="📊"
                    label="90,000+ Historical Bars"
                    className="-right-3 sm:-right-6 bottom-8 hidden sm:flex border border-emerald-500/20 bg-white/90 dark:bg-gray-900/90 text-xs shadow-xl"
                    delayMs={500}
                />
            </div>

            {/* 3 Quick Value Badges */}
            <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white/60 py-2.5 px-4 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-300 shadow-xs">
                    <FiTrendingUp className="text-emerald-600 dark:text-emerald-400" size={16} />
                    <span>Real-Time Black-Scholes Greeks</span>
                </div>
                <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white/60 py-2.5 px-4 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-300 shadow-xs">
                    <FiCpu className="text-emerald-600 dark:text-emerald-400" size={16} />
                    <span>Tick-Level Minute Replay</span>
                </div>
                <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-100 bg-white/60 py-2.5 px-4 text-xs font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-300 shadow-xs">
                    <FiShield className="text-emerald-600 dark:text-emerald-400" size={16} />
                    <span>Zero-Risk Paper Trading</span>
                </div>
            </div>
        </section>
    );
}
