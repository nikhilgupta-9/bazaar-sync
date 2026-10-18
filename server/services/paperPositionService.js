// services/paperPositionService.js — Real-Time Live Paper Trading & Order Matching Engine
// STRICT ARCHITECTURAL RULE:
// Paper Trading runs STRICTLY on LIVE market data (Angel One WebSocket, Kotak Neo Poller, Delta Exchange).
// Historical Replay Simulator data NEVER enters or triggers this engine.

const { pool } = require("../config/db");
const marketCache = require("./marketCache");
const optionChainService = require("./optionChainService");
const lotSizeHistoryService = require("./lotSizeHistoryService");
const instrumentMaster = require("./instrumentMaster");
const paperWalletService = require("./paperWalletService");
const socketBroadcast = require("./socketBroadcast");
const { marketHours } = require("../utils/marketUtils");
const { MAX_LOTS_PER_ORDER, MARGIN_PERCENT_OF_NOTIONAL } = require("../config/paperTradeConfig");

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

const MONTHS_MAP = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

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

function makeContractKey(symbol, strike, right) {
    const sym = String(symbol || "").toUpperCase();
    const s = Number(strike || 0).toFixed(2);
    const r = String(right || "").toUpperCase();
    return `${sym}_${s}_${r}`;
}

// ---------------------------------------------------------------------------
// In-Memory Real-Time Watch Maps (Zero-DB lookup during incoming tick flood)
// ---------------------------------------------------------------------------
// pendingOrdersWatch: contractKey -> Map<orderId, orderObj>
const pendingOrdersWatch = new Map();
// positionBracketsWatch: contractKey -> Map<positionId, positionObj>
const positionBracketsWatch = new Map();

let isWatchMapsWarmed = false;
let isMatchingInProgress = false;

/**
 * Initializes paper trading schema: ensures `paper_orders` table and bracket columns exist.
 */
async function initPaperTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS paper_orders (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                user_id BIGINT UNSIGNED NOT NULL,
                position_id BIGINT UNSIGNED DEFAULT NULL,
                symbol VARCHAR(20) NOT NULL,
                expiry DATE NOT NULL,
                strike DECIMAL(10,2) NOT NULL,
                opt_right ENUM('CE','PE') NOT NULL,
                side ENUM('buy','sell') NOT NULL,
                order_type ENUM('MARKET','LIMIT','SL','SL-M') NOT NULL DEFAULT 'MARKET',
                status ENUM('PENDING','EXECUTED','CANCELLED','REJECTED') NOT NULL DEFAULT 'PENDING',
                lots INT NOT NULL,
                lot_size INT NOT NULL,
                price DECIMAL(10,2) DEFAULT NULL,
                trigger_price DECIMAL(10,2) DEFAULT NULL,
                executed_price DECIMAL(10,2) DEFAULT NULL,
                stop_loss_price DECIMAL(10,2) DEFAULT NULL,
                target_price DECIMAL(10,2) DEFAULT NULL,
                trailing_sl DECIMAL(10,2) DEFAULT NULL,
                strategy_name VARCHAR(100) DEFAULT NULL,
                rejection_reason VARCHAR(255) DEFAULT NULL,
                placed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                executed_at DATETIME DEFAULT NULL,
                cancelled_at DATETIME DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_user_status (user_id, status),
                KEY idx_match_pending (status, symbol, strike, opt_right)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
        `);

        // Check if paper_positions has bracket columns
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'paper_positions'"
        );
        const colNames = new Set((cols || []).map((c) => c.COLUMN_NAME));
        if (!colNames.has("stop_loss_price")) {
            await pool.query("ALTER TABLE paper_positions ADD COLUMN stop_loss_price DECIMAL(10,2) DEFAULT NULL");
        }
        if (!colNames.has("target_price")) {
            await pool.query("ALTER TABLE paper_positions ADD COLUMN target_price DECIMAL(10,2) DEFAULT NULL");
        }
        if (!colNames.has("trailing_sl")) {
            await pool.query("ALTER TABLE paper_positions ADD COLUMN trailing_sl DECIMAL(10,2) DEFAULT NULL");
        }
        // why a position was closed: manual / close_all / stop_loss / target
        if (!colNames.has("exit_reason")) {
            await pool.query("ALTER TABLE paper_positions ADD COLUMN exit_reason VARCHAR(20) DEFAULT NULL");
        }

        await syncWatchMaps();
    } catch (err) {
        console.error("[paperPositionService:initPaperTables] Error:", err.message);
    }
}

/**
 * Synchronizes in-memory watch maps with active MySQL pending orders and open position brackets.
 */
async function syncWatchMaps() {
    try {
        pendingOrdersWatch.clear();
        positionBracketsWatch.clear();

        // 1. Pending orders
        const [orders] = await pool.query(
            "SELECT * FROM paper_orders WHERE status = 'PENDING'"
        );
        for (const ord of orders || []) {
            const key = makeContractKey(ord.symbol, ord.strike, ord.opt_right);
            if (!pendingOrdersWatch.has(key)) pendingOrdersWatch.set(key, new Map());
            pendingOrdersWatch.get(key).set(ord.id, ord);
        }

        // 2. Open positions with SL or Target brackets
        const [positions] = await pool.query(
            "SELECT * FROM paper_positions WHERE status = 'open' AND (stop_loss_price IS NOT NULL OR target_price IS NOT NULL)"
        );
        for (const pos of positions || []) {
            const key = makeContractKey(pos.symbol, pos.strike, pos.opt_right);
            if (!positionBracketsWatch.has(key)) positionBracketsWatch.set(key, new Map());
            positionBracketsWatch.get(key).set(pos.id, pos);
        }

        isWatchMapsWarmed = true;
    } catch (err) {
        console.error("[paperPositionService:syncWatchMaps] Error:", err.message);
    }
}

// Auto-run schema & watch map init on startup
initPaperTables().catch(() => {});

/**
 * Resolves contract price and lot size from live feed.
 * For Indian Market: strictly reads marketCache live feed or recent snapshot fallback.
 * For Crypto: reads Delta Exchange live option chain.
 */
async function getLiveContractPrice(symbol, expiry, optRight, strike) {
    const sym = String(symbol || "").toUpperCase();
    const strikeNum = Number(strike);
    const right = String(optRight || "").toUpperCase();

    // 1. Crypto Underlying (Delta Exchange Live)
    if (sym === "BTC" || sym === "ETH" || sym === "SOL" || sym.startsWith("BTC") || sym.startsWith("ETH") || sym.startsWith("SOL")) {
        try {
            const deltaExchangeService = require("./deltaExchangeService");
            const chain = await deltaExchangeService.getCryptoOptionChain(sym, expiry);
            if (chain && chain.rows) {
                const row = chain.rows.find((r) => Math.abs(Number(r.strike) - strikeNum) < 0.01);
                const side = row && (right === "CE" ? row.ce : row.pe);
                if (side && side.ltp != null && side.ltp > 0) {
                    return {
                        ltp: Number(side.ltp),
                        lotSize: 1,
                        spot: Number(chain.spotPrice || side.ltp),
                        isLive: true,
                        source: "delta_exchange",
                    };
                }
            }
        } catch (err) {
            console.warn(`[paperPositionService] Delta crypto price error for ${sym}:`, err.message);
        }
    }

    // 2. Indian Market Live Cache (Angel One WebSocket / Kotak Poller)
    if (marketCache.isFresh()) {
        const chain = marketCache.getChain(sym);
        if (chain && chain.rows) {
            const row = chain.rows.find((r) => Math.abs(Number(r.strike) - strikeNum) < 0.01);
            const side = row && (right === "CE" ? row.ce : row.pe);
            if (side && side.ltp != null && side.ltp > 0) {
                const lotSize = marketCache.getLotSize(sym) || (await instrumentMaster.getLotSize(sym)) || 50;
                return {
                    ltp: Number(side.ltp),
                    lotSize: Number(lotSize),
                    spot: Number(chain.spot || side.ltp),
                    isLive: true,
                    source: "live_cache",
                };
            }
        }
    }

    // 3. Indian Market Fallback Snapshot (Outside market hours / testing)
    try {
        const chainData = await optionChainService.getOptionChain(sym, expiry);
        if (chainData && chainData.rows && chainData.rows.length) {
            const row = chainData.rows.find((r) => Math.abs(Number(r.strike) - strikeNum) < 0.01);
            const side = row && (right === "CE" ? row.ce : row.pe);
            if (side && side.ltp != null && side.ltp > 0) {
                const lotSize = Number(chainData.lotSize) || (await lotSizeHistoryService.getLotSizeAsOf(sym, chainData.date || new Date().toISOString().slice(0, 10))) || 50;
                return {
                    ltp: Number(side.ltp),
                    lotSize,
                    spot: Number(chainData.spotPrice || side.ltp),
                    isLive: false,
                    source: "option_chain_snapshot",
                };
            }
        }
    } catch (err) {
        console.warn(`[paperPositionService] optionChain fallback lookup error for ${sym} ${strike} ${right}:`, err.message);
    }

    // 4. Final DB snapshot fallback
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
                return {
                    ltp: Number(price),
                    lotSize,
                    spot: Number(dbRows[0].underlying_price || price),
                    isLive: false,
                    source: "database_snapshot",
                };
            }
        }
    } catch {}

    throw badRequest(`No market price available for ${sym} ${strike} ${right}`);
}

/**
 * Open a single paper position (Buy/Sell CE or PE).
 */
async function openPosition(userId, {
    symbol, expiry, strike, optRight, opt_right, option_type, type,
    lots, side = "long", strategyName = null,
    orderType = "MARKET", price = null, triggerPrice = null,
    stopLossPrice = null, targetPrice = null, trailingSl = null,
}) {
    const displaySymbol = String(symbol || "").toUpperCase();
    const right = String(optRight || opt_right || option_type || type || "").toUpperCase();
    const posSide = side === "short" || side === "sell" ? "short" : "long";
    const normExpiry = normalizeExpiryDate(expiry);

    if (!["CE", "PE"].includes(right)) throw badRequest(`Option right must be CE or PE (received '${right}')`);
    if (!normExpiry) throw badRequest("Invalid expiry date");
    if (!Number.isInteger(Number(lots)) || Number(lots) < 1 || Number(lots) > MAX_LOTS_PER_ORDER) {
        throw badRequest(`lots must be a whole number between 1 and ${MAX_LOTS_PER_ORDER}`);
    }

    // If orderType is LIMIT or SL, route to pending order placement
    if (orderType && orderType.toUpperCase() !== "MARKET") {
        return placeOrder(userId, {
            symbol: displaySymbol,
            expiry: normExpiry,
            strike,
            optRight: right,
            side: posSide === "long" ? "buy" : "sell",
            orderType: orderType.toUpperCase(),
            price,
            triggerPrice,
            lots,
            stopLossPrice,
            targetPrice,
            trailingSl,
            strategyName,
        });
    }

    // MARKET Order Execution
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
            const isCryptoSym = ["BTC", "ETH", "SOL"].includes(String(displaySymbol).toUpperCase());
            const marginRate = isCryptoSym ? 0.05 : MARGIN_PERCENT_OF_NOTIONAL;
            marginBlocked = spotRef * lotSize * lots * marginRate;
            await paperWalletService.credit(conn, userId, premium, `Sell ${label} — premium received`);
            await paperWalletService.debit(conn, userId, marginBlocked, `Sell ${label} — margin blocked`);
        }

        const [result] = await conn.query(
            `INSERT INTO paper_positions
             (user_id, symbol, expiry, strike, opt_right, side, lots, lot_size, entry_price, margin_blocked,
              stop_loss_price, target_price, trailing_sl, strategy_name, entry_time, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'open')`,
            [
                userId, displaySymbol, normExpiry, strike, right, posSide, lots, lotSize, ltp, marginBlocked,
                stopLossPrice != null ? Number(stopLossPrice) : null,
                targetPrice != null ? Number(targetPrice) : null,
                trailingSl != null ? Number(trailingSl) : null,
                strategyName,
            ]
        );

        // Also record executed order in paper_orders
        await conn.query(
            `INSERT INTO paper_orders
             (user_id, position_id, symbol, expiry, strike, opt_right, side, order_type, status,
              lots, lot_size, price, trigger_price, executed_price, stop_loss_price, target_price,
              trailing_sl, strategy_name, placed_at, executed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'MARKET', 'EXECUTED', ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [
                userId, result.insertId, displaySymbol, normExpiry, strike, right,
                posSide === "long" ? "buy" : "sell", lots, lotSize, ltp, triggerPrice, ltp,
                stopLossPrice, targetPrice, trailingSl, strategyName,
            ]
        );

        await conn.commit();
        const [[position]] = await pool.query("SELECT * FROM paper_positions WHERE id = ?", [result.insertId]);

        // Register in position bracket watch map if SL or TP set
        if (position.stop_loss_price != null || position.target_price != null) {
            const key = makeContractKey(position.symbol, position.strike, position.opt_right);
            if (!positionBracketsWatch.has(key)) positionBracketsWatch.set(key, new Map());
            positionBracketsWatch.get(key).set(position.id, position);
        }

        socketBroadcast.emitPaperEvent("paper:position_opened", {
            userId,
            position,
            timestamp: new Date().toISOString(),
        });

        return position;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Place a Pending (Limit / Stop-Loss) or Market Paper Order.
 */
async function placeOrder(userId, {
    symbol, expiry, strike, optRight, side = "buy",
    orderType = "LIMIT", price = null, triggerPrice = null,
    lots = 1, stopLossPrice = null, targetPrice = null, trailingSl = null,
    strategyName = null,
}) {
    const sym = String(symbol || "").toUpperCase();
    const right = String(optRight || "").toUpperCase();
    const orderSide = side.toLowerCase() === "sell" || side === "short" ? "sell" : "buy";
    const ordType = String(orderType || "LIMIT").toUpperCase();
    const normExpiry = normalizeExpiryDate(expiry);

    if (!["CE", "PE"].includes(right)) throw badRequest(`Option right must be CE or PE (received '${right}')`);
    if (!normExpiry) throw badRequest("Invalid expiry date");
    if (!Number.isInteger(Number(lots)) || Number(lots) < 1 || Number(lots) > MAX_LOTS_PER_ORDER) {
        throw badRequest(`lots must be between 1 and ${MAX_LOTS_PER_ORDER}`);
    }
    if (!["MARKET", "LIMIT", "SL", "SL-M"].includes(ordType)) {
        throw badRequest(`Invalid orderType: ${ordType}. Must be MARKET, LIMIT, SL, or SL-M.`);
    }

    if (ordType === "LIMIT" && (price == null || Number(price) <= 0)) {
        throw badRequest("A valid positive limit price is required for LIMIT orders.");
    }
    if ((ordType === "SL" || ordType === "SL-M") && (triggerPrice == null || Number(triggerPrice) <= 0)) {
        throw badRequest("A valid positive triggerPrice is required for SL/SL-M orders.");
    }

    // Resolve current contract info & lot size
    const priceData = await getLiveContractPrice(sym, normExpiry, right, strike);
    const lotSize = priceData.lotSize || 50;
    const currentLtp = priceData.ltp;

    // Check if limit condition is already satisfied immediately (Marketable Limit)
    let isImmediateFill = false;
    if (ordType === "MARKET") {
        isImmediateFill = true;
    } else if (ordType === "LIMIT") {
        if (orderSide === "buy" && currentLtp <= Number(price)) isImmediateFill = true;
        if (orderSide === "sell" && currentLtp >= Number(price)) isImmediateFill = true;
    }

    if (isImmediateFill) {
        return openPosition(userId, {
            symbol: sym,
            expiry: normExpiry,
            strike,
            optRight: right,
            lots,
            side: orderSide === "buy" ? "long" : "short",
            strategyName,
            stopLossPrice,
            targetPrice,
            trailingSl,
        });
    }

    // Validate virtual funds / margin before placing pending order
    const [[wallet]] = await pool.query("SELECT balance FROM paper_wallets WHERE user_id = ?", [userId]);
    const balance = Number(wallet?.balance || 0);
    const refPrice = Number(price || triggerPrice || currentLtp);
    const isCryptoSym = ["BTC", "ETH", "SOL"].includes(String(sym).toUpperCase());
    const marginRate = isCryptoSym ? 0.05 : MARGIN_PERCENT_OF_NOTIONAL;
    const requiredFunds = orderSide === "buy"
        ? refPrice * lots * lotSize
        : (priceData.spot || strike) * lotSize * lots * marginRate;

    if (balance < requiredFunds) {
        throw badRequest(`Insufficient virtual balance (${isCryptoSym ? "$" : "₹"}${balance.toLocaleString()}) for order requirement (${isCryptoSym ? "$" : "₹"}${requiredFunds.toLocaleString()})`);
    }

    // Insert as PENDING order
    const [insertRes] = await pool.query(
        `INSERT INTO paper_orders
         (user_id, symbol, expiry, strike, opt_right, side, order_type, status,
          lots, lot_size, price, trigger_price, stop_loss_price, target_price,
          trailing_sl, strategy_name, placed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
            userId, sym, normExpiry, strike, right, orderSide, ordType,
            lots, lotSize, price != null ? Number(price) : null,
            triggerPrice != null ? Number(triggerPrice) : null,
            stopLossPrice != null ? Number(stopLossPrice) : null,
            targetPrice != null ? Number(targetPrice) : null,
            trailingSl != null ? Number(trailingSl) : null,
            strategyName,
        ]
    );

    const [[createdOrder]] = await pool.query("SELECT * FROM paper_orders WHERE id = ?", [insertRes.insertId]);

    // Register into in-memory watch map
    const contractKey = makeContractKey(sym, strike, right);
    if (!pendingOrdersWatch.has(contractKey)) pendingOrdersWatch.set(contractKey, new Map());
    pendingOrdersWatch.get(contractKey).set(createdOrder.id, createdOrder);

    socketBroadcast.emitPaperEvent("paper:order_placed", {
        userId,
        order: createdOrder,
        timestamp: new Date().toISOString(),
    });

    return createdOrder;
}

/**
 * Cancel a pending paper order.
 */
async function cancelOrder(userId, orderId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[order]] = await conn.query(
            "SELECT * FROM paper_orders WHERE id = ? AND user_id = ? FOR UPDATE",
            [orderId, userId]
        );

        if (!order) throw Object.assign(new Error("Order not found"), { status: 404 });
        if (order.status !== "PENDING") {
            throw badRequest(`Cannot cancel order with status: ${order.status}`);
        }

        await conn.query(
            "UPDATE paper_orders SET status = 'CANCELLED', cancelled_at = NOW() WHERE id = ?",
            [orderId]
        );

        await conn.commit();

        // Remove from in-memory watch map
        const key = makeContractKey(order.symbol, order.strike, order.opt_right);
        if (pendingOrdersWatch.has(key)) {
            pendingOrdersWatch.get(key).delete(Number(orderId));
        }

        const [[cancelled]] = await pool.query("SELECT * FROM paper_orders WHERE id = ?", [orderId]);

        socketBroadcast.emitPaperEvent("paper:order_cancelled", {
            userId,
            orderId,
            timestamp: new Date().toISOString(),
        });

        return cancelled;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * List orders (pending, executed, cancelled).
 */
async function listOrders(userId, { status = null, limit = 100 } = {}) {
    let sql = "SELECT * FROM paper_orders WHERE user_id = ?";
    const params = [userId];

    if (status) {
        sql += " AND status = ?";
        params.push(status.toUpperCase());
    }

    sql += " ORDER BY placed_at DESC LIMIT ?";
    params.push(Number(limit) || 100);

    const [rows] = await pool.query(sql, params);
    return rows;
}

/**
 * Update Stop Loss or Target on an existing open position.
 */
async function updatePositionBracket(userId, positionId, { stopLossPrice = null, targetPrice = null, trailingSl = null }) {
    const [[position]] = await pool.query(
        "SELECT * FROM paper_positions WHERE id = ? AND user_id = ?",
        [positionId, userId]
    );

    if (!position) throw Object.assign(new Error("Position not found"), { status: 404 });
    if (position.status !== "open") throw badRequest("Position is already closed");

    const sl = stopLossPrice != null && Number(stopLossPrice) > 0 ? Number(stopLossPrice) : null;
    const tp = targetPrice != null && Number(targetPrice) > 0 ? Number(targetPrice) : null;
    const tsl = trailingSl != null && Number(trailingSl) > 0 ? Number(trailingSl) : null;

    await pool.query(
        `UPDATE paper_positions
         SET stop_loss_price = ?, target_price = ?, trailing_sl = ?
         WHERE id = ?`,
        [sl, tp, tsl, positionId]
    );

    const [[updated]] = await pool.query("SELECT * FROM paper_positions WHERE id = ?", [positionId]);

    // Update in-memory bracket watch map
    const key = makeContractKey(updated.symbol, updated.strike, updated.opt_right);
    if (!positionBracketsWatch.has(key)) positionBracketsWatch.set(key, new Map());

    if (sl != null || tp != null) {
        positionBracketsWatch.get(key).set(updated.id, updated);
    } else {
        positionBracketsWatch.get(key).delete(updated.id);
    }

    socketBroadcast.emitPaperEvent("paper:bracket_updated", {
        userId,
        position: updated,
        timestamp: new Date().toISOString(),
    });

    return updated;
}

/**
 * Open multiple legs in a single atomic transaction (Strategy Builder execution).
 */
async function openStrategyPositions(userId, { symbol, expiry, legs, strategyName = "Custom Strategy" }) {
    const displaySymbol = String(symbol || "").toUpperCase();
    if (!Array.isArray(legs) || legs.length === 0) {
        throw badRequest("legs array must not be empty");
    }

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
            stopLossPrice: leg.stopLossPrice || leg.stop_loss_price || null,
            targetPrice: leg.targetPrice || leg.target_price || null,
            trailingSl: leg.trailingSl || leg.trailing_sl || null,
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
                const isCryptoSym = ["BTC", "ETH", "SOL"].includes(String(displaySymbol).toUpperCase());
                const marginRate = isCryptoSym ? 0.05 : MARGIN_PERCENT_OF_NOTIONAL;
                marginBlocked = spotRef * leg.lotSize * leg.lots * marginRate;
                await paperWalletService.credit(conn, userId, premium, `Paper Order: Sell ${label} [${strategyName}] — premium`);
                await paperWalletService.debit(conn, userId, marginBlocked, `Paper Order: Sell ${label} [${strategyName}] — margin`);
            }

            const [result] = await conn.query(
                `INSERT INTO paper_positions
                 (user_id, symbol, expiry, strike, opt_right, side, lots, lot_size, entry_price, margin_blocked,
                  stop_loss_price, target_price, trailing_sl, strategy_name, entry_time, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'open')`,
                [
                    userId, displaySymbol, leg.expiry, leg.strike, leg.optRight, leg.side,
                    leg.lots, leg.lotSize, leg.ltp, marginBlocked,
                    leg.stopLossPrice, leg.targetPrice, leg.trailingSl, strategyName,
                ]
            );

            // Record executed order
            await conn.query(
                `INSERT INTO paper_orders
                 (user_id, position_id, symbol, expiry, strike, opt_right, side, order_type, status,
                  lots, lot_size, price, executed_price, stop_loss_price, target_price,
                  trailing_sl, strategy_name, placed_at, executed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'MARKET', 'EXECUTED', ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    userId, result.insertId, displaySymbol, leg.expiry, leg.strike, leg.optRight,
                    leg.side === "long" ? "buy" : "sell", leg.lots, leg.lotSize, leg.ltp, leg.ltp,
                    leg.stopLossPrice, leg.targetPrice, leg.trailingSl, strategyName,
                ]
            );

            const [[pos]] = await conn.query("SELECT * FROM paper_positions WHERE id = ?", [result.insertId]);
            createdPositions.push(pos);

            // Register in bracket watch map if SL/TP defined
            if (pos.stop_loss_price != null || pos.target_price != null) {
                const key = makeContractKey(pos.symbol, pos.strike, pos.opt_right);
                if (!positionBracketsWatch.has(key)) positionBracketsWatch.set(key, new Map());
                positionBracketsWatch.get(key).set(pos.id, pos);
            }
        }

        await conn.commit();

        socketBroadcast.emitPaperEvent("paper:strategy_executed", {
            userId,
            count: createdPositions.length,
            strategyName,
            timestamp: new Date().toISOString(),
        });

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
async function closePosition(userId, positionId, exitReason = "manual") {
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

        // Lock row to prevent double-closing race condition
        const [[lockedPos]] = await conn.query(
            "SELECT * FROM paper_positions WHERE id = ? FOR UPDATE",
            [positionId]
        );
        if (!lockedPos || lockedPos.status !== "open") {
            await conn.rollback();
            return lockedPos || position;
        }

        let realizedPnl;
        if (position.side === "long") {
            const proceeds = ltp * position.lots * position.lot_size;
            const cost = Number(position.entry_price) * position.lots * position.lot_size;
            realizedPnl = proceeds - cost;
            await paperWalletService.credit(conn, userId, proceeds, `Close ${label} (${exitReason})`);
        } else {
            const entryPremium = Number(position.entry_price) * position.lots * position.lot_size;
            const buybackCost = ltp * position.lots * position.lot_size;
            realizedPnl = entryPremium - buybackCost;
            if (position.margin_blocked != null) {
                await paperWalletService.credit(conn, userId, Number(position.margin_blocked), `Close ${label} — margin released`);
            }
            await paperWalletService.forceDebit(conn, userId, buybackCost, `Close ${label} — bought back (${exitReason})`);
        }

        await conn.query(
            `UPDATE paper_positions
             SET status = 'closed', exit_price = ?, exit_time = NOW(), realized_pnl = ?, exit_reason = ?
             WHERE id = ?`,
            [ltp, realizedPnl, String(exitReason).slice(0, 20), positionId]
        );
        await conn.commit();

        // Remove from bracket watch map
        const key = makeContractKey(position.symbol, position.strike, position.opt_right);
        if (positionBracketsWatch.has(key)) {
            positionBracketsWatch.get(key).delete(Number(positionId));
        }

        const [[updated]] = await pool.query("SELECT * FROM paper_positions WHERE id = ?", [positionId]);

        socketBroadcast.emitPaperEvent("paper:position_closed", {
            userId,
            positionId,
            exitReason,
            exitPrice: ltp,
            realizedPnl,
            timestamp: new Date().toISOString(),
        });

        return updated;
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Close all open positions for a user.
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
            const pos = await closePosition(userId, r.id, "close_all");
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

/**
 * Get Paper Trading Leaderboard ranking users by Realized P&L, Win Rate, and Total Trades.
 */
async function getLeaderboard(currentUserId = null) {
    const [rows] = await pool.query(`
        SELECT 
            u.id AS user_id,
            u.name,
            u.email,
            u.avatar_url,
            u.trading_style,
            u.role,
            COALESCE(w.balance, 500000) AS current_balance,
            COUNT(CASE WHEN p.status = 'closed' THEN 1 END) AS total_closed_trades,
            COUNT(CASE WHEN p.status = 'open' THEN 1 END) AS total_open_trades,
            COALESCE(SUM(CASE WHEN p.status = 'closed' THEN p.realized_pnl ELSE 0 END), 0) AS total_realized_pnl,
            COUNT(CASE WHEN p.status = 'closed' AND p.realized_pnl > 0 THEN 1 END) AS winning_trades,
            COUNT(CASE WHEN p.status = 'closed' AND p.realized_pnl < 0 THEN 1 END) AS losing_trades,
            MAX(CASE WHEN p.status = 'closed' THEN p.realized_pnl END) AS best_trade_pnl,
            MAX(p.entry_time) AS last_active_at
        FROM users u
        LEFT JOIN paper_wallets w ON w.user_id = u.id
        LEFT JOIN paper_positions p ON p.user_id = u.id
        GROUP BY u.id, u.name, u.email, u.avatar_url, u.trading_style, u.role, w.balance
        ORDER BY total_realized_pnl DESC, total_closed_trades DESC, u.id ASC
    `);

    let myRankInfo = null;
    const rankedList = rows.map((r, index) => {
        const closedTrades = Number(r.total_closed_trades) || 0;
        const openTrades = Number(r.total_open_trades) || 0;
        const totalTrades = closedTrades + openTrades;
        const wins = Number(r.winning_trades) || 0;
        const winRate = closedTrades > 0 ? Number(((wins / closedTrades) * 100).toFixed(1)) : 0;
        const netPnl = Number(Number(r.total_realized_pnl).toFixed(2));
        const balance = Number(Number(r.current_balance).toFixed(2));
        const rank = index + 1;

        let badge = "Novice Trader";
        if (rank === 1 && netPnl > 0) badge = "🏆 Champion Trader";
        else if (rank <= 3 && netPnl > 0) badge = "⚡ Elite Scalper";
        else if (winRate >= 70 && closedTrades >= 2) badge = "🎯 Precision Pro";
        else if (totalTrades >= 5) badge = "🛡️ Active Risk Manager";
        else if (netPnl > 0) badge = "📈 Alpha Generator";

        const item = {
            rank,
            userId: r.user_id,
            name: r.name || "Anonymous Trader",
            email: r.email,
            avatarUrl: r.avatar_url,
            tradingStyle: r.trading_style || "Options Buyer",
            role: r.role,
            balance,
            totalTrades,
            closedTrades,
            openTrades,
            winningTrades: wins,
            losingTrades: Number(r.losing_trades) || 0,
            winRate,
            netPnl,
            bestTradePnl: r.best_trade_pnl != null ? Number(Number(r.best_trade_pnl).toFixed(2)) : null,
            lastActiveAt: r.last_active_at,
            badge,
        };

        if (currentUserId && Number(currentUserId) === Number(r.user_id)) {
            myRankInfo = item;
        }

        return item;
    });

    return { leaderboard: rankedList, myRank: myRankInfo };
}

// ---------------------------------------------------------------------------
// Real-Time Asynchronous Live Tick Matching Engine
// ---------------------------------------------------------------------------
/**
 * Ultra-fast non-blocking matcher hook: evaluated on every incoming live market tick.
 * Strictly verifies live freshness and ignores historical/stale replay ticks.
 */
async function handleLiveTicks(ticks, source = "angel") {
    if (!Array.isArray(ticks) || ticks.length === 0) return;
    if (isMatchingInProgress) return;

    // Strict Live Market Data Verification
    if (source === "angel") {
        if (!marketCache.isFresh() || !marketHours.isTradingTime()) {
            return; // Discard: Market closed or feed stale
        }
    }

    if (!isWatchMapsWarmed) {
        await syncWatchMaps();
    }

    isMatchingInProgress = true;
    try {
        for (const t of ticks) {
            const sym = t.underlying || t.symbol;
            const strike = t.strike;
            const right = t.right || t.optRight;
            const ltp = Number(t.ltp);

            if (!sym || strike == null || !right || isNaN(ltp) || ltp <= 0) continue;

            const contractKey = makeContractKey(sym, strike, right);

            // 1. Evaluate Pending Orders for this Contract
            const pendingForContract = pendingOrdersWatch.get(contractKey);
            if (pendingForContract && pendingForContract.size > 0) {
                for (const [orderId, ord] of pendingForContract) {
                    let isTriggered = false;

                    if (ord.order_type === "LIMIT") {
                        if (ord.side === "buy" && ltp <= Number(ord.price)) isTriggered = true;
                        if (ord.side === "sell" && ltp >= Number(ord.price)) isTriggered = true;
                    } else if (ord.order_type === "SL" || ord.order_type === "SL-M") {
                        if (ord.side === "buy" && ltp >= Number(ord.trigger_price)) isTriggered = true;
                        if (ord.side === "sell" && ltp <= Number(ord.trigger_price)) isTriggered = true;
                    }

                    if (isTriggered) {
                        // Attempt row-lock fill execution
                        executePendingOrderFill(orderId, ltp).catch((err) => {
                            console.error(`[paperPositionService] Order ${orderId} fill failed:`, err.message);
                        });
                    }
                }
            }

            // 2. Evaluate Open Position SL / Target Brackets for this Contract
            const bracketsForContract = positionBracketsWatch.get(contractKey);
            if (bracketsForContract && bracketsForContract.size > 0) {
                for (const [positionId, pos] of bracketsForContract) {
                    let exitReason = null;

                    if (pos.side === "long") {
                        if (pos.stop_loss_price != null && ltp <= Number(pos.stop_loss_price)) {
                            exitReason = "stop_loss";
                        } else if (pos.target_price != null && ltp >= Number(pos.target_price)) {
                            exitReason = "target";
                        }
                    } else { // short
                        if (pos.stop_loss_price != null && ltp >= Number(pos.stop_loss_price)) {
                            exitReason = "stop_loss";
                        } else if (pos.target_price != null && ltp <= Number(pos.target_price)) {
                            exitReason = "target";
                        }
                    }

                    if (exitReason) {
                        // stop watching right away so the next tick can't fire a second close
                        bracketsForContract.delete(positionId);
                        closePosition(pos.user_id, positionId, exitReason).catch((err) => {
                            console.error(`[paperPositionService] Bracket trigger failed for pos ${positionId}:`, err.message);
                            // still open (e.g. no price right now) — keep watching unless it's already closed
                            if (!/already closed|not found/i.test(err.message || "")) bracketsForContract.set(positionId, pos);
                        });
                    }
                }
            }
        }
    } finally {
        isMatchingInProgress = false;
    }
}

/**
 * Executes a matched pending order inside an isolated MySQL transaction with FOR UPDATE locking.
 */
async function executePendingOrderFill(orderId, fillPrice) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [[ord]] = await conn.query(
            "SELECT * FROM paper_orders WHERE id = ? FOR UPDATE",
            [orderId]
        );

        if (!ord || ord.status !== "PENDING") {
            await conn.rollback();
            return;
        }

        const userId = ord.user_id;
        const lots = ord.lots;
        const lotSize = ord.lot_size;
        const posSide = ord.side === "buy" ? "long" : "short";
        const label = `${ord.symbol} ${ord.strike}${ord.opt_right} x${lots}`;

        let marginBlocked = null;
        if (posSide === "long") {
            const cost = fillPrice * lots * lotSize;
            await paperWalletService.debit(conn, userId, cost, `Limit Fill: Buy ${label}`);
        } else {
            const premium = fillPrice * lots * lotSize;
            marginBlocked = ord.strike * lotSize * lots * MARGIN_PERCENT_OF_NOTIONAL;
            await paperWalletService.credit(conn, userId, premium, `Limit Fill: Sell ${label} — premium`);
            await paperWalletService.debit(conn, userId, marginBlocked, `Limit Fill: Sell ${label} — margin`);
        }

        const [posRes] = await conn.query(
            `INSERT INTO paper_positions
             (user_id, symbol, expiry, strike, opt_right, side, lots, lot_size, entry_price, margin_blocked,
              stop_loss_price, target_price, trailing_sl, strategy_name, entry_time, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'open')`,
            [
                userId, ord.symbol, ord.expiry, ord.strike, ord.opt_right, posSide,
                lots, lotSize, fillPrice, marginBlocked,
                ord.stop_loss_price, ord.target_price, ord.trailing_sl, ord.strategy_name,
            ]
        );

        await conn.query(
            `UPDATE paper_orders
             SET status = 'EXECUTED', position_id = ?, executed_price = ?, executed_at = NOW()
             WHERE id = ?`,
            [posRes.insertId, fillPrice, orderId]
        );

        await conn.commit();

        // Update in-memory watch maps
        const key = makeContractKey(ord.symbol, ord.strike, ord.opt_right);
        if (pendingOrdersWatch.has(key)) {
            pendingOrdersWatch.get(key).delete(Number(orderId));
        }

        const [[filledPos]] = await pool.query("SELECT * FROM paper_positions WHERE id = ?", [posRes.insertId]);

        if (filledPos.stop_loss_price != null || filledPos.target_price != null) {
            if (!positionBracketsWatch.has(key)) positionBracketsWatch.set(key, new Map());
            positionBracketsWatch.get(key).set(filledPos.id, filledPos);
        }

        socketBroadcast.emitPaperEvent("paper:order_filled", {
            userId,
            orderId,
            positionId: posRes.insertId,
            executedPrice: fillPrice,
            symbol: ord.symbol,
            strike: ord.strike,
            optRight: ord.opt_right,
            side: ord.side,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

// Automatically subscribe to marketCache live tick stream
marketCache.addTickListener((ticks) => {
    handleLiveTicks(ticks, "angel").catch(() => {});
});

module.exports = {
    openPosition,
    openStrategyPositions,
    placeOrder,
    cancelOrder,
    listOrders,
    updatePositionBracket,
    closePosition,
    closeAllPositions,
    listOpenPositions,
    listClosedPositions,
    getLiveContractPrice,
    getLeaderboard,
    handleLiveTicks,
    syncWatchMaps,
};
