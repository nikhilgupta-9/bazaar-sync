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
        return <div className="flex min-h-screen items-center justify-center bg-[#08080b] text-sm text-gray-500">Loading…</div>;
    }
    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return (
        <div className="flex min-h-screen bg-[#08080b]">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <div className="flex min-h-screen flex-1 flex-col lg:pl-0">
                <AppHeader onToggleSidebar={() => setSidebarOpen((v) => !v)} />
                <Outlet />
            </div>
        </div>
    );
}
