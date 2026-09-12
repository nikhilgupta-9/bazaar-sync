// lib/futuresStorage.js — shared futures_history row-shaping/storage, used by
// BOTH futures/enrich.js (Breeze) and upstox/enrichFutures.js (Upstox).
//
// Split out 2026-09-12: this used to live only in futures/enrich.js, and
// upstox/enrichFutures.js required it from there for these two functions —
// but futures/enrich.js also requires breeze/historicalService.js, and
// breezeconnect's own require() sets NODE_TLS_REJECT_UNAUTHORIZED=0 for the
// WHOLE Node process as a side effect (see breeze/README or parent CLAUDE.md
// Gotcha). That meant running the pure-Upstox futures pipeline — which has
// no Breeze dependency at all — silently disabled TLS certificate
// verification for its own Upstox/MySQL calls too, just from an unrelated
// `require`. Moving the source-agnostic storage code here removes that.

const { pool } = require("./db");

const INSERT_BATCH_SIZE = 500;

function withOiChange(candles) {
    let prevOi = null;
    return candles.map((c) => {
        const oiChange = prevOi != null ? c.oi - prevOi : null;
        prevOi = c.oi;
        return { ...c, oiChange };
    });
}

async function storeRows(symbol, expirySql, candles, spotByDate) {
    if (!candles.length) return 0;
    const values = candles.map((c) => [
        symbol, expirySql, c.date, c.time,
        c.open ?? null, c.high ?? null, c.low ?? null, c.close ?? null,
        c.volume ?? 0, c.oi ?? 0, c.oiChange ?? null,
        spotByDate.get(c.date) ?? null,
    ]);
    for (let i = 0; i < values.length; i += INSERT_BATCH_SIZE) {
        const batch = values.slice(i, i + INSERT_BATCH_SIZE);
        await pool.query(
            `INSERT INTO futures_history
               (symbol, expiry, trade_date, trade_time, open, high, low, close, volume, oi, oi_change, underlying_price)
             VALUES ?
             ON DUPLICATE KEY UPDATE
               open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close),
               volume=VALUES(volume), oi=VALUES(oi), oi_change=VALUES(oi_change),
               underlying_price=COALESCE(VALUES(underlying_price), underlying_price)`,
            [batch]
        );
    }
    return values.length;
}

module.exports = { storeRows, withOiChange };
