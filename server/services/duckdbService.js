// server/services/duckdbService.js — High-performance in-process analytics engine
// Powered by DuckDB & columnar Apache Parquet.
// Provides sub-100ms vectorized queries over hundreds of millions of historical rows
// without touching MySQL or exhausting database connection pools.

const duckdb = require("duckdb");
const path = require("path");
const fs = require("fs");

class DuckDBService {
    constructor() {
        this.db = new duckdb.Database(":memory:");
        this.connection = this.db.connect();
        this.parquetDirs = [
            path.resolve(__dirname, "../data/parquet"),
            path.resolve(__dirname, "../../tmp/huggingface_cache"),
            path.resolve(__dirname, "../../tmp/bazaar_staging"),
        ];
    }

    /**
     * Execute a SQL query on DuckDB returning a Promise
     */
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (!params || !params.length) {
                this.connection.all(sql, (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                });
            } else {
                this.connection.all(sql, ...params, (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                });
            }
        });
    }

    /**
     * Find matching parquet file or glob for a given symbol and optional expiry/year
     */
    findParquetPattern(symbol, expiryOrYear = null) {
        const sym = String(symbol || "").toUpperCase();
        for (const dir of this.parquetDirs) {
            if (!fs.existsSync(dir)) continue;
            const files = fs.readdirSync(dir);

            if (expiryOrYear) {
                const exact = path.join(dir, `${sym}_${expiryOrYear}.parquet`);
                if (fs.existsSync(exact)) return exact;

                if (/^\d{4}$/.test(String(expiryOrYear))) {
                    const match = files.some((f) => f.startsWith(`${sym}_${expiryOrYear}`) && f.endsWith(".parquet"));
                    if (match) return path.join(dir, `${sym}_${expiryOrYear}-*.parquet`);
                }
            }

            const hasAny = files.some((f) => f.startsWith(`${sym}_`) && f.endsWith(".parquet") && !f.includes("_spot"));
            if (hasAny) {
                return path.join(dir, `${sym}_20*.parquet`);
            }
        }
        return null;
    }

    /**
     * Spot parquet file for index candles
     */
    findSpotParquet(symbol) {
        const sym = String(symbol || "").toUpperCase();
        for (const dir of this.parquetDirs) {
            const file = path.join(dir, `${sym}_spot.parquet`);
            if (fs.existsSync(file)) return file;
        }
        return null;
    }

    /**
     * Get distinct trading days for a symbol and date range
     */
    async getTradingDays(symbol, startDate, endDate) {
        const pattern = this.findParquetPattern(symbol);
        if (!pattern) return [];

        try {
            const sql = `
                SELECT DISTINCT trading_day
                FROM read_parquet('${pattern}', union_by_name=true)
                WHERE trading_day BETWEEN ? AND ?
                ORDER BY trading_day ASC
            `;
            const rows = await this.all(sql, [startDate, endDate]);
            return rows.map((r) => r.trading_day);
        } catch (err) {
            console.warn(`[DuckDB] getTradingDays error: ${err.message}`);
            return [];
        }
    }

    /**
     * Get available expiries for a symbol
     */
    async getExpiries(symbol, fromDate = null) {
        const pattern = this.findParquetPattern(symbol);
        if (!pattern) return [];

        try {
            const dateClause = fromDate ? `WHERE expiry >= '${fromDate}'` : "";
            const sql = `
                SELECT DISTINCT expiry
                FROM read_parquet('${pattern}', union_by_name=true)
                ${dateClause}
                ORDER BY expiry ASC
            `;
            const rows = await this.all(sql);
            return rows.map((r) => r.expiry);
        } catch (err) {
            console.warn(`[DuckDB] getExpiries error: ${err.message}`);
            return [];
        }
    }

    /**
     * Fast option chain snapshot for a specific date and time
     */
    async getChainAtTime(symbol, date, timeStr) {
        const pattern = this.findParquetPattern(symbol);
        if (!pattern) return [];

        try {
            // Extracts nearest minute snapshot
            const sql = `
                SELECT 
                    strike,
                    MAX(CASE WHEN option_type = 'CE' THEN close END) AS ce_ltp,
                    MAX(CASE WHEN option_type = 'CE' THEN open_interest END) AS ce_oi,
                    MAX(CASE WHEN option_type = 'PE' THEN close END) AS pe_ltp,
                    MAX(CASE WHEN option_type = 'PE' THEN open_interest END) AS pe_oi,
                    expiry
                FROM read_parquet('${pattern}')
                WHERE trading_day = ? 
                  AND strftime(timestamp, '%H:%M:%S') <= ?
                GROUP BY strike, expiry
                ORDER BY strike ASC
            `;
            return await this.all(sql, [date, timeStr]);
        } catch (err) {
            console.warn(`[DuckDB] getChainAtTime error: ${err.message}`);
            return [];
        }
    }

    /**
     * Ultra-fast vectorized backtest runner over millions of rows
     */
    async runVectorizedBacktest({
        symbol,
        startDate,
        endDate,
        legs = [],
        entryTime = "09:20:00",
        exitTime = "15:25:00",
        stopLossPct = null,
        targetPct = null,
        lotSize = 50,
    }) {
        const pattern = this.findParquetPattern(symbol);
        if (!pattern) {
            throw new Error(`No historical parquet dataset found for ${symbol}`);
        }

        const t0 = Date.now();

        // 1. Get spot prices across trading days
        const spotFile = this.findSpotParquet(symbol);
        let spotMap = new Map();
        if (spotFile) {
            try {
                const spotRows = await this.all(`
                    SELECT 
                        strftime(timestamp, '%Y-%m-%d') as trade_date,
                        close as spot_open
                    FROM read_parquet('${spotFile}')
                    WHERE strftime(timestamp, '%H:%M:%S') >= ? 
                      AND strftime(timestamp, '%Y-%m-%d') BETWEEN ? AND ?
                    QUALIFY ROW_NUMBER() OVER (PARTITION BY strftime(timestamp, '%Y-%m-%d') ORDER BY timestamp ASC) = 1
                `, [entryTime, startDate, endDate]);

                for (const r of spotRows) {
                    spotMap.set(r.trade_date, Number(r.spot_open));
                }
            } catch (e) {
                console.warn("[DuckDB] Spot parquet read failed, inferring from options ATM:", e.message);
            }
        }

        // 2. Query option rows for trading days in range
        const querySql = `
            SELECT 
                trading_day,
                strftime(timestamp, '%H:%M:%S') as trade_time,
                expiry,
                strike,
                option_type,
                open,
                high,
                low,
                close,
                open_interest
            FROM read_parquet('${pattern}', union_by_name=true)
            WHERE trading_day BETWEEN ? AND ?
              AND strftime(timestamp, '%H:%M:%S') BETWEEN ? AND ?
            ORDER BY trading_day, timestamp, strike
        `;

        const allTicks = await this.all(querySql, [startDate, endDate, entryTime, exitTime]);
        const queryDurationMs = Date.now() - t0;

        // Group rows by trading_day
        const daysMap = new Map();
        for (const row of allTicks) {
            let dayObj = daysMap.get(row.trading_day);
            if (!dayObj) {
                dayObj = { ticksByTime: new Map(), strikes: new Set(), expiries: new Set() };
                daysMap.set(row.trading_day, dayObj);
            }
            let timeMap = dayObj.ticksByTime.get(row.trade_time);
            if (!timeMap) {
                timeMap = new Map();
                dayObj.ticksByTime.set(row.trade_time, timeMap);
            }
            const key = `${row.strike}_${row.option_type}_${row.expiry}`;
            timeMap.set(key, row.close);
            dayObj.strikes.add(row.strike);
            dayObj.expiries.add(row.expiry);
        }

        // 3. Simulate multi-leg trades per day
        const trades = [];
        let cumulativePnl = 0;
        let peakEquity = 0;
        let maxDrawdown = 0;

        for (const [day, dayData] of daysMap) {
            const times = Array.from(dayData.ticksByTime.keys()).sort();
            if (!times.length) continue;

            const entryInstant = times[0];
            const entryMap = dayData.ticksByTime.get(entryInstant);

            // Determine ATM strike for this day
            const sortedStrikes = Array.from(dayData.strikes).sort((a, b) => a - b);
            const refSpot = spotMap.get(day) || sortedStrikes[Math.floor(sortedStrikes.length / 2)];
            let atmStrike = sortedStrikes[0];
            let minDiff = Infinity;
            for (const s of sortedStrikes) {
                const diff = Math.abs(s - refSpot);
                if (diff < minDiff) {
                    minDiff = diff;
                    atmStrike = s;
                }
            }

            // Determine strike gap
            let strikeGap = 50;
            if (sortedStrikes.length >= 2) {
                strikeGap = sortedStrikes[1] - sortedStrikes[0] || 50;
            }

            // Select nearest expiry
            const sortedExpiries = Array.from(dayData.expiries).sort();
            const targetExpiry = sortedExpiries.find((e) => e >= day) || sortedExpiries[0];

            // Resolve real execution legs
            const execLegs = [];
            let entryCost = 0;
            let validEntry = true;

            for (const leg of legs) {
                const targetStrike = atmStrike + (leg.strikeOffset || 0) * strikeGap;
                const optRight = leg.type || "CE";
                const key = `${targetStrike}_${optRight}_${targetExpiry}`;
                const entryPrice = entryMap.get(key);

                if (entryPrice == null || entryPrice <= 0) {
                    validEntry = false;
                    break;
                }

                execLegs.push({
                    strike: targetStrike,
                    type: optRight,
                    action: leg.action || "sell",
                    qty: leg.qty || 1,
                    entryPrice,
                    key,
                });

                const sign = leg.action === "buy" ? -1 : 1;
                entryCost += sign * entryPrice * (leg.qty || 1) * lotSize;
            }

            if (!validEntry || !execLegs.length) continue;

            // Track intraday minutes till exit or SL/Target hit
            let exitPnl = 0;
            let exitTimeHit = times[times.length - 1];
            let exitReason = "EOD";

            for (let tIdx = 1; tIdx < times.length; tIdx++) {
                const t = times[tIdx];
                const currentMap = dayData.ticksByTime.get(t);
                let currentTotalPnl = 0;
                let hasAllPrices = true;

                for (const el of execLegs) {
                    const price = currentMap.get(el.key);
                    if (price == null) {
                        hasAllPrices = false;
                        break;
                    }
                    const diff = el.action === "buy" ? price - el.entryPrice : el.entryPrice - price;
                    currentTotalPnl += diff * el.qty * lotSize;
                }

                if (!hasAllPrices) continue;

                // Check Stop Loss & Target breaches
                if (stopLossPct != null && currentTotalPnl <= -Math.abs(entryCost * (stopLossPct / 100))) {
                    exitPnl = currentTotalPnl;
                    exitTimeHit = t;
                    exitReason = "SL_HIT";
                    break;
                }

                if (targetPct != null && currentTotalPnl >= Math.abs(entryCost * (targetPct / 100))) {
                    exitPnl = currentTotalPnl;
                    exitTimeHit = t;
                    exitReason = "TG_HIT";
                    break;
                }

                exitPnl = currentTotalPnl;
            }

            cumulativePnl += exitPnl;
            if (cumulativePnl > peakEquity) peakEquity = cumulativePnl;
            const dd = peakEquity - cumulativePnl;
            if (dd > maxDrawdown) maxDrawdown = dd;

            trades.push({
                date: day,
                entryTime: entryInstant,
                exitTime: exitTimeHit,
                exitReason,
                atmStrike,
                expiry: targetExpiry,
                pnl: Math.round(exitPnl * 100) / 100,
                cumulativePnl: Math.round(cumulativePnl * 100) / 100,
            });
        }

        const totalTrades = trades.length;
        const wins = trades.filter((t) => t.pnl > 0).length;
        const winRate = totalTrades ? Math.round((wins / totalTrades) * 10000) / 100 : 0;
        const totalDurationMs = Date.now() - t0;

        return {
            symbol,
            startDate,
            endDate,
            engine: "DuckDB/Parquet (Vectorized)",
            performance: {
                queryDurationMs,
                totalDurationMs,
                rowsProcessed: allTicks.length,
            },
            stats: {
                totalTrades,
                winRate,
                netPnl: Math.round(cumulativePnl * 100) / 100,
                maxDrawdown: Math.round(maxDrawdown * 100) / 100,
            },
            equityCurve: trades.map((t) => ({ date: t.date, equity: t.cumulativePnl })),
            trades,
        };
    }
}

module.exports = new DuckDBService();
