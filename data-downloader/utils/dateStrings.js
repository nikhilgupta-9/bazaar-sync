// utils/dateStrings.js — plain 'YYYY-MM-DD' string date math.
//
// Extracted verbatim from the main app's services/backtestEngine.js so the
// backfill scripts here don't have to drag in the whole backtest engine (and
// its own dependency chain) just for `addDays`.
//
// Project rule (CLAUDE.md Gotcha #12): never do date arithmetic with
// `new Date(nonISOString)` or local-timezone Date methods. mysql2 is
// configured with `dateStrings: true` (config/db.js), so DATE columns come
// back as plain strings — all day/month math here goes through explicit
// Date.UTC(...) and never touches the ambient timezone.

/** 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD' (n may be negative). */
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const utcMs = Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000;
    const dt = new Date(utcMs);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Whole days from dateStrA to dateStrB (B - A); negative if B is before A. */
function daysBetween(dateStrA, dateStrB) {
    const [ay, am, ad] = dateStrA.split("-").map(Number);
    const [by, bm, bd] = dateStrB.split("-").map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / (24 * 60 * 60 * 1000));
}

module.exports = { addDays, daysBetween };
