import React, { useState, useEffect, useRef } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
    FiSun,
    FiMoon,
    FiDroplet,
    FiMenu,
    FiX,
    FiChevronDown,
    FiClock,
    FiCpu,
    FiRefreshCw,
    FiPieChart,
    FiMap,
    FiTrendingUp,
    FiZap,
    FiActivity,
} from "react-icons/fi";
import Logo from "./Logo";
import MarketTickerBar from "./MarketTickerBar";

// Cycles Light -> Ocean -> Dark -> Light on each click (single-button UX,
// same as before — not a 3-way picker). Icon + tooltip always name the
// theme you'll land on next, not the one you're currently in.
const THEME_NEXT_LABEL = { light: "ocean", ocean: "dark", dark: "light" };

function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();
    const nextLabel = THEME_NEXT_LABEL[theme] || "light";
    return (
        <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition cursor-pointer"
            aria-label={`Switch to ${nextLabel} theme`}
            title={`Switch to ${nextLabel} theme`}
        >
            {theme === "light" && <FiMoon size={18} />}
            {theme === "ocean" && <FiDroplet size={18} className="text-teal-400" />}
            {theme === "dark" && <FiSun size={18} className="text-amber-400" />}
        </button>
    );
}

const STRATEGY_BUILDER_LINKS = [
    { to: "/strategy-builder", label: "Indian Strategy Builder", end: true },
    { to: "/strategy-builder/crypto", label: "Crypto Strategy Builder" },
];

const SIMULATOR_LINKS = [
    {
        to: "/simulator",
        label: "Indian Options Backtest",
        desc: "1-Min Tick Replay • Multi-leg MTM & Greeks",
        badge: "TICK REPLAY",
        badgeColor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        icon: FiClock,
        end: true,
    },
    {
        to: "/simulator/crypto",
        label: "Crypto Options Backtest",
        desc: "Delta Exchange 1-Min Historical Options Replay",
        badge: "CRYPTO REPLAY",
        badgeColor: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
        icon: FiCpu,
    },
];

const EQUITY_DATA_LINKS = [
    {
        to: "/equity-data/sector-rotation",
        label: "Sector Rotation",
        desc: "Relative Rotation Graphs (RRG) across sectors",
        badge: "RRG",
        badgeColor: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
        icon: FiRefreshCw,
    },
    {
        to: "/equity-data/sector-performance",
        label: "Sector Performance",
        desc: "Heatmap & sector relative strength performance",
        badge: "HEATMAP",
        badgeColor: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
        icon: FiPieChart,
    },
    {
        to: "/equity-data/market-map",
        label: "Market Map",
        desc: "Treemap market cap visualization & movements",
        badge: "MAP",
        badgeColor: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
        icon: FiMap,
    },
    {
        to: "/equity-data/52-week-high-low",
        label: "52 Week High / Low",
        desc: "Institutional breakout scans & 52-week levels",
        badge: "BREAKOUT",
        badgeColor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
        icon: FiTrendingUp,
    },
    {
        to: "/equity-data/industry-momentum",
        label: "Industry Momentum Stocks",
        desc: "Leading momentum stocks grouped by industry",
        badge: "MOMENTUM",
        badgeColor: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
        icon: FiZap,
    },
    {
        to: "/equity-data/most-active",
        label: "High Activity Options",
        desc: "Most active strikes by volume & open interest",
        badge: "ACTIVE OI",
        badgeColor: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20",
        icon: FiActivity,
    },
];

const links = [
    { dropdown: "strategy-builder", label: "Strategy Builder" },
    { dropdown: "simulator", label: "Option Backtesting" },
    { to: "/option-chain", label: "Option Chain" },
    { to: "/paper-trade", label: "Paper Trade" },
    { to: "/historical-chart", label: "Historical Chart" },
];

// Professional dropdown with smooth hover intent, hitbox bridge, and fintech styling
function NavDropdown({ label, basePath, items, widthClass = "w-80" }) {
    const [open, setOpen] = useState(false);
    const location = useLocation();
    const isActive = location.pathname.startsWith(basePath);
    const timeoutRef = useRef(null);

    const handleMouseEnter = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setOpen(true);
    };

    const handleMouseLeave = () => {
        timeoutRef.current = setTimeout(() => {
            setOpen(false);
        }, 180);
    };

    const handleToggle = () => {
        setOpen((v) => !v);
    };

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, []);

    useEffect(() => {
        setOpen(false);
    }, [location.pathname]);

    return (
        <div
            className="relative py-1"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <button
                type="button"
                onClick={handleToggle}
                className={`group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                        ? "text-emerald-600 font-bold bg-emerald-50/80 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100/70 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800/60"
                }`}
                aria-expanded={open}
            >
                <span>{label}</span>
                <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-3.5 w-3.5 transition-transform duration-200 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-200 ${
                        open ? "rotate-180 text-emerald-500" : ""
                    }`}
                >
                    <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                    />
                </svg>
            </button>

            {/* Invisible Hitbox Bridge between button and dropdown card */}
            <div className="absolute left-0 top-full h-2 w-full pointer-events-auto" />

            {open && (
                <div
                    className={`absolute left-0 top-[calc(100%+4px)] z-50 ${widthClass} rounded-2xl border border-gray-200/90 bg-white/95 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.15)] backdrop-blur-xl dark:border-slate-800/90 dark:bg-[#0b1220]/95 dark:shadow-[0_25px_60px_rgba(0,0,0,0.55)] ring-1 ring-black/5 dark:ring-white/10 transition-all duration-200 animate-in fade-in zoom-in-95`}
                >
                    <div className="flex flex-col gap-1">
                        {items.map((link) => (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                end={link.end}
                                onClick={() => setOpen(false)}
                                className={({ isActive: linkActive }) =>
                                    `group flex items-center gap-3 rounded-xl transition-all ${link.icon ? "p-2.5" : "px-3 py-2"} ${
                                        linkActive
                                            ? "bg-emerald-50 text-emerald-900 font-bold dark:bg-emerald-950/60 dark:text-emerald-200 ring-1 ring-emerald-500/30"
                                            : "hover:bg-gray-50 text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
                                    }`
                                }
                            >
                                {link.icon && (
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-700 group-hover:scale-105 group-hover:bg-emerald-100 group-hover:text-emerald-700 dark:bg-slate-800 dark:text-gray-300 dark:group-hover:bg-emerald-900/60 dark:group-hover:text-emerald-300 transition-all">
                                        <link.icon size={14} />
                                    </span>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1.5">
                                        <span className="text-xs font-bold truncate">
                                            {link.label}
                                        </span>
                                        {link.badge && (
                                            <span
                                                className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold tracking-wider uppercase border shrink-0 ${
                                                    link.badgeColor ||
                                                    "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700"
                                                }`}
                                            >
                                                {link.badge}
                                            </span>
                                        )}
                                    </div>
                                    {link.desc && (
                                        <p className="mt-0.5 text-[11px] leading-tight text-gray-500 dark:text-gray-400 line-clamp-1">
                                            {link.desc}
                                        </p>
                                    )}
                                </div>
                            </NavLink>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function StrategyBuilderMenu() {
    return <NavDropdown label="Strategy Builder" basePath="/strategy-builder" items={STRATEGY_BUILDER_LINKS} widthClass="w-52" />;
}

function SimulatorMenu() {
    return <NavDropdown label="Option Backtest" basePath="/simulator" items={SIMULATOR_LINKS} widthClass="w-80" />;
}

function EquityDataMenu() {
    return <NavDropdown label="Equity Data" basePath="/equity-data" items={EQUITY_DATA_LINKS} widthClass="w-88" />;
}

export default function TopNav() {
    const { user, isPro, logout, loading } = useAuth();
    const navigate = useNavigate();
    const topNavLocation = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);

    // stockmojo.in's Strategy Builder header has no ticker bar — keep it
    // everywhere else, hide it just on this route to match that page.
    const hideTicker = topNavLocation.pathname.startsWith("/strategy-builder");

    return (
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95 backdrop-blur-md">
            {!hideTicker && <MarketTickerBar />}
            <div className="flex items-center justify-between px-4 py-3 sm:px-6">
                <NavLink to="/" onClick={() => setMobileOpen(false)}>
                    <Logo />
                </NavLink>

                {/* Full nav — hidden below xl: up to 1279px a logged-in user's
                    chip + Log out pushed it ~50px past the viewport (see mobile
                    <nav> panel below for the collapsed equivalent). */}
                <nav className="hidden items-center gap-4 xl:gap-6 whitespace-nowrap text-sm font-medium text-gray-600 dark:text-gray-300 xl:flex">
                    {links.map((link) =>
                        link.dropdown === "strategy-builder" ? (
                            <StrategyBuilderMenu key="strategy-builder" />
                        ) : link.dropdown === "simulator" ? (
                            <SimulatorMenu key="simulator" />
                        ) : (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                className={({ isActive }) =>
                                    isActive
                                        ? "text-emerald-600 font-bold dark:text-emerald-400"
                                        : "hover:text-gray-900 dark:hover:text-white"
                                }
                            >
                                {link.label}
                            </NavLink>
                        )
                    )}
                    <EquityDataMenu />
                </nav>

                <div className="flex items-center gap-2 sm:gap-3">
                    <ThemeToggle />
                    {loading ? (
                        <div className="w-20" />
                    ) : user ? (
                        <div className="flex items-center gap-2 text-sm sm:gap-2.5">
                            <NavLink
                                to="/profile"
                                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-700 hover:border-emerald-500/50 hover:bg-white dark:border-gray-800 dark:bg-gray-800/80 dark:text-gray-200 dark:hover:bg-gray-800 transition"
                            >
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-black text-white overflow-hidden shrink-0">
                                    {user.avatar_url ? (
                                        <img src={user.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                    ) : (
                                        user.name ? user.name.charAt(0).toUpperCase() : "U"
                                    )}
                                </span>
                                <span className="hidden sm:inline max-w-[100px] truncate">{user.name}</span>
                                <span className={`rounded px-1.5 py-0.2 text-[9px] font-black uppercase ${isPro ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                                    {isPro ? "PRO" : "FREE"}
                                </span>
                            </NavLink>
                            <button
                                onClick={logout}
                                className="hidden text-xs font-semibold text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 sm:inline transition"
                            >
                                Log out
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => navigate("/login")}
                            className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-xs transition sm:px-4"
                        >
                            Login
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => setMobileOpen((v) => !v)}
                        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 xl:hidden"
                        aria-label={mobileOpen ? "Close menu" : "Open menu"}
                    >
                        {mobileOpen ? <FiX size={20} /> : <FiMenu size={20} />}
                    </button>
                </div>
            </div>

            {mobileOpen && (
                <nav className="flex flex-col border-t border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 xl:hidden max-h-[calc(100vh-65px)] overflow-y-auto">
                    {links.map((link) =>
                        link.dropdown === "strategy-builder" ? (
                            <div key="strategy-builder" className="border-t border-gray-100 py-2 dark:border-gray-800">
                                <div className="px-2 py-1 text-[11px] font-black uppercase tracking-wider text-gray-400">Strategy Builder</div>
                                <div className="flex flex-col gap-1 mt-1">
                                    {STRATEGY_BUILDER_LINKS.map((sub) => (
                                        <NavLink
                                            key={sub.to}
                                            to={sub.to}
                                            end={sub.end}
                                            onClick={() => setMobileOpen(false)}
                                            className={({ isActive }) =>
                                                `flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition ${
                                                    isActive
                                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 ring-1 ring-emerald-500/30"
                                                        : "hover:bg-gray-50 text-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                                                }`
                                            }
                                        >
                                            <span>{sub.label}</span>
                                        </NavLink>
                                    ))}
                                </div>
                            </div>
                        ) : link.dropdown === "simulator" ? (
                            <div key="simulator" className="border-t border-gray-100 py-2 dark:border-gray-800">
                                <div className="px-2 py-1 text-[11px] font-black uppercase tracking-wider text-gray-400">Option Backtesting</div>
                                <div className="flex flex-col gap-1 mt-1">
                                    {SIMULATOR_LINKS.map((sub) => (
                                        <NavLink
                                            key={sub.to}
                                            to={sub.to}
                                            end={sub.end}
                                            onClick={() => setMobileOpen(false)}
                                            className={({ isActive }) =>
                                                `flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition ${
                                                    isActive
                                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 ring-1 ring-emerald-500/30"
                                                        : "hover:bg-gray-50 text-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                                                }`
                                            }
                                        >
                                            <span className="flex items-center gap-2.5">
                                                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                                    {sub.icon && <sub.icon size={13} />}
                                                </span>
                                                <span>{sub.label}</span>
                                            </span>
                                            {sub.badge && (
                                                <span className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase border ${sub.badgeColor}`}>
                                                    {sub.badge}
                                                </span>
                                            )}
                                        </NavLink>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                onClick={() => setMobileOpen(false)}
                                className={({ isActive }) =>
                                    `rounded-xl px-3 py-2 text-xs font-bold ${
                                        isActive
                                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                            : "hover:bg-gray-50 text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                                    }`
                                }
                            >
                                {link.label}
                            </NavLink>
                        )
                    )}
                    <div className="mt-1 border-t border-gray-100 pt-2 dark:border-gray-800">
                        <div className="px-2 py-1 text-[11px] font-black uppercase tracking-wider text-gray-400">Equity Analytics</div>
                        <div className="flex flex-col gap-1 mt-1">
                            {EQUITY_DATA_LINKS.map((link) => (
                                <NavLink
                                    key={link.to}
                                    to={link.to}
                                    onClick={() => setMobileOpen(false)}
                                    className={({ isActive }) =>
                                        `flex items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition ${
                                            isActive
                                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                                                : "hover:bg-gray-50 text-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
                                        }`
                                    }
                                >
                                    <span className="flex items-center gap-2.5">
                                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                            {link.icon && <link.icon size={13} />}
                                        </span>
                                        <span>{link.label}</span>
                                    </span>
                                    {link.badge && (
                                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase border ${link.badgeColor}`}>
                                            {link.badge}
                                        </span>
                                    )}
                                </NavLink>
                            ))}
                        </div>
                    </div>
                    {user && (
                        <div className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-2 dark:border-gray-800 sm:hidden">
                            <NavLink
                                to="/profile"
                                onClick={() => setMobileOpen(false)}
                                className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-black text-white overflow-hidden shrink-0">
                                        {user.avatar_url ? (
                                            <img src={user.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                                        ) : (
                                            user.name ? user.name.charAt(0).toUpperCase() : "U"
                                        )}
                                    </span>
                                    <span>My Profile ({user.name})</span>
                                </span>
                                <span className={`rounded px-1.5 py-0.2 text-[9px] font-black uppercase ${isPro ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}>
                                    {isPro ? "PRO" : "FREE"}
                                </span>
                            </NavLink>
                            <button
                                onClick={() => { setMobileOpen(false); logout(); }}
                                className="w-full text-left px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg"
                            >
                                Log out
                            </button>
                        </div>
                    )}
                </nav>
            )}
        </header>
    );
}
