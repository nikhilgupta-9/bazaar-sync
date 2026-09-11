// kotak/auth.js — Kotak Neo authentication & session, fully automatic.
//
// Flow (TOTP + MPIN, no daily SMS OTP — same shape as Angel One's login):
//   1. POST /oauth2/token          Basic base64(key:secret)     -> accessToken (Bearer)
//   2. POST /login/v6/totp/login   Bearer + neo-fin-key + TOTP  -> viewToken + viewSid
//   3. POST /login/v6/totp/validate Bearer + Sid + Auth + MPIN  -> tradeToken + tradeSid
//
// Tokens live ONLY in this process's memory — never logged (loginLogger
// redacts JWT-shaped strings as a backstop), never written to disk, never
// sent anywhere. A failed login is NOT memoized: the next call retries from
// scratch (deliberately, same as workers/login.js).
//
// No Express / req / res here — safe to require from the poller and scripts.

require("dotenv").config();

const { authenticator } = require("otplib");
const cfg = require("../config/kotak");
const { loginLogger } = require("../config/logger");

let session = null; // { accessToken, tradeToken, tradeSid, hsServerId, dataCenter, obtainedAt }
let inFlight = null; // de-dupes concurrent login attempts

function required(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env var ${name} (see .env.example — Kotak Neo block)`);
    return v;
}

async function postJson(url, { headers = {}, body } = {}) {
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : {};
    } catch {
        json = { raw: text };
    }
    if (!res.ok) {
        const msg = json?.message || json?.error || json?.raw || res.statusText;
        const err = new Error(`Kotak ${res.status} @ ${url}: ${msg}`);
        err.status = res.status;
        err.body = json;
        throw err;
    }
    return json;
}

// Step 1 — client-credentials access token.
async function getAccessToken() {
    const key = required("KOTAK_CONSUMER_KEY");
    const secret = required("KOTAK_CONSUMER_SECRET");
    const basic = Buffer.from(`${key}:${secret}`).toString("base64");

    const res = await fetch(`${cfg.napiBase}${cfg.paths.oauthToken}`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
        },
        body: "grant_type=client_credentials",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
        throw new Error(`Kotak oauth2/token failed (${res.status}): ${JSON.stringify(json)}`);
    }
    return json.access_token; // token_type: "Bearer"
}

// Step 2 — TOTP login -> view token.
async function totpLogin(accessToken) {
    const totp = authenticator.generate(required("KOTAK_TOTP_SECRET"));
    const json = await postJson(`${cfg.loginBase}${cfg.paths.totpLogin}`, {
        headers: { Authorization: `Bearer ${accessToken}`, "neo-fin-key": cfg.neoFinKey },
        body: {
            mobileNumber: required("KOTAK_MOBILE"), // "+9199XXXXXXXX"
            ucc: required("KOTAK_UCC"),
            totp,
        },
    });
    const d = json.data || {};
    if (!d.token || !d.sid) throw new Error(`totp/login: unexpected response ${JSON.stringify(json)}`);
    return { viewToken: d.token, viewSid: d.sid };
}

// Step 3 — MPIN validate -> trade token (used for every data call afterwards).
async function totpValidate(accessToken, { viewToken, viewSid }) {
    const json = await postJson(`${cfg.loginBase}${cfg.paths.totpValidate}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            sid: viewSid,
            Auth: viewToken,
            "neo-fin-key": cfg.neoFinKey,
        },
        body: { mpin: required("KOTAK_MPIN") },
    });
    const d = json.data || {};
    if (!d.token || !d.sid) throw new Error(`totp/validate: unexpected response ${JSON.stringify(json)}`);
    return {
        tradeToken: d.token,
        tradeSid: d.sid,
        hsServerId: d.hsServerId || null,
        dataCenter: d.dataCenter || null,
    };
}

async function doLogin() {
    const accessToken = await getAccessToken();
    const view = await totpLogin(accessToken);
    const trade = await totpValidate(accessToken, view);
    session = { accessToken, ...trade, obtainedAt: Date.now() };
    loginLogger.info(`[kotak] logged in (server=${session.hsServerId || "?"}, dc=${session.dataCenter || "?"})`);
    return session;
}

function isExpired() {
    return !session || Date.now() - session.obtainedAt > cfg.session.maxAgeMs;
}

/** Always returns a usable session, logging in / refreshing as needed. */
async function getSession({ force = false } = {}) {
    if (!force && !isExpired()) return session;
    if (inFlight) return inFlight; // collapse concurrent callers
    inFlight = doLogin().finally(() => {
        inFlight = null;
    });
    return inFlight;
}

/** Headers every authenticated data request needs. */
async function authHeaders() {
    const s = await getSession();
    return {
        Authorization: `Bearer ${s.accessToken}`,
        Auth: s.tradeToken,
        Sid: s.tradeSid,
        Accept: "application/json",
    };
}

/** Call on a 401/403 from a data endpoint, then retry the request once. */
async function refresh() {
    session = null;
    return getSession({ force: true });
}

module.exports = { getSession, authHeaders, refresh };
