// Paper Trade / Pro-subscription business constants — see CLAUDE.md Phase 8.2/8.3/8.4.
const PRO_PRICE_PAISE = 49900; // ₹499
const PRO_DURATION_DAYS = 30;

// The Pricing page's plan catalog (added alongside the Phase 8.2 single-plan
// flow, not replacing it — PRO_PRICE_PAISE/PRO_DURATION_DAYS below still
// exist standalone since adminController.js's revenue estimate uses them as
// the "typical" price). Names/durations/prices match the user-supplied
// pricing-card design exactly (Starter/Pro Trader/Elite, 1/6/12 months).
// PRO_PAPER_GRANT (below) stays flat per purchase regardless of which plan
// is bought — a deliberate simplification, not an oversight; see
// subscriptionService.js's purchasePro for the same note.
const PRO_PLANS = [
    { id: "1m", name: "Starter", duration: "1 Month", days: PRO_DURATION_DAYS, priceInPaise: PRO_PRICE_PAISE, badge: null },
    { id: "6m", name: "Pro Trader", duration: "6 Months", days: 180, priceInPaise: 289900, badge: "Trending" },
    { id: "12m", name: "Elite", duration: "1 Year", days: 365, priceInPaise: 549900, badge: null },
];

module.exports = {
    TRIAL_DURATION_DAYS: 2,
    TRIAL_BALANCE: 50000,

    PRO_PRICE_PAISE,
    PRO_DURATION_DAYS,
    PRO_PLANS,
    PRO_PAPER_GRANT: 500000,      // ₹5,00,000

    REFILL_PRICE_PAISE: 10000,    // ₹100
    REFILL_GRANT: 500000,         // ₹5,00,000

    // Fat-finger guard on a single Buy/Sell, not a business rule.
    MAX_LOTS_PER_ORDER: 100,

    // Margin for a written (short) option = spot * lotSize * lots * this.
    // A flat-percentage-of-notional approximation of real SPAN margin
    // (which this app has no data to compute) — not precise, clearly
    // labeled as such in the UI. No intraday maintenance/auto square-off.
    MARGIN_PERCENT_OF_NOTIONAL: 0.15,
};
