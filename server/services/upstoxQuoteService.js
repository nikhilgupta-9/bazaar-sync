// services/upstoxQuoteService.js — Real-time Upstox Market Quote service with DB fallback and TTL cache.
const https = require("https");
const db = require("../config/db");
const upstoxInstruments = require("./upstoxInstrumentMaster");

const BASE_URL = process.env.UPSTOX_API_BASE_URL || "https://api.upstox.com/v2";
const CACHE_TTL_MS = 3000; // 3-second cache for active live quotes

const quoteCache = new Map(); // instrumentKey -> { data, timestamp }

// 7 Major Index instrument keys in Upstox
const MAJOR_INDEX_KEYS = {
    NIFTY: "NSE_INDEX|Nifty 50",
    BANKNIFTY: "NSE_INDEX|Nifty Bank",
    FINNIFTY: "NSE_INDEX|Nifty Fin Service",
    MIDCPNIFTY: "NSE_INDEX|NIFTY MID SELECT",
    NIFTYNXT50: "NSE_INDEX|Nifty Next 50",
    SENSEX: "BSE_INDEX|SENSEX",
    BANKEX: "BSE_INDEX|BANKEX",
};

// Well-known NSE Sectoral Index tokens in Upstox
const SECTOR_INDEX_KEYS = {
    "NIFTY 50": "NSE_INDEX|Nifty 50",
    "NIFTY BANK": "NSE_INDEX|Nifty Bank",
    "NIFTY IT": "NSE_INDEX|Nifty IT",
    "NIFTY AUTO": "NSE_INDEX|Nifty Auto",
    "NIFTY FMCG": "NSE_INDEX|Nifty FMCG",
    "NIFTY PHARMA": "NSE_INDEX|Nifty Pharma",
    "NIFTY METAL": "NSE_INDEX|Nifty Metal",
    "NIFTY REALTY": "NSE_INDEX|Nifty Realty",
    "NIFTY ENERGY": "NSE_INDEX|Nifty Energy",
    "NIFTY FINANCIAL SERVICES": "NSE_INDEX|Nifty Fin Service",
    "NIFTY MEDIA": "NSE_INDEX|Nifty Media",
    "NIFTY PSU BANK": "NSE_INDEX|Nifty PSU Bank",
    "NIFTY PVT BANK": "NSE_INDEX|Nifty Pvt Bank",
    "NIFTY HEALTHCARE": "NSE_INDEX|Nifty Healthcare",
    "NIFTY CONSUMPTION": "NSE_INDEX|Nifty Consumption",
    "NIFTY INFRA": "NSE_INDEX|Nifty Infrastructure",
    "NIFTY COMMODITIES": "NSE_INDEX|Nifty Commodities",
    "NIFTY OIL & GAS": "NSE_INDEX|Nifty Oil and Gas",
};

/**
 * Fetch raw quotes from Upstox API for a list of instrument keys.
 * Upstox allows up to 500 keys per request in comma-separated query param.
 */
async function fetchRawUpstoxQuotes(instrumentKeys) {
    if (!instrumentKeys || !instrumentKeys.length) return {};
    const token = process.env.UPSTOX_ACCESS_TOKEN;
    if (!token) {
        console.warn("[UpstoxQuote] No UPSTOX_ACCESS_TOKEN configured — falling back to database");
        return {};
    }

    const uncachedKeys = [];
    const now = Date.now();
    const result = {};

    for (const key of instrumentKeys) {
        const cached = quoteCache.get(key);
        if (cached && now - cached.timestamp < CACHE_TTL_MS) {
            result[key] = cached.data;
        } else {
            uncachedKeys.push(key);
        }
    }

    if (!uncachedKeys.length) return result;

    // Fetch in batches of 100
    const batchSize = 100;
    for (let i = 0; i < uncachedKeys.length; i += batchSize) {
        const batch = uncachedKeys.slice(i, i + batchSize);
        const encodedKeys = batch.map((k) => encodeURIComponent(k)).join(",");
        const path = `/v2/market-quote/quotes?instrument_key=${encodedKeys}`;

        try {
            const data = await new Promise((resolve, reject) => {
                const req = https.request(
                    {
                        hostname: "api.upstox.com",
                        path,
                        method: "GET",
                        headers: {
                            Accept: "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        timeout: 5000,
                    },
                    (res) => {
                        let body = "";
                        res.on("data", (chunk) => (body += chunk));
                        res.on("end", () => {
                            if (res.statusCode === 200) {
                                try {
                                    const parsed = JSON.parse(body);
                                    resolve(parsed.data || {});
                                } catch (e) {
                                    reject(e);
                                }
                            } else {
                                reject(new Error(`Upstox API returned ${res.statusCode}: ${body.slice(0, 150)}`));
                            }
                        });
                    }
                );
                req.on("error", reject);
                req.on("timeout", () => {
                    req.destroy();
                    reject(new Error("Upstox quote request timed out"));
                });
                req.end();
            });

            // Map data into result & cache
            // Upstox response keys are like "NSE_EQ:RELIANCE" or "NSE_INDEX:Nifty 50"
            Object.entries(data).forEach(([respKey, quote]) => {
                const normKey = respKey.replace(":", "|");
                result[normKey] = quote;
                result[respKey] = quote;
                quoteCache.set(normKey, { data: quote, timestamp: now });
                quoteCache.set(respKey, { data: quote, timestamp: now });
            });
        } catch (err) {
            console.error("[UpstoxQuote] Batch fetch error:", err.message);
        }
    }

    return result;
}

/**
 * Get quotes for equity symbols. Resolves symbol -> instrument_key -> Upstox Quote,
 * with graceful database fallback from ohlcv_data.
 */
async function getQuotesForSymbols(symbols) {
    const normSymbols = (symbols || []).map((s) => s.toUpperCase());
    if (!normSymbols.length) return {};

    const keyMap = await upstoxInstruments.getEquityInstrumentKeyMap().catch(() => new Map());
    const instrumentKeys = [];
    const symbolToKey = {};

    normSymbols.forEach((sym) => {
        let key = MAJOR_INDEX_KEYS[sym] || SECTOR_INDEX_KEYS[sym] || keyMap.get(sym);
        if (key) {
            instrumentKeys.push(key);
            symbolToKey[sym] = key;
        }
    });

    const liveQuotes = await fetchRawUpstoxQuotes(instrumentKeys);

    // Build normalized quote response
    const output = {};
    const missingInLive = [];

    for (const sym of normSymbols) {
        const key = symbolToKey[sym];
        let q = key ? liveQuotes[key] || liveQuotes[key.replace("|", ":")] : null;

        if (q && q.last_price != null) {
            const close = q.ohlc?.close || q.last_price;
            const change = q.net_change ?? (q.last_price - close);
            const pChange = close > 0 ? (change / close) * 100 : 0;

            output[sym] = {
                symbol: sym,
                name: q.symbol !== "NA" && q.symbol ? q.symbol : sym,
                price: Number(q.last_price),
                change: Number(change.toFixed(2)),
                pChange: Number(pChange.toFixed(2)),
                open: q.ohlc?.open != null ? Number(q.ohlc.open) : null,
                high: q.ohlc?.high != null ? Number(q.ohlc.high) : null,
                low: q.ohlc?.low != null ? Number(q.ohlc.low) : null,
                close: q.ohlc?.close != null ? Number(q.ohlc.close) : null,
                volume: q.volume || 0,
                avgPrice: q.average_price || null,
                lastTradeTime: q.last_trade_time ? new Date(Number(q.last_trade_time)).toISOString() : null,
                source: "upstox_live",
            };
        } else {
            missingInLive.push(sym);
        }
    }

    // DB Fallback for any missing symbols
    if (missingInLive.length > 0) {
        try {
            const placeholders = missingInLive.map(() => "?").join(",");
            const sql = `
                SELECT o1.symbol, o1.trade_date, o1.open, o1.high, o1.low, o1.close, o1.volume
                FROM ohlcv_data o1
                JOIN (
                    SELECT symbol, MAX(trade_date) as max_date
                    FROM ohlcv_data
                    WHERE symbol IN (${placeholders})
                    GROUP BY symbol
                ) o2 ON o1.symbol = o2.symbol AND o1.trade_date = o2.max_date
            `;
            const rows = await db.query(sql, missingInLive);

            rows.forEach((r) => {
                const open = Number(r.open);
                const close = Number(r.close);
                const change = close - open;
                const pChange = open > 0 ? (change / open) * 100 : 0;

                output[r.symbol] = {
                    symbol: r.symbol,
                    name: r.symbol,
                    price: close,
                    change: Number(change.toFixed(2)),
                    pChange: Number(pChange.toFixed(2)),
                    open,
                    high: Number(r.high),
                    low: Number(r.low),
                    close,
                    volume: Number(r.volume || 0),
                    avgPrice: Number(((open + close + Number(r.high) + Number(r.low)) / 4).toFixed(2)),
                    lastTradeTime: `${r.trade_date}T15:30:00.000Z`,
                    source: "database",
                };
            });
        } catch (err) {
            console.error("[UpstoxQuote] DB fallback error:", err.message);
        }
    }

    return output;
}

/**
 * Fetch sector indices live quotes
 */
async function getSectorQuotes() {
    const keys = Object.values(SECTOR_INDEX_KEYS);
    const rawQuotes = await fetchRawUpstoxQuotes(keys);
    const result = [];

    for (const [name, key] of Object.entries(SECTOR_INDEX_KEYS)) {
        const q = rawQuotes[key] || rawQuotes[key.replace("|", ":")];
        if (q && q.last_price != null) {
            const close = q.ohlc?.close || q.last_price;
            const change = q.net_change ?? (q.last_price - close);
            const pChange = close > 0 ? (change / close) * 100 : 0;
            result.push({
                key: name.replace(/\s+/g, "_"),
                label: name,
                price: Number(q.last_price),
                change: Number(change.toFixed(2)),
                pChange: Number(pChange.toFixed(2)),
                open: q.ohlc?.open ?? null,
                high: q.ohlc?.high ?? null,
                low: q.ohlc?.low ?? null,
                close: q.ohlc?.close ?? null,
                source: "upstox_live",
            });
        }
    }

    return result;
}

module.exports = {
    fetchRawUpstoxQuotes,
    getQuotesForSymbols,
    getSectorQuotes,
    SECTOR_INDEX_KEYS,
};
