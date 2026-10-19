// server/services/archivalLocks.js — "this symbol is still being written" markers shared between
// backfill runners and services/autoUploadDaemon.js.
//
// Without it the daemon (every 60s, in every running Express process) exported, uploaded and
// pruned a symbol while a runner was still inserting it: partial Drive uploads every few minutes,
// rows pruned under the runner's feet, and two concurrent merges into one Drive file (that is how
// SENSEX_2026_option_chain.csv.gz got corrupted on 2026-10-19). A lock whose owner process is gone
// is ignored, so a crashed runner can't block uploads forever.
const fs = require("fs");
const path = require("path");

const LOCK_FILE = path.join(__dirname, "..", "..", "data-downloader", "data", "archival-active-symbols.json");

function read() {
    try {
        return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
    } catch {
        return {};
    }
}

function write(locks) {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify(locks, null, 2));
}

function alive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err.code === "EPERM";
    }
}

function lock(symbol) {
    const locks = read();
    locks[String(symbol).toUpperCase()] = { pid: process.pid, since: new Date().toISOString() };
    write(locks);
}

function unlock(symbol) {
    const locks = read();
    delete locks[String(symbol).toUpperCase()];
    write(locks);
}

/** Drop every lock this process holds (call on exit). */
function releaseAll() {
    const locks = read();
    for (const [sym, l] of Object.entries(locks)) if (l.pid === process.pid) delete locks[sym];
    write(locks);
}

function isLocked(symbol) {
    const l = read()[String(symbol).toUpperCase()];
    return !!(l && alive(l.pid));
}

module.exports = { lock, unlock, releaseAll, isLocked, LOCK_FILE };
