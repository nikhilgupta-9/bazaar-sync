// components/landing/Hero.jsx — full-width dark hero, two-tone headline,
// pill CTA, browser-chrome mockup card with floating micro-interaction
// badges. Copy is grounded in what Bazaar Sync actually does (Angel One
// live feed, real historical backtests) — not fabricated marketing claims.
import { Link } from "react-router-dom";
import DashboardMockup from "./DashboardMockup";
import FloatingBadge from "./FloatingBadge";

export default function Hero() {
    return (
        <section className="mx-auto max-w-5xl px-6 pt-24 pb-10 text-center sm:pt-32">
            <div className="eyebrow">NSE Options Analytics</div>
            <h1 className="headline mt-4 text-4xl sm:text-5xl lg:text-6xl">
                <span>Build and backtest</span>
                <br />
                <span className="headline-muted">options strategies on real NSE data.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[600px] text-base leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>
                Live option chain, a multi-leg strategy builder with real-time Greeks, and a backtesting
                engine that runs against years of stored NSE options history — not a simulation.
            </p>
            <Link
                to="/option-chain"
                className="landing-cta mt-8 inline-block rounded-full px-7 py-3 text-sm font-bold"
            >
                Explore Option Chain
            </Link>

            <div className="relative mx-auto mt-16 max-w-3xl">
                <DashboardMockup variant={0} />
                <FloatingBadge icon="⚡" label="Live Angel One feed" className="-left-4 top-10 hidden sm:flex" delayMs={200} />
                <FloatingBadge icon="📊" label="Backed by real history" className="-right-4 bottom-10 hidden sm:flex" delayMs={500} />
            </div>
        </section>
    );
}
