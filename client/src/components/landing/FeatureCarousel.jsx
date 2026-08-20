// components/landing/FeatureCarousel.jsx — horizontal feature card row
// (Embla carousel), numbered progress indicator top-left, circular
// prev/next arrows. Reuses the existing ToolIcon.jsx shapes as the icon
// badges — no new assets needed.
import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { Link } from "react-router-dom";
import ToolIcon from "../ToolIcon";

export default function FeatureCarousel({ features }) {
    const [emblaRef, emblaApi] = useEmblaCarousel({ align: "start", containScroll: "trimSnaps" });
    const [selectedIndex, setSelectedIndex] = useState(0);

    const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
    const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

    useEffect(() => {
        if (!emblaApi) return;
        const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
        onSelect();
        emblaApi.on("select", onSelect);
        emblaApi.on("reInit", onSelect);
        return () => emblaApi.off("select", onSelect);
    }, [emblaApi]);

    return (
        <section className="mx-auto max-w-6xl px-6">
            <div className="mb-6 flex items-center justify-between">
                <span className="eyebrow">{String(selectedIndex + 1).padStart(1, "0")}/{features.length}</span>
                <div className="flex gap-2">
                    <button
                        onClick={scrollPrev}
                        aria-label="Previous feature"
                        className="landing-card flex h-9 w-9 items-center justify-center rounded-full text-sm hover:opacity-90"
                    >
                        ←
                    </button>
                    <button
                        onClick={scrollNext}
                        aria-label="Next feature"
                        className="landing-card flex h-9 w-9 items-center justify-center rounded-full text-sm hover:opacity-90"
                    >
                        →
                    </button>
                </div>
            </div>

            <div className="overflow-hidden" ref={emblaRef}>
                <div className="flex gap-4">
                    {features.map((f) => (
                        <Link
                            key={f.to}
                            to={f.to}
                            className="landing-card flex-[0_0_260px] p-5 sm:flex-[0_0_280px]"
                        >
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg" style={{ background: "rgba(255,255,255,0.06)" }}>
                                <div className="h-5 w-5">
                                    <ToolIcon name={f.icon} />
                                </div>
                            </div>
                            <div className="mt-4 text-sm font-bold" style={{ fontFamily: "var(--font-headline)" }}>{f.title}</div>
                            <div className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--landing-text-muted)" }}>{f.desc}</div>
                        </Link>
                    ))}
                </div>
            </div>
        </section>
    );
}
