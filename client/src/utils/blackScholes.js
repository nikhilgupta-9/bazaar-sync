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

export function bsPrice({ spot, strike, t, vol, right, r = RISK_FREE_RATE }) {
    if (vol <= 0 || t <= 0) return Math.max(0, right === "CE" ? spot - strike : strike - spot);
    const d1 = (Math.log(spot / strike) + (r + 0.5 * vol * vol) * t) / (vol * Math.sqrt(t));
    const d2 = d1 - vol * Math.sqrt(t);
    return right === "CE"
        ? spot * normCdf(d1) - strike * Math.exp(-r * t) * normCdf(d2)
        : strike * Math.exp(-r * t) * normCdf(-d2) - spot * normCdf(-d1);
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
    const [year, month, day] = expiryStr.split("-").map(Number);
    const expiryUtcMidnight = Date.UTC(year, month - 1, day);
    const now = new Date();
    const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((expiryUtcMidnight - todayUtcMidnight) / (24 * 60 * 60 * 1000));
}

// `fromMs` defaults to the real clock (live Strategy Builder use), but can be
// passed explicitly to price "as of" a historical instant instead — e.g. the
// Simulator computing time-to-expiry as of the replayed minute, not now.
export function yearsToExpiry(expiryStr, fromMs = Date.now()) {
    const [year, month, day] = expiryStr.split("-").map(Number);
    // IST is UTC+5:30; 15:30 IST = 10:00 UTC. Built via Date.UTC so this
    // doesn't depend on the browser's local timezone.
    const expiryUtcMs = Date.UTC(year, month - 1, day, 10, 0, 0);
    const ms = expiryUtcMs - fromMs;
    return Math.max(ms / (365 * 24 * 60 * 60 * 1000), 1 / (365 * 24 * 4));
}
