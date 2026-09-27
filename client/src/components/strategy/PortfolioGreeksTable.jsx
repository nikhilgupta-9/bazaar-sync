// components/strategy/PortfolioGreeksTable.jsx
//
// Per-leg IV/Δ/Γ/Θ/Vega table plus the "Net Risk Aggregates" row, shared by
// Strategy Builder and Simulator. `netGreeks` is computed by the caller
// (utils/payoff.js's computeNetGreeks, over the *active* legs) — the per-leg
// rows show every leg regardless of its include-in-payoff checkbox.
export default function PortfolioGreeksTable({ legs, netGreeks }) {
    return (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
                <tr className="text-gray-400 dark:text-gray-400 bg-gray-50/40 dark:bg-gray-800/40 border-b border-gray-200 dark:border-gray-800">
                    <th className="px-4 py-2.5 text-left font-bold uppercase tracking-wider text-[10px]">Leg Matrix</th>
                    <th className="px-4 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">IV %</th>
                    <th className="px-4 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Delta</th>
                    <th className="px-4 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Gamma</th>
                    <th className="px-4 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Theta</th>
                    <th className="px-4 py-2.5 text-right font-bold uppercase tracking-wider text-[10px]">Vega</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {legs.map((leg) => (
                    <tr key={leg.id} className="hover:bg-gray-50/40 dark:hover:bg-gray-800/40 transition-colors">
                        <td className="px-4 py-2.5 font-bold text-gray-800 dark:text-gray-200">
                            <span className={`inline-block w-4 text-center rounded text-[10px] mr-1.5 font-black text-white ${leg.action === "buy" ? "bg-emerald-600" : "bg-rose-600"}`}>
                                {leg.action === "buy" ? "B" : "S"}
                            </span>
                            {leg.strike} <span className={leg.type === "CE" ? "text-emerald-600 dark:text-emerald-400" : "text-purple-600 dark:text-purple-400"}>{leg.type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.iv != null ? `${leg.iv}%` : "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.delta ?? "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.gamma ?? "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.theta ?? "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600 dark:text-gray-400 font-mono">{leg.vega ?? "-"}</td>
                    </tr>
                ))}
                {netGreeks && (
                    <tr className="font-bold bg-blue-50/40 dark:bg-blue-950/30 border-t-2 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                        <td className="px-4 py-3 text-blue-700 dark:text-blue-400 font-black">Net Risk Aggregates</td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-blue-600 dark:text-blue-400 font-bold">{(netGreeks.delta || 0).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-blue-600 dark:text-blue-400 font-bold">{(netGreeks.gamma || 0).toFixed(6)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-blue-600 dark:text-blue-400 font-bold">{(netGreeks.theta || 0).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-mono text-blue-600 dark:text-blue-400 font-bold">{(netGreeks.vega || 0).toFixed(3)}</td>
                    </tr>
                )}
            </tbody>
        </table>
        </div>
    );
}
