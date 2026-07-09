// Black-Scholes IV solver + Greeks. Breeze provides neither IV nor Greeks
// anywhere (live or historical) — see CLAUDE.md gotchas — so these are
// computed from LTP + spot + strike + time-to-expiry ourselves.

const RISK_FREE_RATE = 0.065; // approx Indian short-term rate, configurable later

function erf(x) {
    // Abramowitz-Stegun approximation, good to ~1e-7
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
}

function normCdf(x) {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normPdf(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// years remaining until expiry, using 15:30 IST as the expiry cutoff
function yearsToExpiry(expiryDate, now = new Date()) {
    const expiry = new Date(expiryDate);
    expiry.setHours(15, 30, 0, 0);
    const ms = expiry.getTime() - now.getTime();
    return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4)); // floor at 15 min
}

function bsPrice({ spot, strike, t, vol, right, r = RISK_FREE_RATE }) {
    if (vol <= 0 || t <= 0) return Math.max(0, right === "call" ? spot - strike : strike - spot);
    const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * Math.sqrt(t));
    const d2 = d1 - vol * Math.sqrt(t);
    return right === "call"
        ? spot * normCdf(d1) - strike * Math.exp(-r * t) * normCdf(d2)
        : strike * Math.exp(-r * t) * normCdf(-d2) - spot * normCdf(-d1);
}

// Bisection solve for implied volatility from a market price.
function impliedVolatility({ marketPrice, spot, strike, t, right, r = RISK_FREE_RATE }) {
    if (!marketPrice || marketPrice <= 0 || t <= 0) return null;
    let lo = 0.001, hi = 5.0;
    for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2;
        const price = bsPrice({ spot, strike, t, vol: mid, right, r });
        if (Math.abs(price - marketPrice) < 0.01) return mid;
        if (price > marketPrice) hi = mid;
        else lo = mid;
    }
    return (lo + hi) / 2;
}

function greeks({ spot, strike, t, vol, right, r = RISK_FREE_RATE }) {
    if (!vol || vol <= 0 || t <= 0) {
        return { delta: right === "call" ? (spot > strike ? 1 : 0) : (spot < strike ? -1 : 0), gamma: 0, theta: 0, vega: 0 };
    }
    const sqrtT = Math.sqrt(t);
    const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * sqrtT);
    const d2 = d1 - vol * sqrtT;
    const delta = right === "call" ? normCdf(d1) : normCdf(d1) - 1;
    const gamma = normPdf(d1) / (spot * vol * sqrtT);
    const vega = (spot * normPdf(d1) * sqrtT) / 100; // per 1% vol change
    const theta = right === "call"
        ? (-(spot * normPdf(d1) * vol) / (2 * sqrtT) - r * strike * Math.exp(-r * t) * normCdf(d2)) / 365
        : (-(spot * normPdf(d1) * vol) / (2 * sqrtT) + r * strike * Math.exp(-r * t) * normCdf(-d2)) / 365;
    return { delta, gamma, theta, vega };
}

module.exports = { yearsToExpiry, bsPrice, impliedVolatility, greeks, RISK_FREE_RATE };
