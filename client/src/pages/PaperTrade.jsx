// pages/PaperTrade.jsx — wallet + Pro-subscription purchase UI (Phase 8.2),
// the real order-placement engine (Phase 8.3), and long+short with
// margin (Phase 8.4 — SELL exists in paperPositionService.js/openPosition's
// `side` param; this page previously only exposed BUY, which is what that
// phase's write-up flagged as stale. Both sides are wired up below.
//
// Dark trading-terminal theme, scoped to just this page (the rest of the
// app is light-themed) — a self-contained hex palette below, deliberately
// NOT reusing the app-wide `.dark` CSS-variable theme that ThemeContext.jsx
// / index.css carry, since that block is still sitting uncommitted mid a
// paused cherry-pick when this was written; depending on it would make this
// page's look silently hinge on unrelated in-progress work.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { useAuth } from "../context/AuthContext";
import { useOptionChain } from "../hooks/useOptionChain";
import { fetchWallet, createRefillOrder, verifyRefillPayment, fetchPositions, openPosition, closePosition } from "../services/paperTradeApi";
import { createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";
import { formatRupees, formatPrice, formatPercent, formatOi, formatDateTime } from "../utils/format";
import { computePayoffCurve, computeBreakevens, computeMaxProfitLoss } from "../utils/payoff";
import PayoffChart from "../components/PayoffChart";

// Fallback shown before /symbols/list resolves (or if it fails) — same 3
// live-worker symbols OptionChain.jsx falls back to.
const FALLBACK_SYMBOLS = { indices: ["NIFTY", "BANKNIFTY", "FINNIFTY"], stocks: [], liveSymbols: ["NIFTY", "BANKNIFTY", "FINNIFTY"] };
const POSITIONS_POLL_MS = 12000;

// Brand hex values, kept as plain Tailwind arbitrary-value classes rather
// than CSS variables — see file header for why this doesn't reuse the
// app-wide dark theme scaffolding.
const BG = "#030108";
const SURFACE = "#0b1420";
const SURFACE_2 = "#0f1a28";
const BORDER = "#18202c";
const TEXT = "#f5f7fa";
const MUTED = "#8b93a7";
const GREEN = "#0be55c";
const RED = "#eb090b";
const AMBER = "#f5a623";

const LEDGER_LABELS = {
    trial_grant: "Free trial grant",
    pro_purchase_grant: "Pro membership purchase",
    refill_purchase: "Paper capital refill",
    trade_debit: "Bought option",
    trade_credit: "Closed option",
};
const CAPITAL_GRANT_TYPES = new Set(["trial_grant", "pro_purchase_grant", "refill_purchase"]);

function timeLeft(untilIso) {
    const ms = new Date(untilIso).getTime() - Date.now();
    if (ms <= 0) return "expired";
    const hours = Math.floor(ms / 3_600_000);
    const days = Math.floor(hours / 24);
    if (days >= 1) return `${days}d ${hours % 24}h left`;
    return `${hours}h left`;
}

// IST calendar date, string-only (see CLAUDE.md Gotcha #12 — never
// `.getDate()`/local-timezone Date methods) — used only to group today's
// trades for the "Today's P&L" tile.
function todayIst() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
function isToday(dateTimeStr) {
    return typeof dateTimeStr === "string" && dateTimeStr.slice(0, 10) === todayIst();
}

function pnlColor(v) {
    if (v == null) return MUTED;
    return v > 0 ? GREEN : v < 0 ? RED : MUTED;
}

function TradeCell({ strike, optRight, side, loggedIn, canTrade, onTrade, onLoginRequired }) {
    const [draftSide, setDraftSide] = useState(null); // 'long' | 'short' | null
    const [lots, setLots] = useState(1);

    if (!side || side.ltp == null) return <span style={{ color: MUTED }}>-</span>;

    if (draftSide) {
        return (
            <div className="flex items-center justify-end gap-1">
                <button
                    onClick={() => setLots((l) => Math.max(1, l - 1))}
                    className="h-5 w-5 rounded text-xs leading-none hover:opacity-80"
                    style={{ border: `1px solid ${BORDER}`, color: MUTED }}
                >
                    −
                </button>
                <span className="w-5 text-center text-xs" style={{ color: TEXT }}>{lots}</span>
                <button
                    onClick={() => setLots((l) => Math.min(100, l + 1))}
                    className="h-5 w-5 rounded text-xs leading-none hover:opacity-80"
                    style={{ border: `1px solid ${BORDER}`, color: MUTED }}
                >
                    +
                </button>
                <button
                    onClick={() => { onTrade(strike, optRight, lots, draftSide); setDraftSide(null); setLots(1); }}
                    className="rounded px-2 py-0.5 text-[11px] font-semibold text-white hover:opacity-90"
                    style={{ background: draftSide === "long" ? GREEN : RED }}
                >
                    {draftSide === "long" ? "Buy" : "Sell"}
                </button>
                <button onClick={() => setDraftSide(null)} className="text-xs hover:opacity-80" style={{ color: MUTED }}>✕</button>
            </div>
        );
    }

    return (
        <div className="group relative text-right">
            <span className="group-hover:invisible tabular-nums" style={{ color: TEXT }}>{formatPrice(side.ltp)}</span>
            {!loggedIn ? (
                <button
                    onClick={onLoginRequired}
                    className="invisible absolute inset-y-0 right-0 whitespace-nowrap rounded px-2 text-[11px] font-semibold hover:opacity-90 group-hover:visible"
                    style={{ background: SURFACE_2, border: `1px solid ${BORDER}`, color: TEXT }}
                >
                    Login to trade
                </button>
            ) : (
                canTrade && (
                    <div className="invisible absolute inset-y-0 right-0 flex items-center gap-1 group-hover:visible">
                        <button
                            onClick={() => setDraftSide("long")}
                            className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white hover:opacity-90"
                            style={{ background: GREEN }}
                        >
                            B
                        </button>
                        <button
                            onClick={() => setDraftSide("short")}
                            className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-white hover:opacity-90"
                            style={{ background: RED }}
                        >
                            S
                        </button>
                    </div>
                )
            )}
        </div>
    );
}

function StatTile({ label, value, valueColor }) {
    return (
        <div className="rounded-xl p-3" style={{ background: SURFACE_2, border: `1px solid ${BORDER}` }}>
            <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: MUTED }}>{label}</div>
            <div className="mt-1 text-base font-bold tabular-nums" style={{ color: valueColor || TEXT }}>{value}</div>
        </div>
    );
}

// Right-side order panel — opened by TradeCell's Buy/Sell click. Shows the
// contract + a lots stepper before confirm, then (after a successful
// openPosition call) switches to a "trade placed" state — both states
// render the same single-leg payoff preview (payoff.js, the exact math the
// Strategy Builder uses), per the user's explicit request that a payoff
// chart accompany the order both while placing it and right after.
function TradeDrawer({ symbol, draft, lots, setLots, lotSize, spotPrice, curveInfo, submitting, success, onConfirm, onClose }) {
    if (!draft) return null;
    const isShort = draft.side === "short";
    const sideColor = isShort ? RED : GREEN;
    const estAmount = draft.row.ltp * lots * (lotSize || 1);

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
            <div
                className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto p-4 shadow-2xl"
                style={{ background: SURFACE, borderLeft: `1px solid ${BORDER}`, color: TEXT }}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
                            {success ? "Trade placed" : "Place order"}
                        </div>
                        <div className="mt-0.5 text-lg font-bold">
                            {symbol} {draft.strike} {draft.optRight}
                            <span
                                className="ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase"
                                style={{ background: isShort ? "rgba(235,9,11,0.15)" : "rgba(11,229,92,0.15)", color: sideColor }}
                            >
                                {isShort ? "Sell" : "Buy"}
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-lg hover:opacity-80" style={{ color: MUTED }}>✕</button>
                </div>

                {!success ? (
                    <>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <StatTile label="LTP" value={formatPrice(draft.row.ltp)} />
                            <StatTile label="Lot size" value={lotSize ?? "-"} />
                        </div>

                        <div className="mt-3 flex items-center justify-between rounded-xl p-3" style={{ background: SURFACE_2, border: `1px solid ${BORDER}` }}>
                            <span className="text-xs font-medium" style={{ color: MUTED }}>Lots</span>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setLots((l) => Math.max(1, l - 1))}
                                    className="h-7 w-7 rounded text-sm hover:opacity-80"
                                    style={{ border: `1px solid ${BORDER}`, color: TEXT }}
                                >
                                    −
                                </button>
                                <span className="w-6 text-center text-sm font-semibold tabular-nums">{lots}</span>
                                <button
                                    onClick={() => setLots((l) => Math.min(100, l + 1))}
                                    className="h-7 w-7 rounded text-sm hover:opacity-80"
                                    style={{ border: `1px solid ${BORDER}`, color: TEXT }}
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <StatTile label={isShort ? "Est. Credit" : "Est. Cost"} value={formatRupees(estAmount)} />
                            <StatTile
                                label="Max Loss"
                                value={curveInfo.maxLoss === "Unlimited" ? "Unlimited" : curveInfo.maxLoss != null ? formatRupees(curveInfo.maxLoss) : "—"}
                                valueColor={RED}
                            />
                        </div>

                        <div className="mt-4 overflow-hidden rounded-xl bg-white p-1">
                            <PayoffChart curve={curveInfo.curve} spotPrice={spotPrice} breakevens={curveInfo.breakevens} expectedMove={null} />
                        </div>

                        <div className="mt-4 flex gap-2">
                            <button
                                onClick={onClose}
                                className="flex-1 rounded-lg py-2 text-sm font-semibold hover:opacity-80"
                                style={{ border: `1px solid ${BORDER}`, color: TEXT }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={onConfirm}
                                disabled={submitting}
                                className="flex-1 rounded-lg py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                                style={{ background: sideColor }}
                            >
                                {submitting ? "Placing…" : isShort ? "Sell" : "Buy"}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="mt-4 rounded-xl px-3 py-2.5 text-sm" style={{ background: "rgba(11,229,92,0.1)", border: `1px solid ${GREEN}`, color: GREEN }}>
                            ✓ {isShort ? "Sold" : "Bought"} {lots} lot{lots > 1 ? "s" : ""} of {symbol} {draft.strike}{draft.optRight} at {formatPrice(draft.row.ltp)}
                        </div>

                        <div className="mt-4 overflow-hidden rounded-xl bg-white p-1">
                            <PayoffChart curve={curveInfo.curve} spotPrice={spotPrice} breakevens={curveInfo.breakevens} expectedMove={null} />
                        </div>

                        <button
                            onClick={onClose}
                            className="mt-4 w-full rounded-lg py-2 text-sm font-bold text-black hover:opacity-90"
                            style={{ background: GREEN }}
                        >
                            Done
                        </button>
                    </>
                )}
            </div>
        </>
    );
}

export default function PaperTrade() {
    const { user, token, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [wallet, setWallet] = useState(null);
    // Only logged-in users have anything to fetch — an anonymous visitor
    // must never see a blocking "Loading…" screen (see file header: the
    // chain is public, login is only required to act).
    const [loading, setLoading] = useState(() => !!token);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null); // 'pro' | 'refill' | null
    const [positions, setPositions] = useState([]);
    const [closedPositions, setClosedPositions] = useState([]);
    const [closingId, setClosingId] = useState(null);
    const [closingAll, setClosingAll] = useState(false);

    const { symbol, setSymbol, data, marketStatus } = useOptionChain("NIFTY");
    const positionsPollRef = useRef(null);
    const atmRowRef = useRef(null);

    // Auto-center the chain on the SPOT/ATM row whenever a fresh chain loads
    // (symbol switch or first load) — same pattern as Strategy Builder's
    // scrollToAtm, "instant" so it doesn't visibly animate on every load.
    useEffect(() => {
        if (!data?.rows?.length) return;
        const raf = requestAnimationFrame(() => atmRowRef.current?.scrollIntoView({ behavior: "instant", block: "center" }));
        return () => cancelAnimationFrame(raf);
    }, [data?.selectedExpiry, symbol]);

    const loadWallet = useCallback(async () => {
        try {
            const d = await fetchWallet(token);
            setWallet(d);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    const loadPositions = useCallback(async () => {
        try {
            const [open, closed] = await Promise.all([
                fetchPositions(token, "open"),
                fetchPositions(token, "closed"),
            ]);
            setPositions(open.positions || []);
            setClosedPositions(closed.positions || []);
        } catch {
            // positions panel silently keeps its last-known state on a transient failure
        }
    }, [token]);

    useEffect(() => {
        if (token) { loadWallet(); loadPositions(); }
        else setLoading(false);
    }, [token, loadWallet, loadPositions]);

    useEffect(() => {
        if (!token) return;
        positionsPollRef.current = setInterval(loadPositions, POSITIONS_POLL_MS);
        return () => clearInterval(positionsPollRef.current);
    }, [token, loadPositions]);

    async function runCheckout({ createOrder, verifyPayment, description, onDone }) {
        setError(null);
        try {
            const Razorpay = await loadRazorpayCheckout();
            const order = await createOrder(token);
            const rzp = new Razorpay({
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                order_id: order.orderId,
                name: "Bazaar Sync",
                description,
                handler: async (response) => {
                    try {
                        await verifyPayment(token, {
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        });
                        await onDone();
                    } catch (err) {
                        setError(err.message);
                    } finally {
                        setBusy(null);
                    }
                },
                modal: { ondismiss: () => setBusy(null) },
                theme: { color: GREEN },
            });
            rzp.on("payment.failed", (resp) => {
                setError(resp.error?.description || "Payment failed");
                setBusy(null);
            });
            rzp.open();
        } catch (err) {
            setError(err.message);
            setBusy(null);
        }
    }

    function buyPro() {
        setBusy("pro");
        runCheckout({
            createOrder: createProOrder,
            verifyPayment: verifyProPayment,
            description: "Pro membership — ₹499/mo",
            onDone: async () => {
                await refreshUser();
                await loadWallet();
            },
        });
    }

    function buyRefill() {
        setBusy("refill");
        runCheckout({
            createOrder: createRefillOrder,
            verifyPayment: verifyRefillPayment,
            description: "Paper capital refill — ₹5,00,000",
            onDone: loadWallet,
        });
    }

    async function handleTrade(strike, optRight, lots, side) {
        setError(null);
        try {
            await openPosition(token, { symbol, expiry: data.selectedExpiry, strike, optRight, lots, side });
            await Promise.all([loadWallet(), loadPositions()]);
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleClose(id) {
        setError(null);
        setClosingId(id);
        try {
            await closePosition(token, id);
            await Promise.all([loadWallet(), loadPositions()]);
        } catch (err) {
            setError(err.message);
        } finally {
            setClosingId(null);
        }
    }

    async function handleCloseAll() {
        setError(null);
        setClosingAll(true);
        try {
            const results = await Promise.allSettled(positions.map((p) => closePosition(token, p.id)));
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed) setError(`${failed} position(s) failed to close — try again.`);
            await Promise.all([loadWallet(), loadPositions()]);
        } finally {
            setClosingAll(false);
        }
    }

    // Real ledger-derived equity trend for the sparkline — cumulative
    // wallet balance over recent transactions, not a fabricated curve.
    const equitySeries = useMemo(() => {
        if (!wallet?.ledger?.length) return [];
        return [...wallet.ledger].reverse().map((row, i) => ({ i, balance: Number(row.balance_after) }));
    }, [wallet]);

    const totalGranted = useMemo(() => {
        if (!wallet?.ledger?.length) return 0;
        return wallet.ledger
            .filter((r) => CAPITAL_GRANT_TYPES.has(r.type))
            .reduce((sum, r) => sum + Number(r.amount), 0);
    }, [wallet]);

    const openUnrealized = useMemo(
        () => positions.reduce((sum, p) => sum + (p.unrealizedPnl != null ? Number(p.unrealizedPnl) : 0), 0),
        [positions]
    );

    // Equity = cash balance + mark-to-market value of what's still open
    // (cost/margin for open positions already left the cash balance).
    const totalPnl = wallet ? wallet.balance + openUnrealized - totalGranted : null;
    const totalPnlPct = wallet && totalGranted > 0 ? (totalPnl / totalGranted) * 100 : null;

    const todaysPnl = useMemo(() => {
        const fromOpen = positions
            .filter((p) => isToday(p.entry_time))
            .reduce((sum, p) => sum + (p.unrealizedPnl != null ? Number(p.unrealizedPnl) : 0), 0);
        const fromClosed = closedPositions
            .filter((p) => isToday(p.exit_time))
            .reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0);
        return fromOpen + fromClosed;
    }, [positions, closedPositions]);

    const winRate = closedPositions.length
        ? (closedPositions.filter((p) => Number(p.realized_pnl) > 0).length / closedPositions.length) * 100
        : null;

    const capitalDeployed = useMemo(
        () =>
            positions.reduce((sum, p) => {
                if (p.side === "short") return sum + Number(p.margin_blocked || 0);
                return sum + Number(p.entry_price) * p.lots * p.lot_size;
            }, 0),
        [positions]
    );

    if (loading) {
        return (
            <div className="flex min-h-[calc(100vh-57px)] items-center justify-center text-sm" style={{ background: BG, color: MUTED }}>
                Loading…
            </div>
        );
    }

    // Only NIFTY/BANKNIFTY/FINNIFTY are worker-subscribed and can actually
    // execute (paperPositionService.getLiveContractPrice throws for anything
    // else) — the picker below now lists ~280 symbols for browsing (matches
    // OptionChain.jsx), but trading itself stays scoped to the 3 live ones.
    const isLiveSymbol = symbolList.liveSymbols.includes(symbol);
    const canTrade = !!user && wallet?.accessAllowed && marketStatus?.isOpen && isLiveSymbol && !!data?.rows?.length;
    const goToLogin = () => navigate("/login");

    return (
        <div className="min-h-[calc(100vh-57px)] w-full" style={{ background: BG, color: TEXT }}>
            <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6">
                {/* Header strip */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-baseline gap-1 text-sm font-bold">
                            
                            <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Paper Trading</span>
                        </div>
                        <SymbolPicker symbol={symbol} symbolList={symbolList} onPick={setSymbol} />
                        {data && (
                            <div className="flex items-baseline gap-1.5 text-sm">
                                <span className="font-bold tabular-nums">{formatPrice(data.spotPrice)}</span>
                                <span className="tabular-nums" style={{ color: pnlColor(data.spotChange) }}>
                                    {data.spotChange != null ? `${data.spotChange >= 0 ? "▲" : "▼"} ${formatPrice(Math.abs(data.spotChange))} (${formatPercent(data.spotChangePercent)})` : ""}
                                </span>
                            </div>
                        )}
                        {data?.vix != null && (
                            <div className="text-xs" style={{ color: MUTED }}>VIX <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{formatPrice(data.vix)}</span></div>
                        )}
                        {data?.futurePrice != null && (
                            <div className="text-xs" style={{ color: MUTED }}>FUT <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{formatPrice(data.futurePrice)}</span></div>
                        )}
                    </div>

                    {wallet && (
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="text-right">
                                <div className="text-[10px] uppercase tracking-wide" style={{ color: MUTED }}>Balance</div>
                                <div className="text-sm font-bold tabular-nums">{formatRupees(wallet.balance)}</div>
                            </div>
                            {wallet.isPro ? (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "rgba(245,166,35,0.15)", color: AMBER }}>Pro</span>
                            ) : wallet.trialActive ? (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "rgba(11,229,92,0.15)", color: GREEN }}>{timeLeft(wallet.trialExpiresAt)}</span>
                            ) : (
                                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: "rgba(235,9,11,0.15)", color: RED }}>Trial ended</span>
                            )}
                            {!wallet.isPro && (
                                <button
                                    onClick={buyPro}
                                    disabled={busy === "pro"}
                                    className="rounded-lg px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90 disabled:opacity-50"
                                    style={{ background: GREEN }}
                                >
                                    {busy === "pro" ? "Opening…" : "Get Pro — ₹499/mo"}
                                </button>
                            )}
                            {wallet.isPro && (
                                <button
                                    onClick={buyRefill}
                                    disabled={busy === "refill"}
                                    className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                                    style={{ border: `1px solid ${GREEN}`, color: GREEN }}
                                >
                                    {busy === "refill" ? "Opening…" : "Refill ₹5L — ₹100"}
                                </button>
                            )}
                        </div>
                    )}
                    {!wallet && !user && (
                        <button
                            onClick={goToLogin}
                            className="rounded-lg px-4 py-1.5 text-xs font-semibold text-black hover:opacity-90"
                            style={{ background: GREEN }}
                        >
                            Log in to start your 2-day free trial
                        </button>
                    )}
                </div>

                {error && (
                    <div className="mt-3 rounded-lg px-4 py-2 text-sm" style={{ background: "rgba(235,9,11,0.1)", border: `1px solid ${RED}`, color: "#ff8f90" }}>
                        {error}
                    </div>
                )}

                {wallet && !wallet.accessAllowed && (
                    <div className="mt-3 rounded-full px-4 py-1.5 text-center text-xs font-semibold" style={{ background: "rgba(245,166,35,0.12)", color: AMBER }}>
                        Get Pro above to keep trading — your free trial has ended.
                    </div>
                )}

                {!marketStatus?.isOpen && (
                    <div className="mt-3 rounded-lg px-4 py-2 text-xs" style={{ background: "rgba(245,166,35,0.1)", border: `1px solid ${AMBER}`, color: AMBER }}>
                        Market is closed — buying/selling requires live market data, so it's disabled until the next session.
                    </div>
                )}

                {marketStatus?.isOpen && !isLiveSymbol && (
                    <div className="mt-3 rounded-lg px-4 py-2 text-xs" style={{ background: "rgba(245,166,35,0.1)", border: `1px solid ${AMBER}`, color: AMBER }}>
                        {symbol} isn't live-streamed yet — only NIFTY, BANKNIFTY and FINNIFTY support paper trading right now. Showing {symbol}'s latest stored chain for reference.
                    </div>
                )}

                {/* Main grid */}
                <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                    {/* Left: option chain */}
                    <div className="rounded-xl lg:col-span-2" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: BORDER }}>
                            <div className="flex items-center gap-2">
                                <span className="rounded-md px-3 py-1 text-xs font-semibold" style={{ background: SURFACE_2, color: TEXT, border: `1px solid ${BORDER}` }}>Option Chain</span>
                                {data && <span className="text-xs" style={{ color: MUTED }}>Lot size {data.lotSize ?? "-"}</span>}
                            </div>
                            {data?.expiries?.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {/* Only the nearest (selected) expiry is ever live-tradeable (Gotcha
                                        #9/#14) — showing the full multi-year expiry list here would just
                                        be clutter, so this trims to a handful of near-term dates. */}
                                    {data.expiries.slice(0, 8).map((exp) => (
                                        <button
                                            key={exp}
                                            disabled
                                            title={exp === data.selectedExpiry ? "Currently selected — live" : "Only the nearest expiry is tradeable live"}
                                            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                                            style={
                                                exp === data.selectedExpiry
                                                    ? { background: GREEN, color: "#031a0d" }
                                                    : { background: SURFACE_2, color: MUTED, border: `1px solid ${BORDER}` }
                                            }
                                        >
                                            {exp}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr style={{ color: MUTED }}>
                                        <th className="px-3 py-2 text-right font-medium">OI</th>
                                        <th className="px-3 py-2 text-right font-medium">Volume</th>
                                        <th className="px-3 py-2 text-right font-medium">IV</th>
                                        <th className="px-3 py-2 text-right font-medium">LTP</th>
                                        <th className="px-3 py-2 text-center font-semibold" style={{ color: TEXT }}>Strike</th>
                                        <th className="px-3 py-2 text-left font-medium">LTP</th>
                                        <th className="px-3 py-2 text-left font-medium">IV</th>
                                        <th className="px-3 py-2 text-left font-medium">Volume</th>
                                        <th className="px-3 py-2 text-left font-medium">OI</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(data?.rows || []).map((row) => {
                                        const isAtm = row.strike === data.atmStrike;
                                        return (
                                            <tr
                                                key={row.strike}
                                                className="border-t"
                                                style={{ ...(isAtm ? { background: "rgba(11,229,92,0.06)" } : {}), borderColor: BORDER }}
                                            >
                                                <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: MUTED }}>{formatOi(row.ce?.oi)}</td>
                                                <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: MUTED }}>{formatOi(row.ce?.volume)}</td>
                                                <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: MUTED }}>{row.ce?.iv != null ? `${Number(row.ce.iv).toFixed(1)}%` : "-"}</td>
                                                <td className="px-3 py-1.5">
                                                    <TradeCell strike={row.strike} optRight="CE" side={row.ce} loggedIn={!!user} canTrade={canTrade} onTrade={handleTrade} onLoginRequired={goToLogin} />
                                                </td>
                                                <td className="px-3 py-1.5 text-center font-semibold tabular-nums" style={{ color: isAtm ? GREEN : TEXT }}>{row.strike}</td>
                                                <td className="px-3 py-1.5">
                                                    <TradeCell strike={row.strike} optRight="PE" side={row.pe} loggedIn={!!user} canTrade={canTrade} onTrade={handleTrade} onLoginRequired={goToLogin} />
                                                </td>
                                                <td className="px-3 py-1.5 text-left tabular-nums" style={{ color: MUTED }}>{row.pe?.iv != null ? `${Number(row.pe.iv).toFixed(1)}%` : "-"}</td>
                                                <td className="px-3 py-1.5 text-left tabular-nums" style={{ color: MUTED }}>{formatOi(row.pe?.volume)}</td>
                                                <td className="px-3 py-1.5 text-left tabular-nums" style={{ color: MUTED }}>{formatOi(row.pe?.oi)}</td>
                                            </tr>
                                        );
                                    })}
                                    {!data?.rows?.length && (
                                        <tr><td colSpan={9} className="px-3 py-8 text-center text-sm" style={{ color: MUTED }}>No chain data.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                        <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2 text-[11px]" style={{ borderColor: BORDER, color: MUTED }}>
                            <span>Underlying: <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{formatPrice(data?.spotPrice)}</span></span>
                            <span>Max Pain: <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{data?.maxPainStrike ?? "-"}</span></span>
                            <span>PCR: <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{data?.pcr ?? "-"}</span></span>
                        </div>
                    </div>

                    {/* Right: P&L + positions */}
                    <div className="flex flex-col gap-4">
                        {!user ? (
                            <div className="rounded-xl p-6 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                                <div className="text-sm font-bold" style={{ color: TEXT }}>Paper Trading P&L</div>
                                <p className="mt-2 text-xs" style={{ color: MUTED }}>
                                    Log in to start your 2-day free trial (₹50,000 virtual capital) and track real-time P&L and positions here.
                                </p>
                                <button
                                    onClick={goToLogin}
                                    className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold text-black hover:opacity-90"
                                    style={{ background: GREEN }}
                                >
                                    Log in to trade
                                </button>
                            </div>
                        ) : (
                            <>
                        <div className="rounded-xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                            <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Paper Trading P&L</div>
                            <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: pnlColor(totalPnl) }}>
                                {totalPnl != null ? formatRupees(totalPnl) : "—"}
                            </div>
                            {totalPnlPct != null && (
                                <div className="text-xs font-semibold tabular-nums" style={{ color: pnlColor(totalPnl) }}>{formatPercent(totalPnlPct)}</div>
                            )}
                            {equitySeries.length > 1 && (
                                <div className="mt-2 h-16">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={equitySeries} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                                            <defs>
                                                <linearGradient id="ptEquity" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.4} />
                                                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <Tooltip
                                                contentStyle={{ background: SURFACE_2, border: `1px solid ${BORDER}`, borderRadius: 8, fontSize: 11 }}
                                                labelFormatter={() => ""}
                                                formatter={(v) => [formatRupees(v), "Balance"]}
                                            />
                                            <Area type="monotone" dataKey="balance" stroke={GREEN} strokeWidth={2} fill="url(#ptEquity)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <StatTile label="Total P&L" value={totalPnl != null ? formatRupees(totalPnl) : "—"} valueColor={pnlColor(totalPnl)} />
                            <StatTile label="Today's P&L" value={formatRupees(todaysPnl)} valueColor={pnlColor(todaysPnl)} />
                            <StatTile label="Win Rate" value={winRate != null ? `${winRate.toFixed(0)}%` : "—"} />
                            <StatTile label="Capital Deployed" value={formatRupees(capitalDeployed)} />
                        </div>

                        <div className="rounded-xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-bold">Positions ({positions.length})</h2>
                                {positions.length > 0 && (
                                    <button
                                        onClick={handleCloseAll}
                                        disabled={closingAll}
                                        className="rounded-full px-2.5 py-1 text-[11px] font-semibold hover:opacity-90 disabled:opacity-50"
                                        style={{ border: `1px solid ${RED}`, color: RED }}
                                    >
                                        {closingAll ? "Closing…" : "Close All"}
                                    </button>
                                )}
                            </div>
                            {positions.length ? (
                                <div className="mt-3 space-y-2">
                                    {positions.map((p) => (
                                        <div key={p.id} className="flex items-center justify-between rounded-lg px-3 py-2 text-xs" style={{ background: SURFACE_2, border: `1px solid ${BORDER}` }}>
                                            <div>
                                                <div className="font-semibold" style={{ color: TEXT }}>
                                                    {p.symbol} {p.strike}{p.opt_right}
                                                    <span className="ml-1 rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: p.side === "short" ? "rgba(235,9,11,0.15)" : "rgba(11,229,92,0.15)", color: p.side === "short" ? RED : GREEN }}>
                                                        {p.side === "short" ? "Short" : "Long"}
                                                    </span>
                                                </div>
                                                <div style={{ color: MUTED }}>Qty {p.lots} · Entry {formatPrice(p.entry_price)} · LTP {p.livePrice != null ? formatPrice(p.livePrice) : "—"}</div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="font-semibold tabular-nums" style={{ color: pnlColor(p.unrealizedPnl) }}>
                                                    {p.unrealizedPnl != null ? formatRupees(p.unrealizedPnl) : "unavailable"}
                                                </span>
                                                <button
                                                    onClick={() => handleClose(p.id)}
                                                    disabled={closingId === p.id}
                                                    className="rounded px-2 py-1 text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                                    style={{ background: RED }}
                                                >
                                                    {closingId === p.id ? "…" : "Close"}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="mt-3 text-sm" style={{ color: MUTED }}>No open positions.</p>
                            )}
                        </div>
                            </>
                        )}
                    </div>
                </div>

                {/* Recent activity */}
                <div className="mt-4 rounded-xl p-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
                    <h2 className="mb-2 text-sm font-bold">Recent activity</h2>
                    {wallet?.ledger?.length ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr style={{ color: MUTED }}>
                                        <th className="px-3 py-2 font-medium">When</th>
                                        <th className="px-3 py-2 font-medium">Type</th>
                                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                                        <th className="px-3 py-2 text-right font-medium">Balance after</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {wallet.ledger.map((row, i) => (
                                        <tr key={i} className="border-t" style={{ borderColor: BORDER }}>
                                            <td className="px-3 py-2" style={{ color: MUTED }}>{formatDateTime(row.created_at)}</td>
                                            <td className="px-3 py-2" style={{ color: TEXT }}>{LEDGER_LABELS[row.type] || row.type}</td>
                                            <td className="px-3 py-2 text-right tabular-nums" style={{ color: pnlColor(Number(row.amount)) }}>
                                                {Number(row.amount) >= 0 ? "+" : ""}{formatRupees(row.amount)}
                                            </td>
                                            <td className="px-3 py-2 text-right tabular-nums" style={{ color: MUTED }}>{formatRupees(row.balance_after)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-sm" style={{ color: MUTED }}>No activity yet.</p>
                    )}
                </div>
            </div>
        </div>
    );
}
