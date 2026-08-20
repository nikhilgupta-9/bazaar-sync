// components/landing/PinnedWalkthrough.jsx — the signature pinned
// scroll-driven step walkthrough (fxreplay.com-style). Pins the section
// while scrolling; a bottom tab bar and a cross-fading content panel both
// advance off GSAP ScrollTrigger's scroll progress. Falls back to a plain
// stacked, fade-in-on-scroll layout under prefers-reduced-motion — no
// pin/scrub for anyone who's asked their OS to reduce motion.
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import SectionVisual from "./SectionVisual";
import useInView from "./useInView";

gsap.registerPlugin(ScrollTrigger);

function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(
        () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        const handler = (e) => setReduced(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);
    return reduced;
}

function StackedStep({ step, index }) {
    const [ref, inView] = useInView({ threshold: 0.25 });
    return (
        <div ref={ref} className={`fade-step mx-auto grid max-w-5xl grid-cols-1 items-center gap-10 px-6 py-20 md:grid-cols-2 ${inView ? "in-view" : ""}`}>
            <div className="text-left">
                <div className="eyebrow">{step.eyebrow}</div>
                <h3 className="headline mt-3 text-3xl">{step.title}</h3>
                <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>{step.description}</p>
            </div>
            <SectionVisual image={step.image} variant={index} />
        </div>
    );
}

// Plain stacked layout — same content, no pin/scrub, each step fades in as
// it scrolls into view (IntersectionObserver, same mechanic as FloatingBadge).
function StackedWalkthrough({ steps }) {
    return (
        <section style={{ background: "var(--landing-bg-alt)" }}>
            {steps.map((step, i) => (
                <StackedStep key={step.title} step={step} index={i} />
            ))}
        </section>
    );
}

export default function PinnedWalkthrough({ steps }) {
    const containerRef = useRef(null);
    const panelsRef = useRef([]);
    const tabsRef = useRef([]);
    const scrollTriggerRef = useRef(null);
    const reducedMotion = usePrefersReducedMotion();

    useGSAP(
        () => {
            if (reducedMotion) return;
            const panels = panelsRef.current.filter(Boolean);
            if (panels.length < 2) return;

            gsap.set(panels.slice(1), { autoAlpha: 0 });

            const tl = gsap.timeline({
                scrollTrigger: {
                    trigger: containerRef.current,
                    pin: true,
                    scrub: 1,
                    start: "top top",
                    end: () => `+=${steps.length * 800}`,
                    onUpdate: (self) => {
                        const idx = Math.min(steps.length - 1, Math.floor(self.progress * steps.length));
                        tabsRef.current.forEach((tab, i) => tab?.classList.toggle("active-tab", i === idx));
                    },
                },
            });
            scrollTriggerRef.current = tl.scrollTrigger;

            panels.forEach((panel, i) => {
                if (i > 0) {
                    tl.to(panels[i - 1], { autoAlpha: 0, duration: 0.3 }, i).to(panel, { autoAlpha: 1, duration: 0.3 }, i);
                }
            });
        },
        { scope: containerRef, dependencies: [reducedMotion, steps.length] }
    );

    function jumpToStep(i) {
        const st = scrollTriggerRef.current;
        if (!st) return;
        st.scroll(st.start + (i / steps.length) * (st.end - st.start));
    }

    if (reducedMotion) return <StackedWalkthrough steps={steps} />;

    return (
        <section ref={containerRef} className="relative h-screen overflow-hidden" style={{ background: "var(--landing-bg-alt)" }}>
            {steps.map((step, i) => (
                <div key={step.title} ref={(el) => (panelsRef.current[i] = el)} className="absolute inset-0 flex items-center justify-center px-6">
                    <div className="grid max-w-5xl grid-cols-1 items-center gap-10 md:grid-cols-2">
                        <div className="text-left">
                            <div className="eyebrow">{step.eyebrow}</div>
                            <h3 className="headline mt-3 text-3xl sm:text-4xl">{step.title}</h3>
                            <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>{step.description}</p>
                        </div>
                        <SectionVisual image={step.image} variant={i} />
                    </div>
                </div>
            ))}

            <div className="absolute inset-x-0 bottom-8 flex justify-center px-4">
                <div className="landing-card flex max-w-full gap-1 overflow-x-auto p-1.5">
                    {steps.map((step, i) => (
                        <button
                            key={step.title}
                            ref={(el) => (tabsRef.current[i] = el)}
                            onClick={() => jumpToStep(i)}
                            className={`walkthrough-tab whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${i === 0 ? "active-tab" : ""}`}
                        >
                            {i + 1}. {step.title}
                        </button>
                    ))}
                </div>
            </div>
        </section>
    );
}
