// PM2 process file — production deployment (Hostinger VPS).
//
//   pm2 start ecosystem.config.js              # starts the API server
//   pm2 start ecosystem.config.js --only bazaar-sync-worker   # optional
//
// Normal operation: run ONLY bazaar-sync-api. It forks/supervises the market
// worker itself via the 08:45/15:35 IST cron lifecycle (cron/marketStart.js,
// cron/marketStop.js) and reforks it on crashes — that keeps the worker's IPC
// channel to the Express process (which feeds the live socket.io cache).
//
// bazaar-sync-worker exists for deployment flexibility: it runs the worker
// standalone under PM2 instead (autorestart, no IPC parent). In that mode the
// worker still buffers + bulk-writes to MySQL, but the Express process gets
// no IPC tick summaries, so live REST/socket payloads fall back to
// historical data — use it only for ingestion-only deployments or debugging.
// Don't run both modes at once (double subscriptions, double DB writes).

module.exports = {
    apps: [
        {
            name: "bazaar-sync-api",
            script: "./server.js",
            cwd: __dirname,
            instances: 1, // worker IPC + in-memory cache are single-process by design
            exec_mode: "fork",
            autorestart: true,
            max_memory_restart: "512M",
            env: { NODE_ENV: "production" },
            out_file: "./logs/pm2-api-out.log",
            error_file: "./logs/pm2-api-error.log",
            merge_logs: true,
            time: true,
        },
        {
            name: "bazaar-sync-worker",
            script: "./workers/marketWorker.js",
            cwd: __dirname,
            instances: 1,
            exec_mode: "fork",
            autorestart: true,
            // Started explicitly with --only when needed; not part of the
            // default `pm2 start ecosystem.config.js` bring-up.
            // (PM2 has no per-app "disabled" flag — just don't start it.)
            max_memory_restart: "512M",
            env: { NODE_ENV: "production" },
            out_file: "./logs/pm2-worker-out.log",
            error_file: "./logs/pm2-worker-error.log",
            merge_logs: true,
            time: true,
        },
    ],
};
