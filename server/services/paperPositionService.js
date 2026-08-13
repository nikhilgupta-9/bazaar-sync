// services/paperPositionService.js — Phase 8.3 shipped BUY (long CE/PE)
// only. Phase 8.4 added SELL (short/writing) too, with margin approximated
// as a flat percentage of notional (MARGIN_PERCENT_OF_NOTIONAL) since no
// real SPAN computation exists anywhere in this codebase (see Strategy
// Builder's own un-computed "Est. Margin: —"). There is deliberately NO
// intraday margin monitoring/auto square-off — a short just sits there,
// even underwater, until manually closed; the UI must communicate this
// plainly, not bury it. Each Buy/Sell creates its own position row (no
// averaging); close is all-or-nothing (no partial close) — both
// deliberate v1 choices, see CLAUDE.md Phase 8.3/8.4.
const { pool } = require("../config/db");
const marketCache = require("./marketCache");
const paperWalletService = require("./paperWalletService");
const { MAX_LOTS_PER_ORDER, MARGIN_PERCENT_OF_NOTIONAL } = require("../config/paperTradeConfig");

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

// The single place execution price comes from — server-side only, never a
// client-supplied price (same principle simulatorController.js's replay
// endpoint already documents for entry prices). Only the nearest
// live-subscribed expiry is tradeable (Gotcha #9/#14 — the worker only
// ever has one live expiry per symbol), and only while the feed is fresh.
function getLiveContractPrice(symbol, expiry, optRight, strike) {
    if (!marketCache.isFresh()) {
        throw badRequest("live market data is stale — try again during market hours");
    }
    const chain = marketCache.getChain(symbol);
    if (!chain || !chain.expiry) {
        throw badRequest("no live option chain available for this symbol right now");
    }
    if (chain.expiry !== expiry) {
        throw badRequest(`only the nearest live expiry (${chain.expiry}) can be traded right now`);
    }
    const row = chain.rows.find((r) => Number(r.strike) === Number(strike));
    const side = row && (optRight === "CE" ? row.ce : row.pe);
    if (!side || side.ltp == null) {
        throw badRequest("no live price available for this strike");
    }
    const lotSize = marketCache.getLotSize(symbol);
    if (!lotSize) throw badRequest("lot size unavailable for this symbol right now");

    return { ltp: side.ltp, lotSize, spot: chain.spot };
}

async function openPosition(userId, { symbol, expiry, strike, optRight, lots, side = "long" }) {
    const displaySymbol = String(symbol || "").toUpperCase();
    if (!["CE", "PE"].includes(optRight)) throw badRequest("optRight must be CE or PE");
    if (!["long", "short"].includes(side)) throw badRequest("side must be long or short");
    if (!Number.isInteger(lots) || lots < 1 || lots > MAX_LOTS_PER_ORDER) {
        throw badRequest(`lots must be a whole number between 1 and ${MAX_LOTS_PER_ORDER}`);
    }

    const { ltp, lotSize, spot } = getLiveContractPrice(displaySymbol, expiry, optRight, strike);
    const label = `${displaySymbol} ${strike}${optRight} x${lots}`;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        let marginBlocked = null;
        if (side === "long") {
            const cost = ltp * lots * lotSize;
            await paperWalletService.debit(conn, userId, cost, `Buy ${label}`);
        } else {
            if (!spot) throw badRequest("spot price unavailable — can't estimate margin right now");
            const premium = ltp * lots * lotSize;
            marginBlocked = spot * lotSize * lots * MARGIN_PERCENT_OF_NOTIONAL;
            // Credit premium first, then debit margin — debit()'s balance
            // check runs against balance-after-premium, so what's actually
            // enforced is "balance + premium >= margin", not "balance >= margin".
            await paperWalletService.credit(conn, userId, premium, `Sell ${label} — premium received`);
            await paperWalletService.debit(conn, userId, marginBlocked, `Sell ${label} — margin blocked`);
        }

        const [result] = await conn.query(
            `INSERT INTO paper_positions
             (user_id, symbol, expiry, strike, opt_right, side, lots, lot_size, entry_price, margin_blocked, entry_time, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'open')`,
            [userId, displaySymbol, expiry, strike, optRight, side, lots, lotSize, ltp, marginBlocked]
        );
        await conn.commit();
        const [[position]] = await pool.query("SELECT * FROM paper_positions WHERE id = ?", [result.insertId]);
        return position;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function closePosition(userId, positionId) {
    const [[position]] = await pool.query(
        "SELECT * FROM paper_positions WHERE id = ? AND user_id = ?",
        [positionId, userId]
    );
    if (!position) throw Object.assign(new Error("position not found"), { status: 404 });
    if (position.status !== "open") throw badRequest("position is already closed");

    // Known v1 limitation: if this position's expiry has aged out of the
    // live window (a new nearer expiry has taken over), this throws — there
    // is no historical/expiry-settlement fallback yet. Documented, not solved.
    const { ltp } = getLiveContractPrice(position.symbol, position.expiry, position.opt_right, position.strike);
    const label = `${position.symbol} ${position.strike}${position.opt_right} x${position.lots}`;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        let realizedPnl;
        if (position.side === "long") {
            const proceeds = ltp * position.lots * position.lot_size;
            const cost = Number(position.entry_price) * position.lots * position.lot_size;
            realizedPnl = proceeds - cost;
            await paperWalletService.credit(conn, userId, proceeds, `Close ${label}`);
        } else {
            const entryPremium = Number(position.entry_price) * position.lots * position.lot_size;
            const buybackCost = ltp * position.lots * position.lot_size;
            realizedPnl = entryPremium - buybackCost;
            // Release the blocked margin, then pay to buy back — the buyback
            // MUST succeed even if it drives the balance negative (see
            // forceDebit's doc comment: closing must never be blocked, only
            // opening a new position is balance-checked).
            await paperWalletService.credit(conn, userId, Number(position.margin_blocked), `Close ${label} — margin released`);
            await paperWalletService.forceDebit(conn, userId, buybackCost, `Close ${label} — bought back`);
        }

        await conn.query(
            `UPDATE paper_positions
             SET status = 'closed', exit_price = ?, exit_time = NOW(), realized_pnl = ?
             WHERE id = ?`,
            [ltp, realizedPnl, positionId]
        );
        await conn.commit();
        const [[updated]] = await pool.query("SELECT * FROM paper_positions WHERE id = ?", [positionId]);
        return updated;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// Best-effort mark-to-market — a position whose price can't currently be
// resolved (e.g. its expiry aged out of the live window) comes back with
// livePrice/unrealizedPnl: null rather than failing the whole list, same
// "gap, not a guess" convention Simulator.jsx uses for missing per-minute data.
async function listOpenPositions(userId) {
    const [rows] = await pool.query(
        "SELECT * FROM paper_positions WHERE user_id = ? AND status = 'open' ORDER BY entry_time DESC",
        [userId]
    );
    return rows.map((p) => {
        let livePrice = null;
        let unrealizedPnl = null;
        try {
            livePrice = getLiveContractPrice(p.symbol, p.expiry, p.opt_right, p.strike).ltp;
            unrealizedPnl = p.side === "long"
                ? (livePrice - Number(p.entry_price)) * p.lots * p.lot_size
                : (Number(p.entry_price) - livePrice) * p.lots * p.lot_size;
        } catch {
            // leave livePrice/unrealizedPnl null — see function comment above
        }
        return { ...p, livePrice, unrealizedPnl };
    });
}

async function listClosedPositions(userId, limit = 50) {
    const [rows] = await pool.query(
        "SELECT * FROM paper_positions WHERE user_id = ? AND status = 'closed' ORDER BY exit_time DESC LIMIT ?",
        [userId, limit]
    );
    return rows;
}

module.exports = { openPosition, closePosition, listOpenPositions, listClosedPositions, getLiveContractPrice };
