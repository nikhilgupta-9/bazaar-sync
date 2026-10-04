import React, { useCallback, useEffect, useState } from "react";
// pages/Pricing.jsx — Premier Glassmorphic Subscription & Pro Membership Station
// Dynamic plan catalog from server with Razorpay checkout, real-time coupon validation,
// frosted glassmorphic card styling, Dark/Light theme adaptability, and interactive FAQ.

import { useNavigate } from "react-router-dom";
import {
    FiCheck,
    FiTrendingUp,
    FiTag,
    FiX,
    FiShield,
    FiZap,
    FiLock,
    FiHelpCircle,
    FiChevronDown,
    FiArrowRight,
    FiActivity,
    FiCpu,
    FiLayers,
} from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import {
    fetchProPlans,
    validateCoupon,
    createProOrder,
    verifyProPayment,
} from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";

const BASE_FEATURES = [
    "Unlimited Strategy Builder & Payoff Matrix",
    "Real-Time Option Chain & Greeks (Delta, Theta, Vega, IV)",
    "Virtual Paper Trading with ₹5,00,000 Initial Grant",
    "3-Year Tick Replay & 1-Min Historical Bar Charts",
    "Crypto / Bitcoin Backtesting Engine Access",
    "Advanced Single-Device Security Protection",
];

const FAQS = [
    {
        q: "What is included in the Bazaar Sync Pro Membership?",
        a: "Pro membership gives you complete, unrestricted access to the Strategy Builder, multi-leg Options Backtesting Engine, Real-time Option Chain with live Greeks, Bitcoin 3-Year Replay, and Virtual Paper Trading Terminal with ₹5,00,000 trading money.",
    },
    {
        q: "Is there any automatic recurring subscription deduction on my card?",
        a: "No. All plans are one-time payments via Razorpay (UPI, Netbanking, Cards). We never auto-debit your card or account. You can renew whenever your validity expires.",
    },
    {
        q: "What happens if I exhaust my ₹5,00,000 Paper Trading virtual capital?",
        a: "Pro members can instantly refill +₹5,00,000 Virtual Capital anytime for a nominal processing fee of ₹100 from the Paper Trade terminal without losing their active positions history.",
    },
    {
        q: "Do I need an Angel One or Kotak broker demat account to backtest?",
        a: "No! Bazaar Sync operates its own institutional market streaming pipelines. You do not need any broker credentials or live funds to backtest, simulate, and analyze options on our platform.",
    },
    {
        q: "Can I log in from multiple devices?",
        a: "To protect account integrity and proprietary streaming feeds, Bazaar Sync enforces Single-Device Concurrent Session Security. You can log in on any device (phone, laptop, iPad), but logging in on a new device will safely terminate older active sessions.",
    },
];

function formatPlanPrice(paise) {
    const p = Number(paise);
    if (!Number.isFinite(p)) return "₹0";
    return `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
}

function formatExpiry(iso) {
    return new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function MiniCandles() {
    const bars = [
        { x: 0, h: 16, y: 36 },
        { x: 14, h: 28, y: 24 },
        { x: 28, h: 42, y: 10 },
        { x: 42, h: 24, y: 28 },
        { x: 56, h: 50, y: 2 },
    ];
    return (
        <svg
            width="76"
            height="60"
            viewBox="0 0 76 60"
            className="pointer-events-none absolute bottom-4 right-4 opacity-25 dark:opacity-20 select-none"
            aria-hidden="true"
        >
            {bars.map((b, i) => (
                <g key={i}>
                    <line
                        x1={b.x + 4}
                        x2={b.x + 4}
                        y1={b.y - 4}
                        y2={b.y + b.h + 4}
                        stroke="#10b981"
                        strokeWidth="1.2"
                        opacity="0.7"
                    />
                    <rect
                        x={b.x}
                        y={b.y}
                        width="8"
                        height={b.h}
                        rx="1.5"
                        fill="#10b981"
                        opacity="0.6"
                    />
                </g>
            ))}
        </svg>
    );
}

export default function Pricing() {
    const { user, token, isPro, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [plans, setPlans] = useState(null);
    const [plansError, setPlansError] = useState(null);
    const [busyPlanId, setBusyPlanId] = useState(null);
    const [checkoutError, setCheckoutError] = useState(null);
    const [couponCode, setCouponCode] = useState("");
    const [couponPreview, setCouponPreview] = useState(null);
    const [couponError, setCouponError] = useState(null);
    const [applyingCoupon, setApplyingCoupon] = useState(false);
    const [openFaqIndex, setOpenFaqIndex] = useState(null);

    useEffect(() => {
        let isMounted = true;
        fetchProPlans()
            .then((r) => {
                if (isMounted) {
                    const sorted = (r.plans || []).sort((a, b) => (a.days || 0) - (b.days || 0));
                    setPlans(sorted);
                }
            })
            .catch((err) => {
                if (isMounted) setPlansError(err.message);
            });

        return () => {
            isMounted = false;
        };
    }, []);

    function handleCouponInput(v) {
        setCouponCode(v.toUpperCase());
        setCouponPreview(null);
        setCouponError(null);
    }

    async function applyCoupon() {
        const code = couponCode.trim();
        if (!code) return;
        setApplyingCoupon(true);
        setCouponError(null);
        setCouponPreview(null);
        try {
            const result = await validateCoupon(code);
            setCouponPreview(result);
        } catch (err) {
            setCouponError(err.message || "Invalid coupon code");
        } finally {
            setApplyingCoupon(false);
        }
    }

    function clearCoupon() {
        setCouponCode("");
        setCouponPreview(null);
        setCouponError(null);
    }

    const buyPlan = useCallback(
        async (planId) => {
            if (!user) {
                navigate("/login");
                return;
            }
            setCheckoutError(null);
            setBusyPlanId(planId);
            try {
                const Razorpay = await loadRazorpayCheckout();
                const order = await createProOrder(
                    token,
                    planId,
                    couponPreview ? couponCode.trim() : ""
                );
                const rzp = new Razorpay({
                    key: order.keyId,
                    amount: order.amount,
                    currency: order.currency,
                    order_id: order.orderId,
                    name: "Bazaar Sync",
                    description: `Pro Membership Subscription (${planId})`,
                    handler: async (response) => {
                        try {
                            await verifyProPayment(token, {
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                            });
                            await refreshUser();
                        } catch (err) {
                            setCheckoutError(err.message || "Payment verification failed");
                        } finally {
                            setBusyPlanId(null);
                        }
                    },
                    modal: { ondismiss: () => setBusyPlanId(null) },
                    theme: { color: "#059669" },
                });
                rzp.on("payment.failed", (resp) => {
                    setCheckoutError(resp.error?.description || "Payment failed at gateway");
                    setBusyPlanId(null);
                });
                rzp.open();
            } catch (err) {
                setCheckoutError(err.message || "Could not initialize checkout");
                setBusyPlanId(null);
            }
        },
        [user, token, navigate, refreshUser, couponCode, couponPreview]
    );

    return (
        <div className="relative min-h-[calc(100vh-65px)] w-full overflow-hidden px-4 py-12 sm:px-6 lg:px-8">
            {/* Ambient Background Glowing Orbs for Frosted Glass Effect */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <div
                    className="absolute top-10 left-1/4 h-96 w-96 rounded-full bg-emerald-500/15 dark:bg-emerald-500/10 blur-[140px] animate-pulse"
                    style={{ animationDuration: "9s" }}
                />
                <div
                    className="absolute bottom-20 right-1/4 h-[420px] w-[420px] rounded-full bg-teal-500/15 dark:bg-teal-500/10 blur-[160px] animate-pulse"
                    style={{ animationDuration: "11s", animationDelay: "3s" }}
                />
                <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full bg-indigo-500/10 dark:bg-indigo-600/10 blur-[180px]"
                />
            </div>

            <div className="relative z-10 mx-auto max-w-6xl">
                {/* Header Section */}
                <div className="text-center space-y-3">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 backdrop-blur-md">
                        <FiZap size={13} /> Transparent &amp; Fair Pricing
                    </div>
                    <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-gray-900 dark:text-white">
                        Unlock the Full Power of Bazaar Sync
                    </h1>
                    <p className="mx-auto max-w-2xl text-xs sm:text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                        One unified Pro Membership unlocks everything — tick-by-tick options backtesting, Strategy Builder, live Greeks, Bitcoin replay, and ₹5,00,000 virtual paper trading.
                    </p>
                </div>

                {/* Coupon Code Station (Glassmorphic) */}
                <div className="mx-auto mt-8 max-w-md">
                    <div className="rounded-2xl border border-white/60 bg-white/70 p-2.5 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-[#0c1524]/70">
                        {couponPreview ? (
                            <div className="flex items-center justify-between gap-2 rounded-xl bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                                <div className="flex items-center gap-2">
                                    <FiTag size={15} className="text-emerald-500 shrink-0" />
                                    <span>
                                        Coupon <strong className="text-emerald-600 dark:text-emerald-400">{couponPreview.code}</strong> Applied (
                                        {couponPreview.discountType === "percent"
                                            ? `${couponPreview.discountValue}% OFF`
                                            : `₹${couponPreview.discountValue} OFF`}
                                        )
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={clearCoupon}
                                    aria-label="Remove coupon"
                                    className="rounded-full p-1 text-emerald-700/70 hover:bg-emerald-500/20 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-white transition"
                                >
                                    <FiX size={14} />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <FiTag className="absolute left-3.5 top-2.5 text-gray-400" size={15} />
                                    <input
                                        value={couponCode}
                                        onChange={(e) => handleCouponInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                applyCoupon();
                                            }
                                        }}
                                        placeholder="Have a promo / coupon code?"
                                        className="w-full rounded-xl bg-transparent pl-10 pr-3 py-2 text-xs font-semibold text-gray-900 placeholder-gray-400 outline-none dark:text-white dark:placeholder-gray-500"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={applyCoupon}
                                    disabled={!couponCode.trim() || applyingCoupon}
                                    className="rounded-xl bg-gray-900 px-4 py-2 text-xs font-bold text-white hover:bg-gray-800 dark:bg-emerald-600 dark:hover:bg-emerald-700 transition disabled:opacity-40 cursor-pointer"
                                >
                                    {applyingCoupon ? "Applying…" : "Apply Code"}
                                </button>
                            </div>
                        )}
                    </div>
                    {couponError && (
                        <p className="mt-2 text-center text-xs font-semibold text-rose-500 dark:text-rose-400">
                            {couponError}
                        </p>
                    )}
                </div>

                {/* Status Banners */}
                {isPro && user?.pro_expires_at && (
                    <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-center text-xs font-bold text-emerald-700 dark:text-emerald-300 backdrop-blur-md">
                        🎉 Active Pro Member until {formatExpiry(user.pro_expires_at)} — Purchasing any plan below extends your validity.
                    </div>
                )}
                {checkoutError && (
                    <div className="mx-auto mt-4 max-w-xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-center text-xs font-bold text-rose-600 dark:text-rose-300 backdrop-blur-md">
                        {checkoutError}
                    </div>
                )}
                {plansError && (
                    <div className="mx-auto mt-6 max-w-xl rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-center text-xs font-bold text-rose-600 dark:text-rose-300">
                        Failed to load subscription plans ({plansError}). Please refresh the page.
                    </div>
                )}

                {/* Loading Skeleton */}
                {!plans && !plansError && (
                    <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3].map((n) => (
                            <div
                                key={n}
                                className="h-96 rounded-3xl border border-white/60 bg-white/40 p-6 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-[#0c1524]/40 animate-pulse"
                            />
                        ))}
                    </div>
                )}

                {/* Pricing Cards Grid (Glassmorphism) */}
                {plans && (
                    <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
                        {plans.map((plan) => {
                            const pricePaise = plan.priceInPaise ?? plan.price_in_paise ?? 0;
                            const durationText = plan.duration || plan.duration_label || `${plan.days} Days`;
                            const isFeatured = Boolean(plan.badge) || plan.id === "6m";
                            const isLongest = plan.days >= 300;
                            const isMonthly = plan.days <= 35;
                            const monthlyPriceRef = 499;
                            const effectiveMonthly = Math.round((pricePaise / 100) / ((plan.days || 30) / 30));
                            const savingsPct = isMonthly
                                ? null
                                : Math.round(((monthlyPriceRef * ((plan.days || 30) / 30) - (pricePaise / 100)) / (monthlyPriceRef * ((plan.days || 30) / 30))) * 100);

                            const features = [
                                ...BASE_FEATURES,
                                isLongest
                                    ? "24/7 Priority Quantitative Strategy Support"
                                    : "Dedicated Technical Support Assistance",
                            ];

                            const ctaText = busyPlanId === plan.id
                                ? "Initializing Gateway…"
                                : !user
                                ? "Log in to Subscribe"
                                : isPro
                                ? "Renew & Extend Plan"
                                : `Subscribe to ${plan.name}`;

                            return (
                                <div key={plan.id} className="relative flex flex-col group">
                                    {/* Ambient Card Back-Glow for Featured Plan */}
                                    {isFeatured && (
                                        <div className="pointer-events-none absolute -inset-1.5 rounded-[34px] bg-gradient-to-r from-emerald-500/30 via-teal-500/20 to-indigo-500/30 blur-xl opacity-85 dark:opacity-60 animate-pulse -z-10" />
                                    )}

                                    {/* Glassmorphic Main Card Container */}
                                    <div
                                        className={`relative flex flex-1 flex-col overflow-hidden rounded-3xl border p-6 sm:p-7 shadow-[0_20px_50px_rgba(0,0,0,0.08)] backdrop-blur-2xl transition duration-300 hover:scale-[1.01] dark:shadow-[0_25px_60px_rgba(0,0,0,0.5)] ${
                                            isFeatured
                                                ? "border-emerald-500/80 bg-white/80 dark:border-emerald-400/50 dark:bg-[#0c1626]/80 ring-2 ring-emerald-500/30 shadow-emerald-500/10"
                                                : "border-white/70 bg-white/60 dark:border-white/10 dark:bg-[#0a1220]/65"
                                        }`}
                                    >
                                        {/* Top Specular Reflective Highlight */}
                                        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-emerald-400/30" />

                                        {/* Plan Header & Badges */}
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h3 className="text-xl font-black text-gray-900 dark:text-white">
                                                    {plan.name}
                                                </h3>
                                                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-0.5">
                                                    {durationText} Full Validity
                                                </p>
                                            </div>

                                            {plan.badge ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                                    <FiTrendingUp size={12} /> {plan.badge}
                                                </span>
                                            ) : savingsPct && savingsPct > 0 ? (
                                                <span className="inline-flex items-center rounded-full bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                                                    Save {savingsPct}%
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-white/5 px-2.5 py-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">
                                                    Standard
                                                </span>
                                            )}
                                        </div>

                                        {/* Price Display */}
                                        <div className="my-2">
                                            {couponPreview?.perPlan?.[plan.id] ? (
                                                <div className="space-y-1">
                                                    <div className="flex items-baseline gap-2">
                                                        <span className="text-base text-gray-400 line-through font-semibold">
                                                            {formatPlanPrice(pricePaise)}
                                                        </span>
                                                        <span className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400">
                                                            {formatPlanPrice(couponPreview.perPlan[plan.id].finalAmountPaise)}
                                                        </span>
                                                    </div>
                                                    <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                                        Discount Applied with {couponPreview.code}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-3xl sm:text-4xl font-black text-gray-900 dark:text-white">
                                                        {formatPlanPrice(pricePaise)}
                                                    </span>
                                                    {!isMonthly && (
                                                        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                                            (~₹{effectiveMonthly}/mo)
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mt-1">
                                                Inclusive of all platform analytics • No auto-debit
                                            </div>
                                        </div>

                                        {/* Divider */}
                                        <div className="my-5 h-px bg-gray-200/80 dark:bg-white/10" />

                                        {/* Feature Checklist */}
                                        <ul className="flex-1 space-y-2.5 mb-6">
                                            {features.map((f, i) => (
                                                <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-gray-700 dark:text-gray-300">
                                                    <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 mt-0.5">
                                                        <FiCheck size={11} strokeWidth={3} />
                                                    </div>
                                                    <span className="leading-relaxed">{f}</span>
                                                </li>
                                            ))}
                                        </ul>

                                        {/* CTA Button */}
                                        <button
                                            type="button"
                                            onClick={() => buyPlan(plan.id)}
                                            disabled={busyPlanId === plan.id}
                                            className={`relative z-10 w-full rounded-2xl py-3 px-4 text-xs font-black uppercase tracking-wider text-white transition duration-200 shadow-lg cursor-pointer flex items-center justify-center gap-2 ${
                                                isFeatured
                                                    ? "bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 shadow-emerald-600/30 active:scale-95"
                                                    : "bg-gray-900 hover:bg-gray-800 dark:bg-emerald-600/80 dark:hover:bg-emerald-600 shadow-gray-900/20 active:scale-95"
                                            } disabled:opacity-50`}
                                        >
                                            <span>{ctaText}</span>
                                            <FiArrowRight size={14} />
                                        </button>

                                        <MiniCandles />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Trust & Security Highlights */}
                <div className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="rounded-2xl border border-white/60 bg-white/60 p-4 shadow-xs backdrop-blur-xl dark:border-white/10 dark:bg-[#0c1524]/60 text-center">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2">
                            <FiLock size={18} />
                        </div>
                        <div className="text-xs font-bold text-gray-900 dark:text-white">Razorpay Secure</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">UPI, Cards &amp; Netbanking</div>
                    </div>

                    <div className="rounded-2xl border border-white/60 bg-white/60 p-4 shadow-xs backdrop-blur-xl dark:border-white/10 dark:bg-[#0c1524]/60 text-center">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2">
                            <FiZap size={18} />
                        </div>
                        <div className="text-xs font-bold text-gray-900 dark:text-white">Instant Activation</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">Zero waiting time</div>
                    </div>

                    <div className="rounded-2xl border border-white/60 bg-white/60 p-4 shadow-xs backdrop-blur-xl dark:border-white/10 dark:bg-[#0c1524]/60 text-center">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2">
                            <FiShield size={18} />
                        </div>
                        <div className="text-xs font-bold text-gray-900 dark:text-white">Zero Broker Risk</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">100% Virtual Simulations</div>
                    </div>

                    <div className="rounded-2xl border border-white/60 bg-white/60 p-4 shadow-xs backdrop-blur-xl dark:border-white/10 dark:bg-[#0c1524]/60 text-center">
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2">
                            <FiActivity size={18} />
                        </div>
                        <div className="text-xs font-bold text-gray-900 dark:text-white">Continuous Upgrades</div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">New features included</div>
                    </div>
                </div>

                {/* FAQ Accordion Section */}
                <div className="mt-16 max-w-3xl mx-auto">
                    <div className="text-center mb-8">
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white">
                            Frequently Asked Questions
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Everything you need to know about Bazaar Sync subscriptions and billing.
                        </p>
                    </div>

                    <div className="space-y-3">
                        {FAQS.map((faq, idx) => {
                            const isOpen = openFaqIndex === idx;
                            return (
                                <div
                                    key={idx}
                                    className="overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-xs backdrop-blur-xl dark:border-white/10 dark:bg-[#0c1524]/70 transition"
                                >
                                    <button
                                        type="button"
                                        onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                                        className="flex w-full items-center justify-between p-4 text-left text-xs sm:text-sm font-bold text-gray-900 dark:text-white"
                                    >
                                        <span>{faq.q}</span>
                                        <FiChevronDown
                                            className={`text-gray-400 transition-transform duration-200 shrink-0 ml-2 ${
                                                isOpen ? "rotate-180 text-emerald-500" : ""
                                            }`}
                                            size={16}
                                        />
                                    </button>
                                    {isOpen && (
                                        <div className="px-4 pb-4 pt-1 text-xs text-gray-600 dark:text-gray-300 leading-relaxed border-t border-gray-100 dark:border-white/5 animate-in fade-in duration-150">
                                            {faq.a}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
