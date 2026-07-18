// services/workerManager.js — forks/supervises the market worker process.
//
// Lives in the Express process (server.js requires it), because the parent
// of a child_process.fork() is the one that receives its IPC messages — and
// marketCache (which socket.io broadcasts from) must live next to Express.
//
// Lifecycle owners:
//   - cron/marketStart.js calls start() at 08:45 IST (Mon-Fri)
//   - cron/marketStop.js calls stop() at 15:35 IST (Mon-Fri)
//   - server.js calls start() on boot if it's already inside market hours
//     (so an Express restart mid-day doesn't lose the feed)
//   - crash recovery: an unexpected exit during market hours is reforked
//     with backoff, and logged loudly — never silently.

const { fork } = require("child_process");
const path = require("path");
const marketCache = require("./marketCache");
const { marketHours } = require("../utils/marketUtils");
const { workerLogger } = require("../config/logger");

const WORKER_PATH = path.join(__dirname, "..", "workers", "marketWorker.js");
const GRACEFUL_EXIT_TIMEOUT_MS = 15000; // then SIGTERM, worker flushes on that too
const REFORK_BASE_DELAY_MS = 5000;
const REFORK_MAX_DELAY_MS = 120000;

let child = null;
let stopping = false;
let reforkAttempt = 0;
let reforkTimer = null;

function isRunning() {
    return child !== null && child.exitCode === null && !child.killed;
}

function start(reason = "manual") {
    if (isRunning()) {
        workerLogger.info(`Worker already running (pid ${child.pid}) — start(${reason}) ignored`);
        return child;
    }
    stopping = false;
    if (reforkTimer) {
        clearTimeout(reforkTimer);
        reforkTimer = null;
    }

    workerLogger.info(`Forking market worker (${reason})`);
    child = fork(WORKER_PATH, [], { env: process.env });

    child.on("message", (msg) => {
        if (!msg || typeof msg !== "object") return;
        if (msg.type === "worker:ticks" && Array.isArray(msg.ticks)) {
            marketCache.applyTicks(msg.ticks);
        } else if (msg.type === "worker:status") {
            workerLogger.info(`Worker status: ${msg.status}`);
            if (msg.status === "feed-connected") marketCache.setFeedConnected(true);
            if (msg.status === "feed-disconnected" || msg.status === "shutting-down") {
                marketCache.setFeedConnected(false);
            }
        }
    });

    child.on("exit", (code, signal) => {
        const pid = child ? child.pid : "?";
        child = null;
        marketCache.setFeedConnected(false);

        if (stopping) {
            workerLogger.info(`Market worker (pid ${pid}) exited after requested stop (code ${code})`);
            return;
        }

        // Unexpected death. Refork only while it makes sense (market open or
        // about to open); outside hours the 08:45 cron will start it fresh.
        workerLogger.error(
            `Market worker (pid ${pid}) exited UNEXPECTEDLY (code ${code}, signal ${signal || "none"})`
        );
        if (marketHours.isTradingTime() || marketHours.isExtendedHours()) {
            const delay = Math.min(REFORK_BASE_DELAY_MS * 2 ** reforkAttempt, REFORK_MAX_DELAY_MS);
            reforkAttempt += 1;
            workerLogger.warn(`Reforking market worker in ${Math.round(delay / 1000)}s (attempt ${reforkAttempt})`);
            reforkTimer = setTimeout(() => start(`crash-recovery attempt ${reforkAttempt}`), delay);
        } else {
            workerLogger.info("Market closed — not reforking; next 08:45 IST cron will start it");
        }
    });

    child.on("spawn", () => {
        reforkAttempt = 0; // successful spawn resets the backoff
        workerLogger.info(`Market worker forked (pid ${child.pid})`);
    });

    return child;
}

/**
 * Graceful stop: IPC shutdown message first (worker closes its WS, flushes
 * the buffer, closes its pool, exits 0), SIGTERM as the fallback hammer.
 */
function stop(reason = "manual") {
    return new Promise((resolve) => {
        if (!isRunning()) {
            workerLogger.info(`stop(${reason}): no worker running`);
            resolve();
            return;
        }
        stopping = true;
        const proc = child;
        workerLogger.info(`Stopping market worker (pid ${proc.pid}, ${reason})`);

        const killTimer = setTimeout(() => {
            if (proc.exitCode === null) {
                workerLogger.warn("Worker did not exit within grace period — sending SIGTERM");
                proc.kill("SIGTERM");
            }
        }, GRACEFUL_EXIT_TIMEOUT_MS);

        proc.once("exit", () => {
            clearTimeout(killTimer);
            resolve();
        });

        try {
            proc.send({ type: "shutdown" });
        } catch (_) {
            proc.kill("SIGTERM");
        }
    });
}

module.exports = { start, stop, isRunning };
