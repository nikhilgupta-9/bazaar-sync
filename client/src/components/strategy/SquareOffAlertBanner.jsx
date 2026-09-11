// components/strategy/SquareOffAlertBanner.jsx
//
// Amber "SL/TG hit — square off" banner, shared by Simulator (fires when
// replay playback reaches a leg's computed SL/TG exit minute) and Strategy
// Builder (fires when a leg's live P&L crosses its SL/TG threshold against
// the real feed). Nothing is closed automatically in either place — this is
// a manual prompt.
//
// alert: { reason: "target" | "stop_loss", action: "buy" | "sell",
//          strike, type: "CE" | "PE", time? }
import { FiAlertTriangle, FiX } from "react-icons/fi";

export default function SquareOffAlertBanner({ alert, onDismiss, context = "live" }) {
    if (!alert) return null;
    const at = alert.time ? ` @ ${String(alert.time).slice(0, 5)}` : "";
    const tail = context === "replay" ? " Playback paused." : " Position is still open — square off manually if you want to act.";
    return (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <FiAlertTriangle className="shrink-0" size={15} />
            <span className="flex-1">
                <span className="font-bold">
                    {alert.reason === "target" ? "Target hit" : "Stop-loss hit"} — square off
                </span>{" "}
                {alert.action === "buy" ? "BUY" : "SELL"} {alert.strike} {alert.type}
                {at}.{tail}
            </span>
            <button onClick={onDismiss} className="shrink-0 text-amber-600 hover:text-amber-900" aria-label="Dismiss">
                <FiX size={14} />
            </button>
        </div>
    );
}
