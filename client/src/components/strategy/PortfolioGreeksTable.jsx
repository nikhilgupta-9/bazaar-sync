// components/strategy/PortfolioGreeksTable.jsx
//
// Per-leg IV/Δ/Γ/Θ/Vega table plus the "Net Risk Aggregates" row, shared by
// Strategy Builder and Simulator. `netGreeks` is computed by the caller
// (utils/payoff.js's computeNetGreeks, over the *active* legs) — the per-leg
// rows show every leg regardless of its include-in-payoff checkbox.
export default function PortfolioGreeksTable({ legs, netGreeks }) {
    return (
        <table className="w-full border-collapse text-xs">
            <thead>
                <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-200">
                    <th className="px-4 py-2.5 text-left font-medium">Leg Matrix</th>
                    <th className="px-4 py-2.5 text-right font-medium">IV %</th>
                    <th className="px-4 py-2.5 text-right font-medium">Delta</th>
                    <th className="px-4 py-2.5 text-right font-medium">Gamma</th>
                    <th className="px-4 py-2.5 text-right font-medium">Theta</th>
                    <th className="px-4 py-2.5 text-right font-medium">Vega</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
                {legs.map((leg) => (
                    <tr key={leg.id} className="hover:bg-gray-50/40 transition-colors">
                        <td className="px-4 py-2.5 font-medium text-gray-700">
                            {leg.action === "buy" ? "B" : "S"} {leg.strike} {leg.type}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.iv ?? "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.delta ?? "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.gamma ?? "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.theta ?? "-"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.vega ?? "-"}</td>
                    </tr>
                ))}
                {netGreeks && (
                    <tr className="font-bold bg-blue-50/30 border-t-2 border-gray-200 text-gray-900">
                        <td className="px-4 py-3">Net Risk Aggregates</td>
                        <td className="px-4 py-3"></td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.delta || 0).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.gamma || 0).toFixed(6)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.theta || 0).toFixed(3)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.vega || 0).toFixed(3)}</td>
                    </tr>
                )}
            </tbody>
        </table>
    );
}
