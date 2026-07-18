// cron/marketStart.js — 08:45 IST Mon-Fri: fork the market worker.
//
// Required by server.js; the schedule runs inside the Express process, and
// the fork happens through services/workerManager.js so the parent (Express)
// receives the worker's IPC tick summaries for marketCache.
//
// This cron is the worker's primary daily lifecycle owner. server.js also
// calls workerManager.start() on boot when it's already inside market hours,
// so an Express restart mid-day recovers the feed without waiting for the
// next morning.

const cron = require("node-cron");
const workerManager = require("../services/workerManager");
const { workerLogger } = require("../config/logger");

let task = null;

function schedule() {
    if (task) return task;
    task = cron.schedule(
        "45 8 * * 1-5",
        () => {
            workerLogger.info("08:45 IST market-start cron fired");
            workerManager.start("08:45 IST cron");
        },
        { timezone: "Asia/Kolkata" }
    );
    workerLogger.info("Market-start cron scheduled: 08:45 IST Mon-Fri");
    return task;
}

function unschedule() {
    if (task) {
        task.stop();
        task = null;
    }
}

module.exports = { schedule, unschedule };
