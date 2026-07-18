// cron/marketStop.js — 15:35 IST Mon-Fri: gracefully stop the market worker.
//
// Sends the worker an IPC shutdown message (via workerManager.stop); the
// worker closes its WebSocket, flushes any partially-filled buffer to MySQL,
// closes its own pool, then exits 0. SIGTERM is the fallback if it doesn't
// exit within the grace period — the worker's SIGTERM handler runs the same
// flush path, so no ticks are lost either way.

const cron = require("node-cron");
const workerManager = require("../services/workerManager");
const { workerLogger } = require("../config/logger");

let task = null;

function schedule() {
    if (task) return task;
    task = cron.schedule(
        "35 15 * * 1-5",
        async () => {
            workerLogger.info("15:35 IST market-stop cron fired");
            await workerManager.stop("15:35 IST cron");
        },
        { timezone: "Asia/Kolkata" }
    );
    workerLogger.info("Market-stop cron scheduled: 15:35 IST Mon-Fri");
    return task;
}

function unschedule() {
    if (task) {
        task.stop();
        task = null;
    }
}

module.exports = { schedule, unschedule };
