const db = require("../config/db");
const upstoxQuotes = require("../services/upstoxQuoteService");
const upstoxInstruments = require("../services/upstoxInstrumentMaster");
const dhanMaster = require("../../data-downloader/dhan/instrumentMaster");

// 7 Major Benchmark & Sectoral Indices
const MAJOR_INDICES = [
    { symbol: "NIFTY", name: "NIFTY 50", sector: "Indices", industry: "Benchmark Index", mcapTier: "Benchmark" },
    { symbol: "BANKNIFTY", name: "NIFTY BANK", sector: "Banking & Finance", industry: "Sectoral Index", mcapTier: "Sectoral" },
    { symbol: "FINNIFTY", name: "NIFTY FINANCIAL SERVICES", sector: "Banking & Finance", industry: "Sectoral Index", mcapTier: "Sectoral" },
    { symbol: "MIDCPNIFTY", name: "NIFTY MIDCAP SELECT", sector: "Indices", industry: "Midcap Index", mcapTier: "Mid Cap" },
    { symbol: "NIFTYNXT50", name: "NIFTY NEXT 50", sector: "Indices", industry: "Largecap Index", mcapTier: "Large Cap" },
    { symbol: "SENSEX", name: "BSE SENSEX", sector: "Indices", industry: "Benchmark Index", mcapTier: "Benchmark" },
    { symbol: "BANKEX", name: "BSE BANKEX", sector: "Banking & Finance", industry: "Sectoral Index", mcapTier: "Sectoral" },
];

// Comprehensive industry & sector mapping for NSE equities
const STOCK_METADATA = {
    // IT
    TCS: { sector: "Information Technology", industry: "IT Services", mcapRank: 2, mcapTier: "Large Cap", weight: 3.8 },
    INFY: { sector: "Information Technology", industry: "IT Services", mcapRank: 4, mcapTier: "Large Cap", weight: 3.2 },
    HCLTECH: { sector: "Information Technology", industry: "IT Services", mcapRank: 12, mcapTier: "Large Cap", weight: 1.5 },
    WIPRO: { sector: "Information Technology", industry: "IT Services", mcapRank: 24, mcapTier: "Large Cap", weight: 0.9 },
    TECHM: { sector: "Information Technology", industry: "IT Services", mcapRank: 29, mcapTier: "Large Cap", weight: 0.8 },
    LTIM: { sector: "Information Technology", industry: "IT Services", mcapRank: 33, mcapTier: "Large Cap", weight: 0.6 },
    PERSISTENT: { sector: "Information Technology", industry: "Software", mcapRank: 65, mcapTier: "Mid Cap", weight: 0.4 },
    COFORGE: { sector: "Information Technology", industry: "IT Services", mcapRank: 68, mcapTier: "Mid Cap", weight: 0.3 },

    // Banking & Financials
    HDFCBANK: { sector: "Banking & Finance", industry: "Private Bank", mcapRank: 3, mcapTier: "Large Cap", weight: 8.5 },
    ICICIBANK: { sector: "Banking & Finance", industry: "Private Bank", mcapRank: 5, mcapTier: "Large Cap", weight: 6.8 },
    SBIN: { sector: "Banking & Finance", industry: "PSU Bank", mcapRank: 6, mcapTier: "Large Cap", weight: 4.2 },
    KOTAKBANK: { sector: "Banking & Finance", industry: "Private Bank", mcapRank: 10, mcapTier: "Large Cap", weight: 2.5 },
    AXISBANK: { sector: "Banking & Finance", industry: "Private Bank", mcapRank: 11, mcapTier: "Large Cap", weight: 2.8 },
    BAJFINANCE: { sector: "Banking & Finance", industry: "NBFC", mcapRank: 8, mcapTier: "Large Cap", weight: 2.1 },
    BAJAJFINSV: { sector: "Banking & Finance", industry: "Financial Services", mcapRank: 18, mcapTier: "Large Cap", weight: 1.2 },
    INDUSINDBK: { sector: "Banking & Finance", industry: "Private Bank", mcapRank: 35, mcapTier: "Large Cap", weight: 0.8 },
    PNB: { sector: "Banking & Finance", industry: "PSU Bank", mcapRank: 42, mcapTier: "Large Cap", weight: 0.7 },
    BANKBARODA: { sector: "Banking & Finance", industry: "PSU Bank", mcapRank: 38, mcapTier: "Large Cap", weight: 0.8 },
    CHOLAFIN: { sector: "Banking & Finance", industry: "NBFC", mcapRank: 48, mcapTier: "Large Cap", weight: 0.6 },
    SHRIRAMFIN: { sector: "Banking & Finance", industry: "NBFC", mcapRank: 45, mcapTier: "Large Cap", weight: 0.6 },

    // Energy & Oil
    RELIANCE: { sector: "Energy & Petrochemicals", industry: "Oil & Gas Refineries", mcapRank: 1, mcapTier: "Large Cap", weight: 9.8 },
    ONGC: { sector: "Energy & Petrochemicals", industry: "Oil Exploration", mcapRank: 14, mcapTier: "Large Cap", weight: 1.4 },
    NTPC: { sector: "Energy & Petrochemicals", industry: "Power Generation", mcapRank: 13, mcapTier: "Large Cap", weight: 1.8 },
    POWERGRID: { sector: "Energy & Petrochemicals", industry: "Power Transmission", mcapRank: 15, mcapTier: "Large Cap", weight: 1.5 },
    COALINDIA: { sector: "Energy & Petrochemicals", industry: "Coal Mining", mcapRank: 16, mcapTier: "Large Cap", weight: 1.2 },
    BPCL: { sector: "Energy & Petrochemicals", industry: "Oil Marketing", mcapRank: 26, mcapTier: "Large Cap", weight: 0.9 },
    IOC: { sector: "Energy & Petrochemicals", industry: "Oil Refining", mcapRank: 28, mcapTier: "Large Cap", weight: 0.8 },
    TATAPOWER: { sector: "Energy & Petrochemicals", industry: "Power Generation", mcapRank: 32, mcapTier: "Large Cap", weight: 0.7 },
    ADANIGREEN: { sector: "Energy & Petrochemicals", industry: "Renewable Energy", mcapRank: 20, mcapTier: "Large Cap", weight: 1.0 },
    ADANIPOWER: { sector: "Energy & Petrochemicals", industry: "Power Generation", mcapRank: 22, mcapTier: "Large Cap", weight: 0.9 },

    // Automobiles
    TATAMOTORS: { sector: "Automobile", industry: "Auto Manufacturers", mcapRank: 17, mcapTier: "Large Cap", weight: 2.1 },
    M_M: { sector: "Automobile", industry: "Auto Manufacturers", mcapRank: 9, mcapTier: "Large Cap", weight: 2.5 },
    MARUTI: { sector: "Automobile", industry: "Passenger Cars", mcapRank: 19, mcapTier: "Large Cap", weight: 1.6 },
    BAJAJ_AUTO: { sector: "Automobile", industry: "2/3 Wheelers", mcapRank: 21, mcapTier: "Large Cap", weight: 1.1 },
    HEROMOTOCO: { sector: "Automobile", industry: "2 Wheelers", mcapRank: 36, mcapTier: "Large Cap", weight: 0.7 },
    EICHERMOT: { sector: "Automobile", industry: "2 Wheelers", mcapRank: 37, mcapTier: "Large Cap", weight: 0.7 },
    TVSMOTOR: { sector: "Automobile", industry: "2 Wheelers", mcapRank: 40, mcapTier: "Large Cap", weight: 0.6 },
    BHARATFORG: { sector: "Automobile", industry: "Auto Ancillaries", mcapRank: 55, mcapTier: "Mid Cap", weight: 0.4 },

    // FMCG & Consumer
    ITC: { sector: "Consumer Goods & FMCG", industry: "Cigarettes & FMCG", mcapRank: 7, mcapTier: "Large Cap", weight: 3.8 },
    HINDUNILVR: { sector: "Consumer Goods & FMCG", industry: "FMCG Diversified", mcapRank: 8, mcapTier: "Large Cap", weight: 2.6 },
    NESTLEIND: { sector: "Consumer Goods & FMCG", industry: "Packaged Foods", mcapRank: 23, mcapTier: "Large Cap", weight: 1.0 },
    BRITANNIA: { sector: "Consumer Goods & FMCG", industry: "Bakery & Foods", mcapRank: 31, mcapTier: "Large Cap", weight: 0.8 },
    TATACONSUM: { sector: "Consumer Goods & FMCG", industry: "Beverages & Foods", mcapRank: 34, mcapTier: "Large Cap", weight: 0.7 },
    GODREJCP: { sector: "Consumer Goods & FMCG", industry: "Personal Care", mcapRank: 44, mcapTier: "Large Cap", weight: 0.5 },
    DABUR: { sector: "Consumer Goods & FMCG", industry: "Ayurveda & Personal Care", mcapRank: 46, mcapTier: "Large Cap", weight: 0.5 },
    TITAN: { sector: "Consumer Goods & FMCG", industry: "Gems & Jewellery", mcapRank: 25, mcapTier: "Large Cap", weight: 1.4 },

    // Metals & Mining
    TATASTEEL: { sector: "Metals & Mining", industry: "Iron & Steel", mcapRank: 27, mcapTier: "Large Cap", weight: 1.2 },
    JSWSTEEL: { sector: "Metals & Mining", industry: "Iron & Steel", mcapRank: 30, mcapTier: "Large Cap", weight: 1.0 },
    HINDALCO: { sector: "Metals & Mining", industry: "Aluminium & Copper", mcapRank: 39, mcapTier: "Large Cap", weight: 0.9 },
    VEDL: { sector: "Metals & Mining", industry: "Diversified Metals", mcapRank: 41, mcapTier: "Large Cap", weight: 0.8 },
    JINDALSTEL: { sector: "Metals & Mining", industry: "Iron & Steel", mcapRank: 47, mcapTier: "Large Cap", weight: 0.6 },
    SAIL: { sector: "Metals & Mining", industry: "Iron & Steel", mcapRank: 52, mcapTier: "Mid Cap", weight: 0.4 },
    NMDC: { sector: "Metals & Mining", industry: "Mining & Minerals", mcapRank: 58, mcapTier: "Mid Cap", weight: 0.4 },

    // Pharma & Healthcare
    SUNPHARMA: { sector: "Pharma & Healthcare", industry: "Pharmaceuticals", mcapRank: 11, mcapTier: "Large Cap", weight: 1.6 },
    CIPLA: { sector: "Pharma & Healthcare", industry: "Pharmaceuticals", mcapRank: 43, mcapTier: "Large Cap", weight: 0.7 },
    DRREDDY: { sector: "Pharma & Healthcare", industry: "Pharmaceuticals", mcapRank: 49, mcapTier: "Large Cap", weight: 0.6 },
    APOLLOHOSP: { sector: "Pharma & Healthcare", industry: "Hospital & Healthcare", mcapRank: 50, mcapTier: "Large Cap", weight: 0.6 },
    DIVISLAB: { sector: "Pharma & Healthcare", industry: "Active Pharma Ingr.", mcapRank: 51, mcapTier: "Large Cap", weight: 0.6 },
    LUPIN: { sector: "Pharma & Healthcare", industry: "Pharmaceuticals", mcapRank: 56, mcapTier: "Mid Cap", weight: 0.4 },
    ZYDUSLIFE: { sector: "Pharma & Healthcare", industry: "Pharmaceuticals", mcapRank: 59, mcapTier: "Mid Cap", weight: 0.4 },

    // Infrastructure & Capital Goods
    LT: { sector: "Infrastructure & Industrial", industry: "Engineering & Construction", mcapRank: 6, mcapTier: "Large Cap", weight: 3.5 },
    ADANIPORTS: { sector: "Infrastructure & Industrial", industry: "Ports & Logistics", mcapRank: 20, mcapTier: "Large Cap", weight: 1.2 },
    SIEMENS: { sector: "Infrastructure & Industrial", industry: "Industrial Equipments", mcapRank: 36, mcapTier: "Large Cap", weight: 0.7 },
    ABB: { sector: "Infrastructure & Industrial", industry: "Heavy Electricals", mcapRank: 38, mcapTier: "Large Cap", weight: 0.6 },
    HAL: { sector: "Infrastructure & Industrial", industry: "Aerospace & Defence", mcapRank: 24, mcapTier: "Large Cap", weight: 1.1 },
    BEL: { sector: "Infrastructure & Industrial", industry: "Defence Electronics", mcapRank: 25, mcapTier: "Large Cap", weight: 1.0 },
    ULTRACEMCO: { sector: "Infrastructure & Industrial", industry: "Cement", mcapRank: 22, mcapTier: "Large Cap", weight: 1.2 },
    GRASIM: { sector: "Infrastructure & Industrial", industry: "Cement & Diversified", mcapRank: 37, mcapTier: "Large Cap", weight: 0.8 },
};

/**
 * Get Market Map: stocks grouped by sectors with real-time Upstox quotes & weights
 */
async function getMarketMap(req, res) {
    try {
        const symbolList = Object.keys(STOCK_METADATA);
        const quotes = await upstoxQuotes.getQuotesForSymbols(symbolList);

        // Group into sectors
        const sectorsMap = {};

        symbolList.forEach((sym) => {
            const meta = STOCK_METADATA[sym];
            const q = quotes[sym] || {
                symbol: sym,
                name: sym,
                price: 0,
                change: 0,
                pChange: 0,
                volume: 0,
                source: "offline",
            };

            if (!sectorsMap[meta.sector]) {
                sectorsMap[meta.sector] = {
                    sector: meta.sector,
                    stocks: [],
                    totalWeight: 0,
                    advances: 0,
                    declines: 0,
                    unchanged: 0,
                    weightedChange: 0,
                };
            }

            const item = {
                symbol: sym,
                name: q.name || sym,
                industry: meta.industry,
                mcapTier: meta.mcapTier,
                weight: meta.weight,
                price: q.price,
                change: q.change,
                pChange: q.pChange,
                volume: q.volume,
                source: q.source,
            };

            sectorsMap[meta.sector].stocks.push(item);
            sectorsMap[meta.sector].totalWeight += meta.weight;
            if (q.pChange > 0.05) sectorsMap[meta.sector].advances++;
            else if (q.pChange < -0.05) sectorsMap[meta.sector].declines++;
            else sectorsMap[meta.sector].unchanged++;
            sectorsMap[meta.sector].weightedChange += (q.pChange * meta.weight);
        });

        const sectors = Object.values(sectorsMap).map((s) => ({
            ...s,
            avgChange: s.totalWeight > 0 ? Number((s.weightedChange / s.totalWeight).toFixed(2)) : 0,
            stocks: s.stocks.sort((a, b) => b.weight - a.weight),
        })).sort((a, b) => b.totalWeight - a.totalWeight);

        res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            totalStocks: symbolList.length,
            sectors,
        });
    } catch (err) {
        console.error("[EquityController] getMarketMap error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * Get 52-Week High / Low scanner & proximity metrics
 */
async function get52WeekHighLow(req, res) {
    try {
        const symbolList = Object.keys(STOCK_METADATA);
        const quotes = await upstoxQuotes.getQuotesForSymbols(symbolList);

        // Fetch 52-week min/max from DB
        const placeholders = symbolList.map(() => "?").join(",");
        const sql = `
            SELECT symbol, MIN(low) as year_low, MAX(high) as year_high, AVG(volume) as avg_vol
            FROM ohlcv_data
            WHERE symbol IN (${placeholders}) AND trade_date >= DATE_SUB(CURDATE(), INTERVAL 365 DAY)
            GROUP BY symbol
        `;
        const dbStats = await db.query(sql, symbolList).catch(() => []);
        const statMap = new Map(dbStats.map((s) => [s.symbol, s]));

        const records = symbolList.map((sym) => {
            const meta = STOCK_METADATA[sym];
            const q = quotes[sym] || { price: 0, change: 0, pChange: 0, high: 0, low: 0, volume: 0, source: "offline" };
            const stat = statMap.get(sym) || { year_low: q.low || q.price * 0.7, year_high: q.high || q.price * 1.3, avg_vol: q.volume };

            const yearHigh = Math.max(Number(stat.year_high || 0), Number(q.high || 0), Number(q.price || 0));
            const yearLow = Math.min(Number(stat.year_low || q.price), Number(q.low || q.price), Number(q.price || 0));
            const currentPrice = Number(q.price);

            const distFromHigh = yearHigh > 0 ? ((yearHigh - currentPrice) / yearHigh) * 100 : 0;
            const distFromLow = yearLow > 0 ? ((currentPrice - yearLow) / yearLow) * 100 : 0;
            const rangeSpan = yearHigh - yearLow;
            const rangePosition = rangeSpan > 0 ? Math.min(100, Math.max(0, ((currentPrice - yearLow) / rangeSpan) * 100)) : 50;

            const isNewHighToday = q.high && yearHigh > 0 && Math.abs(q.high - yearHigh) < 0.05;
            const isNewLowToday = q.low && yearLow > 0 && Math.abs(q.low - yearLow) < 0.05;

            return {
                symbol: sym,
                name: q.name || sym,
                sector: meta.sector,
                industry: meta.industry,
                mcapTier: meta.mcapTier,
                price: currentPrice,
                change: q.change,
                pChange: q.pChange,
                volume: q.volume,
                yearHigh: Number(yearHigh.toFixed(2)),
                yearLow: Number(yearLow.toFixed(2)),
                distFromHigh: Number(distFromHigh.toFixed(2)), // % away from high
                distFromLow: Number(distFromLow.toFixed(2)),   // % away from low
                rangePosition: Number(rangePosition.toFixed(1)), // 0-100% position
                isNewHighToday,
                isNewLowToday,
                source: q.source,
            };
        });

        const near52WHigh = records.filter((r) => r.distFromHigh <= 5.0 && r.price > 0).sort((a, b) => a.distFromHigh - b.distFromHigh);
        const near52WLow = records.filter((r) => r.distFromLow <= 5.0 && r.price > 0).sort((a, b) => a.distFromLow - b.distFromLow);
        const new52WHighToday = records.filter((r) => r.isNewHighToday);
        const new52WLowToday = records.filter((r) => r.isNewLowToday);

        res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            summary: {
                totalScanned: records.length,
                nearHighCount: near52WHigh.length,
                nearLowCount: near52WLow.length,
                newHighCount: new52WHighToday.length,
                newLowCount: new52WLowToday.length,
            },
            near52WHigh,
            near52WLow,
            new52WHighToday,
            new52WLowToday,
            all: records,
        });
    } catch (err) {
        console.error("[EquityController] get52WeekHighLow error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * Get Industry Momentum Ranking
 */
async function getIndustryMomentum(req, res) {
    try {
        const symbolList = Object.keys(STOCK_METADATA);
        const quotes = await upstoxQuotes.getQuotesForSymbols(symbolList);

        const industriesMap = {};

        symbolList.forEach((sym) => {
            const meta = STOCK_METADATA[sym];
            const q = quotes[sym] || { price: 0, change: 0, pChange: 0, volume: 0, source: "offline" };

            if (!industriesMap[meta.industry]) {
                industriesMap[meta.industry] = {
                    industry: meta.industry,
                    sector: meta.sector,
                    stocks: [],
                    totalWeight: 0,
                    weightedPChange: 0,
                    advancers: 0,
                    decliners: 0,
                };
            }

            industriesMap[meta.industry].stocks.push({
                symbol: sym,
                price: q.price,
                change: q.change,
                pChange: q.pChange,
                volume: q.volume,
                weight: meta.weight,
                source: q.source,
            });

            industriesMap[meta.industry].totalWeight += meta.weight;
            industriesMap[meta.industry].weightedPChange += (q.pChange * meta.weight);
            if (q.pChange > 0) industriesMap[meta.industry].advancers++;
            else if (q.pChange < 0) industriesMap[meta.industry].decliners++;
        });

        const industries = Object.values(industriesMap).map((ind) => {
            const avgMomentum = ind.totalWeight > 0 ? ind.weightedPChange / ind.totalWeight : 0;
            const topStock = [...ind.stocks].sort((a, b) => b.pChange - a.pChange)[0];
            return {
                industry: ind.industry,
                sector: ind.sector,
                stockCount: ind.stocks.length,
                advancers: ind.advancers,
                decliners: ind.decliners,
                avgMomentum: Number(avgMomentum.toFixed(2)),
                topPerformer: topStock ? { symbol: topStock.symbol, pChange: topStock.pChange } : null,
                stocks: ind.stocks.sort((a, b) => b.pChange - a.pChange),
            };
        }).sort((a, b) => b.avgMomentum - a.avgMomentum);

        res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            industries,
        });
    } catch (err) {
        console.error("[EquityController] getIndustryMomentum error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * Get Most Active Market Universe (7 Indices + 210 F&O Stocks) with Turnover, Volume, Gainers, Losers, and StockMojo Metrics
 */
async function getMostActive(req, res) {
    try {
        let fnoStockSymbols = [];
        try {
            fnoStockSymbols = await dhanMaster.listFnoStockSymbols();
        } catch (e) {
            console.warn("[EquityController] Could not fetch Dhan F&O master:", e.message);
        }

        if (!fnoStockSymbols || fnoStockSymbols.length === 0) {
            fnoStockSymbols = Object.keys(STOCK_METADATA);
        }

        const indexSymbols = MAJOR_INDICES.map((idx) => idx.symbol);
        const allSymbols = [...new Set([...indexSymbols, ...fnoStockSymbols])];

        const quotes = await upstoxQuotes.getQuotesForSymbols(allSymbols);
        const indexMetaMap = new Map(MAJOR_INDICES.map((idx) => [idx.symbol, idx]));

        const list = allSymbols.map((sym) => {
            const isIndex = indexMetaMap.has(sym);
            const idxMeta = indexMetaMap.get(sym);
            const stockMeta = STOCK_METADATA[sym] || {};
            const q = quotes[sym] || { price: 0, change: 0, pChange: 0, open: 0, high: 0, low: 0, close: 0, volume: 0, avgPrice: 0, source: "offline" };

            const price = Number(q.price || 0);
            const high = Number(q.high || price);
            const low = Number(q.low || price);
            const volume = Number(q.volume || 0);
            const avgPrice = Number(q.avgPrice || price || 0);
            const turnoverCr = Number(((volume * avgPrice) / 10000000).toFixed(2));

            const rangeSpan = high - low;
            const dayRangePosition = rangeSpan > 0 ? Number(Math.min(100, Math.max(0, ((price - low) / rangeSpan) * 100)).toFixed(1)) : 50;
            const distFromHigh = high > 0 ? Number((((high - price) / high) * 100).toFixed(2)) : 0;
            const distFromLow = low > 0 ? Number((((price - low) / low) * 100).toFixed(2)) : 0;

            return {
                symbol: sym,
                name: isIndex ? idxMeta.name : (q.name && q.name !== "NA" ? q.name : sym),
                type: isIndex ? "index" : "stock",
                sector: isIndex ? idxMeta.sector : (stockMeta.sector || "Equities"),
                industry: isIndex ? idxMeta.industry : (stockMeta.industry || "General"),
                mcapTier: isIndex ? idxMeta.mcapTier : (stockMeta.mcapTier || "Large Cap"),
                price,
                change: Number(Number(q.change || 0).toFixed(2)),
                pChange: Number(Number(q.pChange || 0).toFixed(2)),
                open: Number(q.open || 0),
                high,
                low,
                close: Number(q.close || price),
                volume,
                turnoverCr,
                dayRangePosition,
                distFromHigh,
                distFromLow,
                source: q.source || "offline",
            };
        });

        const indices = list.filter((item) => item.type === "index");
        const stocks = list.filter((item) => item.type === "stock");

        // Calculate Market Breadth across stocks
        let advances = 0;
        let declines = 0;
        let unchanged = 0;
        let totalTurnoverCr = 0;
        let totalVolume = 0;

        stocks.forEach((s) => {
            if (s.pChange > 0.05) advances++;
            else if (s.pChange < -0.05) declines++;
            else unchanged++;
            totalTurnoverCr += s.turnoverCr;
            totalVolume += s.volume;
        });

        const topGainers = [...stocks].sort((a, b) => b.pChange - a.pChange).slice(0, 20);
        const topLosers = [...stocks].sort((a, b) => a.pChange - b.pChange).slice(0, 20);
        const topVolume = [...stocks].sort((a, b) => b.volume - a.volume).slice(0, 20);
        const topTurnover = [...stocks].sort((a, b) => b.turnoverCr - a.turnoverCr).slice(0, 20);

        const summary = {
            totalIndices: indices.length,
            totalStocks: stocks.length,
            advances,
            declines,
            unchanged,
            totalTurnoverCr: Number(totalTurnoverCr.toFixed(2)),
            totalVolume,
            topGainer: topGainers[0] || null,
            topLoser: topLosers[0] || null,
        };

        res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            summary,
            indices,
            stocks,
            all: list,
            topGainers,
            topLosers,
            topVolume,
            topTurnover,
        });
    } catch (err) {
        console.error("[EquityController] getMostActive error:", err);
        res.status(500).json({ error: err.message });
    }
}

/**
 * Get real-time sector indices quotes
 */
async function getSectorIndices(req, res) {
    try {
        const sectors = await upstoxQuotes.getSectorQuotes();
        res.json({
            status: "success",
            timestamp: new Date().toISOString(),
            sectors,
        });
    } catch (err) {
        console.error("[EquityController] getSectorIndices error:", err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = {
    getMarketMap,
    get52WeekHighLow,
    getIndustryMomentum,
    getMostActive,
    getSectorIndices,
    STOCK_METADATA,
};
