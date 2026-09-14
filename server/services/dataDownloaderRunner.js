// services/dataDownloaderRunner.js — spawns the actual data-fetching
// scripts (mostly in the standalone data-downloader/ app, some in
// server/scripts/) as child processes on behalf of the admin panel's Data
// Extraction page, and tracks them in `data_extraction_jobs`.
//
// This is a bridge, not a code import — data-downloader/ stays a genuinely
// separate app (own package.json/.env/node_modules; see its own README).
// Spawning it as a subprocess from the admin flow doesn't violate that: if
// data-downloader/ were deleted, the live app (and every other admin page)
// would keep working — only the "request extraction" button would start
// failing, with a clear error, not a crash.
//
// One job = one spawned process. Angel One / Kotak sources only support a
// single symbol per script (their underlying CLIs don't have an "ALL" mode
// the way the data-downloader year-pipelines do) — enforced below so a bad
// request fails fast with a clear message instead of silently running only
// the first symbol.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/db");
const { cleanBeforeFetch, monthRange } = require("./extractionCleanupService");
const { resyncRange } = require("./coverageSummaryService");

const YEAR_MODE_SOURCES = new Set(["icici_breeze", "bhavcopy", "upstox", "dhan"]);

const SERVER_DIR = path.join(__dirname, "..");
const DATA_DOWNLOADER_DIR = process.env.DATA_DOWNLOADER_DIR || path.join(SERVER_DIR, "..", "data-downloader");
const LOG_DIR = path.join(SERVER_DIR, "data", "extraction-logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const SYMBOL_RE = /^[A-Z0-9&\-.]{1,20}$/; // NSE-style symbols only (e.g. "BAJAJ-AUTO", "M&M") — never shell-interpreted anyway (spawn, no shell), this is just a sanity gate on job input.

function validateSymbols(symbols) {
    if (!symbols) return [];
    const list = String(symbols).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean);
    const bad = list.filter((s) => !SYMBOL_RE.test(s));
    if (bad.length) {
        const err = new Error(`invalid symbol(s): ${bad.join(", ")}`);
        err.status = 400;
        throw err;
    }
    return list;
}

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

// Builds { cwd, cmd, args, notes } for one (source, dataType) combination.
// Throws a 400 error for combinations that have no real script behind them
// (e.g. Upstox VIX, Bhavcopy VIX) rather than pretending to support them.
function buildCommand({ source, dataType, year, fromMonth, toMonth, symbols, extraArgs }) {
    const symbolList = validateSymbols(symbols);
    const yearPipelineFlags = () => {
        const flags = [];
        if (fromMonth) flags.push(`--from-month=${Number(fromMonth)}`);
        if (toMonth) flags.push(`--to-month=${Number(toMonth)}`);
        if (symbolList.length) flags.push(`--symbols=${symbolList.join(",")}`);
        return flags;
    };
    const requireYear = () => {
        if (!Number.isInteger(Number(year)) || Number(year) < 2015) throw badRequest("a valid year is required for this source/data-type");
        return Number(year);
    };
    const singleSymbol = (fallback = "NIFTY") => {
        if (symbolList.length > 1) throw badRequest(`${source} only supports one symbol per request (this source's script has no "ALL" mode)`);
        return symbolList[0] || fallback;
    };

    if (source === "icici_breeze") {
        const y = requireYear();
        if (dataType === "option_chain") return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["optionchain/run.js", String(y), ...yearPipelineFlags()] };
        if (dataType === "futures") return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["futures/run.js", String(y), ...yearPipelineFlags()] };
        if (dataType === "vix") return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["vix/run.js", String(y), ...yearPipelineFlags()] };
    }

    if (source === "bhavcopy") {
        // Bhavcopy is the discovery-only half of the same pipelines — free,
        // no Breeze/Upstox call budget, just NSE+BSE contract/expiry/EOD data.
        const y = requireYear();
        if (dataType === "option_chain") return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["optionchain/run.js", String(y), "--skip-enrich", ...yearPipelineFlags()] };
        if (dataType === "futures") return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["futures/run.js", String(y), "--skip-enrich", ...yearPipelineFlags()] };
        throw badRequest("Bhavcopy has no India VIX data (no options/futures-style contract to discover) — use ICICI Breeze for VIX");
    }

    if (source === "upstox") {
        const y = requireYear();
        if (dataType === "option_chain") {
            const flags = yearPipelineFlags();
            if (extraArgs) flags.push(`--strikes-per-side=${Number(extraArgs) || 10}`);
            return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["upstox/run.js", String(y), ...flags] };
        }
        if (dataType === "futures") return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["upstox/runFutures.js", String(y), ...yearPipelineFlags()] };
        throw badRequest("Upstox has no India VIX pipeline built here — use ICICI Breeze for VIX");
    }

    if (source === "angelone") {
        // Recent-window forward-fill only (Angel One's scrip master only
        // lists currently-live contracts) — days-back, not year/month.
        const days = Number(extraArgs) || 30;
        if (dataType === "option_chain") return { cwd: SERVER_DIR, cmd: "node", args: ["scripts/backfillHistory.js", singleSymbol(), String(days)] };
        if (dataType === "futures") return { cwd: SERVER_DIR, cmd: "node", args: ["scripts/backfillFutures.js", symbolList.length ? singleSymbol() : "ALL", String(days)] };
        throw badRequest("India VIX already flows live via Angel One's own worker/cron — there's no separate backfill script for it");
    }

    if (source === "dhan") {
        // Dhan's pipeline (data-downloader/dhan/) fetches discovery + index/
        // equity minute spot + options + daily futures TOGETHER per
        // symbol/year — there is no way to request just one slice the way
        // icici_breeze/upstox/bhavcopy split option_chain vs futures vs vix
        // into separate scripts, so this only maps dataType="option_chain"
        // (the closest fit) and errors clearly on the other two rather than
        // silently running the same thing under a misleading label.
        if (dataType !== "option_chain") {
            throw badRequest(
                `Dhan fetches discovery + index/VIX + options + futures together per symbol/year (dhan/runUniverse.js) — there's no separate futures/vix job from the admin trigger. Use dataType "option_chain", or run dhan/run.js's --skip-* flags directly from a terminal for a partial fetch.`
            );
        }
        const y = requireYear();
        if (fromMonth || toMonth) {
            throw badRequest(`Dhan's pipeline always processes the FULL calendar year (its own check-exists / delete / refetch model, see dhan/runUniverse.js) — partial month ranges aren't supported here.`);
        }
        const flags = symbolList.length ? [`--symbols=${symbolList.join(",")}`] : [];
        return { cwd: DATA_DOWNLOADER_DIR, cmd: "node", args: ["dhan/runUniverse.js", String(y), String(y), ...flags], notes: "Dhan: checks each symbol's year for existing data, deletes it if present, then fetches fresh (discovery + minute index/VIX/equity spot + options + daily futures) — not a skip-if-exists resumable fetch like the other sources." };
    }

    if (source === "kotak") {
        // Kotak has no historical API at all — this is a one-off snapshot
        // poll (proves the pipeline + records one real data point), not a
        // backfill. The real value is the always-on poller (`npm run kotak`,
        // started/stopped outside this admin flow, not per-request).
        return { cwd: SERVER_DIR, cmd: "node", args: ["scripts/kotakPollOnce.js", singleSymbol()], notes: "Kotak has no historical API — this takes ONE live snapshot, it does not backfill. Run the standalone poller (`npm run kotak`) for ongoing forward data." };
    }

    throw badRequest(`unknown source "${source}"`);
}

async function insertJobRow({ source, dataType, year, fromMonth, toMonth, symbols, extraArgs, command, requestedBy }) {
    const [result] = await pool.query(
        `INSERT INTO data_extraction_jobs (source, data_type, year, from_month, to_month, symbols, extra_args, command, status, requested_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
        [source, dataType, year || null, fromMonth || null, toMonth || null, symbols || null, extraArgs || null, command, requestedBy || null]
    );
    return result.insertId;
}

const TAIL_LINES = 40;
function tailText(text, n = TAIL_LINES) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-n).join("\n");
}

async function startJob(params) {
    const { source, dataType } = params;
    if (!source || !dataType) throw badRequest("source and dataType are required");

    const { cwd, cmd, args, notes } = buildCommand(params);
    const commandText = `${cmd} ${args.join(" ")}`;

    const jobId = await insertJobRow({ ...params, command: commandText });
    const logPath = path.join(LOG_DIR, `job-${jobId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    if (notes) logStream.write(`[note] ${notes}\n`);
    logStream.write(`[runner] cwd=${cwd}\n[runner] command=${commandText}\n\n`);

    // "Check first, clean if present, then fetch" — see
    // extractionCleanupService.js for the full rationale. Only fires for an
    // explicit symbol list (option_chain/futures) or vix (always the single
    // INDIAVIX series) on the three year/month sources; everything else is a
    // no-op. Runs BEFORE the fetch script spawns so its own skip-if-exists
    // check correctly sees a clean slate. A cleanup failure fails the job
    // outright rather than risking a fetch running on top of half-cleaned data.
    const symbolList = validateSymbols(params.symbols);
    try {
        const cleanupSummary = await cleanBeforeFetch({ source: params.source, dataType: params.dataType, symbolList, year: params.year, fromMonth: params.fromMonth, toMonth: params.toMonth });
        if (cleanupSummary) logStream.write(`${cleanupSummary}\n\n`);
    } catch (err) {
        logStream.write(`\n[runner] cleanup step failed, job aborted: ${err.message}\n`);
        logStream.end();
        await pool.query(`UPDATE data_extraction_jobs SET status='failed', summary=?, finished_at=NOW() WHERE id=?`, [`cleanup step failed: ${err.message}`, jobId]);
        return { id: jobId, command: commandText, logPath, notes: notes || null };
    }

    const child = spawn(cmd, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });

    let tailBuffer = "";
    const captureTail = (chunk) => {
        tailBuffer = tailText(tailBuffer + chunk.toString());
    };
    child.stdout.on("data", (chunk) => { logStream.write(chunk); captureTail(chunk); });
    child.stderr.on("data", (chunk) => { logStream.write(chunk); captureTail(chunk); });

    await pool.query(`UPDATE data_extraction_jobs SET status='running', pid=?, log_path=?, started_at=NOW() WHERE id=?`, [child.pid, logPath, jobId]);

    child.on("close", async (code) => {
        const status = code === 0 ? "completed" : "failed";

        // data-downloader/ writes option_chain_history with its OWN db pool —
        // it has no dependency on this server/ app, so it can never call
        // coverageSummaryService.recordIngested() the way cron.js/kotak/
        // dataImportService.js do. Left alone, option_chain_coverage_summary
        // (what the admin Data Coverage page actually reads — see
        // dataCoverageService.js) silently stays stale for whatever this job
        // just fetched. Confirmed for real (2026-09-13): a job fetched 13 real
        // NIFTY days into option_chain_history, but the summary table kept
        // showing 0 for that month until resynced. Scoped to exactly this
        // job's (symbol, month range) — cheap, not a full-symbol rescan.
        if (status === "completed" && params.dataType === "option_chain" && YEAR_MODE_SOURCES.has(params.source) && symbolList.length && params.year) {
            try {
                const { start, end } = monthRange(Number(params.year), params.fromMonth ? Number(params.fromMonth) : null, params.toMonth ? Number(params.toMonth) : null);
                const lines = [];
                for (const symbol of symbolList) {
                    const keys = await resyncRange(symbol, start, end);
                    lines.push(`${symbol}: resynced ${keys} (symbol, expiry, day) coverage-summary key(s)`);
                }
                logStream.write(`\n[runner] coverage-summary resync (${start}..${end}):\n${lines.map((l) => `  - ${l}`).join("\n")}\n`);
            } catch (err) {
                logStream.write(`\n[runner] coverage-summary resync failed (job data itself is fine, only the admin coverage-page cache may lag): ${err.message}\n`);
            }
        }

        logStream.end();
        try {
            await pool.query(
                `UPDATE data_extraction_jobs SET status=?, exit_code=?, summary=?, finished_at=NOW() WHERE id=?`,
                [status, code, tailBuffer, jobId]
            );
        } catch (err) {
            console.error(`[dataDownloaderRunner] failed to record completion for job ${jobId}: ${err.message}`);
        }
    });

    child.on("error", async (err) => {
        logStream.write(`\n[runner] spawn error: ${err.message}\n`);
        logStream.end();
        try {
            await pool.query(`UPDATE data_extraction_jobs SET status='failed', summary=?, finished_at=NOW() WHERE id=?`, [`spawn error: ${err.message}`, jobId]);
        } catch { /* best effort */ }
    });

    return { id: jobId, command: commandText, logPath, notes: notes || null };
}

async function listJobs({ limit = 100 } = {}) {
    const [rows] = await pool.query(
        `SELECT j.*, u.name AS requested_by_name FROM data_extraction_jobs j
         LEFT JOIN users u ON u.id = j.requested_by
         ORDER BY j.created_at DESC LIMIT ?`,
        [Number(limit)]
    );
    return rows;
}

async function getJob(id) {
    const [rows] = await pool.query(`SELECT * FROM data_extraction_jobs WHERE id = ?`, [id]);
    if (!rows.length) return null;
    const job = rows[0];
    let logTail = null;
    if (job.log_path && fs.existsSync(job.log_path)) {
        try {
            logTail = tailText(fs.readFileSync(job.log_path, "utf8"), 300);
        } catch { /* log unreadable, not fatal */ }
    }
    return { ...job, logTail };
}

async function cancelJob(id) {
    const job = await getJob(id);
    if (!job) throw badRequest("job not found");
    if (job.status !== "running" || !job.pid) throw badRequest("job is not currently running");
    try {
        process.kill(job.pid, "SIGTERM");
    } catch (err) {
        if (err.code !== "ESRCH") throw err; // ESRCH = already exited, fine
    }
    await pool.query(`UPDATE data_extraction_jobs SET status='cancelled', finished_at=NOW() WHERE id=?`, [id]);
}

// Manually mark a job 'failed' — for the cases `cancel` above doesn't cover:
// a job stuck in 'queued' (never actually spawned, e.g. the row insert
// succeeded but something threw before `startJob` reached the spawn/UPDATE
// below it — no pid ever recorded, so cancelJob's "must be running with a
// pid" check refuses it and the admin is left with a job that will sit at
// 'queued' forever with no button that applies), or a 'running' job whose
// process is alive but has visibly hung (no new log lines, no real
// progress) where "cancel" would work too but "failed" is the more honest
// status — this was a deliberate stop because the job wasn't succeeding,
// not a clean cancel. Best-effort kills the pid if one exists; never throws
// on a missing/dead process (ESRCH) since the whole point is forcing the DB
// row out of a stuck state regardless of what the OS process is doing.
async function failJob(id) {
    const job = await getJob(id);
    if (!job) throw badRequest("job not found");
    if (!["queued", "running"].includes(job.status)) throw badRequest("job is not queued or running");
    if (job.pid) {
        try {
            process.kill(job.pid, "SIGTERM");
        } catch (err) {
            if (err.code !== "ESRCH") throw err;
        }
    }
    await pool.query(
        `UPDATE data_extraction_jobs SET status='failed', summary=?, finished_at=NOW() WHERE id=?`,
        ["manually marked failed by admin", id]
    );
}

// Deletes a job's row (and its log file, best-effort) — only for jobs that
// are done one way or another; a 'queued'/'running' job must be cancelled or
// failed first so a live process never gets orphaned with nothing left
// tracking it.
async function deleteJob(id) {
    const job = await getJob(id);
    if (!job) throw badRequest("job not found");
    if (["queued", "running"].includes(job.status)) {
        throw badRequest("job is still queued/running — cancel or fail it first");
    }
    if (job.log_path) {
        try {
            fs.unlinkSync(job.log_path);
        } catch { /* already gone, or never existed — fine either way */ }
    }
    await pool.query(`DELETE FROM data_extraction_jobs WHERE id=?`, [id]);
}

function isPidAlive(pid) {
    if (!pid) return false;
    try {
        process.kill(pid, 0); // signal 0 = no-op, just checks the pid exists and we can signal it
        return true;
    } catch {
        return false;
    }
}

// Job completion is tracked via an in-memory `child.on('close', ...)`
// handler in startJob() above — that only works while THIS Express process
// stays alive for the job's whole duration. A server restart (deploy, crash,
// dev nodemon reload) while a job is mid-run orphans it: the child process
// itself keeps running to real completion (confirmed for real, 2026-09-13 —
// a job's actual work finished correctly even after its tracking process
// exited), but nothing is left to catch its exit and update the DB row, so
// it would sit at status='running' forever and look stuck even though the
// underlying data-downloader/backfill script may have succeeded (check its
// log_path — the log itself is always complete and accurate regardless).
// Call this once at server boot: any row still 'running' from a previous
// process life gets marked, so the admin UI doesn't lie about it being live.
async function reconcileOrphanedJobs() {
    const [rows] = await pool.query(`SELECT id, pid, log_path FROM data_extraction_jobs WHERE status = 'running'`);
    for (const row of rows) {
        if (isPidAlive(row.pid)) continue; // a real still-running job across a hot-reload that didn't kill it — leave alone
        await pool.query(
            `UPDATE data_extraction_jobs SET status='failed', summary=?, finished_at=NOW() WHERE id=?`,
            ["orphaned: the server process tracking this job exited before it finished (restart/crash) — check log_path for what actually happened; the underlying script may well have completed successfully", row.id]
        );
    }
    return rows.length;
}

module.exports = { startJob, listJobs, getJob, cancelJob, failJob, deleteJob, buildCommand, reconcileOrphanedJobs, DATA_DOWNLOADER_DIR };
