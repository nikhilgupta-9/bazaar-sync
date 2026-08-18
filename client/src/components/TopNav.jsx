import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { FiSun, FiMoon, FiMenu, FiX } from "react-icons/fi";

function ThemeToggle() {
    const { isDark, toggleTheme } = useTheme();
    return (
        <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
            {isDark ? <FiSun size={18} /> : <FiMoon size={18} />}
        </button>
    );
}

const links = [
    { to: "/strategy-builder", label: "Strategy Builder" },
    { to: "/simulator", label: "Simulator" },
    { to: "/option-chain", label: "Option Chain" },
    { to: "/paper-trade", label: "Paper Trade" },
    { to: "/historical-chart", label: "Historical Chart" },
];

const EQUITY_DATA_LINKS = [
    { to: "/equity-data/sector-rotation", label: "Sector Rotation" },
    { to: "/equity-data/sector-performance", label: "Sector Performance" },
    { to: "/equity-data/market-map", label: "Market Map" },
    { to: "/equity-data/52-week-high-low", label: "52 Week High/Low" },
    { to: "/equity-data/industry-momentum", label: "Industry Momentum Stocks" },
    { to: "/equity-data/most-active", label: "Most Active" },
];

function EquityDataMenu() {
    const [open, setOpen] = useState(false);
    const location = useLocation();
    const isActive = location.pathname.startsWith("/equity-data");

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={`flex items-center gap-1 ${isActive ? "text-blue-600" : "hover:text-gray-900"}`}
            >
                Equity Data
                <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}>
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-lg border border-gray-200 bg-white py-1.5 shadow-xl">
                        {EQUITY_DATA_LINKS.map((link) => (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                onClick={() => setOpen(false)}
                                className={({ isActive: linkActive }) =>
                                    `block px-4 py-2 text-sm ${linkActive ? "bg-blue-50 text-blue-600" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`
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

export default function TopNav() {
    const { user, isPro, logout, loading } = useAuth();
    const navigate = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);

    return (
        <header className="border-b border-gray-200 bg-white">
            <div className="flex items-center justify-between px-4 py-3 sm:px-6">
                <NavLink to="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-1 text-lg font-bold">
                    <span className="text-blue-600">Bazaar</span>
                    <span className="text-gray-900">Sync</span>
                </NavLink>

                {/* Full nav — hidden below md, where it would overflow the viewport
                    (see mobile <nav> panel below for the collapsed equivalent). */}
                <nav className="hidden items-center gap-6 text-sm font-medium text-gray-600 md:flex">
                    {links.map((link) => (
                        <NavLink
                            key={link.to}
                            to={link.to}
                            className={({ isActive }) =>
                                isActive ? "text-blue-600" : "hover:text-gray-900"
                            }
                        >
                            {link.label}
                        </NavLink>
                    ))}
                    <EquityDataMenu />
                </nav>

                <div className="flex items-center gap-2 sm:gap-3">
                    <ThemeToggle />
                    {loading ? (
                        <div className="w-20" />
                    ) : user ? (
                        <div className="flex items-center gap-2 text-sm sm:gap-3">
                            <span className="hidden text-gray-600 sm:inline">{user.name}</span>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${isPro ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                                {isPro ? "Pro" : "Free"}
                            </span>
                            <button onClick={logout} className="hidden text-gray-500 hover:text-gray-900 sm:inline">Log out</button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => navigate("/login")}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 sm:px-4"
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
                <nav className="flex flex-col border-t border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 md:hidden">
                    {links.map((link) => (
                        <NavLink
                            key={link.to}
                            to={link.to}
                            onClick={() => setMobileOpen(false)}
                            className={({ isActive }) =>
                                `rounded-md px-2 py-2 ${isActive ? "text-blue-600" : "hover:bg-gray-50 hover:text-gray-900"}`
                            }
                        >
                            {link.label}
                        </NavLink>
                    ))}
                    <div className="mt-1 border-t border-gray-100 pt-1">
                        <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Equity Data</div>
                        {EQUITY_DATA_LINKS.map((link) => (
                            <NavLink
                                key={link.to}
                                to={link.to}
                                onClick={() => setMobileOpen(false)}
                                className={({ isActive }) =>
                                    `block rounded-md px-2 py-2 ${isActive ? "text-blue-600" : "hover:bg-gray-50 hover:text-gray-900"}`
                                }
                            >
                                {link.label}
                            </NavLink>
                        ))}
                    </div>
                    {user && (
                        <div className="mt-1 flex items-center justify-between border-t border-gray-100 px-2 pt-2 sm:hidden">
                            <span className="text-gray-600">{user.name}</span>
                            <button onClick={() => { setMobileOpen(false); logout(); }} className="text-gray-500 hover:text-gray-900">Log out</button>
                        </div>
                    )}
                </nav>
            )}
        </header>
    );
}
