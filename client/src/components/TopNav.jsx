import React from "react";
import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { FiSun, FiMoon, FiMenu, FiX } from "react-icons/fi";
import Logo from "./Logo";
import MarketTickerBar from "./MarketTickerBar";

function ThemeToggle() {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
            {isDark ? <FiSun size={18} className="text-amber-400" /> : <FiMoon size={18} />}
        </button>
    );
}

const links = [
    { to: "/strategy-builder", label: "Strategy Builder" },
    { dropdown: "simulator", label: "Option Backtesting" },
    { to: "/option-chain", label: "Option Chain" },
    { to: "/paper-trade", label: "Paper Trade" },
    { to: "/historical-chart", label: "Historical Chart" },
];

const SIMULATOR_LINKS = [
    { to: "/simulator", label: "Indian Options Backtest", end: true },
    { to: "/simulator/bitcoin", label: "Crypto / BTC Backtest" },
];

const EQUITY_DATA_LINKS = [
    { to: "/equity-data/sector-rotation", label: "Sector Rotation" },
    { to: "/equity-data/sector-performance", label: "Sector Performance" },
    { to: "/equity-data/market-map", label: "Market Map" },
    { to: "/equity-data/52-week-high-low", label: "52 Week High/Low" },
    { to: "/equity-data/industry-momentum", label: "Industry Momentum Stocks" },
    { to: "/equity-data/most-active", label: "High Activity Options" },
];

// Shared dropdown for a nav item that fans out to sub-pages (Simulator,
// Equity Data). `basePath` drives the parent's active-highlight; `items` are
// the sub-links (pass `end` on one whose path is a prefix of the others).
function NavDropdown({ label, basePath, items }) {
    const [open, setOpen] = useState(false);
    const location = useLocation();
    const isActive = location.pathname.startsWith(basePath);

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={`flex items-center gap-1 transition ${
                    isActive
                        ? "text-emerald-600 font-bold dark:text-emerald-400"
                        : "text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
                }`}
            >
                {label}
                <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}>
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-xl border border-gray-200 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800">
                        {items.map((link) => (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                end={link.end}
                                onClick={() => setOpen(false)}
                                className={({ isActive: linkActive }) =>
                                    `block px-4 py-2 text-xs font-semibold ${
                                        linkActive
                                            ? "bg-emerald-50 text-emerald-700 font-bold dark:bg-emerald-950/60 dark:text-emerald-300"
                                            : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                                    }`
                                }
                            >
                                {link.label}
                            </NavLink>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function SimulatorMenu() {
    return <NavDropdown label="Option Backtest" basePath="/simulator" items={SIMULATOR_LINKS} />;
}

function EquityDataMenu() {
    return <NavDropdown label="Equity Data" basePath="/equity-data" items={EQUITY_DATA_LINKS} />;
}

export default function TopNav() {
    const { user, isPro, logout, loading } = useAuth();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <MarketTickerBar />
            <div className="flex items-center justify-between px-4 py-3 sm:px-6">
                <NavLink to="/" onClick={() => setMobileOpen(false)}>
                    <Logo />
                </NavLink>

                {/* Full nav — hidden below md, where it would overflow the viewport
                    (see mobile <nav> panel below for the collapsed equivalent). */}
                <nav className="hidden items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-300 md:flex">
                    {links.map((link) =>
                        link.dropdown === "simulator" ? (
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
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-black text-white">
                                    {user.name ? user.name.charAt(0).toUpperCase() : "U"}
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
                        className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 md:hidden"
                        aria-label={mobileOpen ? "Close menu" : "Open menu"}
                    >
                        {mobileOpen ? <FiX size={20} /> : <FiMenu size={20} />}
                    </button>
                </div>
            </div>

            {mobileOpen && (
                <nav className="flex flex-col border-t border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 md:hidden">
                    {links.map((link) =>
                        link.dropdown === "simulator" ? (
                            <div key="simulator" className="border-t border-gray-100 py-1 dark:border-gray-800">
                                <div className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-gray-400">Option Backtesting</div>
                                {SIMULATOR_LINKS.map((sub) => (
                                    <NavLink
                                        key={sub.to}
                                        to={sub.to}
                                        end={sub.end}
                                        onClick={() => setMobileOpen(false)}
                                        className={({ isActive }) =>
                                            `block rounded-md px-2 py-2 ${
                                                isActive
                                                    ? "bg-emerald-50 text-emerald-700 font-bold dark:bg-emerald-950/60 dark:text-emerald-300"
                                                    : "hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                                            }`
                                        }
                                    >
                                        {sub.label}
                                    </NavLink>
                                ))}
                            </div>
                        ) : (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                onClick={() => setMobileOpen(false)}
                                className={({ isActive }) =>
                                    `rounded-md px-2 py-2 ${
                                        isActive
                                            ? "bg-emerald-50 text-emerald-700 font-bold dark:bg-emerald-950/60 dark:text-emerald-300"
                                            : "hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                                    }`
                                }
                            >
                                {link.label}
                            </NavLink>
                        )
                    )}
                    <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
                        <div className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-gray-400">Equity Analytics</div>
                        {EQUITY_DATA_LINKS.map((link) => (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                onClick={() => setMobileOpen(false)}
                                className={({ isActive }) =>
                                    `block rounded-md px-2 py-2 ${
                                        isActive
                                            ? "bg-emerald-50 text-emerald-700 font-bold dark:bg-emerald-950/60 dark:text-emerald-300"
                                            : "hover:bg-gray-50 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
                                    }`
                                }
                            >
                                {link.label}
                            </NavLink>
                        ))}
                    </div>
                    {user && (
                        <div className="mt-2 flex flex-col gap-2 border-t border-gray-100 pt-2 dark:border-gray-800 sm:hidden">
                            <NavLink
                                to="/profile"
                                onClick={() => setMobileOpen(false)}
                                className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                                <span className="flex items-center gap-2">
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-black text-white">
                                        {user.name ? user.name.charAt(0).toUpperCase() : "U"}
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
