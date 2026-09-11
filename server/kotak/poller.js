// kotak/poller.js — standalone Kotak Neo market-data poller.
//
// Run separately from Express (like `npm run worker` for Angel One):
//   npm run kotak                       (KOTAK_MODE=all — indices + stocks)
//   KOTAK_MODE=index npm run kotak      (only the 7 F&O indices, fast)
//   KOTAK_MODE=stock npm run kotak      (only the ~210 F&O stocks, slow sweep)
//   pm2 start kotak/poller.js --name kotak-poller --time
//
// Talks ONLY to Kotak's REST API + MySQL. Does NOT touch Express, the Angel
// One worker, marketCache or socket.io. Second independent writer into
// option_chain_history + ohlcv_data.
//
// Two tiers run concurrently (see config/kotak.js `tiers`):
//   INDEX tier  — all 7 indices + India VIX, every ~15s (they're cheap)
//   STOCK tier  — ~210 stocks as a ROLLING sweep: each step polls a slice,
//                 the whole universe comes around every ~5 min. This keeps
//                 total REST volume to a few req/s, well under the limit —
//                 a fast full sweep of 210 chains would be thousands of calls.
//
// HISTORICAL: Kotak has NO historical/candle API ("not allowed for this
// platform"). This poller is the forward historian — every day it runs, it
// appends real minute snapshots, building a self-recorded history from the
// day it's switched on. True back-history stays on the Phase 7 sources.

require("dotenv").config();

const cfg = require("../config/kotak");
const { getSession } = require("./auth");
const instruments = require("./instruments");
const { buildChainSnapshot, getVix, getFuture } = require("./marketData");
const repo = require("./repo");
const { pool } = require("../config/db");
const { workerLogger } = require("../config/logger");

// Rough NSE/BSE cash-market hours in IST (both exchanges: 09:15–15:30).
function marketOpen(d = new Date()) {
    const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
    const day = ist.getUTCDay();
    if (day === 0 || day === 6) return false;
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopping = false;

// ---------------------------------------------------------------------------
// One underlying: chain -> option_chain_history, spot -> ohlcv_data,
// nearest future -> ohlcv_data (<SYM>FUT).
// ---------------------------------------------------------------------------

async function pollUnderlying(symbol, { withFuture = true } = {}) {
    try {
        const chain = await buildChainSnapshot(symbol);
        const stored = await repo.saveChainSnapshot(chain);
        await repo.saveSpot(symbol, chain.spotQuote || { ltp: chain.spot }, chain.snapshotAt);
        workerLogger.info(`[kotak] ${symbol} ${chain.expiry}: ${stored} strikes (spot ${chain.spot})`);
    } catch (err) {
        workerLogger.error(`[kotak] ${symbol} chain failed: ${err.message}`);
    }
    if (!withFuture) return;
    try {
        const fut = await getFuture(symbol);
        if (fut) await repo.saveFuture(symbol, fut);
    } catch (err) {
        workerLogger.error(`[kotak] ${symbol} future failed: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// INDEX tier
// ---------------------------------------------------------------------------

async function indexTier() {
    const symbols = await instruments.listIndices();
    workerLogger.info(`[kotak] index tier: ${symbols.join(", ")} every ${cfg.tiers.index.intervalMs}ms`);

    while (!stopping) {
        const started = Date.now();
        if (marketOpen()) {
            try {
                const vix = await getVix();
                if (vix) {
                    await repo.saveVix(vix);
                    workerLogger.info(`[kotak] India VIX ${vix.ltp}`);
                }
            } catch (err) {
                workerLogger.error(`[kotak] VIX failed: ${err.message}`);
            }
            for (const s of symbols) {
                if (stopping) break;
                await pollUnderlying(s);
            }
        }
        await sleep(Math.max(1000, cfg.tiers.index.intervalMs - (Date.now() - started)));
    }
}

// ---------------------------------------------------------------------------
// STOCK tier — rolling sweep
// ---------------------------------------------------------------------------

async function stockTier() {
    let symbols = await instruments.listStocks();
    if (!symbols.length) {
        workerLogger.warn("[kotak] stock tier: no F&O stocks resolved — tier idle");
        return;
    }
    const { perStep, sweepTargetMs } = cfg.tiers.stock;
    const steps = Math.ceil(symbols.length / perStep);
    const stepSleep = Math.max(1500, Math.floor(sweepTargetMs / steps));
    workerLogger.info(
        `[kotak] stock tier: ${symbols.length} stocks, ${perStep}/step, step every ${stepSleep}ms (~${Math.round(sweepTargetMs / 60000)}min/sweep)`
    );

    let cursor = 0;
    while (!stopping) {
        const started = Date.now();
        if (marketOpen()) {
            const slice = symbols.slice(cursor, cursor + perStep);
            for (const s of slice) {
                if (stopping) break;
                await pollUnderlying(s, { withFuture: false }); // stock futures optional; skip to save calls
            }
            cursor += perStep;
            if (cursor >= symbols.length) {
                cursor = 0;
                // refresh the universe once per full sweep (handles master roll)
                symbols = await instruments.listStocks().catch(() => symbols);
            }
        }
        await sleep(Math.max(1000, stepSleep - (Date.now() - started)));
    }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function main() {
    workerLogger.info(`[kotak] poller starting (pid ${process.pid}, mode=${cfg.mode})`);
    await getSession(); // fail fast on bad credentials
    await instruments.ensureLoaded().catch((e) => workerLogger.warn(`[kotak] scrip master warm failed: ${e.message}`));

    const jobs = [];
    if (cfg.mode === "all" || cfg.mode === "index") jobs.push(indexTier());
    if (cfg.mode === "all" || cfg.mode === "stock") jobs.push(stockTier());
    await Promise.all(jobs);
}

async function shutdown(origin) {
    if (stopping) return;
    stopping = true;
    workerLogger.info(`[kotak] poller shutting down (${origin})`);
    await sleep(200);
    try {
        await pool.end();
    } catch {
        /* ignore */
    }
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
    workerLogger.error(`[kotak] uncaught: ${err.stack || err.message}`);
    shutdown("uncaughtException");
});

if (require.main === module) {
    main().catch((err) => {
        workerLogger.error(`[kotak] fatal: ${err.stack || err.message}`);
        process.exit(1);
    });
}

module.exports = { pollUnderlying, marketOpen, indexTier, stockTier };
