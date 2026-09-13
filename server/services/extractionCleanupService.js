// services/extractionCleanupService.js — "check first, clean if present,
// then fetch" for admin-triggered Data Extraction jobs (dataDownloaderRunner.js).
//
// Why this exists: data-downloader/'s own pipelines (optionchain/run.js,
// upstox/run.js, etc.) are deliberately resumable — they SKIP a
// contract/month that already has rows, to stay cheap on Breeze/Upstox's
// call budgets across a big multi-year run (see CLAUDE.md Phase 7). That's
// the right default for a routine backfill, but wrong for the case this
// admin flow is actually for: an admin who already knows a specific
// symbol's specific month is bad/partial/wrong and explicitly asked for it
// to be re-fetched. Skip-if-exists would silently do nothing in that case.
// So: for an admin-triggered job with an EXPLICIT symbol list (never for a
// blank "all known symbols" request — that stays skip-if-exists, same
// scale-safety reasoning Phase 7 already documents for the "ALL" mode
// scripts), delete whatever's already there for that (symbol, month) scope
// FIRST, so the pipeline's own skip check correctly sees nothing and does a
// real fetch.
//
// Deliberately scoped to the three "year" sources (icici_breeze, bhavcopy,
// upstox) — angelone/kotak are "recent window" / "one snapshot" modes with
// no year/month range, so "clean this month" has no meaning for them.
const { pool } = require("../config/db");

const YEAR_MODE_SOURCES = new Set(["icici_breeze", "bhavcopy", "upstox"]);

function pad2(n) {
    return String(n).padStart(2, "0");
}

// Date.UTC-based, per this codebase's Gotcha #12 — never local-timezone Date methods.
function monthRange(year, fromMonth, toMonth) {
    const from = fromMonth || 1;
    const to = toMonth || 12;
    const start = `${year}-${pad2(from)}-01`;
    const lastDay = new Date(Date.UTC(year, to, 0)); // day 0 of "to+1" (0-indexed) = last day of "to"
    const end = `${lastDay.getUTCFullYear()}-${pad2(lastDay.getUTCMonth() + 1)}-${pad2(lastDay.getUTCDate())}`;
    return { start, end };
}

/**
 * Deletes existing rows for (symbol(s), month range) from whichever real
 * table `dataType` writes into, BEFORE the fetch runs — so a re-run is a
 * genuine clean re-fetch, not a silent no-op against the pipeline's own
 * resumability skip. No-ops (returns null) for anything outside its scope
 * (recent/poll-mode sources, or a blank/ALL symbol list) rather than ever
 * guessing at a mass delete.
 *
 * Returns a human-readable summary string for the job log, or null if
 * nothing applicable to clean (so the caller can skip logging a no-op line).
 */
async function cleanBeforeFetch({ source, dataType, symbolList, year, fromMonth, toMonth }) {
    if (!YEAR_MODE_SOURCES.has(source)) return null;
    if (!Number.isInteger(Number(year))) return null;
    // VIX is always the single INDIAVIX series regardless of what (if
    // anything) was typed into the symbols field — that's not an "ALL
    // symbols" case the way option_chain/futures blank-symbols is, so it
    // doesn't need the same guard.
    if (dataType !== "vix" && (!symbolList || !symbolList.length)) return null;

    const { start, end } = monthRange(Number(year), fromMonth ? Number(fromMonth) : null, toMonth ? Number(toMonth) : null);
    const lines = [];

    if (dataType === "option_chain") {
        for (const symbol of symbolList) {
            const [r1] = await pool.query(`DELETE FROM option_chain_history WHERE symbol = ? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
            const [r2] = await pool.query(`DELETE FROM option_chain_coverage_summary WHERE symbol = ? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
            lines.push(`${symbol}: removed ${r1.affectedRows} option_chain_history row(s), ${r2.affectedRows} coverage-summary row(s)`);
        }
    } else if (dataType === "futures") {
        for (const symbol of symbolList) {
            const [r1] = await pool.query(`DELETE FROM futures_history WHERE symbol = ? AND trade_date BETWEEN ? AND ?`, [symbol, start, end]);
            lines.push(`${symbol}: removed ${r1.affectedRows} futures_history row(s)`);
        }
    } else if (dataType === "vix") {
        const [r1] = await pool.query(`DELETE FROM ohlcv_data WHERE symbol = 'INDIAVIX' AND trade_date BETWEEN ? AND ?`, [start, end]);
        lines.push(`INDIAVIX: removed ${r1.affectedRows} ohlcv_data row(s)`);
    } else {
        return null;
    }

    // Same lazy-require pattern coverageSummaryService.js already uses, to
    // avoid a require cycle — the admin Data Coverage page must not keep
    // showing counts for rows this just deleted for up to its 6h cache TTL.
    try {
        require("./dataCoverageService").invalidateCoverageCache();
    } catch (err) {
        console.error("[extractionCleanupService] cache invalidation failed:", err.message);
    }

    return `[cleanup] ${start}..${end} — checked for existing data first, cleaned before re-fetch:\n${lines.map((l) => `  - ${l}`).join("\n")}`;
}

module.exports = { cleanBeforeFetch };
