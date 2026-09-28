// services/paperPositionService.js — Real-time Paper Trading Execution Service
// Supports live execution from Angel One WebSocket feed (via marketCache) with
// seamless fallback to optionChainService for 24/7 testing and practice.
// Handles single orders, multi-leg strategy execution, margin blocking, and square-off.

const { pool } = require("../config/db");
const marketCache = require("./marketCache");
const optionChainService = require("./optionChainService");
const lotSizeHistoryService = require("./lotSizeHistoryService");
const instrumentMaster = require("./instrumentMaster");
const paperWalletService = require("./paperWalletService");
const { MAX_LOTS_PER_ORDER, MARGIN_PERCENT_OF_NOTIONAL } = require("../config/paperTradeConfig");

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

/**
 * Resolves contract price and lot size from live feed or latest option chain snapshot.
 */
async function getLiveContractPrice(symbol, expiry, optRight, strike) {
    const sym = String(symbol || "").toUpperCase();
    const strikeNum = Number(strike);
    const right = String(optRight || "").toUpperCase();

    // 1. Try in-memory marketCache live tick if fresh
    if (marketCache.isFresh()) {
        const chain = marketCache.getChain(sym);
        if (chain && chain.rows) {
            const row = chain.rows.find((r) => Number(r.strike) === strikeNum);
            const side = row && (right === "CE" ? row.ce : row.pe);
            if (side && side.ltp != null && side.ltp > 0) {
                const lotSize = marketCache.getLotSize(sym) || (await instrumentMaster.getLotSize(sym)) || 50;
                return { ltp: Number(side.ltp), lotSize: Number(lotSize), spot: Number(chain.spot || side.ltp), isLive: true };
            }
        }
    }

    // 2. Fallback to optionChainService (works 24/7 using real stored market snapshots)
    try {
        const chainData = await optionChainService.getOptionChain(sym, expiry);
        if (chainData && chainData.rows && chainData.rows.length) {
            const row = chainData.rows.find((r) => Number(r.strike) === strikeNum);
            const side = row && (right === "CE" ? row.ce : row.pe);
            if (side && side.ltp != null && side.ltp > 0) {
                const lotSize = Number(chainData.lotSize) || (await lotSizeHistoryService.getLotSizeAsOf(sym, chainData.date || new Date().toISOString().slice(0, 10))) || 50;
                return { ltp: Number(side.ltp), lotSize, spot: Number(chainData.spot || side.ltp), isLive: false };
            }
        }
    } catch (err) {
        console.warn(`[paperPositionService] optionChain fallback lookup error for ${sym} ${strike} ${right}:`, err.message);
    }

    // 3. Database direct snapshot lookup as final recovery
    try {
        const [dbRows] = await pool.query(
            `SELECT ce_ltp, pe_ltp, underlying_price FROM option_chain_history
             WHERE symbol = ? AND strike = ? ORDER BY trade_date DESC, trade_time DESC LIMIT 1`,
            [sym, strikeNum]
        );
        if (dbRows.length) {
            const price = right === "CE" ? dbRows[0].ce_ltp : dbRows[0].pe_ltp;
            if (price != null && Number(price) > 0) {
                const lotSize = (await instrumentMaster.getLotSize(sym)) || 50;
                return { ltp: Number(price), lotSize, spot: Number(dbRows[0].underlying_price || price), isLive: false };
            }
        }
    } catch {
        /* ignore */
    }

    throw badRequest(`No market price available for ${sym} ${strike} ${right}`);
}

const MONTHS_MAP = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

function normalizeExpiryDate(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (m) {
        const mon = MONTHS_MAP[m[2].toUpperCase()];
        const day = m[1].padStart(2, "0");
        if (mon) return `${m[3]}-${mon}-${day}`;
    }
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
    }
    return str;
}

/**
 * Open a single paper position (Buy/Sell CE or PE).
 */
async function openPosition(userId, { symbol, expiry, strike, optRight, opt_right, option_type, type, lots, side = "long", strategyName = null }) {
    const displaySymbol = String(symbol || "").toUpperCase();
    const right = String(optRight || opt_right || option_type || type || "").toUpperCase();
    const posSide = side === "short" || side === "sell" ? "short" : "long";
    const normExpiry = normalizeExpiryDate(expiry);

    if (!["CE", "PE"].includes(right)) throw badRequest(`Option right must be CE or PE (received '${right}')`);
    if (!normExpiry) throw badRequest("Invalid expiry date");
    if (!Number.isInteger(Number(lots)) || Number(lots) < 1 || Number(lots) > MAX_LOTS_PER_ORDER) {
        throw badRequest(`lots must be a whole number between 1 and ${MAX_LOTS_PER_ORDER}`);
    }

    const { ltp, lotSize, spot } = await getLiveContractPrice(displaySymbol, normExpiry, right, strike);
    const label = `${displaySymbol} ${strike}${right} x${lots}`;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        let marginBlocked = null;
        if (posSide === "long") {
            const cost = ltp * lots * lotSize;
            await paperWalletService.debit(conn, userId, cost, `Buy ${label}`);
        } else {
            const premium = ltp * lots * lotSize;
            const spotRef = spot || strike;
            marginBlocked = spotRef * lotSize * lots * MARGIN_PERCENT_OF_NOTIONAL;
            await paperWalletService.credit(conn, userId, premium, `Sell ${label} — premium received`);
            await paperWalletService.debit(conn, userId, marginBlocked, `Sell ${label} — margin blocked`);
        }

        const [result] = await conn.query(
            `INSERT INTO paper_positions
             (user_id, symbol, expiry, strike, opt_right, side, lots, lot_size, entry_price, margin_blocked, strategy_name, entry_time, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'open')`,
            [userId, displaySymbol, normExpiry, strike, right, posSide, lots, lotSize, ltp, marginBlocked, strategyName]
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

/**
 * Open multiple legs in a single atomic transaction (Multi-Leg Strategy Builder execution).
 */
async function openStrategyPositions(userId, { symbol, expiry, legs, strategyName = "Custom Strategy" }) {
    const displaySymbol = String(symbol || "").toUpperCase();
    if (!Array.isArray(legs) || legs.length === 0) {
        throw badRequest("legs array must not be empty");
    }

    // Resolve live prices and quantities for all legs
    const resolvedLegs = [];
    for (const leg of legs) {
        const right = String(leg.optRight || leg.opt_right || leg.option_type || leg.type || leg.right || "").toUpperCase();
        if (!["CE", "PE"].includes(right)) {
            throw badRequest(`Option right for strike ${leg.strike} must be CE or PE (received '${right}')`);
        }
        const strike = Number(leg.strike);
        const side = (leg.side || leg.action || "buy").toLowerCase() === "sell" || leg.side === "short" ? "short" : "long";
        const lots = Number(leg.lots || leg.qty || 1);
        const legExpiry = normalizeExpiryDate(leg.expiry || expiry);
        if (!legExpiry) throw badRequest(`Invalid expiry for strike ${strike}`);

        const priceData = await getLiveContractPrice(displaySymbol, legExpiry, right, strike);
        resolvedLegs.push({
            strike,
            optRight: right,
            side,
            lots,
            expiry: legExpiry,
            ltp: priceData.ltp,
            lotSize: priceData.lotSize,
            spot: priceData.spot,
        });
    }

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const createdPositions = [];
        for (const leg of resolvedLegs) {
            const label = `${displaySymbol} ${leg.strike}${leg.optRight} (${leg.side.toUpperCase()}) x${leg.lots}`;
            let marginBlocked = null;

            if (leg.side === "long") {
                const cost = leg.ltp * leg.lots * leg.lotSize;
                await paperWalletService.debit(conn, userId, cost, `Paper Order: Buy ${label} [${strategyName}]`);
            } else {
                const premium = leg.ltp * leg.lots * leg.lotSize;
                const spotRef = leg.spot || leg.strike;
                marginBlocked = spotRef * leg.lotSize * leg.lots * MARGIN_PERCENT_OF_NOTIONAL;
                await paperWalletService.credit(conn, userId, premium, `Paper Order: Sell ${label} [${strategyName}] — premium`);
                await paperWalletService.debit(conn, userId, marginBlocked, `Paper Order: Sell ${label} [${strategyName}] — margin`);
            }

            const [result] = await conn.query(
                `INSERT INTO paper_positions
                 (user_id, symbol, expiry, strike, opt_right, side, lots, lot_size, entry_price, margin_blocked, strategy_name, entry_time, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'open')`,
                [userId, displaySymbol, leg.expiry, leg.strike, leg.optRight, leg.side, leg.lots, leg.lotSize, leg.ltp, marginBlocked, strategyName]
            );

            const [[pos]] = await conn.query("SELECT * FROM paper_positions WHERE id = ?", [result.insertId]);
            createdPositions.push(pos);
        }

        await conn.commit();
        return createdPositions;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Close a single paper position and realize P&L.
 */
async function closePosition(userId, positionId) {
    const [[position]] = await pool.query(
        "SELECT * FROM paper_positions WHERE id = ? AND user_id = ?",
        [positionId, userId]
    );
    if (!position) throw Object.assign(new Error("position not found"), { status: 404 });
    if (position.status !== "open") throw badRequest("position is already closed");

    const { ltp } = await getLiveContractPrice(position.symbol, position.expiry, position.opt_right, position.strike);
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
            if (position.margin_blocked != null) {
                await paperWalletService.credit(conn, userId, Number(position.margin_blocked), `Close ${label} — margin released`);
            }
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

/**
 * Close all open positions for a user (optionally filtered by symbol).
 */
async function closeAllPositions(userId, symbol = null) {
    const query = symbol
        ? "SELECT id FROM paper_positions WHERE user_id = ? AND symbol = ? AND status = 'open'"
        : "SELECT id FROM paper_positions WHERE user_id = ? AND status = 'open'";
    const params = symbol ? [userId, String(symbol).toUpperCase()] : [userId];
    const [openRows] = await pool.query(query, params);

    const closed = [];
    for (const r of openRows) {
        try {
            const pos = await closePosition(userId, r.id);
            closed.push(pos);
        } catch (err) {
            console.error(`[paperPositionService] failed closing position ${r.id}:`, err.message);
        }
    }
    return closed;
}

/**
 * List all open positions with real-time mark-to-market P&L.
 */
async function listOpenPositions(userId) {
    const [rows] = await pool.query(
        "SELECT * FROM paper_positions WHERE user_id = ? AND status = 'open' ORDER BY entry_time DESC",
        [userId]
    );

    const results = [];
    for (const p of rows) {
        let livePrice = null;
        let unrealizedPnl = null;
        let pnlPercent = null;
        try {
            const priceData = await getLiveContractPrice(p.symbol, p.expiry, p.opt_right, p.strike);
            livePrice = priceData.ltp;
            const entry = Number(p.entry_price);
            if (p.side === "long") {
                unrealizedPnl = (livePrice - entry) * p.lots * p.lot_size;
                pnlPercent = entry > 0 ? ((livePrice - entry) / entry) * 100 : 0;
            } else {
                unrealizedPnl = (entry - livePrice) * p.lots * p.lot_size;
                pnlPercent = entry > 0 ? ((entry - livePrice) / entry) * 100 : 0;
            }
        } catch {
            // mark-to-market fallback
        }
        results.push({
            ...p,
            livePrice,
            unrealizedPnl: unrealizedPnl != null ? Number(unrealizedPnl.toFixed(2)) : null,
            pnlPercent: pnlPercent != null ? Number(pnlPercent.toFixed(2)) : null,
        });
    }
    return results;
}

/**
 * List closed positions history.
 */
async function listClosedPositions(userId, limit = 100) {
    const [rows] = await pool.query(
        "SELECT * FROM paper_positions WHERE user_id = ? AND status = 'closed' ORDER BY exit_time DESC LIMIT ?",
        [userId, Number(limit) || 100]
    );
    return rows;
}

module.exports = {
    openPosition,
    openStrategyPositions,
    closePosition,
    closeAllPositions,
    listOpenPositions,
    listClosedPositions,
    getLiveContractPrice,
};
