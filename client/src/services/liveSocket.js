// services/liveSocket.js — the ONE live-data path for the frontend.
//
// React talks only to our own backend's socket.io server (VITE_API_URL) —
// never to the broker, never to MySQL. The backend broadcasts "latestTicks"
// frames (built from its in-memory market cache) roughly once a second per
// subscribed symbol, plus "marketStatus" heartbeats.
//
// One shared socket per tab; pages subscribe/unsubscribe per symbol.

import { io } from "socket.io-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

let socket = null;

export function getLiveSocket() {
    if (!socket) {
        socket = io(API_URL, {
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 30000,
        });
    }
    return socket;
}

/**
 * Subscribe to one symbol's live frames.
 * @param {string} symbol  NIFTY | BANKNIFTY | FINNIFTY
 * @param {(frame: object) => void} onTicks       "latestTicks" frames for this symbol
 * @param {(status: object) => void} [onStatus]   "marketStatus" heartbeats
 * @returns {() => void} unsubscribe/cleanup function
 */
export function subscribeLiveTicks(symbol, onTicks, onStatus) {
    const s = getLiveSocket();
    const sym = symbol.toUpperCase();

    const handleTicks = (frame) => {
        if (frame && frame.symbol === sym) onTicks(frame);
    };
    const handleStatus = (status) => {
        if (onStatus) onStatus(status);
    };
    const join = () => s.emit("subscribe", { symbol: sym });

    s.on("latestTicks", handleTicks);
    s.on("marketStatus", handleStatus);
    s.on("connect", join); // (re)join on every connect/reconnect
    if (s.connected) join();

    return () => {
        s.emit("unsubscribe", { symbol: sym });
        s.off("latestTicks", handleTicks);
        s.off("marketStatus", handleStatus);
        s.off("connect", join);
    };
}
