// workers/login.js — Angel One SmartAPI authentication.
//
// Fully automatic: the TOTP is generated locally from ANGEL_TOTP_SECRET via
// otplib, so there is no daily manual step (unlike the old Breeze session).
//
// Tokens (jwtToken / feedToken / refreshToken) live ONLY in this process's
// memory. They are never written to disk, never logged (the logger redacts
// JWT-shaped strings as a second line of defence), and never sent over IPC
// to the Express process or to the browser.
//
// This module has no Express/HTTP-server logic and is safe to require from
// the market worker, the nightly cron, and one-off scripts alike — each
// process gets its own in-memory session.

const { authenticator } = require("otplib");
const os = require("os");
const { loginLogger } = require("../config/logger");

const BASE_URL = process.env.ANGEL_API_BASE_URL || "https://apiconnect.angelbroking.com";
const LOGIN_PATH = "/rest/auth/angelbroking/user/v1/loginByPassword";
const LOGOUT_PATH = "/rest/secure/angelbroking/user/v1/logout";

// Session tokens are valid for the trading day; re-login proactively after
// this age rather than waiting for a 401 mid-stream.
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

let session = null; // { jwtToken, refreshToken, feedToken, obtainedAt }
let loginInFlight = null;

function firstNonInternalIPv4() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === "IPv4" && !iface.internal) return iface.address;
        }
    }
    return "127.0.0.1";
}

function firstMacAddress() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name] || []) {
            if (iface.family === "IPv4" && !iface.internal && iface.mac !== "00:00:00:00:00:00") {
                return iface.mac;
            }
        }
    }
    return "00:00:00:00:00:00";
}

// Standard headers SmartAPI requires on every REST call.
function baseHeaders() {
    return {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-UserType": "USER",
        "X-SourceID": "WEB",
        "X-ClientLocalIP": firstNonInternalIPv4(),
        "X-ClientPublicIP": process.env.ANGEL_PUBLIC_IP || firstNonInternalIPv4(),
        "X-MACAddress": firstMacAddress(),
        "X-PrivateKey": process.env.ANGEL_API_KEY,
    };
}

function assertCredentials() {
    const missing = ["ANGEL_API_KEY", "ANGEL_CLIENT_ID", "ANGEL_PASSWORD", "ANGEL_TOTP_SECRET"].filter(
        (k) => !process.env[k]
    );
    if (missing.length) {
        throw new Error(`Missing Angel One credentials in .env: ${missing.join(", ")}`);
    }
}

async function doLogin() {
    assertCredentials();
    const totp = authenticator.generate(process.env.ANGEL_TOTP_SECRET);

    loginLogger.info(`Logging in to SmartAPI as client ${process.env.ANGEL_CLIENT_ID}`);
    const res = await fetch(`${BASE_URL}${LOGIN_PATH}`, {
        method: "POST",
        headers: baseHeaders(),
        body: JSON.stringify({
            clientcode: process.env.ANGEL_CLIENT_ID,
            password: process.env.ANGEL_PASSWORD, // SmartAPI login PIN
            totp,
        }),
    });

    if (!res.ok) {
        throw new Error(`SmartAPI login HTTP ${res.status}`);
    }
    const body = await res.json();
    if (!body.status || !body.data || !body.data.jwtToken) {
        // body.message is safe to log (SmartAPI error text, no secrets)
        throw new Error(`SmartAPI login rejected: ${body.message || "unknown error"} (code ${body.errorcode || "?"})`);
    }

    session = {
        jwtToken: body.data.jwtToken,
        refreshToken: body.data.refreshToken,
        feedToken: body.data.feedToken,
        obtainedAt: Date.now(),
    };
    loginLogger.info("SmartAPI login OK, session established");
    return session;
}

/**
 * Get a live session, logging in (or re-logging-in) if needed.
 * Concurrent callers share one in-flight login. A failed login is NOT
 * memoized (the old breeze.js bug) — the next call retries from scratch.
 */
async function getSession({ force = false } = {}) {
    if (!force && session && Date.now() - session.obtainedAt < SESSION_MAX_AGE_MS) {
        return session;
    }
    if (!loginInFlight) {
        loginInFlight = doLogin().finally(() => {
            loginInFlight = null;
        });
    }
    return loginInFlight;
}

/** Drop the in-memory session so the next getSession() performs a fresh login. */
function invalidateSession() {
    session = null;
}

/**
 * Authenticated POST helper for SmartAPI's secure REST endpoints
 * (historical candles, OI data, etc.). Retries once on a 401 with a
 * forced re-login.
 */
async function securePost(path, payload, { retryOnAuthFailure = true } = {}) {
    const sess = await getSession();
    const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { ...baseHeaders(), Authorization: `Bearer ${sess.jwtToken}` },
        body: JSON.stringify(payload),
    });

    if (res.status === 401 && retryOnAuthFailure) {
        loginLogger.warn(`SmartAPI 401 on ${path} — re-logging-in once`);
        invalidateSession();
        await getSession({ force: true });
        return securePost(path, payload, { retryOnAuthFailure: false });
    }
    if (!res.ok) {
        throw new Error(`SmartAPI ${path} HTTP ${res.status}`);
    }
    const body = await res.json();
    if (body.status === false) {
        throw new Error(`SmartAPI ${path} error: ${body.message || "unknown"} (code ${body.errorcode || "?"})`);
    }
    return body;
}

async function logout() {
    if (!session) return;
    try {
        await securePost(LOGOUT_PATH, { clientcode: process.env.ANGEL_CLIENT_ID }, { retryOnAuthFailure: false });
        loginLogger.info("SmartAPI logout OK");
    } catch (err) {
        loginLogger.warn(`SmartAPI logout failed (ignored): ${err.message}`);
    } finally {
        session = null;
    }
}

module.exports = { getSession, invalidateSession, securePost, logout, baseHeaders, BASE_URL };
