// components/landing/FloatingBadge.jsx — small rounded pill (icon + label)
// that fades/slides in via IntersectionObserver + a CSS transition (see
// theme.css's .float-badge) when its wrapping card scrolls into view.
// Deliberately not GSAP — kept lightweight per the spec.
import useInView from "./useInView";

export default function FloatingBadge({ icon, label, delayMs = 0, className = "" }) {
    const [ref, inView] = useInView({ threshold: 0.3, delayMs });

    return (
        <div
            ref={ref}
            className={`float-badge landing-card pointer-events-none absolute flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${inView ? "in-view" : ""} ${className}`}
        >
            {icon && <span aria-hidden="true">{icon}</span>}
            <span>{label}</span>
        </div>
    );
}
