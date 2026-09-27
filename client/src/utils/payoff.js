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

// Payoff curve across a price range for the chart, sampling grid points plus exact leg strikes.
export function computePayoffCurve(legs, { minPrice, maxPrice, steps = 120 }) {
    if (!legs || !legs.length || minPrice >= maxPrice) return [];
    const evaluationExpiry = evaluationExpiryOf(legs);

    // Build price sample points including exact strikes
    const priceSet = new Set();
    const step = (maxPrice - minPrice) / steps;
    for (let i = 0; i <= steps; i++) {
        priceSet.add(Math.round((minPrice + i * step) * 100) / 100);
    }
    for (const leg of legs) {
        if (leg.strike >= minPrice && leg.strike <= maxPrice) {
            priceSet.add(Math.round(leg.strike * 100) / 100);
        }
    }

    const sortedPrices = Array.from(priceSet).sort((a, b) => a - b);
    return sortedPrices.map((price) => ({
        price,
        pnl: Math.round(totalPayoffAtPrice(legs, price, evaluationExpiry) * 100) / 100,
    }));
}

// Breakevens: zero crossings of the payoff curve, linear-interpolated.
export function computeBreakevens(curve) {
    if (!curve || curve.length < 2) return [];
    const crossings = [];
    for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i];
        if ((a.pnl <= 0 && b.pnl > 0) || (a.pnl >= 0 && b.pnl < 0)) {
            const t = a.pnl === b.pnl ? 0 : -a.pnl / (b.pnl - a.pnl);
            const crossPrice = Math.round((a.price + t * (b.price - a.price)) * 100) / 100;
            // Prevent duplicate crossing entries
            if (!crossings.length || Math.abs(crossings[crossings.length - 1] - crossPrice) > 0.1) {
                crossings.push(crossPrice);
            }
        }
    }
    return crossings;
}

// Max profit/loss over the sampled range. Detects "unlimited" by checking
// whether the curve is still trending away from zero at the range edges
// (e.g. a naked long call/put, or a net long strategy) rather than plateauing.
// Max profit/loss over the sampled range and leg structure.
// Uses analytical slope at the tails (asymptotic behavior as spot -> 0 and spot -> +inf)
// so that defined-risk strategies (Iron Condors, Spreads, Butterflies) are never falsely
// classified as "Unlimited" due to sampling window cutoffs.
export function computeMaxProfitLoss(legs, curve) {
    if (!curve || !curve.length) {
        return { maxProfit: null, maxLoss: null };
    }

    const maxPnl = Math.round(Math.max(...curve.map((p) => p.pnl)) * 100) / 100;
    const minPnl = Math.round(Math.min(...curve.map((p) => p.pnl)) * 100) / 100;

    // Asymptotic slopes:
    // Upside (spot -> +inf): only CE legs are ITM
    // Downside (spot -> 0): only PE legs are ITM
    let netCallSlope = 0;
    let netPutSlope = 0;

    for (const leg of legs) {
        const mult = legMultiplier(leg);
        const sign = leg.action === "buy" ? 1 : -1;
        if (leg.type === "CE") {
            netCallSlope += sign * mult;
        } else if (leg.type === "PE") {
            netPutSlope += sign * mult;
        }
    }

    // If netCallSlope > 0: unbounded upside profit (e.g. Long Call)
    // If netPutSlope > 0: unbounded downside profit (e.g. Long Put, practically capped at 0 spot but standardly huge)
    const isProfitUnlimited = netCallSlope > 0 || netPutSlope > 0;

    // If netCallSlope < 0: unbounded upside loss (e.g. Short Call)
    // If netPutSlope < 0: unbounded downside loss (e.g. Short Put)
    const isLossUnlimited = netCallSlope < 0 || netPutSlope < 0;

    return {
        maxProfit: isProfitUnlimited ? "Unlimited" : maxPnl,
        maxLoss: isLossUnlimited ? "Unlimited" : minPnl,
    };
}

export function computeRiskRewardRatio(maxProfit, maxLoss) {
    if (maxProfit == null || maxLoss == null) return "—";

    // When loss is unlimited (e.g. naked short options), risk is undefined
    if (maxLoss === "Unlimited") {
        return "NA";
    }

    // When profit is unlimited and loss is defined (e.g. long call/put)
    if (maxProfit === "Unlimited") {
        return "1 : ∞";
    }

    if (typeof maxProfit !== "number" || typeof maxLoss !== "number") {
        return "—";
    }

    const profit = Math.abs(maxProfit);
    const loss = Math.abs(maxLoss);

    if (loss < 0.01) return "1 : ∞";
    if (profit < 0.01) return "NA";

    const ratio = (profit / loss).toFixed(2);
    return `1 : ${ratio}`;
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
        return { ...point, todayPnl: Math.round(sum * 100) / 100 };
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
    if (!curve || !curve.length || !spot || !atmIvPercent || !yearsRemaining || yearsRemaining <= 0) return null;
    const sigma = spot * (atmIvPercent / 100) * Math.sqrt(yearsRemaining);
    if (!sigma || isNaN(sigma)) return null;
    let pop = 0;
    for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i];
        const massInBucket = normCdf((b.price - spot) / sigma) - normCdf((a.price - spot) / sigma);
        const midPnl = (a.pnl + b.pnl) / 2;
        if (midPnl > 0) pop += massInBucket;
    }
    return Math.max(0, Math.min(100, Math.round(pop * 100)));
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

// Estimated margin — a portfolio spread-aware approximation matching NSE Clearing / broker rules.
//   • Long legs need no margin — their maximum risk is the premium already paid.
//   • A short leg hedged by a long leg (vertical spread) blocks only the spread's max risk.
//   • Iron Condor / Box spreads block the worst-case wing risk max(CE spread, PE spread).
//   • Short Straddle / Strangle (naked CE + naked PE) blocks max(CE SPAN, PE SPAN) + total exposure.
//   • Unhedged short legs block standard SPAN + Exposure margin.
const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"]);
const INDEX_SCAN_RANGE_FLOOR = 0.093; // NSE's published floor (~9.3%)
const BASE_SPAN_EXTREME_LOSS_PCT = 0.00538743; // Base extreme loss / scenario buffer for hedged spreads (~0.54%)
const TRADING_DAYS_PER_YEAR = 252;
const DEFAULT_IV_PERCENT_FALLBACK = 20;

function getSpanExposureBreakdown(leg, symbol) {
    const isIndex = symbol ? INDEX_SYMBOLS.has(String(symbol).toUpperCase()) : true;
    const ivPercent = leg.iv > 0 ? leg.iv : DEFAULT_IV_PERCENT_FALLBACK;
    const dailySigma = ivPercent / 100 / Math.sqrt(TRADING_DAYS_PER_YEAR);
    const priceScanRangePct = 6 * dailySigma * Math.SQRT2;
    const spanPct = isIndex ? Math.max(priceScanRangePct, INDEX_SCAN_RANGE_FLOOR) : priceScanRangePct;
    const exposurePct = isIndex ? 0.02 : 0.035;
    return { spanPct, exposurePct, totalPct: spanPct + exposurePct };
}

// Max loss per unit of a two-leg vertical (one short, one long, same type),
// evaluated at kink prices.
function verticalMaxLossPerUnit(shortLeg, longLeg) {
    const isCE = shortLeg.type === "CE";
    const testPrices = [0, shortLeg.strike, longLeg.strike, Math.max(shortLeg.strike, longLeg.strike) * 10];
    let worst = Infinity;
    for (const p of testPrices) {
        const shortIntrinsic = isCE ? Math.max(0, p - shortLeg.strike) : Math.max(0, shortLeg.strike - p);
        const longIntrinsic = isCE ? Math.max(0, p - longLeg.strike) : Math.max(0, longLeg.strike - p);
        const pnl = shortLeg.premium - shortIntrinsic + (longIntrinsic - longLeg.premium);
        if (pnl < worst) worst = pnl;
    }
    return Math.max(0, -worst);
}

export function computeMarginDetails(legs, spot, symbol) {
    if (!spot || !legs || !legs.length) {
        return {
            fundsRequired: 0,
            estMargin: 0,
            nakedMargin: 0,
            marginBenefit: 0,
            netPremium: 0,
            premiumPaid: 0,
            premiumReceived: 0,
            isHedged: false,
        };
    }

    let premiumPaid = 0;
    let premiumReceived = 0;
    let totalNakedMargin = 0;
    let totalExposureMargin = 0;

    const longPool = { CE: [], PE: [] };
    const shortPool = { CE: [], PE: [] };

    for (const leg of legs) {
        const mult = legMultiplier(leg);
        const cost = (leg.premium || 0) * mult;
        if (leg.action === "buy") {
            premiumPaid += cost;
            if (longPool[leg.type]) {
                longPool[leg.type].push({ ...leg, lotsLeft: leg.qty });
            }
        } else {
            premiumReceived += cost;
            if (shortPool[leg.type]) {
                shortPool[leg.type].push({ ...leg, lotsLeft: leg.qty });
            }
            const lotSize = leg.lotSize || 1;
            const { spanPct, exposurePct, totalPct } = getSpanExposureBreakdown(leg, symbol);
            totalNakedMargin += spot * lotSize * leg.qty * totalPct;
            totalExposureMargin += spot * lotSize * leg.qty * exposurePct;
        }
    }

    const hasShort = legs.some((l) => l.action === "sell");
    if (!hasShort) {
        return {
            fundsRequired: Math.round(premiumPaid),
            estMargin: 0,
            nakedMargin: 0,
            marginBenefit: 0,
            netPremium: Math.round(-premiumPaid),
            premiumPaid: Math.round(premiumPaid),
            premiumReceived: 0,
            isHedged: false,
        };
    }

    // Match vertical & calendar spreads per type
    const spreadSpans = { CE: 0, PE: 0 };
    let anyHedgeMatched = false;

    for (const type of ["CE", "PE"]) {
        const shorts = shortPool[type];
        const longs = longPool[type];

        for (const sLeg of shorts) {
            if (sLeg.lotsLeft <= 0) continue;
            const lotSize = sLeg.lotSize || 1;
            const { spanPct } = getSpanExposureBreakdown(sLeg, symbol);

            // Prioritize same expiry hedges first, then cross-expiry calendar hedges
            const candidates = longs
                .filter((l) => l.lotsLeft > 0)
                .sort((a, b) => {
                    const aSameExp = a.expiry === sLeg.expiry ? 0 : 1;
                    const bSameExp = b.expiry === sLeg.expiry ? 0 : 1;
                    if (aSameExp !== bSameExp) return aSameExp - bSameExp;
                    return Math.abs(a.strike - sLeg.strike) - Math.abs(b.strike - sLeg.strike);
                });

            for (const lLeg of candidates) {
                if (sLeg.lotsLeft <= 0) break;
                const pairLots = Math.min(sLeg.lotsLeft, lLeg.lotsLeft);
                const isSameExpiry = !sLeg.expiry || !lLeg.expiry || sLeg.expiry === lLeg.expiry;

                let spreadSpanForPair = 0;
                if (isSameExpiry) {
                    const strikeDiff = Math.abs(sLeg.strike - lLeg.strike);
                    const isDebitSpread = (type === "CE" && lLeg.strike < sLeg.strike) || (type === "PE" && lLeg.strike > sLeg.strike);

                    if (isDebitSpread) {
                        // Debit spread: Max risk is bounded by net debit paid
                        const netDebitPerUnit = Math.max(0, (lLeg.premium || 0) - (sLeg.premium || 0));
                        spreadSpanForPair = netDebitPerUnit * lotSize * pairLots;
                    } else {
                        // Credit spread: Bounded by strike difference * lotSize + base SPAN extreme loss buffer
                        const spreadLoss = strikeDiff * lotSize * pairLots;
                        const spreadBuffer = (spot * lotSize * pairLots) * BASE_SPAN_EXTREME_LOSS_PCT;
                        spreadSpanForPair = Math.min(
                            spot * lotSize * pairLots * spanPct,
                            spreadLoss + spreadBuffer
                        );
                    }
                } else {
                    // Calendar Spread: ~30% of standard SPAN margin
                    spreadSpanForPair = (spot * lotSize * pairLots * spanPct) * 0.30;
                }

                spreadSpans[type] += spreadSpanForPair;
                sLeg.lotsLeft -= pairLots;
                lLeg.lotsLeft -= pairLots;
                anyHedgeMatched = true;
            }
        }
    }

    // Calculate unhedged/naked SPAN margin for remaining short lots with portfolio cross-margin
    let unhedgedCeSpan = 0;
    let unhedgedPeSpan = 0;

    for (const sLeg of shortPool.CE) {
        if (sLeg.lotsLeft > 0) {
            const lotSize = sLeg.lotSize || 1;
            const { spanPct } = getSpanExposureBreakdown(sLeg, symbol);
            unhedgedCeSpan += spot * lotSize * sLeg.lotsLeft * spanPct;
        }
    }

    for (const sLeg of shortPool.PE) {
        if (sLeg.lotsLeft > 0) {
            const lotSize = sLeg.lotSize || 1;
            const { spanPct } = getSpanExposureBreakdown(sLeg, symbol);
            unhedgedPeSpan += spot * lotSize * sLeg.lotsLeft * spanPct;
        }
    }

    const ceTotalSpan = spreadSpans.CE + unhedgedCeSpan;
    const peTotalSpan = spreadSpans.PE + unhedgedPeSpan;

    // Exchange portfolio SPAN takes the worst-case side (max of CE and PE total SPAN risks)
    const totalSpanMargin = (ceTotalSpan > 0 || peTotalSpan > 0)
        ? Math.max(ceTotalSpan, peTotalSpan)
        : 0;

    const totalEstMargin = totalSpanMargin + totalExposureMargin;
    const netPremium = premiumReceived - premiumPaid;
    const marginBenefit = anyHedgeMatched ? Math.max(0, totalNakedMargin - totalEstMargin) : 0;

    // Funds Required matches broker requirements (Margin blocked for short legs + net debit if applicable)
    const fundsRequired = Math.max(
        totalEstMargin,
        netPremium < 0 ? totalEstMargin + Math.abs(netPremium) : totalEstMargin
    );

    return {
        fundsRequired: Math.round(fundsRequired * 100) / 100,
        estMargin: Math.round(totalEstMargin * 100) / 100,
        nakedMargin: Math.round(totalNakedMargin * 100) / 100,
        marginBenefit: Math.round(marginBenefit * 100) / 100,
        netPremium: Math.round(netPremium * 100) / 100,
        premiumPaid: Math.round(premiumPaid * 100) / 100,
        premiumReceived: Math.round(premiumReceived * 100) / 100,
        isHedged: anyHedgeMatched,
    };
}

export function computeEstMargin(legs, spot, symbol) {
    if (!spot) return null;
    const details = computeMarginDetails(legs, spot, symbol);
    return details.fundsRequired || details.estMargin || 0;
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

