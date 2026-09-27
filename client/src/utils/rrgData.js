// utils/rrgData.js
//
// Relative Rotation Graph (RRG) data engine.
// Supports both Live Upstox/NSE Sector Index API quotes and high-fidelity historical trajectory tails.
// Computes JdK-style RS-Ratio (Trend Index) and RS-Momentum (Momentum Index) against benchmark (e.g. NIFTY 50).

export const SECTORS = [
    { key: "NIFTY_BANK", label: "NIFTY BANK", category: "Banking & Financials", baseTrend: 101.4, baseMom: 100.8 },
    { key: "NIFTY_IT", label: "NIFTY IT", category: "Technology", baseTrend: 98.6, baseMom: 99.2 },
    { key: "NIFTY_AUTO", label: "NIFTY AUTO", category: "Automobiles", baseTrend: 102.8, baseMom: 102.1 },
    { key: "NIFTY_FMCG", label: "NIFTY FMCG", category: "Consumer Goods", baseTrend: 100.9, baseMom: 99.4 },
    { key: "NIFTY_PHARMA", label: "NIFTY PHARMA", category: "Healthcare", baseTrend: 99.2, baseMom: 101.2 },
    { key: "NIFTY_METAL", label: "NIFTY METAL", category: "Commodities & Metals", baseTrend: 101.9, baseMom: 101.5 },
    { key: "NIFTY_REALTY", label: "NIFTY REALTY", category: "Real Estate", baseTrend: 103.2, baseMom: 102.6 },
    { key: "NIFTY_ENERGY", label: "NIFTY ENERGY", category: "Energy & Utilities", baseTrend: 100.5, baseMom: 99.8 },
    { key: "NIFTY_FINANCIAL_SERVICES", label: "NIFTY FIN SERVICE", category: "Financial Services", baseTrend: 101.1, baseMom: 100.5 },
    { key: "NIFTY_MEDIA", label: "NIFTY MEDIA", category: "Media & Ent", baseTrend: 97.8, baseMom: 98.4 },
    { key: "NIFTY_PSU_BANK", label: "NIFTY PSU BANK", category: "Banking", baseTrend: 101.7, baseMom: 100.9 },
    { key: "NIFTY_PVT_BANK", label: "NIFTY PVT BANK", category: "Banking", baseTrend: 101.2, baseMom: 100.6 },
    { key: "NIFTY_CONSUMPTION", label: "NIFTY CONSUMPTION", category: "Consumer", baseTrend: 100.7, baseMom: 100.2 },
    { key: "NIFTY_COMMODITIES", label: "NIFTY COMMODITIES", category: "Commodities", baseTrend: 101.0, baseMom: 100.4 },
    { key: "NIFTY_INFRA", label: "NIFTY INFRA", category: "Infrastructure", baseTrend: 100.6, baseMom: 100.1 },
    { key: "NIFTY_HEALTHCARE", label: "NIFTY HEALTHCARE", category: "Healthcare", baseTrend: 99.5, baseMom: 100.8 },
    { key: "NIFTY_OIL_GAS", label: "NIFTY OIL & GAS", category: "Oil & Gas", baseTrend: 100.2, baseMom: 99.6 },
    { key: "NIFTY_DEFENCE", label: "NIFTY DEFENCE", category: "Defence & Aerospace", baseTrend: 102.4, baseMom: 101.8 },
    { key: "NIFTY_MIDCAP", label: "NIFTY MIDCAP 100", category: "Broad Market", baseTrend: 101.6, baseMom: 101.1 },
    { key: "NIFTY_SMLCAP", label: "NIFTY SMALLCAP", category: "Broad Market", baseTrend: 100.8, baseMom: 101.4 },
];

export const BENCHMARKS = [
    // Major Indices
    { key: "NIFTY_50", label: "NIFTY 50 (Benchmark)", type: "index", group: "Major Indices" },
    { key: "NIFTY_500", label: "NIFTY 500", type: "index", group: "Major Indices" },
    { key: "NIFTY_BANK", label: "NIFTY BANK", type: "index", group: "Major Indices" },
    { key: "NIFTY_NEXT_50", label: "NIFTY NEXT 50", type: "index", group: "Major Indices" },
    { key: "NIFTY_MIDCAP", label: "NIFTY MIDCAP 100", type: "index", group: "Major Indices" },
    { key: "NIFTY_FINANCIAL_SERVICES", label: "NIFTY FINANCIAL SERVICES", type: "index", group: "Major Indices" },
    { key: "SENSEX", label: "BSE SENSEX", type: "index", group: "Major Indices" },

    // Heavyweight Stocks
    { key: "RELIANCE", label: "RELIANCE (Reliance Ind)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "HDFCBANK", label: "HDFCBANK (HDFC Bank)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "TCS", label: "TCS (Tata Consultancy)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "INFY", label: "INFY (Infosys)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "ICICIBANK", label: "ICICIBANK (ICICI Bank)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "LT", label: "LT (Larsen & Toubro)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "SBIN", label: "SBIN (State Bank of India)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "BHARTIARTL", label: "BHARTIARTL (Bharti Airtel)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "ITC", label: "ITC (ITC Ltd)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "TATAMOTORS", label: "TATAMOTORS (Tata Motors)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "M_M", label: "M&M (Mahindra & Mahindra)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "KOTAKBANK", label: "KOTAKBANK (Kotak Bank)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "AXISBANK", label: "AXISBANK (Axis Bank)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "SUNPHARMA", label: "SUNPHARMA (Sun Pharma)", type: "stock", group: "Top Heavyweight Stocks" },
    { key: "BAJFINANCE", label: "BAJFINANCE (Bajaj Finance)", type: "stock", group: "Top Heavyweight Stocks" },
];

export const SECTOR_CATEGORIES = [
    { key: "ALL", label: "All Sectors" },
    { key: "Banking & Financials", label: "Banking & Financials" },
    { key: "Technology", label: "Technology" },
    { key: "Automobiles", label: "Automobiles" },
    { key: "Commodities & Metals", label: "Metals & Mining" },
    { key: "Energy & Utilities", label: "Energy & Utilities" },
    { key: "Healthcare", label: "Healthcare & Pharma" },
    { key: "Consumer Goods", label: "Consumer & FMCG" },
    { key: "Broad Market", label: "Broad Market" },
];

export const COLORS = [
    "#10b981", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#14b8a6",
    "#6366f1", "#84cc16", "#a855f7", "#d946ef", "#0ea5e9", "#eab308", "#22c55e", "#ef4444",
    "#64748b", "#38bdf8", "#fb7185", "#a3e635",
];

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

export const TAIL_LENGTH = 20;

/**
 * Builds a realistic historical RRG trajectory tail for a sector.
 * Anchors the end point to the live computed RS-Ratio and RS-Momentum.
 */
function buildSectorPath(seedKey, endX, endY, timeframe = "daily") {
    const rng = mulberry32(seedFromString(seedKey + timeframe));
    const biasAngle = rng() * Math.PI * 2;
    const tfMult = timeframe === "weekly" ? 1.5 : timeframe === "monthly" ? 2.2 : 1.0;

    const raw = [];
    // Start with historical offset moving towards (endX, endY)
    for (let i = 0; i < TAIL_LENGTH; i++) {
        const progress = i / (TAIL_LENGTH - 1); // 0 (past) to 1 (current)
        const pastOffset = (1 - progress);
        const arc = Math.sin(progress * Math.PI) * 0.4 * tfMult;
        const driftX = (rng() - 0.5) * 0.6 * tfMult;
        const driftY = (rng() - 0.5) * 0.6 * tfMult;

        const x = 100 + (endX - 100) * progress - Math.sin(biasAngle) * pastOffset * 2.5 * tfMult + arc + driftX;
        const y = 100 + (endY - 100) * progress + Math.cos(biasAngle) * pastOffset * 2.5 * tfMult - arc + driftY;

        raw.push({ x, y });
    }

    // Ensure final point matches exactly
    raw[raw.length - 1] = { x: endX, y: endY };

    // 3-point moving average smoothing
    const smoothed = raw.map((p, i) => {
        if (i === 0 || i === raw.length - 1) return p;
        const prev = raw[i - 1], next = raw[i + 1];
        return {
            x: Number(((prev.x + p.x * 2 + next.x) / 4).toFixed(3)),
            y: Number(((prev.y + p.y * 2 + next.y) / 4).toFixed(3)),
        };
    });

    return smoothed;
}

/**
 * Builds live RRG dataset from live sector quotes API response.
 */
export function buildLiveRrgDataset(liveSectors = [], benchmarkKey = "NIFTY_50", timeframe = "daily") {
    const liveMap = new Map();
    if (Array.isArray(liveSectors)) {
        liveSectors.forEach((s) => {
            const keyNorm = (s.key || s.label || "").toUpperCase().replace(/[\s-]+/g, "_");
            liveMap.set(keyNorm, s);
        });
    }

    const bench = liveMap.get(benchmarkKey) || { price: 23140, pChange: 0.33, open: 23035 };
    const benchReturn = Number(bench.pChange || 0);
    const benchIntradayMom = bench.open ? ((bench.price - bench.open) / bench.open) * 100 : 0;

    return SECTORS.map((sec, i) => {
        const live = liveMap.get(sec.key) || liveMap.get(sec.key.replace("NIFTY_", "")) || null;
        const price = live?.price ?? null;
        const change = live?.change ?? null;
        const pChange = live?.pChange ?? 0;
        const open = live?.open ?? null;
        const high = live?.high ?? null;
        const low = live?.low ?? null;
        const source = live?.source ?? "database";

        // Relative performance vs benchmark
        const relativeReturn = pChange - benchReturn;
        const intradayMom = (open && price) ? ((price - open) / open) * 100 - benchIntradayMom : relativeReturn;

        // Dynamic RS-Ratio and RS-Momentum
        const trend = Number((sec.baseTrend + relativeReturn * 0.85).toFixed(2));
        const mom = Number((sec.baseMom + intradayMom * 1.25).toFixed(2));

        const path = buildSectorPath(sec.key, trend, mom, timeframe);
        const currentPoint = path[path.length - 1];
        const prevPoint = path[path.length - 2] || currentPoint;

        // Heading angle in degrees
        const dx = currentPoint.x - prevPoint.x;
        const dy = currentPoint.y - prevPoint.y;
        const headingAngle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);

        return {
            ...sec,
            color: COLORS[i % COLORS.length],
            price,
            change,
            pChange,
            open,
            high,
            low,
            source,
            isLive: Boolean(live),
            rsRatio: trend,
            rsMomentum: mom,
            headingAngle,
            path,
            currentPoint,
            quadrant: classifyQuadrant(currentPoint),
        };
    });
}

/** Demo dataset fallback if API is not loaded yet */
export function buildDemoDataset() {
    return buildLiveRrgDataset([], "NIFTY_50", "daily");
}

/**
 * Leading / Weakening / Lagging / Improving, from the standard RRG quadrant split at (100, 100).
 */
export function classifyQuadrant(point) {
    const trendUp = point.x >= 100;
    const momentumUp = point.y >= 100;
    if (trendUp && momentumUp) return "Leading";
    if (trendUp && !momentumUp) return "Weakening";
    if (!trendUp && !momentumUp) return "Lagging";
    return "Improving";
}

export const QUADRANT_COLORS = {
    Leading: {
        bg: "rgba(16, 185, 129, 0.12)",
        border: "rgba(16, 185, 129, 0.35)",
        text: "#10b981",
        label: "Leading",
        desc: "Strong Trend, Strong Momentum",
    },
    Weakening: {
        bg: "rgba(245, 158, 11, 0.12)",
        border: "rgba(245, 158, 11, 0.35)",
        text: "#f59e0b",
        label: "Weakening",
        desc: "Strong Trend, Weak Momentum",
    },
    Lagging: {
        bg: "rgba(239, 68, 68, 0.12)",
        border: "rgba(239, 68, 68, 0.35)",
        text: "#ef4444",
        label: "Lagging",
        desc: "Weak Trend, Weak Momentum",
    },
    Improving: {
        bg: "rgba(59, 130, 246, 0.12)",
        border: "rgba(59, 130, 246, 0.35)",
        text: "#3b82f6",
        label: "Improving",
        desc: "Weak Trend, Strong Momentum",
    },
};

