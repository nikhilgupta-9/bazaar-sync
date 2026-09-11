// pages/BitcoinSimulator.jsx — animated "coming soon" teaser for the crypto
// side of the Simulator (header dropdown: Simulator -> Bitcoin).
//
// Deliberately a DARK, self-contained splash regardless of the site theme
// toggle — it's a decorative teaser, not a data page, and a crypto teaser
// reads best on near-black with Bitcoin orange (same "pick your own scene
// palette" approach as AuthBackground.jsx). All motion is CSS keyframes in a
// component-local <style> block (no dependency, same pattern as
// AuthBackground.jsx) and is disabled under prefers-reduced-motion.
//
// The BTC price shown is a fixed hand-seeded placeholder that wobbles
// client-side on a timer — nothing is fetched, so it never reads as a real
// feed to anyone who screenshots this.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FiArrowRight, FiClock, FiRepeat, FiActivity } from "react-icons/fi";

const FEATURES = [
    {
        icon: FiClock,
        title: "24/7 replay",
        body: "Scrub any historical day minute-by-minute. Crypto never closes — the tape won't either.",
    },
    {
        icon: FiRepeat,
        title: "Spot & perpetuals",
        body: "Model spot entries and perp positions with funding, side by side, on the same chart.",
    },
    {
        icon: FiActivity,
        title: "On-chain signals",
        body: "Overlay funding, open interest and liquidation levels on the price you're replaying.",
    },
];

const BTC_SEED = 63482.15;

// Module-level (not inline in the component) so the render stays pure — same
// pattern as AuthBackground.jsx's buildParticles.
function buildParticles(count) {
    return Array.from({ length: count }, (_, i) => ({
        key: i,
        left: Math.random() * 100,
        size: 2 + Math.random() * 4,
        duration: 9 + Math.random() * 12,
        delay: Math.random() * -20,
        drift: (Math.random() - 0.5) * 80,
    }));
}

function LiveBtcPrice() {
    const [price, setPrice] = useState(BTC_SEED);

    useEffect(() => {
        const id = setInterval(() => {
            setPrice((p) => {
                const next = p + (Math.random() - 0.5) * 240;
                return next + (BTC_SEED - next) * 0.04; // gentle pull back toward the seed
            });
        }, 1100);
        return () => clearInterval(id);
    }, []);

    const change = price - BTC_SEED;
    const up = change >= 0;

    return (
        <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 backdrop-blur-sm">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-amber-300/80">BTC / USD</span>
            <span className="font-mono text-sm font-semibold tabular-nums text-white">
                ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`font-mono text-xs font-semibold tabular-nums ${up ? "text-emerald-400" : "text-rose-400"}`}>
                {up ? "▲" : "▼"} {up ? "+" : "−"}
                {Math.abs(change).toFixed(2)}
            </span>
        </div>
    );
}

export default function BitcoinSimulator() {
    const particles = useMemo(() => buildParticles(16), []);

    return (
        <div className="btc-splash relative isolate flex min-h-[calc(100vh-8rem)] items-center justify-center overflow-hidden bg-[#0a0704] px-4 py-16 text-white">
            <style>{`
                @keyframes btcGlowPulse {
                    0%, 100% { opacity: 0.55; transform: scale(1); }
                    50% { opacity: 0.9; transform: scale(1.08); }
                }
                @keyframes btcFloat {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-14px); }
                }
                @keyframes btcSpin { to { transform: rotate(360deg); } }
                @keyframes btcSpinRev { to { transform: rotate(-360deg); } }
                @keyframes btcRise {
                    0% { transform: translate(0, 0); opacity: 0; }
                    12% { opacity: 0.7; }
                    88% { opacity: 0.5; }
                    100% { transform: translate(var(--drift, 0), -108vh); opacity: 0; }
                }
                @keyframes btcShimmer {
                    0% { background-position: -160% 0; }
                    100% { background-position: 260% 0; }
                }
                @keyframes btcFadeUp {
                    from { opacity: 0; transform: translateY(18px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .btc-fade-up { animation: btcFadeUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
                @media (prefers-reduced-motion: reduce) {
                    .btc-splash *, .btc-splash *::before, .btc-splash *::after {
                        animation: none !important;
                        transition: none !important;
                    }
                }
            `}</style>

            {/* Pulsing radial glow */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-[38%] -z-10 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
                style={{
                    background: "radial-gradient(circle, rgba(247,147,26,0.45) 0%, rgba(247,147,26,0.12) 45%, transparent 70%)",
                    animation: "btcGlowPulse 5s ease-in-out infinite",
                }}
            />

            {/* Faint grid */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 opacity-[0.15]"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)",
                    backgroundSize: "44px 44px",
                    maskImage: "radial-gradient(ellipse 60% 55% at 50% 42%, #000 0%, transparent 75%)",
                    WebkitMaskImage: "radial-gradient(ellipse 60% 55% at 50% 42%, #000 0%, transparent 75%)",
                }}
            />

            {/* Rising ember particles */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
                {particles.map((pt) => (
                    <span
                        key={pt.key}
                        className="absolute bottom-0 rounded-full bg-amber-400/70"
                        style={{
                            left: `${pt.left}%`,
                            width: pt.size,
                            height: pt.size,
                            "--drift": `${pt.drift}px`,
                            animation: `btcRise ${pt.duration}s linear ${pt.delay}s infinite`,
                        }}
                    />
                ))}
            </div>

            <div className="relative flex w-full max-w-xl flex-col items-center text-center">
                {/* Coin + orbit rings */}
                <div className="relative mb-9 h-40 w-40" style={{ animation: "btcFloat 6s ease-in-out infinite" }}>
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 rounded-full border border-amber-400/25"
                        style={{ animation: "btcSpin 14s linear infinite" }}
                    >
                        <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300 shadow-[0_0_12px_3px_rgba(247,147,26,0.7)]" />
                    </div>
                    <div
                        aria-hidden="true"
                        className="absolute inset-3.5 rounded-full border border-amber-400/20"
                        style={{ animation: "btcSpinRev 9s linear infinite" }}
                    >
                        <span className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-orange-400 shadow-[0_0_10px_2px_rgba(251,146,60,0.7)]" />
                    </div>
                    <div className="absolute inset-7.5 grid place-items-center rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-orange-600 shadow-[0_0_60px_-4px_rgba(247,147,26,0.75)]">
                        <span className="text-5xl font-black text-[#0a0704]">₿</span>
                    </div>
                </div>

                <span className="btc-fade-up mb-5 inline-block rounded-full border border-amber-400/30 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] text-transparent"
                    style={{
                        backgroundImage: "linear-gradient(100deg, #fcd34d 20%, #ffffff 40%, #fb923c 60%, #fcd34d 80%)",
                        backgroundSize: "220% 100%",
                        backgroundClip: "text",
                        WebkitBackgroundClip: "text",
                        animation: "btcShimmer 3.2s linear infinite",
                    }}
                >
                    Coming Soon
                </span>

                <h1 className="btc-fade-up bg-gradient-to-r from-amber-100 via-amber-300 to-orange-500 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl" style={{ animationDelay: "0.05s" }}>
                    Bitcoin Simulator
                </h1>

                <p className="btc-fade-up mt-4 max-w-md text-sm leading-relaxed text-white/60 sm:text-base" style={{ animationDelay: "0.12s" }}>
                    Replay Bitcoin's price action minute-by-minute — spot and perpetuals, funding, liquidations, the works. We're building it now.
                </p>

                <div className="btc-fade-up mt-6" style={{ animationDelay: "0.18s" }}>
                    <LiveBtcPrice />
                </div>

                {/* Feature preview cards */}
                <div className="mt-12 grid w-full gap-3 sm:grid-cols-3">
                    {FEATURES.map((f, i) => (
                        <div
                            key={f.title}
                            className="btc-fade-up group rounded-xl border border-white/10 bg-white/5 p-4 text-left transition duration-300 hover:-translate-y-1 hover:border-amber-400/30 hover:bg-white/10"
                            style={{ animationDelay: `${0.25 + i * 0.08}s` }}
                        >
                            <f.icon className="mb-2 text-amber-400 transition group-hover:scale-110" size={18} />
                            <div className="text-sm font-semibold text-white">{f.title}</div>
                            <p className="mt-1 text-xs leading-relaxed text-white/50">{f.body}</p>
                        </div>
                    ))}
                </div>

                <Link
                    to="/simulator"
                    className="btc-fade-up mt-11 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-6 py-3 text-sm font-semibold text-[#0a0704] shadow-[0_0_30px_-6px_rgba(247,147,26,0.8)] transition hover:brightness-110"
                    style={{ animationDelay: "0.5s" }}
                >
                    Try the Indian Stock Simulator
                    <FiArrowRight size={16} />
                </Link>
            </div>
        </div>
    );
}
