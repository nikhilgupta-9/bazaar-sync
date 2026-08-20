// components/landing/SectionVisual.jsx — renders an admin-uploaded image
// (Home Page editor, admin/src/pages/HomePage.jsx) when one is set for a
// section, otherwise falls back to the existing hand-drawn DashboardMockup
// placeholder — same "gap, not a guess" convention this codebase already
// uses (e.g. Simulator.jsx's missing per-minute data), just applied to a
// missing image instead of missing data.
import DashboardMockup from "./DashboardMockup";
import { resolveImageUrl } from "../../services/contentApi";

export default function SectionVisual({ image, variant = 0, className = "" }) {
    if (image) {
        return (
            <div className={`landing-card overflow-hidden ${className}`}>
                <img src={resolveImageUrl(image)} alt="" className="block h-auto w-full object-cover" />
            </div>
        );
    }
    return <DashboardMockup variant={variant} className={className} />;
}
