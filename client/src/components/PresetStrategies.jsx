import { useMemo, useState } from "react";
import PayoffIcon from "./PayoffIcon";

const CATEGORIES = ["Bullish", "Bearish", "Neutral", "Other"];

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
        return {
            action, type, strike, premium: side.ltp, qty, iv: side.iv,
            delta: side.delta, gamma: side.gamma, theta: side.theta, vega: side.vega,
            expiry: data.selectedExpiry, // see utils/payoff.js — needed for calendar-spread math
        };
    };
    const compact = (legs) => legs.filter(Boolean);

    // The next expiry after whichever one is currently loaded — the "far"
    // leg of a calendar spread needs a genuinely later expiry's real chain.
    // Null if only one expiry is available (the preset disables itself below).
    const farExpiry = data.expiries && data.selectedExpiry
        ? data.expiries.find((e) => e > data.selectedExpiry) || null
        : null;

    return [
        {
            name: "Short Straddle", bias: "Neutral", shape: "short-straddle",
            legs: compact([leg(atm, "CE", "sell"), leg(atm, "PE", "sell")]),
        },
        {
            name: "Short Iron Condor", bias: "Neutral", shape: "short-iron-condor",
            legs: compact([
                leg(atm + 2 * gap, "CE", "sell"), leg(atm + 4 * gap, "CE", "buy"),
                leg(atm - 2 * gap, "PE", "sell"), leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Buy Call", bias: "Bullish", shape: "buy-call",
            legs: compact([leg(atm, "CE", "buy")]),
        },
        {
            name: "Sell Put", bias: "Bullish", shape: "sell-put",
            legs: compact([leg(atm, "PE", "sell")]),
        },
        {
            name: "Long Synthetic Future", bias: "Bullish", shape: "long-synthetic-future",
            legs: compact([leg(atm, "CE", "buy"), leg(atm, "PE", "sell")]),
        },
        {
            name: "Bull Call Spread", bias: "Bullish", shape: "bull-call-spread",
            legs: compact([leg(atm, "CE", "buy"), leg(atm + 4 * gap, "CE", "sell")]),
        },
        {
            name: "Bull Put Spread", bias: "Bullish", shape: "bull-put-spread",
            legs: compact([leg(atm, "PE", "sell"), leg(atm - 4 * gap, "PE", "buy")]),
        },
        {
            name: "Bull Condor", bias: "Bullish", shape: "bull-condor",
            legs: compact([
                leg(atm + gap, "CE", "buy"), leg(atm + 2 * gap, "CE", "sell"),
                leg(atm + 4 * gap, "CE", "sell"), leg(atm + 5 * gap, "CE", "buy"),
            ]),
        },
        {
            name: "Bull Butterfly", bias: "Bullish", shape: "bull-butterfly",
            legs: compact([
                leg(atm + gap, "CE", "buy"),
                leg(atm + 3 * gap, "CE", "sell", 2),
                leg(atm + 5 * gap, "CE", "buy"),
            ]),
        },
        // Best-guess match for the reference screenshot's 9th Bullish card
        // (partially cut off) — a 1x2 call ratio BACK spread (buy more
        // further-OTM calls than the near strike sold), the natural bullish
        // counterpart to "Call Ratio Spread" under Other. Flag to the user
        // if this isn't the strategy they meant.
        {
            name: "Call Ratio Back Spread", bias: "Bullish", shape: "call-ratio-back-spread",
            legs: compact([leg(atm, "CE", "sell"), leg(atm + 3 * gap, "CE", "buy", 2)]),
        },
        // Needs a genuinely different expiry for the long leg — the near
        // leg comes from the chain already loaded, but the far leg has to be
        // fetched on demand (see fetchExpiryRows), so this preset builds its
        // legs asynchronously instead of upfront like every other one here.
        {
            name: "Long Calendar with Calls", bias: "Bullish", shape: "long-calendar-call",
            legCount: farExpiry ? 2 : 0,
            buildLegs: farExpiry
                ? async (fetchExpiryRows) => {
                    const nearLeg = leg(atm, "CE", "sell");
                    if (!nearLeg || !fetchExpiryRows) return [];
                    const farRows = await fetchExpiryRows(farExpiry);
                    const farRow = farRows.find((r) => r.strike === atm);
                    if (!farRow || farRow.ce?.ltp == null) return [];
                    const farLeg = {
                        action: "buy", type: "CE", strike: atm, qty: 1,
                        premium: farRow.ce.ltp, iv: farRow.ce.iv,
                        delta: farRow.ce.delta, gamma: farRow.ce.gamma, theta: farRow.ce.theta, vega: farRow.ce.vega,
                        expiry: farExpiry,
                    };
                    return [nearLeg, farLeg];
                }
                : null,
        },
        {
            name: "Bear Put Spread", bias: "Bearish", shape: "bear-put-spread",
            legs: compact([leg(atm, "PE", "buy"), leg(atm - 4 * gap, "PE", "sell")]),
        },
        {
            name: "Long Call Butterfly", bias: "Neutral", shape: "long-call-butterfly",
            legs: compact([
                leg(atm - 4 * gap, "CE", "buy"),
                leg(atm, "CE", "sell", 2),
                leg(atm + 4 * gap, "CE", "buy"),
            ]),
        },
        {
            name: "Short Strangle", bias: "Neutral", shape: "short-strangle",
            legs: compact([leg(atm + 2 * gap, "CE", "sell"), leg(atm - 2 * gap, "PE", "sell")]),
        },
        {
            name: "Short Iron Butterfly", bias: "Neutral", shape: "short-iron-butterfly",
            legs: compact([
                leg(atm, "CE", "sell"), leg(atm, "PE", "sell"),
                leg(atm + 4 * gap, "CE", "buy"), leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        // Jade Lizard: short OTM put + short call vertical (short call, long
        // further-OTM call) — standard, well-documented 3-leg structure. No
        // upside risk as long as the net credit exceeds the call spread width.
        {
            name: "Jade Lizard", bias: "Neutral", shape: "jade-lizard",
            legs: compact([
                leg(atm - 3 * gap, "PE", "sell"),
                leg(atm + 2 * gap, "CE", "sell"), leg(atm + 4 * gap, "CE", "buy"),
            ]),
        },
        // Batman & Double Plateau are retail-glossary names (twin-peak /
        // twin-plateau payoff shapes), not standardized textbook structures —
        // these are reasonable constructions matching the named shape, not
        // independently verified against stockmojo's exact leg selection.
        {
            name: "Batman", bias: "Neutral", shape: "batman",
            legs: compact([
                leg(atm, "CE", "buy"), leg(atm + 2 * gap, "CE", "sell", 2), leg(atm + 4 * gap, "CE", "buy"),
                leg(atm, "PE", "buy"), leg(atm - 2 * gap, "PE", "sell", 2), leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Double Plateau", bias: "Neutral", shape: "double-plateau",
            legs: compact([
                leg(atm + gap, "CE", "sell"), leg(atm + 3 * gap, "CE", "buy"),
                leg(atm - gap, "PE", "sell"), leg(atm - 3 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Long Straddle", bias: "Other", shape: "long-straddle",
            legs: compact([leg(atm, "CE", "buy"), leg(atm, "PE", "buy")]),
        },
        {
            name: "Long Strangle", bias: "Other", shape: "long-strangle",
            legs: compact([leg(atm + 2 * gap, "CE", "buy"), leg(atm - 2 * gap, "PE", "buy")]),
        },
        {
            name: "Long Iron Condor", bias: "Other", shape: "long-iron-condor",
            legs: compact([
                leg(atm + 2 * gap, "CE", "buy"), leg(atm + 4 * gap, "CE", "sell"),
                leg(atm - 2 * gap, "PE", "buy"), leg(atm - 4 * gap, "PE", "sell"),
            ]),
        },
        {
            name: "Long Iron Butterfly", bias: "Other", shape: "long-iron-butterfly",
            legs: compact([
                leg(atm, "CE", "buy"), leg(atm, "PE", "buy"),
                leg(atm + 4 * gap, "CE", "sell"), leg(atm - 4 * gap, "PE", "sell"),
            ]),
        },
        {
            name: "Call Ratio Spread", bias: "Other", shape: "call-ratio-spread",
            legs: compact([leg(atm, "CE", "buy"), leg(atm + 3 * gap, "CE", "sell", 2)]),
        },
        {
            name: "Put Ratio Spread", bias: "Other", shape: "put-ratio-spread",
            legs: compact([leg(atm, "PE", "buy"), leg(atm - 3 * gap, "PE", "sell", 2)]),
        },
    ];
}

export default function PresetStrategies({ data, onApply, fetchExpiryRows }) {
    const presets = useMemo(() => buildPresets(data), [data]);
    const [category, setCategory] = useState("Other");
    const [loadingPreset, setLoadingPreset] = useState(null);

    const visible = presets.filter((p) => p.bias === category);

    async function handleApply(p) {
        if (p.legs) {
            if (p.legs.length) onApply(p.legs);
            return;
        }
        if (p.buildLegs) {
            setLoadingPreset(p.name);
            try {
                const legs = await p.buildLegs(fetchExpiryRows);
                if (legs.length) onApply(legs);
            } catch (err) {
                console.error("[PresetStrategies] failed to build async preset", p.name, err);
            } finally {
                setLoadingPreset(null);
            }
        }
    }

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="mb-1 text-sm font-semibold text-gray-900">Ready-Made Strategies</h2>
            <p className="mb-4 text-xs text-gray-500">
                Pick a template to auto-fill legs from the current chain, or use the Buy/Sell buttons on the left to
                build your own (up to 6 legs).
            </p>

            <div className="mb-4 flex gap-2">
                {CATEGORIES.map((c) => (
                    <button
                        key={c}
                        onClick={() => setCategory(c)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                            category === c
                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                : "border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                    >
                        {c}
                    </button>
                ))}
            </div>

            {!data ? (
                <div className="py-8 text-center text-sm text-gray-500">Loading option chain…</div>
            ) : visible.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">No {category.toLowerCase()} templates yet.</div>
            ) : (
                <div className="grid grid-cols-4 gap-3">
                    {visible.map((p) => {
                        const legCount = p.legs ? p.legs.length : (p.legCount || 0);
                        const isLoading = loadingPreset === p.name;
                        return (
                            <button
                                key={p.name}
                                onClick={() => handleApply(p)}
                                disabled={!legCount || isLoading}
                                className="rounded-lg border border-gray-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50 disabled:opacity-40"
                            >
                                <PayoffIcon shape={p.shape} />
                                <div className="mt-2 text-sm font-semibold text-gray-900">{p.name}</div>
                                <div className="mt-0.5 text-[11px] text-gray-500">
                                    {isLoading ? "Loading other expiry…" : `${legCount} legs`}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
