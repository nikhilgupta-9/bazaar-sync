// services/optionChainService.js
const breeze = require("../services/breeze");
const bs = require("../utils/blackScholes");
const db = require("../config/db");
const { marketHours } = require("../utils/marketUtils");

const SYMBOL_MAP = { nifty: "NIFTY", banknifty: "BANKNIFTY", finnifty: "FINNIFTY" };
const CACHE_TTL_MS = 3000;
const LIVE_CACHE_TTL_SECONDS = 60;

class OptionChainService {
    constructor() {
        this.activeWebSocketConnections = new Map();
        this.liveDataSubscriptions = new Map();
        this.inMemoryCache = new Map();
    }

    isMarketOpen() {
        return marketHours.isTradingTime();
    }

    async getOptionChain(symbol, expiry, forceLive = false) {
        const displaySymbol = SYMBOL_MAP[symbol.toLowerCase()];
        if (!displaySymbol) {
            throw new Error("symbol must be one of nifty, banknifty, finnifty");
        }

        const isOpen = this.isMarketOpen();

        if (isOpen || forceLive) {
            return await this.getLiveOptionChain(displaySymbol, expiry);
        } else {
            return await this.getHistoricalOptionChain(displaySymbol, expiry);
        }
    }

    async getLiveOptionChain(displaySymbol, expiry) {
        const cacheKey = `live_${displaySymbol}_${expiry || 'latest'}`;
        
        try {
            // Check MySQL cache first
            const cachedData = await this.getCachedData(cacheKey);
            if (cachedData) {
                const cacheAge = (Date.now() - new Date(cachedData.cached_at).getTime()) / 1000;
                if (cacheAge < LIVE_CACHE_TTL_SECONDS) {
                    console.log('[Cache] Using cached live data for', displaySymbol);
                    return JSON.parse(cachedData.payload);
                }
            }
        } catch (err) {
            console.warn('[Cache] Failed to read cache, fetching fresh data:', err.message);
        }

        // Fetch fresh data from Breeze
        console.log('[API] Fetching live data for', displaySymbol);
        const payload = await this.buildOptionChainPayload(displaySymbol, expiry);
        
        // Cache in MySQL
        try {
            await this.saveCachedData(cacheKey, payload);
            // Save to historical table
            await this.saveToHistoricalTable(displaySymbol, payload);
        } catch (err) {
            console.warn('[Cache] Failed to save cache:', err.message);
        }

        return payload;
    }

    async getHistoricalOptionChain(displaySymbol, expiry) {
        const cacheKey = `historical_${displaySymbol}_${expiry || 'latest'}`;
        
        // Check MySQL cache
        try {
            const cachedData = await this.getCachedData(cacheKey);
            if (cachedData) {
                const cacheAge = (Date.now() - new Date(cachedData.cached_at).getTime()) / 1000;
                if (cacheAge < 3600) {
                    console.log('[Cache] Using cached historical data for', displaySymbol);
                    return JSON.parse(cachedData.payload);
                }
            }
        } catch (err) {
            console.warn('[Cache] Failed to read cache:', err.message);
        }

        try {
            console.log('[DB] Fetching historical data for', displaySymbol, expiry);
            
            // Query database for historical data
            const sql = `
                SELECT 
                    strike,
                    underlying_price as spotPrice,
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                    ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                    pe_delta, pe_gamma, pe_theta, pe_vega,
                    trade_date, trade_time
                FROM option_chain_history
                WHERE symbol = ?
                    AND expiry = ?
                    AND trade_date = (
                        SELECT MAX(trade_date) 
                        FROM option_chain_history 
                        WHERE symbol = ? AND expiry = ?
                    )
                ORDER BY strike ASC
            `;

            const rows = await db.query(sql, [displaySymbol, expiry || '', displaySymbol, expiry || '']);

            // Check if rows exist and have length
            if (!rows || rows.length === 0) {
                console.log('[DB] No historical data for exact match, trying fallback...');
                return await this.getFallbackHistoricalData(displaySymbol);
            }

            console.log(`[DB] Found ${rows.length} rows for ${displaySymbol}`);
            const payload = this.formatHistoricalPayload(displaySymbol, rows);
            
            // Cache in MySQL for 1 hour
            try {
                await this.saveCachedData(cacheKey, payload, 3600);
            } catch (err) {
                console.warn('[Cache] Failed to save cache:', err.message);
            }
            
            return payload;
        } catch (err) {
            console.error('[Historical] Error:', err);
            // Fallback to latest available data
            return await this.getFallbackHistoricalData(displaySymbol);
        }
    }

    async getFallbackHistoricalData(displaySymbol) {
        try {
            console.log('[DB] Fetching latest fallback data for', displaySymbol);
            
            const fallbackSQL = `
                SELECT 
                    strike,
                    underlying_price as spotPrice,
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                    ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                    pe_delta, pe_gamma, pe_theta, pe_vega,
                    trade_date, trade_time
                FROM option_chain_history
                WHERE symbol = ?
                ORDER BY trade_date DESC, trade_time DESC
                LIMIT 100
            `;
            
            const rows = await db.query(fallbackSQL, [displaySymbol]);
            
            if (!rows || rows.length === 0) {
                // No data at all - return empty payload
                console.warn('[DB] No historical data found for', displaySymbol);
                return this.createEmptyPayload(displaySymbol);
            }
            
            console.log(`[DB] Found ${rows.length} rows in fallback for ${displaySymbol}`);
            
            // Group by strike for latest data
            const strikeMap = new Map();
            rows.forEach(row => {
                if (!strikeMap.has(row.strike)) {
                    strikeMap.set(row.strike, row);
                }
            });
            
            const mappedRows = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);
            const payload = this.formatHistoricalPayload(displaySymbol, mappedRows);
            
            // Cache for 1 hour
            const cacheKey = `historical_${displaySymbol}_fallback`;
            try {
                await this.saveCachedData(cacheKey, payload, 3600);
            } catch (err) {
                console.warn('[Cache] Failed to save fallback cache:', err.message);
            }
            
            return payload;
        } catch (err) {
            console.error('[Fallback] Error:', err);
            return this.createEmptyPayload(displaySymbol);
        }
    }

    createEmptyPayload(displaySymbol) {
        return {
            symbol: displaySymbol,
            spotPrice: 0,
            atmStrike: 0,
            maxPainStrike: 0,
            pcr: 0,
            rows: [],
            isHistorical: true,
            timestamp: new Date().toISOString(),
            tradeDate: null,
            tradeTime: null,
            error: 'No historical data available'
        };
    }

    async getCachedData(cacheKey) {
        try {
            const sql = `
                SELECT payload, cached_at 
                FROM option_chain_cache 
                WHERE cache_key = ? AND expires_at > NOW()
            `;
            
            const rows = await db.query(sql, [cacheKey]);
            
            // Check if rows is an array
            if (!Array.isArray(rows)) {
                console.warn('[Cache] Unexpected response format:', typeof rows);
                return null;
            }
            
            return rows && rows.length > 0 ? rows[0] : null;
        } catch (err) {
            console.error('[Cache] Get error:', err);
            return null;
        }
    }

    async saveCachedData(cacheKey, payload, ttlSeconds = LIVE_CACHE_TTL_SECONDS) {
        try {
            const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
            
            const sql = `
                INSERT INTO option_chain_cache (cache_key, payload, expires_at, cached_at)
                VALUES (?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE
                    payload = VALUES(payload),
                    expires_at = VALUES(expires_at),
                    cached_at = NOW()
            `;
            
            await db.query(sql, [cacheKey, JSON.stringify(payload), expiresAt]);
        } catch (err) {
            console.error('[Cache] Save error:', err);
            throw err;
        }
    }

    async saveToHistoricalTable(displaySymbol, payload) {
        try {
            // Check if we already have this data
            const checkSQL = `
                SELECT COUNT(*) as count 
                FROM option_chain_history 
                WHERE symbol = ? AND expiry = ? AND trade_date = CURDATE()
            `;
            
            const checkResult = await db.query(checkSQL, [displaySymbol, payload.selectedExpiry || '']);
            
            if (checkResult && checkResult[0] && checkResult[0].count > 0) {
                console.log('[DB] Data already saved for today, skipping');
                return;
            }

            const insertSQL = `
                INSERT INTO option_chain_history (
                    symbol, trade_date, trade_time, expiry, strike, underlying_price,
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                    ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                    pe_delta, pe_gamma, pe_theta, pe_vega
                ) VALUES ?
            `;
            
            const now = new Date();
            const tradeDate = now.toISOString().split('T')[0];
            const tradeTime = now.toTimeString().split(' ')[0];
            
            const values = payload.rows.map(row => [
                displaySymbol,
                tradeDate,
                tradeTime,
                payload.selectedExpiry || '',
                row.strike,
                payload.spotPrice || 0,
                row.ce.ltp || 0,
                row.ce.oi || 0,
                row.ce.oiChange || 0,
                row.ce.iv || null,
                row.ce.volume || 0,
                row.ce.delta || null,
                row.ce.gamma || null,
                row.ce.theta || null,
                row.ce.vega || null,
                row.pe.ltp || 0,
                row.pe.oi || 0,
                row.pe.oiChange || 0,
                row.pe.iv || null,
                row.pe.volume || 0,
                row.pe.delta || null,
                row.pe.gamma || null,
                row.pe.theta || null,
                row.pe.vega || null
            ]);
            
            if (values.length > 0) {
                await db.query(insertSQL, [values]);
                console.log(`[DB] Saved ${values.length} rows for ${displaySymbol}`);
            }
        } catch (err) {
            console.error('[Historical] Save error:', err);
            // Don't throw - this is non-critical
        }
    }

    formatHistoricalPayload(displaySymbol, rows) {
        if (!rows || rows.length === 0) {
            return this.createEmptyPayload(displaySymbol);
        }

        const strikes = rows.map(r => r.strike).filter(s => s != null);
        const spotPrice = rows[0]?.spotPrice || 0;
        const atmStrike = strikes.length > 0 ? this.computeAtmStrike(strikes, spotPrice) : 0;
        
        const mappedRows = rows.map(r => ({
            strike: r.strike,
            iv: null,
            ce: {
                ltp: r.ce_ltp ?? 0,
                oi: r.ce_oi ?? 0,
                oiChange: r.ce_oi_change ?? 0,
                volume: r.ce_volume ?? 0,
                iv: r.ce_iv ?? null,
                delta: r.ce_delta ?? null,
                gamma: r.ce_gamma ?? null,
                theta: r.ce_theta ?? null,
                vega: r.ce_vega ?? null,
                buildup: null,
                changePercent: null
            },
            pe: {
                ltp: r.pe_ltp ?? 0,
                oi: r.pe_oi ?? 0,
                oiChange: r.pe_oi_change ?? 0,
                volume: r.pe_volume ?? 0,
                iv: r.pe_iv ?? null,
                delta: r.pe_delta ?? null,
                gamma: r.pe_gamma ?? null,
                theta: r.pe_theta ?? null,
                vega: r.pe_vega ?? null,
                buildup: null,
                changePercent: null
            }
        }));

        const maxPainStrike = this.computeMaxPain(mappedRows.map(r => ({ 
            strike: r.strike, 
            ceOi: r.ce.oi, 
            peOi: r.pe.oi 
        })));
        const pcr = this.computePcr(mappedRows.map(r => ({ 
            ceOi: r.ce.oi, 
            peOi: r.pe.oi 
        })));

        return {
            symbol: displaySymbol,
            spotPrice,
            atmStrike,
            maxPainStrike,
            pcr,
            rows: mappedRows,
            isHistorical: true,
            timestamp: new Date().toISOString(),
            tradeDate: rows[0]?.trade_date || null,
            tradeTime: rows[0]?.trade_time || null
        };
    }

    // ... rest of your existing methods (buildOptionChainPayload, classifyBuildup, computeAtmStrike, computeMaxPain, computePcr)
    // These should remain unchanged from your original code
    
    async buildOptionChainPayload(displaySymbol, requestedExpiry) {
        // Your existing implementation here
        // Make sure this method is complete
        const stockCode = breeze.SYMBOL_CODES[displaySymbol];
        await breeze.connect();
        const { spotPrice, expiries } = await breeze.discoverChain({ stockCode });
        
        if (!expiries || !expiries.length) {
            throw new Error("No expiries returned by Breeze");
        }

        const selectedExpiry = expiries.includes(requestedExpiry) ? requestedExpiry : expiries[0];
        const apiExpiry = breeze.expiryDisplayToApi(selectedExpiry);

        const rawRows = await breeze.getFullOptionChain({ stockCode, expiryDate: apiExpiry });
        const t = bs.yearsToExpiry(breeze.expiryApiToSql(apiExpiry));

        const rows = rawRows
            .filter((r) => r.strike)
            .sort((a, b) => a.strike - b.strike)
            .map((r) => {
                const spot = r.underlyingPrice || spotPrice;
                const ceIv = bs.impliedVolatility({ marketPrice: r.ceLtp, spot, strike: r.strike, t, right: "call" });
                const peIv = bs.impliedVolatility({ marketPrice: r.peLtp, spot, strike: r.strike, t, right: "put" });
                const ceGreeks = ceIv ? bs.greeks({ spot, strike: r.strike, t, vol: ceIv, right: "call" }) : null;
                const peGreeks = peIv ? bs.greeks({ spot, strike: r.strike, t, vol: peIv, right: "put" }) : null;

                return {
                    strike: r.strike,
                    iv: ceIv && peIv ? Number((((ceIv + peIv) / 2) * 100).toFixed(1)) : null,
                    ce: {
                        ltp: r.ceLtp ?? null,
                        changePercent: r.ceLtpChangePercent ?? null,
                        oi: r.ceOi ?? null,
                        oiChange: r.ceOiChange ?? null,
                        volume: r.ceVolume ?? null,
                        iv: ceIv ? Number((ceIv * 100).toFixed(1)) : null,
                        delta: ceGreeks ? Number(ceGreeks.delta.toFixed(3)) : null,
                        gamma: ceGreeks ? Number(ceGreeks.gamma.toFixed(6)) : null,
                        theta: ceGreeks ? Number(ceGreeks.theta.toFixed(3)) : null,
                        vega: ceGreeks ? Number(ceGreeks.vega.toFixed(3)) : null,
                        buildup: this.classifyBuildup(r.ceLtpChangePercent, r.ceOiChange),
                    },
                    pe: {
                        ltp: r.peLtp ?? null,
                        changePercent: r.peLtpChangePercent ?? null,
                        oi: r.peOi ?? null,
                        oiChange: r.peOiChange ?? null,
                        volume: r.peVolume ?? null,
                        iv: peIv ? Number((peIv * 100).toFixed(1)) : null,
                        delta: peGreeks ? Number(peGreeks.delta.toFixed(3)) : null,
                        gamma: peGreeks ? Number(peGreeks.gamma.toFixed(6)) : null,
                        theta: peGreeks ? Number(peGreeks.theta.toFixed(3)) : null,
                        vega: peGreeks ? Number(peGreeks.vega.toFixed(3)) : null,
                        buildup: this.classifyBuildup(r.peLtpChangePercent, r.peOiChange),
                    },
                };
            });

        const atmStrike = this.computeAtmStrike(rows.map((r) => r.strike), spotPrice);
        const maxPainStrike = this.computeMaxPain(rows.map((r) => ({ strike: r.strike, ceOi: r.ce.oi, peOi: r.pe.oi })));
        const pcr = this.computePcr(rows.map((r) => ({ ceOi: r.ce.oi, peOi: r.pe.oi })));

        return { 
            symbol: displaySymbol, 
            spotPrice, 
            atmStrike, 
            maxPainStrike, 
            pcr, 
            expiries, 
            selectedExpiry, 
            rows,
            isHistorical: false,
            timestamp: new Date().toISOString()
        };
    }

    classifyBuildup(priceChangePercent, oiChange) {
        if (priceChangePercent == null || oiChange == null) return null;
        const priceUp = priceChangePercent > 0;
        const oiUp = oiChange > 0;
        if (priceUp && oiUp) return "L";
        if (!priceUp && oiUp) return "S";
        if (priceUp && !oiUp) return "SC";
        return "LU";
    }

    computeAtmStrike(strikes, spot) {
        if (!strikes || strikes.length === 0) return 0;
        return strikes.reduce((best, s) => 
            (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), 
            strikes[0]
        );
    }

    computeMaxPain(rows) {
        if (!rows || rows.length === 0) return 0;
        let bestStrike = rows[0]?.strike ?? 0;
        let bestPayout = Infinity;
        for (const candidate of rows) {
            const S = candidate.strike;
            let payout = 0;
            for (const r of rows) {
                payout += (r.ceOi || 0) * Math.max(0, S - r.strike);
                payout += (r.peOi || 0) * Math.max(0, r.strike - S);
            }
            if (payout < bestPayout) {
                bestPayout = payout;
                bestStrike = S;
            }
        }
        return bestStrike;
    }

    computePcr(rows) {
        if (!rows || rows.length === 0) return 0;
        const totalCe = rows.reduce((s, r) => s + (r.ceOi || 0), 0);
        const totalPe = rows.reduce((s, r) => s + (r.peOi || 0), 0);
        return totalCe ? Number((totalPe / totalCe).toFixed(2)) : 0;
    }
}

module.exports = new OptionChainService();