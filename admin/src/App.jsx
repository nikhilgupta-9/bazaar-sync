import { Routes, Route, Navigate } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Users from "./pages/Users";
import Payments from "./pages/Payments";
import Positions from "./pages/Positions";
import Strategies from "./pages/Strategies";
import InstituteAccess from "./pages/InstituteAccess";
import Plans from "./pages/Plans";
import Events from "./pages/Events";
import Terms from "./pages/Terms";
import Seo from "./pages/Seo";

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
                <Route path="/institute-access" element={<InstituteAccess />} />
                <Route path="/plans" element={<Plans />} />
                <Route path="/events" element={<Events />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/seo" element={<Seo />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
