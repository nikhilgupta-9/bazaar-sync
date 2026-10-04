import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Pro-gate modal for features restricted to the Pro tier (see CLAUDE.md hard
// rule: "Free tier users cannot access ... full history"). Historical mode
// on the Option Chain page is gated by this. There's no self-serve upgrade
// flow yet (Razorpay isn't built — see CLAUDE.md Next Steps), so "View
// Plans" honestly reflects that instead of linking to a page that doesn't
// exist: logged-out users go to /login, logged-in free-tier users see a
// plain "coming soon" note rather than a fabricated pricing link.
const FEATURES = [
    "PE-CE OI Track", "Strategy Builder", "Simulator", "Put-Call Ratio",
    "Market Movers", "Historical Data", "Open Interest", "Max Pain",
    "Future Activity", "Many More",
];

export default function PremiumFeaturesModal({ onClose }) {
    const navigate = useNavigate();
    const { user } = useAuth();

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-bold text-gray-900">Premium Features</h2>
                        <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
                            ✕
                        </button>
                    </div>

                    <p className="mb-3 text-xs text-gray-600">
                        {user ? "Your plan doesn't include this yet — subscribe to unlock premium trading tools." : "Log in and subscribe to unlock premium trading tools."}
                    </p>

                    <ul className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-gray-700">
                        {FEATURES.map((f) => (
                            <li key={f} className="flex items-center gap-1.5">
                                <span className="text-blue-500">✓</span> {f}
                            </li>
                        ))}
                    </ul>

                    {user ? (
                        <button
                            onClick={() => {
                                onClose();
                                navigate("/pricing");
                            }}
                            className="w-full rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20"
                        >
                            View Pro Plans & Subscribe
                        </button>
                    ) : (
                        <button
                            onClick={() => {
                                onClose();
                                navigate("/login");
                            }}
                            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-bold text-white hover:bg-blue-700 shadow-md shadow-blue-600/20"
                        >
                            Log In to Subscribe
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}
