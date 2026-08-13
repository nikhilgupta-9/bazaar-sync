// components/ToolIcon.jsx
//
// Small decorative SVG thumbnails for the homepage tool cards — same
// hand-authored-shape approach as PayoffIcon.jsx (no real data, just a
// visual cue for what each tool does).
const COLORS = { up: "#10b981", down: "#f43f5e", line: "#2563eb", bar: "#93c5fd" };

function Bars() {
    const heights = [10, 22, 14, 30, 18, 26, 12, 34, 20];
    return (
        <svg viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
            {heights.map((h, i) => (
                <rect
                    key={i}
                    x={i * 11 + 2}
                    y={40 - h}
                    width={7}
                    height={h}
                    fill={i % 3 === 0 ? COLORS.down : COLORS.up}
                    opacity={0.85}
                />
            ))}
        </svg>
    );
}

function Line() {
    return (
        <svg viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
            <polyline
                points="0,30 15,22 30,26 45,10 60,16 75,6 90,14 100,4"
                fill="none"
                stroke={COLORS.line}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function Payoff() {
    return (
        <svg viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
            <polyline points="0,30 35,30 65,10 100,10" fill="none" stroke={COLORS.up} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="0" y1="30" x2="100" y2="30" stroke="#e5e7eb" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
    );
}

function Heatmap() {
    const cells = Array.from({ length: 24 }, (_, i) => i);
    return (
        <svg viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
            {cells.map((i) => {
                const x = (i % 8) * 12.5;
                const y = Math.floor(i / 8) * 13.3;
                const c = [COLORS.up, COLORS.down, COLORS.bar][i % 3];
                return <rect key={i} x={x} y={y} width={11} height={11.5} fill={c} opacity={0.6} />;
            })}
        </svg>
    );
}

function Table() {
    return (
        <svg viewBox="0 0 100 40" className="h-full w-full" preserveAspectRatio="none">
            {[0, 1, 2, 3].map((r) => (
                <rect key={r} x="4" y={r * 10 + 2} width="92" height="6" fill={r % 2 === 0 ? COLORS.bar : "#f3f4f6"} opacity="0.7" />
            ))}
        </svg>
    );
}

const ICONS = {
    chain: Table,
    strategy: Payoff,
    payoff: Payoff,
    backtest: Bars,
    papertrade: Bars,
    historicalchart: Line,
    equitydata: Heatmap,
};

export default function ToolIcon({ name }) {
    const Icon = ICONS[name] || Line;
    return <Icon />;
}
