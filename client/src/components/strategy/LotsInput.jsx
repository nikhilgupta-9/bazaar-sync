// components/strategy/LotsInput.jsx
//
// − [lots] + stepper where the number itself is also typeable, so a trader
// can enter e.g. 25 lots directly instead of clicking + twenty-four times.
// The typed text is a local draft; it's committed on Enter / blur (clamped
// to min…max, whole lots only) and reverted on Escape or invalid input.
// ArrowUp / ArrowDown step by 1 while focused.
import { useState } from "react";

export const MAX_LOTS = 1000;

export default function LotsInput({
    value,
    onChange,
    onDecrementAtMin = null, // e.g. remove the leg when "−" is pressed at 1
    min = 1,
    max = MAX_LOTS,
    size = "sm", // "xs" = chain-row badge, "sm" = tables / toolbars
    title = "Lots",
}) {
    const [draft, setDraft] = useState(null); // null = not editing → show value

    const clamp = (n) => Math.min(max, Math.max(min, n));
    const commit = (raw) => {
        setDraft(null);
        const n = Math.floor(Number(String(raw).trim()));
        if (!Number.isFinite(n) || String(raw).trim() === "") return; // revert
        const next = clamp(n);
        if (next !== value) onChange(next);
    };
    const step = (delta) => {
        if (delta < 0 && value <= min && onDecrementAtMin) return onDecrementAtMin();
        const next = clamp(value + delta);
        if (next !== value) onChange(next);
    };

    const xs = size === "xs";
    const btn = `${xs ? "px-1 text-micro" : "px-1.5 text-xs"} font-bold text-fg-subtle hover:text-fg hover:bg-surface-hover disabled:opacity-30 transition cursor-pointer select-none`;

    return (
        <div
            className={`inline-flex items-stretch overflow-hidden rounded border border-line bg-surface shadow-xs ${xs ? "h-5" : "h-7"}`}
            onClick={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                onClick={() => step(-1)}
                disabled={value <= min && !onDecrementAtMin}
                className={btn}
                aria-label={`Decrease ${title.toLowerCase()}`}
            >
                −
            </button>
            <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                aria-label={title}
                title={`${title} — type a number (1–${max})`}
                value={draft ?? String(value)}
                onFocus={(e) => {
                    setDraft(String(value));
                    e.target.select();
                }}
                onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, String(max).length))}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") {
                        setDraft(null);
                        e.currentTarget.blur();
                    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                        e.preventDefault();
                        const base = Math.floor(Number(draft ?? value)) || value;
                        const next = clamp(base + (e.key === "ArrowUp" ? 1 : -1));
                        setDraft(String(next));
                        if (next !== value) onChange(next);
                    }
                }}
                className={`${xs ? "w-7 text-micro" : "w-10 text-xs"} border-x border-line bg-transparent text-center font-bold tabular-nums text-fg outline-none focus:bg-emerald-50 dark:focus:bg-emerald-950/40`}
            />
            <button type="button" onClick={() => step(1)} disabled={value >= max} className={btn} aria-label={`Increase ${title.toLowerCase()}`}>
                +
            </button>
        </div>
    );
}
