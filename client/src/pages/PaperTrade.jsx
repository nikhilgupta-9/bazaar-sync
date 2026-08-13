// pages/PaperTrade.jsx — wallet + Pro-subscription purchase UI (Phase 8.2)
// plus the real order-placement engine (Phase 8.3). BUY only (long CE/PE)
// — no margin computation exists anywhere in this codebase, so selling/
// writing options stays out of scope until that exists.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useOptionChain } from "../hooks/useOptionChain";
import { fetchWallet, createRefillOrder, verifyRefillPayment, fetchPositions, openPosition, closePosition } from "../services/paperTradeApi";
import { createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";
import { formatRupees, formatPrice, formatDateTime } from "../utils/format";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
const POSITIONS_POLL_MS = 12000;

const LEDGER_LABELS = {
    trial_grant: "Free trial grant",
    pro_purchase_grant: "Pro membership purchase",
    refill_purchase: "Paper capital refill",
    trade_debit: "Bought option",
    trade_credit: "Closed option",
};

function timeLeft(untilIso) {
    const ms = new Date(untilIso).getTime() - Date.now();
    if (ms <= 0) return "expired";
    const hours = Math.floor(ms / 3_600_000);
    const days = Math.floor(hours / 24);
    if (days >= 1) return `${days}d ${hours % 24}h left`;
    return `${hours}h left`;
}

function BuyCell({ strike, optRight, side, canTrade, onBuy }) {
    const [draftOpen, setDraftOpen] = useState(false);
    const [lots, setLots] = useState(1);

    if (!side || side.ltp == null) return <span className="text-gray-300">-</span>;

    if (draftOpen) {
        return (
            <div className="flex items-center justify-end gap-1">
                <button
                    onClick={() => setLots((l) => Math.max(1, l - 1))}
                    className="h-5 w-5 rounded border border-gray-300 text-xs leading-none text-gray-500 hover:bg-gray-50"
                >
                    −
                </button>
                <span className="w-5 text-center text-xs">{lots}</span>
                <button
                    onClick={() => setLots((l) => Math.min(100, l + 1))}
                    className="h-5 w-5 rounded border border-gray-300 text-xs leading-none text-gray-500 hover:bg-gray-50"
                >
                    +
                </button>
                <button
                    onClick={() => { onBuy(strike, optRight, lots); setDraftOpen(false); setLots(1); }}
                    className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-emerald-700"
                >
                    Buy
                </button>
                <button onClick={() => setDraftOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
            </div>
        );
    }

    return (
        <div className="group relative text-right">
            <span className="group-hover:invisible">{formatPrice(side.ltp)}</span>
            {canTrade && (
                <button
                    onClick={() => setDraftOpen(true)}
                    className="invisible absolute inset-y-0 right-0 rounded bg-emerald-600 px-2 text-[11px] font-semibold text-white group-hover:visible hover:bg-emerald-700"
                >
                    Buy
                </button>
            )}
        </div>
    );
}

export default function PaperTrade() {
    const { user, token, refreshUser } = useAuth();
    const navigate = useNavigate();
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null); // 'pro' | 'refill' | null
    const [positions, setPositions] = useState([]);
    const [closingId, setClosingId] = useState(null);

    const { symbol, setSymbol, data, marketStatus } = useOptionChain(SYMBOLS[0]);
    const positionsPollRef = useRef(null);

    const loadWallet = useCallback(async () => {
        try {
            const data = await fetchWallet(token);
            setWallet(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    const loadPositions = useCallback(async () => {
        try {
            const r = await fetchPositions(token, "open");
            setPositions(r.positions || []);
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
                theme: { color: "#2563eb" },
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

    async function handleBuy(strike, optRight, lots) {
        setError(null);
        try {
            await openPosition(token, { symbol, expiry: data.selectedExpiry, strike, optRight, lots });
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

    if (!user) {
        return (
            <div className="mx-auto max-w-3xl px-6 py-16 text-center">
                <h1 className="text-xl font-bold text-gray-900">Paper Trade</h1>
                <p className="mt-2 text-sm text-gray-500">
                    Trade with virtual capital on our real historical options data — no real money at risk.
                </p>
                <button
                    onClick={() => navigate("/login")}
                    className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                    Log in to start your free trial
                </button>
            </div>
        );
    }

    if (loading) {
        return <div className="mx-auto max-w-3xl px-6 py-16 text-center text-sm text-gray-500">Loading…</div>;
    }

    const canTrade = wallet?.accessAllowed && marketStatus?.isOpen && !!data?.rows?.length;

    return (
        <div className="mx-auto max-w-5xl px-6 py-10">
            <h1 className="text-xl font-bold text-gray-900">Paper Trade</h1>
            <p className="mt-1 text-sm text-gray-500">
                Trade with virtual capital on our real historical options data — no real money at risk.
            </p>

            {error && (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>
            )}

            {wallet && (
                <>
                    <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Paper balance</div>
                        <div className="mt-1 text-3xl font-bold text-gray-900">{formatRupees(wallet.balance)}</div>

                        {wallet.isPro ? (
                            <div className="mt-3 flex items-center gap-2 text-sm">
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">Pro</span>
                                <span className="text-gray-500">
                                    Active until {formatDateTime(wallet.proExpiresAt)}
                                </span>
                            </div>
                        ) : wallet.trialActive ? (
                            <div className="mt-3 flex items-center gap-2 text-sm">
                                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-700">Trial</span>
                                <span className="text-gray-500">{timeLeft(wallet.trialExpiresAt)}</span>
                            </div>
                        ) : (
                            <div className="mt-3 text-sm text-rose-600">Your free trial has ended.</div>
                        )}

                        <div className="mt-5 flex flex-wrap gap-3">
                            {!wallet.isPro && (
                                <button
                                    onClick={buyPro}
                                    disabled={busy === "pro"}
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {busy === "pro" ? "Opening checkout…" : "Get Pro — ₹499/mo"}
                                </button>
                            )}
                            {wallet.isPro && (
                                <button
                                    onClick={buyRefill}
                                    disabled={busy === "refill"}
                                    className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                                >
                                    {busy === "refill" ? "Opening checkout…" : "Buy ₹5,00,000 refill — ₹100"}
                                </button>
                            )}
                        </div>
                        {!wallet.isPro && (
                            <p className="mt-2 text-xs text-gray-400">
                                Pro also unlocks Strategy Builder save, Backtesting, and full history — one subscription.
                            </p>
                        )}
                    </div>

                    {wallet.accessAllowed ? (
                        <>
                            <div className="mt-8 flex items-center gap-2">
                                {SYMBOLS.map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => setSymbol(s)}
                                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                            symbol === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                        }`}
                                    >
                                        {s}
                                    </button>
                                ))}
                                {data && (
                                    <span className="ml-2 text-xs text-gray-400">
                                        Spot {formatPrice(data.spotPrice)} · Expiry {data.selectedExpiry}
                                    </span>
                                )}
                            </div>

                            {!marketStatus?.isOpen && (
                                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
                                    Market is closed — buying requires live market data, so it's disabled until the next session.
                                </div>
                            )}

                            <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                        <tr>
                                            <th className="px-4 py-2 text-right">CE LTP</th>
                                            <th className="px-4 py-2 text-center">Strike</th>
                                            <th className="px-4 py-2 text-left">PE LTP</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {(data?.rows || []).map((row) => (
                                            <tr key={row.strike} className={row.strike === data.atmStrike ? "bg-blue-50/40" : ""}>
                                                <td className="px-4 py-1.5">
                                                    <BuyCell strike={row.strike} optRight="CE" side={row.ce} canTrade={canTrade} onBuy={handleBuy} />
                                                </td>
                                                <td className="px-4 py-1.5 text-center font-medium text-gray-700">{row.strike}</td>
                                                <td className="px-4 py-1.5">
                                                    <BuyCell strike={row.strike} optRight="PE" side={row.pe} canTrade={canTrade} onBuy={handleBuy} />
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="mt-8">
                                <h2 className="mb-2 text-sm font-bold text-gray-900">Open positions</h2>
                                {positions.length ? (
                                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                                <tr>
                                                    <th className="px-4 py-2">Contract</th>
                                                    <th className="px-4 py-2 text-right">Lots</th>
                                                    <th className="px-4 py-2 text-right">Entry</th>
                                                    <th className="px-4 py-2 text-right">LTP</th>
                                                    <th className="px-4 py-2 text-right">Unrealized P&L</th>
                                                    <th className="px-4 py-2 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {positions.map((p) => (
                                                    <tr key={p.id}>
                                                        <td className="px-4 py-2 text-gray-900">{p.symbol} {p.strike}{p.opt_right}</td>
                                                        <td className="px-4 py-2 text-right text-gray-500">{p.lots}</td>
                                                        <td className="px-4 py-2 text-right text-gray-500">{formatPrice(p.entry_price)}</td>
                                                        <td className="px-4 py-2 text-right text-gray-500">
                                                            {p.livePrice != null ? formatPrice(p.livePrice) : "—"}
                                                        </td>
                                                        <td className={`px-4 py-2 text-right font-medium ${
                                                            p.unrealizedPnl == null ? "text-gray-400" : p.unrealizedPnl >= 0 ? "text-emerald-600" : "text-rose-600"
                                                        }`}>
                                                            {p.unrealizedPnl != null ? formatRupees(p.unrealizedPnl) : "unavailable"}
                                                        </td>
                                                        <td className="px-4 py-2 text-right">
                                                            <button
                                                                onClick={() => handleClose(p.id)}
                                                                disabled={closingId === p.id}
                                                                className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                                            >
                                                                {closingId === p.id ? "Closing…" : "Close"}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-400">No open positions.</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="mt-6 rounded-full bg-amber-100 px-4 py-1.5 text-center text-xs font-semibold text-amber-700">
                            Get Pro above to keep trading — your free trial has ended.
                        </div>
                    )}

                    <div className="mt-8">
                        <h2 className="mb-2 text-sm font-bold text-gray-900">Recent activity</h2>
                        {wallet.ledger?.length ? (
                            <div className="overflow-x-auto rounded-lg border border-gray-200">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                                        <tr>
                                            <th className="px-4 py-2">When</th>
                                            <th className="px-4 py-2">Type</th>
                                            <th className="px-4 py-2 text-right">Amount</th>
                                            <th className="px-4 py-2 text-right">Balance after</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {wallet.ledger.map((row, i) => (
                                            <tr key={i}>
                                                <td className="px-4 py-2 text-gray-500">{formatDateTime(row.created_at)}</td>
                                                <td className="px-4 py-2 text-gray-900">{LEDGER_LABELS[row.type] || row.type}</td>
                                                <td className={`px-4 py-2 text-right ${Number(row.amount) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                    {Number(row.amount) >= 0 ? "+" : ""}{formatRupees(row.amount)}
                                                </td>
                                                <td className="px-4 py-2 text-right text-gray-500">{formatRupees(row.balance_after)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-sm text-gray-400">No activity yet.</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
