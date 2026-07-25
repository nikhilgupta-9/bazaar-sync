// breeze-historical/rateLimiter.js — enforces Breeze's real, ICICI-documented
// limits (confirmed against icicidirect.com's own FAQ, 2026-07-19):
//   - 100 calls/minute
//   - 5,000 calls/day
//   - (1,000 candles/call is enforced separately, by chunking date ranges in
//     historicalService.js — this file only counts calls, not candles)
//
// Daily count is persisted to disk (server/data/, already gitignored) so a
// backfill that gets interrupted and resumed later in the same day — or
// across a script restart — doesn't blow the daily cap. Resets automatically
// when the persisted date rolls over to a new IST calendar day.

const fs = require("fs");
const path = require("path");
const { todayIst } = require("../services/instrumentMaster");

const STATE_DIR = path.join(__dirname, "..", "data");
const STATE_FILE = path.join(STATE_DIR, "breeze-call-count.json");

const DAILY_LIMIT = Number(process.env.BREEZE_DAILY_CALL_LIMIT || 4800); // safety margin under ICICI's 5000
const PER_MINUTE_LIMIT = Number(process.env.BREEZE_PER_MINUTE_LIMIT || 90); // safety margin under 100

function loadState() {
    const today = todayIst();
    if (fs.existsSync(STATE_FILE)) {
        try {
            const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
            if (state.date === today) return state;
        } catch {
            /* fall through to fresh state */
        }
    }
    return { date: today, count: 0 };
}

function saveState(state) {
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

let state = loadState();
const recentCallTimestamps = []; // in-memory only, per-minute pacing

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Call before every Breeze API request. Blocks as needed for per-minute pacing; throws if the daily cap is already spent. */
async function throttle() {
    const today = todayIst();
    if (state.date !== today) {
        state = { date: today, count: 0 }; // new day, fresh budget
    }
    if (state.count >= DAILY_LIMIT) {
        throw new Error(
            `Breeze daily call budget spent (${state.count}/${DAILY_LIMIT} for ${today}). Resume tomorrow — this script is resumable (ON DUPLICATE KEY UPDATE), so just re-run it.`
        );
    }

    const now = Date.now();
    while (recentCallTimestamps.length && now - recentCallTimestamps[0] > 60_000) {
        recentCallTimestamps.shift();
    }
    if (recentCallTimestamps.length >= PER_MINUTE_LIMIT) {
        const waitMs = 60_000 - (now - recentCallTimestamps[0]) + 50;
        await sleep(waitMs);
    }

    recentCallTimestamps.push(Date.now());
    state.count += 1;
    saveState(state);
}

function remainingToday() {
    const today = todayIst();
    if (state.date !== today) return DAILY_LIMIT;
    return Math.max(0, DAILY_LIMIT - state.count);
}

module.exports = { throttle, remainingToday, DAILY_LIMIT, PER_MINUTE_LIMIT };
