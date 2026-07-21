// scripts/testLogin.js — one-off Angel One SmartAPI login check.
// Run:  cd server && node scripts/testLogin.js
//
// Only exercises workers/login.js's getSession()/logout(). No WebSocket, no
// DB writes, no worker lifecycle — safe to run any time, market open or not.
// Never prints token values, only whether each was received.

require("dotenv").config();
const { getSession, logout } = require("../workers/login");

(async () => {
    try {
        const session = await getSession();
        console.log("LOGIN OK");
        console.log(`  jwtToken:     ${session.jwtToken ? "received" : "MISSING"}`);
        console.log(`  feedToken:    ${session.feedToken ? "received" : "MISSING"}`);
        console.log(`  refreshToken: ${session.refreshToken ? "received" : "MISSING"}`);
        await logout();
        console.log("Logged out cleanly.");
        process.exit(0);
    } catch (err) {
        console.error("LOGIN FAILED:", err.message);
        process.exit(1);
    }
})();
