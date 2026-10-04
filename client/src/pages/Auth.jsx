// pages/Auth.jsx — Modern, Clean & Mobile-Responsive Trader Authentication
import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { FcGoogle } from "react-icons/fc";
import {
    FiAlertTriangle,
    FiMail,
    FiLock,
    FiUser,
    FiEye,
    FiEyeOff,
    FiCheckCircle,
    FiTrendingUp,
    FiShield,
    FiActivity,
    FiArrowRight,
} from "react-icons/fi";
import Logo from "../components/Logo";
import AuthBackground from "../components/AuthBackground";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "379208993355-7rpn8k1g5bg4h5k3ie5crm4dmmu11ccf.apps.googleusercontent.com";

export default function Auth() {
    const [mode, setMode] = useState("login"); // 'login' | 'register'
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);

    const { login, register, loginWithGoogle, sessionRevokedError, setSessionRevokedError } = useAuth();
    const { isDark } = useTheme();
    const navigate = useNavigate();
    const googleBtnRef = useRef(null);

    // Initialize Google Identity Services (GIS)
    useEffect(() => {
        let isMounted = true;

        function initGoogle() {
            if (window.google?.accounts?.id) {
                window.google.accounts.id.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: async (response) => {
                        if (!isMounted || !response?.credential) return;
                        setError(null);
                        setLoading(true);
                        try {
                            await loginWithGoogle(response.credential);
                            navigate("/option-chain");
                        } catch (err) {
                            setError(err.message || "Google authentication failed");
                        } finally {
                            if (isMounted) setLoading(false);
                        }
                    },
                    auto_select: false,
                });

                if (googleBtnRef.current) {
                    window.google.accounts.id.renderButton(googleBtnRef.current, {
                        theme: isDark ? "filled_black" : "outline",
                        size: "large",
                        width: 320,
                        text: mode === "login" ? "signin_with" : "signup_with",
                        shape: "rectangular",
                        logo_alignment: "left",
                    });
                }
            }
        }

        if (window.google?.accounts?.id) {
            initGoogle();
        } else {
            const interval = setInterval(() => {
                if (window.google?.accounts?.id) {
                    clearInterval(interval);
                    initGoogle();
                }
            }, 300);
            return () => {
                isMounted = false;
                clearInterval(interval);
            };
        }

        return () => {
            isMounted = false;
        };
    }, [isDark, mode, loginWithGoogle, navigate]);

    async function handleCustomGoogleClick() {
        if (loading) return;
        setError(null);

        if (window.google?.accounts?.oauth2) {
            const tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: "email profile openid",
                callback: async (tokenResponse) => {
                    if (tokenResponse?.access_token) {
                        setLoading(true);
                        try {
                            await loginWithGoogle(null, tokenResponse.access_token);
                            navigate("/option-chain");
                        } catch (err) {
                            setError(err.message || "Google authentication failed");
                        } finally {
                            setLoading(false);
                        }
                    }
                },
            });
            tokenClient.requestAccessToken();
        } else if (window.google?.accounts?.id) {
            window.google.accounts.id.prompt();
        } else {
            setError("Google Services is loading, please try again in a moment.");
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (mode === "login") {
                await login(email, password);
            } else {
                await register(name, email, password);
            }
            navigate("/option-chain");
        } catch (err) {
            setError(err.message || "Authentication failed");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="relative min-h-[calc(100vh-65px)] flex items-center justify-center overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
            <AuthBackground />

            {/* Main Auth Container with Glassmorphism */}
            <div className="relative z-10 w-full max-w-md">
                {/* Ambient Diffused Back-Glow */}
                <div className="pointer-events-none absolute -inset-2 rounded-[36px] bg-gradient-to-tr from-emerald-500/25 via-teal-500/15 to-sky-500/25 blur-2xl opacity-80 dark:opacity-60 -z-10" />

                {/* Glassmorphic Card */}
                <div className="relative overflow-hidden rounded-3xl border border-white/60 bg-white/70 p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.1)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#0a1220]/70 dark:shadow-[0_25px_60px_rgba(0,0,0,0.6)] transition-all">
                    {/* Top Specular Shine */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-emerald-400/40" />

                    {/* Header Logo */}
                    <div className="mb-6 flex flex-col items-center text-center">
                        <Logo size="md" />
                        <h2 className="mt-4 text-xl sm:text-2xl font-black tracking-tight text-gray-900 dark:text-white">
                            {mode === "login" ? "Welcome Back, Trader" : "Create Trader Account"}
                        </h2>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 max-w-xs">
                            {mode === "login"
                                ? "Access live Greeks, saved payoffs, and paper trading terminal"
                                : "Start building, backtesting, and simulating F&O strategies"}
                        </p>
                    </div>

                    {/* Mode Toggle Tabs (Login vs Register) */}
                    <div className="mb-6 grid grid-cols-2 gap-1 rounded-2xl bg-gray-200/50 p-1 backdrop-blur-md border border-white/40 dark:bg-white/5 dark:border-white/5">
                        <button
                            type="button"
                            onClick={() => {
                                setMode("login");
                                setError(null);
                                if (setSessionRevokedError) setSessionRevokedError(null);
                            }}
                            className={`rounded-xl py-2 text-xs font-bold transition duration-200 ${
                                mode === "login"
                                    ? "bg-white text-emerald-600 shadow-sm border border-white/60 dark:bg-white/15 dark:text-emerald-400 dark:border-white/10"
                                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            }`}
                        >
                            Sign In
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setMode("register");
                                setError(null);
                                if (setSessionRevokedError) setSessionRevokedError(null);
                            }}
                            className={`rounded-xl py-2 text-xs font-bold transition duration-200 ${
                                mode === "register"
                                    ? "bg-white text-emerald-600 shadow-sm border border-white/60 dark:bg-white/15 dark:text-emerald-400 dark:border-white/10"
                                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                            }`}
                        >
                            Create Account
                        </button>
                    </div>

                    {/* Session Revocation Alert Banner */}
                    {sessionRevokedError && (
                        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-300 backdrop-blur-md animate-in fade-in duration-200">
                            <FiAlertTriangle className="mt-0.5 shrink-0 text-sm text-amber-400" />
                            <div>
                                <div className="font-bold text-amber-200">Session Terminated</div>
                                <div className="text-[11px] text-amber-300/90 leading-relaxed mt-0.5">{sessionRevokedError}</div>
                            </div>
                        </div>
                    )}

                    {/* Google One-Click Sign In */}
                    <div className="mb-4">
                        <div className="flex w-full justify-center">
                            <div ref={googleBtnRef} className="w-full flex justify-center [&>div]:!w-full [&>div]:!flex [&>div]:!justify-center" style={{ minHeight: "40px" }}>
                                {!window.google?.accounts?.id && (
                                    <button
                                        type="button"
                                        onClick={handleCustomGoogleClick}
                                        disabled={loading}
                                        className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/60 bg-white/80 px-4 py-2.5 text-xs font-bold text-gray-700 shadow-xs backdrop-blur-md transition hover:bg-white active:scale-[0.99] dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15 disabled:opacity-50"
                                    >
                                        <FcGoogle size={18} />
                                        {mode === "login" ? "Continue with Google" : "Sign up with Google"}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="mb-5 flex items-center gap-3">
                        <div className="h-px flex-1 bg-gray-300/60 dark:bg-white/10" />
                        <span className="text-[10px] font-bold text-gray-400 dark:text-gray-400 uppercase tracking-wider">
                            or with email
                        </span>
                        <div className="h-px flex-1 bg-gray-300/60 dark:bg-white/10" />
                    </div>

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === "register" && (
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                    Full Name
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3.5 top-3 text-gray-400">
                                        <FiUser size={15} />
                                    </span>
                                    <input
                                        type="text"
                                        required
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="e.g. Rahul Sharma"
                                        className="w-full rounded-xl border border-gray-300/70 bg-white/60 pl-10 pr-3.5 py-2.5 text-xs text-gray-900 placeholder-gray-400 backdrop-blur-md transition focus:border-emerald-500 focus:bg-white/95 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-black/25 dark:text-white dark:placeholder-gray-500 dark:focus:bg-black/40"
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                Email Address
                            </label>
                            <div className="relative">
                                <span className="absolute left-3.5 top-3 text-gray-400">
                                    <FiMail size={15} />
                                </span>
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="trader@domain.com"
                                    className="w-full rounded-xl border border-gray-300/70 bg-white/60 pl-10 pr-3.5 py-2.5 text-xs text-gray-900 placeholder-gray-400 backdrop-blur-md transition focus:border-emerald-500 focus:bg-white/95 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-black/25 dark:text-white dark:placeholder-gray-500 dark:focus:bg-black/40"
                                />
                            </div>
                        </div>

                        <div>
                            <div className="mb-1.5 flex items-center justify-between">
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                                    Password
                                </label>
                                {mode === "login" && (
                                    <Link
                                        to="/forgot-password"
                                        className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                                    >
                                        Forgot Password?
                                    </Link>
                                )}
                            </div>
                            <div className="relative">
                                <span className="absolute left-3.5 top-3 text-gray-400">
                                    <FiLock size={15} />
                                </span>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    required
                                    minLength={8}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="At least 8 characters"
                                    className="w-full rounded-xl border border-gray-300/70 bg-white/60 pl-10 pr-10 py-2.5 text-xs text-gray-900 placeholder-gray-400 backdrop-blur-md transition focus:border-emerald-500 focus:bg-white/95 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-black/25 dark:text-white dark:placeholder-gray-500 dark:focus:bg-black/40"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-2.5 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                                >
                                    {showPassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                                </button>
                            </div>
                        </div>

                        {/* Error Alert */}
                        {error && (
                            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 backdrop-blur-md px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-300 flex items-center gap-2 animate-in fade-in duration-150">
                                <FiAlertTriangle size={14} className="shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 py-3 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/25 hover:from-emerald-700 hover:to-teal-600 active:scale-[0.99] transition duration-200 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                        >
                            <span>{loading ? "Please wait…" : mode === "login" ? "Sign In to Terminal" : "Create Free Account"}</span>
                            {!loading && <FiArrowRight size={14} />}
                        </button>
                    </form>

                    {/* Footer Info / Switch */}
                    <div className="mt-6 pt-4 border-t border-gray-200/60 dark:border-white/10 text-center">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {mode === "login" ? "Don't have an account yet?" : "Already registered with BazaarSync?"}{" "}
                            <button
                                type="button"
                                onClick={() => {
                                    setMode(mode === "login" ? "register" : "login");
                                    setError(null);
                                    if (setSessionRevokedError) setSessionRevokedError(null);
                                }}
                                className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                            >
                                {mode === "login" ? "Create Free Account" : "Sign In Here"}
                            </button>
                        </p>
                    </div>
                </div>

                {/* Features Highlights Pill Under Card */}
                <div className="mt-4 flex items-center justify-center gap-3 text-[11px] font-semibold text-gray-600 dark:text-gray-300 flex-wrap">
                    <div className="flex items-center gap-3 rounded-full bg-white/40 dark:bg-white/5 backdrop-blur-md border border-white/50 dark:border-white/10 px-4 py-1.5 shadow-xs">
                        <span className="flex items-center gap-1">
                            <FiCheckCircle className="text-emerald-500" size={13} /> Realtime Greeks
                        </span>
                        <span className="text-gray-300 dark:text-gray-700">•</span>
                        <span className="flex items-center gap-1">
                            <FiTrendingUp className="text-emerald-500" size={13} /> ₹5L Paper Grant
                        </span>
                        <span className="text-gray-300 dark:text-gray-700">•</span>
                        <span className="flex items-center gap-1">
                            <FiShield className="text-emerald-500" size={13} /> 100% Secure
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
