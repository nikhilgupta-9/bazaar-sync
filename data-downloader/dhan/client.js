// dhan/client.js — thin REST client for Dhan API v2.
//
// Auth confirmed for real (2026-09-14): headers "access-token" + "client-id"
// both work (docs also mention "dhanClientId" — that spelling works too, but
// "client-id" is what's used everywhere here since it was the first one
// confirmed live). DHAN_ACCESS_TOKEN is a JWT that, for a token generated via
// Dhan's Partner/consent flow, expires in as little as 24h (confirmed: a
// real token's own `exp` claim was exactly iat+24h) — DHAN_ACCESS_TOKEN
// should be a personal long-lived access token (Dhan app: Profile ->
// DhanHQ Trading APIs -> Generate Token) for anything that needs to keep
// running across days, which every pipeline in this folder does. If every
// call here starts failing with DH-901, that's almost certainly the token
// having expired — regenerate it, there is no automatic refresh.
//
// Rate limiting: Dhan's own docs are vague here (no limit stated for
// minute/hour timeframe endpoints, a "5 req/sec" figure mentioned only for
// "seconds" timeframe, ~100,000 req/day mentioned once). CONFIRMED FOR REAL
// (2026-09-19): a 6-concurrent / 6-req-s run against /charts/rollingoption
// hit DH-904 "Too many requests" on the very FIRST batch of calls — the
// real per-endpoint limit is materially tighter than the general API budget
// the docs imply. Defaults dropped to 2 req/s / 2 concurrent (see
// enrichOptions.js's OPTIONS_CONCURRENCY) until a real ceiling is found by
// testing upward from here. On a 429, ALL callers now back off together via
// a shared `cooldownUntil` (see throttle() below) instead of each in-flight
// request retrying independently — with concurrency > 1, independent
// per-request backoff meant every worker re-hit the limit at roughly the
// same moment, burning all 5 retries in the confirmed real failure above
// without ever actually spacing requests out.

const axios = require("axios");

const BASE_URL = process.env.DHAN_BASE_URL || "https://api.dhan.co/v2";
const MAX_RETRIES = Number(process.env.DHAN_MAX_RETRIES || 5);
const MIN_COOLDOWN_MS = Number(process.env.DHAN_MIN_COOLDOWN_MS || 3000);
const MAX_COOLDOWN_MS = Number(process.env.DHAN_MAX_COOLDOWN_MS || 60000);

// Adaptive dispatch rate (AIMD, same idea as TCP congestion control) instead
// of a fixed guessed req/s number — found empirically (2026-09-19) that a
// fixed conservative value either wastes throughput (too low) or 429s
// immediately (too high), and Dhan states no real number for this endpoint.
// Starts at DHAN_MAX_REQ_PER_SEC (default 2, known-safe from the real 429
// test), climbs by +1 after DHAN_RATE_RAMPUP_EVERY consecutive 200s (default
// 25) up to DHAN_MAX_REQ_PER_SEC_CEILING (default 8), and on a 429 is HALVED
// immediately (floor 1). This converges toward Dhan's real sustained rate
// over a run instead of a human guessing it call by call.
// CONFIRMED FOR REAL (2026-09-21): even at the floor, sustained 429s kept
// happening — visible only after the retry-cooldown logging (added
// alongside this) made it clear the run wasn't hung, it was silently
// re-hitting the limit over and over. A floor of 1 req/s assumed Dhan's
// real sustained rate was AT LEAST 1/s; that assumption was wrong (or a
// day of heavy testing pushed this account into a stricter, possibly
// account-level, throttle window that plain per-second pacing can't see).
// Floor lowered below 1 (now expressed as a request INTERVAL, not just a
// rate) so the pacer can still converge to a working cadence instead of
// perpetually retrying at a rate the server keeps rejecting.
const RATE_FLOOR = Number(process.env.DHAN_MIN_REQ_PER_SEC || 0.3); // 0.3/s ≈ one request per ~3.3s
const RATE_CEILING = Number(process.env.DHAN_MAX_REQ_PER_SEC_CEILING || 8);
const RAMP_UP_EVERY = Number(process.env.DHAN_RATE_RAMPUP_EVERY || 25);
let currentRate = Number(process.env.DHAN_MAX_REQ_PER_SEC || 2);
let successStreak = 0;

function headers() {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientId = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientId) {
        throw new Error("DHAN_ACCESS_TOKEN / DHAN_CLIENT_ID missing from data-downloader/.env");
    }
    return {
        "access-token": accessToken,
        "client-id": clientId,
        "Content-Type": "application/json",
        Accept: "application/json",
    };
}

// Spacing-based pacer, NOT a per-second bucket. A per-second "windowCount <
// currentRate, else wait until next second" bucket has a real bug under
// concurrency, confirmed for real (2026-09-19): when several workers call
// throttle() around the same moment and the bucket is full, they all
// independently compute roughly the same "wait until next window" delay and
// therefore all wake up and dispatch at THE SAME instant — a burst, not a
// spread — which re-triggers the rate limit exactly like the original
// unpaced concurrency bug did (429 kept recurring at OPTIONS_CONCURRENCY=8
// even with the fix in place). Fixed by having each caller synchronously
// reserve its own slot spaced `1000/currentRate` ms after the previously
// reserved slot (a classic leaky-bucket / spacing pacer) — reservation
// happens before any `await`, so concurrent callers serialize correctly
// even though JS's single-threaded execution never truly interleaves them.
let nextSlotAt = Date.now();

// Shared 429 cooldown: every concurrent caller checks this before starting a
// request, so one worker's rate-limit hit pauses the whole pool instead of
// only that one request backing off while the others keep hammering (see
// the file header's 2026-09-19 real-failure note).
let cooldownUntil = 0;
let consecutive429s = 0;

function noteRateLimited(retryAfterHeader) {
    consecutive429s += 1;
    successStreak = 0;
    currentRate = Math.max(RATE_FLOOR, Math.floor(currentRate / 2));
    const headerMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const backoffMs = Number.isFinite(headerMs) && headerMs > 0
        ? headerMs
        : Math.min(MAX_COOLDOWN_MS, MIN_COOLDOWN_MS * 2 ** (consecutive429s - 1));
    cooldownUntil = Math.max(cooldownUntil, Date.now() + backoffMs);
    return backoffMs;
}

function noteSuccess() {
    consecutive429s = 0;
    successStreak += 1;
    if (successStreak >= RAMP_UP_EVERY && currentRate < RATE_CEILING) {
        currentRate += 1;
        successStreak = 0;
    }
}

async function throttle() {
    const now = Date.now();
    const interval = 1000 / currentRate;
    // Reserve this caller's slot SYNCHRONOUSLY (no await above this line) —
    // this is what makes concurrent callers serialize correctly instead of
    // racing to read/write shared state after a suspend point.
    const base = Math.max(nextSlotAt, cooldownUntil, now);
    nextSlotAt = base + interval;
    if (base > now) {
        await new Promise((r) => setTimeout(r, base - now));
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Validate credentials before runUniverse starts a long append-only year run. An empty
// successful candle response is acceptable here: the purpose is auth only,
// and market closure can legitimately produce no candles.
async function checkAuth() {
    const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const date = `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}-${String(ist.getUTCDate()).padStart(2, "0")}`;
    await post("/charts/intraday", {
        securityId: "13",
        exchangeSegment: "IDX_I",
        instrument: "INDEX",
        interval: "1",
        fromDate: `${date} 09:15:00`,
        toDate: `${date} 09:16:00`,
    }, { retries: 0 });
    return true;
}

/** POST to a Dhan v2 endpoint with retry/backoff on 429 / 5xx / network errors. Throws on 4xx (other than 429) and after exhausting retries. */
async function post(path, body, { retries = MAX_RETRIES } = {}) {
    let attempt = 0;
    for (;;) {
        await throttle();
        let res;
        try {
            res = await axios.post(`${BASE_URL}${path}`, body, { headers: headers(), validateStatus: () => true, timeout: 30000 });
        } catch (err) {
            attempt += 1;
            if (attempt > retries) throw new Error(`${path}: network error after ${retries} retries: ${err.message}`);
            const waitedMs = 500 * 2 ** attempt;
            console.log(`[dhan-client] network error (attempt ${attempt}/${retries}) — retrying in ${waitedMs}ms: ${path}: ${err.message}`);
            await sleep(waitedMs);
            continue;
        }

        if (res.status === 200) {
            noteSuccess();
            return res.data;
        }

        if (res.status === 429 || res.status >= 500) {
            attempt += 1;
            const waitedMs = res.status === 429 ? noteRateLimited(res.headers?.["retry-after"]) : 500 * 2 ** attempt;
            if (attempt > retries) {
                throw new Error(`${path}: HTTP ${res.status} after ${retries} retries: ${JSON.stringify(res.data)}`);
            }
            // CONFIRMED FOR REAL (2026-09-21): without this line, a 429/5xx
            // retry cooldown is completely SILENT — nothing prints until
            // either the request eventually succeeds (no log at all) or
            // every retry is exhausted (one error line, after up to ~90s of
            // dead silence for 5 retries at MAX_COOLDOWN_MS=60000). A run
            // that's actually alive and correctly backing off looked
            // indistinguishable from a genuinely hung process for many
            // minutes at a time. This is diagnostic-only — it does not
            // change pacing/backoff itself.
            console.log(`[dhan-client] rate limited (HTTP ${res.status}, attempt ${attempt}/${retries}) — cooling down ${waitedMs}ms, rate now ${currentRate}/s: ${path}`);
            await sleep(waitedMs);
            continue;
        }

        // 4xx other than 429 — a real request problem, not transient. Don't retry.
        const msg = res.data && res.data.errorMessage ? res.data.errorMessage : JSON.stringify(res.data);
        const err = new Error(`${path}: HTTP ${res.status} ${msg}`);
        err.status = res.status;
        err.dhanBody = res.data;
        throw err;
    }
}

module.exports = { post, checkAuth, BASE_URL, getCurrentRate: () => currentRate };
