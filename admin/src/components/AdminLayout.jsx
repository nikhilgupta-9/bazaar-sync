import { useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAdminAuth } from "../context/AdminAuthContext";
import Sidebar from "./Sidebar";
import AppHeader from "./AppHeader";

// Gates every route nested under it: no user -> bounce to /login. Server-
// side, requireAuth+requireAdmin on every /api/admin/* route is the real
// enforcement (see requireAdmin.js) — this is the client-side UX layer on
// top of that, not the security boundary itself.
export default function AdminLayout() {
    const { user, loading } = useAdminAuth();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#08080b] text-sm text-gray-500">
                <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                    <span>Loading Admin…</span>
                </div>
            </div>
        );
    }
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div className="flex min-h-screen w-full bg-[#08080b] text-gray-200 antialiased">
            {/* Sidebar for Desktop & Mobile Overlay */}
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            {/* Main Application Area */}
            <div className="flex min-h-screen flex-1 flex-col w-full min-w-0 max-w-full overflow-x-hidden">
                <AppHeader onToggleSidebar={() => setSidebarOpen((v) => !v)} />
                <main className="flex-1 w-full min-w-0 max-w-full">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
