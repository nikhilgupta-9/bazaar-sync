import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { FcGoogle } from "react-icons/fc";
import AuthBackground from "../components/AuthBackground";

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

export default function Auth() {
    const [mode, setMode] = useState("login"); // 'login' | 'register'
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const { login, register } = useAuth();
    const { isDark } = useTheme();
    const navigate = useNavigate();
    const c = isDark ? PALETTE.dark : PALETTE.light;

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (mode === "login") await login(email, password);
            else await register(name, email, password);
            navigate("/option-chain");
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
                        {mode === "login" ? "Welcome back" : "Create your account"}
                    </h1>
                    <p className="mb-6 text-sm" style={{ color: c.muted }}>
                        {mode === "login"
                            ? "Log in to access your saved strategies and paper trading account."
                            : "Start building, backtesting, and paper trading options strategies."}
                    </p>

                    <button
                        type="button"
                        disabled
                        title="Google sign-in is coming soon — needs a Google Cloud OAuth client, not set up yet"
                        aria-disabled="true"
                        className="mb-4 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-500 opacity-70"
                    >
                        <FcGoogle size={18} />
                        Continue with Google
                        <span className="ml-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gray-400">Soon</span>
                    </button>

                    <div className="mb-4 flex items-center gap-3">
                        <div className="h-px flex-1" style={{ background: c.border }} />
                        <span className="text-xs" style={{ color: c.muted }}>or continue with email</span>
                        <div className="h-px flex-1" style={{ background: c.border }} />
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-3">
                        {mode === "register" && (
                            <div>
                                <label className="mb-1 block text-xs font-medium" style={{ color: c.muted }}>Name</label>
                                <input
                                    type="text" required value={name} onChange={(e) => setName(e.target.value)}
                                    className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                                    style={{ background: c.inputBg, border: `1px solid ${c.border}`, color: c.text }}
                                />
                            </div>
                        )}
                        <div>
                            <label className="mb-1 block text-xs font-medium" style={{ color: c.muted }}>Email</label>
                            <input
                                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                                className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                                style={{ background: c.inputBg, border: `1px solid ${c.border}`, color: c.text }}
                            />
                        </div>
                        <div>
                            <div className="mb-1 flex items-center justify-between">
                                <label className="block text-xs font-medium" style={{ color: c.muted }}>Password</label>
                                {mode === "login" && (
                                    <Link to="/forgot-password" className="text-xs hover:opacity-80" style={{ color: c.muted }}>
                                        Forgot password?
                                    </Link>
                                )}
                            </div>
                            <input
                                type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
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
                            {loading ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
                        </button>
                    </form>

                    <button
                        onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(null); }}
                        className="mt-4 w-full text-center text-xs hover:opacity-80"
                        style={{ color: c.muted }}
                    >
                        {mode === "login" ? "Need an account? Register" : "Already have an account? Log in"}
                    </button>
                </div>
            </div>
        </div>
    );
}
