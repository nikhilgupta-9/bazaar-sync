const { runBacktest } = require("../services/backtestEngine");
const { pool } = require("../config/db");

const SYMBOL_MAP = { nifty: "NIFTY", banknifty: "BANKNIFTY", finnifty: "FINNIFTY" };

async function postBacktest(req, res) {
    try {
        const {
            symbol, expiryType, startDate, endDate, legs,
            entryTime = "09:20:00", dte = null, stopLossPct = null, targetPct = null,
        } = req.body;

        const displaySymbol = SYMBOL_MAP[symbol?.toLowerCase()];
        if (!displaySymbol) {
            return res.status(400).json({ error: "symbol must be one of nifty, banknifty, finnifty" });
        }
        if (!["weekly", "monthly"].includes(expiryType)) {
            return res.status(400).json({ error: "expiryType must be 'weekly' or 'monthly'" });
        }
        if (!startDate || !endDate) {
            return res.status(400).json({ error: "startDate and endDate are required (YYYY-MM-DD)" });
        }
        if (!Array.isArray(legs) || !legs.length || legs.length > 6) {
            return res.status(400).json({ error: "legs must be an array of 1-6 legs" });
        }

        const result = await runBacktest({
            symbol: displaySymbol,
            expiryType,
            startDate, // 'YYYY-MM-DD' string, passed straight through — see backtestEngine.js
            endDate,
            legs,
            entryTime,
            dte,
            stopLossPct,
            targetPct,
        });

        res.json(result);
    } catch (err) {
        console.error("[backtest]", err);
        res.status(500).json({ error: err.message });
    }
}

// Persists a report the client already fetched from POST /api/backtest —
// avoids re-running the (potentially slow) simulation just to save it.
// These are the user's own just-computed numbers, not attacker-controlled
// data being trusted for anything security-sensitive.
async function saveBacktest(req, res) {
    const conn = await pool.getConnection();
    try {
        const { strategyId = null, symbol, expiryType, startDate, endDate, params, result } = req.body;
        const displaySymbol = SYMBOL_MAP[symbol?.toLowerCase()];
        if (!displaySymbol || !["weekly", "monthly"].includes(expiryType) || !startDate || !endDate || !result) {
            return res.status(400).json({ error: "symbol, expiryType, startDate, endDate and result are required" });
        }

        await conn.beginTransaction();
        const [insertResult] = await conn.query(
            `INSERT INTO backtest_results
             (user_id, strategy_id, underlying, expiry_type, start_date, end_date, params, net_pnl, win_rate, total_trades, max_drawdown, sharpe_ratio)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.sub, strategyId, displaySymbol, expiryType, startDate, endDate,
                JSON.stringify(params ?? {}), result.netPnl, result.winRate, result.totalTrades,
                result.maxDrawdown, result.sharpeRatio,
            ]
        );
        const backtestResultId = insertResult.insertId;

        if (Array.isArray(result.trades) && result.trades.length) {
            // backtest_trades.leg_index was designed for a per-leg trade log;
            // our engine tracks combined multi-leg P&L per trading day, not a
            // separable exit price per leg, so we reuse leg_index as the
            // trade's sequence number instead (entry_price = combined entry
            // cost, exit_price left null). Revisit if per-leg breakdown is needed.
            const values = result.trades.map((t, i) => [
                backtestResultId, i, `${t.entryDate} ${t.entryTime}`, `${t.entryDate} ${t.exitTime}`,
                t.entryCost ?? null, null, 1, t.pnl, t.exitReason,
            ]);
            await conn.query(
                `INSERT INTO backtest_trades
                 (backtest_result_id, leg_index, entry_time, exit_time, entry_price, exit_price, quantity, pnl, exit_reason)
                 VALUES ?`,
                [values]
            );
        }

        await conn.commit();
        res.status(201).json({ id: backtestResultId });
    } catch (err) {
        await conn.rollback();
        console.error("[backtest:save]", err);
        res.status(500).json({ error: "failed to save backtest result" });
    } finally {
        conn.release();
    }
}

async function listBacktests(req, res) {
    try {
        const [rows] = await pool.query(
            "SELECT * FROM backtest_results WHERE user_id = ? ORDER BY created_at DESC",
            [req.user.sub]
        );
        res.json({ results: rows });
    } catch (err) {
        console.error("[backtest:list]", err);
        res.status(500).json({ error: "failed to load backtest results" });
    }
}

module.exports = { postBacktest, saveBacktest, listBacktests };
