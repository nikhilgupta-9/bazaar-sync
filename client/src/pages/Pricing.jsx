// pages/Pricing.jsx — real plan catalog fetched from the server
// (GET /api/subscription/plans, public/no-auth) rather than hardcoded here,
// so the price shown always matches what Razorpay will actually charge (see
// server/config/paperTradeConfig.js's PRO_PLANS — the single source of
// truth). Checkout reuses the same order->Checkout->verify flow
// PaperTrade.jsx's "Get Pro" button already uses, just parameterized by
// plan id and tracked per-card instead of one global "busy" flag.
//
// Dark neon-green card design matches the reference the user supplied
// (Starter/Pro Trader/Elite). Page-wide dark background, same precedent
// PaperTrade.jsx already set (a self-contained hex palette scoped to just
// this page, not the app-wide light theme) — the rest of the site stays
// light, only this page opts into the dark trading-terminal look.
//
// No coupon field and no WhatsApp/Telegram buttons — neither exists as a
// real backend/contact feature yet, so neither is shown here (see project
// notes: don't ship UI that doesn't do anything real). "+18% GST" is shown
// as a note only because the reference design shows it — the amount
// actually charged via Razorpay is exactly the displayed price, nothing is
// silently added on top.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiCheck, FiTrendingUp } from "react-icons/fi";
import { useAuth } from "../context/AuthContext";
import { fetchProPlans, createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";

const BG = "#04070a";
const CARD_BG = "#060f0a";
const BORDER = "#123322";
const TEXT = "#f2f7f4";
const MUTED = "#8b9c93";
const GREEN = "#0be55c";
const GREEN_BRIGHT = "#7dffb0";
const GREEN_DARK = "#04150a";

// Same across every plan today — the backend doesn't differentiate feature
// access by plan, only price/duration (see PRO_PLANS) — so every card lists
// the same real, reachable features. Only the support line differs (matches
// the reference: Elite gets "24/7 priority support").
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
// version of the same idea).
function MiniCandles() {
    const bars = [
        { x: 0, h: 18, y: 34 }, { x: 14, h: 30, y: 22 }, { x: 28, h: 44, y: 8 },
        { x: 42, h: 26, y: 26 }, { x: 56, h: 52, y: 0 },
    ];
    return (
        <svg width="76" height="60" viewBox="0 0 76 60" className="pointer-events-none absolute bottom-4 right-4 opacity-40" aria-hidden="true">
            {bars.map((b, i) => (
                <g key={i}>
                    <line x1={b.x + 4} x2={b.x + 4} y1={b.y - 4} y2={b.y + b.h + 4} stroke={GREEN} strokeWidth="1" opacity="0.6" />
                    <rect x={b.x} y={b.y} width="8" height={b.h} rx="1.5" fill={GREEN} opacity="0.55" />
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

    useEffect(() => {
        fetchProPlans()
            .then((r) => setPlans(r.plans))
            .catch((err) => setPlansError(err.message));
    }, []);

    const buyPlan = useCallback(async (planId) => {
        if (!user) { navigate("/login"); return; }
        setCheckoutError(null);
        setBusyPlanId(planId);
        try {
            const Razorpay = await loadRazorpayCheckout();
            const order = await createProOrder(token, planId);
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
                theme: { color: GREEN },
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
    }, [user, token, navigate, refreshUser]);

    return (
        <div className="w-full px-6 py-12" style={{ background: BG, color: TEXT }}>
            <div className="mx-auto max-w-[1200px]">
                <div className="text-center">
                    <h1 className="text-3xl font-bold" style={{ color: TEXT }}>Pricing</h1>
                    <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: MUTED }}>
                        One Pro membership unlocks every tool — Strategy Builder saves, the Simulator, and
                        Paper Trading with ₹5,00,000 virtual capital. Pick the length that suits you.
                    </p>
                </div>

                {isPro && user?.pro_expires_at && (
                    <div className="mx-auto mt-6 max-w-xl rounded-lg px-4 py-2 text-center text-sm" style={{ background: "rgba(11,229,92,0.08)", border: `1px solid ${GREEN}`, color: GREEN_BRIGHT }}>
                        You're on Pro until {formatExpiry(user.pro_expires_at)} — buying a plan below renews from that date.
                    </div>
                )}
                {checkoutError && (
                    <div className="mx-auto mt-4 max-w-xl rounded-lg px-4 py-2 text-center text-sm" style={{ background: "rgba(235,9,11,0.1)", border: "1px solid #eb090b", color: "#ff8f90" }}>
                        {checkoutError}
                    </div>
                )}
                {plansError && (
                    <div className="mx-auto mt-8 max-w-xl rounded-lg px-4 py-3 text-center text-sm" style={{ background: "rgba(235,9,11,0.1)", border: "1px solid #eb090b", color: "#ff8f90" }}>
                        Couldn't load plans ({plansError}). Try refreshing.
                    </div>
                )}

                {!plans && !plansError && (
                    <div className="mt-12 text-center text-sm" style={{ color: MUTED }}>Loading plans…</div>
                )}

                {plans && (
                    <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
                        {plans.map((plan) => {
                            const features = [...BASE_FEATURES, plan.id === "12m" ? "24/7 priority support" : "Dedicated support"];
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
                                    className="relative flex flex-col overflow-hidden rounded-3xl p-6"
                                    style={{
                                        background: `radial-gradient(circle at 100% 100%, rgba(11,229,92,0.08) 0%, transparent 55%), ${CARD_BG}`,
                                        border: `1px solid ${plan.badge ? GREEN : BORDER}`,
                                        boxShadow: plan.badge ? `0 0 30px rgba(11,229,92,0.25)` : `0 0 16px rgba(11,229,92,0.08)`,
                                    }}
                                >
                                    {plan.badge && (
                                        <span
                                            className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide"
                                            style={{ background: GREEN_DARK, border: `1px solid ${GREEN}`, color: GREEN_BRIGHT }}
                                        >
                                            <FiTrendingUp size={12} /> {plan.badge}
                                        </span>
                                    )}

                                    <div className="text-lg font-bold" style={{ color: TEXT }}>{plan.name} ({plan.duration})</div>

                                    <div
                                        className="mt-3 text-4xl font-extrabold"
                                        style={{ color: GREEN_BRIGHT, textShadow: `0 0 22px rgba(11,229,92,0.55)` }}
                                    >
                                        {formatPlanPrice(plan.priceInPaise)}
                                    </div>
                                    <div className="text-xs" style={{ color: MUTED }}>+18% GST</div>

                                    <ul className="mt-5 flex-1 space-y-2.5">
                                        {features.map((f) => (
                                            <li key={f} className="flex items-start gap-2 text-sm" style={{ color: "#c9d6ce" }}>
                                                <FiCheck className="mt-0.5 shrink-0" size={15} style={{ color: GREEN }} />
                                                {f}
                                            </li>
                                        ))}
                                    </ul>

                                    <button
                                        onClick={() => buyPlan(plan.id)}
                                        disabled={busyPlanId === plan.id}
                                        className="relative z-10 mt-6 w-full rounded-full px-4 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50"
                                        style={{ background: GREEN, color: GREEN_DARK }}
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
