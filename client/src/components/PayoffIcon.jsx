// Small hand-authored payoff-shape previews for the Ready-Made Strategies
// cards — approximate curve shapes (green = profit zone, red = loss zone),
// not computed from real data. Mirrors stockmojo's strategy picker icons.
// Each shape is an ordered list of colored segments (drawn left to right)
// rather than fixed named slots, since some shapes (twin-peak strategies
// like Batman) need more than two color transitions.
const SHAPES = {
    "long-straddle": [
        { c: "green", pts: [[5, 10], [22, 30]] },
        { c: "red", pts: [[22, 30], [35, 38], [50, 44], [65, 38], [78, 30]] },
        { c: "green", pts: [[78, 30], [95, 10]] },
    ],
    "short-straddle": [
        { c: "red", pts: [[5, 44], [22, 30]] },
        { c: "green", pts: [[22, 30], [50, 8], [78, 30]] },
        { c: "red", pts: [[78, 30], [95, 44]] },
    ],
    "long-strangle": [
        { c: "green", pts: [[5, 10], [25, 30]] },
        { c: "red", pts: [[25, 30], [40, 42], [60, 42], [75, 30]] },
        { c: "green", pts: [[75, 30], [95, 10]] },
    ],
    "short-strangle": [
        { c: "red", pts: [[5, 44], [25, 30]] },
        { c: "green", pts: [[25, 30], [40, 10], [60, 10], [75, 30]] },
        { c: "red", pts: [[75, 30], [95, 44]] },
    ],
    "short-iron-condor": [
        { c: "red", pts: [[0, 40], [15, 40], [25, 30]] },
        { c: "green", pts: [[25, 30], [35, 15], [65, 15], [75, 30]] },
        { c: "red", pts: [[75, 30], [85, 40], [100, 40]] },
    ],
    "short-iron-butterfly": [
        { c: "red", pts: [[0, 40], [20, 40], [30, 28]] },
        { c: "green", pts: [[30, 28], [50, 8], [70, 28]] },
        { c: "red", pts: [[70, 28], [80, 40], [100, 40]] },
    ],
    "bull-call-spread": [
        { c: "red", pts: [[0, 40], [30, 40], [45, 30]] },
        { c: "green", pts: [[45, 30], [60, 12], [100, 12]] },
    ],
    "bear-put-spread": [
        { c: "green", pts: [[0, 12], [40, 12], [55, 30]] },
        { c: "red", pts: [[55, 30], [70, 40], [100, 40]] },
    ],
    // No upside risk: profit plateaus (flat) to the right past the short
    // call spread, loss grows to the left below the short put.
    "jade-lizard": [
        { c: "red", pts: [[0, 44], [25, 20]] },
        { c: "green", pts: [[25, 20], [55, 10], [100, 10]] },
    ],
    // Mirror of jade-lizard: flat profit plateau on the downside (no risk
    // there), uncapped loss on the upside (naked short call).
    "reverse-jade-lizard": [
        { c: "green", pts: [[0, 10], [45, 10], [75, 20]] },
        { c: "red", pts: [[75, 20], [100, 44]] },
    ],
    // Retail-glossary name for a twin-peak payoff (see PresetStrategies.jsx
    // comment) — offset call + put butterflies produce two peaks with a dip
    // at ATM, resembling bat ears.
    "batman": [
        { c: "red", pts: [[0, 44], [15, 44], [24, 32]] },
        { c: "green", pts: [[24, 32], [35, 14]] },
        { c: "red", pts: [[35, 14], [50, 26]] },
        { c: "green", pts: [[50, 26], [65, 14]] },
        { c: "red", pts: [[65, 14], [76, 32], [85, 44], [100, 44]] },
    ],
    // Retail-glossary name for two separate flat max-profit zones (see
    // PresetStrategies.jsx comment) — two credit spreads closer together
    // than a standard iron condor.
    "double-plateau": [
        { c: "red", pts: [[0, 40], [15, 40], [25, 30]] },
        { c: "green", pts: [[25, 30], [35, 20], [42, 20]] },
        { c: "red", pts: [[42, 20], [50, 30], [58, 20]] },
        { c: "green", pts: [[58, 20], [65, 20], [75, 30]] },
        { c: "red", pts: [[75, 30], [85, 40], [100, 40]] },
    ],
    "long-iron-condor": [
        { c: "green", pts: [[0, 15], [15, 15], [25, 30]] },
        { c: "red", pts: [[25, 30], [35, 40], [65, 40], [75, 30]] },
        { c: "green", pts: [[75, 30], [85, 15], [100, 15]] },
    ],
    "long-iron-butterfly": [
        { c: "green", pts: [[0, 15], [30, 15], [42, 32]] },
        { c: "red", pts: [[42, 32], [50, 40], [58, 32]] },
        { c: "green", pts: [[58, 32], [70, 15], [100, 15]] },
    ],
    "call-ratio-spread": [
        { c: "red", pts: [[0, 34], [30, 34], [40, 22]] },
        { c: "green", pts: [[40, 22], [55, 10], [65, 22]] },
        { c: "red", pts: [[65, 22], [80, 40], [100, 46]] },
    ],
    "put-ratio-spread": [
        { c: "red", pts: [[0, 46], [20, 40], [35, 22]] },
        { c: "green", pts: [[35, 22], [45, 10], [60, 22]] },
        { c: "red", pts: [[60, 22], [70, 34], [100, 34]] },
    ],
    // Naked long call: flat loss (premium paid) up to the strike, unlimited
    // upside past it — never flattens back out, unlike a call spread.
    "buy-call": [
        { c: "red", pts: [[0, 40], [45, 40], [55, 30]] },
        { c: "green", pts: [[55, 30], [100, 6]] },
    ],
    // Naked short put: loss grows below the strike, profit caps at the
    // premium collected once price is above it.
    "sell-put": [
        { c: "red", pts: [[0, 44], [45, 30]] },
        { c: "green", pts: [[45, 30], [58, 22], [100, 22]] },
    ],
    // Buy call + sell put at the same strike replicates a linear futures
    // payoff — a single uninterrupted diagonal, no flat zones either side.
    "long-synthetic-future": [
        { c: "red", pts: [[0, 44], [50, 27]] },
        { c: "green", pts: [[50, 27], [100, 8]] },
    ],
    // Same risk/reward shape as bull-call-spread (a bullish vertical always
    // looks like this regardless of whether it's built with calls or puts,
    // debit or credit) — kept as its own key so PresetStrategies can label
    // it distinctly.
    "bull-put-spread": [
        { c: "red", pts: [[0, 40], [30, 40], [45, 30]] },
        { c: "green", pts: [[45, 30], [60, 12], [100, 12]] },
    ],
    // All-call condor with every strike shifted above current spot — same
    // plateau shape as a short iron condor, just placed to the right instead
    // of centered, since the profit zone sits above today's price.
    "bull-condor": [
        { c: "red", pts: [[0, 40], [20, 40], [32, 30]] },
        { c: "green", pts: [[32, 30], [45, 15], [70, 15], [80, 26]] },
        { c: "red", pts: [[80, 26], [90, 36], [100, 40]] },
    ],
    // Same idea as bull-condor but a butterfly (single peak) instead of a
    // plateau, shifted right of center for the same reason.
    "bull-butterfly": [
        { c: "red", pts: [[0, 40], [35, 40], [48, 30]] },
        { c: "green", pts: [[48, 30], [62, 14], [76, 30]] },
        { c: "red", pts: [[76, 30], [88, 38], [100, 40]] },
    ],
    // Calendar spread (sell near-dated, buy far-dated at the same strike),
    // evaluated at the near leg's expiry: bounded loss on both wings (capped
    // at the net debit paid), single peak near the strike where the near
    // leg has fully decayed but the far leg still holds time value.
    "long-calendar-call": [
        { c: "red", pts: [[0, 34], [30, 32]] },
        { c: "green", pts: [[30, 32], [50, 14], [70, 32]] },
        { c: "red", pts: [[70, 32], [100, 34]] },
    ],
    // Same payoff shape as long-calendar-call regardless of calls vs. puts
    // (a calendar spread's shape comes from the time-decay differential
    // between near/far legs, not which right they're built with) — kept as
    // its own key so PresetStrategies can label it distinctly, same
    // convention as bull-put-spread reusing bull-call-spread's shape.
    "long-calendar-put": [
        { c: "red", pts: [[0, 34], [30, 32]] },
        { c: "green", pts: [[30, 32], [50, 14], [70, 32]] },
        { c: "red", pts: [[70, 32], [100, 34]] },
    ],
    // Naked long put: bearish mirror of buy-call — flat loss (premium paid)
    // above the strike (put worthless while spot stays high), profit grows
    // unbounded as spot falls below it.
    "buy-put": [
        { c: "green", pts: [[0, 6], [45, 30]] },
        { c: "red", pts: [[45, 30], [55, 40], [100, 40]] },
    ],
    // Naked short call: bearish mirror of sell-put — profit caps at the
    // premium collected while price stays below the strike, loss grows
    // unbounded above it.
    "sell-call": [
        { c: "green", pts: [[0, 22], [42, 22], [55, 30]] },
        { c: "red", pts: [[55, 30], [100, 44]] },
    ],
    // Buy put + sell call at the same strike replicates a linear short
    // futures payoff — the bearish mirror of long-synthetic-future (a single
    // descending diagonal instead of ascending).
    "short-synthetic-future": [
        { c: "green", pts: [[0, 8], [50, 27]] },
        { c: "red", pts: [[50, 27], [100, 44]] },
    ],
    // Same risk/reward shape as bear-put-spread (a bearish vertical always
    // looks like this regardless of whether it's built with calls or puts,
    // credit or debit) — kept as its own key so PresetStrategies can label
    // it distinctly, same convention as bull-put-spread above.
    "bear-call-spread": [
        { c: "green", pts: [[0, 12], [40, 12], [55, 30]] },
        { c: "red", pts: [[55, 30], [70, 40], [100, 40]] },
    ],
    // All-put condor with every strike shifted below current spot — same
    // plateau shape as bull-condor, mirrored, since the profit zone here
    // sits below today's price instead of above it.
    "bear-condor": [
        { c: "red", pts: [[0, 40], [10, 36], [20, 26]] },
        { c: "green", pts: [[20, 26], [30, 15], [55, 15], [68, 30]] },
        { c: "red", pts: [[68, 30], [80, 40], [100, 40]] },
    ],
    // Same idea as bear-condor but a butterfly (single peak) instead of a
    // plateau — the bearish mirror of bull-butterfly.
    "bear-butterfly": [
        { c: "red", pts: [[0, 40], [12, 38], [24, 30]] },
        { c: "green", pts: [[24, 30], [38, 14], [52, 30]] },
        { c: "red", pts: [[52, 30], [65, 40], [100, 40]] },
    ],
    // Buy an OTM call + sell an OTM put — bounded/flattish P&L between the
    // two strikes, unbounded profit above the call strike, unbounded loss
    // below the put strike.
    "range-forward": [
        { c: "red", pts: [[0, 42], [28, 30]] },
        { c: "green", pts: [[28, 30], [45, 24], [55, 24], [72, 18]] },
        { c: "green", pts: [[72, 18], [100, 4]] },
    ],
    // Sell an OTM call + buy an OTM put — the bearish mirror of
    // range-forward (unbounded profit below the put strike, unbounded loss
    // above the call strike).
    "risk-reversal": [
        { c: "green", pts: [[0, 4], [28, 18]] },
        { c: "red", pts: [[28, 18], [45, 24], [55, 24], [72, 30]] },
        { c: "red", pts: [[72, 30], [100, 44]] },
    ],
};

const COLORS = { green: "#10b981", red: "#f43f5e" };

function pointsToStr(points) {
    return points.map(([x, y]) => `${x},${y}`).join(" ");
}

export default function PayoffIcon({ shape }) {
    const segments = SHAPES[shape];
    if (!segments) return null;
    return (
        <svg viewBox="0 0 100 50" className="h-12 w-full" preserveAspectRatio="none">
            {segments.map((seg, i) => (
                <polyline
                    key={i}
                    points={pointsToStr(seg.pts)}
                    fill="none"
                    stroke={COLORS[seg.c]}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            ))}
        </svg>
    );
}
