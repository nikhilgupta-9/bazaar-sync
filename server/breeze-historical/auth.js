// breeze-historical/auth.js — ICICI Breeze session, ISOLATED to this folder.
//
// Unlike Angel One's TOTP (workers/login.js), Breeze has no automatic daily
// login — BREEZE_API_SESSION has to be pasted in by hand each day (see
// README.md in this folder for the exact steps). This module just wraps
// generateSession() and fails with a clear message if the session is
// missing/expired, rather than a cryptic SDK error.
//
// Session lives in-memory only for this process, same rule as everywhere
// else in this project — never written to disk, never logged.

const { BreezeConnect } = require("breezeconnect");

function assertCredentials() {
    const missing = ["BREEZE_API_KEY", "BREEZE_API_SECRET", "BREEZE_API_SESSION"].filter((k) => !process.env[k]);
    if (missing.length) {
        throw new Error(
            `Missing Breeze credentials in .env: ${missing.join(", ")}. ` +
                `BREEZE_API_SESSION expires daily — see server/breeze-historical/README.md for how to get today's value.`
        );
    }
}

let breezeInstance = null;
let sessionReady = null;

/** Returns a logged-in BreezeConnect instance, creating/logging in once per process. */
async function getBreeze() {
    if (sessionReady) return sessionReady;

    assertCredentials();
    breezeInstance = new BreezeConnect({ appKey: process.env.BREEZE_API_KEY });

    sessionReady = breezeInstance
        .generateSession(process.env.BREEZE_API_SECRET, process.env.BREEZE_API_SESSION)
        .then(() => {
            console.log("[breeze] session established");
            return breezeInstance;
        })
        .catch((err) => {
            sessionReady = null; // don't memoize a failed login (same rule as workers/login.js)
            const msg = (err && (err.Error || err.message)) || String(err);
            throw new Error(
                `Breeze generateSession failed: ${msg}. Most likely BREEZE_API_SESSION has expired (it's a daily token) — get a fresh one via the login URL in README.md.`
            );
        });

    return sessionReady;
}

module.exports = { getBreeze };
