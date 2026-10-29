import React from "react";

// components/strategy/PortfolioGreeksTable.jsx
//
// Per-leg Lots/Qty/Expiry/Strike/IV/Δ/Θ/Γ/Vega table plus a "Net Risk
// Aggregates" summary row, shared by Strategy Builder, Simulator, and Paper
// Trade. Column set and order (Action, Lots, Qty, Expiry, Strike, IV, Delta,
// Theta, Gamma, Vega) matches stockmojo.in's Greeks tab — Lots and Qty are
// shown as separate columns there (Qty = lots * lotSize), not merged.
// `netGreeks` is computed by the caller (utils/payoff.js's computeNetGreeks,
// over the *active* legs) — the per-leg rows show every leg regardless of
// its include-in-payoff checkbox.

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatExpiryShort(sqlDate) {
    if (!sqlDate) return "-";
    const [, m, d] = String(sqlDate).split("-").map(Number);
    if (!m || !d) return "-";
    return `${d} ${MONTHS_SHORT[m - 1]}`;
}

export default function PortfolioGreeksTable({ legs, netGreeks }) {
    return (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-xs">
            <thead>
                <tr className="text-gray-400 dark:text-gray-400 bg-gray-50/40 dark:bg-[#070e17] border-b border-gray-200 dark:border-white/10">
                    <th className="px-2 py-2.5 w-8"></th>
                    <th className="px-3 py-2.5 text-center font-bold uppercase tracking-wider text-[10px]">Lots</th>
                    <th className="px-3 py-2.5 text-center font-bold uppercase tracking-wider text-[10px]">Qty</th>
                    <th className="px-3 py-2.5 text-left font-bold uppercase tracking-wider text-[10px]">Expiry</th>
                    <th className="px-3 py-2.5 text-center font-bold uppercase tracking-wider text-[10px]">Strike</th>
                    <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">IV</th>
                    <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Delta</th>
                    <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Theta</th>
                    <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Gamma</th>
                    <th className="px-3 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Vega</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                {legs.map((leg) => {
                    const qty = leg.qty * (leg.lotSize || 1);
                    return (
                        <tr key={leg.id} className="hover:bg-gray-50/40 dark:hover:bg-white/5 transition-colors">
                            <td className="px-2 py-2.5 text-center">
                                <span className={`inline-block w-5 text-center rounded text-[10px] font-black text-white ${leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"}`}>
                                    {leg.action === "buy" ? "B" : "S"}
                                </span>
                            </td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-gray-700 dark:text-gray-300 font-semibold">{leg.qty}</td>
                            <td className="px-3 py-2.5 text-center tabular-nums text-gray-600 dark:text-gray-400 font-mono">{qty}</td>
                            <td className="px-3 py-2.5 text-left text-gray-700 dark:text-gray-300 font-semibold whitespace-nowrap">{formatExpiryShort(leg.expiry)}</td>
                            <td className="px-3 py-2.5 text-center font-bold text-gray-800 dark:text-gray-200">
                                {leg.strike} <span className={leg.type === "CE" ? "text-emerald-600 dark:text-emerald-400" : "text-purple-600 dark:text-purple-400"}>{leg.type}</span>
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.iv != null ? `${leg.iv}%` : "-"}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.delta ?? "-"}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.theta ?? "-"}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.gamma ?? "-"}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.vega ?? "-"}</td>
                        </tr>
                    );
                })}
                {netGreeks && (
                    <tr className="font-bold bg-emerald-50/30 dark:bg-emerald-950/20 border-t-2 border-gray-200 dark:border-white/10 text-gray-900 dark:text-gray-100">
                        <td className="px-2 py-3"></td>
                        <td colSpan={4} className="px-3 py-3 text-emerald-700 dark:text-emerald-400 font-black">Net Risk Aggregates</td>
                        <td className="px-3 py-3"></td>
                        <td className="px-3 py-3 text-right tabular-nums font-mono text-emerald-600 dark:text-emerald-400 font-bold">{(netGreeks.delta || 0).toFixed(3)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-mono text-emerald-600 dark:text-emerald-400 font-bold">{(netGreeks.theta || 0).toFixed(3)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-mono text-emerald-600 dark:text-emerald-400 font-bold">{(netGreeks.gamma || 0).toFixed(6)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-mono text-emerald-600 dark:text-emerald-400 font-bold">{(netGreeks.vega || 0).toFixed(3)}</td>
                    </tr>
                )}
            </tbody>
        </table>
        </div>
    );
}
