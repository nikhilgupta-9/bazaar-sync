// dhan/expiryResolver.js — maps a rollingoption (expiryFlag, expiryCode,
// trade_date) tuple back to a REAL calendar expiry date, since Dhan's
// response carries no expiry field at all (confirmed empirically, see
// historicalService.js's header) — only a continuously-rolling relative
// rank ("nearest", "2nd nearest", ...).
//
// The real expiry universe for a symbol comes from dhan/expiryDiscovery.js
// (NSE/BSE bhavcopy, read-only in-memory lookup — NEVER written to
// option_chain_history, see that file's header for why). Weekly vs monthly
// classification reuses the same rule CLAUDE.md's Phase 4 already documents
// for backtestEngine.js: the LAST expiry inside a calendar month is
// "monthly", every other same-month expiry is "weekly".
//
// ASSUMPTION, not independently confirmed against Dhan's own internal rank
// logic: "rank N as of date D" = the Nth soonest not-yet-expired expiry of
// that flag, counting from D inclusive. This matched observed behavior in
// testing (expiryCode=1/2/3 all returned sane, cleanly-separated Jan 2023
// series with plausible OI rollover timing) but was not verified against a
// documented spec (none exists) — the pipeline's own verify step should be
// the real check, same as every other "confirmed by testing, not by docs"
// note elsewhere in this codebase.

/** Classify each expiry as 'WEEK' or 'MONTH' — the last expiry in its calendar month is monthly, everything else weekly. */
function classifyExpiries(expiriesAsc) {
    const byMonth = new Map();
    for (const e of expiriesAsc) {
        const ym = e.slice(0, 7);
        byMonth.set(ym, [...(byMonth.get(ym) || []), e]);
    }
    const monthly = new Set();
    for (const list of byMonth.values()) monthly.add(list[list.length - 1]);
    return {
        week: expiriesAsc.filter((e) => !monthly.has(e)),
        month: expiriesAsc.filter((e) => monthly.has(e)),
    };
}

/** The rank-th soonest not-yet-expired expiry of `flag`, as of `dateStr` (rank is 1-based). Null if fewer than `rank` such expiries are known. */
function expiryForRank(dateStr, expiriesOfFlagAsc, rank) {
    const upcoming = expiriesOfFlagAsc.filter((e) => e >= dateStr);
    return upcoming[rank - 1] || null;
}

module.exports = { classifyExpiries, expiryForRank };
