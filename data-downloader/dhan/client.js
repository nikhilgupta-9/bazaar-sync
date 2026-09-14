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
// "seconds" timeframe, ~100,000 req/day mentioned once). Paced conservatively
// (default 6 req/s) with retry/backoff on 429 and 5xx — NOT independently
// confirmed against Dhan's real enforcement (no 429 was seen during initial
// testing), same "unverified, defensive by design" posture as
// breeze/rateLimiter.js was built with before Breeze's real limits were
// confirmed.

const axios = require("axios");

const BASE_URL = process.env.DHAN_BASE_URL || "https://api.dhan.co/v2";
const MAX_PER_SECOND = Number(process.env.DHAN_MAX_REQ_PER_SEC || 6);
const MAX_RETRIES = Number(process.env.DHAN_MAX_RETRIES || 5);

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

// Simple token-bucket-ish pacer: never more than MAX_PER_SECOND calls start
// within any rolling 1000ms window. Good enough for a single-process CLI
// pipeline — not shared across processes.
let windowStart = Date.now();
let windowCount = 0;
async function throttle() {
    const now = Date.now();
    if (now - windowStart >= 1000) {
        windowStart = now;
        windowCount = 0;
    }
    if (windowCount >= MAX_PER_SECOND) {
        const wait = 1000 - (now - windowStart);
        await new Promise((r) => setTimeout(r, Math.max(wait, 10)));
        windowStart = Date.now();
        windowCount = 0;
    }
    windowCount += 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
            await sleep(500 * 2 ** attempt);
            continue;
        }

        if (res.status === 200) return res.data;

        if (res.status === 429 || res.status >= 500) {
            attempt += 1;
            if (attempt > retries) {
                throw new Error(`${path}: HTTP ${res.status} after ${retries} retries: ${JSON.stringify(res.data)}`);
            }
            await sleep(500 * 2 ** attempt);
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

module.exports = { post, BASE_URL };
