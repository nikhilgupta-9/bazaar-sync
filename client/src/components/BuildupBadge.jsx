const STYLES = {
    L: { arrow: "↗", label: "L", classes: "bg-emerald-500 text-white" },
    SC: { arrow: "↑", label: "SC", classes: "bg-emerald-100 text-emerald-800" },
    S: { arrow: "↘", label: "S", classes: "bg-rose-100 text-rose-700" },
    LU: { arrow: "↓", label: "LU", classes: "bg-amber-100 text-amber-800" },
};

// Long Buildup / Short Covering / Short Buildup / Long Unwinding — derived
// server-side from price direction + OI direction (see optionChainController.js).
export default function BuildupBadge({ code }) {
    const style = STYLES[code];
    if (!style) return <span className="text-gray-300">-</span>;
    return (
        <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${style.classes}`}>
            {style.arrow}{style.label}
        </span>
    );
}
