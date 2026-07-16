// routes/optionChain.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

console.log('✅ Option chain routes loading...');

// ============================================
// SPECIFIC ROUTES - MUST COME FIRST!
// ============================================

// 1. Debug route - Check database
router.get('/debug/db-check', async (req, res) => {
    try {
        console.log('[Debug] Checking database...');
        
        // Check all tables
        const tables = await db.query('SHOW TABLES');
        
        // Check total rows
        const totalRows = await db.query('SELECT COUNT(*) as count FROM option_chain_history');
        
        // Check distinct symbols
        const allSymbols = await db.query(
            'SELECT DISTINCT symbol, COUNT(*) as count FROM option_chain_history GROUP BY symbol'
        );
        
        // Get one sample row
        const sampleRow = await db.query('SELECT * FROM option_chain_history LIMIT 1');
        
        // Check column names
        const columns = await db.query('SHOW COLUMNS FROM option_chain_history');
        
        // Also check if NIFTY exists specifically
        const niftyCheck = await db.query(
            'SELECT COUNT(*) as count FROM option_chain_history WHERE UPPER(symbol) = UPPER(?)',
            ['NIFTY']
        );
        
        res.json({
            success: true,
            tables: tables,
            totalRows: totalRows,
            allSymbols: allSymbols,
            sampleRow: sampleRow,
            columns: columns,
            niftyExists: niftyCheck,
            message: 'Check the symbol names above - use one of these symbols in your request'
        });
    } catch (err) {
        console.error('[Debug Error]', err);
        res.status(500).json({ 
            success: false,
            error: err.message,
            stack: err.stack
        });
    }
});

// 2. Debug data route
router.get('/debug/data', async (req, res) => {
    try {
        const { symbol = 'NIFTY' } = req.query;
        console.log(`[Debug] Fetching data for ${symbol}`);
        
        // First, get all available symbols
        const allSymbols = await db.query(
            'SELECT DISTINCT symbol FROM option_chain_history'
        );
        
        // Check if the requested symbol exists
        const symbolCheck = await db.query(
            'SELECT COUNT(*) as count FROM option_chain_history WHERE UPPER(symbol) = UPPER(?)',
            [symbol]
        );
        
        // Get sample data for this symbol
        const sampleData = await db.query(
            'SELECT * FROM option_chain_history WHERE UPPER(symbol) = UPPER(?) LIMIT 5',
            [symbol]
        );
        
        // Get distinct expiries
        const expiries = await db.query(
            'SELECT DISTINCT expiry FROM option_chain_history WHERE UPPER(symbol) = UPPER(?)',
            [symbol]
        );
        
        res.json({
            success: true,
            requestedSymbol: symbol,
            allSymbolsInDB: allSymbols.map(r => r.symbol),
            symbolExists: symbolCheck,
            sampleData: sampleData,
            expiries: expiries,
            message: symbolCheck[0].count === 0 ? `Symbol "${symbol}" not found. Available symbols: ${allSymbols.map(r => r.symbol).join(', ')}` : 'Data found!'
        });
    } catch (err) {
        console.error('[Debug Data Error]', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. Test route
router.get('/test', (req, res) => {
    res.json({ 
        message: 'Option chain route is working!',
        timestamp: new Date().toISOString(),
        endpoints: {
            'GET /': 'Get option chain with query params (?symbol=NIFTY)',
            'GET /:symbol': 'Get option chain with path param (/nifty)',
            'GET /test': 'Test route',
            'GET /debug/db-check': 'Debug database connection',
            'GET /debug/data': 'Debug data for symbol'
        },
        tip: 'First run /debug/db-check to see what symbols exist in your database'
    });
});

// 3b. Contract price history — powers the "view chart" hover action on LTP cells
router.get('/:symbol/contract-history', async (req, res) => {
    try {
        const { symbol } = req.params;
        const { strike, expiry, right } = req.query;

        if (!strike || !expiry || !['CE', 'PE'].includes(right)) {
            return res.status(400).json({ error: 'strike, expiry, and right (CE|PE) are required' });
        }

        // expiry arrives as whatever the main chain response sent back (an ISO
        // datetime string, since the DATE column round-trips through JSON that
        // way) — match on the date part only, per Gotcha #12: no ambient Date parsing.
        const expiryDateOnly = new Date(expiry).toISOString().split('T')[0];
        const ltpCol = right === 'CE' ? 'ce_ltp' : 'pe_ltp';
        const oiCol = right === 'CE' ? 'ce_oi' : 'pe_oi';

        const rows = await db.query(
            `SELECT trade_date, trade_time, ${ltpCol} AS ltp, ${oiCol} AS oi
             FROM option_chain_history
             WHERE UPPER(symbol) = UPPER(?) AND DATE(expiry) = ? AND strike = ?
             ORDER BY trade_date ASC, trade_time ASC`,
            [symbol, expiryDateOnly, strike]
        );

        const points = rows
            .filter(r => r.ltp != null)
            .map(r => {
                const dateStr = new Date(r.trade_date).toISOString().split('T')[0];
                const [y, m, d] = dateStr.split('-').map(Number);
                const [hh, mm, ss] = r.trade_time.split(':').map(Number);
                return {
                    time: Math.floor(Date.UTC(y, m - 1, d, hh, mm, ss) / 1000),
                    value: parseFloat(r.ltp),
                    oi: r.oi != null ? parseInt(r.oi) : null,
                };
            });

        res.json({
            symbol: symbol.toUpperCase(),
            strike: parseFloat(strike),
            expiry: expiryDateOnly,
            right,
            points,
        });
    } catch (error) {
        console.error('[ContractHistory Error]', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
});

// ============================================
// MAIN ROUTES
// ============================================

// 4. GET /api/option-chain?symbol=NIFTY
router.get('/', async (req, res) => {
    try {
        const { symbol = 'NIFTY', expiry } = req.query;
        console.log(`[OptionChain] Fetching ${symbol} via query param`);
        
        const result = await getOptionChainData(symbol, expiry);
        res.json(result);
    } catch (error) {
        console.error('[OptionChain Error]', error);
        res.status(500).json({ 
            error: error.message || 'Internal Server Error',
            timestamp: new Date().toISOString()
        });
    }
});

// 5. GET /api/option-chain/nifty
router.get('/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol;
        const { expiry } = req.query;
        console.log(`[OptionChain] Fetching ${symbol} via path param`);
        
        const result = await getOptionChainData(symbol, expiry);
        res.json(result);
    } catch (error) {
        console.error('[OptionChain Error]', error);
        res.status(500).json({ 
            error: error.message || 'Internal Server Error',
            timestamp: new Date().toISOString()
        });
    }
});

// ============================================
// HELPER FUNCTION - Get Option Chain Data
// ============================================

async function getOptionChainData(symbol, expiry) {
    try {
        const cleanSymbol = symbol.trim();
        console.log(`[DEBUG] Looking for symbol: "${cleanSymbol}"`);
        
        // First, get all available symbols to help with debugging
        const allSymbols = await db.query(
            'SELECT DISTINCT symbol FROM option_chain_history'
        );
        console.log('[DEBUG] Available symbols:', allSymbols.map(r => r.symbol));
        
        // Try exact match first
        let symbolMatch = await db.query(
            'SELECT symbol FROM option_chain_history WHERE symbol = ? LIMIT 1',
            [cleanSymbol]
        );
        
        // If no exact match, try case insensitive
        if (!symbolMatch || symbolMatch.length === 0) {
            symbolMatch = await db.query(
                'SELECT symbol FROM option_chain_history WHERE UPPER(symbol) = UPPER(?) LIMIT 1',
                [cleanSymbol]
            );
        }
        
        // If still no match, try to find a similar symbol
        if (!symbolMatch || symbolMatch.length === 0) {
            // Try to find any symbol that contains the search term
            symbolMatch = await db.query(
                'SELECT symbol FROM option_chain_history WHERE UPPER(symbol) LIKE UPPER(?) LIMIT 1',
                [`%${cleanSymbol}%`]
            );
        }
        
        if (!symbolMatch || symbolMatch.length === 0) {
            console.log(`[DEBUG] Symbol "${cleanSymbol}" not found in database`);
            // Return a helpful error message with available symbols
            const availableSymbols = allSymbols.map(r => r.symbol).join(', ');
            const errorMsg = `Symbol "${cleanSymbol}" not found. Available symbols: ${availableSymbols}`;
            console.log(`[DEBUG] ${errorMsg}`);
            
            // Return sample data as fallback
            return generateSampleData(cleanSymbol, availableSymbols);
        }
        
        const actualSymbol = symbolMatch[0].symbol;
        console.log(`[DEBUG] Matched to: "${actualSymbol}"`);
        
        // Get latest snapshot with a real spot price. underlying_price is backfilled
        // from ohlcv_data by trade_date+trade_time (see cron.js's backfillUnderlyingPrice)
        // and can trail the option chain's own latest minute by one tick, so anchor
        // on the latest minute that actually has a spot price rather than the
        // latest minute overall — otherwise ATM/max-pain/PCR all silently break.
        const latestRows = await db.query(
            `SELECT trade_date, trade_time, underlying_price
             FROM option_chain_history
             WHERE symbol = ? AND underlying_price IS NOT NULL
             ORDER BY trade_date DESC, trade_time DESC
             LIMIT 1`,
            [actualSymbol]
        );
        
        if (!latestRows || latestRows.length === 0) {
            console.log(`[DEBUG] No snapshot data for ${actualSymbol}`);
            return generateSampleData(actualSymbol);
        }
        
        const { trade_date, trade_time, underlying_price } = latestRows[0];
        const spotPrice = parseFloat(underlying_price) || 0;
        const formattedDate = new Date(trade_date).toISOString().split('T')[0];
        
        console.log(`[DEBUG] Latest snapshot: ${formattedDate} ${trade_time}, Spot: ${spotPrice}`);
        
        // Get expiries
        let expiryRows = await db.query(
            `SELECT DISTINCT expiry FROM option_chain_history 
             WHERE symbol = ? AND trade_date = ? AND trade_time = ?
             ORDER BY expiry ASC`,
            [actualSymbol, formattedDate, trade_time]
        );
        
        if (!expiryRows || expiryRows.length === 0) {
            console.log('[DEBUG] No expiries with time, trying without...');
            expiryRows = await db.query(
                `SELECT DISTINCT expiry FROM option_chain_history 
                 WHERE symbol = ? AND trade_date = ?
                 ORDER BY expiry ASC`,
                [actualSymbol, formattedDate]
            );
        }
        
        if (!expiryRows || expiryRows.length === 0) {
            console.log('[DEBUG] No expiries found');
            return generateSampleData(actualSymbol);
        }
        
        const expiries = expiryRows.map(r => r.expiry);
        console.log(`[DEBUG] Found expiries: ${expiries.join(', ')}`);
        
        const selectedExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0];
        console.log(`[DEBUG] Selected expiry: ${selectedExpiry}`);
        
        // Get chain data — must scope to the latest snapshot (trade_date + trade_time),
        // otherwise this returns every historical row ever stored for this symbol/expiry
        // (147k+ rows once a few days are backfilled), and the O(n^2) max-pain loop below
        // then hangs the entire event loop.
        let chainRows = await db.query(
            `SELECT
                strike,
                ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                ce_delta, ce_gamma, ce_theta, ce_vega,
                pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                pe_delta, pe_gamma, pe_theta, pe_vega
             FROM option_chain_history
             WHERE symbol = ? AND expiry = ? AND trade_date = ? AND trade_time = ?
             ORDER BY strike ASC`,
            [actualSymbol, selectedExpiry, formattedDate, trade_time]
        );

        if (!chainRows || chainRows.length === 0) {
            console.log('[DEBUG] No data with trade_time, trying with trade_date only...');
            chainRows = await db.query(
                `SELECT
                    strike,
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                    ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                    pe_delta, pe_gamma, pe_theta, pe_vega
                 FROM option_chain_history
                 WHERE symbol = ? AND expiry = ? AND trade_date = ?
                 ORDER BY strike ASC
                 LIMIT 200`,
                [actualSymbol, selectedExpiry, formattedDate]
            );
        }
        
        if (!chainRows || chainRows.length === 0) {
            console.log('[DEBUG] No data with filters, getting any data for symbol...');
            chainRows = await db.query(
                `SELECT 
                    strike, 
                    ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                    ce_delta, ce_gamma, ce_theta, ce_vega,
                    pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume,
                    pe_delta, pe_gamma, pe_theta, pe_vega
                 FROM option_chain_history
                 WHERE symbol = ?
                 ORDER BY strike ASC
                 LIMIT 100`,
                [actualSymbol]
            );
        }
        
        if (!chainRows || chainRows.length === 0) {
            console.log(`[DEBUG] No chain data found for ${actualSymbol}`);
            return generateSampleData(actualSymbol);
        }
        
        console.log(`[DEBUG] Found ${chainRows.length} rows`);
        
        // Calculate totals
        let totalCallsOi = 0;
        let totalPutsOi = 0;
        let maxPainStrike = null;
        let minPainValue = Infinity;
        
        const rows = chainRows.map(row => {
            const strike = parseFloat(row.strike);
            const ceOi = parseInt(row.ce_oi) || 0;
            const peOi = parseInt(row.pe_oi) || 0;
            
            totalCallsOi += ceOi;
            totalPutsOi += peOi;
            
            let pain = 0;
            chainRows.forEach(innerRow => {
                const innerStrike = parseFloat(innerRow.strike);
                if (innerStrike < strike) {
                    pain += (strike - innerStrike) * (parseInt(innerRow.ce_oi) || 0);
                }
                if (innerStrike > strike) {
                    pain += (innerStrike - strike) * (parseInt(innerRow.pe_oi) || 0);
                }
            });
            
            if (pain < minPainValue) {
                minPainValue = pain;
                maxPainStrike = strike;
            }
            
            return {
                strike: strike,
                iv: parseFloat(row.ce_iv) || parseFloat(row.pe_iv) || null,
                ce: {
                    ltp: parseFloat(row.ce_ltp) || 0,
                    oi: ceOi,
                    oiChange: parseInt(row.ce_oi_change) || 0,
                    volume: parseInt(row.ce_volume) || 0,
                    delta: parseFloat(row.ce_delta) || null,
                    gamma: parseFloat(row.ce_gamma) || null,
                    theta: parseFloat(row.ce_theta) || null,
                    vega: parseFloat(row.ce_vega) || null,
                    buildup: null
                },
                pe: {
                    ltp: parseFloat(row.pe_ltp) || 0,
                    oi: peOi,
                    oiChange: parseInt(row.pe_oi_change) || 0,
                    volume: parseInt(row.pe_volume) || 0,
                    delta: parseFloat(row.pe_delta) || null,
                    gamma: parseFloat(row.pe_gamma) || null,
                    theta: parseFloat(row.pe_theta) || null,
                    vega: parseFloat(row.pe_vega) || null,
                    buildup: null
                }
            };
        });
        
        // Calculate ATM strike
        const strikes = rows.map(r => r.strike);
        let atmStrike = null;
        if (strikes.length > 0 && spotPrice > 0) {
            atmStrike = strikes.reduce((prev, curr) => 
                Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev
            );
        }
        
        const pcr = totalCallsOi > 0 ? parseFloat((totalPutsOi / totalCallsOi).toFixed(2)) : 0;
        
        let daysToExpiry = 0;
        try {
            const expiryDate = new Date(selectedExpiry);
            const tradeDateObj = new Date(formattedDate);
            daysToExpiry = Math.ceil((expiryDate - tradeDateObj) / (1000 * 60 * 60 * 24));
        } catch (e) {
            daysToExpiry = 0;
        }
        
        return {
            symbol: actualSymbol,
            spotPrice: spotPrice,
            atmStrike: atmStrike || 0,
            maxPainStrike: maxPainStrike || 0,
            pcr: pcr,
            selectedExpiry: selectedExpiry,
            daysToExpiry: Math.max(0, daysToExpiry),
            expiries: expiries,
            rows: rows,
            isHistorical: true,
            marketStatus: { 
                isOpen: false,
                timestamp: new Date().toISOString()
            },
            timestamp: `${formattedDate}T${trade_time || '00:00:00'}`
        };
        
    } catch (error) {
        console.error('[getOptionChainData Error]', error);
        return generateSampleData(symbol);
    }
}

// ============================================
// SAMPLE DATA GENERATOR (Fallback)
// ============================================

function generateSampleData(symbol, availableSymbols = '') {
    console.log(`[Sample] Generating sample data for ${symbol}`);
    const baseStrike = symbol === 'BANKNIFTY' ? 52000 : symbol === 'FINNIFTY' ? 20000 : 24200;
    const interval = symbol === 'BANKNIFTY' ? 100 : 50;
    const count = 16;
    const strikes = [];
    
    for (let i = 0; i < count; i++) {
        strikes.push(baseStrike + (i - Math.floor(count/2)) * interval);
    }
    
    const rows = strikes.map((strike) => {
        const distance = Math.abs(strike - baseStrike);
        return {
            strike: strike,
            iv: parseFloat((10 + Math.random() * 8).toFixed(1)),
            ce: {
                ltp: parseFloat((Math.max(0.5, distance * 0.12 + Math.random() * 20)).toFixed(2)),
                oi: Math.floor(Math.random() * 5000000 + 100000),
                oiChange: Math.floor(Math.random() * 100000 - 50000),
                volume: Math.floor(Math.random() * 1000000 + 10000),
                delta: parseFloat((0.1 + Math.random() * 0.8).toFixed(3)),
                gamma: parseFloat((0.0005 + Math.random() * 0.0015).toFixed(6)),
                theta: parseFloat((-(5 + Math.random() * 12)).toFixed(2)),
                vega: parseFloat((3 + Math.random() * 8).toFixed(2)),
                buildup: ['SC', 'LU', 'L', 'S'][Math.floor(Math.random() * 4)]
            },
            pe: {
                ltp: parseFloat((Math.max(0.5, distance * 0.10 + Math.random() * 15)).toFixed(2)),
                oi: Math.floor(Math.random() * 4000000 + 100000),
                oiChange: Math.floor(Math.random() * 100000 - 50000),
                volume: Math.floor(Math.random() * 1000000 + 10000),
                delta: parseFloat((-(0.1 + Math.random() * 0.8)).toFixed(3)),
                gamma: parseFloat((0.0005 + Math.random() * 0.0015).toFixed(6)),
                theta: parseFloat((-(5 + Math.random() * 12)).toFixed(2)),
                vega: parseFloat((3 + Math.random() * 8).toFixed(2)),
                buildup: ['SC', 'LU', 'L', 'S'][Math.floor(Math.random() * 4)]
            }
        };
    });
    
    return {
        symbol: symbol,
        spotPrice: baseStrike,
        atmStrike: baseStrike,
        maxPainStrike: baseStrike,
        pcr: 0.85,
        selectedExpiry: '2026-07-14',
        daysToExpiry: 3,
        expiries: ['2026-07-14', '2026-07-21', '2026-07-28'],
        rows: rows,
        isHistorical: true,
        marketStatus: { 
            isOpen: false,
            timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString(),
        _message: `Sample data - Symbol "${symbol}" not found. ${availableSymbols ? `Available symbols: ${availableSymbols}` : 'Please check your database'}`
    };
}

module.exports = router;