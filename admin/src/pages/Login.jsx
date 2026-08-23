import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../context/AdminAuthContext";

export default function Login() {
    const { user, loading, login, notAdminError } = useAdminAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    if (!loading && user) return <Navigate to="/" replace />;

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await login(email, password);
            navigate("/");
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-[#08080b] px-4">
            <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#101015] p-6 shadow-xl">
                <div className="mb-6 flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">B</div>
                    <div>
                        <div className="text-sm font-bold text-white">Bazaar Sync</div>
                        <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">Admin</div>
                    </div>
                </div>

                <h1 className="mb-1 text-base font-bold text-white">Admin login</h1>
                <p className="mb-5 text-xs text-gray-500">Requires an account with admin access, set by hand in MySQL.</p>

                {notAdminError && !error && (
                    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                        Your session's account no longer has admin access — signed out.
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-400">Email</label>
                        <input
                            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>
                    <div>
                        <div className="mb-1 flex items-center justify-between">
                            <label className="block text-xs font-medium text-gray-400">Password</label>
                            <a
                                href={`${import.meta.env.VITE_CLIENT_URL || "http://localhost:5173"}/forgot-password`}
                                className="text-xs text-gray-500 hover:text-violet-400"
                            >
                                Forgot password?
                            </a>
                        </div>
                        <input
                            type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>

                    {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                    <button
                        type="submit" disabled={submitting}
                        className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                        {submitting ? "Please wait…" : "Log in"}
                    </button>
                </form>
            </div>
        </div>
    );
}
