// server/services/deltaExchangeService.js — Real-Time Delta Exchange Derivatives Integration
// Live Option Chain, Greeks, Expiries, Spot Index, and Order Book for BTC, ETH, SOL, etc.
const https = require("https");

const DELTA_BASE_URL = "https://api.delta.exchange";
const DELTA_CDN_URL = "https://cdn.delta.exchange";

let tickersCache = { data: null, timestamp: 0 };
let productsCache = { data: null, timestamp: 0 };
const CACHE_TTL_MS = 2000; // 2 seconds high-frequency refresh

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                "User-Agent": "BazaarSync-DeltaClient/1.0",
                "Accept": "application/json"
            },
            timeout: 8000
        }, (res) => {
            if (res.statusCode !== 200) {
                let body = "";
                res.on("data", c => body += c);
                res.on("end", () => reject(new Error(`Delta API HTTP ${res.statusCode}: ${body.slice(0, 100)}`)));
                return;
            }
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Delta JSON parse error: ${e.message}`));
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Delta API request timeout"));
        });
    });
}

/**
 * Get all live tickers from Delta Exchange (cached with 2s TTL)
 */
async function getAllTickers() {
    const now = Date.now();
    if (tickersCache.data && (now - tickersCache.timestamp < CACHE_TTL_MS)) {
        return tickersCache.data;
    }
    try {
        const resp = await fetchJson(`${DELTA_BASE_URL}/v2/tickers`);
        if (resp && resp.result) {
            tickersCache = { data: resp.result, timestamp: now };
            return resp.result;
        }
    } catch (err) {
        if (tickersCache.data) return tickersCache.data;
        throw err;
    }
    return [];
}

/**
 * Get all active products from Delta Exchange (cached with 60s TTL)
 */
async function getAllProducts() {
    const now = Date.now();
    if (productsCache.data && (now - productsCache.timestamp < 60000)) {
        return productsCache.data;
    }
    try {
        const resp = await fetchJson(`${DELTA_BASE_URL}/v2/products`);
        if (resp && resp.result) {
            productsCache = { data: resp.result, timestamp: now };
            return resp.result;
        }
    } catch (err) {
        if (productsCache.data) return productsCache.data;
        throw err;
    }
    return [];
}

/**
 * Format timestamp into standard Delta expiry string (e.g. "05 Oct 26" or "11 Oct 26")
 */
function formatExpiryPill(dateStrOrTs) {
    const d = new Date(dateStrOrTs);
    const day = String(d.getUTCDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[d.getUTCMonth()];
    const yr = String(d.getUTCFullYear()).slice(-2);
    return `${day} ${month} ${yr}`;
}

/**
 * Format time to expiry countdown string (e.g. "1d:2h:27m")
 */
function getTimeToExpiry(settlementTimeStr) {
    if (!settlementTimeStr) return "";
    const diffMs = new Date(settlementTimeStr).getTime() - Date.now();
    if (diffMs <= 0) return "Expired";
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
    if (days > 0) return `${days}d:${hours}h:${mins}m`;
    return `${hours}h:${mins}m`;
}

/**
 * Build Full Live Option Chain for Crypto Underlying (BTC, ETH, SOL, etc.)
 */
async function getCryptoOptionChain(underlying = "BTC", selectedExpiry = null) {
    const cleanAsset = underlying.toUpperCase().replace(/USD|USDT/g, "");
    const [tickers, products] = await Promise.all([getAllTickers(), getAllProducts()]);

    // 1. Determine Spot Index Price and metadata
    let spotPrice = 0;
    let spot24hChange = 0;
    let spot24hVol = 0;

    // Look for spot / perpetual futures ticker (e.g. BTCUSDT, ETHUSDT, SOLUSDT)
    const spotTicker = tickers.find(t => 
        t.contract_type === "perpetual_futures" && (t.symbol === `${cleanAsset}USDT` || t.symbol === `${cleanAsset}USD`)
    ) || tickers.find(t => 
        t.contract_type === "spot" && (t.symbol === `${cleanAsset}_USDT` || t.symbol === `${cleanAsset}USDT`)
    ) || tickers.find(t => 
        (t.symbol === `${cleanAsset}USDT` || t.symbol === `${cleanAsset}USD`) && !t.symbol.startsWith("C-") && !t.symbol.startsWith("P-")
    );

    if (spotTicker) {
        spotPrice = parseFloat(spotTicker.spot_price || spotTicker.mark_price || spotTicker.close || 0);
        spot24hChange = parseFloat(spotTicker.mark_change_24h || spotTicker.ltp_change_24h || 0);
        spot24hVol = parseFloat(spotTicker.turnover_usd || spotTicker.volume || 0);
    }

    // 2. Filter options products for this asset
    const assetProducts = products.filter(p => 
        (p.contract_type === "call_options" || p.contract_type === "put_options") &&
        (p.underlying_asset?.symbol === cleanAsset || p.symbol?.includes(`-${cleanAsset}-`)) &&
        p.state === "live"
    );

    // Map tickers by symbol for quick lookup
    const tickerMap = new Map();
    for (const t of tickers) {
        if (t.symbol) tickerMap.set(t.symbol, t);
    }

    // 3. Extract unique expiries
    const expiryMap = new Map(); // key: settlement_time (ISO), value: formatted label
    for (const p of assetProducts) {
        if (p.settlement_time) {
            const rawTime = p.settlement_time;
            if (!expiryMap.has(rawTime)) {
                expiryMap.set(rawTime, {
                    raw: rawTime,
                    label: formatExpiryPill(rawTime),
                    timeToExpiry: getTimeToExpiry(rawTime),
                    timestamp: new Date(rawTime).getTime()
                });
            }
        }
    }

    const sortedExpiries = Array.from(expiryMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    // Determine target expiry
    let activeExpiry = sortedExpiries[0]?.raw || null;
    if (selectedExpiry) {
        const match = sortedExpiries.find(e => e.raw === selectedExpiry || e.label.toLowerCase() === selectedExpiry.toLowerCase());
        if (match) activeExpiry = match.raw;
    }

    const activeExpiryMeta = sortedExpiries.find(e => e.raw === activeExpiry) || sortedExpiries[0] || null;

    // 4. Group calls and puts by strike price for the active expiry
    const strikeMap = new Map();

    for (const p of assetProducts) {
        if (p.settlement_time !== activeExpiry) continue;
        const strike = parseFloat(p.strike_price);
        if (!strike || isNaN(strike)) continue;

        if (!strikeMap.has(strike)) {
            strikeMap.set(strike, {
                strike,
                call: null,
                put: null,
            });
        }

        const entry = strikeMap.get(strike);
        const t = tickerMap.get(p.symbol) || {};
        const quotes = t.quotes || {};
        const greeks = t.greeks || {};

        const rawMark = parseFloat(t.mark_price || 0);
        const bidPrice = parseFloat(quotes.best_bid || 0);
        const askPrice = parseFloat(quotes.best_ask || 0);
        let finalMark = rawMark;
        if (!finalMark || isNaN(finalMark) || finalMark <= 0) {
            if (bidPrice > 0 && askPrice > 0) {
                finalMark = (bidPrice + askPrice) / 2;
            } else if (askPrice > 0) {
                finalMark = askPrice;
            } else if (bidPrice > 0) {
                finalMark = bidPrice;
            } else {
                finalMark = p.contract_type === "call_options"
                    ? Math.max(0.1, (spotPrice || 80000) - strike)
                    : Math.max(0.1, strike - (spotPrice || 80000));
            }
        }

        const optionData = {
            symbol: p.symbol,
            productId: p.id,
            contractType: p.contract_type === "call_options" ? "call" : "put",
            strike,
            expiryDate: p.settlement_time,
            expiryLabel: activeExpiryMeta?.label || "",
            markPrice: parseFloat(finalMark.toFixed(4)),
            markIv: parseFloat(quotes.mark_iv || t.mark_vol || 0) * 100, // percentage
            bidPrice,
            bidIv: parseFloat(quotes.bid_iv || 0) * 100,
            bidQty: parseFloat(quotes.bid_size || 0) * parseFloat(p.contract_value || 0.001),
            askPrice,
            askIv: parseFloat(quotes.ask_iv || 0) * 100,
            askQty: parseFloat(quotes.ask_size || 0) * parseFloat(p.contract_value || 0.001),
            oi: parseFloat(t.oi || 0),
            oiValueUsd: parseFloat(t.oi_value_usd || (t.oi * (spotPrice || 1))),
            volume: parseFloat(t.volume || 0),
            delta: parseFloat(greeks.delta || (p.contract_type === "call_options" ? 0.5 : -0.5)),
            gamma: parseFloat(greeks.gamma || 0),
            theta: parseFloat(greeks.theta || 0),
            vega: parseFloat(greeks.vega || 0),
            leverage: p.default_leverage || 100,
            contractValue: parseFloat(p.contract_value || 0.001),
            tickSize: parseFloat(p.tick_size || 0.1),
        };

        if (p.contract_type === "call_options") {
            entry.call = optionData;
        } else {
            entry.put = optionData;
        }
    }

    const chainRows = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);

    // Calculate max OI for depth visualization bars
    let maxCallOi = 1;
    let maxPutOi = 1;
    for (const r of chainRows) {
        if (r.call?.oiValueUsd > maxCallOi) maxCallOi = r.call.oiValueUsd;
        if (r.put?.oiValueUsd > maxPutOi) maxPutOi = r.put.oiValueUsd;
    }

    // Attach relative OI percentages
    chainRows.forEach(r => {
        if (r.call) r.call.oiPercent = Math.min(100, (r.call.oiValueUsd / maxCallOi) * 100);
        if (r.put) r.put.oiPercent = Math.min(100, (r.put.oiValueUsd / maxPutOi) * 100);
    });

    return {
        underlying: cleanAsset,
        spotPrice: spotPrice || (chainRows.length > 0 ? chainRows[Math.floor(chainRows.length / 2)].strike : 85000),
        spot24hChange,
        spot24hVol,
        expiries: sortedExpiries,
        activeExpiry: activeExpiryMeta,
        chain: chainRows,
        totalStrikes: chainRows.length,
        timestamp: Date.now(),
    };
}

module.exports = {
    getAllTickers,
    getAllProducts,
    getCryptoOptionChain,
    getTimeToExpiry,
    formatExpiryPill,
};
