// scripts/showOptionChainHistory.js — quick visibility into what's actually
// stored in option_chain_history right now, across all four Phase 7 sources
// (Angel One nightly cron, NSE/BSE Bhavcopy, Upstox, Breeze) combined — the
// table doesn't distinguish which source wrote which row (that's the point
// of the schema's ON DUPLICATE KEY UPDATE design, see CLAUDE.md Phase 7).
//
// Usage:
//   node scripts/showOptionChainHistory.js                 — summary across every symbol
//   node scripts/showOptionChainHistory.js NIFTY            — per-day detail for one symbol
//   node scripts/showOptionChainHistory.js NIFTY 2026-07-01 — detail for one symbol + date (first few rows)

require("dotenv").config();
const { pool } = require("../config/db");

async function showSummary() {
    const [rows] = await pool.query(
        `SELECT symbol,
                COUNT(*) AS totalRows,
                COUNT(DISTINCT trade_date) AS days,
                MIN(trade_date) AS firstDate,
                MAX(trade_date) AS lastDate
         FROM option_chain_history
         GROUP BY symbol
         ORDER BY totalRows DESC`
    );

    if (!rows.length) {
        console.log("option_chain_history is EMPTY — no backfill has written anything yet.");
        console.log("Run one of the Phase 7 scripts first, e.g.:");
        console.log("  node scripts/backfillBhavcopy.js NIFTY 1");
        return;
    }

    console.log(`option_chain_history: ${rows.length} distinct symbol(s) found\n`);
    console.log("SYMBOL".padEnd(14) + "ROWS".padStart(10) + "DAYS".padStart(8) + "  FIRST DATE   LAST DATE");
    console.log("-".repeat(60));
    for (const r of rows) {
        console.log(
            r.symbol.padEnd(14) +
                String(r.totalRows).padStart(10) +
                String(r.days).padStart(8) +
                `  ${r.firstDate}   ${r.lastDate}`
        );
    }
    console.log(`\nRun "node scripts/showOptionChainHistory.js <SYMBOL>" for per-day detail on one symbol.`);
}

async function showSymbolDetail(symbol) {
    const [rows] = await pool.query(
        `SELECT trade_date,
                COUNT(DISTINCT trade_time) AS snapshotCount,
                COUNT(DISTINCT expiry) AS expiryCount,
                COUNT(DISTINCT strike) AS strikeCount,
                MIN(trade_time) AS firstTime,
                MAX(trade_time) AS lastTime
         FROM option_chain_history
         WHERE symbol = ?
         GROUP BY trade_date
         ORDER BY trade_date DESC`,
        [symbol]
    );

    if (!rows.length) {
        console.log(`No stored option data for ${symbol}.`);
        return;
    }

    const dense = rows.filter((r) => r.snapshotCount > 1).length;
    const sparse = rows.length - dense;
    console.log(`${symbol}: ${rows.length} trading days stored (${dense} with per-minute data, ${sparse} EOD-only)\n`);
    console.log("DATE".padEnd(14) + "SNAPSHOTS".padStart(11) + "  RANGE".padEnd(20) + "EXPIRIES".padStart(10) + "STRIKES".padStart(10));
    console.log("-".repeat(70));
    for (const r of rows.slice(0, 40)) {
        const flag = r.snapshotCount <= 1 ? " (EOD-only)" : "";
        console.log(
            r.trade_date.padEnd(14) +
                String(r.snapshotCount).padStart(11) +
                `  ${r.firstTime}-${r.lastTime}`.padEnd(20) +
                String(r.expiryCount).padStart(10) +
                String(r.strikeCount).padStart(10) +
                flag
        );
    }
    if (rows.length > 40) console.log(`... and ${rows.length - 40} more days (showing most recent 40)`);
}

// Implements the third usage mode the header comment already promised but
// main() never actually wired up — proves minute-by-minute granularity for
// one specific date by printing the real distinct trade_time values stored
// (not just a count), plus a sample contract's LTP series across those
// times, so it's visible by eye rather than inferred from a snapshot count.
async function showDateDetail(symbol, date) {
    const [timeRows] = await pool.query(
        `SELECT DISTINCT trade_time FROM option_chain_history
         WHERE symbol = ? AND trade_date = ? ORDER BY trade_time`,
        [symbol, date]
    );

    if (!timeRows.length) {
        console.log(`No stored option data for ${symbol} on ${date}.`);
        return;
    }

    const times = timeRows.map((r) => r.trade_time);
    console.log(`${symbol} ${date}: ${times.length} distinct trade_time snapshot(s) stored\n`);
    if (times.length <= 1) {
        console.log(`Only ${times.join(", ")} — this is an EOD-only row (Bhavcopy), not minute-by-minute data.`);
        return;
    }

    console.log("First 10 times: " + times.slice(0, 10).join(", "));
    console.log("Last 10 times:  " + times.slice(-10).join(", "));

    // Pick the (expiry, strike) pair with the MOST stored snapshots that
    // date — a plain `LIMIT 1` can land on a far-OTM strike that Bhavcopy
    // discovered but a minute-level source never enriched (those strikes
    // stay EOD-only by design, see backfillUpstox.js's STRIKES_PER_SIDE
    // window), which would show a misleadingly sparse sample. Ranking by
    // snapshot count guarantees we print a contract that's actually dense,
    // if one exists for this date at all.
    const [sampleRows] = await pool.query(
        `SELECT expiry, strike, COUNT(*) AS snapshots FROM option_chain_history
         WHERE symbol = ? AND trade_date = ?
         GROUP BY expiry, strike ORDER BY snapshots DESC LIMIT 1`,
        [symbol, date]
    );
    if (!sampleRows.length) return;
    const { expiry, strike, snapshots } = sampleRows[0];
    console.log(`(densest contract that date: ${snapshots} snapshots)`);

    const [ltpRows] = await pool.query(
        `SELECT trade_time, ce_ltp, pe_ltp, ce_iv, pe_iv FROM option_chain_history
         WHERE symbol = ? AND trade_date = ? AND expiry = ? AND strike = ?
         ORDER BY trade_time LIMIT 15`,
        [symbol, date, expiry, strike]
    );
    console.log(`\nSample contract ${symbol} ${expiry} ${strike} — first ${ltpRows.length} minutes:`);
    console.log("TIME".padEnd(12) + "CE_LTP".padStart(10) + "PE_LTP".padStart(10) + "CE_IV".padStart(9) + "PE_IV".padStart(9));
    console.log("-".repeat(50));
    for (const r of ltpRows) {
        console.log(
            String(r.trade_time).padEnd(12) +
                String(r.ce_ltp ?? "-").padStart(10) +
                String(r.pe_ltp ?? "-").padStart(10) +
                String(r.ce_iv ?? "-").padStart(9) +
                String(r.pe_iv ?? "-").padStart(9)
        );
    }
}

async function main() {
    const symbol = process.argv[2] ? process.argv[2].toUpperCase() : null;
    const date = process.argv[3] || null;
    if (symbol && date) {
        await showDateDetail(symbol, date);
    } else if (symbol) {
        await showSymbolDetail(symbol);
    } else {
        await showSummary();
    }
    await pool.end();
}

main().catch((err) => {
    console.error("[show-history] fatal:", err.message);
    process.exit(1);
});
