// workers/buffer.js — tick buffer with size/time-based flushing.
//
// Rows are pushed per destination table; a flush happens when EITHER
// FLUSH_MAX_RECORDS rows are queued (across all tables) OR FLUSH_INTERVAL_MS
// has elapsed since the last flush — whichever comes first. Flushed batches
// are handed to databaseWriter as multi-row bulk INSERTs, never row-by-row.

const { bulkInsert } = require("./databaseWriter");
const { dbLogger } = require("../config/logger");

const FLUSH_MAX_RECORDS = Number(process.env.TICK_BUFFER_MAX_RECORDS || 100);
const FLUSH_INTERVAL_MS = Number(process.env.TICK_BUFFER_FLUSH_MS || 2000);

class TickBuffer {
    constructor() {
        // table name -> { columns: string[], rows: any[][] }
        this.pending = new Map();
        this.totalRows = 0;
        this.timer = null;
        this.flushing = Promise.resolve();
    }

    start() {
        if (this.timer) return;
        this.timer = setInterval(() => this.flush("interval"), FLUSH_INTERVAL_MS);
        // Don't hold the process open just for the flush timer
        if (this.timer.unref) this.timer.unref();
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    /**
     * Queue one row for a table. `columns` must be identical for every push
     * to the same table (it's captured on first push).
     */
    push(table, columns, row) {
        let entry = this.pending.get(table);
        if (!entry) {
            entry = { columns, rows: [] };
            this.pending.set(table, entry);
        }
        entry.rows.push(row);
        this.totalRows += 1;

        if (this.totalRows >= FLUSH_MAX_RECORDS) {
            this.flush("size");
        }
    }

    /**
     * Drain everything queued and bulk-insert it. Serialised — a flush
     * triggered while another is running queues behind it, preserving order.
     * Returns a promise that resolves when THIS flush's data is written.
     */
    flush(reason = "manual") {
        if (this.totalRows === 0) return this.flushing;

        const batches = this.pending;
        const count = this.totalRows;
        this.pending = new Map();
        this.totalRows = 0;

        this.flushing = this.flushing.then(async () => {
            for (const [table, { columns, rows }] of batches) {
                try {
                    await bulkInsert(table, columns, rows);
                } catch (err) {
                    // bulkInsert already retried with backoff; at this point the
                    // batch is dropped rather than growing memory unboundedly.
                    dbLogger.error(`Dropping ${rows.length} rows for ${table} after failed retries: ${err.message}`);
                }
            }
            dbLogger.debug(`Flushed ${count} rows (${reason})`);
        });
        return this.flushing;
    }
}

module.exports = { TickBuffer, FLUSH_MAX_RECORDS, FLUSH_INTERVAL_MS };
