// services/optionChainService.js
//
// Decides live-vs-historical for GET /api/option-chain/:symbol.
//
//   LIVE       — read from services/marketCache.js (the in-memory Map fed by
//                the market worker's IPC summaries). No broker call happens
//                here; Express never talks to Angel One directly.
//   HISTORICAL — read from MySQL (option_chain_history), exactly as before.
//                This is a legitimate mode (market closed / worker down),
//                not an error path.
//
// The old MySQL `option_chain_cache` table this service used to read/write
// was never in schema.sql (it only ever existed if someone created it by
// hand). It's gone: live data now comes from the in-memory cache, and the
// historical payload gets a small in-process TTL cache instead.

const bs = require("../utils/blackScholes");
const db = require("../config/db");
const marketCache = require("./marketCache");
const { marketHours } = require("../utils/marketUtils");

const SYMBOL_MAP = { nifty: "NIFTY", banknifty: "BANKNIFTY", finnifty: "FINNIFTY" };
const HISTORICAL_CACHE_TTL_MS = 60 * 1000;

// Plain-string date helpers (CLAUDE.md Gotcha #12 — no local-timezone Date math)
function utcMidnight(dateStr) {
    const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
}
function todayIstStr() {
    const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function daysToExpiry(expirySql, fromDateStr) {
    if (!expirySql || !fromDateStr) return null;
    return Math.max(0, Math.round((utcMidnight(expirySql) - utcMidnight(fromDateStr)) / 86400000));
}

class OptionChainService {
    constructor() {
        this.historicalCache = new Map(); // key -> { payload, cachedAt }
    }

    isMarketOpen() {
        return marketHours.isTradingTime();
    }

    async getOptionChain(symbol, expiry, forceLive = false) {
        const displaySymbol = SYMBOL_MAP[symbol.toLowerCase()];
        if (!displaySymbol) {
            throw new Error("symbol must be one of nifty, banknifty, finnifty");
        }

        if (this.isMarketOpen() || forceLive) {
            const live = this.getLiveOptionChain(displaySymbol, expiry);
            if (live) return live;
            // Worker down / cache stale / requested expiry not subscribed —
            // fall through to historical rather than failing.
        }
        return this.getHistoricalOptionChain(displaySymbol, expiry);
    }

    /**
     * Build the option-chain payload from the in-memory live cache.
     * Synchronous — no DB, no broker. Returns null when the cache can't
     * serve this request (stale, empty, or a different expiry was asked for).
     */
    getLiveOptionChain(displaySymbol, requestedExpiry) {
        if (!marketCache.isFresh()) return null;
        const chain = marketCache.getChain(displaySymbol);
        if (!chain || !chain.rows.length || !chain.spot) return null;
        // The worker subscribes only the nearest expiry; other expiries must
        // come from historical data.
        if (requestedExpiry && chain.expiry && requestedExpiry !== chain.expiry) return null;

        const spotPrice = chain.spot;
        const t = chain.expiry ? bs.yearsToExpiry(chain.expiry) : null;

        const rows = chain.rows.map((r) => {
            const ceIv =
                t && r.ce && r.ce.ltp
                    ? bs.impliedVolatility({ marketPrice: r.ce.ltp, spot: spotPrice, strike: r.strike, t, right: "call" })
                    : null;
            const peIv =
                t && r.pe && r.pe.ltp
                    ? bs.impliedVolatility({ marketPrice: r.pe.ltp, spot: spotPrice, strike: r.strike, t, right: "put" })
                    : null;
            const ceGreeks = ceIv ? bs.greeks({ spot: spotPrice, strike: r.strike, t, vol: ceIv, right: "call" }) : null;
            const peGreeks = peIv ? bs.greeks({ spot: spotPrice, strike: r.strike, t, vol: peIv, right: "put" }) : null;

            return {
                strike: r.strike,
                iv: ceIv && peIv ? Number((((ceIv + peIv) / 2) * 100).toFixed(1)) : null,
                ce: {
                    ltp: r.ce ? r.ce.ltp : null,
                    changePercent: null, // live feed carries no prev-close per contract
                    oi: r.ce ? r.ce.oi : null,
                    oiChange: null,
                    oiChangePercent: r.ce ? r.ce.oiChangePercent ?? null : null,
                    volume: r.ce ? r.ce.volume : null,
                    iv: ceIv ? Number((ceIv * 100).toFixed(1)) : null,
                    delta: ceGreeks ? Number(ceGreeks.delta.toFixed(3)) : null,
                    gamma: ceGreeks ? Number(ceGreeks.gamma.toFixed(6)) : null,
                    theta: ceGreeks ? Number(ceGreeks.theta.toFixed(3)) : null,
                    vega: ceGreeks ? Number(ceGreeks.vega.toFixed(3)) : null,
                    buildup: null,
                },
                pe: {
                    ltp: r.pe ? r.pe.ltp : null,
                    changePercent: null,
                    oi: r.pe ? r.pe.oi : null,
                    oiChange: null,
                    oiChangePercent: r.pe ? r.pe.oiChangePercent ?? null : null,
                    volume: r.pe ? r.pe.volume : null,
                    iv: peIv ? Number((peIv * 100).toFixed(1)) : null,
                    delta: peGreeks ? Number(peGreeks.delta.toFixed(3)) : null,
                    gamma: peGreeks ? Number(peGreeks.gamma.toFixed(6)) : null,
                    theta: peGreeks ? Number(peGreeks.theta.toFixed(3)) : null,
                    vega: peGreeks ? Number(peGreeks.vega.toFixed(3)) : null,
                    buildup: null,
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
            expiries: chain.expiry ? [chain.expiry] : [],
            selectedExpiry: chain.expiry,
            daysToExpiry: daysToExpiry(chain.expiry, todayIstStr()),
            rows,
            isHistorical: false,
            timestamp: new Date().toISOString(),
        };
    }

    /**
     * Historical chain from MySQL. Anchors on the latest snapshot that has a
     * real underlying_price (it's backfilled from ohlcv_data and can trail
     * the newest option rows by one tick — see services/cron.js), discovers
     * the available expiries at that snapshot, and scopes the chain to that
     * exact trade_date+trade_time (otherwise the query returns every stored
     * row ever and the O(n^2) max-pain loop hangs the event loop).
     */
    async getHistoricalOptionChain(displaySymbol, expiry) {
        const cacheKey = `${displaySymbol}_${expiry || "latest"}`;
        const cached = this.historicalCache.get(cacheKey);
        if (cached && Date.now() - cached.cachedAt < HISTORICAL_CACHE_TTL_MS) {
            return cached.payload;
        }

        try {
            const latestRows = await db.query(
                `SELECT trade_date, trade_time, underlying_price
                 FROM option_chain_history
                 WHERE symbol = ? AND underlying_price IS NOT NULL
                 ORDER BY trade_date DESC, trade_time DESC
                 LIMIT 1`,
                [displaySymbol]
            );
            if (!latestRows || latestRows.length === 0) {
                return await this.getFallbackHistoricalData(displaySymbol);
            }
            const { trade_date, trade_time, underlying_price } = latestRows[0];

            const expiryRows = await db.query(
                `SELECT DISTINCT expiry FROM option_chain_history
                 WHERE symbol = ? AND trade_date = ?
                 ORDER BY expiry ASC`,
                [displaySymbol, trade_date]
            );
            const expiries = (expiryRows || []).map((r) => r.expiry);
            const selectedExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0] || null;
            if (!selectedExpiry) {
                return await this.getFallbackHistoricalData(displaySymbol);
            }

            let rows = await db.query(
                `SELECT
                    strike,
                    underlying_price as spotPrice,
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                    ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                    pe_delta, pe_gamma, pe_theta, pe_vega,
                    trade_date, trade_time
                 FROM option_chain_history
                 WHERE symbol = ? AND expiry = ? AND trade_date = ? AND trade_time = ?
                 ORDER BY strike ASC`,
                [displaySymbol, selectedExpiry, trade_date, trade_time]
            );
            if (!rows || rows.length === 0) {
                rows = await db.query(
                    `SELECT
                        strike,
                        underlying_price as spotPrice,
                        ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                        ce_delta, ce_gamma, ce_theta, ce_vega,
                        pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                        pe_delta, pe_gamma, pe_theta, pe_vega,
                        trade_date, trade_time
                     FROM option_chain_history
                     WHERE symbol = ? AND expiry = ? AND trade_date = ?
                     ORDER BY strike ASC
                     LIMIT 200`,
                    [displaySymbol, selectedExpiry, trade_date]
                );
            }
            if (!rows || rows.length === 0) {
                return await this.getFallbackHistoricalData(displaySymbol);
            }

            const payload = this.formatHistoricalPayload(displaySymbol, rows, {
                expiries,
                selectedExpiry,
                spotOverride: Number(underlying_price) || null,
            });
            this.historicalCache.set(cacheKey, { payload, cachedAt: Date.now() });
            return payload;
        } catch (err) {
            console.error("[Historical] Error:", err);
            return await this.getFallbackHistoricalData(displaySymbol);
        }
    }

    async getFallbackHistoricalData(displaySymbol) {
        try {
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
                return this.createEmptyPayload(displaySymbol);
            }

            // Latest row per strike
            const strikeMap = new Map();
            rows.forEach((row) => {
                if (!strikeMap.has(row.strike)) strikeMap.set(row.strike, row);
            });

            const mappedRows = [...strikeMap.values()].sort((a, b) => a.strike - b.strike);
            const payload = this.formatHistoricalPayload(displaySymbol, mappedRows);
            this.historicalCache.set(`${displaySymbol}_fallback`, { payload, cachedAt: Date.now() });
            return payload;
        } catch (err) {
            console.error("[Fallback] Error:", err);
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
            error: "No historical data available",
        };
    }

    formatHistoricalPayload(displaySymbol, rows, { expiries = [], selectedExpiry = null, spotOverride = null } = {}) {
        if (!rows || rows.length === 0) {
            return this.createEmptyPayload(displaySymbol);
        }

        const strikes = rows.map((r) => r.strike).filter((s) => s != null);
        const spotPrice = spotOverride || Number(rows[0]?.spotPrice) || 0;
        const atmStrike = strikes.length > 0 ? this.computeAtmStrike(strikes, spotPrice) : 0;

        const mappedRows = rows.map((r) => ({
            strike: r.strike,
            iv: r.ce_iv ?? r.pe_iv ?? null,
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
                changePercent: null,
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
                changePercent: null,
            },
        }));

        const maxPainStrike = this.computeMaxPain(
            mappedRows.map((r) => ({ strike: r.strike, ceOi: r.ce.oi, peOi: r.pe.oi }))
        );
        const pcr = this.computePcr(mappedRows.map((r) => ({ ceOi: r.ce.oi, peOi: r.pe.oi })));

        return {
            symbol: displaySymbol,
            spotPrice,
            atmStrike,
            maxPainStrike,
            pcr,
            expiries,
            selectedExpiry,
            daysToExpiry: daysToExpiry(selectedExpiry, rows[0]?.trade_date || todayIstStr()),
            rows: mappedRows,
            isHistorical: true,
            timestamp: new Date().toISOString(),
            tradeDate: rows[0]?.trade_date || null,
            tradeTime: rows[0]?.trade_time || null,
        };
    }

    computeAtmStrike(strikes, spot) {
        if (!strikes || strikes.length === 0) return 0;
        return strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]);
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
