// services/dataCoverageService.js — the "how much data do we actually have"
// reporting behind the admin Data Coverage / Expiry Status / Greeks
// Coverage pages. Read-only, never mutates option_chain_history/
// futures_history. Everything here is 2023-01 onward per the project's
// current target window (Next Steps: "2023 se aaj tak").
//
// "Expected days per month" is deliberately NOT a hardcoded NSE holiday
// calendar (nobody has entered one, and a wrong one would silently misreport
// coverage) — it's derived from the data itself: whichever symbol has the
// MOST distinct trade_dates in a given month, that count IS the month's
// trading-day reference. Same "derive from data, never fabricate" instinct
// this codebase already applies elsewhere (see nseBhavcopy.js, verifyMonth.js
// in data-downloader/).

const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const optionChainService = require("./optionChainService");

const COVERAGE_START = "2023-01-01"; // Next Steps target window
const TABLES = { option_chain: "option_chain_history", futures: "futures_history" };
// Pre-aggregated (symbol, expiry, trade_date) row counts, kept in sync
// incrementally by services/coverageSummaryService.js right after every
// ingestion write into option_chain_history (see schema.sql's comment on
// the table itself for the full rationale). option_chain_history is the
// one table this was actually built for (478M rows, per CLAUDE.md) —
// futures_history has no such table yet (much smaller, not the scale
// problem this fixes) and keeps using the raw-table queries below.
const SUMMARY_TABLE = "option_chain_coverage_summary";
// Each table's (symbol, trade_date, trade_time) index — named differently
// per table (see schema.sql) — used to force the right index for the
// GROUP BY trade_date queries below; see getCoverageDetail's comment for why
// leaving it to the optimizer isn't safe here.
const SYMBOL_DATE_TIME_INDEX = { option_chain_history: "idx_symbol_date_time", futures_history: "idx_fut_symbol_date_time" };

// The 7 indices always shown first/pinned on the coverage & expiry pages,
// regardless of whether they currently have rows — a missing index should
// be loudly visible, not silently absent from a "symbols we found" list.
// Also used (see getMonthlyReference below) to keep the "expected trading
// days" reference query FAST — filtering to these 7 lets it use the
// existing (symbol, trade_date, ...) indexes instead of a full-table scan.
const SEVEN_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];

// USE/FORCE INDEX hints below name indexes schema.sql declares, but a
// pre-existing DB might not actually have yet (e.g. the ALTER TABLE ADD
// INDEX a Next Steps note says existing DBs need by hand, possibly still
// running in the background). Referencing a missing index is a hard MySQL
// error (1176 "Key ... doesn't exist"), not just a slow query — confirmed
// for real (2026-09-13) hitting this page while that ALTER was mid-flight.
// So: try the hinted (fast) query first, and if the index genuinely isn't
// there yet, transparently fall back to the plain (slower, but working)
// version instead of erroring the whole page. Self-heals the moment the
// index finishes — no restart needed.
async function queryPreferIndex(hintedSql, plainSql, params) {
    try {
        return await pool.query(hintedSql, params);
    } catch (err) {
        if (err && err.errno === 1176) return await pool.query(plainSql, params);
        throw err;
    }
}

// MariaDB-only statement-level timeout (`max_statement_time`, in SECONDS —
// not ms, per MariaDB's own docs). Scoped to a single statement via
// `SET STATEMENT ... FOR`, so it never leaks onto other queries sharing the
// same pooled connection. Added 2026-09-13 after repeatedly observing a
// real, recurring failure mode on this dev box: a `nodemon` restart (its
// own restart signal, or even SIGTERM) does NOT abort a query already
// in flight on the MySQL server — MySQL only notices the client vanished
// when it tries to write results back, which for a long GROUP BY never
// happens until the scan finishes. So every code-edit-triggered restart
// during this table's ongoing 478M-row index build left the PREVIOUS
// request's full-table scan running as an orphaned "zombie" for 10-30+
// minutes, competing with the live server for the same I/O — confirmed
// directly via SHOW FULL PROCESSLIST multiple times in this session. This
// wrapper bounds the damage: a genuinely stuck/orphaned query self-aborts
// instead of running indefinitely, regardless of why it's stuck.
function withStatementTimeout(sql, seconds) {
    return `SET STATEMENT max_statement_time=${Number(seconds)} FOR ${sql}`;
}

function tableFor(dataType) {
    const table = TABLES[dataType];
    if (!table) throw Object.assign(new Error(`unknown dataType "${dataType}" (expected option_chain or futures)`), { status: 400 });
    return table;
}

function todaySql() {
    const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
    const d = new Date(istMs);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Cache: in-memory Map + JSON-on-disk (survives restarts) + in-flight
// de-dup + stale-while-revalidate — the exact same shape as
// controllers/simulatorController.js's simulator-dates cache, applied here
// for the identical reason. Before this fix, `cached()` was TTL-only with no
// disk persistence and no protection against concurrent callers for the same
// key: confirmed for real (2026-09-13) that a cold cache (every dev restart
// starts empty) plus a couple of admin page reloads/restarts landing close
// together produced 5 DUPLICATE copies of the same multi-minute
// getCoverageSummary full-table scan running at once on option_chain_history
// (478M rows), starving the connection pool and making even tiny, unrelated
// admin queries (e.g. Plans/Coupons) appear to hang. Fixed two ways: (1) an
// in-flight Map so a second caller for the same key awaits the first's
// promise instead of starting its own query, and (2) a JSON file on disk so
// a restart doesn't throw away a good answer and force a fresh scan — most
// dev restarts now reuse the last computed value instantly with zero DB
// work, only refreshing in the background once the TTL is stale.
//
// TTL bumped from 20 min to 6h (2026-09-13, matching the Simulator dates
// cache's own 6h TTL): this data is effectively append-only historical
// market data (see the note above monthList/getCoverageDetail) — nothing
// about yesterday's coverage numbers changes minute to minute, so there's
// no reason to re-pay even the OPTIMIZED scan (see getCoverageSummary's
// comment: still a real multi-minute cost touching all 478M rows for an
// exact COUNT(*), just no longer 30+ minutes) every 20 minutes in the
// background. Worst case the admin coverage page is a few hours behind on
// whatever the nightly cron/a backfill script added since the last refresh.
const CACHE_FILE = path.join(__dirname, "..", "data", "data-coverage-cache.json");
const cache = new Map(); // key -> { at, data }
const inFlight = new Map(); // key -> Promise (loader already running for this key)
const TTL_MS = 6 * 60 * 60 * 1000;

(function loadCacheFromDisk() {
    try {
        const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
        for (const [key, entry] of Object.entries(raw)) {
            if (entry && "data" in entry) cache.set(key, { at: Number(entry.at) || 0, data: entry.data });
        }
    } catch {
        /* no cache file yet, or unreadable — the first request(s) rebuild it */
    }
})();

function persistCacheToDisk() {
    try {
        const obj = {};
        for (const [key, entry] of cache) obj[key] = entry;
        fs.writeFileSync(CACHE_FILE, JSON.stringify(obj));
    } catch (err) {
        console.error("[dataCoverageService] cache persist failed:", err.message);
    }
}

// Runs loader() for `key`, but a second/third/... call while it's still
// running gets the SAME promise instead of starting a duplicate query.
function refresh(key, loader) {
    if (inFlight.has(key)) return inFlight.get(key);
    const p = loader()
        .then((data) => {
            cache.set(key, { at: Date.now(), data });
            persistCacheToDisk();
            return data;
        })
        .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
}

async function cached(key, loader) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
    if (hit) {
        // Stale-while-revalidate: answer instantly with the last good value,
        // refresh in the background (in-flight-guarded — a burst of
        // concurrent requests triggers ONE background refresh, not one each).
        refresh(key, loader).catch((err) => console.error(`[dataCoverageService] background refresh of "${key}" failed:`, err.message));
        return hit.data;
    }
    // No cached answer at all yet (cold key) — every concurrent caller must
    // wait, but they all share the one in-flight query via refresh()'s guard.
    return refresh(key, loader);
}

function invalidate(prefix) {
    let changed = false;
    for (const key of [...cache.keys()]) {
        if (!prefix || key.startsWith(prefix)) {
            cache.delete(key);
            changed = true;
        }
    }
    if (changed) persistCacheToDisk();
}

/**
 * Per-symbol overall stats: first/last date, total rows, distinct days,
 * distinct months with any data.
 *
 * Used to be ONE query mixing COUNT(*)/SUM(...) with COUNT(DISTINCT
 * trade_date)/COUNT(DISTINCT month) in the same GROUP BY — measured for
 * real (2026-09-13, after idx_symbol_date_time already existed) STILL
 * running after 12+ minutes on this table's 478M rows. Mixing a DISTINCT
 * count into the same aggregation as COUNT(*)/SUM forces MySQL to
 * materialize a per-group temp structure instead of streaming off the
 * index (confirmed: EXPLAIN on the combined shape shows a plain "index"
 * scan needing to inspect all 478M rows either way for the DISTINCT part,
 * with no loose-scan shortcut available once COUNT(*) is also requested).
 * Split into two queries that each get MySQL's fast path (both confirmed
 * via EXPLAIN, 2026-09-13):
 *   1. totals (COUNT(*)/SUM/MIN/MAX, no DISTINCT) — "Using index" (a plain
 *      index-only scan, no temp table); still touches every row since an
 *      exact COUNT(*) has no shortcut, but the index is far narrower than
 *      the full row (no CE/PE/Greeks columns), so this is materially
 *      faster than scanning the base table.
 *   2. distinct (symbol, trade_date) pairs, via a SEPARATE query with no
 *      other aggregate — "Using index for group-by" (a genuine loose index
 *      scan: MySQL jumps straight to the next distinct pair instead of
 *      reading every row in between), costing roughly one row per
 *      symbol-day rather than per symbol-day-minute. totalDays/
 *      monthsWithData are then just counted/bucketed in JS from this much
 *      smaller result set.
 */
async function getCoverageSummary(dataType) {
    const table = tableFor(dataType);
    return cached(`summary:${dataType}`, async () => {
        const today = todaySql();

        // option_chain reads from the tiny pre-aggregated summary table
        // (a few hundred thousand (symbol, expiry, trade_date) rows, not
        // option_chain_history's 478M) — the exact query shape that used to
        // take ~30 min / exhaust disk against the raw table (COUNT(*)/SUM
        // plus two COUNT(DISTINCT ...) in one GROUP BY, one of them on a
        // computed DATE_FORMAT expression) is completely fine here, since a
        // temp table over ~300K rows is instant. No USE INDEX/statement-
        // timeout gymnastics needed — this table is small enough that the
        // straightforward query IS the fast query.
        if (table === "option_chain_history") {
            const [rows] = await pool.query(
                `SELECT symbol,
                        MIN(trade_date) AS firstDate, MAX(trade_date) AS lastDate,
                        SUM(row_count) AS totalRows, SUM(minute_rows) AS minuteRows,
                        COUNT(DISTINCT trade_date) AS totalDays,
                        COUNT(DISTINCT DATE_FORMAT(trade_date, '%Y-%m')) AS monthsWithData
                 FROM ${SUMMARY_TABLE}
                 WHERE trade_date BETWEEN ? AND ?
                 GROUP BY symbol
                 ORDER BY symbol`,
                [COVERAGE_START, today]
            );
            return rows.map((r) => ({
                symbol: r.symbol,
                firstDate: r.firstDate,
                lastDate: r.lastDate,
                totalRows: Number(r.totalRows),
                minuteRows: Number(r.minuteRows || 0),
                totalDays: Number(r.totalDays),
                monthsWithData: Number(r.monthsWithData),
            }));
        }

        // futures_history has no summary table yet (much smaller, not the
        // scale problem this fixes) — unchanged raw-table path.
        const indexName = SYMBOL_DATE_TIME_INDEX[table];
        const [totalsRows] = await queryPreferIndex(
            withStatementTimeout(
                `SELECT symbol, MIN(trade_date) AS firstDate, MAX(trade_date) AS lastDate,
                        COUNT(*) AS totalRows, SUM(trade_time <> '15:30:00') AS minuteRows
                 FROM ${table} USE INDEX (${indexName})
                 WHERE trade_date BETWEEN ? AND ?
                 GROUP BY symbol`,
                900
            ),
            withStatementTimeout(
                `SELECT symbol, MIN(trade_date) AS firstDate, MAX(trade_date) AS lastDate,
                        COUNT(*) AS totalRows, SUM(trade_time <> '15:30:00') AS minuteRows
                 FROM ${table}
                 WHERE trade_date BETWEEN ? AND ?
                 GROUP BY symbol`,
                900
            ),
            [COVERAGE_START, today]
        );
        const [dateRows] = await queryPreferIndex(
            withStatementTimeout(
                `SELECT symbol, trade_date
                 FROM ${table} USE INDEX (${indexName})
                 WHERE trade_date BETWEEN ? AND ?
                 GROUP BY symbol, trade_date`,
                120
            ),
            withStatementTimeout(
                `SELECT symbol, trade_date
                 FROM ${table}
                 WHERE trade_date BETWEEN ? AND ?
                 GROUP BY symbol, trade_date`,
                120
            ),
            [COVERAGE_START, today]
        );
        const daysBySymbol = new Map(); // symbol -> distinct trade_date count
        const monthsBySymbol = new Map(); // symbol -> Set of 'YYYY-MM'
        for (const r of dateRows) {
            daysBySymbol.set(r.symbol, (daysBySymbol.get(r.symbol) || 0) + 1);
            if (!monthsBySymbol.has(r.symbol)) monthsBySymbol.set(r.symbol, new Set());
            monthsBySymbol.get(r.symbol).add(r.trade_date.slice(0, 7));
        }
        return totalsRows
            .map((r) => ({
                symbol: r.symbol,
                firstDate: r.firstDate,
                lastDate: r.lastDate,
                totalRows: Number(r.totalRows),
                minuteRows: Number(r.minuteRows || 0),
                totalDays: daysBySymbol.get(r.symbol) || 0,
                monthsWithData: monthsBySymbol.has(r.symbol) ? monthsBySymbol.get(r.symbol).size : 0,
            }))
            .sort((a, b) => a.symbol.localeCompare(b.symbol));
    });
}

/** Every 'YYYY-MM' from 2023-01 through the current month, inclusive. */
function monthList() {
    const [, endM] = todaySql().split("-");
    const endYear = Number(todaySql().slice(0, 4));
    const endMonth = Number(endM);
    const months = [];
    for (let y = 2023; y <= endYear; y++) {
        const lastM = y === endYear ? endMonth : 12;
        for (let m = 1; m <= lastM; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    return months;
}

// Was previously `GROUP BY DATE_FORMAT(trade_date, '%Y-%m'), symbol` with no
// symbol filter — on option_chain_history's tens of millions of rows that's
// a GROUP BY on a computed expression (can't use any index for grouping) PLUS
// a COUNT(DISTINCT trade_date) inside it, which MySQL can only resolve with a
// big on-disk temp table. Measured taking 30s+, and a real run of the "7
// indices only" attempt at fixing this (below) actually EXHAUSTED THE DISK
// with that temp file ("No space left on device", confirmed 2026-09-13) even
// with the smaller symbol set — proof the query shape itself, not just the
// row count, was the problem. Fixed properly this time: group by the RAW
// indexed columns only (symbol, trade_date — exactly idx_symbol_date_time's
// leading columns), which MySQL can stream straight off the index with NO
// filesort/temp table, then bucket the (small: ~7 symbols x ~700 trading
// days) result into months in JS.
async function getMonthlyReference(dataType) {
    const table = tableFor(dataType);
    return cached(`reference:${dataType}`, async () => {
        const [rows] = table === "option_chain_history"
            ? await pool.query(
                `SELECT symbol, trade_date
                 FROM ${SUMMARY_TABLE}
                 WHERE symbol IN (?) AND trade_date BETWEEN ? AND ?
                 GROUP BY symbol, trade_date`,
                [SEVEN_INDICES, COVERAGE_START, todaySql()]
            )
            : await queryPreferIndex(
                `SELECT symbol, trade_date
                 FROM ${table} USE INDEX (${SYMBOL_DATE_TIME_INDEX[table]})
                 WHERE symbol IN (?) AND trade_date BETWEEN ? AND ?
                 GROUP BY symbol, trade_date`,
                `SELECT symbol, trade_date
                 FROM ${table}
                 WHERE symbol IN (?) AND trade_date BETWEEN ? AND ?
                 GROUP BY symbol, trade_date`,
                [SEVEN_INDICES, COVERAGE_START, todaySql()]
            );
        const perSymbolMonth = new Map(); // "symbol|ym" -> day count
        for (const r of rows) {
            const key = `${r.symbol}|${r.trade_date.slice(0, 7)}`;
            perSymbolMonth.set(key, (perSymbolMonth.get(key) || 0) + 1);
        }
        // Plain object, not a Map: `cached()` persists this to disk via
        // JSON.stringify (see persistCacheToDisk) — a Map serializes to "{}"
        // and silently corrupts into an unusable value on the next cold
        // read-back (confirmed for real: this bit getCoverageDetail below,
        // which consumes this same cached value, the moment a server restart
        // reloaded a Map-shaped entry from disk as a plain object and
        // `.get()` calls on it threw "not a function"). Every value handed to
        // `cached()` anywhere in this file must be JSON-safe for this reason.
        const best = {}; // ym -> max days across the 7 indices
        for (const [key, days] of perSymbolMonth) {
            const ym = key.split("|")[1];
            if (days > (best[ym] || 0)) best[ym] = days;
        }
        return best;
    });
}

/**
 * Month-by-month grid for ONE symbol, 2023-01 -> current month. Same fix as
 * getMonthlyReference above: group by the raw `trade_date` column (index-
 * ordered once `symbol` is filtered, so no filesort) instead of a computed
 * month expression, and bucket into months in JS — this is the query a
 * symbol click on the Data Coverage page actually triggers, so this one
 * being slow was reported directly as "select a symbol, wait 30s, nothing
 * happens".
 */
async function getCoverageDetail(dataType, symbol) {
    const table = tableFor(dataType);
    const displaySymbol = String(symbol || "").toUpperCase();
    if (!displaySymbol) throw Object.assign(new Error("symbol is required"), { status: 400 });

    // option_chain reads from the tiny summary table (point lookup on its
    // PRIMARY KEY's leading `symbol` column, no index-hint fragility) —
    // futures_history keeps the old raw-table path below unchanged.
    const bySymbolMonth = await cached(`detail:${dataType}:${displaySymbol}`, async () => {
        let dayRows;
        if (table === "option_chain_history") {
            [dayRows] = await pool.query(
                `SELECT trade_date, SUM(row_count) AS rows_, SUM(minute_rows) AS minuteRows
                 FROM ${SUMMARY_TABLE}
                 WHERE symbol = ? AND trade_date BETWEEN ? AND ?
                 GROUP BY trade_date`,
                [displaySymbol, COVERAGE_START, todaySql()]
            );
        } else {
            // USE INDEX forces idx_symbol_date_time — left to its own devices the
            // optimizer picked uniq_snapshot instead (probably favored for being
            // UNIQUE), which sorts by (symbol, expiry, strike, trade_date, ...) and
            // so does NOT keep trade_date contiguous for a fixed symbol, forcing a
            // "Using temporary; Using filesort" even on this single-symbol query
            // (confirmed via EXPLAIN, 2026-09-13). idx_symbol_date_time's (symbol,
            // trade_date, trade_time) order makes this a pure index scan instead.
            // No silent fallback here — if the index genuinely isn't there yet,
            // fail loudly with a clear, temporary message instead of risking a
            // repeat of the disk-exhaustion incident (see getMonthlyReference).
            try {
                [dayRows] = await pool.query(
                    withStatementTimeout(
                        `SELECT trade_date, COUNT(*) AS rows_, SUM(trade_time <> '15:30:00') AS minuteRows
                         FROM ${table} USE INDEX (${SYMBOL_DATE_TIME_INDEX[table]})
                         WHERE symbol = ? AND trade_date BETWEEN ? AND ?
                         GROUP BY trade_date`,
                        60
                    ),
                    [displaySymbol, COVERAGE_START, todaySql()]
                );
            } catch (err) {
                if (err && err.errno === 1176) {
                    throw Object.assign(
                        new Error(`per-symbol coverage detail needs the ${SYMBOL_DATE_TIME_INDEX[table]} index, which is still being built on the database — try again in a while`),
                        { status: 503 }
                    );
                }
                throw err;
            }
        }
        // Plain object, not a Map — see the comment in getMonthlyReference
        // above (this value goes through the exact same disk-cache path).
        const byMonth = {};
        for (const r of dayRows) {
            const ym = r.trade_date.slice(0, 7);
            const agg = byMonth[ym] || { rows_: 0, minuteRows: 0, days: 0 };
            agg.rows_ += Number(r.rows_);
            agg.minuteRows += Number(r.minuteRows || 0);
            agg.days += 1; // one input row per distinct trade_date, by construction
            byMonth[ym] = agg;
        }
        return byMonth;
    });
    const reference = await getMonthlyReference(dataType);

    return monthList().map((ym) => {
        const r = bySymbolMonth[ym];
        const expectedDays = reference[ym] || null;
        const days = r ? Number(r.days) : 0;
        return {
            month: ym,
            days,
            expectedDays,
            missingDays: expectedDays != null ? Math.max(0, expectedDays - days) : null,
            rows: r ? Number(r.rows_) : 0,
            minuteRows: r ? Number(r.minuteRows || 0) : 0,
            coveragePct: expectedDays ? Math.round((days / expectedDays) * 1000) / 10 : (days ? 100 : 0),
        };
    });
}

/**
 * Per symbol: does it have data for its nearest current/upcoming expiry, and
 * how stale is its most recent data? redFlag = true when either is missing/
 * stale enough to be a real gap, not just "market's closed today".
 */
async function getExpiryStatus(dataType) {
    const table = tableFor(dataType);
    return cached(`expiry:${dataType}`, async () => {
        const today = todaySql();
        // These two queries used to be the worst offenders in this file for
        // option_chain: neither has a symbol filter, and idx_symbol_date_time/
        // idx_backtest_range both lead with `symbol`, so MySQL couldn't seek —
        // confirmed via EXPLAIN (2026-09-13) that this scanned all 478M index
        // entries with no range shortcut. Now served straight off the tiny
        // summary table instead.
        const [lastRows] = await pool.query(
            `SELECT symbol, MAX(trade_date) AS lastDataDate FROM ${table === "option_chain_history" ? SUMMARY_TABLE : table} GROUP BY symbol`
        );
        const [upcomingRows] = table === "option_chain_history"
            ? await pool.query(
                `SELECT symbol, MIN(expiry_date) AS nearestExpiry FROM ${SUMMARY_TABLE} WHERE expiry_date >= ? GROUP BY symbol`,
                [today]
            )
            : await pool.query(
                `SELECT symbol, MIN(expiry) AS nearestExpiry FROM ${table} WHERE expiry >= ? GROUP BY symbol`,
                [today]
            );
        const lastBySymbol = new Map(lastRows.map((r) => [r.symbol, r.lastDataDate]));
        const upcomingBySymbol = new Map(upcomingRows.map((r) => [r.symbol, r.nearestExpiry]));

        const symbols = new Set([...lastBySymbol.keys(), ...upcomingBySymbol.keys(), ...SEVEN_INDICES]);

        const STALE_DAYS = 5; // calendar days — generous enough to cover a long weekend without a false alarm
        const staleCutoff = addDaysSql(today, -STALE_DAYS);

        return [...symbols].sort().map((symbol) => {
            const lastDataDate = lastBySymbol.get(symbol) || null;
            const nearestExpiry = upcomingBySymbol.get(symbol) || null;
            const isIndex = SEVEN_INDICES.includes(symbol);
            const noData = !lastDataDate;
            const stale = lastDataDate && lastDataDate < staleCutoff;
            const noUpcomingExpiry = !nearestExpiry;
            return {
                symbol,
                isIndex,
                lastDataDate,
                nearestExpiry,
                redFlag: noData || stale || noUpcomingExpiry,
                reason: noData ? "no data at all" : noUpcomingExpiry ? "no current/upcoming expiry in the data" : stale ? `last data is from ${lastDataDate} (>${STALE_DAYS} days old)` : null,
            };
        });
    });
}

function addDaysSql(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Option-chain-only: per symbol, what fraction of recent rows have Greeks
 * computed. Futures never carry Greeks by design.
 *
 * Used to be ONE ungrouped-by-symbol WHERE trade_date >= ? scan — confirmed
 * via EXPLAIN (2026-09-13) that with no symbol filter, NONE of this table's
 * indexes lead with trade_date, so MySQL can't range-seek into the last 90
 * days at all: it scans all 478M index entries checking the date on every
 * one ("Using where" with no "Using index for group-by"/loose-scan shortcut,
 * rows estimate = the full table). Rewritten to loop per known symbol
 * instead: WITH a symbol filter, idx_symbol_date_time's (symbol, trade_date,
 * ...) prefix lets MySQL seek straight to that symbol's last-90-days range
 * (confirmed via EXPLAIN: "range" scan, ~5.6M rows for NIFTY alone instead
 * of 478M for the whole table) — one bounded query per symbol instead of one
 * unbounded scan of everything. Run with limited concurrency (the DB pool
 * itself caps at 10 connections) rather than serially one-by-one.
 */
async function getGreeksCoverage() {
    return cached("greeks", async () => {
        const since = addDaysSql(todaySql(), -90);
        const { indices = [], stocks = [] } = await optionChainService.listSymbols();
        const symbols = [...indices, ...stocks];

        const results = [];
        const CONCURRENCY = 8;
        for (let i = 0; i < symbols.length; i += CONCURRENCY) {
            const batch = symbols.slice(i, i + CONCURRENCY);
            const batchRows = await Promise.all(
                batch.map(async (symbol) => {
                    const [[row]] = await pool.query(
                        `SELECT COUNT(*) AS totalRows,
                                SUM(ce_delta IS NOT NULL OR pe_delta IS NOT NULL) AS rowsWithGreeks
                         FROM option_chain_history
                         WHERE symbol = ? AND trade_date >= ?`,
                        [symbol, since]
                    );
                    return { symbol, row };
                })
            );
            results.push(...batchRows);
        }

        return results
            .filter(({ row }) => Number(row.totalRows) > 0) // match the old GROUP BY's behavior: only symbols with rows in-window
            .map(({ symbol, row }) => {
                const total = Number(row.totalRows);
                const withGreeks = Number(row.rowsWithGreeks || 0);
                return {
                    symbol,
                    totalRows: total,
                    rowsWithGreeks: withGreeks,
                    pct: total ? Math.round((withGreeks / total) * 1000) / 10 : 0,
                    redFlag: total > 0 && withGreeks === 0,
                };
            })
            .sort((a, b) => a.symbol.localeCompare(b.symbol));
    });
}

// Pre-computes every cache this file serves, sequentially (not in parallel —
// these are all expensive full/near-full-table scans; running them at once
// would just contend for the same DB connections/IO and take just as long
// while looking busier). Call once at server boot (see server.js) so the
// FIRST admin to open a Data-section page never eats a cold-cache scan —
// exactly the "30s, nothing happened" complaint this file's getMonthlyReference
// comment above describes. Errors are logged, never thrown — a slow/failed
// warm-up must not block server startup; the page just falls back to its
// normal lazy on-demand load.
async function warmCoverageCache() {
    for (const dataType of Object.keys(TABLES)) {
        try {
            await getCoverageSummary(dataType);
            await getMonthlyReference(dataType);
            await getExpiryStatus(dataType);
        } catch (err) {
            console.error(`[dataCoverageService] warm-up failed for ${dataType}:`, err.message);
        }
    }
    try {
        await getGreeksCoverage();
    } catch (err) {
        console.error("[dataCoverageService] Greeks coverage warm-up failed:", err.message);
    }
}

module.exports = {
    COVERAGE_START,
    SEVEN_INDICES,
    getCoverageSummary,
    getCoverageDetail,
    getExpiryStatus,
    getGreeksCoverage,
    invalidateCoverageCache: invalidate,
    warmCoverageCache,
};
