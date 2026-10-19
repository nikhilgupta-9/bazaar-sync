import React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { openPosition, openStrategyTrade } from "../../services/paperTradeApi";

export default function PaperExecuteModal({ isOpen, onClose, symbol, legs, lotSize, strategyName, requiredFunds = null, requiredMargin = null }) {
    const { token, user } = useAuth();
    const [executing, setExecuting] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    if (!isOpen) return null;

    async function handleExecute() {
        if (!token) {
            setError("Please log in to execute virtual paper trades.");
            return;
        }

        setExecuting(true);
        setError(null);
        setResult(null);

        const successes = [];
        const failures = [];

        if (legs.length > 1) {
            try {
                const res = await openStrategyTrade(token, {
                    symbol: symbol.toUpperCase(),
                    expiry: legs[0]?.expiry,
                    strategyName: strategyName || `${symbol.toUpperCase()} Strategy`,
                    requiredFunds: requiredFunds,
                    requiredMargin: requiredMargin != null ? requiredMargin : requiredFunds,
                    legs: legs.map((l) => ({
                        optRight: l.type,
                        strike: l.strike,
                        side: l.action === "buy" ? "long" : "short",
                        lots: l.qty,
                        expiry: l.expiry,
                        entry_price: l.premium,
                        ltp: l.premium,
                        lot_size: l.lotSize || lotSize,
                    })),
                });
                successes.push({ leg: { label: `${legs.length} Legs Basket` }, res });
            } catch (err) {
                failures.push({ leg: { label: `${legs.length} Legs Basket` }, error: err.message || "Failed to execute strategy" });
            }
        } else {
            for (const leg of legs) {
                try {
                    const side = leg.action === "buy" ? "long" : "short";
                    const res = await openPosition(token, {
                        symbol: symbol.toUpperCase(),
                        expiry: leg.expiry,
                        strike: leg.strike,
                        optRight: leg.type,
                        lots: leg.qty,
                        side,
                        price: leg.premium,
                        ltp: leg.premium,
                    });
                    successes.push({ leg, res });
                } catch (err) {
                    failures.push({ leg, error: err.message || "Failed to execute leg" });
                }
            }
        }

        setExecuting(false);
        setResult({ successes, failures });
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3 dark:border-gray-800">
                    <div>
                        <h3 className="text-base font-bold text-gray-900 dark:text-white">Execute in Paper Trading</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Place multi-leg strategy basket into your virtual account</p>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={executing}
                        className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                        ✕
                    </button>
                </div>

                {!result ? (
                    <div className="mt-4 space-y-4">
                        <div className="rounded-xl bg-gray-50 p-3.5 dark:bg-gray-800/50">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                                Strategy Basket ({legs.length} legs) — {symbol}
                            </div>
                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {legs.map((leg, idx) => (
                                    <div
                                        key={leg.id || idx}
                                        className="flex items-center justify-between text-xs py-1 px-2 rounded bg-white dark:bg-gray-800 border border-gray-200/60 dark:border-gray-700"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${
                                                    leg.action === "buy" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                                                }`}
                                            >
                                                {leg.action.toUpperCase()}
                                            </span>
                                            <span className="font-semibold text-gray-800 dark:text-gray-200">
                                                {leg.strike} {leg.type}
                                            </span>
                                            <span className="text-gray-400">({leg.expiry})</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-gray-500">{leg.qty} {leg.qty === 1 ? "lot" : "lots"} ({leg.qty * (leg.lotSize || lotSize || 1)} qty)</span>
                                            <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                                                ₹{leg.premium != null ? leg.premium.toFixed(2) : "—"}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {(requiredFunds != null || requiredMargin != null) && (
                                <div className="mt-3 pt-2.5 border-t border-gray-200 dark:border-gray-700/60 flex items-center justify-between text-xs">
                                    <div>
                                        <span className="text-gray-500 font-semibold">Funds Required: </span>
                                        <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                            ₹{Math.round(requiredFunds || 0).toLocaleString("en-IN")}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-gray-500 font-semibold">Est. Margin: </span>
                                        <span className="font-bold text-gray-900 dark:text-white tabular-nums">
                                            {requiredMargin === 0 ? "Not required" : `₹${Math.round(requiredMargin || 0).toLocaleString("en-IN")}`}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700 border border-rose-200 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-400">
                                {error}
                            </div>
                        )}

                        {!user && (
                            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 border border-amber-200 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-400">
                                You need to be logged in to trade with your virtual wallet.{" "}
                                <Link to="/login" className="font-bold underline">
                                    Login here
                                </Link>
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={executing}
                                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleExecute}
                                disabled={executing || !user}
                                className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
                            >
                                {executing ? (
                                    <>
                                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                        Executing Orders...
                                    </>
                                ) : (
                                    `Execute ${legs.length} Orders`
                                )}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="mt-4 space-y-4">
                        <div className="rounded-xl bg-emerald-50 p-4 border border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-300">
                            <div className="font-bold text-sm mb-1">Orders Submitted!</div>
                            <div className="text-xs">
                                Successfully executed {result.successes.length} of {legs.length} orders in your virtual paper wallet.
                            </div>
                        </div>

                        {result.failures.length > 0 && (
                            <div className="rounded-xl bg-rose-50 p-3 border border-rose-200 text-xs text-rose-800 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-300">
                                <div className="font-bold mb-1">Failed legs ({result.failures.length}):</div>
                                <ul className="list-disc pl-4 space-y-0.5">
                                    {result.failures.map((f, i) => (
                                        <li key={i}>
                                            {f.leg.strike} {f.leg.type} ({f.leg.action.toUpperCase()}): {f.error}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="flex items-center justify-between pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-xl border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300"
                            >
                                Close
                            </button>
                            <Link
                                to="/paper-trade"
                                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700"
                            >
                                View Open Positions →
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
