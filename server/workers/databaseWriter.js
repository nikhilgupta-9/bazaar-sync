// workers/databaseWriter.js — bulk MySQL writes for the market worker.
//
// Always multi-row `INSERT ... VALUES ?` — never single-row inserts. Retries
// transient failures with exponential backoff. The worker process gets its
// own pool simply by being its own OS process (config/db.js builds one pool
// per process), so these writes never contend with Express's pool.

const { pool } = require("../config/db");
const { dbLogger } = require("../config/logger");

const MAX_ATTEMPTS = Number(process.env.DB_WRITE_MAX_ATTEMPTS || 4);
const BASE_BACKOFF_MS = Number(process.env.DB_WRITE_BACKOFF_MS || 500);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bulk insert rows into `table`. `columns` is a whitelist-style array of
 * column names (never user input — always fixed literals from worker code).
 *
 * @param {string} table
 * @param {string[]} columns
 * @param {any[][]} rows  array of value arrays matching `columns`
 */
async function bulkInsert(table, columns, rows) {
    if (!rows || rows.length === 0) return;

    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ?`;

    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await pool.query(sql, [rows]);
            dbLogger.debug(`Inserted ${rows.length} rows into ${table}`);
            return;
        } catch (err) {
            lastErr = err;
            if (attempt < MAX_ATTEMPTS) {
                const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
                dbLogger.warn(
                    `bulkInsert ${table} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message} — retrying in ${delay}ms`
                );
                await sleep(delay);
            }
        }
    }
    dbLogger.error(`bulkInsert ${table} failed after ${MAX_ATTEMPTS} attempts: ${lastErr.message}`);
    throw lastErr;
}

async function closePool() {
    await pool.end();
    dbLogger.info("Worker MySQL pool closed");
}

module.exports = { bulkInsert, closePool };
