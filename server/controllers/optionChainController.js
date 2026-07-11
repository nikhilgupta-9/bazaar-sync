// controllers/optionChainController.js
const optionChainService = require("../services/optionChainService");
const db = require("../config/db");
const { marketHours } = require("../utils/marketUtils");

/**
 * Get option chain with market awareness
 */
async function getOptionChain(req, res) {
    try {
        const { symbol } = req.params;
        const { expiry, forceLive = false } = req.query;
        
        console.log(`[OptionChain] Fetching ${symbol}${expiry ? ` for ${expiry}` : ''}${forceLive ? ' (force live)' : ''}`);
        
        const payload = await optionChainService.getOptionChain(symbol, expiry, forceLive === 'true');
        
        // Add market status to response
        const response = {
            ...payload,
            marketStatus: {
                isOpen: marketHours.isTradingTime(),
                nextOpen: marketHours.getNextMarketOpen(),
                timestamp: new Date().toISOString()
            }
        };
        
        res.json(response);
    } catch (err) {
        console.error("[OptionChain Error]", err);
        res.status(err.status || 500).json({ 
            error: err.message || 'Failed to fetch option chain',
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Force refresh and save snapshot
 */
async function refreshAndSaveOptionChain(req, res) {
    try {
        const { symbol, expiry } = req.body;
        
        if (!symbol) {
            return res.status(400).json({ error: 'Symbol is required' });
        }
        
        console.log(`[Refresh] Refreshing ${symbol}${expiry ? ` for ${expiry}` : ''}`);
        
        const payload = await optionChainService.getLiveOptionChain(symbol, expiry);
        
        // Save snapshot to separate table for historical tracking
        await saveSnapshot(symbol, payload);
        
        res.json({
            success: true,
            message: "Option chain refreshed and saved",
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error("[Refresh Error]", err);
        res.status(500).json({ 
            error: err.message || 'Failed to refresh option chain',
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * Save snapshot to database
 */
async function saveSnapshot(symbol, payload) {
    const query = `
        INSERT INTO option_chain_snapshots (symbol, snapshot_time, payload)
        VALUES (?, NOW(), ?)
    `;
    
    await db.query(query, [symbol, JSON.stringify(payload)]);
}

/**
 * Get historical snapshots
 */
async function getHistoricalSnapshots(req, res) {
    try {
        const { symbol } = req.params;
        const { from, to } = req.query;
        
        const query = `
            SELECT snapshot_time, payload
            FROM option_chain_snapshots
            WHERE symbol = ?
                AND snapshot_time BETWEEN ? AND ?
            ORDER BY snapshot_time ASC
        `;
        
        const [rows] = await db.query(query, [symbol, from, to]);
        
        res.json({
            symbol,
            snapshots: rows.map(row => ({
                time: row.snapshot_time,
                data: JSON.parse(row.payload)
            }))
        });
    } catch (err) {
        console.error("[Historical Snapshots Error]", err);
        res.status(500).json({ error: err.message });
    }
}

module.exports = { 
    getOptionChain, 
    refreshAndSaveOptionChain,
    getHistoricalSnapshots
};