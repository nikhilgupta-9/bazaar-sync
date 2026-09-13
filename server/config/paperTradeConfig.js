// Paper Trade / Pro-subscription business constants — see CLAUDE.md Phase 8.2/8.3/8.4.
// PRO_PRICE_PAISE/PRO_DURATION_DAYS are no longer the source of truth for the
// Pricing page's plans (that's the admin-managed pro_plans table now — see
// services/proPlanService.js, added 2026-09-13) — they only remain here as
// the last-resort fallback proPlanService.getPlanOrFallback() uses if the
// pro_plans table is ever completely empty, and as adminController.js's
// "typical price" for its revenue estimate.
const PRO_PRICE_PAISE = 49900; // ₹499
const PRO_DURATION_DAYS = 30;

// PRO_PAPER_GRANT (below) stays flat per purchase regardless of which plan
// is bought — a deliberate simplification, not an oversight; see
// subscriptionService.js's purchasePro for the same note.
module.exports = {
    TRIAL_DURATION_DAYS: 2,
    TRIAL_BALANCE: 50000,

    PRO_PRICE_PAISE,
    PRO_DURATION_DAYS,
    PRO_PAPER_GRANT: 500000,      // ₹5,00,000

    REFILL_PRICE_PAISE: 10000,    // ₹100
    REFILL_GRANT: 500000,         // ₹5,00,000

    // Fat-finger guard on a single Buy/Sell, not a business rule.
    MAX_LOTS_PER_ORDER: 100,

    // Margin for a naked written (short) option = spot * lotSize * lots * this.
    // A flat-percentage-of-notional approximation of real SPAN + Exposure
    // margin (which this app has no data to compute) — ~10% is in the
    // ballpark of a real NSE index short-option requirement (~7% in normal
    // vol, more on stressed days). Not precise, clearly labeled as such in
    // the UI. No intraday maintenance / auto square-off.
    //
    // Paper Trade places ONE contract at a time, so it can't see a hedging
    // long the way the Strategy Builder's spread-aware computeEstMargin
    // (client/src/utils/payoff.js) can — a paper short is always margined as
    // naked here. Keep this % in sync with that file's NAKED_SHORT_MARGIN_PCT.
    MARGIN_PERCENT_OF_NOTIONAL: 0.1,
};
