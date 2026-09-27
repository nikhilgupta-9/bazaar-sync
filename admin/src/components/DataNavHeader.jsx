// components/DataNavHeader.jsx — Unified Navigation & Command Bar for all Data Section pages
import { NavLink } from "react-router-dom";
import {
    FiDownloadCloud,
    FiUploadCloud,
    FiKey,
    FiPieChart,
    FiClock,
    FiActivity,
    FiLayers,
    FiDatabase,
    FiShield,
    FiCloud,
} from "react-icons/fi";

const DATA_TABS = [
    {
        to: "/data-gdrive-archive",
        label: "GDrive Cloud Archival",
        icon: FiCloud,
        badge: "Auto Sync",
        badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
        desc: "Automated 2023-2024 Option Chain Google Drive backup & Mac disk auto-pruning",
    },
    {
        to: "/data-extraction",
        label: "Extraction Jobs",
        icon: FiDownloadCloud,
        badge: "Pipelines",
        badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
        desc: "Dhan, Breeze, Upstox, Angel One, Bhavcopy & Kotak extraction engine",
    },
    {
        to: "/data-import",
        label: "Import CSV",
        icon: FiUploadCloud,
        badge: "Manual Ingest",
        badgeColor: "bg-blue-500/20 text-blue-300 border-blue-500/30",
        desc: "Direct CSV upload for Option Chain, Futures & OHLCV missing months",
    },
    {
        to: "/data-export-prune",
        label: "Export & Space",
        icon: FiDatabase,
        badge: "Storage & Prune",
        badgeColor: "bg-purple-500/20 text-purple-300 border-purple-500/30",
        desc: "Disk usage monitor, compressed JSONL/CSV exports, and selective pruning",
    },
    {
        to: "/data-settings",
        label: "API & Tokens",
        icon: FiKey,
        badge: "Credentials",
        badgeColor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
        desc: "Upstox, Angel One, Dhan, Kotak & Breeze secrets & session tokens",
    },
    {
        to: "/data-coverage",
        label: "Data Coverage",
        icon: FiPieChart,
        badge: "Completeness",
        badgeColor: "bg-teal-500/20 text-teal-300 border-teal-500/30",
        desc: "Per-symbol 2023+ month-by-month and day-by-day availability matrix",
    },
    {
        to: "/expiry-status",
        label: "Expiry Calendar",
        icon: FiClock,
        badge: "Timeliness",
        badgeColor: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
        desc: "Weekly/monthly expiry contract verification & bhavcopy cross-check",
    },
    {
        to: "/greeks-coverage",
        label: "Greeks Audit",
        icon: FiActivity,
        badge: "Black-Scholes",
        badgeColor: "bg-rose-500/20 text-rose-300 border-rose-500/30",
        desc: "Delta, Gamma, Theta, Vega & IV population health audit",
    },
    {
        to: "/lot-size-history",
        label: "Lot Sizes",
        icon: FiLayers,
        badge: "Contracts",
        badgeColor: "bg-sky-500/20 text-sky-300 border-sky-500/30",
        desc: "NSE derivative contract lot size revision timeline and bulk importer",
    },
];

export default function DataNavHeader({ title, subtitle }) {
    return (
        <div className="border-b border-white/10 bg-[#0d0d14]/95 backdrop-blur-md">
            {/* Top Bar with Title & Breadcrumbs */}
            <div className="px-3.5 sm:px-6 pt-4 sm:pt-5 pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                    <div className="flex items-start sm:items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-md shadow-violet-600/30">
                            <FiShield size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-base sm:text-lg font-black text-white truncate">{title || "Data Operations & Storage Command Center"}</h1>
                                <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-300 uppercase tracking-wider">
                                    Admin Engine
                                </span>
                            </div>
                            <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5 line-clamp-2 sm:line-clamp-none">
                                {subtitle || "Centralized management for historical data pipelines, CSV imports, storage lifecycle, and broker API tokens."}
                            </p>
                        </div>
                    </div>

                    <nav aria-label="breadcrumb" className="hidden lg:flex shrink-0 items-center gap-1.5 text-xs text-gray-500 font-medium">
                        <span className="text-gray-400">Admin</span>
                        <span className="text-gray-600">/</span>
                        <span className="text-gray-400">Data Hub</span>
                        {title && (
                            <>
                                <span className="text-gray-600">/</span>
                                <span className="text-violet-400 font-semibold truncate max-w-48">{title}</span>
                            </>
                        )}
                    </nav>
                </div>
            </div>

            {/* Horizontal Navigation Pills / Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto px-3.5 sm:px-6 pb-3 pt-1 no-scrollbar sm:custom-scrollbar">
                {DATA_TABS.map((tab) => (
                    <NavLink
                        key={tab.to}
                        to={tab.to}
                        className={({ isActive }) =>
                            `group shrink-0 flex items-center gap-2 rounded-xl px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-bold transition-all ${
                                isActive
                                    ? "bg-violet-600 text-white shadow-lg shadow-violet-600/25 ring-1 ring-violet-400/40"
                                    : "border border-white/5 bg-white/5 text-gray-400 hover:border-white/10 hover:bg-white/10 hover:text-gray-200"
                            }`
                        }
                    >
                        {({ isActive }) => {
                            const Icon = tab.icon;
                            return (
                                <>
                                    <Icon className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isActive ? "text-white" : "text-gray-400 group-hover:text-violet-400"}`} />
                                    <span className="whitespace-nowrap">{tab.label}</span>
                                    <span
                                        className={`rounded-full border px-1.5 py-0.2 text-[9px] font-extrabold uppercase tracking-tight ${
                                            isActive
                                                ? "bg-white/20 text-white border-white/30"
                                                : tab.badgeColor
                                        }`}
                                    >
                                        {tab.badge}
                                    </span>
                                </>
                            );
                        }}
                    </NavLink>
                ))}
            </div>
        </div>
    );
}
