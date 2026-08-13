import TopBar from "../components/TopBar";

// Generic stub for sidebar sections that don't have real backend/data yet
// (Institute Access, Plans & Coupons, Events, T&C, SEO Tool) — kept visible
// in the nav so the panel's intended shape is discoverable, but deliberately
// not faked with placeholder numbers/tables. See CLAUDE.md Phase 9/10.
export default function ComingSoon({ title, description }) {
    return (
        <div>
            <TopBar title={title} subtitle={description} />
            <div className="p-6">
                <div className="rounded-xl border border-dashed border-white/10 bg-[#101015]/60 px-6 py-20 text-center">
                    <div className="inline-block rounded-full bg-amber-500/15 px-4 py-1.5 text-xs font-semibold text-amber-300">
                        Coming soon
                    </div>
                    <p className="mt-3 text-sm text-gray-500">Not built yet — no real data behind this section.</p>
                </div>
            </div>
        </div>
    );
}
