import { Routes, Route, Navigate } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Users from "./pages/Users";
import Payments from "./pages/Payments";
import Positions from "./pages/Positions";
import Strategies from "./pages/Strategies";
import ComingSoon from "./pages/ComingSoon";

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<AdminLayout />}>
                <Route path="/" element={<Overview />} />
                <Route path="/users" element={<Users />} />
                <Route path="/payments" element={<Payments />} />
                <Route path="/positions" element={<Positions />} />
                <Route path="/strategies" element={<Strategies />} />
                <Route path="/institute-access" element={<ComingSoon title="Institute Access" description="Free access by IP allowlist — not built yet." />} />
                <Route path="/plans" element={<ComingSoon title="Plans & Coupons" description="Plan/discount/coupon management — not built yet." />} />
                <Route path="/events" element={<ComingSoon title="Events" description="Event management — not built yet." />} />
                <Route path="/terms" element={<ComingSoon title="T&C" description="Terms & Conditions editor — not built yet." />} />
                <Route path="/seo" element={<ComingSoon title="SEO Tool" description="Scope not yet defined — ask before building." />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
