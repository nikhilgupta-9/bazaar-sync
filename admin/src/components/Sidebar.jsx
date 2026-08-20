import { NavLink } from "react-router-dom";
import {
    FiGrid, FiUsers, FiCreditCard, FiTrendingUp, FiFileText,
    FiMapPin, FiTag, FiCalendar, FiBook, FiSearch, FiX,
} from "react-icons/fi";

const LIVE_LINKS = [
    { to: "/", label: "Overview", icon: FiGrid, end: true },
    { to: "/users", label: "Users", icon: FiUsers },
    { to: "/payments", label: "Payments", icon: FiCreditCard },
    { to: "/positions", label: "Paper Trade", icon: FiTrendingUp },
    { to: "/strategies", label: "Strategies", icon: FiFileText },
];

// Phase 11: was "Coming Soon" (Phase 9/10) — all five now have real
// endpoints/data behind them, moved into their own labeled section rather
// than merged into Menu above, since they're management/config tools
// (site-wide settings) rather than the operational-data views above.
const MANAGEMENT_LINKS = [
    { to: "/institute-access", label: "Institute Access", icon: FiMapPin },
    { to: "/plans", label: "Plans & Coupons", icon: FiTag },
    { to: "/events", label: "Events", icon: FiCalendar },
    { to: "/terms", label: "T&C", icon: FiBook },
    { to: "/seo", label: "SEO Tool", icon: FiSearch },
];

function NavItem({ to, label, icon: Icon, end, onNavigate }) {
    return (
        <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                        ? "bg-violet-600/15 text-violet-300"
                        : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`
            }
        >
            {({ isActive }) => (
                <>
                    <span
                        className={`absolute -left-1 top-1/2 h-4 -translate-y-1/2 rounded-full bg-violet-500 transition-all ${
                            isActive ? "w-[3px] opacity-100" : "w-0 opacity-0"
                        }`}
                        aria-hidden="true"
                    />
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{label}</span>
                </>
            )}
        </NavLink>
    );
}

// `open`/`onClose` only matter below the lg breakpoint — on desktop the
// sidebar is always visible and these are unused (AdminLayout doesn't render
// the overlay there).
export default function Sidebar({ open = false, onClose }) {
    return (
        <>
            {open && (
                <div
                    className="fixed inset-0 z-40 bg-black/60 lg:hidden"
                    onClick={onClose}
                    aria-hidden="true"
                />
            )}
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-white/10 bg-[#0b0b0f] p-4 transition-transform lg:sticky lg:top-0 lg:translate-x-0 ${
                    open ? "translate-x-0" : "-translate-x-full"
                }`}
            >
                <div className="mb-6 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">B</div>
                        <div>
                            <div className="text-sm font-bold text-white">Bazaar Sync</div>
                            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Admin</div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close sidebar"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-white/5 hover:text-gray-300 lg:hidden"
                    >
                        <FiX className="h-4 w-4" />
                    </button>
                </div>

                <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-600">Menu</div>
                <nav className="flex flex-col gap-1">
                    {LIVE_LINKS.map((l) => <NavItem key={l.to} {...l} onNavigate={onClose} />)}
                </nav>

                <div className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-600">Management</div>
                <nav className="flex flex-col gap-1">
                    {MANAGEMENT_LINKS.map((l) => <NavItem key={l.to} {...l} onNavigate={onClose} />)}
                </nav>
            </aside>
        </>
    );
}
