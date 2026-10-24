// Client-side port of server/utils/blackScholes.js's pricing formula (not the
// IV solver — legs already carry their entry IV from the option chain
// response). Needed so the Strategy Builder can show a "Today" mark-to-market
// curve (time value included) alongside the "Expiry" intrinsic-only curve,
// entirely client-side for an interactive chart (no per-point backend round trip).

const RISK_FREE_RATE = 0.065;

function erf(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

export function normCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function bsPrice(arg1, strike, t, vol, right, r = RISK_FREE_RATE) {
    let spot;
    if (typeof arg1 === "object" && arg1 !== null) {
        spot = arg1.spot;
        strike = arg1.strike;
        t = arg1.t;
        vol = arg1.vol;
        right = arg1.right;
        r = arg1.r ?? RISK_FREE_RATE;
    } else {
        spot = arg1;
    }
    const isCall = right === "CE" || right === "call" || right === "CALL";
    if (vol <= 0 || t <= 0) return Math.max(0, isCall ? spot - strike : strike - spot);
    const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * Math.sqrt(t));
    const d2 = d1 - vol * Math.sqrt(t);
    return isCall
        ? spot * normCdf(d1) - strike * Math.exp(-r * t) * normCdf(d2)
        : strike * Math.exp(-r * t) * normCdf(-d2) - spot * normCdf(-d1);
}

export function impliedVolatility(arg1, strike, t, right, r = RISK_FREE_RATE) {
    let marketPrice, spot;
    if (typeof arg1 === "object" && arg1 !== null) {
        marketPrice = arg1.marketPrice;
        spot = arg1.spot;
        strike = arg1.strike;
        t = arg1.t;
        right = arg1.right;
        r = arg1.r ?? RISK_FREE_RATE;
    } else {
        marketPrice = arg1;
    }
    if (!marketPrice || marketPrice <= 0 || t <= 0) return null;
    let lo = 0.001, hi = 5.0;
    for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        const price = bsPrice({ spot, strike, t, vol: mid, right, r });
        if (Math.abs(price - marketPrice) < 0.01) return mid;
        if (price > marketPrice) hi = mid;
        else lo = mid;
    }
    return (lo + hi) / 2;
}

function clampFinite(value, cap) {
    if (!Number.isFinite(value)) return 0;
    if (value > cap) return cap;
    if (value < -cap) return -cap;
    return value;
}

export function calculateGreeks(arg1, strike, t, vol, right, r = RISK_FREE_RATE) {
    let spot;
    if (typeof arg1 === "object" && arg1 !== null) {
        spot = arg1.spot;
        strike = arg1.strike;
        t = arg1.t;
        vol = arg1.vol;
        right = arg1.right;
        r = arg1.r ?? RISK_FREE_RATE;
    } else {
        spot = arg1;
    }
    const isCall = right === "CE" || right === "call" || right === "CALL";
    if (!vol || vol <= 0 || t <= 0) {
        return { delta: isCall ? (spot > strike ? 1 : 0) : (spot < strike ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
    }
    const sqrtT = Math.sqrt(t);
    const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * sqrtT);
    const d2 = d1 - vol * sqrtT;
    const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
    const gamma = normPdf(d1) / (spot * vol * sqrtT);
    const vega = (spot * normPdf(d1) * sqrtT) / 100; // per 1% vol change
    const theta = isCall
        ? (-(spot * normPdf(d1) * vol) / (2 * sqrtT) - r * strike * Math.exp(-r * t) * normCdf(d2)) / 365
        : (-(spot * normPdf(d1) * vol) / (2 * sqrtT) + r * strike * Math.exp(-r * t) * normCdf(-d2)) / 365;
    return {
        delta: clampFinite(delta, 1),
        gamma: clampFinite(gamma, 50),
        theta: clampFinite(theta, 5000),
        vega: clampFinite(vega, 5000),
    };
}

// Years remaining until expiry, using 15:30 IST as the cutoff. Expiry comes
// in as plain "YYYY-MM-DD" (the DB's dateStrings-mode format — see CLAUDE.md
// Gotcha #12) — parsed manually, not via `new Date(nonISOString)`, which is
// timezone-dependent and has caused a real off-by-one-day bug elsewhere in
// this project.

// Calendar-day difference (not fractional years) between today and expiry,
// for the "(0d)", "(7d)" labels next to each expiry — matches stockmojo's
// expiry selector. Same manual-parsing approach as yearsToExpiry, so today
// vs. expiry-day both show "0d" regardless of the time of day.
export function daysUntilExpiry(expiryStr) {
    if (!expiryStr) return 0;
    const cleanStr = String(expiryStr).slice(0, 10);
    const [year, month, day] = cleanStr.split("-").map(Number);
    if (!year || !month || !day) return 0;
    const expiryUtcMidnight = Date.UTC(year, month - 1, day);
    const now = new Date();
    const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.round((expiryUtcMidnight - todayUtcMidnight) / (24 * 60 * 60 * 1000)));
}

// `fromMs` defaults to the real clock (live Strategy Builder use), but can be
// passed explicitly to price "as of" a historical instant instead — e.g. the
// Simulator computing time-to-expiry as of the replayed minute, not now.
export function yearsToExpiry(expiryStr, fromMs = Date.now()) {
    if (!expiryStr) return 1 / (365 * 24 * 4);
    const cleanStr = String(expiryStr).slice(0, 10);
    const [year, month, day] = cleanStr.split("-").map(Number);
    if (!year || !month || !day) return 1 / (365 * 24 * 4);
    // IST is UTC+5:30; 15:30 IST = 10:00 UTC. Built via Date.UTC so this
    // doesn't depend on the browser's local timezone.
    const expiryUtcMs = Date.UTC(year, month - 1, day, 10, 0, 0);
    const ms = expiryUtcMs - fromMs;
    return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4));
}

// Probability of Profit (POP) calculator based on lognormal price distribution at expiry
export function calculatePOP({ chartData, spot, tYears = 0.05, avgIv = 0.50, r = RISK_FREE_RATE }) {
    if (!chartData || chartData.length < 2 || !spot || spot <= 0) return 50.0;
    const vol = Math.max(0.05, avgIv);
    const t = Math.max(1 / 365, tYears);
    const drift = (r - 0.5 * vol * vol) * t;
    const volSqrtT = vol * Math.sqrt(t);

    let probSum = 0;
    let totalProb = 0;

    for (let i = 0; i < chartData.length; i++) {
        const pt = chartData[i];
        const prevPrice = i > 0 ? (chartData[i - 1].price + pt.price) / 2 : pt.price * 0.99;
        const nextPrice = i < chartData.length - 1 ? (chartData[i + 1].price + pt.price) / 2 : pt.price * 1.01;
        const pDelta = Math.max(0.1, nextPrice - prevPrice);

        const logRatio = Math.log(pt.price / spot);
        const z = (logRatio - drift) / volSqrtT;
        const pdf = normPdf(z) / (pt.price * volSqrtT);
        const pSlice = pdf * pDelta;

        totalProb += pSlice;
        if (pt.expiryPnl > 0) {
            probSum += pSlice;
        }
    }

    if (totalProb <= 0) return 50.0;
    const pop = (probSum / totalProb) * 100;
    return Math.min(99.0, Math.max(1.0, parseFloat(pop.toFixed(1))));
}


