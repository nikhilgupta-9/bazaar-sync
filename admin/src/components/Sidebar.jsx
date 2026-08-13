import { NavLink } from "react-router-dom";
import {
    FiGrid, FiUsers, FiCreditCard, FiTrendingUp, FiFileText,
    FiMapPin, FiTag, FiCalendar, FiBook, FiSearch,
} from "react-icons/fi";

// Real, working sections (backed by real endpoints/data) vs. sections the
// rest of the admin panel (institute allowlist, plans/coupons, events,
// T&C, SEO) hasn't been built for yet — see CLAUDE.md Phase 9/10. Kept as
// visible-but-"Coming soon" nav entries rather than hidden, so the full
// intended shape of the panel is discoverable, but nothing here is faked
// with placeholder data (project convention — see e.g. Strategy Builder's
// "Est. Margin: —").
const LIVE_LINKS = [
    { to: "/", label: "Overview", icon: FiGrid, end: true },
    { to: "/users", label: "Users", icon: FiUsers },
    { to: "/payments", label: "Payments", icon: FiCreditCard },
    { to: "/positions", label: "Paper Trade", icon: FiTrendingUp },
    { to: "/strategies", label: "Strategies", icon: FiFileText },
];

const COMING_SOON_LINKS = [
    { to: "/institute-access", label: "Institute Access", icon: FiMapPin },
    { to: "/plans", label: "Plans & Coupons", icon: FiTag },
    { to: "/events", label: "Events", icon: FiCalendar },
    { to: "/terms", label: "T&C", icon: FiBook },
    { to: "/seo", label: "SEO Tool", icon: FiSearch },
];

function NavItem({ to, label, icon: Icon, end }) {
    return (
        <NavLink
            to={to}
            end={end}
            className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                        ? "bg-violet-600/15 text-violet-300"
                        : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`
            }
        >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{label}</span>
        </NavLink>
    );
}

export default function Sidebar() {
    return (
        <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-[#0b0b0f] p-4">
            <div className="mb-6 flex items-center gap-2 px-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">B</div>
                <div>
                    <div className="text-sm font-bold text-white">Bazaar Sync</div>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Admin</div>
                </div>
            </div>

            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-600">Menu</div>
            <nav className="flex flex-col gap-1">
                {LIVE_LINKS.map((l) => <NavItem key={l.to} {...l} />)}
            </nav>

            <div className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-600">Coming Soon</div>
            <nav className="flex flex-col gap-1">
                {COMING_SOON_LINKS.map((l) => <NavItem key={l.to} {...l} />)}
            </nav>
        </aside>
    );
}
