// components/strategy/PriceSlTgModal.jsx
//
// Simulator Stop-Loss / Target editor in OPTION PRICE terms (stockmojo
// parity): e.g. a SELL 23100 CE entered at 87.20 gets an SL at 95 and a
// target at 70. The level is checked every minute the simulator lands on
// (stepping, Autoplay or a replay run); "Alert + Square Off" closes the leg
// at that minute's real price, "Alert Only" just raises the notification.
//
// Direction rules (what "adverse" means depends on the side):
//   SELL leg — SL above the current price, target below it
//   BUY  leg — SL below the current price, target above it
import { useState } from "react";
import { FiX } from "react-icons/fi";
import { formatPrice } from "../../utils/format";
import { legMultiplier } from "../../utils/payoff";
import { SLTG_MODES } from "./sltgModes";

function toNum(v) {
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : NaN;
}

export default function PriceSlTgModal({ leg, ltp, onClose, onSave }) {
    const [sl, setSl] = useState(leg?.slPrice != null ? String(leg.slPrice) : "");
    const [tg, setTg] = useState(leg?.tgPrice != null ? String(leg.tgPrice) : "");
    const [mode, setMode] = useState(leg?.sltgMode || SLTG_MODES.SQUARE_OFF);
    if (!leg) return null;

    const isSell = leg.action === "sell";
    const ref = ltp ?? leg.premium;
    const slNum = toNum(sl);
    const tgNum = toNum(tg);
    const pnlAt = (price) => (price == null || Number.isNaN(price) ? null : (isSell ? leg.premium - price : price - leg.premium) * legMultiplier(leg));

    let slError = null;
    if (Number.isNaN(slNum)) slError = "Enter a price above 0";
    else if (slNum != null && ref != null && (isSell ? slNum <= ref : slNum >= ref)) slError = `For a ${isSell ? "SELL" : "BUY"} leg the stop loss must be ${isSell ? "above" : "below"} the current price (${formatPrice(ref)})`;
    let tgError = null;
    if (Number.isNaN(tgNum)) tgError = "Enter a price above 0";
    else if (tgNum != null && ref != null && (isSell ? tgNum >= ref : tgNum <= ref)) tgError = `For a ${isSell ? "SELL" : "BUY"} leg the target must be ${isSell ? "below" : "above"} the current price (${formatPrice(ref)})`;
    const canSave = !slError && !tgError;

    const field = (label, value, setValue, error, tone, placeholder) => {
        const at = pnlAt(toNum(value));
        return (
            <div className="mb-3">
                <label className="mb-1 block text-xs font-semibold text-fg">{label}</label>
                <div className={`flex overflow-hidden rounded-lg border ${error ? "border-rose-500" : "border-line"} ${tone === "rose" ? "focus-within:border-rose-500" : "focus-within:border-emerald-500"}`}>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={value}
                        onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
                        placeholder={placeholder}
                        className="min-w-0 flex-1 bg-surface px-3 py-2 text-sm font-mono tabular-nums text-fg outline-none placeholder:text-fg-subtle"
                    />
                    <span className="flex items-center border-l border-line bg-surface-muted px-3 text-xs font-semibold text-fg-muted">Price</span>
                </div>
                {error ? (
                    <div className="mt-1 text-label text-rose-600 dark:text-rose-400">{error}</div>
                ) : at != null ? (
                    <div className={`mt-1 text-label font-semibold ${at >= 0 ? "text-up" : "text-down"}`}>
                        {at >= 0 ? "+" : ""}
                        {formatPrice(at)} on this leg if hit
                    </div>
                ) : null}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-xs" onClick={onClose}>
            <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-line pb-3">
                    <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-fg">
                            {leg.strike} {leg.type}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 text-micro font-bold ${isSell ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"}`}>
                            {isSell ? "SELL" : "BUY"}
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-label text-fg-muted">
                            Entry: <b className="font-mono tabular-nums text-fg">{formatPrice(leg.premium)}</b>
                            <span className="mx-1.5">LTP:</span>
                            <b className="font-mono tabular-nums text-down">{ltp != null ? formatPrice(ltp) : "—"}</b>
                        </span>
                        <button onClick={onClose} className="text-fg-subtle hover:text-fg" aria-label="Close">
                            <FiX size={16} />
                        </button>
                    </div>
                </div>

                {field("Stop Loss", sl, setSl, slError, "rose", `e.g. price ${isSell ? Math.ceil((ref || 100) * 1.2) : Math.floor((ref || 100) * 0.8)}`)}
                {field("Target", tg, setTg, tgError, "emerald", `e.g. price ${isSell ? Math.floor((ref || 100) * 0.7) : Math.ceil((ref || 100) * 1.3)}`)}

                <div className="mb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 py-1 text-xs text-fg">
                    {[
                        [SLTG_MODES.ALERT, "Alert Only"],
                        [SLTG_MODES.SQUARE_OFF, "Alert + Square Off"],
                    ].map(([key, label]) => (
                        <label key={key} className="flex cursor-pointer items-center gap-1.5">
                            <input type="radio" name="sltg-mode" checked={mode === key} onChange={() => setMode(key)} className="accent-blue-600" />
                            {label}
                        </label>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <button onClick={onClose} className="rounded-lg border border-line py-2 text-sm font-semibold text-fg hover:bg-surface-hover">
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave({ slPrice: slNum ?? null, tgPrice: tgNum ?? null, sltgMode: mode })}
                        disabled={!canSave}
                        className="rounded-lg bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        Save
                    </button>
                </div>
                {(leg.slPrice != null || leg.tgPrice != null) && (
                    <button
                        onClick={() => onSave({ slPrice: null, tgPrice: null, sltgMode: mode })}
                        className="mt-2 w-full text-center text-label font-semibold text-fg-muted hover:text-rose-600"
                    >
                        Remove SL / Target
                    </button>
                )}
            </div>
        </div>
    );
}
