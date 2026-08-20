// components/landing/Hero.jsx — full-width dark hero, two-tone headline,
// pill CTA, browser-chrome mockup card with floating micro-interaction
// badges. Copy is grounded in what Bazaar Sync actually does (Angel One
// live feed, real historical backtests) — not fabricated marketing claims.
//
// Every text field + the hero image are admin-editable (admin/src/pages/
// HomePage.jsx, GET/PUT /api/content/home) — Home.jsx passes the merged
// content (admin overrides over data/homeContentDefaults.js) down as props,
// so this component itself stays a plain presentational renderer.
import { Link } from "react-router-dom";
import SectionVisual from "./SectionVisual";
import FloatingBadge from "./FloatingBadge";

export default function Hero({ eyebrow, headline, headlineMuted, subtext, ctaLabel, ctaLink, image }) {
    return (
        <section className="mx-auto max-w-5xl px-6 pt-24 pb-10 text-center sm:pt-32">
            <div className="eyebrow">{eyebrow}</div>
            <h1 className="headline mt-4 text-4xl sm:text-5xl lg:text-6xl">
                <span>{headline}</span>
                <br />
                <span className="headline-muted">{headlineMuted}</span>
            </h1>
            <p className="mx-auto mt-6 max-w-[600px] text-base leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>
                {subtext}
            </p>
            <Link to={ctaLink} className="landing-cta mt-8 inline-block rounded-full px-7 py-3 text-sm font-bold">
                {ctaLabel}
            </Link>

            <div className="relative mx-auto mt-16 max-w-3xl">
                <SectionVisual image={image} variant={0} />
                <FloatingBadge icon="⚡" label="Live Angel One feed" className="-left-4 top-10 hidden sm:flex" delayMs={200} />
                <FloatingBadge icon="📊" label="Backed by real history" className="-right-4 bottom-10 hidden sm:flex" delayMs={500} />
            </div>
        </section>
    );
}
