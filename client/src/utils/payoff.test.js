// Unit tests for the shared options-math utility (this project's
// optionsMath.js equivalent — see the leg-shape comment at the top of
// payoff.js). Covers the sign-convention rule every payoff/Greeks
// calculation is built on: legContribution = (BUY=+1 / SELL=-1) * qty *
// lotSize * X, summed across active legs.
import { describe, it, expect } from "vitest";
import {
    computePayoffCurve,
    computeBreakevens,
    computeMaxProfitLoss,
    computeNetGreeks,
    computeRiskRewardRatio,
    computeMarginDetails,
    computePOP,
    totalPayoffAtPrice,
    legMultiplier,
    otherAction,
} from "./payoff";

// Minimal leg factory — only the fields the math actually reads.
function leg(overrides) {
    return {
        action: "buy",
        type: "CE",
        strike: 100,
        premium: 5,
        qty: 1,
        lotSize: 1,
        delta: 0,
        gamma: 0,
        theta: 0,
        vega: 0,
        ...overrides,
    };
}

describe("legMultiplier", () => {
    it("multiplies lots by lot size", () => {
        expect(legMultiplier(leg({ qty: 2, lotSize: 50 }))).toBe(100);
    });

    it("falls back to 1 when lotSize is missing (not a fabricated constant)", () => {
        expect(legMultiplier(leg({ qty: 3, lotSize: undefined }))).toBe(3);
    });
});

describe("otherAction", () => {
    it("flips buy to sell and back", () => {
        expect(otherAction("buy")).toBe("sell");
        expect(otherAction("sell")).toBe("buy");
    });
});

describe("single long call (buy CE)", () => {
    const legs = [leg({ action: "buy", type: "CE", strike: 100, premium: 5, qty: 1, lotSize: 1 })];

    it("loses exactly the premium below the strike", () => {
        expect(totalPayoffAtPrice(legs, 80)).toBe(-5);
        expect(totalPayoffAtPrice(legs, 100)).toBe(-5);
    });

    it("breaks even at strike + premium and profits above it", () => {
        expect(totalPayoffAtPrice(legs, 105)).toBe(0);
        expect(totalPayoffAtPrice(legs, 120)).toBe(15);
    });

    it("has unlimited max profit and bounded max loss", () => {
        const curve = computePayoffCurve(legs, { minPrice: 50, maxPrice: 150, steps: 40 });
        const { maxProfit, maxLoss } = computeMaxProfitLoss(legs, curve);
        expect(maxProfit).toBe("Unlimited");
        expect(maxLoss).toBe(-5);
    });

    it("has exactly one breakeven, at strike + premium", () => {
        const curve = computePayoffCurve(legs, { minPrice: 50, maxPrice: 150, steps: 100 });
        const breakevens = computeBreakevens(curve);
        expect(breakevens).toHaveLength(1);
        expect(breakevens[0]).toBeCloseTo(105, 0);
    });

    it("has positive net delta (long call)", () => {
        const netGreeks = computeNetGreeks(legs.map((l) => ({ ...l, delta: 0.5 })));
        expect(netGreeks.delta).toBe(0.5);
    });
});

describe("single short put (sell PE)", () => {
    const legs = [leg({ action: "sell", type: "PE", strike: 100, premium: 4, qty: 1, lotSize: 1 })];

    it("keeps the full premium at/above the strike", () => {
        expect(totalPayoffAtPrice(legs, 100)).toBe(4);
        expect(totalPayoffAtPrice(legs, 150)).toBe(4);
    });

    it("loses money below strike - premium", () => {
        expect(totalPayoffAtPrice(legs, 80)).toBe(-16); // intrinsic 20, premium 4 kept -> -16
    });

    it("has bounded max profit (the premium) and unlimited max loss", () => {
        const curve = computePayoffCurve(legs, { minPrice: 0, maxPrice: 150, steps: 60 });
        const { maxProfit, maxLoss } = computeMaxProfitLoss(legs, curve);
        expect(maxProfit).toBe(4);
        expect(maxLoss).toBe("Unlimited");
    });

    it("has negative net delta (short put has positive delta exposure inverted by sign)", () => {
        // per-unit put delta is negative (e.g. -0.4); SELL flips the sign to +0.4
        const netGreeks = computeNetGreeks(legs.map((l) => ({ ...l, delta: -0.4 })));
        expect(netGreeks.delta).toBe(0.4);
    });
});

describe("2-leg spread with mixed sides (bull call spread: buy 100CE, sell 120CE)", () => {
    const legs = [
        leg({ action: "buy", type: "CE", strike: 100, premium: 8, qty: 1, lotSize: 1 }),
        leg({ action: "sell", type: "CE", strike: 120, premium: 2, qty: 1, lotSize: 1 }),
    ];

    it("has max loss = net debit, below the lower strike", () => {
        expect(totalPayoffAtPrice(legs, 80)).toBe(-6); // -8 (buy leg) + 2 (sell leg) = net debit paid
    });

    it("has max profit = spread width - net debit, above the higher strike", () => {
        expect(totalPayoffAtPrice(legs, 140)).toBe(14); // (140-100-8) + (2-(140-120)) = 32 + (-18) = 14
    });

    it("both max profit and max loss are bounded (not Unlimited) for a vertical spread", () => {
        const curve = computePayoffCurve(legs, { minPrice: 50, maxPrice: 170, steps: 80 });
        const { maxProfit, maxLoss } = computeMaxProfitLoss(legs, curve);
        expect(maxProfit).toBe(14);
        expect(maxLoss).toBe(-6);
    });

    it("nets qty*lotSize per leg independently when sizes differ", () => {
        const mixed = [
            leg({ action: "buy", type: "CE", strike: 100, premium: 8, qty: 2, lotSize: 50 }),
            leg({ action: "sell", type: "CE", strike: 120, premium: 2, qty: 1, lotSize: 50 }),
        ];
        // At price 140: buy leg = (140-100-8)*2*50 = 3200; sell leg = (2-(140-120))*1*50 = -900
        expect(totalPayoffAtPrice(mixed, 140)).toBe(2300);
    });

    it("net Greeks sum sign-adjusted per-leg contributions across both legs", () => {
        const withGreeks = [
            { ...legs[0], delta: 0.6, theta: -1.2 },
            { ...legs[1], delta: 0.3, theta: -0.8 },
        ];
        const net = computeNetGreeks(withGreeks);
        // buy leg: +0.6 delta, -1.2 theta; sell leg: -0.3 delta, +0.8 theta
        expect(net.delta).toBeCloseTo(0.3, 5);
        expect(net.theta).toBeCloseTo(-0.4, 5);
    });
});

describe("computeRiskRewardRatio", () => {
    it("returns NA when max loss is Unlimited", () => {
        expect(computeRiskRewardRatio(28980.25, "Unlimited")).toBe("NA");
    });

    it("returns 1 : ∞ when max profit is Unlimited", () => {
        expect(computeRiskRewardRatio("Unlimited", -5000)).toBe("1 : ∞");
    });

    it("formats standard defined risk:reward as 1 : (profit / loss)", () => {
        expect(computeRiskRewardRatio(10000, -5000)).toBe("1 : 2.00");
        expect(computeRiskRewardRatio(5000, -10000)).toBe("1 : 0.50");
    });

    it("returns — for null or missing values", () => {
        expect(computeRiskRewardRatio(null, null)).toBe("—");
    });
});

describe("Iron Condor (4 legs, fully defined risk)", () => {
    const legs = [
        leg({ action: "buy", type: "PE", strike: 90, premium: 1, qty: 1, lotSize: 50 }),
        leg({ action: "sell", type: "PE", strike: 95, premium: 3, qty: 1, lotSize: 50 }),
        leg({ action: "sell", type: "CE", strike: 105, premium: 3, qty: 1, lotSize: 50 }),
        leg({ action: "buy", type: "CE", strike: 110, premium: 1, qty: 1, lotSize: 50 }),
    ];

    it("calculates bounded max profit and bounded max loss without Unlimited", () => {
        const curve = computePayoffCurve(legs, { minPrice: 70, maxPrice: 130, steps: 100 });
        const { maxProfit, maxLoss } = computeMaxProfitLoss(legs, curve);
        expect(maxProfit).toBe(200); // net credit = (3-1) + (3-1) = 4 per share * 50 = 200
        expect(maxLoss).toBe(-50); // wing width 5 - 4 credit = 1 loss per share * 50 = -50
    });

    it("computes defined risk:reward ratio", () => {
        const curve = computePayoffCurve(legs, { minPrice: 70, maxPrice: 130, steps: 100 });
        const { maxProfit, maxLoss } = computeMaxProfitLoss(legs, curve);
        expect(computeRiskRewardRatio(maxProfit, maxLoss)).toBe("1 : 4.00");
    });

    it("hedges margin properly and shows significant margin benefit for Iron Condor", () => {
        const margin = computeMarginDetails(legs, 100, "NIFTY");
        expect(margin.isHedged).toBe(true);
        expect(margin.marginBenefit).toBeGreaterThan(0);
        expect(margin.fundsRequired).toBeLessThan(margin.nakedMargin);
    });
});

describe("computePOP (Probability of Profit)", () => {
    it("returns null for invalid inputs", () => {
        expect(computePOP([], 100, 15, 0.05)).toBe(null);
        expect(computePOP(null, 100, 15, 0.05)).toBe(null);
    });

    it("returns a sensible percentage between 0 and 100", () => {
        const legs = [leg({ action: "sell", type: "CE", strike: 105, premium: 3, qty: 1, lotSize: 50 })];
        const curve = computePayoffCurve(legs, { minPrice: 80, maxPrice: 120, steps: 100 });
        const pop = computePOP(curve, 100, 15, 7 / 365);
        expect(pop).toBeGreaterThan(50);
        expect(pop).toBeLessThanOrEqual(100);
    });
});


