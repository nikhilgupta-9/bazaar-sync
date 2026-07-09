// Indian numbering (lakh/crore) is a hard project rule — see CLAUDE.md.
// Matches the Cr/L notation used across stockmojo.in's option chain tables.
export function formatOi(value) {
    if (value == null || Number.isNaN(value)) return "-";
    const abs = Math.abs(value);
    if (abs >= 1e7) return (value / 1e7).toFixed(2) + " Cr";
    if (abs >= 1e5) return (value / 1e5).toFixed(2) + " L";
    if (abs >= 1e3) return (value / 1e3).toFixed(2) + " K";
    return String(value);
}

export function formatPrice(value) {
    if (value == null || Number.isNaN(value)) return "-";
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPercent(value) {
    if (value == null || Number.isNaN(value)) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
}

export function formatRupees(value) {
    if (value == null || Number.isNaN(value)) return "-";
    return "₹" + formatPrice(value);
}
