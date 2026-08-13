// utils/format.js — same Indian numbering (lakh/crore) convention as
// client/src/utils/format.js (project hard rule, applies here too).
export function formatPrice(value) {
    if (value == null || Number.isNaN(value)) return "-";
    return Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatRupees(value) {
    if (value == null || Number.isNaN(value)) return "-";
    return "₹" + formatPrice(value);
}

// Whole-rupee formatting for paise integers coming from paperTradeConfig.js
// constants (e.g. PRO_PRICE_PAISE) — divides by 100, no decimals.
export function formatPaiseAsRupees(paise) {
    if (paise == null || Number.isNaN(paise)) return "-";
    return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

export function formatCompact(value) {
    if (value == null || Number.isNaN(value)) return "-";
    const abs = Math.abs(value);
    if (abs >= 1e7) return (value / 1e7).toFixed(2) + " Cr";
    if (abs >= 1e5) return (value / 1e5).toFixed(2) + " L";
    if (abs >= 1e3) return (value / 1e3).toFixed(1) + " K";
    return String(value);
}

export function formatDateTime(dateString) {
    if (!dateString) return "-";
    try {
        return new Date(dateString).toLocaleString("en-IN", {
            day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
        });
    } catch {
        return dateString;
    }
}
