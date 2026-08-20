// server.js — Express API + socket.io push + market-worker lifecycle.
//
// Architecture (Phase 6):
//   - This process NEVER receives ticks from Angel One directly. The market
//     worker (workers/marketWorker.js) is a separate OS process, forked from
//     here via services/workerManager.js, that owns the SmartAPI login, the
//     WebSocket feed, tick validation/buffering, and bulk MySQL writes.
//   - The worker sends lightweight latest-tick IPC summaries up to this
//     process, which maintains services/marketCache.js (in-memory Map);
//     services/socketBroadcast.js emits from that cache every ~1s.
//   - Worker lifecycle owners: cron/marketStart.js (08:45 IST fork) and
//     cron/marketStop.js (15:35 IST graceful stop) — both scheduled inside
//     this process. On boot we also start the worker immediately if we're
//     already inside market hours, so an Express restart mid-day recovers
//     the live feed without waiting for tomorrow's cron.

const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
require("dotenv").config();

const { checkConnection } = require("./config/db");
const cronService = require("./services/cron");
const workerManager = require("./services/workerManager");
const marketCache = require("./services/marketCache");
const socketBroadcast = require("./services/socketBroadcast");
const marketStart = require("./cron/marketStart");
const marketStop = require("./cron/marketStop");
const { marketHours } = require("./utils/marketUtils");

const optionChainRoutes = require("./routes/optionChain");
const backtestRoutes = require("./routes/backtest");
const authRoutes = require("./routes/auth");
const strategyRoutes = require("./routes/strategies");
const simulatorRoutes = require("./routes/simulator");
const subscriptionRoutes = require("./routes/subscription");
const paperTradeRoutes = require("./routes/paperTrade");
const adminRoutes = require("./routes/admin");
const eventsRoutes = require("./routes/events");
const contentRoutes = require("./routes/content");
const seoRoutes = require("./routes/seo");

const app = express();

// Institute IP allowlist (Phase 11, instituteAccessService.js) reads
// req.ip — behind nginx in production that's the proxy's own IP unless
// Express is told to trust the X-Forwarded-For header from it. Set
// TRUST_PROXY=true in .env only in that deployment; left off (Express
// default) in local dev where there's no reverse proxy.
if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", true);
}

// 5174 is the separate admin/ app's dev port (Phase 10) — a genuinely
// different app/deployment from client/'s 5173, not a route inside it. In
// production, set CORS_ORIGINS to include the real admin subdomain
// (e.g. https://admin.bazaarsync.com) alongside the main site's origin.
const CORS_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
    : ["http://localhost:3000", "http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:3000", "http://127.0.0.1:5173", "http://127.0.0.1:5174"];

app.use(
    cors({
        origin: CORS_ORIGINS,
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Admin-uploaded content images (Home page hero/about/tool-card pictures —
// see middleware/upload.js). Plain static serving, same box as the API in
// every deployment this project has (README.md's Hostinger VPS guide) — no
// CDN/cloud storage exists here.
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health check endpoint
app.get("/health", async (req, res) => {
    try {
        await checkConnection();
        res.json({
            status: "ok",
            database: "connected",
            marketWorker: workerManager.isRunning() ? "running" : "stopped",
            liveCache: marketCache.getStatus(),
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        console.error("[Health] Database error:", err);
        res.status(500).json({
            status: "error",
            database: "disconnected",
            message: err.message,
        });
    }
});

// API Routes
app.use("/api/option-chain", optionChainRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/strategies", strategyRoutes);
app.use("/api/simulator", simulatorRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/paper-trade", paperTradeRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/seo", seoRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error("[Global Error]", err);
    res.status(500).json({
        error: err.message || "Internal server error",
        timestamp: new Date().toISOString(),
    });
});

const PORT = process.env.PORT || 5001;

// Express 5 + socket.io need an explicit http.Server (socket.io attaches to
// the raw server, not the Express app).
const server = http.createServer(app);

const { Server: SocketIOServer } = require("socket.io");
const io = new SocketIOServer(server, {
    cors: { origin: CORS_ORIGINS, credentials: true },
});
socketBroadcast.attach(io);

server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📍 API base: http://localhost:${PORT}/api`);

    // Nightly historical pull (23:00 IST Mon-Fri)
    cronService.start();

    // Market worker lifecycle crons (08:45 fork / 15:35 graceful stop, IST)
    marketStart.schedule();
    marketStop.schedule();

    // Mid-day Express restart: bring the live feed back immediately instead
    // of waiting for the next 08:45 cron.
    if (marketHours.isTradingTime() || marketHours.isExtendedHours()) {
        workerManager.start("server boot inside market hours");
    }
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is already in use. Please free it up or use a different port.`);
    } else {
        console.error("❌ Server error:", err);
    }
});

// Graceful shutdown — stop the worker first (it flushes its buffer), then
// close socket.io and HTTP.
async function shutdown(signal) {
    console.log(`${signal} received: shutting down`);
    try {
        await workerManager.stop(signal);
    } catch (err) {
        console.error("Worker stop failed:", err.message);
    }
    socketBroadcast.detach();
    cronService.stop();
    marketStart.unschedule();
    marketStop.unschedule();
    io.close();
    server.close(() => {
        console.log("HTTP server closed");
        process.exit(0);
    });
    // Hard exit fallback if something keeps the loop alive
    setTimeout(() => process.exit(0), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
