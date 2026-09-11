// utils/syntheticSpot.js
//
// The real underlying spot for a PAST minute is not reliably stored anywhere:
// ohlcv_data is EOD-only for most days, and option_chain_history.underlying_price
// is a single static per-day value (verified against the real dev DB,
// 2026-09-06). So any historical option-chain view — the Simulator scrubbing
// minute-by-minute, or Strategy Builder showing a market-closed / non-live
// expiry — would show a SPOT (and therefore an ATM strike, payoff reference
// line, POP, expected-move) frozen at the day's value.
//
// Put-call parity recovers the FORWARD, not the spot:
//   C - P = (F - K)·e^(-rT)   ⇒   K + C - P ≈ F   (for small rT)
// The forward runs above the spot by the cost of carry (r - q), which for
// NSE indices is ~4-6% annualised — i.e. tens of points on NIFTY even for the
// near weekly, growing with tenor. Taking K + C - P directly (an earlier
// version of this file) therefore over-stated the spot by ~10-30 points and
// pushed the ATM strike a notch too high.
//
// The fix: compute the parity forward at SEVERAL expiries and fit
//   F(T) = S + m·T           (linear cost of carry)
// The intercept S is the spot; the slope m is the carry. With only one
// expiry available we fall back to discounting by a default 5% carry.

// Median of the near-ATM (K + C_ltp − P_ltp) over the strikes with the
// smallest |C − P| — the parity FORWARD for one expiry's chain.
// `chainRows`: [{ strike, ce: { ltp }, pe: { ltp } }, ...]  → number | null
function parityForward(chainRows) {
    const usable = (chainRows || [])
        .filter(
            (r) =>
                r.ce &&
                r.pe &&
                r.ce.ltp != null &&
                r.pe.ltp != null &&
                r.ce.ltp > 0 &&
                r.pe.ltp > 0,
        )
        .map((r) => ({
            diff: Math.abs(r.ce.ltp - r.pe.ltp),
            fwd: r.strike + r.ce.ltp - r.pe.ltp,
        }));
    if (usable.length < 3) return null;
    usable.sort((a, b) => a.diff - b.diff);
    const near = usable
        .slice(0, Math.min(5, usable.length))
        .map((u) => u.fwd)
        .sort((a, b) => a - b);
    const mid = Math.floor(near.length / 2);
    return near.length % 2 ? near[mid] : (near[mid - 1] + near[mid]) / 2;
}

const DEFAULT_CARRY = 0.05; // r − q for NSE indices, annualised (used only when a single expiry is available)

// Back out the spot from parity forwards at one or more expiries.
// `points`: [{ t: yearsToExpiry (>0), forward: number }, ...]  → number | null
function spotFromForwardCurve(points) {
    const pts = (points || []).filter((p) => p && p.forward != null && Number.isFinite(p.forward) && p.t > 0);
    if (pts.length === 0) return null;
    if (pts.length === 1) {
        return Number((pts[0].forward / (1 + DEFAULT_CARRY * pts[0].t)).toFixed(2));
    }
    // OLS fit forward = a + m·t ; the intercept a is the spot.
    const n = pts.length;
    const sumT = pts.reduce((s, p) => s + p.t, 0);
    const sumF = pts.reduce((s, p) => s + p.forward, 0);
    const sumTT = pts.reduce((s, p) => s + p.t * p.t, 0);
    const sumTF = pts.reduce((s, p) => s + p.t * p.forward, 0);
    const denom = n * sumTT - sumT * sumT;
    if (Math.abs(denom) < 1e-12) {
        // all expiries at (effectively) the same tenor — discount the mean forward
        return Number(((sumF / n) / (1 + DEFAULT_CARRY * (sumT / n))).toFixed(2));
    }
    const m = (n * sumTF - sumT * sumF) / denom;
    const a = (sumF - m * sumT) / n;
    // Guard against a nonsensical fit (e.g. inverted curve from bad quotes) —
    // the spot can't be above the nearest forward.
    const nearestFwd = pts.reduce((best, p) => (p.t < best.t ? p : best)).forward;
    if (a > nearestFwd + 1) return Number((nearestFwd / (1 + DEFAULT_CARRY * Math.min(...pts.map((p) => p.t)))).toFixed(2));
    return Number(a.toFixed(2));
}

// Years from a plain 'YYYY-MM-DD' trade date to a 'YYYY-MM-DD' expiry, anchored
// at 15:30 IST on the expiry day (10:00 UTC), same convention as
// blackScholes.js / payoff.js. Plain-string Date.UTC math (CLAUDE.md Gotcha #12).
function yearsBetween(dateStr, expiryStr, timeStr) {
    if (!dateStr || !expiryStr) return null;
    const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
    const [ey, em, ed] = String(expiryStr).slice(0, 10).split("-").map(Number);
    const [hh = 9, mm = 15, ss = 0] = String(timeStr || "09:15:00").split(":").map(Number);
    const fromMs = Date.UTC(y, m - 1, d, hh, mm, ss) - 5.5 * 3600 * 1000;
    const toMs = Date.UTC(ey, em - 1, ed, 10, 0, 0); // 15:30 IST
    const yrs = (toMs - fromMs) / (365 * 24 * 3600 * 1000);
    return yrs > 0 ? yrs : 1 / (365 * 24 * 4); // floor at 15 min
}

// Convenience for callers that only have one expiry's chain and a fallback:
// returns the discounted spot, or `fallback` when the chain is too thin.
function syntheticSpot(chainRows, fallback = null, t = null) {
    const fwd = parityForward(chainRows);
    if (fwd == null) return fallback;
    if (t && t > 0) return spotFromForwardCurve([{ t, forward: fwd }]);
    return fallback != null ? fallback : Number(fwd.toFixed(2));
}

module.exports = { parityForward, spotFromForwardCurve, yearsBetween, syntheticSpot };
