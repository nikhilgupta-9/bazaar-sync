// admin/src/pages/Login.jsx — Modern BazaarSync Emerald Themed Admin Login
import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchPublicSecurityStatus } from "../services/adminApi";
import {
    FiMail,
    FiLock,
    FiEye,
    FiEyeOff,
    FiAlertTriangle,
    FiShield,
    FiCheckCircle,
    FiGlobe,
    FiArrowRight,
} from "react-icons/fi";

export default function Login() {
    const { user, loading, login, notAdminError, sessionRevokedError, setSessionRevokedError } = useAdminAuth();
    const navigate = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    // IP Restriction verification
    const [securityStatus, setSecurityStatus] = useState(null);

    useEffect(() => {
        fetchPublicSecurityStatus()
            .then((data) => setSecurityStatus(data))
            .catch(() => {});
    }, []);

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

    const isIpBlocked = securityStatus?.isRestricted && securityStatus?.isCurrentIpAllowed === false;

    return (
        <div className="relative min-h-screen flex items-center justify-center bg-[#070a11] px-4 overflow-hidden selection:bg-emerald-500 selection:text-white">
            {/* Background glowing gradients */}
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[550px] h-[350px] bg-emerald-500/10 blur-[130px] rounded-full pointer-events-none" />
            <div className="absolute bottom-10 right-10 w-[300px] h-[300px] bg-teal-500/5 blur-[100px] rounded-full pointer-events-none" />

            <div className="relative w-full max-w-md rounded-2xl border border-emerald-500/20 bg-[#0b1420]/90 p-7 shadow-2xl shadow-emerald-950/60 backdrop-blur-xl">
                {/* Brand Header */}
                <div className="mb-6 flex items-center justify-between border-b border-white/5 pb-5">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-lg font-black text-white shadow-lg shadow-emerald-950/50">
                            B
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-base font-bold text-white tracking-tight">Bazaar Sync</span>
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            </div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400/90">
                                Admin Portal
                            </div>
                        </div>
                    </div>

                    {/* Network IP Badge */}
                    {securityStatus?.clientIp && (
                        <div
                            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-mono font-medium border ${
                                isIpBlocked
                                    ? "bg-rose-500/10 text-rose-300 border-rose-500/30"
                                    : securityStatus.isRestricted
                                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                    : "bg-white/5 text-gray-400 border-white/10"
                            }`}
                            title={isIpBlocked ? "IP is blocked from admin access" : "Active connection IP"}
                        >
                            <FiGlobe className="text-xs shrink-0" />
                            <span>{securityStatus.clientIp}</span>
                        </div>
                    )}
                </div>

                <div className="mb-5">
                    <h1 className="text-lg font-bold text-white tracking-tight">Sign in to Admin</h1>
                    <p className="mt-0.5 text-xs text-gray-400">
                        Enter your credentials to access system telemetry, data pipelines & settings.
                    </p>
                </div>

                {/* IP Restriction Warning */}
                {isIpBlocked && (
                    <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-300 backdrop-blur-md">
                        <div className="flex items-center gap-2 font-bold text-rose-200 mb-1">
                            <FiAlertTriangle className="text-rose-400 text-sm shrink-0" />
                            <span>Access Restricted by IP Policy</span>
                        </div>
                        <p className="text-[11px] leading-relaxed text-rose-300/90">
                            Your current IP address (<code className="font-mono">{securityStatus.clientIp}</code>) is not on the admin allowlist. To log in, connect from an authorized IP or add this IP to the whitelist.
                        </p>
                    </div>
                )}

                {/* Session Alerts */}
                {sessionRevokedError && (
                    <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                        <FiAlertTriangle className="mt-0.5 shrink-0 text-sm text-amber-400" />
                        <span>{sessionRevokedError}</span>
                    </div>
                )}

                {notAdminError && !error && (
                    <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
                        <FiAlertTriangle className="mt-0.5 shrink-0 text-sm text-amber-400" />
                        <span>Your account does not have admin access privileges.</span>
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="mb-1.5 block text-xs font-semibold text-gray-300">Email Address</label>
                        <div className="relative">
                            <span className="absolute left-3.5 top-3 text-gray-400">
                                <FiMail size={15} />
                            </span>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    if (setSessionRevokedError) setSessionRevokedError(null);
                                }}
                                placeholder="iamnikhilgupta9@gmail.com"
                                className="w-full rounded-xl border border-emerald-500/20 bg-[#070e17]/80 pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-gray-500 outline-none transition focus:border-emerald-500 focus:bg-[#070e17] focus:ring-1 focus:ring-emerald-500/30"
                            />
                        </div>
                    </div>

                    <div>
                        <div className="mb-1.5 flex items-center justify-between">
                            <label className="block text-xs font-semibold text-gray-300">Password</label>
                            <a
                                href={`${import.meta.env.VITE_CLIENT_URL || "http://localhost:5175"}/forgot-password`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] font-medium text-gray-400 hover:text-emerald-400 transition"
                            >
                                Forgot password?
                            </a>
                        </div>
                        <div className="relative">
                            <span className="absolute left-3.5 top-3 text-gray-400">
                                <FiLock size={15} />
                            </span>
                            <input
                                type={showPassword ? "text" : "password"}
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••••••"
                                className="w-full rounded-xl border border-emerald-500/20 bg-[#070e17]/80 pl-10 pr-10 py-2.5 text-xs text-white placeholder-gray-500 outline-none transition focus:border-emerald-500 focus:bg-[#070e17] focus:ring-1 focus:ring-emerald-500/30"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3.5 top-2.5 text-gray-400 hover:text-white transition"
                                aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                                {showPassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center gap-2">
                            <FiAlertTriangle className="shrink-0 text-sm" />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={submitting || isIpBlocked}
                        className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500 active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                    >
                        {submitting ? (
                            <span>Authenticating…</span>
                        ) : (
                            <>
                                <span>Sign In as Admin</span>
                                <FiArrowRight className="text-sm" />
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-6 border-t border-white/5 pt-4 text-center">
                    <p className="text-[11px] text-gray-500">
                        Protected by BazaarSync Strict Admin Auth & IP Guard.
                    </p>
                </div>
            </div>
        </div>
    );
}
