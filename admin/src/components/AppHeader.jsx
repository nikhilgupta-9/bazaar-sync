import { useEffect, useRef, useState } from "react";
import { FiMenu, FiChevronDown, FiLogOut } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";

// Persistent full-width top navbar, AdminLTE-style app-header: a sidebar
// toggle on the left, a user menu on the right. Deliberately no
// notification/message bell dropdowns like AdminLTE's reference — there's
// no real notification/message data source behind them (project convention:
// don't build UI ahead of what's real, see ComingSoon.jsx).
export default function AppHeader({ onToggleSidebar }) {
    const { user, logout } = useAdminAuth();
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);

    useEffect(() => {
        if (!menuOpen) return;
        function onClickOutside(e) {
            if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
        }
        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, [menuOpen]);

    return (
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0b0f]/95 px-4 backdrop-blur">
            <button
                onClick={onToggleSidebar}
                aria-label="Toggle sidebar"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-gray-200 lg:hidden"
            >
                <FiMenu className="h-[18px] w-[18px]" />
            </button>
            <div className="hidden lg:block" />

            <div className="relative" ref={menuRef}>
                <button
                    onClick={() => setMenuOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5"
                >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
                        {user?.name?.trim()?.[0]?.toUpperCase() || "A"}
                    </div>
                    <span className="hidden text-sm font-medium text-gray-200 sm:inline">{user?.name}</span>
                    <FiChevronDown className={`h-3.5 w-3.5 text-gray-500 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
                </button>

                {menuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#101015] shadow-xl">
                        <div className="border-b border-white/10 px-4 py-3">
                            <div className="text-sm font-semibold text-gray-200">{user?.name}</div>
                            <div className="mt-0.5 truncate text-xs text-gray-500">{user?.email}</div>
                        </div>
                        <button
                            onClick={logout}
                            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-gray-400 hover:bg-white/5 hover:text-gray-200"
                        >
                            <FiLogOut className="h-3.5 w-3.5" />
                            Log out
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}
