// pages/Profile.jsx — Complete User Profile, Subscription Plans & Trading Dashboard
import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { fetchUserProfile, updateUserProfile, changePassword } from "../services/authApi";
import { createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { createRefillOrder, verifyRefillPayment } from "../services/paperTradeApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";
import { formatRupees, formatDateTime, formatPrice } from "../utils/format";
import {
    FiUser,
    FiShield,
    FiAward,
    FiZap,
    FiCreditCard,
    FiTrendingUp,
    FiTrendingDown,
    FiCheckCircle,
    FiClock,
    FiRefreshCw,
    FiEdit2,
    FiLock,
    FiFileText,
    FiPieChart,
    FiActivity,
    FiDollarSign,
    FiCheck,
    FiChevronRight,
    FiArrowRight,
    FiLogOut,
    FiCalendar,
    FiAlertCircle,
    FiLayers,
    FiKey,
    FiSave,
} from "react-icons/fi";

const TABS = [
    { id: "overview", label: "Overview & Plans", icon: FiAward },
    { id: "trading", label: "Trading Analytics", icon: FiActivity },
    { id: "billing", label: "Payment History", icon: FiCreditCard },
    { id: "security", label: "Account Settings", icon: FiShield },
];

export default function Profile() {
    const { token, user, isPro, refreshUser, logout } = useAuth();
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState("overview");
    const [profileData, setProfileData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionFeedback, setActionFeedback] = useState(null);

    // Edit Profile Modal
    const [editNameOpen, setEditNameOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [savingProfile, setSavingProfile] = useState(false);

    // Change Password Form
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [changingPassword, setChangingPassword] = useState(false);

    // Payment Processing
    const [paymentLoading, setPaymentLoading] = useState(false);

    const loadProfile = useCallback(async () => {
        if (!token) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const data = await fetchUserProfile(token);
            setProfileData(data);
            setNewName(data?.user?.name || "");
            setError(null);
        } catch (err) {
            console.error("[Profile] fetch failed:", err);
            setError(err.message || "Failed to load profile");
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        if (!token) {
            navigate("/login");
            return;
        }
        loadProfile();
    }, [token, loadProfile, navigate]);

    // Handle Pro Membership Upgrade / Renewal via Razorpay
    const handleUpgradePro = async (planId = "pro_1m", amountPaise = 49900) => {
        if (!token) return;
        setPaymentLoading(true);
        try {
            const orderRes = await createProOrder(token, { planId });
            const Razorpay = await loadRazorpayCheckout();
            const rzp = new Razorpay({
                key: orderRes.keyId,
                amount: orderRes.amount,
                currency: orderRes.currency || "INR",
                name: "Bazaar Sync Pro",
                description: `Pro Access (${planId}) + ₹5,00,000 Virtual Trading Grant`,
                order_id: orderRes.orderId,
                prefill: {
                    name: profileData?.user?.name || user?.name || "",
                    email: profileData?.user?.email || user?.email || "",
                },
                theme: { color: "#10b981" },
                handler: async (response) => {
                    try {
                        await verifyProPayment(token, {
                            razorpayOrderId: response.razorpay_order_id,
                            razorpayPaymentId: response.razorpay_payment_id,
                            razorpaySignature: response.razorpay_signature,
                        });
                        setActionFeedback({
                            type: "success",
                            message: "🎉 Pro membership upgraded successfully! ₹5,00,000 virtual trading grant added.",
                        });
                        await refreshUser();
                        await loadProfile();
                    } catch (verifyErr) {
                        setActionFeedback({ type: "error", message: `Payment verification failed: ${verifyErr.message}` });
                    }
                },
                modal: {
                    ondismiss: () => setPaymentLoading(false),
                },
            });
            rzp.open();
        } catch (err) {
            setActionFeedback({ type: "error", message: err.message || "Failed to initiate checkout" });
        } finally {
            setPaymentLoading(false);
        }
    };

    // Handle Virtual Balance Refill (+₹5 Lakhs for ₹100)
    const handleRefillCapital = async () => {
        if (!token) return;
        setPaymentLoading(true);
        try {
            const orderRes = await createRefillOrder(token);
            const Razorpay = await loadRazorpayCheckout();
            const rzp = new Razorpay({
                key: orderRes.keyId,
                amount: orderRes.amount,
                currency: orderRes.currency || "INR",
                name: "Bazaar Sync",
                description: "+₹5,00,000 Virtual Capital Refill",
                order_id: orderRes.orderId,
                prefill: {
                    name: profileData?.user?.name || user?.name || "",
                    email: profileData?.user?.email || user?.email || "",
                },
                theme: { color: "#10b981" },
                handler: async (response) => {
                    try {
                        await verifyRefillPayment(token, {
                            razorpayOrderId: response.razorpay_order_id,
                            razorpayPaymentId: response.razorpay_payment_id,
                            razorpaySignature: response.razorpay_signature,
                        });
                        setActionFeedback({
                            type: "success",
                            message: "🚀 Virtual trading balance topped up by +₹5,00,000!",
                        });
                        await loadProfile();
                    } catch (verifyErr) {
                        setActionFeedback({ type: "error", message: `Refill verification failed: ${verifyErr.message}` });
                    }
                },
                modal: {
                    ondismiss: () => setPaymentLoading(false),
                },
            });
            rzp.open();
        } catch (err) {
            setActionFeedback({ type: "error", message: err.message || "Failed to initiate refill" });
        } finally {
            setPaymentLoading(false);
        }
    };

    // Handle Profile Name Update
    const handleSaveProfile = async (e) => {
        e.preventDefault();
        if (!newName.trim()) return;
        setSavingProfile(true);
        try {
            await updateUserProfile(token, { name: newName.trim() });
            setActionFeedback({ type: "success", message: "Profile name updated successfully!" });
            setEditNameOpen(false);
            await refreshUser();
            await loadProfile();
        } catch (err) {
            setActionFeedback({ type: "error", message: err.message || "Failed to update profile" });
        } finally {
            setSavingProfile(false);
        }
    };

    // Handle Password Change
    const handleChangePassword = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setActionFeedback({ type: "error", message: "New password and confirmation do not match" });
            return;
        }
        if (newPassword.length < 8) {
            setActionFeedback({ type: "error", message: "Password must be at least 8 characters" });
            return;
        }
        setChangingPassword(true);
        try {
            await changePassword(token, { currentPassword, newPassword });
            setActionFeedback({ type: "success", message: "Password changed successfully!" });
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
        } catch (err) {
            setActionFeedback({ type: "error", message: err.message || "Failed to change password" });
        } finally {
            setChangingPassword(false);
        }
    };

    if (loading) {
        return (
            <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-gray-500">
                <FiRefreshCw className="animate-spin text-emerald-500 mb-3" size={32} />
                <p className="text-sm font-medium">Loading user dashboard & account details...</p>
            </div>
        );
    }

    const u = profileData?.user || user;
    const w = profileData?.wallet;
    const stats = profileData?.tradingStats;
    const isProUser = u?.isPro || isPro;
    const proDaysRemaining = u?.proDaysLeft || 0;
    const isTrialActive = w?.isTrialActive;
    const trialDaysRemaining = w?.daysLeft || 0;

    return (
        <div className="min-h-screen bg-gray-50/60 pb-16 dark:bg-[#0b1420]">
            {/* Action Feedback Banner */}
            {actionFeedback && (
                <div
                    className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-md transition-all ${
                        actionFeedback.type === "success"
                            ? "bg-emerald-500/90 text-white border-emerald-400"
                            : "bg-rose-600/90 text-white border-rose-500"
                    }`}
                >
                    {actionFeedback.type === "success" ? <FiCheckCircle size={18} /> : <FiAlertCircle size={18} />}
                    <span className="text-xs font-semibold">{actionFeedback.message}</span>
                    <button
                        onClick={() => setActionFeedback(null)}
                        className="ml-2 text-white/80 hover:text-white text-xs font-bold"
                    >
                        ✕
                    </button>
                </div>
            )}

            <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
                {/* 1. Header Profile Hero Card */}
                <div className="relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900/90 mb-6">
                    <div className="absolute top-0 right-0 -mt-8 -mr-8 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-1/3 -mb-8 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />

                    <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-white font-black text-2xl shadow-md ring-4 ring-emerald-500/20">
                                {u?.name ? u.name.charAt(0).toUpperCase() : "U"}
                                {isProUser && (
                                    <span
                                        className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-amber-950 ring-2 ring-white dark:ring-gray-900 text-[10px] font-black shadow-xs"
                                        title="Pro Member"
                                    >
                                        ★
                                    </span>
                                )}
                            </div>

                            <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h1 className="text-xl sm:text-2xl font-black tracking-tight text-gray-900 dark:text-white">
                                        {u?.name || "Trader"}
                                    </h1>
                                    <button
                                        onClick={() => setEditNameOpen(true)}
                                        className="p-1 text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition"
                                        title="Edit Name"
                                    >
                                        <FiEdit2 size={14} />
                                    </button>

                                    {isProUser ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500/15 to-orange-500/15 px-3 py-0.5 text-xs font-black text-amber-700 dark:text-amber-300 border border-amber-500/30">
                                            <FiAward size={13} className="text-amber-500" />
                                            PRO MEMBER ({proDaysRemaining}d Left)
                                        </span>
                                    ) : isTrialActive ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                            <FiClock size={12} />
                                            FREE TRIAL ({trialDaysRemaining}d Left)
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400 border border-gray-300 dark:border-gray-700">
                                            FREE TIER
                                        </span>
                                    )}
                                </div>

                                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                                    <span>{u?.email}</span>
                                    <span>•</span>
                                    <span className="flex items-center gap-1">
                                        <FiCalendar size={12} />
                                        Member since {u?.created_at ? new Date(u.created_at).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "2026"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Top Quick Actions */}
                        <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
                            <Link
                                to="/paper-trade"
                                className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 transition"
                            >
                                <FiActivity size={14} />
                                Launch Paper Trade
                            </Link>
                            {!isProUser && (
                                <button
                                    onClick={() => handleUpgradePro("pro_1m", 49900)}
                                    disabled={paymentLoading}
                                    className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-xs font-bold text-white shadow-sm hover:from-amber-600 hover:to-orange-600 transition"
                                >
                                    <FiAward size={14} />
                                    Get Pro ₹499/mo
                                </button>
                            )}
                            <button
                                onClick={logout}
                                className="p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-rose-600 dark:border-gray-800 dark:hover:bg-gray-800 transition"
                                title="Sign Out"
                            >
                                <FiLogOut size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* 2. Navigation Tabs */}
                <div className="flex items-center gap-2 overflow-x-auto border-b border-gray-200 dark:border-gray-800 pb-3 mb-6 no-scrollbar">
                    {TABS.map((tab) => {
                        const Icon = tab.icon;
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-bold rounded-xl transition shrink-0 ${
                                    active
                                        ? "bg-emerald-600 text-white shadow-sm dark:bg-emerald-600"
                                        : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:bg-gray-900/80 dark:text-gray-300 dark:hover:bg-gray-800 border border-gray-200/80 dark:border-gray-800"
                                }`}
                            >
                                <Icon size={16} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* ========================================================= */}
                {/* TAB 1: OVERVIEW & MEMBERSHIP PLANS */}
                {/* ========================================================= */}
                {activeTab === "overview" && (
                    <div className="space-y-6">
                        {/* Highlights Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Virtual Trading Balance */}
                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900/90">
                                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span className="font-semibold uppercase tracking-wider">Virtual Balance</span>
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                                        ₹
                                    </span>
                                </div>
                                <div className="mt-2 text-2xl font-black text-gray-900 dark:text-white">
                                    {formatRupees(w?.balance || 0)}
                                </div>
                                <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                                    <span>Margin Blocked: {formatRupees(w?.margin_utilized || 0)}</span>
                                    {isProUser && (
                                        <button
                                            onClick={handleRefillCapital}
                                            disabled={paymentLoading}
                                            className="text-emerald-600 hover:underline font-bold"
                                        >
                                            +₹5L (₹100)
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Plan Status */}
                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900/90">
                                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span className="font-semibold uppercase tracking-wider">Plan Status</span>
                                    <FiAward className="text-amber-500" size={18} />
                                </div>
                                <div className="mt-2 text-2xl font-black text-gray-900 dark:text-white">
                                    {isProUser ? "Pro Active" : isTrialActive ? "2-Day Trial" : "Plan Expired"}
                                </div>
                                <div className="mt-2 text-[11px] text-gray-500">
                                    {isProUser
                                        ? `Renews on ${formatDateTime(u?.pro_expires_at)}`
                                        : isTrialActive
                                        ? `${trialDaysRemaining} day(s) left on ₹1 Lakh grant`
                                        : "Upgrade for ₹5 Lakhs grant & live tools"}
                                </div>
                            </div>

                            {/* Net Realized P&L */}
                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900/90">
                                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span className="font-semibold uppercase tracking-wider">Total Realized P&L</span>
                                    {(stats?.totalRealizedPnl || 0) >= 0 ? (
                                        <FiTrendingUp className="text-emerald-500" size={18} />
                                    ) : (
                                        <FiTrendingDown className="text-rose-500" size={18} />
                                    )}
                                </div>
                                <div
                                    className={`mt-2 text-2xl font-black ${
                                        (stats?.totalRealizedPnl || 0) >= 0
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-rose-600 dark:text-rose-400"
                                    }`}
                                >
                                    {(stats?.totalRealizedPnl || 0) >= 0 ? "+" : ""}
                                    {formatRupees(stats?.totalRealizedPnl || 0)}
                                </div>
                                <div className="mt-2 text-[11px] text-gray-500">
                                    Across {stats?.closedTrades || 0} completed trades
                                </div>
                            </div>

                            {/* Win Rate */}
                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900/90">
                                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span className="font-semibold uppercase tracking-wider">Trading Win Rate</span>
                                    <FiActivity className="text-teal-500" size={18} />
                                </div>
                                <div className="mt-2 text-2xl font-black text-gray-900 dark:text-white">
                                    {stats?.winRate || 0}%
                                </div>
                                <div className="mt-2 text-[11px] text-gray-500">
                                    {stats?.winTrades || 0} Wins / {stats?.lossTrades || 0} Losses
                                </div>
                            </div>
                        </div>

                        {/* Active Subscription Details Card */}
                        <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs dark:border-gray-800 dark:bg-gray-900/90">
                            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-gray-100 dark:border-gray-800">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-lg font-black text-gray-900 dark:text-white">
                                            {isProUser
                                                ? "Pro Membership Subscription"
                                                : isTrialActive
                                                ? "Free 2-Day Trial Access"
                                                : "Subscription Plan (Expired)"}
                                        </h2>
                                        <span className="rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2.5 py-0.5 text-xs font-bold">
                                            {isProUser ? "Active" : isTrialActive ? "Trial" : "Action Required"}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                        {isProUser
                                            ? "Your Pro membership gives you full platform tools, 7 live indices, and ₹5,00,000 continuous paper money."
                                            : "New joiners receive 2 days free trial with ₹1,00,000 virtual trading cash. Upgrade to Pro for ₹5 Lakhs & uninterrupted access."}
                                    </p>
                                </div>

                                <div className="flex items-center gap-3">
                                    {isProUser ? (
                                        <button
                                            onClick={() => handleUpgradePro("pro_1m", 49900)}
                                            disabled={paymentLoading}
                                            className="rounded-xl border border-emerald-500/40 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 transition"
                                        >
                                            Extend Plan (+30 Days)
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleUpgradePro("pro_1m", 49900)}
                                            disabled={paymentLoading}
                                            className="rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2.5 text-xs font-black text-white shadow-md hover:from-emerald-700 hover:to-teal-600 transition"
                                        >
                                            Upgrade to Pro (₹499 / mo)
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Plan Features Checklist */}
                            <div className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1 text-emerald-600 dark:text-emerald-400">
                                        <FiCheck size={12} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">
                                            ₹5,00,000 Virtual Trading Grant
                                        </div>
                                        <div className="text-gray-500 text-[11px]">
                                            Included automatically upon Pro membership activation
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1 text-emerald-600 dark:text-emerald-400">
                                        <FiCheck size={12} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">
                                            Live Market WebSocket Stream
                                        </div>
                                        <div className="text-gray-500 text-[11px]">
                                            Real-time ticks across all 7 indices & 210+ F&O stocks
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1 text-emerald-600 dark:text-emerald-400">
                                        <FiCheck size={12} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">
                                            Capital Refill Option (+₹5L for ₹100)
                                        </div>
                                        <div className="text-gray-500 text-[11px]">
                                            Top up virtual capital anytime balance drops low
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1 text-emerald-600 dark:text-emerald-400">
                                        <FiCheck size={12} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">
                                            Live Multi-Leg Strategy Builder
                                        </div>
                                        <div className="text-gray-500 text-[11px]">
                                            1-Click Spreads, Iron Condors & Payoff Simulation
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1 text-emerald-600 dark:text-emerald-400">
                                        <FiCheck size={12} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">
                                            StockMojo Payoff & Greeks
                                        </div>
                                        <div className="text-gray-500 text-[11px]">
                                            Real-time Delta, Gamma, Theta, Vega & Hedge margins
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 rounded-full bg-emerald-500/15 p-1 text-emerald-600 dark:text-emerald-400">
                                        <FiCheck size={12} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-900 dark:text-white">
                                            Historical Backtesting & Simulator
                                        </div>
                                        <div className="text-gray-500 text-[11px]">
                                            Tick-by-tick simulation with past expiry playbacks
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Commercial Pricing Plans Grid */}
                        <div>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-base font-black text-gray-900 dark:text-white">
                                    Available Membership Plans
                                </h3>
                                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                                    Instant Activation via Razorpay
                                </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                {/* Monthly Plan */}
                                <div className="relative rounded-2xl border-2 border-emerald-500 bg-white p-6 shadow-sm dark:bg-gray-900 dark:border-emerald-500">
                                    <span className="absolute -top-3 left-6 rounded-full bg-emerald-600 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow-xs">
                                        Most Popular
                                    </span>
                                    <div className="text-sm font-bold text-gray-900 dark:text-white">Pro Monthly</div>
                                    <div className="mt-3 flex items-baseline gap-1">
                                        <span className="text-3xl font-black text-gray-900 dark:text-white">₹499</span>
                                        <span className="text-xs text-gray-500">/ month</span>
                                    </div>
                                    <p className="mt-2 text-xs text-gray-500">
                                        30 Days continuous access with ₹5,00,000 virtual trading money.
                                    </p>
                                    <ul className="mt-4 space-y-2 text-xs text-gray-600 dark:text-gray-300">
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> Full 7 Indices + Stocks
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> ₹5L Paper Money Grant
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> ₹100 Capital Refills
                                        </li>
                                    </ul>
                                    <button
                                        onClick={() => handleUpgradePro("pro_1m", 49900)}
                                        disabled={paymentLoading}
                                        className="mt-6 w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition"
                                    >
                                        {isProUser ? "Extend Monthly (₹499)" : "Choose Monthly Plan"}
                                    </button>
                                </div>

                                {/* 6-Month Plan */}
                                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                                    <div className="text-sm font-bold text-gray-900 dark:text-white">Pro Half-Yearly</div>
                                    <div className="mt-3 flex items-baseline gap-1">
                                        <span className="text-3xl font-black text-gray-900 dark:text-white">₹2,499</span>
                                        <span className="text-xs text-gray-500">/ 6 mos</span>
                                    </div>
                                    <p className="mt-2 text-xs text-gray-500">
                                        180 Days access. Save ₹495 compared to monthly subscription.
                                    </p>
                                    <ul className="mt-4 space-y-2 text-xs text-gray-600 dark:text-gray-300">
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> 6 Months Uninterrupted Access
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> ₹5L Initial Paper Grant
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> Priority Support & WebSockets
                                        </li>
                                    </ul>
                                    <button
                                        onClick={() => handleUpgradePro("pro_6m", 249900)}
                                        disabled={paymentLoading}
                                        className="mt-6 w-full rounded-xl border border-gray-300 bg-gray-50 py-2.5 text-xs font-bold text-gray-800 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition"
                                    >
                                        Choose 6-Month Plan
                                    </button>
                                </div>

                                {/* Annual Plan */}
                                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                                    <div className="text-sm font-bold text-gray-900 dark:text-white">Pro Annual (Best Value)</div>
                                    <div className="mt-3 flex items-baseline gap-1">
                                        <span className="text-3xl font-black text-gray-900 dark:text-white">₹4,499</span>
                                        <span className="text-xs text-gray-500">/ year</span>
                                    </div>
                                    <p className="mt-2 text-xs text-gray-500">
                                        365 Days complete access. Equivalent to ~₹374/month (30% savings).
                                    </p>
                                    <ul className="mt-4 space-y-2 text-xs text-gray-600 dark:text-gray-300">
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> 1 Full Year All-Inclusive
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> All Future Strategy Tools
                                        </li>
                                        <li className="flex items-center gap-2">
                                            <FiCheck className="text-emerald-500" size={14} /> Unlimited Capital Refills
                                        </li>
                                    </ul>
                                    <button
                                        onClick={() => handleUpgradePro("pro_12m", 449900)}
                                        disabled={paymentLoading}
                                        className="mt-6 w-full rounded-xl border border-gray-300 bg-gray-50 py-2.5 text-xs font-bold text-gray-800 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 transition"
                                    >
                                        Choose Annual Plan
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ========================================================= */}
                {/* TAB 2: TRADING ANALYTICS & PERFORMANCE */}
                {/* ========================================================= */}
                {activeTab === "trading" && (
                    <div className="space-y-6">
                        {/* Trading Performance Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                                <div className="text-xs text-gray-500 uppercase font-semibold">Total Trades</div>
                                <div className="mt-2 text-2xl font-black text-gray-900 dark:text-white">
                                    {stats?.totalTrades || 0}
                                </div>
                                <div className="mt-1 text-xs text-gray-400">
                                    {stats?.openTrades || 0} Open • {stats?.closedTrades || 0} Closed
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                                <div className="text-xs text-gray-500 uppercase font-semibold">Win / Loss Ratio</div>
                                <div className="mt-2 text-2xl font-black text-emerald-600 dark:text-emerald-400">
                                    {stats?.winTrades || 0}W / {stats?.lossTrades || 0}L
                                </div>
                                <div className="mt-1 text-xs text-gray-400">
                                    Win Rate: {stats?.winRate || 0}%
                                </div>
                            </div>

                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                                <div className="text-xs text-gray-500 uppercase font-semibold">Best Trade (Max Profit)</div>
                                <div className="mt-2 text-2xl font-black text-emerald-600 dark:text-emerald-400">
                                    +₹{formatPrice(stats?.maxProfit || 0)}
                                </div>
                                <div className="mt-1 text-xs text-gray-400">Single trade highest gain</div>
                            </div>

                            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                                <div className="text-xs text-gray-500 uppercase font-semibold">Worst Trade (Max Loss)</div>
                                <div className="mt-2 text-2xl font-black text-rose-600 dark:text-rose-400">
                                    ₹{formatPrice(stats?.maxLoss || 0)}
                                </div>
                                <div className="mt-1 text-xs text-gray-400">Single trade max drawdown</div>
                            </div>
                        </div>

                        {/* Recent Trade History Table */}
                        <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-base font-black text-gray-900 dark:text-white">
                                        Recent Paper Trades
                                    </h3>
                                    <p className="text-xs text-gray-500">
                                        Your live mark-to-market positions and realized trade executions
                                    </p>
                                </div>
                                <Link
                                    to="/paper-trade"
                                    className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
                                >
                                    Trade Live <FiArrowRight size={12} />
                                </Link>
                            </div>

                            {profileData?.recentTrades?.length === 0 ? (
                                <div className="py-12 text-center text-gray-400 text-xs">
                                    <FiActivity size={28} className="mx-auto text-gray-300 dark:text-gray-700 mb-2" />
                                    No paper trades executed yet. Launch the Paper Trading terminal to start!
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                                <th className="py-3 px-3">Symbol / Strategy</th>
                                                <th className="py-3 px-3">Contract</th>
                                                <th className="py-3 px-3">Side</th>
                                                <th className="py-3 px-3">Qty</th>
                                                <th className="py-3 px-3">Entry Price</th>
                                                <th className="py-3 px-3">Exit Price</th>
                                                <th className="py-3 px-3">Realized P&L</th>
                                                <th className="py-3 px-3">Status</th>
                                                <th className="py-3 px-3">Time</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium">
                                            {profileData?.recentTrades?.map((t) => {
                                                const pnl = Number(t.realized_pnl || 0);
                                                const isProfit = pnl >= 0;
                                                return (
                                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition">
                                                        <td className="py-3 px-3 font-bold text-gray-900 dark:text-white">
                                                            {t.symbol}
                                                            {t.strategy_name && (
                                                                <span className="block text-[10px] text-gray-400 font-normal">
                                                                    {t.strategy_name}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-3">
                                                            {t.strike} {t.opt_right}
                                                            <span className="block text-[10px] text-gray-400">
                                                                {t.expiry}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-3">
                                                            <span
                                                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                                    t.side === "long"
                                                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                                                        : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
                                                                }`}
                                                            >
                                                                {t.side === "long" ? "BUY" : "SELL"}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-3 text-gray-600 dark:text-gray-300">
                                                            {t.lots * t.lot_size} ({t.lots} L)
                                                        </td>
                                                        <td className="py-3 px-3 text-gray-900 dark:text-gray-100 font-semibold">
                                                            ₹{formatPrice(t.entry_price)}
                                                        </td>
                                                        <td className="py-3 px-3 text-gray-900 dark:text-gray-100 font-semibold">
                                                            {t.exit_price != null ? `₹${formatPrice(t.exit_price)}` : "—"}
                                                        </td>
                                                        <td
                                                            className={`py-3 px-3 font-black ${
                                                                t.status === "open"
                                                                    ? "text-gray-400"
                                                                    : isProfit
                                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                                    : "text-rose-600 dark:text-rose-400"
                                                            }`}
                                                        >
                                                            {t.status === "open" ? "In Position" : `${isProfit ? "+" : ""}₹${formatPrice(pnl)}`}
                                                        </td>
                                                        <td className="py-3 px-3">
                                                            <span
                                                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                                                    t.status === "open"
                                                                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                                                        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                                                                }`}
                                                            >
                                                                {t.status}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-3 text-gray-400 text-[11px]">
                                                            {formatDateTime(t.entry_time || t.created_at)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ========================================================= */}
                {/* TAB 3: BILLING & PAYMENT HISTORY */}
                {/* ========================================================= */}
                {activeTab === "billing" && (
                    <div className="space-y-6">
                        <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h3 className="text-base font-black text-gray-900 dark:text-white">
                                        Billing & Transaction History
                                    </h3>
                                    <p className="text-xs text-gray-500">
                                        Complete log of Pro membership orders, capital refills, and grants
                                    </p>
                                </div>
                                <span className="text-xs text-gray-400 flex items-center gap-1 font-semibold">
                                    <FiShield size={14} className="text-emerald-500" /> Secured by Razorpay
                                </span>
                            </div>

                            {profileData?.payments?.length === 0 ? (
                                <div className="py-12 text-center text-gray-400 text-xs">
                                    <FiCreditCard size={28} className="mx-auto text-gray-300 dark:text-gray-700 mb-2" />
                                    No payment transactions recorded yet.
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-100 dark:border-gray-800 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                                <th className="py-3 px-3">Date</th>
                                                <th className="py-3 px-3">Transaction / Description</th>
                                                <th className="py-3 px-3">Type</th>
                                                <th className="py-3 px-3">Virtual Amount</th>
                                                <th className="py-3 px-3">Balance After</th>
                                                <th className="py-3 px-3">Razorpay Payment ID</th>
                                                <th className="py-3 px-3">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium">
                                            {profileData?.payments?.map((p) => {
                                                const isGrant = p.type === "pro_purchase_grant" || p.type === "trial_grant" || p.type === "refill_purchase";
                                                return (
                                                    <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition">
                                                        <td className="py-3 px-3 text-gray-500">
                                                            {formatDateTime(p.created_at)}
                                                        </td>
                                                        <td className="py-3 px-3 font-bold text-gray-900 dark:text-white">
                                                            {p.note || p.type}
                                                        </td>
                                                        <td className="py-3 px-3">
                                                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                                                {p.type.replace(/_/g, " ")}
                                                            </span>
                                                        </td>
                                                        <td
                                                            className={`py-3 px-3 font-bold ${
                                                                isGrant
                                                                    ? "text-emerald-600 dark:text-emerald-400"
                                                                    : "text-gray-900 dark:text-gray-100"
                                                            }`}
                                                        >
                                                            {isGrant ? "+" : ""}
                                                            {formatRupees(p.amount)}
                                                        </td>
                                                        <td className="py-3 px-3 font-semibold text-gray-700 dark:text-gray-300">
                                                            {formatRupees(p.balance_after)}
                                                        </td>
                                                        <td className="py-3 px-3 font-mono text-[11px] text-gray-500">
                                                            {p.razorpay_payment_id || p.razorpay_order_id || "SYSTEM_GRANT"}
                                                        </td>
                                                        <td className="py-3 px-3">
                                                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                                                                <FiCheckCircle size={12} /> Success
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ========================================================= */}
                {/* TAB 4: ACCOUNT SETTINGS & SECURITY */}
                {/* ========================================================= */}
                {activeTab === "security" && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Profile Info Details */}
                        <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                            <h3 className="text-base font-black text-gray-900 dark:text-white mb-1">
                                Profile Information
                            </h3>
                            <p className="text-xs text-gray-500 mb-6">
                                Update your personal details and display name
                            </p>

                            <form onSubmit={handleSaveProfile} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                        Full Name
                                    </label>
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        required
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs text-gray-900 focus:border-emerald-500 focus:bg-white focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={u?.email || ""}
                                        disabled
                                        className="w-full rounded-xl border border-gray-200 bg-gray-100 px-3.5 py-2.5 text-xs text-gray-500 cursor-not-allowed dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400"
                                    />
                                    <span className="text-[10px] text-gray-400 mt-1 block">
                                        Email is tied to your account and cannot be modified directly.
                                    </span>
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={savingProfile}
                                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50"
                                    >
                                        <FiSave size={14} />
                                        {savingProfile ? "Saving Changes..." : "Save Profile Details"}
                                    </button>
                                </div>
                            </form>
                        </div>

                        {/* Security & Password */}
                        <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs dark:border-gray-800 dark:bg-gray-900">
                            <h3 className="text-base font-black text-gray-900 dark:text-white mb-1">
                                Password & Security
                            </h3>
                            <p className="text-xs text-gray-500 mb-6">
                                Change your password to keep your trading account secure
                            </p>

                            <form onSubmit={handleChangePassword} className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                        Current Password
                                    </label>
                                    <input
                                        type="password"
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        required
                                        placeholder="••••••••"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs text-gray-900 focus:border-emerald-500 focus:bg-white focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                        New Password
                                    </label>
                                    <input
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        required
                                        minLength={8}
                                        placeholder="At least 8 characters"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs text-gray-900 focus:border-emerald-500 focus:bg-white focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                        Confirm New Password
                                    </label>
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                        minLength={8}
                                        placeholder="Re-enter new password"
                                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs text-gray-900 focus:border-emerald-500 focus:bg-white focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                    />
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={changingPassword}
                                        className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-gray-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 shadow-sm transition disabled:opacity-50"
                                    >
                                        <FiKey size={14} />
                                        {changingPassword ? "Updating Password..." : "Change Password"}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>

            {/* Edit Name Modal */}
            {editNameOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                    <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-black text-gray-900 dark:text-white">
                                Edit Display Name
                            </h3>
                            <button
                                onClick={() => setEditNameOpen(false)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                            >
                                ✕
                            </button>
                        </div>
                        <form onSubmit={handleSaveProfile} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                    Full Name
                                </label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    required
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-xs text-gray-900 focus:border-emerald-500 focus:bg-white focus:outline-hidden dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                />
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setEditNameOpen(false)}
                                    className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={savingProfile}
                                    className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition disabled:opacity-50"
                                >
                                    {savingProfile ? "Saving..." : "Save Name"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
