import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { resetPassword } from "../services/authApi";
import AuthBackground from "../components/AuthBackground";

// Same palette Auth.jsx/ForgotPassword.jsx use — see ForgotPassword.jsx's
// header comment for why this is a local copy rather than a shared import.
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
        submitTextClass: "text-white",
    },
};

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const [loading, setLoading] = useState(false);
    const { isDark } = useTheme();
    const navigate = useNavigate();
    const c = isDark ? PALETTE.dark : PALETTE.light;

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        if (password !== confirm) {
            setError("passwords don't match");
            return;
        }
        setLoading(true);
        try {
            await resetPassword(token, password);
            setDone(true);
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
                        Set a new password
                    </h1>

                    {!token ? (
                        <p className="mb-2 text-sm" style={{ color: c.errorText }}>
                            This reset link is missing its token — use the link from your email exactly as sent, or request a new one.
                        </p>
                    ) : done ? (
                        <>
                            <p className="mb-4 text-sm" style={{ color: c.muted }}>
                                Your password has been reset.
                            </p>
                            <button
                                onClick={() => navigate("/login")}
                                className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition hover:opacity-90 ${c.submitTextClass}`}
                                style={{ background: c.green }}
                            >
                                Log in
                            </button>
                        </>
                    ) : (
                        <>
                            <p className="mb-6 text-sm" style={{ color: c.muted }}>
                                Choose a new password for your account.
                            </p>
                            <form onSubmit={handleSubmit} className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs font-medium" style={{ color: c.muted }}>New password</label>
                                    <input
                                        type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                                        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                                        style={{ background: c.inputBg, border: `1px solid ${c.border}`, color: c.text }}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-medium" style={{ color: c.muted }}>Confirm password</label>
                                    <input
                                        type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)}
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
                                    {loading ? "Resetting…" : "Reset password"}
                                </button>
                            </form>
                        </>
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
