import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const links = [
    { to: "/strategy-builder", label: "Strategy Builder" },
    { to: "/simulator", label: "Simulator" },
    { to: "/option-chain", label: "Option Chain" },
    { to: "/max-pain", label: "Max Pain" },
    { to: "/put-call-ratio", label: "PCR" },
    { to: "/iv-chart", label: "IV Chart" },
    { to: "/straddle-chart", label: "Straddle" },
    { to: "/oi-heatmap", label: "OI Heatmap" },
    { to: "/backtest", label: "Backtest" },
];

export default function TopNav() {
    const { user, isPro, logout, loading } = useAuth();
    const navigate = useNavigate();

    return (
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
            <NavLink to="/" className="flex items-center gap-1 text-lg font-bold">
                <span className="text-blue-600">Bazaar</span>
                <span className="text-gray-900">Sync</span>
            </NavLink>
            <nav className="flex items-center gap-6 text-sm font-medium text-gray-600">
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
            </nav>

            {loading ? (
                <div className="w-20" />
            ) : user ? (
                <div className="flex items-center gap-3 text-sm">
                    <span className="text-gray-600">{user.name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${isPro ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                        {isPro ? "Pro" : "Free"}
                    </span>
                    <button onClick={logout} className="text-gray-500 hover:text-gray-900">Log out</button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => navigate("/login")}
                    className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                    Login
                </button>
            )}
        </header>
    );
}
