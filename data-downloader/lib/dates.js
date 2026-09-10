// lib/dates.js — plain-string date math, no timezone traps.
//
// The parent project (see its CLAUDE.md Gotcha #12) hit a real, silent
// off-by-one-day bug TWICE from `new Date(nonISOString)` / local-timezone
// Date methods. Every date value in this app is a plain 'YYYY-MM-DD' string
// (the MySQL pool is opened with dateStrings:true), and all arithmetic goes
// through explicit Date.UTC(...) here — never ambient local parsing.
//
// These three are the only date helpers the vendored code needs; in the
// parent repo they came from services/backtestEngine.js (addDays/daysBetween)
// and services/instrumentMaster.js (todayIst).

/** dateStr + n days, as 'YYYY-MM-DD'. n may be negative. */
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 24 * 60 * 60 * 1000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Whole days from A to B (B - A). Negative if B is before A. */
function daysBetween(dateStrA, dateStrB) {
    const [ay, am, ad] = dateStrA.split("-").map(Number);
    const [by, bm, bd] = dateStrB.split("-").map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / (24 * 60 * 60 * 1000));
}

/** Today's calendar date in IST as 'YYYY-MM-DD', via explicit UTC arithmetic. */
function todayIst() {
    const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 0=Sun .. 6=Sat for a 'YYYY-MM-DD' string (UTC, no local tz). */
function dayOfWeek(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isWeekend(dateStr) {
    const dow = dayOfWeek(dateStr);
    return dow === 0 || dow === 6;
}

/** First and last calendar day of a month (month is 1-based). */
function monthBounds(year, month) {
    const mm = String(month).padStart(2, "0");
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month
    return { first: `${year}-${mm}-01`, last: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

module.exports = { addDays, daysBetween, todayIst, dayOfWeek, isWeekend, monthBounds };
