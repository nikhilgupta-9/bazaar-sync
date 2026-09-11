// components/strategy/SlTgModal.jsx
//
// Per-leg Stop-Loss / Target editor, shared by Strategy Builder and
// Simulator. The threshold is a percentage of THAT leg's own entry notional
// (entry price × qty × real lot size) — not the whole strategy's combined
// cost — matching what the backend replay actually checks against
// (server/controllers/simulatorController.js's replay). The ₹ figure each %
// resolves to is shown live so the number isn't entered blind.
//
//   footer="replay"  — Simulator: SL/TG is applied when you Run Simulation
//                      (the leg's P&L freezes at the triggering minute).
//   footer="live"    — Strategy Builder: SL/TG is watched against the live
//                      feed and raises a square-off alert when crossed
//                      (manual action — nothing auto-closes).
import { FiX } from "react-icons/fi";
import { formatPrice } from "../../utils/format";
import { legMultiplier } from "../../utils/payoff";

export default function SlTgModal({ leg, symbol, draft, onDraftChange, onClose, onSave, footer = "replay" }) {
    if (!leg) return null;

    const legNotional = leg.premium != null ? Math.abs(leg.premium * legMultiplier(leg)) : null;
    const slNum = draft.sl === "" ? null : Number(draft.sl);
    const tgNum = draft.tg === "" ? null : Number(draft.tg);
    const slAmount = slNum != null && legNotional != null ? (slNum / 100) * legNotional : null;
    const tgAmount = tgNum != null && legNotional != null ? (tgNum / 100) * legNotional : null;

    const footerCopy =
        footer === "live"
            ? "Watched against the live feed — when this leg's own running P&L crosses either threshold, a square-off alert appears. Nothing is closed automatically."
            : "Applied automatically when you Run Simulation — once this leg's own running P&L crosses either threshold, its P&L freezes at that minute while other legs keep going.";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
            <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900">Stop Loss / Target</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">
                        <FiX size={16} />
                    </button>
                </div>
                <div className="mb-4 text-xs text-gray-500">
                    <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${leg.action === "buy" ? "bg-emerald-500" : "bg-rose-500"}`}>
                        {leg.action === "buy" ? "BUY" : "SELL"}
                    </span>
                    {symbol} {leg.strike} {leg.type} · Entry {formatPrice(leg.premium)} · Lot {leg.lotSize ?? "1 (unknown)"} × {leg.qty}
                </div>

                <label className="mb-1 block text-xs font-medium text-gray-600">Stop Loss %</label>
                <input
                    type="number"
                    min="0"
                    value={draft.sl}
                    onChange={(e) => onDraftChange((d) => ({ ...d, sl: e.target.value }))}
                    placeholder="e.g. 30"
                    className="mb-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-rose-500"
                />
                <div className="mb-3 text-[11px] text-gray-400">
                    {slAmount != null ? `≈ ${formatPrice(slAmount)} loss on this leg triggers it` : "% of this leg's own entry notional"}
                </div>

                <label className="mb-1 block text-xs font-medium text-gray-600">Target %</label>
                <input
                    type="number"
                    min="0"
                    value={draft.tg}
                    onChange={(e) => onDraftChange((d) => ({ ...d, tg: e.target.value }))}
                    placeholder="e.g. 50"
                    className="mb-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
                <div className="mb-4 text-[11px] text-gray-400">
                    {tgAmount != null ? `≈ ${formatPrice(tgAmount)} profit on this leg triggers it` : "% of this leg's own entry notional"}
                </div>

                <div className="mb-4 rounded-lg bg-blue-50 p-2.5 text-[11px] text-blue-700">{footerCopy}</div>

                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                        Cancel
                    </button>
                    <button onClick={onSave} className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
