// pages/Home.jsx — dark "premium fintech" landing page (fxreplay.com-style
// spec: pinned scroll walkthrough, feature carousel, two-tone headlines,
// blue-accent-on-CTAs-only). Scoped to `.landing-page` (theme.css) so this
// look doesn't leak into the rest of the app, which stays light-themed —
// same self-contained-dark-palette precedent PaperTrade.jsx already set.
//
// Every section's text and images are admin-editable from the admin panel
// (admin/src/pages/HomePage.jsx -> PUT /api/content/home, site_content
// table). This fetches that override JSON and deep-merges it over
// data/homeContentDefaults.js's original hardcoded copy — an admin who
// hasn't opened the editor yet (or left a field blank) still gets the exact
// original page, never a blank/broken section (fetch failure falls back the
// same way). The six tool cards (walkthrough + carousel) stay grounded in
// data/tools.js's real routes — the admin editor can only override each
// tool's title/desc/image, never invent a new card pointing nowhere.
import { useEffect, useState } from "react";
import "../components/landing/theme.css";
import Hero from "../components/landing/Hero";
import PinnedWalkthrough from "../components/landing/PinnedWalkthrough";
import FeatureCarousel from "../components/landing/FeatureCarousel";
import { TOOLS } from "../data/tools";
import { HOME_CONTENT_DEFAULTS, mergeHomeContent } from "../data/homeContentDefaults";
import { fetchHomeContent, resolveImageUrl } from "../services/contentApi";

const EYEBROWS = {
    "/option-chain": "Live Data",
    "/strategy-builder": "Strategy Builder",
    "/simulator": "Replay",
    "/paper-trade": "Paper Trading",
    "/historical-chart": "Historical Data",
    "/equity-data": "Equity Data",
};

function buildToolCards(toolOverrides) {
    return TOOLS.map((t) => {
        const o = toolOverrides[t.to] || {};
        return {
            ...t,
            title: o.title || t.title,
            desc: o.desc || t.desc,
            image: o.image || null,
            icon: t.icon || "chain",
        };
    });
}

export default function Home() {
    const [content, setContent] = useState(HOME_CONTENT_DEFAULTS);

    useEffect(() => {
        let cancelled = false;
        fetchHomeContent()
            .then((overrides) => {
                if (!cancelled) setContent(mergeHomeContent(overrides));
            })
            .catch(() => { /* keep defaults — see file header */ });
        return () => { cancelled = true; };
    }, []);

    const toolCards = buildToolCards(content.tools);
    const walkthroughSteps = toolCards.map((t) => ({
        eyebrow: EYEBROWS[t.to] || "Tool",
        title: t.title,
        description: t.desc,
        image: t.image,
    }));

    return (
        <div className="landing-page">
            <Hero {...content.hero} />

            <div className="eyebrow mx-auto max-w-5xl px-6 pt-24 text-center">How it works</div>
            <h2 className="headline mx-auto mt-3 max-w-3xl px-6 text-center text-3xl sm:text-4xl">
                <span>Six tools,</span> <span className="headline-muted">one real data pipeline.</span>
            </h2>

            <div className="pt-16">
                <PinnedWalkthrough steps={walkthroughSteps} />
            </div>

            <div className="py-28">
                <FeatureCarousel features={toolCards} />
            </div>

            {/* Closing About section — same accurate copy the previous
                homepage had, restyled to match this page's dark theme. */}
            <section className="mx-auto max-w-3xl px-6 pb-32 pt-8">
                <div className="landing-card overflow-hidden p-8">
                    {content.about.image && (
                        <img
                            src={resolveImageUrl(content.about.image)}
                            alt=""
                            className="-mx-8 -mt-8 mb-6 h-auto w-[calc(100%+4rem)] object-cover"
                        />
                    )}
                    <h2 className="headline text-xl">{content.about.heading}</h2>
                    {content.about.paragraphs.map((p, i) => (
                        <p key={i} className="mt-4 text-sm leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>
                            {p}
                        </p>
                    ))}
                </div>
            </section>
        </div>
    );
}
