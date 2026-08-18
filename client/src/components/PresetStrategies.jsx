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
            action, type, strike, premium: side.ltp, qty, lotSize: data.lotSize, iv: side.iv,
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
        // Buy an OTM call + sell an OTM put — a defined-range bullish combo
        // (synthetic long with the upside capped by how far OTM the call is
        // and downside cushioned by the put premium collected), the natural
        // bullish counterpart to Bearish's "Risk Reversal" below.
        {
            name: "Range Forward", bias: "Bullish", shape: "range-forward",
            legs: compact([leg(atm + 2 * gap, "CE", "buy"), leg(atm - 2 * gap, "PE", "sell")]),
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
                        action: "buy", type: "CE", strike: atm, qty: 1, lotSize: data.lotSize,
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
        // Naked long put: bearish mirror of "Buy Call" — flat loss (premium
        // paid) above the strike, unlimited profit as price falls below it.
        {
            name: "Buy Put", bias: "Bearish", shape: "buy-put",
            legs: compact([leg(atm, "PE", "buy")]),
        },
        // Naked short call: bearish mirror of "Sell Put" — profit caps at the
        // premium collected once price is below the strike, loss grows above it.
        {
            name: "Sell Call", bias: "Bearish", shape: "sell-call",
            legs: compact([leg(atm, "CE", "sell")]),
        },
        // Buy put + sell call at the same strike replicates a linear short
        // futures payoff — the bearish mirror of "Long Synthetic Future".
        {
            name: "Short Synthetic Future", bias: "Bearish", shape: "short-synthetic-future",
            legs: compact([leg(atm, "PE", "buy"), leg(atm, "CE", "sell")]),
        },
        // Credit call spread: sell the near strike, buy further OTM as
        // protection — bearish, defined risk/reward (the call-side mirror of
        // "Bull Put Spread").
        {
            name: "Bear Call Spread", bias: "Bearish", shape: "bear-call-spread",
            legs: compact([leg(atm, "CE", "sell"), leg(atm + 4 * gap, "CE", "buy")]),
        },
        // Same near/far-expiry pattern as "Long Calendar with Calls", built
        // with puts instead — sell the near-dated ATM put, buy the same
        // strike at a genuinely later expiry.
        {
            name: "Long Calendar with Puts", bias: "Bearish", shape: "long-calendar-put",
            legCount: farExpiry ? 2 : 0,
            buildLegs: farExpiry
                ? async (fetchExpiryRows) => {
                    const nearLeg = leg(atm, "PE", "sell");
                    if (!nearLeg || !fetchExpiryRows) return [];
                    const farRows = await fetchExpiryRows(farExpiry);
                    const farRow = farRows.find((r) => r.strike === atm);
                    if (!farRow || farRow.pe?.ltp == null) return [];
                    const farLeg = {
                        action: "buy", type: "PE", strike: atm, qty: 1, lotSize: data.lotSize,
                        premium: farRow.pe.ltp, iv: farRow.pe.iv,
                        delta: farRow.pe.delta, gamma: farRow.pe.gamma, theta: farRow.pe.theta, vega: farRow.pe.vega,
                        expiry: farExpiry,
                    };
                    return [nearLeg, farLeg];
                }
                : null,
        },
        // All-put condor with every strike shifted below current spot — the
        // bearish mirror of "Bull Condor" (same plateau shape, placed left of
        // center since the profit zone sits below today's price).
        {
            name: "Bear Condor", bias: "Bearish", shape: "bear-condor",
            legs: compact([
                leg(atm - gap, "PE", "buy"), leg(atm - 2 * gap, "PE", "sell"),
                leg(atm - 4 * gap, "PE", "sell"), leg(atm - 5 * gap, "PE", "buy"),
            ]),
        },
        // Bearish mirror of "Bull Butterfly" — a single peak below the money
        // instead of above it.
        {
            name: "Bear Butterfly", bias: "Bearish", shape: "bear-butterfly",
            legs: compact([
                leg(atm - gap, "PE", "buy"),
                leg(atm - 3 * gap, "PE", "sell", 2),
                leg(atm - 5 * gap, "PE", "buy"),
            ]),
        },
        // Sell an OTM call + buy an OTM put — the bearish mirror of
        // "Range Forward" above (a strangle-shaped combo trade, named by
        // directional convention rather than payoff shape).
        {
            name: "Risk Reversal", bias: "Bearish", shape: "risk-reversal",
            legs: compact([leg(atm + 2 * gap, "CE", "sell"), leg(atm - 2 * gap, "PE", "buy")]),
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
        // Reverse Jade Lizard: the upside/downside mirror of Jade Lizard —
        // short OTM call (naked) + short put vertical (short put, long
        // further-OTM put). No downside risk as long as the net credit
        // exceeds the put spread width; uncapped upside risk from the naked
        // short call (same trade-off as Jade Lizard, flipped).
        {
            name: "Reverse Jade Lizard", bias: "Neutral", shape: "reverse-jade-lizard",
            legs: compact([
                leg(atm + 3 * gap, "CE", "sell"),
                leg(atm - 2 * gap, "PE", "sell"), leg(atm - 4 * gap, "PE", "buy"),
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

// Display order within a category, matching the stockmojo.in reference
// screenshot exactly (2026-08-15) — buildPresets' own array order doesn't
// group same-bias entries contiguously (they're interleaved with their
// bullish/bearish mirror-pairs for easier side-by-side maintenance), so this
// re-sorts just for display. Names not listed here keep their natural
// relative order at the end, so adding a new preset never requires touching
// this list.
const CARD_ORDER = {
    Neutral: ["Short Straddle", "Short Strangle", "Short Iron Condor", "Short Iron Butterfly", "Batman", "Jade Lizard", "Reverse Jade Lizard", "Double Plateau"],
};

function sortForDisplay(presets, category) {
    const order = CARD_ORDER[category];
    if (!order) return presets;
    return [...presets].sort((a, b) => {
        const ia = order.indexOf(a.name);
        const ib = order.indexOf(b.name);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });
}

export default function PresetStrategies({ data, onApply, fetchExpiryRows }) {
    const presets = useMemo(() => buildPresets(data), [data]);
    const [category, setCategory] = useState("Other");
    const [loadingPreset, setLoadingPreset] = useState(null);

    const visible = sortForDisplay(presets.filter((p) => p.bias === category), category);

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
                                className="group rounded-xl border border-gray-200 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
                            >
                                <div className="rounded-lg bg-gray-50 p-2 transition group-hover:bg-blue-50">
                                    <PayoffIcon shape={p.shape} />
                                </div>
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
