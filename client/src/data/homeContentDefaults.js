// data/homeContentDefaults.js — the Home page's original hardcoded copy,
// used as the fallback for every field the admin panel's Home Page editor
// (admin/src/pages/HomePage.jsx) hasn't touched yet. Home.jsx fetches
// GET /api/content/home (site_content table, slug 'home', see
// contentController.js) and deep-merges whatever's stored there over this
// object — an admin who's never opened the editor, or who left a field
// blank, still gets the real original page, never a blank section.
export const HOME_CONTENT_DEFAULTS = {
    hero: {
        eyebrow: "NSE Options Analytics",
        headline: "Build and backtest",
        headlineMuted: "options strategies on real NSE data.",
        subtext:
            "Live option chain, a multi-leg strategy builder with real-time Greeks, and a backtesting " +
            "engine that runs against years of stored NSE options history — not a simulation.",
        ctaLabel: "Explore Option Chain",
        ctaLink: "/option-chain",
        image: null,
    },
    about: {
        heading: "About Bazaar Sync",
        paragraphs: [
            "Bazaar Sync is an options analytics and backtesting platform built for NSE F&O traders. " +
                "It turns Nifty, BankNifty and FinNifty options data into the live dashboards and strategy " +
                "tools you'd otherwise have to build yourself in a spreadsheet — live option chain with IV " +
                "and Greeks computed by our own Black-Scholes engine, a multi-leg Strategy Builder with " +
                "real-time payoff/breakevens, a Simulator that replays real past days minute by minute, and " +
                "a Backtesting engine that runs entirely on stored historical NSE data, never a live broker " +
                "call. Paper Trade lets you run a strategy forward with virtual capital against real prices, " +
                "so results don't move under you.",
            "Built for active NSE options traders who want live index and options analytics without a " +
                "Bloomberg terminal, and anyone who wants to test a strategy against real history before " +
                "risking capital on it.",
        ],
        image: null,
    },
    // Keyed by TOOLS[].to (client/src/data/tools.js) — optional per-tool
    // title/desc/image overrides shared by both the pinned walkthrough and
    // the feature carousel (both sections already render the same tool
    // list, see Home.jsx), so there's one place to edit a tool's homepage
    // copy rather than two.
    tools: {},
};

// Only overrides a field when the admin actually set a non-empty value —
// an edited-then-cleared input (empty string) falls back to the default
// rather than rendering blank. Plain `{...a, ...b}` would let an empty
// string win, which is what a half-filled admin form would otherwise save.
function pickNonEmpty(defaults, overrides) {
    const out = { ...defaults };
    for (const key of Object.keys(defaults)) {
        const v = overrides?.[key];
        if (v !== null && v !== undefined && v !== "") out[key] = v;
    }
    return out;
}

export function mergeHomeContent(overrides) {
    if (!overrides || typeof overrides !== "object") return HOME_CONTENT_DEFAULTS;
    return {
        hero: pickNonEmpty(HOME_CONTENT_DEFAULTS.hero, overrides.hero),
        about: {
            ...pickNonEmpty(HOME_CONTENT_DEFAULTS.about, overrides.about),
            paragraphs:
                Array.isArray(overrides.about?.paragraphs) && overrides.about.paragraphs.some((p) => p && p.trim())
                    ? overrides.about.paragraphs
                    : HOME_CONTENT_DEFAULTS.about.paragraphs,
        },
        tools: { ...(overrides.tools || {}) },
    };
}
