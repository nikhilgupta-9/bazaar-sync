// utils/rrgData.js
//
// Demo data generator for the Sector Rotation (Relative Rotation Graph) page.
// NOT real market data — no sector-index historical price series exists
// anywhere in this codebase yet (confirmed: ohlcv_data only has NIFTY/
// BANKNIFTY/FINNIFTY; a real "Sector Rotation" needs new Angel One index
// tokens discovered + a backfill effort, not started). This generates a
// deterministic (seeded, stable across reloads — not re-randomized every
// render) demo dataset shaped like a real RRG: JdK-style RS-Ratio ("Trend")
// and RS-Momentum ("Momentum") values oscillating around the neutral 100
// baseline, one smoothed random-walk tail per sector. Every consumer of
// this module must keep the "Demo data" labeling visible — see
// SectorRotation.jsx.

// Real NSE sectoral/thematic index names (the names themselves are real;
// the price series behind them here is not).
export const SECTORS = [
    { key: "BANKNIFTY", label: "BANKNIFTY" },
    { key: "SENSEX", label: "SENSEX" },
    { key: "FINNIFTY", label: "FINNIFTY" },
    { key: "MIDCAP", label: "MIDCAP" },
    { key: "AUTO", label: "AUTO" },
    { key: "CAPITAL_MRKT", label: "CAPITAL MRKT" },
    { key: "CHEMICALS", label: "CHEMICALS" },
    { key: "COMMODITIES", label: "COMMODITIES" },
    { key: "CONSR_DURBL", label: "CONSR DURBL" },
    { key: "CONSUMPTION", label: "CONSUMPTION" },
    { key: "DEFENCE", label: "DEFENCE" },
    { key: "ENERGY", label: "ENERGY" },
    { key: "FMCG", label: "FMCG" },
    { key: "HEALTHCARE", label: "HEALTHCARE" },
    { key: "INFRA", label: "INFRA" },
    { key: "IT", label: "IT" },
    { key: "MEDIA", label: "MEDIA" },
    { key: "METAL", label: "METAL" },
    { key: "OIL_GAS", label: "OIL & GAS" },
    { key: "PHARMA", label: "PHARMA" },
    { key: "PSU_BANK", label: "PSU BANK" },
    { key: "PVT_BANK", label: "PVT BANK" },
    { key: "REALTY", label: "REALTY" },
    { key: "SERVICES", label: "SERVICES" },
];

// 24 visually distinct colors — extends the app's validated 8-hue
// categorical palette with sensible secondary steps. A 24-series chart
// can't clear strict adjacent-pair CVD separation for every pair (the
// dataviz skill's own palette caps clean coverage at 8) — identity here
// also rides on the direct label at each sector's current point and the
// bottom quadrant-summary list, never color alone.
const COLORS = [
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7", "#e34948", "#008300",
    "#6ba3e8", "#f08c5c", "#4ecca3", "#f0b93d", "#f0a0c0", "#7d6bc4", "#e87977", "#4da84d",
    "#1c4f8a", "#a8451f", "#0f7a52", "#a66c00", "#a84a72", "#2e2266", "#a12220", "#005200",
];

// Small deterministic string hash -> seeded PRNG (mulberry32), so the same
// sector name always produces the same-looking path across reloads instead
// of a fresh random shape every time (a fixed demo fixture reads as more
// honestly "this is canned data", not as a live-but-broken feed).
function seedFromString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
}
function mulberry32(seed) {
    let a = seed;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const TAIL_LENGTH = 20; // number of historical points per sector

// A smoothed 2D random walk around (100, 100) with a per-sector directional
// bias (so the final mix of sectors plausibly spans all four quadrants,
// rather than every sector drifting the same way) and a light moving-average
// pass so the tail reads as a smooth arc, matching how real RRG tails look.
function buildSectorPath(seedKey) {
    const rng = mulberry32(seedFromString(seedKey));
    const biasAngle = rng() * Math.PI * 2;
    const biasStrength = 0.35 + rng() * 0.5;
    const biasX = Math.cos(biasAngle) * biasStrength;
    const biasY = Math.sin(biasAngle) * biasStrength;

    const raw = [{ x: 100, y: 100 }];
    for (let i = 1; i < TAIL_LENGTH; i++) {
        const prev = raw[i - 1];
        const swirl = Math.sin(i * 0.6 + biasAngle) * 0.3;
        raw.push({
            x: prev.x + biasX * 0.35 + (rng() - 0.5) * 1.1 + swirl,
            y: prev.y + biasY * 0.35 + (rng() - 0.5) * 1.1 - swirl,
        });
    }

    // 3-point moving average smoothing pass (edges keep their raw value).
    const smoothed = raw.map((p, i) => {
        if (i === 0 || i === raw.length - 1) return p;
        const prev = raw[i - 1], next = raw[i + 1];
        return { x: (prev.x + p.x * 2 + next.x) / 4, y: (prev.y + p.y * 2 + next.y) / 4 };
    });
    return smoothed;
}

/** One demo path per sector, generated once (stable across reloads for a given SECTORS list). */
export function buildDemoDataset() {
    return SECTORS.map((s, i) => ({
        ...s,
        color: COLORS[i % COLORS.length],
        path: buildSectorPath(s.key),
    }));
}

/** Leading / Weakening / Lagging / Improving, from the standard RRG quadrant split at (100, 100). */
export function classifyQuadrant(point) {
    const trendUp = point.x >= 100;
    const momentumUp = point.y >= 100;
    if (trendUp && momentumUp) return "Leading";
    if (trendUp && !momentumUp) return "Weakening";
    if (!trendUp && !momentumUp) return "Lagging";
    return "Improving";
}

export const QUADRANT_COLORS = {
    Leading: { bg: "#0f2e1e", text: "#22c55e" },
    Weakening: { bg: "#332a0f", text: "#eab308" },
    Lagging: { bg: "#3a1416", text: "#ef4444" },
    Improving: { bg: "#12213d", text: "#3b82f6" },
};
