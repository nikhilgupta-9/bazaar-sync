// components/AuthBackground.jsx
//
// Full-page decorative backdrop for the login/register screen — the user
// pointed at a real TradingView-style chart screenshot ("mujhe dusre type me
// chahiye") as the look to match, over the earlier stylized red/green
// converging-diagonal version. So this is a dense, realistic-looking
// candlestick strip — natural random up/down price action (each candle
// colored by its own open/close, not by which "side" it's on), continuously
// scrolling left -> right forever like a live chart building out, plus a
// thin oscillator line underneath standing in for an RSI panel, the way the
// reference screenshot had one below its price chart.
//
// The random walk is generated as a Brownian BRIDGE (forced back to the same
// value at both ends of one tile — see buildBridgeLevels) so two identical
// tiles placed side by side loop with no visible seam, without looking like
// an obviously-repeating sine wave the way a naive periodic function would.
//
// NOT real market data — every price/number here is a fixed, hand-seeded
// placeholder pattern, never fetched from anywhere, so this never risks
// reading as a real NIFTY/BANKNIFTY feed to anyone who screenshots the login
// page.
//
// Follows the site-wide light/dark toggle (see ThemeContext.jsx) — every
// color here is picked from PALETTE.dark/light based on useTheme(), same
// pattern Auth.jsx's own card styling uses.
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../context/ThemeContext";

const PALETTE = {
    dark: {
        bg: "#020103",
        surface: "#050912",
        red: "#e6383b",
        redBright: "#ff6b6e",
        green: "#26a95c",
        greenBright: "#4ee08a",
        particle: "#8b93a7",
        numberText: "#c7ceda",
        indicator: "#8b7cf6",
        vignette: "#020103d9",
    },
    light: {
        bg: "#f8fafc",
        surface: "#eef2f7",
        red: "#c40709",
        redBright: "#eb090b",
        green: "#029e2e",
        greenBright: "#0be55c",
        particle: "#94a3b8",
        numberText: "#475569",
        indicator: "#7c6ae0",
        vignette: "#f8fafccc",
    },
};

const W = 1600; // width of ONE tile — every band/line repeats exactly every W px
const H = 900;

// A Brownian bridge: a random walk of `steps` increments that's forced back
// to 0 at both ends. That's what makes two identical tiles connect with zero
// visible seam when looped — real random-walk noise, but still perfectly
// periodic across one tile width.
function buildBridgeLevels(steps, volatility) {
    const raw = [0];
    for (let i = 1; i <= steps; i++) raw.push(raw[i - 1] + (Math.random() - 0.5) * volatility);
    const drift = raw[steps];
    return raw.map((v, i) => v - (i / steps) * drift);
}

// Consecutive bridge levels become consecutive candles — level[i] is one
// candle's open, level[i+1] its close, so candles visually connect the way a
// real chart's do. Individually colored (up/down per candle), not by band.
// Each candle also rolls its own "pattern" (doji / marubozu / pin-bar /
// normal) the way a real chart has a mix of candle personalities, not one
// repeated shape.
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
            // doji — the body collapses to a sliver, wicks stretch both ways
            const mid = (bodyTop + bodyBottom) / 2;
            bodyTop = mid - 0.8;
            bodyBottom = mid + 0.8;
            upperWick = wickMax * (0.6 + Math.random() * 0.8);
            lowerWick = wickMax * (0.6 + Math.random() * 0.8);
        } else if (roll < 0.26) {
            // marubozu — a solid body with almost no wick either side
            upperWick = wickMax * Math.random() * 0.12;
            lowerWick = wickMax * Math.random() * 0.12;
        } else if (roll < 0.42) {
            // pin bar / hammer — one side shoots out, the other stays tight
            const longSide = wickMax * (0.9 + Math.random() * 0.9);
            const shortSide = wickMax * Math.random() * 0.18;
            if (Math.random() < 0.5) { upperWick = shortSide; lowerWick = longSide; }
            else { upperWick = longSide; lowerWick = shortSide; }
        } else {
            upperWick = Math.random() * wickMax;
            lowerWick = Math.random() * wickMax;
        }

        candles.push({
            x: i * spacing + spacing / 2,
            bodyWidth: spacing * (bodyMinWidthRatio + Math.random() * bodyWidthJitter),
            bodyTop,
            bodyBottom,
            wickTop: bodyTop - upperWick,
            wickBottom: bodyBottom + lowerWick,
            up,
        });
    }
    return candles;
}

// One band: two identical tiles side by side, the pair animated
// translateX(-W -> 0) on a loop — since both tiles are identical and the
// underlying levels are a bridge (see above), the loop restart is invisible.
function CandleBand({ candles, red, redBright, green, greenBright, opacity, duration, glow }) {
    return (
        <g style={{ animation: `authBandFlow ${duration}s linear infinite` }} filter={glow ? "url(#authGlow)" : undefined}>
            {[0, 1].map((tile) => (
                <g key={tile} transform={`translate(${tile * W},0)`}>
                    {candles.map((c, i) => {
                        const fill = c.up ? green : red;
                        const bright = c.up ? greenBright : redBright;
                        const wickWidth = Math.max(1.4, c.bodyWidth * 0.16);
                        return (
                            <g key={i} opacity={opacity}>
                                <line x1={c.x} x2={c.x} y1={c.wickTop} y2={c.wickBottom} stroke={bright} strokeWidth={wickWidth} strokeLinecap="round" opacity="0.85" />
                                <rect
                                    x={c.x - c.bodyWidth / 2}
                                    y={c.bodyTop}
                                    width={c.bodyWidth}
                                    height={Math.max(2.2, c.bodyBottom - c.bodyTop)}
                                    rx="1"
                                    fill={fill}
                                    stroke={bright}
                                    strokeWidth="1"
                                    strokeOpacity="0.7"
                                />
                            </g>
                        );
                    })}
                </g>
            ))}
        </g>
    );
}

// A thin wavy line standing in for the RSI/oscillator sub-panel the
// reference screenshot showed below its price chart — same bridge technique,
// much smaller amplitude, drawn as a single smooth polyline.
function buildOscillatorPath(levels, { amplitude, baseY }) {
    const count = levels.length - 1;
    const spacing = W / count;
    const points = levels.map((lv, i) => `${i * spacing},${baseY - lv * amplitude}`);
    return `M ${points.join(" L ")}`;
}

// A sparse field of slow-drifting particles (rising + fading, like embers off
// a trading floor) — a light extra depth layer, purely CSS-driven.
function buildParticles(count) {
    const particles = [];
    for (let i = 0; i < count; i++) {
        particles.push({
            key: i,
            left: Math.random() * 100,
            size: 1.5 + Math.random() * 2.5,
            duration: 10 + Math.random() * 14,
            delay: Math.random() * -20,
            drift: (Math.random() - 0.5) * 60,
        });
    }
    return particles;
}

// Hand-picked, clearly-fake ticker readouts scattered in the outer columns
// (never behind the centered form card) — index quotes with an up/down arrow
// up top, a couple more mid-height, and a fake P&L readout near the bottom,
// the way a real trading terminal's chrome would surround the chart. Each
// one's number actually ticks (see LiveTicker) rather than sitting on one
// frozen value — that's the "dynamic number" the candles themselves already
// had via motion, applied to the numbers too. NOT real market data — every
// base value is a fixed, hand-seeded placeholder that a small bounded random
// walk wobbles around client-side; nothing here is fetched from anywhere, so
// it never risks reading as a real NIFTY/BANKNIFTY feed to anyone who
// screenshots the login page.
const TICKERS = [
    { key: "nifty", x: 40, y: 82, size: 15, anchor: "start", label: "NIFTY", base: 24354.85, volatility: 3.2, mode: "quote" },
    { key: "banknifty", x: W - 40, y: 82, size: 15, anchor: "end", label: "BANKNIFTY", base: 51938.7, volatility: 8, mode: "quote" },
    { key: "finnifty", x: 40, y: H * 0.58, size: 14, anchor: "start", label: "FINNIFTY", base: 22965.85, volatility: 4.5, mode: "quote" },
    { key: "sensex", x: W - 40, y: H * 0.58, size: 14, anchor: "end", label: "SENSEX", base: 80424.7, volatility: 13, mode: "quote" },
    { key: "todaypnl", x: 40, y: H * 0.9, size: 12, anchor: "start", label: "TODAY'S P&L", base: 24850, volatility: 380, mode: "pnl", pctBase: 1160000 },
    { key: "openpnl", x: W - 40, y: H * 0.9, size: 12, anchor: "end", label: "OPEN POSITIONS P&L", base: -6120, volatility: 260, mode: "pnl", pctBase: 1160000 },
];

// A live-ticking readout: its numeric value takes a small bounded random
// walk on an interval (softly pulled back toward `base` so it never wanders
// far), re-rendering with a genuinely different number each tick — not just
// a static string with a fade animation.
function LiveTicker({ x, y, size, anchor, label, base, volatility, mode, pctBase, green, red, numberText }) {
    const [value, setValue] = useState(base);

    useEffect(() => {
        const id = setInterval(() => {
            setValue((v) => {
                const next = v + (Math.random() - 0.5) * volatility;
                return next + (base - next) * 0.05; // gentle pull back toward base
            });
        }, 900 + Math.random() * 700);
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
        <>
            <text x={x} y={y} textAnchor={anchor} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={size + 3} fontWeight="600" fill={numberText} filter="url(#authTextGlow)">
                {line1}
            </text>
            <text x={x} y={y + 24} textAnchor={anchor} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize={size} fontWeight="600" fill={changeColor} filter="url(#authTextGlow)">
                {line2}
            </text>
        </>
    );
}

export default function AuthBackground() {
    const { isDark } = useTheme();
    const p = isDark ? PALETTE.dark : PALETTE.light;
    const particles = useMemo(() => buildParticles(18), []);

    // Two parallax bands (faint/slow behind, bold/fast in front) plus a thin
    // oscillator line underneath — all flowing the same left -> right direction.
    const backCandles = useMemo(() => {
        const levels = buildBridgeLevels(110, 26);
        return buildCandles(levels, { amplitude: 1, baseY: H * 0.36, wickMax: 9, bodyMinWidthRatio: 0.3, bodyWidthJitter: 0.12 });
    }, []);
    const frontCandles = useMemo(() => {
        const levels = buildBridgeLevels(92, 40);
        return buildCandles(levels, { amplitude: 1.4, baseY: H * 0.5, wickMax: 15, bodyMinWidthRatio: 0.32, bodyWidthJitter: 0.12 });
    }, []);
    const oscillatorPath = useMemo(() => {
        const levels = buildBridgeLevels(90, 14);
        return buildOscillatorPath(levels, { amplitude: 1, baseY: H * 0.78 });
    }, []);

    return (
        <div
            className="absolute inset-0 overflow-hidden"
            aria-hidden="true"
            style={{ background: `radial-gradient(ellipse 90% 70% at 50% 78%, ${p.surface} 0%, ${p.bg} 65%)` }}
        >
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
                    10% { opacity: 0.6; }
                    90% { opacity: 0.4; }
                    100% { transform: translate(var(--drift, 0px), -110vh); opacity: 0; }
                }
            `}</style>

            {/* Slow drifting particle field — extra ambient depth */}
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
                            "--drift": `${pt.drift}px`,
                            animation: `authParticleRise ${pt.duration}s linear ${pt.delay}s infinite`,
                        }}
                    />
                ))}
            </div>

            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
                <defs>
                    <filter id="authGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
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

                <CandleBand candles={backCandles} red={p.red} redBright={p.redBright} green={p.green} greenBright={p.greenBright} opacity={0.28} duration={38} />
                <CandleBand candles={frontCandles} red={p.red} redBright={p.redBright} green={p.green} greenBright={p.greenBright} opacity={0.92} duration={24} glow />

                {/* Thin oscillator line — decorative stand-in for an RSI-style sub-panel */}
                <g style={{ animation: "authOscFlow 30s linear infinite" }} opacity="0.5">
                    {[0, 1].map((tile) => (
                        <path key={tile} d={oscillatorPath} transform={`translate(${tile * W},0)`} fill="none" stroke={p.indicator} strokeWidth="1.6" filter="url(#authTextGlow)" />
                    ))}
                </g>

                {/* Floating fake ticker readouts — live-ticking, decorative only, see file header */}
                {TICKERS.map(({ key, ...t }) => (
                    <LiveTicker key={key} {...t} green={p.green} red={p.red} numberText={p.numberText} />
                ))}
            </svg>

            {/* Vignette so the centered form card reads clearly against the busiest part of the scene */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{ background: `radial-gradient(ellipse 55% 60% at 50% 45%, ${p.vignette} 0%, transparent 70%)` }}
            />
        </div>
    );
}
