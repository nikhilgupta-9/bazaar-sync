// components/landing/useInView.js — shared IntersectionObserver hook for
// the landing page's lightweight (non-GSAP) fade/slide-in micro-interactions
// (FloatingBadge, and PinnedWalkthrough's prefers-reduced-motion fallback).
import { useEffect, useRef, useState } from "react";

export default function useInView({ threshold = 0.3, delayMs = 0 } = {}) {
    const ref = useRef(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        let timer;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    timer = setTimeout(() => setInView(true), delayMs);
                }
            },
            { threshold }
        );
        observer.observe(el);
        return () => {
            observer.disconnect();
            clearTimeout(timer);
        };
    }, [threshold, delayMs]);

    return [ref, inView];
}
