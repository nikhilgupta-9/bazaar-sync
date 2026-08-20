// components/landing/DashboardMockup.jsx — hand-authored placeholder for
// the product screenshot the spec calls for ("I'll provide the actual
// screenshot/mockup"). Same "no fabricated visuals" convention ToolIcon.jsx/
// PayoffIcon.jsx already use elsewhere in this codebase — a stylized, real
// option-chain-shaped mock (OI bars, strike ladder, a payoff-style line)
// rather than an invented product photo. Swap the <img> comment below in
// once a real screenshot exists.
const ROWS = 7;

export default function DashboardMockup({ variant = 0, className = "" }) {
    const bars = Array.from({ length: ROWS }, (_, i) => {
        const seed = (i * 7 + variant * 13) % 11;
        return { ce: 20 + seed * 6, pe: 20 + ((seed + 5) % 11) * 6 };
    });

    return (
        <div className={`landing-card overflow-hidden ${className}`}>
            {/* browser-chrome top bar */}
            <div className="flex items-center gap-1.5 border-b px-4 py-3" style={{ borderColor: "var(--landing-card-border)" }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#eb090b" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#f5a623" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#0be55c" }} />
                <div className="ml-3 flex-1 rounded-md px-3 py-1 text-[11px]" style={{ background: "var(--landing-bg-alt)", color: "var(--landing-text-muted)" }}>
                    app.bazaarsync.com
                </div>
            </div>

            {/* mini option-chain style body */}
            <div className="p-4">
                <div className="mb-3 flex items-center justify-between text-[11px]" style={{ color: "var(--landing-text-muted)" }}>
                    <span>NIFTY 24,850.75</span>
                    <span style={{ color: "#0be55c" }}>▲ 0.42%</span>
                </div>
                <div className="space-y-1.5">
                    {bars.map((b, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                                <div className="ml-auto h-full rounded-full" style={{ width: `${b.ce}%`, background: "rgba(11,229,92,0.6)" }} />
                            </div>
                            <div className="w-10 shrink-0 text-center text-[10px] font-semibold" style={{ color: "var(--landing-text-muted)" }}>
                                {24600 + i * 50}
                            </div>
                            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
                                <div className="h-full rounded-full" style={{ width: `${b.pe}%`, background: "rgba(235,9,11,0.55)" }} />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
