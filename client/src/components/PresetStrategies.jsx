// Ready-made strategy templates. Legs are built from the live option chain
// (real strikes + entry LTP), offset from the ATM strike in multiples of the
// visible strike gap — matches the six strategies in the original spec.
function buildPresets(data) {
    if (!data) return [];
    const gap = data.rows[1]?.strike - data.rows[0]?.strike || 50;
    const atm = data.atmStrike;
    const rowAt = (strike) => data.rows.find((r) => r.strike === strike);
    const leg = (strike, type, action, qty = 1) => {
        const row = rowAt(strike);
        if (!row) return null;
        const side = type === "CE" ? row.ce : row.pe;
        return { action, type, strike, premium: side.ltp, qty, iv: side.iv, delta: side.delta, gamma: side.gamma, theta: side.theta, vega: side.vega };
    };
    const compact = (legs) => legs.filter(Boolean);

    return [
        {
            name: "Long Straddle", bias: "Neutral",
            legs: compact([leg(atm, "CE", "buy"), leg(atm, "PE", "buy")]),
        },
        {
            name: "Short Straddle", bias: "Neutral",
            legs: compact([leg(atm, "CE", "sell"), leg(atm, "PE", "sell")]),
        },
        {
            name: "Long Strangle", bias: "Neutral",
            legs: compact([leg(atm + 2 * gap, "CE", "buy"), leg(atm - 2 * gap, "PE", "buy")]),
        },
        {
            name: "Short Iron Condor", bias: "Neutral",
            legs: compact([
                leg(atm + 2 * gap, "CE", "sell"), leg(atm + 4 * gap, "CE", "buy"),
                leg(atm - 2 * gap, "PE", "sell"), leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Bull Call Spread", bias: "Bullish",
            legs: compact([leg(atm, "CE", "buy"), leg(atm + 4 * gap, "CE", "sell")]),
        },
        {
            name: "Bear Put Spread", bias: "Bearish",
            legs: compact([leg(atm, "PE", "buy"), leg(atm - 4 * gap, "PE", "sell")]),
        },
        {
            name: "Long Call Butterfly", bias: "Neutral",
            legs: compact([
                leg(atm - 4 * gap, "CE", "buy"),
                leg(atm, "CE", "sell", 2),
                leg(atm + 4 * gap, "CE", "buy"),
            ]),
        },
    ];
}

export default function PresetStrategies({ data, onApply }) {
    const presets = buildPresets(data);

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-gray-900">Ready-Made Strategies</h2>
            <p className="mb-4 text-xs text-gray-500">
                Pick a template to auto-fill legs from the current chain, or use the Buy/Sell buttons on the left to
                build your own (up to 6 legs).
            </p>
            {!data ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading option chain…</div>
            ) : (
                <div className="grid grid-cols-3 gap-3">
                    {presets.map((p) => (
                        <button
                            key={p.name}
                            onClick={() => p.legs.length && onApply(p.legs)}
                            disabled={!p.legs.length}
                            className="rounded-lg border border-gray-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40"
                        >
                            <div className="text-xs font-medium text-gray-400">{p.bias}</div>
                            <div className="text-sm font-semibold text-gray-900">{p.name}</div>
                            <div className="mt-1 text-[11px] text-gray-500">{p.legs.length} legs</div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
