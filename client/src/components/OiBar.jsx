import React from "react";
import { formatOi } from "../utils/format";

// Inline horizontal bar behind the OI figure, sized relative to the max OI
// visible in the current strike range — mirrors stockmojo's option chain
// table. Bar grows outward from the strike spine (call: anchored at the
// cell's spine-side edge, growing left; put: anchored at the spine-side
// edge, growing right) with only the OUTER edge rounded — the edge nearest
// the spine stays square, same convention professional chain tools use.
export default function OiBar({ value, max, side, format = formatOi }) {
    const pct = max > 0 ? Math.min(100, ((value ?? 0) / max) * 100) : 0;
    const isCall = side === "ce";
    const barColor = isCall
        ? "bg-emerald-500/25 dark:bg-emerald-400/30"
        : "bg-rose-500/25 dark:bg-rose-400/30";
    const barShape = isCall ? "rounded-l-md right-0" : "rounded-r-md left-0";
    return (
        <div className="relative h-4 w-full overflow-hidden">
            <div className={`absolute inset-y-0 ${barShape} ${barColor} transition-all duration-300`} style={{ width: `${pct}%` }} />
            <div className={`relative px-2 ${isCall ? "text-right" : "text-left"} text-label leading-4 font-mono tabular-nums text-fg font-medium`}>
                {format(value)}
            </div>
        </div>
    );
}

