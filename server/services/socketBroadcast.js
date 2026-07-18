// services/socketBroadcast.js — socket.io push to the React frontend.
//
// React connects ONLY to this socket.io server — never to Angel One, never
// to MySQL. Every 500ms-1s (configurable) the broadcaster reads the
// in-memory marketCache (never a DB query on a timer) and emits the latest
// tick summary per symbol to clients subscribed to that symbol's room.
//
// Events:
//   client -> server  "subscribe"   { symbol: "NIFTY" | "BANKNIFTY" | "FINNIFTY" }
//   client -> server  "unsubscribe" { symbol }
//   server -> client  "latestTicks" { symbol, spot, expiry, ticks: [...], timestamp }
//   server -> client  "marketStatus" { feedConnected, fresh, marketOpen }

const marketCache = require("./marketCache");
const { marketHours } = require("../utils/marketUtils");
const { socketLogger } = require("../config/logger");

const BROADCAST_INTERVAL_MS = Math.min(
    Math.max(Number(process.env.SOCKET_BROADCAST_MS || 1000), 500),
    5000
);

const VALID_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY"]);

let interval = null;

function roomFor(symbol) {
    return `sym:${symbol.toUpperCase()}`;
}

function attach(io) {
    io.on("connection", (socket) => {
        socketLogger.info(`Client connected: ${socket.id}`);

        socket.emit("marketStatus", {
            ...publicStatus(),
        });

        socket.on("subscribe", (payload) => {
            const symbol = String((payload && payload.symbol) || "").toUpperCase();
            if (!VALID_SYMBOLS.has(symbol)) return;
            socket.join(roomFor(symbol));
            socketLogger.debug(`${socket.id} subscribed ${symbol}`);
            // Immediate first frame so the client doesn't wait a full interval
            const frame = marketCache.getBroadcastPayload(symbol);
            if (frame) socket.emit("latestTicks", frame);
        });

        socket.on("unsubscribe", (payload) => {
            const symbol = String((payload && payload.symbol) || "").toUpperCase();
            if (!VALID_SYMBOLS.has(symbol)) return;
            socket.leave(roomFor(symbol));
        });

        socket.on("disconnect", (reason) => {
            socketLogger.debug(`Client disconnected: ${socket.id} (${reason})`);
        });
    });

    interval = setInterval(() => {
        for (const symbol of VALID_SYMBOLS) {
            const room = roomFor(symbol);
            const clients = io.sockets.adapter.rooms.get(room);
            if (!clients || clients.size === 0) continue;

            const frame = marketCache.getBroadcastPayload(symbol);
            if (frame) io.to(room).emit("latestTicks", frame);
        }
        io.emit("marketStatus", publicStatus());
    }, BROADCAST_INTERVAL_MS);

    socketLogger.info(`Socket broadcast attached (every ${BROADCAST_INTERVAL_MS}ms)`);
}

function publicStatus() {
    const status = marketCache.getStatus();
    return {
        feedConnected: status.feedConnected,
        fresh: status.fresh,
        marketOpen: marketHours.isTradingTime(),
        timestamp: new Date().toISOString(),
    };
}

function detach() {
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}

module.exports = { attach, detach, BROADCAST_INTERVAL_MS };
