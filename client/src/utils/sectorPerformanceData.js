// utils/sectorPerformanceData.js
//
// Demo data generator for the Sector Performance page. NOT real market data
// — this codebase has no sector-index price history anywhere (ohlcv_data
// only holds NIFTY/BANKNIFTY/FINNIFTY; a real version needs NSE sectoral
// index tokens discovered + a backfill effort, not started — same gap
// utils/rrgData.js documents for Sector Rotation). This produces a
// deterministic (seeded — stable across reloads, not re-randomised every
// render) set of period returns per sector, shaped like a real sector
// performance board: small 1D moves, larger 1Y moves, a spread of winners
// and losers. Every consumer MUST keep the "Demo data" label visible — see
// SectorPerformance.jsx.
import { SECTORS } from "./rrgData";

export const TIMEFRAMES = ["1D", "1W", "1M", "3M", "6M", "1Y", "YTD"];

// Rough max magnitude (%) a sector return spans over each window — used to
// scale the seeded noise so 1D reads as ±1-2% and 1Y as ±30-45%, like real
// index moves.
const SCALE = { "1D": 1.6, "1W": 4, "1M": 8, "3M": 15, "6M": 24, "1Y": 40, YTD: 30 };

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
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// One deterministic performance row per sector. `trend` is a per-sector
// directional bias in [-1, 1] so a sector that's up on 1M tends to also be
// up on 3M/1Y (correlated across windows), with independent seeded noise
// layered on each window so they're not just multiples of each other.
function buildRow(sector) {
    const rng = mulberry32(seedFromString(sector.key));
    const trend = rng() * 2 - 1; // long-run bias
    const returns = {};
    for (const tf of TIMEFRAMES) {
        const noise = rng() * 2 - 1;
        const biasWeight = tf === "1D" || tf === "1W" ? 0.45 : 0.75;
        const value = (trend * biasWeight + noise * (1 - biasWeight)) * SCALE[tf];
        returns[tf] = Math.round(value * 100) / 100;
    }
    return { ...sector, returns };
}

/** Demo performance board — one row per sector, stable for a given SECTORS list. */
export function buildSectorPerformance() {
    return SECTORS.map(buildRow);
}
