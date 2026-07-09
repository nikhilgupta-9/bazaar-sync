import { formatOi } from "../utils/format";

// Inline horizontal bar behind the OI figure, sized relative to the max OI
// visible in the current strike range — mirrors stockmojo's option chain table.
export default function OiBar({ value, max, side }) {
    const pct = max > 0 ? Math.min(100, ((value ?? 0) / max) * 100) : 0;
    const barColor = side === "ce" ? "bg-emerald-200" : "bg-rose-200";
    return (
        <div className="relative w-full overflow-hidden rounded">
            <div
                className={`absolute inset-y-0 ${side === "ce" ? "right-0" : "left-0"} ${barColor}`}
                style={{ width: `${pct}%` }}
            />
            <div className="relative px-2 py-0.5 text-right tabular-nums">{formatOi(value)}</div>
        </div>
    );
}
