// Pure P&L/Greeks math for the Strategy Builder. Legs are:
// { action: 'buy'|'sell', type: 'CE'|'PE', strike, premium, qty, lotSize, iv, delta, gamma, theta, vega, expiry }
// premium = entry LTP at the time the leg was added (from the option chain).
// qty is a LOT count (matches the "Lots" column/stepper in the UI), and
// lotSize is the real per-lot share count for that symbol at the moment the
// leg was built (from the instrument master, via the option-chain payload's
// `lotSize` field — see optionChainController.js/marketCache.getLotSize).
// Every money figure below is qty * lotSize, never qty alone. A leg with no
// lotSize (e.g. built before this field existed, or while the live cache has
// none cached yet) falls back to lotSize=1 rather than a fabricated constant
// — this makes the P&L a raw per-share number in that case, not silently
// wrong by a hardcoded guess; Greeks fall back the same way.
export function legMultiplier(leg) {
    return leg.qty * (leg.lotSize || 1);
}

// Flips a leg's side in place ('buy' <-> 'sell') — the single shared rule
// both StrategyBuilder.jsx and Simulator.jsx use for their clickable B/S
// position-side chip, so the flip logic isn't duplicated per page.
export function otherAction(action) {
    return action === "buy" ? "sell" : "buy";
}
//
// Multi-expiry legs (e.g. a calendar spread: sell a near-dated call, buy a
// far-dated one at the same strike) are supported: the "expiry" payoff curve
// is evaluated as of the EARLIEST leg expiry (the "evaluation expiry") —
// legs actually expiring then are priced at intrinsic value as usual, while
// legs with a LATER expiry are Black-Scholes repriced (using their entry IV
// as a stand-in, same convention as the mark-to-market curve below) with
// time-to-THEIR-OWN-expiry measured from the evaluation date. When every leg
// shares one expiry (the overwhelmingly common case) this reduces to exactly
// the old intrinsic-only behavior — nothing changes for single-expiry
// strategies whether or not legs carry an `expiry` field at all.

import { bsPrice, normCdf, yearsToExpiry } from "./blackScholes";

function expiryCutoffMs(expiryStr) {
    const [y, m, d] = expiryStr.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 10, 0, 0); // 15:30 IST, same convention as blackScholes.js
}

// Years between two expiry dates (both 'YYYY-MM-DD'), for repricing a
// later-dated leg as of an earlier evaluation expiry.
function yearsBetweenExpiries(fromExpiryStr, toExpiryStr) {
    return yearsToExpiry(toExpiryStr, expiryCutoffMs(fromExpiryStr));
}

// The evaluation expiry for a leg set: the earliest expiry among legs that
// carry one. Returns null if no leg has an expiry (fully backward compatible
// with any caller that hasn't attached one — everything falls back to pure
// intrinsic value, the original single-expiry behavior).
export function evaluationExpiryOf(legs) {
    const expiries = legs.map((l) => l.expiry).filter(Boolean);
    if (!expiries.length) return null;
    return expiries.reduce((min, e) => (e < min ? e : min));
}

function legPayoffAtPrice(leg, price, evaluationExpiry) {
    const isLaterDated = evaluationExpiry && leg.expiry && leg.expiry > evaluationExpiry;
    let value;
    if (isLaterDated && leg.iv != null) {
        const t = yearsBetweenExpiries(evaluationExpiry, leg.expiry);
        value = bsPrice({ spot: price, strike: leg.strike, t, vol: leg.iv / 100, right: leg.type });
    } else {
        value = leg.type === "CE" ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price);
    }
    const pnlPerUnit = leg.action === "buy" ? value - leg.premium : leg.premium - value;
    return pnlPerUnit * legMultiplier(leg);
}

export function totalPayoffAtPrice(legs, price, evaluationExpiry) {
    const evalExp = evaluationExpiry !== undefined ? evaluationExpiry : evaluationExpiryOf(legs);
    return legs.reduce((sum, leg) => sum + legPayoffAtPrice(leg, price, evalExp), 0);
}

// Payoff curve across a price range, evenly spaced, for the chart.
export function computePayoffCurve(legs, { minPrice, maxPrice, steps = 60 }) {
    const evaluationExpiry = evaluationExpiryOf(legs);
    const points = [];
    const step = (maxPrice - minPrice) / steps;
    for (let i = 0; i <= steps; i++) {
        const price = minPrice + i * step;
        points.push({ price: Math.round(price * 100) / 100, pnl: totalPayoffAtPrice(legs, price, evaluationExpiry) });
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
    return pnlPerUnit * legMultiplier(leg);
}

// Adds a `todayPnl` field to each point of an existing payoff curve (reuses
// the same price samples as the expiry curve so both lines share an x-axis).
// `nowMs` is optional: when provided, each leg reprices using its OWN
// time-to-its-own-expiry from `nowMs` (needed for calendar spreads, where
// legs don't share an expiry) rather than one shared `fallbackYearsRemaining`
// applied to every leg — which remains the behavior for legs with no
// `expiry` field, or when `nowMs` is omitted (unchanged from before).
export function addMarkToMarketCurve(curve, legs, fallbackYearsRemaining, nowMs) {
    return curve.map((point) => {
        let sum = 0;
        for (const leg of legs) {
            const t = leg.expiry && nowMs != null ? yearsToExpiry(leg.expiry, nowMs) : fallbackYearsRemaining;
            const v = legMarkToMarketAtPrice(leg, point.price, t);
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

// Rough relative probability-density bars drawn behind the payoff curve —
// a decorative "how likely is each price" visualization, not a precise
// histogram, using the same normal-distribution approximation computePOP
// already uses. Returns one value per curve point, normalized 0-1 against
// the curve's own peak density, so PayoffChart can render it against a
// small fixed-height axis regardless of sigma's actual magnitude.
export function computeDensityCurve(curve, spot, atmIvPercent, yearsRemaining) {
    const sigma = spot * (atmIvPercent / 100) * Math.sqrt(yearsRemaining);
    if (!sigma) return curve.map(() => 0);
    const raw = curve.map((p) => Math.exp(-0.5 * ((p.price - spot) / sigma) ** 2));
    const peak = Math.max(...raw, 1e-9);
    return raw.map((v) => v / peak);
}

// Estimated margin — the same flat 15%-of-notional approximation
// server/config/paperTradeConfig.js's MARGIN_PERCENT_OF_NOTIONAL uses for
// real short paper-trade positions (services/paperPositionService.js:
// marginBlocked = spot * lotSize * lots * 0.15). Kept in sync intentionally,
// same convention as paperWalletService.getWalletStatus mirroring
// requirePro.js's isPro check. Only short (sell) legs block margin — a long
// leg's max risk is already its paid premium, already reflected in P&L/max
// loss, not a separate margin requirement. Returns null when spot isn't
// known yet (can't estimate), 0 for an all-long strategy (no margin needed).
const MARGIN_PERCENT_OF_NOTIONAL = 0.15;

export function computeEstMargin(legs, spot) {
    if (!spot) return null;
    return legs
        .filter((leg) => leg.action === "sell")
        .reduce((sum, leg) => sum + spot * legMultiplier(leg) * MARGIN_PERCENT_OF_NOTIONAL, 0);
}

// Net Greeks — sum of each leg's per-unit Greek × qty × (+1 buy / -1 sell).
export function computeNetGreeks(legs) {
    return legs.reduce(
        (net, leg) => {
            const sign = leg.action === "buy" ? 1 : -1;
            const mult = legMultiplier(leg);
            return {
                delta: net.delta + sign * (leg.delta ?? 0) * mult,
                gamma: net.gamma + sign * (leg.gamma ?? 0) * mult,
                theta: net.theta + sign * (leg.theta ?? 0) * mult,
                vega: net.vega + sign * (leg.vega ?? 0) * mult,
            };
        },
        { delta: 0, gamma: 0, theta: 0, vega: 0 }
    );
}
