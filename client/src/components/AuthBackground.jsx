import React, { useEffect, useMemo, useState } from "react";
// components/AuthBackground.jsx — Dynamic High-Fidelity Trading Canvas Backdrop
// Features: Ambient Luminous Blur Orbs, Parallax Multi-Layer Candlesticks,
// Realistic Dynamic Volume Bars, Glowing Trend Line & Live Floating Tickers.

import { useTheme } from "../context/ThemeContext";

const PALETTE = {
    dark: {
        bg: "#030712",
        surface: "#081022",
        red: "#f43f5e",
        redBright: "#fb7185",
        redGlow: "rgba(244, 63, 94, 0.4)",
        green: "#10b981",
        greenBright: "#34d399",
        greenGlow: "rgba(16, 185, 129, 0.4)",
        particle: "#6ee7b7",
        numberText: "#e2e8f0",
        indicator: "#38bdf8",
        grid: "rgba(255, 255, 255, 0.03)",
        vignette: "#030712e0",
    },
    light: {
        bg: "#f1f5f9",
        surface: "#e2e8f0",
        red: "#e11d48",
        redBright: "#f43f5e",
        redGlow: "rgba(225, 29, 72, 0.2)",
        green: "#059669",
        greenBright: "#10b981",
        greenGlow: "rgba(5, 150, 105, 0.2)",
        particle: "#059669",
        numberText: "#1e293b",
        indicator: "#0284c7",
        grid: "rgba(0, 0, 0, 0.03)",
        vignette: "#f1f5f9cc",
    },
};

const W = 1600;
const H = 900;

function buildBridgeLevels(steps, volatility) {
    const raw = [0];
    for (let i = 1; i <= steps; i++) raw.push(raw[i - 1] + (Math.random() - 0.5) * volatility);
    const drift = raw[steps];
    return raw.map((v, i) => v - (i / steps) * drift);
}

function buildCandles(levels, { amplitude, baseY, wickMax, bodyMinWidthRatio, bodyWidthJitter = 0.1 }) {
    const count = levels.length - 1;
    const spacing = W / count;
    const candles = [];
    for (let i = 0; i < count; i++) {
        const openY = baseY - levels[i] * amplitude;
        const closeY = baseY - levels[i + 1] * amplitude;
        let bodyTop = Math.min(openY, closeY);
        let bodyBottom = Math.max(openY, closeY);
        const up = closeY <= openY;

        let upperWick;
        let lowerWick;
        const roll = Math.random();
        if (roll < 0.12) {
            const mid = (bodyTop + bodyBottom) / 2;
            bodyTop = mid - 0.8;
            bodyBottom = mid + 0.8;
            upperWick = wickMax * (0.6 + Math.random() * 0.8);
            lowerWick = wickMax * (0.6 + Math.random() * 0.8);
        } else if (roll < 0.26) {
            upperWick = wickMax * Math.random() * 0.12;
            lowerWick = wickMax * Math.random() * 0.12;
        } else if (roll < 0.42) {
            const longSide = wickMax * (0.9 + Math.random() * 0.9);
            const shortSide = wickMax * Math.random() * 0.18;
            if (Math.random() < 0.5) { upperWick = shortSide; lowerWick = longSide; }
            else { upperWick = longSide; lowerWick = shortSide; }
        } else {
            upperWick = Math.random() * wickMax;
            lowerWick = Math.random() * wickMax;
        }

        const volHeight = 12 + Math.random() * 45;

        candles.push({
            x: i * spacing + spacing / 2,
            bodyWidth: spacing * (bodyMinWidthRatio + Math.random() * bodyWidthJitter),
            bodyTop,
            bodyBottom,
            wickTop: bodyTop - upperWick,
            wickBottom: bodyBottom + lowerWick,
            up,
            volHeight,
        });
    }
    return candles;
}

function CandleBand({ candles, red, redBright, green, greenBright, opacity, duration, glow, showVolume = false }) {
    return (
        <g style={{ animation: `authBandFlow ${duration}s linear infinite` }} filter={glow ? "url(#authGlow)" : undefined}>
            {[0, 1].map((tile) => (
                <g key={tile} transform={`translate(${tile * W},0)`}>
                    {candles.map((c, i) => {
                        const fill = c.up ? "url(#bullGrad)" : "url(#bearGrad)";
                        const bright = c.up ? greenBright : redBright;
                        const wickWidth = Math.max(1.3, c.bodyWidth * 0.18);
                        return (
                            <g key={i} opacity={opacity}>
                                {/* Wick */}
                                <line
                                    x1={c.x}
                                    x2={c.x}
                                    y1={c.wickTop}
                                    y2={c.wickBottom}
                                    stroke={bright}
                                    strokeWidth={wickWidth}
                                    strokeLinecap="round"
                                    opacity="0.8"
                                />
                                {/* Candle Body */}
                                <rect
                                    x={c.x - c.bodyWidth / 2}
                                    y={c.bodyTop}
                                    width={c.bodyWidth}
                                    height={Math.max(2.5, c.bodyBottom - c.bodyTop)}
                                    rx="1.5"
                                    fill={fill}
                                    stroke={bright}
                                    strokeWidth="0.8"
                                    strokeOpacity="0.75"
                                />
                                {/* Optional Volume Histogram Bar */}
                                {showVolume && (
                                    <rect
                                        x={c.x - c.bodyWidth * 0.35}
                                        y={H * 0.92 - c.volHeight}
                                        width={c.bodyWidth * 0.7}
                                        height={c.volHeight}
                                        rx="1"
                                        fill={c.up ? green : red}
                                        opacity="0.25"
                                    />
                                )}
                            </g>
                        );
                    })}
                </g>
            ))}
        </g>
    );
}

function buildOscillatorPath(levels, { amplitude, baseY }) {
    const count = levels.length - 1;
    const spacing = W / count;
    const points = levels.map((lv, i) => `${i * spacing},${baseY - lv * amplitude}`);
    return `M ${points.join(" L ")}`;
}

function buildParticles(count) {
    const particles = [];
    for (let i = 0; i < count; i++) {
        particles.push({
            key: i,
            left: Math.random() * 100,
            size: 1.5 + Math.random() * 2.5,
            duration: 12 + Math.random() * 16,
            delay: Math.random() * -20,
            drift: (Math.random() - 0.5) * 80,
        });
    }
    return particles;
}

const TICKERS = [
    { key: "nifty", x: 45, y: 70, size: 14, anchor: "start", label: "NIFTY 50", base: 24354.85, volatility: 3.2, mode: "quote" },
    { key: "banknifty", x: W - 45, y: 70, size: 14, anchor: "end", label: "BANKNIFTY", base: 51938.7, volatility: 8, mode: "quote" },
    { key: "finnifty", x: 45, y: H * 0.62, size: 13, anchor: "start", label: "FINNIFTY", base: 22965.85, volatility: 4.5, mode: "quote" },
    { key: "sensex", x: W - 45, y: H * 0.62, size: 13, anchor: "end", label: "SENSEX", base: 80424.7, volatility: 13, mode: "quote" },
    { key: "todaypnl", x: 45, y: H * 0.88, size: 12, anchor: "start", label: "SIMULATED TODAY'S P&L", base: 24850, volatility: 380, mode: "pnl", pctBase: 1160000 },
    { key: "openpnl", x: W - 45, y: H * 0.88, size: 12, anchor: "end", label: "OPEN HEDGES P&L", base: -6120, volatility: 260, mode: "pnl", pctBase: 1160000 },
];

function LiveTicker({ x, y, size, anchor, label, base, volatility, mode, pctBase, green, red, numberText }) {
    const [value, setValue] = useState(base);

    useEffect(() => {
        const id = setInterval(() => {
            setValue((v) => {
                const next = v + (Math.random() - 0.5) * volatility;
                return next + (base - next) * 0.05;
            });
        }, 850 + Math.random() * 600);
        return () => clearInterval(id);
    }, [base, volatility]);

    const isQuote = mode === "quote";
    const change = isQuote ? value - base : value;
    const pct = isQuote ? (change / base) * 100 : (change / pctBase) * 100;
    const up = change >= 0;
    const arrow = up ? "▲" : "▼";
    const sign = up ? "+" : "";
    const changeColor = up ? green : red;

    const line1 = isQuote
        ? `${label}  ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : label;
    const line2 = isQuote
        ? `${arrow} ${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`
        : `${arrow} ${up ? "+" : "-"}₹${Math.abs(change).toLocaleString("en-IN", { maximumFractionDigits: 0 })} (${sign}${pct.toFixed(2)}%)`;

    return (
        <g opacity="0.85">
            <text x={x} y={y} textAnchor={anchor} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={size + 2} fontWeight="700" fill={numberText} filter="url(#authTextGlow)">
                {line1}
            </text>
            <text x={x} y={y + 20} textAnchor={anchor} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={size} fontWeight="600" fill={changeColor} filter="url(#authTextGlow)">
                {line2}
            </text>
        </g>
    );
}

export default function AuthBackground() {
    const { isDark } = useTheme();
    const p = isDark ? PALETTE.dark : PALETTE.light;
    const particles = useMemo(() => buildParticles(24), []);

    const backCandles = useMemo(() => {
        const levels = buildBridgeLevels(120, 24);
        return buildCandles(levels, { amplitude: 1.1, baseY: H * 0.38, wickMax: 10, bodyMinWidthRatio: 0.28, bodyWidthJitter: 0.1 });
    }, []);

    const frontCandles = useMemo(() => {
        const levels = buildBridgeLevels(90, 42);
        return buildCandles(levels, { amplitude: 1.5, baseY: H * 0.52, wickMax: 16, bodyMinWidthRatio: 0.34, bodyWidthJitter: 0.12 });
    }, []);

    const oscillatorPath = useMemo(() => {
        const levels = buildBridgeLevels(96, 16);
        return buildOscillatorPath(levels, { amplitude: 1.2, baseY: H * 0.74 });
    }, []);

    return (
        <div className="absolute inset-0 overflow-hidden select-none" aria-hidden="true" style={{ background: p.bg }}>
            {/* Ambient Animated Luminous Mesh / Glowing Orbs */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {/* Emerald Orb Top-Left */}
                <div
                    className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-emerald-500/25 dark:bg-emerald-500/20 blur-[120px] animate-pulse"
                    style={{ animationDuration: "8s" }}
                />
                {/* Teal/Cyan Orb Bottom-Right */}
                <div
                    className="absolute -bottom-32 -right-32 h-[420px] w-[420px] rounded-full bg-teal-500/20 dark:bg-teal-500/20 blur-[140px] animate-pulse"
                    style={{ animationDuration: "10s", animationDelay: "2s" }}
                />
                {/* Indigo/Violet Center Ambient Glow (Behind Form Card) */}
                <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[520px] w-[520px] rounded-full bg-indigo-500/15 dark:bg-indigo-600/15 blur-[160px] animate-pulse"
                    style={{ animationDuration: "12s", animationDelay: "4s" }}
                />
            </div>

            {/* Subtle Grid Matrix Background */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    backgroundImage: `linear-gradient(${p.grid} 1px, transparent 1px), linear-gradient(90deg, ${p.grid} 1px, transparent 1px)`,
                    backgroundSize: "48px 48px",
                }}
            />

            <style>{`
                @keyframes authBandFlow {
                    from { transform: translateX(-${W}px); }
                    to { transform: translateX(0px); }
                }
                @keyframes authOscFlow {
                    from { transform: translateX(-${W}px); }
                    to { transform: translateX(0px); }
                }
                @keyframes authParticleRise {
                    0% { transform: translate(0, 0); opacity: 0; }
                    15% { opacity: 0.7; }
                    85% { opacity: 0.5; }
                    100% { transform: translate(var(--drift, 0px), -105vh); opacity: 0; }
                }
            `}</style>

            {/* Floating ambient embers / particles */}
            <div className="pointer-events-none absolute inset-0">
                {particles.map((pt) => (
                    <span
                        key={pt.key}
                        className="absolute bottom-0 rounded-full"
                        style={{
                            left: `${pt.left}%`,
                            width: pt.size,
                            height: pt.size,
                            background: p.particle,
                            boxShadow: `0 0 8px ${p.particle}`,
                            "--drift": `${pt.drift}px`,
                            animation: `authParticleRise ${pt.duration}s cubic-bezier(0.4, 0, 0.2, 1) ${pt.delay}s infinite`,
                        }}
                    />
                ))}
            </div>

            {/* SVG Candlestick & Financial Data Scene */}
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
                <defs>
                    <linearGradient id="bullGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={p.greenBright} stopOpacity="0.95" />
                        <stop offset="100%" stopColor={p.green} stopOpacity="0.75" />
                    </linearGradient>
                    <linearGradient id="bearGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor={p.redBright} stopOpacity="0.95" />
                        <stop offset="100%" stopColor={p.red} stopOpacity="0.75" />
                    </linearGradient>
                    <filter id="authGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="5" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="authTextGlow" x="-80%" y="-80%" width="260%" height="260%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Back Candlestick Band (Deep Parallax) */}
                <CandleBand candles={backCandles} red={p.red} redBright={p.redBright} green={p.green} greenBright={p.greenBright} opacity={0.35} duration={42} />

                {/* Front Candlestick Band + Volume Bars (Crisp & Glowing) */}
                <CandleBand candles={frontCandles} red={p.red} redBright={p.redBright} green={p.green} greenBright={p.greenBright} opacity={0.85} duration={26} glow showVolume />

                {/* Trend / Oscillator Stream */}
                <g style={{ animation: "authOscFlow 32s linear infinite" }} opacity="0.65">
                    {[0, 1].map((tile) => (
                        <path key={tile} d={oscillatorPath} transform={`translate(${tile * W},0)`} fill="none" stroke={p.indicator} strokeWidth="1.8" filter="url(#authTextGlow)" />
                    ))}
                </g>

                {/* Dynamic Live Tickers */}
                {TICKERS.map(({ key, ...t }) => (
                    <LiveTicker key={key} {...t} green={p.greenBright} red={p.redBright} numberText={p.numberText} />
                ))}
            </svg>

            {/* Vignette Overlay for focus */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(ellipse 65% 70% at 50% 50%, ${p.vignette} 0%, transparent 80%)` }}
            />
        </div>
    );
}
