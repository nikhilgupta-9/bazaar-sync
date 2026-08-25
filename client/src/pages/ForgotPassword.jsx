import { useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { forgotPassword } from "../services/authApi";
import AuthBackground from "../components/AuthBackground";

// Same palette Auth.jsx uses, kept as its own local copy rather than a
// shared import since each auth page owns its own small bit of state
// independently (matches this codebase's existing per-page symbol-picker
// convention noted elsewhere, e.g. StrategyBuilder/Simulator's SymbolOption).
const PALETTE = {
    dark: {
        text: "#f5f7fa",
        muted: "#8b93a7",
        border: "#18202c",
        green: "#0be55c",
        cardBg: "rgba(11,20,32,0.72)",
        inputBg: "rgba(255,255,255,0.04)",
        errorBg: "rgba(235,9,11,0.1)",
        errorBorder: "#eb090b",
        errorText: "#ff8f90",
        successBg: "rgba(11,229,92,0.1)",
        successBorder: "#0be55c",
        submitTextClass: "text-black",
    },
    light: {
        text: "#111827",
        muted: "#6b7280",
        border: "#e2e8f0",
        green: "#029e2e",
        cardBg: "rgba(255,255,255,0.82)",
        inputBg: "rgba(255,255,255,0.9)",
        errorBg: "rgba(235,9,11,0.06)",
        errorBorder: "#eb090b",
        errorText: "#c40709",
        successBg: "rgba(2,158,46,0.06)",
        successBorder: "#029e2e",
        submitTextClass: "text-white",
    },
};

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [error, setError] = useState(null);
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const { isDark } = useTheme();
    const c = isDark ? PALETTE.dark : PALETTE.light;

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await forgotPassword(email);
            // Same message regardless of whether the email actually exists —
            // the backend already returns a generic response either way, see
            // authController.js's forgotPassword.
            setSent(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="relative min-h-[calc(100vh-57px)] overflow-hidden">
            <AuthBackground />

            <div className="relative z-10 flex min-h-[calc(100vh-57px)] items-center justify-center px-6 py-12">
                <div
                    className="w-full max-w-sm rounded-2xl p-8 shadow-2xl backdrop-blur-xl"
                    style={{ background: c.cardBg, border: `1px solid ${c.border}` }}
                >
                    <div className="mb-6 flex items-baseline gap-1 text-sm font-bold">
                        <span style={{ color: c.green }}>Bazaar</span>
                        <span style={{ color: c.text }}>Sync</span>
                    </div>

                    <h1 className="mb-1 text-2xl font-bold" style={{ color: c.text }}>
                        Forgot your password?
                    </h1>
                    <p className="mb-6 text-sm" style={{ color: c.muted }}>
                        Enter your account email and we'll send you a link to reset it.
                    </p>

                    {sent ? (
                        <div
                            className="rounded-lg px-3 py-3 text-sm"
                            style={{ background: c.successBg, border: `1px solid ${c.successBorder}`, color: c.text }}
                        >
                            If an account exists for <strong>{email}</strong>, a reset link has been sent. Check your inbox.
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-3">
                            <div>
                                <label className="mb-1 block text-xs font-medium" style={{ color: c.muted }}>Email</label>
                                <input
                                    type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                                    style={{ background: c.inputBg, border: `1px solid ${c.border}`, color: c.text }}
                                />
                            </div>

                            {error && (
                                <div className="rounded-lg px-3 py-2 text-xs" style={{ background: c.errorBg, border: `1px solid ${c.errorBorder}`, color: c.errorText }}>
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit" disabled={loading}
                                className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50 ${c.submitTextClass}`}
                                style={{ background: c.green }}
                            >
                                {loading ? "Sending…" : "Send reset link"}
                            </button>
                        </form>
                    )}

                    <Link
                        to="/login"
                        className="mt-4 block text-center text-xs hover:opacity-80"
                        style={{ color: c.muted }}
                    >
                        Back to log in
                    </Link>
                </div>
            </div>
        </div>
    );
}
