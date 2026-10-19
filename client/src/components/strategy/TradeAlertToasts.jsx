// components/strategy/TradeAlertToasts.jsx
//
// Top-right notification stack for simulator SL/TG hits, e.g.
//   "Stop Loss (Alert & Square Off)  S 19 Oct 23100 CE X 1 — price reached ₹95.40"
// Each toast auto-dismisses after a few seconds (and can be closed by hand);
// the leg itself keeps its "SL Hit"/"TG Hit" badge in the Positions table, so
// nothing is lost when a toast fades.
import { useEffect } from "react";
import { FiAlertTriangle, FiCheckCircle, FiX } from "react-icons/fi";
import { formatPrice } from "../../utils/format";

const AUTO_DISMISS_MS = 8000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortExpiry(expiry) {
    const [, m, d] = String(expiry || "").slice(0, 10).split("-").map(Number);
    return m && d ? `${d} ${MONTHS[m - 1]}` : "";
}

function Toast({ toast, onDismiss }) {
    useEffect(() => {
        const t = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [toast.id, onDismiss]);

    const isSl = toast.reason === "stop_loss";
    const title = `${isSl ? "Stop Loss" : "Target"} (${toast.squareOff ? "Alert & Square Off" : "Alert Only"})`;
    return (
        <div
            role="alert"
            className={`pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-xl border bg-surface p-3 shadow-xl ${
                isSl ? "border-rose-300 dark:border-rose-800" : "border-emerald-300 dark:border-emerald-800"
            }`}
        >
            {isSl ? <FiAlertTriangle className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" size={16} /> : <FiCheckCircle className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" size={16} />}
            <div className="min-w-0 flex-1">
                <div className={`text-xs font-bold ${isSl ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{title}</div>
                <div className="mt-0.5 text-xs text-fg">
                    <span className={`mr-1 rounded px-1 text-micro font-bold ${toast.action === "sell" ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"}`}>
                        {toast.action === "sell" ? "S" : "B"}
                    </span>
                    {shortExpiry(toast.expiry)} {toast.strike} {toast.type} X {toast.qty}
                </div>
                <div className="mt-0.5 text-label text-fg-muted">
                    Price reached <b className="font-mono tabular-nums text-fg">{formatPrice(toast.price)}</b> at {String(toast.time || "").slice(0, 5)}
                    {toast.squareOff ? " — position squared off" : ""}
                </div>
            </div>
            <button onClick={() => onDismiss(toast.id)} className="shrink-0 text-fg-subtle hover:text-fg" aria-label="Dismiss">
                <FiX size={14} />
            </button>
        </div>
    );
}

export default function TradeAlertToasts({ toasts, onDismiss }) {
    if (!toasts.length) return null;
    return (
        <div className="pointer-events-none fixed right-4 top-20 z-[60] flex flex-col gap-2" aria-live="assertive">
            {toasts.map((t) => (
                <Toast key={t.id} toast={t} onDismiss={onDismiss} />
            ))}
        </div>
    );
}
