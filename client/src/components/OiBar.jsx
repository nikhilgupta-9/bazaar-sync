import React from "react";
import { formatOi } from "../utils/format";

// Inline horizontal bar behind the OI figure, sized relative to the max OI
// visible in the current strike range — mirrors stockmojo's option chain
// table. Bar grows outward from the strike spine (call: anchored at the
// cell's spine-side edge, growing left; put: anchored at the spine-side
// edge, growing right) with only the OUTER edge rounded — the edge nearest
// the spine stays square, same convention professional chain tools use.
export default function OiBar({ value, max, side }) {
    const pct = max > 0 ? Math.min(100, ((value ?? 0) / max) * 100) : 0;
    const isCall = side === "ce";
    const barColor = isCall
        ? "bg-emerald-100/80 dark:bg-emerald-950/60"
        : "bg-rose-100/80 dark:bg-rose-950/60";
    const barShape = isCall ? "rounded-l-md right-0" : "rounded-r-md left-0";
    return (
        <div className="relative h-4 w-full overflow-hidden">
            <div className={`absolute inset-y-0 ${barShape} ${barColor} transition-all duration-300`} style={{ width: `${pct}%` }} />
            <div className="relative px-2 text-right text-[11px] leading-4 tabular-nums text-gray-700 dark:text-gray-300 font-medium">{formatOi(value)}</div>
        </div>
    );
}

