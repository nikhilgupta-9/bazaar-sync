// pages/Pricing.jsx — real plan catalog fetched from the server
// (GET /api/subscription/plans, public/no-auth) rather than hardcoded here,
// so the price shown always matches what Razorpay will actually charge (see
// server/services/proPlanService.js / the pro_plans table — the admin-managed
// single source of truth, editable at admin's Plans & Coupons page since
// 2026-09-13). Checkout reuses the same order->Checkout->verify flow
// PaperTrade.jsx's "Get Pro" button already uses, just parameterized by
// plan id and tracked per-card instead of one global "busy" flag. Since an
// admin can add/rename/remove plans freely, nothing here assumes exactly 3
// plans or the specific ids "1m"/"6m"/"12m" — CTA_LABEL below is a
// best-effort label for the plans this page shipped with, not a requirement.
//
// Neon-green card design matches the reference the user supplied
// (Starter/Pro Trader/Elite), now following the app-wide light/dark theme
// (ThemeContext.jsx / index.css's `.dark` CSS-variable overrides) via plain
// Tailwind semantic classes (bg-white cards, emerald-600 accent) — same
// convention OptionChain.jsx/StrategyBuilder.jsx use, and same conversion
// PaperTrade.jsx got. Previously this page carried its own page-local dark
// hex palette (a precedent set before the app-wide theme existed); that's
// gone now, only the decorative candlestick glow keeps a couple of static
// rgba accents (a subtle glow reads fine unchanged in either theme).
//
// Coupon field (added Phase 11) applies at order-creation time — the server
// validates it and returns the discounted Razorpay amount, never trusted
// from the client beyond the code string itself. No WhatsApp/Telegram
// buttons — neither exists as a real contact feature yet (see project
// notes: don't ship UI that doesn't do anything real). "+18% GST" is shown
// as a note only because the reference design shows it — the amount
// actually charged via Razorpay is exactly the displayed price, nothing is
// silently added on top.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiCheck, FiTrendingUp, FiTag, FiX } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { fetchProPlans, validateCoupon, createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";

// Same across every plan today — the backend doesn't differentiate feature
// access by plan, only price/duration — so every card lists the same real,
// reachable features. Only the support line differs (matches the reference:
// the longest-duration plan gets "24/7 priority support" — keyed off `days`,
// not a hardcoded plan id, since an admin can rename/replace "Elite" freely).
const BASE_FEATURES = [
    "Unlimited access to all tools",
    "Paper Trading — ₹5,00,000 virtual capital",
    "Historical data & charts",
    "Real-time market data",
];
const CTA_LABEL = { "1m": "Get Started", "6m": "Buy Now", "12m": "Upgrade" };

function formatPlanPrice(paise) {
    return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}

function formatExpiry(iso) {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Small decorative candlestick cluster in the bottom-right corner of each
// card, matching the reference design's accent — static and low-opacity,
// purely decorative (see AuthBackground.jsx for the animated, page-wide
// version of the same idea). Uses the theme's emerald CSS variable so the
// accent color still flips correctly under dark mode.
function MiniCandles() {
    const bars = [
        { x: 0, h: 18, y: 34 }, { x: 14, h: 30, y: 22 }, { x: 28, h: 44, y: 8 },
        { x: 42, h: 26, y: 26 }, { x: 56, h: 52, y: 0 },
    ];
    return (
        <svg width="76" height="60" viewBox="0 0 76 60" className="pointer-events-none absolute bottom-4 right-4 opacity-40" aria-hidden="true">
            {bars.map((b, i) => (
                <g key={i}>
                    <line x1={b.x + 4} x2={b.x + 4} y1={b.y - 4} y2={b.y + b.h + 4} stroke="var(--color-emerald-500)" strokeWidth="1" opacity="0.6" />
                    <rect x={b.x} y={b.y} width="8" height={b.h} rx="1.5" fill="var(--color-emerald-500)" opacity="0.55" />
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
    const [couponPreview, setCouponPreview] = useState(null); // { code, discountType, discountValue, perPlan } | null
    const [couponError, setCouponError] = useState(null);
    const [applyingCoupon, setApplyingCoupon] = useState(false);

    useEffect(() => {
        fetchProPlans()
            .then((r) => setPlans(r.plans))
            .catch((err) => setPlansError(err.message));
    }, []);

    function handleCouponInput(v) {
        setCouponCode(v.toUpperCase());
        // Editing the code after a successful Apply invalidates that preview —
        // don't keep showing a discount for a code that's since changed.
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
            setCouponError(err.message);
        } finally {
            setApplyingCoupon(false);
        }
    }

    function clearCoupon() {
        setCouponCode("");
        setCouponPreview(null);
        setCouponError(null);
    }

    const buyPlan = useCallback(async (planId) => {
        if (!user) { navigate("/login"); return; }
        setCheckoutError(null);
        setBusyPlanId(planId);
        try {
            const Razorpay = await loadRazorpayCheckout();
            // Only actually apply the code at checkout if it passed Apply — an
            // edited-but-not-reapplied code is not sent, so the amount charged
            // never disagrees with the discount (if any) shown on the cards.
            const order = await createProOrder(token, planId, couponPreview ? couponCode.trim() : "");
            const rzp = new Razorpay({
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                order_id: order.orderId,
                name: "Bazaar Sync",
                description: `Pro membership — ${planId}`,
                handler: async (response) => {
                    try {
                        await verifyProPayment(token, {
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        });
                        await refreshUser();
                    } catch (err) {
                        setCheckoutError(err.message);
                    } finally {
                        setBusyPlanId(null);
                    }
                },
                modal: { ondismiss: () => setBusyPlanId(null) },
                theme: { color: "#059669" },
            });
            rzp.on("payment.failed", (resp) => {
                setCheckoutError(resp.error?.description || "Payment failed");
                setBusyPlanId(null);
            });
            rzp.open();
        } catch (err) {
            setCheckoutError(err.message);
            setBusyPlanId(null);
        }
    }, [user, token, navigate, refreshUser, couponCode, couponPreview]);

    return (
        <div className="w-full bg-gray-50 px-6 py-12 text-gray-900">
            <div className="mx-auto max-w-[1200px]">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-gray-900">Pricing</h1>
                    <p className="mx-auto mt-2 max-w-xl text-sm text-gray-400">
                        One Pro membership unlocks every tool — Strategy Builder saves, the Simulator, and
                        Paper Trading with ₹5,00,000 virtual capital. Pick the length that suits you.
                    </p>
                </div>

                <div className="mx-auto mt-6 max-w-xs">
                    <label className="mb-1 block text-center text-xs text-gray-400">Have a coupon code?</label>
                    {couponPreview ? (
                        <div className="flex items-center justify-center gap-2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                            <FiTag size={14} />
                            {couponPreview.code} applied — {couponPreview.discountType === "percent" ? `${couponPreview.discountValue}% off` : `₹${couponPreview.discountValue} off`}
                            <button type="button" onClick={clearCoupon} aria-label="Remove coupon" className="ml-1 text-emerald-700/70 hover:text-emerald-900">
                                <FiX size={14} />
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <input
                                value={couponCode}
                                onChange={(e) => handleCouponInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyCoupon(); } }}
                                placeholder="Enter code"
                                className="w-full rounded-full border border-gray-200 bg-white px-4 py-2 text-center text-sm text-gray-900 outline-none focus:border-emerald-400"
                            />
                            <button
                                type="button" onClick={applyCoupon} disabled={!couponCode.trim() || applyingCoupon}
                                className="shrink-0 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
                            >
                                {applyingCoupon ? "Checking…" : "Apply"}
                            </button>
                        </div>
                    )}
                    {couponError && <p className="mt-1.5 text-center text-xs text-rose-600">{couponError}</p>}
                </div>

                {isPro && user?.pro_expires_at && (
                    <div className="mx-auto mt-6 max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-700">
                        You're on Pro until {formatExpiry(user.pro_expires_at)} — buying a plan below renews from that date.
                    </div>
                )}
                {checkoutError && (
                    <div className="mx-auto mt-4 max-w-xl rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-700">
                        {checkoutError}
                    </div>
                )}
                {plansError && (
                    <div className="mx-auto mt-8 max-w-xl rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-center text-sm text-rose-700">
                        Couldn't load plans ({plansError}). Try refreshing.
                    </div>
                )}

                {!plans && !plansError && (
                    <div className="mt-12 text-center text-sm text-gray-400">Loading plans…</div>
                )}

                {plans && (
                    <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {plans.map((plan) => {
                            const isLongestPlan = plan.days === Math.max(...plans.map((p) => p.days));
                            const features = [...BASE_FEATURES, isLongestPlan ? "24/7 priority support" : "Dedicated support"];
                            const label = busyPlanId === plan.id
                                ? "Opening…"
                                : !user
                                ? "Log in to subscribe"
                                : isPro
                                ? "Renew"
                                : CTA_LABEL[plan.id] || "Buy Now";

                            return (
                                <div
                                    key={plan.id}
                                    className={`relative flex flex-col overflow-hidden rounded-3xl border bg-white p-6 shadow-sm ${
                                        plan.badge ? "border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.20)]" : "border-gray-200"
                                    }`}
                                >
                                    {plan.badge && (
                                        <span className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-emerald-500 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
                                            <FiTrendingUp size={12} /> {plan.badge}
                                        </span>
                                    )}

                                    <div className="text-lg font-bold text-gray-900">{plan.name} ({plan.duration})</div>

                                    {couponPreview?.perPlan?.[plan.id] ? (
                                        <div className="mt-3 flex items-baseline gap-2">
                                            <span className="text-lg font-medium text-gray-400 line-through">{formatPlanPrice(plan.priceInPaise)}</span>
                                            <span className="text-4xl font-extrabold text-emerald-600">
                                                {formatPlanPrice(couponPreview.perPlan[plan.id].finalAmountPaise)}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="mt-3 text-4xl font-extrabold text-emerald-600">
                                            {formatPlanPrice(plan.priceInPaise)}
                                        </div>
                                    )}
                                    <div className="text-xs text-gray-400">+18% GST</div>

                                    <ul className="mt-5 flex-1 space-y-2.5">
                                        {features.map((f) => (
                                            <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                                                <FiCheck className="mt-0.5 shrink-0 text-emerald-600" size={15} />
                                                {f}
                                            </li>
                                        ))}
                                    </ul>

                                    <button
                                        onClick={() => buyPlan(plan.id)}
                                        disabled={busyPlanId === plan.id}
                                        className="relative z-10 mt-6 w-full rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        {label}
                                    </button>

                                    <MiniCandles />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
