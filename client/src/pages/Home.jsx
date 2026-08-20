// pages/Home.jsx — dark "premium fintech" landing page (fxreplay.com-style
// spec: pinned scroll walkthrough, feature carousel, two-tone headlines,
// blue-accent-on-CTAs-only). Scoped to `.landing-page` (theme.css) so this
// look doesn't leak into the rest of the app, which stays light-themed —
// same self-contained-dark-palette precedent PaperTrade.jsx already set.
// All copy/content below is grounded in tools that actually exist in this
// app (data/tools.js) — no fabricated features, same convention the old
// stockmojo-style homepage this replaces already followed.
import "../components/landing/theme.css";
import Hero from "../components/landing/Hero";
import PinnedWalkthrough from "../components/landing/PinnedWalkthrough";
import FeatureCarousel from "../components/landing/FeatureCarousel";
import { TOOLS } from "../data/tools";

const EYEBROWS = {
    "/option-chain": "Live Data",
    "/strategy-builder": "Strategy Builder",
    "/simulator": "Replay",
    "/paper-trade": "Paper Trading",
    "/historical-chart": "Historical Data",
    "/equity-data": "Equity Data",
};

const WALKTHROUGH_STEPS = TOOLS.map((t) => ({
    eyebrow: EYEBROWS[t.to] || "Tool",
    title: t.title,
    description: t.desc,
}));

const CAROUSEL_FEATURES = TOOLS.map((t) => ({ ...t, icon: t.icon || "chain" }));

export default function Home() {
    return (
        <div className="landing-page">
            <Hero />

            <div className="eyebrow mx-auto max-w-5xl px-6 pt-24 text-center">How it works</div>
            <h2 className="headline mx-auto mt-3 max-w-3xl px-6 text-center text-3xl sm:text-4xl">
                <span>Six tools,</span> <span className="headline-muted">one real data pipeline.</span>
            </h2>

            <div className="pt-16">
                <PinnedWalkthrough steps={WALKTHROUGH_STEPS} />
            </div>

            <div className="py-28">
                <FeatureCarousel features={CAROUSEL_FEATURES} />
            </div>

            {/* Closing About section — same accurate copy the previous
                homepage had, restyled to match this page's dark theme. */}
            <section className="mx-auto max-w-3xl px-6 pb-32 pt-8">
                <div className="landing-card p-8">
                    <h2 className="headline text-xl">About Bazaar Sync</h2>
                    <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>
                        Bazaar Sync is an options analytics and backtesting platform built for NSE F&amp;O traders.
                        It turns Nifty, BankNifty and FinNifty options data into the live dashboards and strategy
                        tools you'd otherwise have to build yourself in a spreadsheet — live option chain with IV
                        and Greeks computed by our own Black-Scholes engine, a multi-leg Strategy Builder with
                        real-time payoff/breakevens, a Simulator that replays real past days minute by minute, and
                        a Backtesting engine that runs entirely on stored historical NSE data, never a live broker
                        call. Paper Trade lets you run a strategy forward with virtual capital against real prices,
                        so results don't move under you.
                    </p>
                    <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>
                        Built for active NSE options traders who want live index and options analytics without a
                        Bloomberg terminal, and anyone who wants to test a strategy against real history before
                        risking capital on it.
                    </p>
                </div>
            </section>
        </div>
    );
}
