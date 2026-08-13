import { useAdminAuth } from "../context/AdminAuthContext";

export default function TopBar({ title, subtitle }) {
    const { user, logout } = useAdminAuth();

    return (
        <header className="flex items-center justify-between border-b border-white/10 bg-[#0b0b0f]/80 px-6 py-4 backdrop-blur">
            <div>
                <h1 className="text-lg font-bold text-white">{title}</h1>
                {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-3">
                <div className="text-right">
                    <div className="text-sm font-semibold text-gray-200">{user?.name}</div>
                    <div className="text-[11px] text-gray-500">{user?.email}</div>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
                    {user?.name?.trim()?.[0]?.toUpperCase() || "A"}
                </div>
                <button
                    onClick={logout}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:border-white/20 hover:text-gray-200"
                >
                    Log out
                </button>
            </div>
        </header>
    );
}
