// workers/websocket.js — Angel One SmartAPI WebSocket 2.0 client.
//
// Thin wrapper around a raw `ws` connection: connect (with auth headers),
// subscribe, heartbeat, exponential-backoff reconnect, and binary tick
// decoding. Emits plain JS tick objects — everything downstream (buffer,
// cache, IPC) is transport-agnostic, so if Angel One's byte layout shifts,
// the only file that changes is this one (see parseBinaryTick below).
//
// Protocol shape (per Angel One's published SmartAPI WebSocket 2.0 docs):
//   URL      wss://smartapisocket.angelone.in/smart-stream
//   Headers  Authorization: Bearer <jwtToken>, x-api-key, x-client-code,
//            x-feed-token
//   Sub      JSON text frame:
//            { correlationID, action: 1|0, params: { mode, tokenList:
//              [{ exchangeType, tokens: ["26000", ...] }] } }
//   Heartbeat  client sends the literal text "ping" every ~30s ("pong" back)
//   Ticks    little-endian binary frames; layout documented in parseBinaryTick.
//
// NOTE: the binary layout below matches the publicly documented v2.0 field
// order (mode/exchange/token/sequence/timestamp/LTP..., OI at offset 123 in
// SnapQuote). It has NOT been verified against a live feed from this
// environment (no credentials here) — if fields come back shifted, fix the
// offsets in parseBinaryTick only.

const WebSocket = require("ws");
const { EventEmitter } = require("events");
const { workerLogger } = require("../config/logger");

const WS_URL = process.env.ANGEL_WS_URL || "wss://smartapisocket.angelone.in/smart-stream";

const HEARTBEAT_INTERVAL_MS = 25000; // Angel One disconnects idle sockets after ~30s
const HEARTBEAT_TIMEOUT_MS = 65000; // no pong/data for this long => assume dead
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60000;

// Subscription modes
const MODE = { LTP: 1, QUOTE: 2, SNAP_QUOTE: 3 };
// Exchange types
const EXCHANGE = { NSE_CM: 1, NSE_FO: 2, BSE_CM: 3, BSE_FO: 4, MCX_FO: 5, NCX_FO: 7, CDE_FO: 13 };

const PRICE_DIVISOR = 100; // NSE/NFO prices arrive in paise

class AngelOneWebSocket extends EventEmitter {
    /**
     * @param {() => Promise<{jwtToken:string, feedToken:string}>} getSession
     *        Called on every (re)connect so a stale token triggers a fresh login.
     */
    constructor(getSession) {
        super();
        this.getSession = getSession;
        this.ws = null;
        this.subscriptions = []; // [{ mode, exchangeType, tokens: [] }]
        this.reconnectAttempt = 0;
        this.heartbeatTimer = null;
        this.lastActivityAt = 0;
        this.closedByUs = false;
        this.connecting = false;
    }

    async connect() {
        if (this.connecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) return;
        this.connecting = true;
        this.closedByUs = false;

        let sess;
        try {
            sess = await this.getSession();
        } catch (err) {
            this.connecting = false;
            workerLogger.error(`WS connect aborted, login failed: ${err.message}`);
            this.scheduleReconnect();
            return;
        }

        workerLogger.info(`Connecting to SmartAPI WebSocket feed at ${WS_URL}`);
        const ws = new WebSocket(WS_URL, {
            headers: {
                Authorization: `Bearer ${sess.jwtToken}`,
                "x-api-key": process.env.ANGEL_API_KEY,
                "x-client-code": process.env.ANGEL_CLIENT_ID,
                "x-feed-token": sess.feedToken,
            },
        });
        this.ws = ws;

        ws.on("open", () => {
            this.connecting = false;
            this.reconnectAttempt = 0;
            this.lastActivityAt = Date.now();
            workerLogger.info("SmartAPI WebSocket connected");
            this.startHeartbeat();
            this.resubscribeAll();
            this.emit("open");
        });

        ws.on("message", (data, isBinary) => {
            this.lastActivityAt = Date.now();
            if (!isBinary) {
                const text = data.toString();
                if (text === "pong") return; // heartbeat reply
                // Error/control frames arrive as JSON text
                workerLogger.debug(`WS text frame: ${text}`);
                return;
            }
            try {
                const tick = parseBinaryTick(data);
                if (tick) this.emit("tick", tick);
            } catch (err) {
                workerLogger.warn(`Failed to parse binary tick (${data.length} bytes): ${err.message}`);
            }
        });

        ws.on("error", (err) => {
            workerLogger.error(`WS error: ${err.message}`);
            this.emit("error", err);
        });

        ws.on("close", (code, reason) => {
            this.connecting = false;
            this.stopHeartbeat();
            workerLogger.warn(`WS closed (code ${code}${reason ? `, ${reason}` : ""})`);
            this.emit("close");
            if (!this.closedByUs) this.scheduleReconnect();
        });
    }

    /**
     * Subscribe a token list. Remembered so reconnects re-subscribe
     * automatically.
     * @param {number} mode        MODE.LTP | MODE.QUOTE | MODE.SNAP_QUOTE
     * @param {number} exchangeType EXCHANGE.NSE_CM | EXCHANGE.NSE_FO | ...
     * @param {string[]} tokens
     */
    subscribe(mode, exchangeType, tokens) {
        if (!tokens || !tokens.length) return;
        this.subscriptions.push({ mode, exchangeType, tokens });
        this.sendSubscription({ action: 1, mode, exchangeType, tokens });
    }

    unsubscribe(mode, exchangeType, tokens) {
        this.subscriptions = this.subscriptions.filter(
            (s) => !(s.mode === mode && s.exchangeType === exchangeType)
        );
        this.sendSubscription({ action: 0, mode, exchangeType, tokens });
    }

    sendSubscription({ action, mode, exchangeType, tokens }) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        const frame = {
            correlationID: `bazaar-sync-${mode}-${exchangeType}`,
            action, // 1 = subscribe, 0 = unsubscribe
            params: { mode, tokenList: [{ exchangeType, tokens }] },
        };
        this.ws.send(JSON.stringify(frame));
        workerLogger.info(
            `${action === 1 ? "Subscribed" : "Unsubscribed"} mode=${mode} exchange=${exchangeType} tokens=${tokens.length}`
        );
    }

    resubscribeAll() {
        for (const sub of this.subscriptions) {
            this.sendSubscription({ action: 1, ...sub });
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            // Dead-connection detection: no pong AND no ticks for too long
            if (Date.now() - this.lastActivityAt > HEARTBEAT_TIMEOUT_MS) {
                workerLogger.warn("No WS activity within heartbeat timeout — forcing reconnect");
                this.ws.terminate();
                return;
            }
            this.ws.send("ping");
        }, HEARTBEAT_INTERVAL_MS);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    scheduleReconnect() {
        if (this.closedByUs) return;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
        this.reconnectAttempt += 1;
        workerLogger.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempt})`);
        setTimeout(() => {
            if (!this.closedByUs) this.connect();
        }, delay);
    }

    close() {
        this.closedByUs = true;
        this.stopHeartbeat();
        if (this.ws) {
            try {
                this.ws.close();
            } catch (_) {
                /* already closed */
            }
            this.ws = null;
        }
    }
}

/**
 * Decode one SmartAPI 2.0 binary tick (little-endian).
 *
 * Common header (all modes):
 *   0        int8    subscription mode (1/2/3)
 *   1        int8    exchange type
 *   2-26     bytes   token, null-padded ASCII (25 bytes)
 *   27-34    int64   sequence number
 *   35-42    int64   exchange timestamp (ms since epoch)
 *   43-50    int64   last traded price (paise)
 * Quote (mode 2) additionally:
 *   51-58    int64   last traded quantity
 *   59-66    int64   average traded price (paise)
 *   67-74    int64   volume traded today
 *   75-82    double  total buy quantity
 *   83-90    double  total sell quantity
 *   91-98    int64   open  (paise)
 *   99-106   int64   high  (paise)
 *   107-114  int64   low   (paise)
 *   115-122  int64   close (paise)
 * SnapQuote (mode 3) additionally:
 *   123-130  int64   last traded timestamp
 *   131-138  int64   open interest
 *   139-146  double  open interest change %
 *   147+     best-five / circuit limits / 52wk (not needed, ignored)
 *
 * Returns null for frames too short to contain the common header.
 */
function parseBinaryTick(buf) {
    if (buf.length < 51) return null;

    const mode = buf.readInt8(0);
    const exchangeType = buf.readInt8(1);
    const token = buf.toString("ascii", 2, 27).replace(/\0/g, "").trim();
    const exchangeTimestamp = Number(buf.readBigInt64LE(35));
    const ltp = Number(buf.readBigInt64LE(43)) / PRICE_DIVISOR;

    const tick = { mode, exchangeType, token, exchangeTimestamp, ltp };

    if (mode >= MODE.QUOTE && buf.length >= 123) {
        tick.lastTradedQty = Number(buf.readBigInt64LE(51));
        tick.avgTradedPrice = Number(buf.readBigInt64LE(59)) / PRICE_DIVISOR;
        tick.volume = Number(buf.readBigInt64LE(67));
        tick.totalBuyQty = buf.readDoubleLE(75);
        tick.totalSellQty = buf.readDoubleLE(83);
        tick.open = Number(buf.readBigInt64LE(91)) / PRICE_DIVISOR;
        tick.high = Number(buf.readBigInt64LE(99)) / PRICE_DIVISOR;
        tick.low = Number(buf.readBigInt64LE(107)) / PRICE_DIVISOR;
        tick.close = Number(buf.readBigInt64LE(115)) / PRICE_DIVISOR;
    }
    if (mode >= MODE.SNAP_QUOTE && buf.length >= 147) {
        tick.lastTradedTimestamp = Number(buf.readBigInt64LE(123));
        tick.oi = Number(buf.readBigInt64LE(131));
        tick.oiChangePercent = buf.readDoubleLE(139);
    }

    return tick;
}

module.exports = { AngelOneWebSocket, parseBinaryTick, MODE, EXCHANGE };
