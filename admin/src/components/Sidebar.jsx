import { NavLink } from "react-router-dom";
import {
    FiGrid, FiUsers, FiCreditCard, FiTrendingUp, FiFileText,
    FiMapPin, FiTag, FiCalendar, FiBook, FiSearch, FiX, FiLayout, FiLayers,
    FiDownloadCloud, FiPieChart, FiClock, FiActivity, FiUploadCloud, FiKey, FiDatabase, FiCloud,
} from "react-icons/fi";

const LIVE_LINKS = [
    { to: "/", label: "Overview", icon: FiGrid, end: true },
    { to: "/users", label: "Users", icon: FiUsers },
    { to: "/payments", label: "Payments", icon: FiCreditCard },
    { to: "/positions", label: "Paper Trade", icon: FiTrendingUp },
    { to: "/strategies", label: "Strategies", icon: FiFileText },
];

const MANAGEMENT_LINKS = [
    { to: "/home-page", label: "Home Page", icon: FiLayout },
    { to: "/institute-access", label: "Institute Access", icon: FiMapPin },
    { to: "/plans", label: "Plans & Coupons", icon: FiTag },
    { to: "/events", label: "Events", icon: FiCalendar },
    { to: "/terms", label: "T&C", icon: FiBook },
    { to: "/seo", label: "SEO Tool", icon: FiSearch },
];

const DATA_LINKS = [
    { to: "/data-gdrive-archive", label: "GDrive Cloud Archival", icon: FiCloud, badge: "Auto" },
    { to: "/data-extraction", label: "Extraction Pipelines", icon: FiDownloadCloud, badge: "Live" },
    { to: "/data-import", label: "Import CSV", icon: FiUploadCloud },
    { to: "/data-export-prune", label: "Export & Disk Space", icon: FiDatabase },
    { to: "/data-settings", label: "Broker API & Tokens", icon: FiKey, badge: "Config" },
    { to: "/data-coverage", label: "Data Coverage Matrix", icon: FiPieChart },
    { to: "/expiry-status", label: "Expiry Calendar", icon: FiClock },
    { to: "/greeks-coverage", label: "Greeks Health Audit", icon: FiActivity },
    { to: "/lot-size-history", label: "Lot Size History", icon: FiLayers },
];

function NavItem({ to, label, icon: Icon, badge, end, onNavigate }) {
    return (
        <NavLink
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
                `group relative flex items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold transition-all ${
                    isActive
                        ? "bg-violet-600 text-white shadow-md shadow-violet-600/20"
                        : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                }`
            }
        >
            {({ isActive }) => (
                <>
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-gray-400 group-hover:text-violet-400"}`} />
                        <span className="truncate">{label}</span>
                    </div>
                    {badge && (
                        <span
                            className={`rounded-full px-1.5 py-0.2 text-[9px] font-extrabold uppercase tracking-tight ${
                                isActive
                                    ? "bg-white/20 text-white"
                                    : "bg-violet-500/10 text-violet-300 border border-violet-500/20"
                            }`}
                        >
                            {badge}
                        </span>
                    )}
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

                <div className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-600">Data</div>
                <nav className="flex flex-col gap-1">
                    {DATA_LINKS.map((l) => <NavItem key={l.to} {...l} onNavigate={onClose} />)}
                </nav>

                <div className="mb-2 mt-6 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-600">Management</div>
                <nav className="flex flex-col gap-1">
                    {MANAGEMENT_LINKS.map((l) => <NavItem key={l.to} {...l} onNavigate={onClose} />)}
                </nav>
            </aside>
        </>
    );
}
