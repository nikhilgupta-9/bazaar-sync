// workers/marketWorker.js — dedicated market-data process.
//
// Run standalone (`node workers/marketWorker.js`) or forked from the Express
// process by cron/marketStart.js. This process:
//   1. logs in to Angel One SmartAPI (workers/login.js — TOTP, no manual step)
//   2. connects the WebSocket feed (workers/websocket.js)
//   3. subscribes NIFTY/BANKNIFTY/FINNIFTY spot + their option chains
//      (tokens resolved from the instrument master, strikes around ATM)
//   4. validates every tick, pushes it into the buffer (workers/buffer.js),
//      which bulk-inserts tiered snapshots via workers/databaseWriter.js
//   5. if forked, sends lightweight latest-tick summaries up over IPC
//      (process.send) — never the whole buffer, never any auth token
//
// HARD RULE: nothing here requires express, touches req/res, or serves HTTP.
// The only outbound surfaces are MySQL (own pool — own process) and IPC.
//
// Storage tiers (see schema.sql):
//   live_index_ticks       per symbol, one row/minute (first tick after the
//                          minute rolls over — was every tick until
//                          2026-08-12, a real driver of DB disk growth)
//   live_option_ticks      per option token, one row/minute (same fix; was
//                          "at most every 2s", a fixed-interval throttle,
//                          not minute-aligned)
//   live_greeks_snapshots  per option token, every 5 s (IV/greeks computed here)
//   pcr_snapshots          per symbol, every 60 s
//   oi_summary_snapshots   per symbol+strike, every 60 s

require("dotenv").config();

const { getSession, logout } = require("./login");
const { AngelOneWebSocket, MODE, EXCHANGE } = require("./websocket");
const { TickBuffer } = require("./buffer");
const { closePool } = require("./databaseWriter");
const instrumentMaster = require("../services/instrumentMaster");
const bs = require("../utils/blackScholes");
const { workerLogger } = require("../config/logger");

const SYMBOLS = (process.env.WORKER_SYMBOLS || "NIFTY,BANKNIFTY,FINNIFTY")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

// How many strikes either side of ATM to subscribe per symbol. 3 symbols x
// (2*15+1) strikes x 2 rights ≈ 186 option tokens + 3 index tokens + 1 VIX
// token + 3 future tokens ≈ 193 total — well inside Angel One's
// 1000-tokens-per-connection quota. There's headroom left in that budget,
// but NOT enough to subscribe every listed expiry's full strike range live
// for all 3 symbols simultaneously (would run into the thousands) — only the
// nearest expiry is subscribed live per symbol; other expiries fall back to
// historical data (see optionChainService.js).
const STRIKES_PER_SIDE = Number(process.env.WORKER_STRIKES_PER_SIDE || 15);

const GREEKS_INTERVAL_MS = 5000;
const MINUTE_INTERVAL_MS = 60000;
const IPC_SUMMARY_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const buffer = new TickBuffer();
const ws = new AngelOneWebSocket(getSession);

// token -> { meta, ltp, volume, oi, oiChangePercent, open, high, low, close,
//            exchangeTimestamp, updatedAt, lastPersistedMinute }
const latest = new Map();
// token -> meta ({ kind:'index'|'option', underlying, strike, right, expiry, lotSize })
const tokenMeta = new Map();
// underlying -> latest spot ltp
const spot = new Map();
// underlying -> "YYYY-MM-DD HH:MM" of the last persisted live_index_ticks
// row for it — see the tick handler below for why this replaced "every tick".
const lastPersistedIndexMinute = new Map();
// tokens changed since the last IPC summary
const dirtyTokens = new Set();
// underlyings whose option chain subscription is done/in-flight
const optionsSubscribed = new Set();

let shuttingDown = false;

// ---------------------------------------------------------------------------
// Time helpers — IST date/time strings from an epoch-ms value, computed via
// explicit UTC arithmetic (project rule: no local-timezone Date methods).
// ---------------------------------------------------------------------------

function istParts(epochMs) {
    const d = new Date(epochMs + 5.5 * 60 * 60 * 1000);
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const time = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
    return { date, time };
}

// ---------------------------------------------------------------------------
// Subscription setup
// ---------------------------------------------------------------------------

function subscribeIndices() {
    const tokens = [];
    for (const sym of SYMBOLS) {
        const token = instrumentMaster.getIndexToken(sym);
        if (!token) {
            workerLogger.error(`No index token configured for ${sym} — skipping`);
            continue;
        }
        tokenMeta.set(token, { kind: "index", underlying: sym });
        tokens.push(token);
    }
    // QUOTE mode gives OHLC alongside LTP for the index tiles
    ws.subscribe(MODE.QUOTE, EXCHANGE.NSE_CM, tokens);
}

// India VIX — single persistent index, no per-symbol expiry logic needed.
// Not persisted to MySQL (no schema tier for it yet); only cached in-memory
// and pushed over IPC for the option-chain header display.
function subscribeVix() {
    const token = instrumentMaster.getVixToken();
    if (!token) {
        workerLogger.error("No India VIX token configured — skipping");
        return;
    }
    tokenMeta.set(token, { kind: "vix", underlying: "INDIAVIX" });
    ws.subscribe(MODE.QUOTE, EXCHANGE.NSE_CM, [token]);
}

// Nearest (front-month) future contract per symbol — resolved once at
// startup from the scrip master (no spot price needed, unlike options).
// Also not persisted yet; cached + IPC'd only, same as VIX.
async function subscribeFutures() {
    for (const sym of SYMBOLS) {
        try {
            const future = await instrumentMaster.getNearestFuture(sym);
            if (!future) {
                workerLogger.error(`No future contract found for ${sym} — skipping`);
                continue;
            }
            tokenMeta.set(future.token, {
                kind: "future",
                underlying: sym,
                expiry: future.expiry,
                lotSize: future.lotSize,
            });
            ws.subscribe(MODE.QUOTE, EXCHANGE.NSE_FO, [future.token]);
            workerLogger.info(`${sym}: subscribed future contract (expiry ${future.expiry})`);
        } catch (err) {
            workerLogger.error(`Future subscription failed for ${sym}: ${err.message}`);
        }
    }
}

/**
 * Once we know an index's spot price (from its first tick), pick the nearest
 * expiry and subscribe strikes around ATM in SnapQuote mode (needed for OI).
 */
async function subscribeOptionsFor(underlying, spotPrice) {
    if (optionsSubscribed.has(underlying)) return;
    optionsSubscribed.add(underlying);

    try {
        const expiries = await instrumentMaster.getExpiries(underlying);
        if (!expiries.length) {
            workerLogger.error(`No live expiries in scrip master for ${underlying}`);
            optionsSubscribed.delete(underlying); // allow retry on a later tick
            return;
        }
        const nearest = expiries[0];
        const contracts = await instrumentMaster.getOptionContracts(underlying, nearest, {
            centerPrice: spotPrice,
            strikesPerSide: STRIKES_PER_SIDE,
        });

        for (const c of contracts) {
            tokenMeta.set(c.token, {
                kind: "option",
                underlying,
                strike: c.strike,
                right: c.right,
                expiry: c.expiry,
                lotSize: c.lotSize,
            });
        }
        ws.subscribe(
            MODE.SNAP_QUOTE,
            EXCHANGE.NSE_FO,
            contracts.map((c) => c.token)
        );
        workerLogger.info(
            `${underlying}: subscribed ${contracts.length} option contracts (expiry ${nearest}, ATM ~${spotPrice})`
        );
    } catch (err) {
        workerLogger.error(`Option subscription failed for ${underlying}: ${err.message}`);
        optionsSubscribed.delete(underlying); // retry on a later index tick
    }
}

// ---------------------------------------------------------------------------
// Tick handling
// ---------------------------------------------------------------------------

function isValidTick(tick) {
    if (!tick || !tick.token) return false;
    if (!Number.isFinite(tick.ltp) || tick.ltp <= 0) return false;
    if (tick.oi != null && (!Number.isFinite(tick.oi) || tick.oi < 0)) return false;
    if (tick.volume != null && (!Number.isFinite(tick.volume) || tick.volume < 0)) return false;
    return true;
}

ws.on("tick", (tick) => {
    if (!isValidTick(tick)) {
        workerLogger.debug(`Rejected malformed tick for token ${tick && tick.token}`);
        return;
    }
    const meta = tokenMeta.get(tick.token);
    if (!meta) return; // tick for something we didn't (knowingly) subscribe

    const now = Date.now();
    const ts = tick.exchangeTimestamp > 0 ? tick.exchangeTimestamp : now;
    const prev = latest.get(tick.token);
    const entry = {
        meta,
        ltp: tick.ltp,
        volume: tick.volume ?? (prev ? prev.volume : null),
        oi: tick.oi ?? (prev ? prev.oi : null),
        oiChangePercent: tick.oiChangePercent ?? (prev ? prev.oiChangePercent : null),
        open: tick.open ?? (prev ? prev.open : null),
        high: tick.high ?? (prev ? prev.high : null),
        low: tick.low ?? (prev ? prev.low : null),
        close: tick.close ?? (prev ? prev.close : null),
        exchangeTimestamp: ts,
        updatedAt: now,
        lastPersistedMinute: prev ? prev.lastPersistedMinute : null,
    };
    latest.set(tick.token, entry);
    dirtyTokens.add(tick.token);

    const { date, time } = istParts(ts);
    // "YYYY-MM-DD HH:MM" — every tick within the same minute maps to the
    // same key, so comparing against the last-persisted key is exactly
    // "have we already saved a row for this minute" without needing a
    // separate timer or rounding trick.
    const minuteKey = `${date} ${time.slice(0, 5)}`;

    if (meta.kind === "index") {
        spot.set(meta.underlying, tick.ltp);
        // Tier 1: one row per minute, the FIRST tick seen once the minute
        // rolls over — not every tick (was: every single tick, which at
        // Angel One's real feed rate meant many rows per minute and was a
        // real driver of the DB's disk growth). Deliberately keeps
        // whichever tick happens to arrive first in the new minute rather
        // than the tick closest to :00 seconds — "first data for the
        // minute", matching what was asked for, not a synthetic sample.
        if (lastPersistedIndexMinute.get(meta.underlying) !== minuteKey) {
            lastPersistedIndexMinute.set(meta.underlying, minuteKey);
            buffer.push(
                "live_index_ticks",
                ["symbol", "tick_date", "tick_time", "ltp", "open", "high", "low", "close", "volume", "exchange_ts"],
                [meta.underlying, date, time, tick.ltp, entry.open, entry.high, entry.low, entry.close, entry.volume, ts]
            );
        }
        // First sight of a spot price unlocks the option-chain subscription
        subscribeOptionsFor(meta.underlying, tick.ltp);
    } else if (meta.kind === "vix" || meta.kind === "future") {
        // Cached in `latest` (above) + sent over IPC (sendTickSummary) only —
        // no persistence tier for these yet, same as the option-chain header
        // display doesn't need history for them.
    } else {
        // Tier 2: same "first tick of the minute" rule as the index tier
        // above — was "at most every 2s per token" (a fixed-interval
        // throttle, not minute-aligned, and still up to 30 rows/min/token).
        if (entry.lastPersistedMinute !== minuteKey) {
            entry.lastPersistedMinute = minuteKey;
            buffer.push(
                "live_option_ticks",
                ["underlying", "expiry", "strike", "opt_right", "tick_date", "tick_time", "ltp", "volume", "oi", "oi_change_percent"],
                [meta.underlying, meta.expiry, meta.strike, meta.right, date, time, tick.ltp, entry.volume, entry.oi, entry.oiChangePercent]
            );
        }
    }
});

ws.on("open", () => sendIpc({ type: "worker:status", status: "feed-connected" }));
ws.on("close", () => sendIpc({ type: "worker:status", status: "feed-disconnected" }));

// ---------------------------------------------------------------------------
// Tier 3: greeks every 5 s
// ---------------------------------------------------------------------------

function snapshotGreeks() {
    const now = Date.now();
    const { date, time } = istParts(now);
    for (const [, entry] of latest) {
        const m = entry.meta;
        if (m.kind !== "option") continue;
        if (now - entry.updatedAt > 2 * GREEKS_INTERVAL_MS) continue; // stale token, skip
        const spotPrice = spot.get(m.underlying);
        if (!spotPrice) continue;

        const t = bs.yearsToExpiry(m.expiry);
        const right = m.right === "CE" ? "call" : "put";
        const iv = bs.impliedVolatility({ marketPrice: entry.ltp, spot: spotPrice, strike: m.strike, t, right });
        if (!iv) continue;
        const g = bs.greeks({ spot: spotPrice, strike: m.strike, t, vol: iv, right });

        buffer.push(
            "live_greeks_snapshots",
            ["underlying", "expiry", "strike", "opt_right", "snap_date", "snap_time", "ltp", "spot", "iv", "delta", "gamma", "theta", "vega"],
            [
                m.underlying, m.expiry, m.strike, m.right, date, time,
                entry.ltp, spotPrice,
                Number((iv * 100).toFixed(2)),
                Number(g.delta.toFixed(4)),
                Number(g.gamma.toFixed(6)),
                Number(g.theta.toFixed(4)),
                Number(g.vega.toFixed(4)),
            ]
        );
    }
}

// ---------------------------------------------------------------------------
// Tiers 4+5: PCR and OI summary, every 60 s
// ---------------------------------------------------------------------------

function snapshotMinuteAggregates() {
    const now = Date.now();
    const { date, time } = istParts(now);

    for (const sym of SYMBOLS) {
        // strike -> { ceOi, peOi, ceLtp, peLtp, expiry }
        const byStrike = new Map();
        let totalCeOi = 0;
        let totalPeOi = 0;

        for (const [, entry] of latest) {
            const m = entry.meta;
            if (m.kind !== "option" || m.underlying !== sym) continue;
            let row = byStrike.get(m.strike);
            if (!row) {
                row = { ceOi: null, peOi: null, ceLtp: null, peLtp: null, expiry: m.expiry };
                byStrike.set(m.strike, row);
            }
            if (m.right === "CE") {
                row.ceOi = entry.oi;
                row.ceLtp = entry.ltp;
                totalCeOi += entry.oi || 0;
            } else {
                row.peOi = entry.oi;
                row.peLtp = entry.ltp;
                totalPeOi += entry.oi || 0;
            }
        }
        if (byStrike.size === 0) continue;

        const pcr = totalCeOi > 0 ? Number((totalPeOi / totalCeOi).toFixed(4)) : null;
        buffer.push(
            "pcr_snapshots",
            ["symbol", "snap_date", "snap_time", "pcr", "total_ce_oi", "total_pe_oi", "spot"],
            [sym, date, time, pcr, totalCeOi, totalPeOi, spot.get(sym) ?? null]
        );

        for (const [strike, row] of byStrike) {
            buffer.push(
                "oi_summary_snapshots",
                ["symbol", "expiry", "strike", "snap_date", "snap_time", "ce_oi", "pe_oi", "ce_ltp", "pe_ltp"],
                [sym, row.expiry, strike, date, time, row.ceOi, row.peOi, row.ceLtp, row.peLtp]
            );
        }
    }
}

// ---------------------------------------------------------------------------
// IPC: lightweight latest-tick summaries to the parent (Express) process.
// Only sent when actually forked (process.send exists). Auth tokens are
// never included — only market data + instrument metadata.
// ---------------------------------------------------------------------------

function sendIpc(msg) {
    if (typeof process.send === "function") {
        try {
            process.send(msg);
        } catch (_) {
            /* parent gone — the crons/PM2 own our lifecycle, keep running */
        }
    }
}

function sendTickSummary() {
    if (dirtyTokens.size === 0) return;
    const ticks = [];
    for (const token of dirtyTokens) {
        const entry = latest.get(token);
        if (!entry) continue;
        const m = entry.meta;
        ticks.push({
            token,
            kind: m.kind,
            underlying: m.underlying,
            strike: m.strike ?? null,
            right: m.right ?? null,
            expiry: m.expiry ?? null,
            lotSize: m.lotSize ?? null,
            ltp: entry.ltp,
            volume: entry.volume,
            oi: entry.oi,
            oiChangePercent: entry.oiChangePercent,
            timestamp: entry.exchangeTimestamp,
        });
    }
    dirtyTokens.clear();
    if (ticks.length) sendIpc({ type: "worker:ticks", ticks });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const timers = [];

async function shutdown(origin) {
    if (shuttingDown) return;
    shuttingDown = true;
    workerLogger.info(`Market worker shutting down (${origin})`);
    sendIpc({ type: "worker:status", status: "shutting-down" });

    for (const t of timers) clearInterval(t);
    ws.close();
    buffer.stop();
    try {
        await buffer.flush("shutdown"); // drain any partial batch
    } catch (err) {
        workerLogger.error(`Final flush failed: ${err.message}`);
    }
    await logout().catch(() => {});
    await closePool().catch(() => {});
    workerLogger.info("Market worker exited cleanly");
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("message", (msg) => {
    if (msg && msg.type === "shutdown") shutdown("IPC shutdown message");
});
process.on("uncaughtException", (err) => {
    workerLogger.error(`Uncaught exception: ${err.stack || err.message}`);
    // Let the parent's refork logic / PM2 restart us in a clean state
    shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => {
    workerLogger.error(`Unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
});

async function main() {
    workerLogger.info(`Market worker starting (pid ${process.pid}, symbols: ${SYMBOLS.join(", ")})`);
    sendIpc({ type: "worker:status", status: "starting" });

    buffer.start();

    // Warm the instrument master before connecting — but a failure here must
    // not kill the process; option discovery retries on later index ticks.
    try {
        await instrumentMaster.ensureLoaded();
    } catch (err) {
        workerLogger.error(`Instrument master load failed (will retry on demand): ${err.message}`);
    }

    subscribeIndices(); // remembered; actually sent once the socket opens
    subscribeVix();
    await subscribeFutures();
    await ws.connect(); // login failures inside are logged + retried with backoff

    timers.push(setInterval(snapshotGreeks, GREEKS_INTERVAL_MS));
    timers.push(setInterval(snapshotMinuteAggregates, MINUTE_INTERVAL_MS));
    timers.push(setInterval(sendTickSummary, IPC_SUMMARY_INTERVAL_MS));

    sendIpc({ type: "worker:status", status: "started" });
}

main().catch((err) => {
    workerLogger.error(`Market worker failed to start: ${err.stack || err.message}`);
    shutdown("startup failure");
});
