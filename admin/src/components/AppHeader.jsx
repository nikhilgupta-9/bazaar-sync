import { useEffect, useRef, useState } from "react";
import { FiMenu, FiChevronDown, FiLogOut, FiExternalLink } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";

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
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#0b0b0f]/95 px-3 sm:px-6 backdrop-blur">
            {/* Left: Mobile Sidebar Trigger & Brand */}
            <div className="flex items-center gap-3">
                <button
                    onClick={onToggleSidebar}
                    aria-label="Toggle sidebar"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white lg:hidden transition"
                >
                    <FiMenu className="h-4 w-4" />
                </button>
                <div className="flex items-center gap-2 lg:hidden">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-xs font-black text-white">B</div>
                    <span className="text-xs font-black tracking-tight text-white">Bazaar Sync</span>
                    <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.2 text-[9px] font-extrabold uppercase text-violet-300">
                        Admin
                    </span>
                </div>
            </div>

            {/* Center / Right: App Link & Profile Menu */}
            <div className="flex items-center gap-2 sm:gap-3">
                <a
                    href="http://localhost:5173"
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-violet-500/40 hover:bg-white/10 hover:text-white transition"
                    title="Open Main Client Trading App"
                >
                    <span>Client App</span>
                    <FiExternalLink size={12} className="text-gray-400" />
                </a>

                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setMenuOpen((v) => !v)}
                        className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/5 px-2.5 py-1.5 hover:bg-white/10 transition"
                    >
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-xs font-bold text-white shadow-xs">
                            {user?.name?.trim()?.[0]?.toUpperCase() || "A"}
                        </div>
                        <span className="hidden text-xs font-semibold text-gray-200 sm:inline max-w-32 truncate">{user?.name}</span>
                        <FiChevronDown className={`h-3 w-3 text-gray-400 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
                    </button>

                    {menuOpen && (
                        <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#12121a] shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
                            <div className="border-b border-white/10 px-4 py-3 bg-white/5">
                                <div className="text-xs font-bold text-white truncate">{user?.name}</div>
                                <div className="mt-0.5 truncate text-[11px] text-gray-400 font-mono">{user?.email}</div>
                            </div>
                            <div className="p-1.5">
                                <a
                                    href="http://localhost:5173"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="sm:hidden flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold text-gray-300 hover:bg-white/5 hover:text-white"
                                >
                                    <span>Open Client App</span>
                                    <FiExternalLink size={12} />
                                </a>
                                <button
                                    onClick={logout}
                                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition"
                                >
                                    <FiLogOut className="h-3.5 w-3.5" />
                                    Log out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
}
