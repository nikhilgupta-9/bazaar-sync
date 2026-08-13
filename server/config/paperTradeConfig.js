// Paper Trade / Pro-subscription business constants — see CLAUDE.md Phase 8.2/8.3/8.4.
module.exports = {
    TRIAL_DURATION_DAYS: 2,
    TRIAL_BALANCE: 50000,

    PRO_PRICE_PAISE: 49900,       // ₹499
    PRO_DURATION_DAYS: 30,
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
