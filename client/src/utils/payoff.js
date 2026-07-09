// Pure P&L/Greeks math for the Strategy Builder. Legs are:
// { action: 'buy'|'sell', type: 'CE'|'PE', strike, premium, qty, iv, delta, gamma, theta, vega }
// premium = entry LTP at the time the leg was added (from the option chain).
// qty is a raw contract count, not lots — Breeze doesn't return real lot
// sizes in our current calls, and lot sizes change periodically by exchange
// circular, so we don't fabricate one; the user enters quantity directly.

import { bsPrice, normCdf } from "./blackScholes";

function legPayoffAtPrice(leg, price) {
    const intrinsic = leg.type === "CE" ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price);
    const pnlPerUnit = leg.action === "buy" ? intrinsic - leg.premium : leg.premium - intrinsic;
    return pnlPerUnit * leg.qty;
}

export function totalPayoffAtPrice(legs, price) {
    return legs.reduce((sum, leg) => sum + legPayoffAtPrice(leg, price), 0);
}

// Payoff curve across a price range, evenly spaced, for the chart.
export function computePayoffCurve(legs, { minPrice, maxPrice, steps = 60 }) {
    const points = [];
    const step = (maxPrice - minPrice) / steps;
    for (let i = 0; i <= steps; i++) {
        const price = minPrice + i * step;
        points.push({ price: Math.round(price * 100) / 100, pnl: totalPayoffAtPrice(legs, price) });
    }
    return points;
}

// Breakevens: linear-interpolated zero crossings of the payoff curve. Only
// as precise as the curve's resolution — fine for display, not for pricing.
export function computeBreakevens(curve) {
    const crossings = [];
    for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i];
        if ((a.pnl <= 0 && b.pnl > 0) || (a.pnl >= 0 && b.pnl < 0)) {
            const t = a.pnl === b.pnl ? 0 : -a.pnl / (b.pnl - a.pnl);
            crossings.push(Math.round((a.price + t * (b.price - a.price)) * 100) / 100);
        }
    }
    return crossings;
}

// Max profit/loss over the sampled range. Detects "unlimited" by checking
// whether the curve is still trending away from zero at the range edges
// (e.g. a naked long call/put, or a net long strategy) rather than plateauing.
export function computeMaxProfitLoss(legs, curve) {
    const maxPnl = Math.max(...curve.map((p) => p.pnl));
    const minPnl = Math.min(...curve.map((p) => p.pnl));

    const first = curve[0], last = curve[curve.length - 1];
    const second = curve[1], secondLast = curve[curve.length - 2];
    const risingAtTop = last.pnl > secondLast.pnl;
    const risingAtBottom = first.pnl > second.pnl; // pnl increasing as price decreases, at the left edge

    return {
        maxProfit: risingAtTop || risingAtBottom ? "Unlimited" : maxPnl,
        maxLoss: (!risingAtTop && last.pnl < secondLast.pnl) || (!risingAtBottom && first.pnl < second.pnl)
            ? (risingAtTop ? minPnl : "Unlimited")
            : minPnl,
    };
}

// "Today" P&L at a given underlying price — theoretical (Black-Scholes)
// value using each leg's entry IV as a stand-in for current IV, repriced at
// `t` years remaining (today's time-to-expiry, not entry time-to-expiry).
// This is what makes the "Today" curve smooth/curved near the money, unlike
// the kinked intrinsic-only "Expiry" curve from computePayoffCurve.
function legMarkToMarketAtPrice(leg, price, t) {
    if (leg.iv == null) return null; // can't reprice without an IV snapshot
    const theoPrice = bsPrice({ spot: price, strike: leg.strike, t, vol: leg.iv / 100, right: leg.type });
    const pnlPerUnit = leg.action === "buy" ? theoPrice - leg.premium : leg.premium - theoPrice;
    return pnlPerUnit * leg.qty;
}

// Adds a `todayPnl` field to each point of an existing payoff curve (reuses
// the same price samples as the expiry curve so both lines share an x-axis).
export function addMarkToMarketCurve(curve, legs, yearsRemaining) {
    return curve.map((point) => {
        let sum = 0;
        for (const leg of legs) {
            const v = legMarkToMarketAtPrice(leg, point.price, yearsRemaining);
            if (v == null) return { ...point, todayPnl: null };
            sum += v;
        }
        return { ...point, todayPnl: sum };
    });
}

// "Expected move" reference lines (±1SD, ±2SD) — the standard options-desk
// approximation: a 1-standard-deviation price move over time t is
// spot * IV * sqrt(t). Uses the ATM IV as the representative volatility.
export function computeExpectedMove(spot, atmIvPercent, yearsRemaining) {
    const sigma = spot * (atmIvPercent / 100) * Math.sqrt(yearsRemaining);
    return {
        minus2sd: spot - 2 * sigma, minus1sd: spot - sigma,
        plus1sd: spot + sigma, plus2sd: spot + 2 * sigma,
    };
}

// Probability of Profit — approximates the underlying's price at expiry as
// normally distributed around the current spot (a simplification of the
// standard lognormal model, reasonable for near-term/small-IV cases), then
// sums the probability mass over price ranges where the curve is profitable.
// This is a numeric approximation for display, not a precise pricing model.
export function computePOP(curve, spot, atmIvPercent, yearsRemaining) {
    const sigma = spot * (atmIvPercent / 100) * Math.sqrt(yearsRemaining);
    if (!sigma) return null;
    let pop = 0;
    for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i];
        const massInBucket = normCdf((b.price - spot) / sigma) - normCdf((a.price - spot) / sigma);
        const midPnl = (a.pnl + b.pnl) / 2;
        if (midPnl > 0) pop += massInBucket;
    }
    return Math.max(0, Math.min(100, pop * 100));
}

// Net Greeks — sum of each leg's per-unit Greek × qty × (+1 buy / -1 sell).
export function computeNetGreeks(legs) {
    return legs.reduce(
        (net, leg) => {
            const sign = leg.action === "buy" ? 1 : -1;
            return {
                delta: net.delta + sign * (leg.delta ?? 0) * leg.qty,
                gamma: net.gamma + sign * (leg.gamma ?? 0) * leg.qty,
                theta: net.theta + sign * (leg.theta ?? 0) * leg.qty,
                vega: net.vega + sign * (leg.vega ?? 0) * leg.qty,
            };
        },
        { delta: 0, gamma: 0, theta: 0, vega: 0 }
    );
}
