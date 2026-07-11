const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Your MySQL pool/connection

router.get('/api/option-chain', async (req, res) => {
    try {
        const { symbol = 'NIFTY', expiry } = req.query;

        // 1. Get the most recent trade_date and trade_time snapshot for this symbol
        const [latestSnapshot] = await db.query(
            `SELECT trade_date, trade_time, underlying_price 
             FROM option_chain_history 
             WHERE symbol = ? 
             ORDER BY trade_date DESC, trade_time DESC LIMIT 1`,
            [symbol]
        );

        if (!latestSnapshot || latestSnapshot.length === 0) {
            return res.status(404).json({ error: "No data found for this symbol" });
        }

        const { trade_date, trade_time, underlying_price: spotPrice } = latestSnapshot[0];

        // 2. Get all unique expiries available in this snapshot to populate the dropdown
        const [expiryRows] = await db.query(
            `SELECT DISTINCT expiry FROM option_chain_history 
             WHERE symbol = ? AND trade_date = ? AND trade_time = ? 
             ORDER BY expiry ASC`,
            [symbol, trade_date, trade_time]
        );
        const expiries = expiryRows.map(r => r.expiry);

        // Use requested expiry, or default to the closest upcoming one
        const selectedExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0];

        // 3. Fetch all strikes for the chosen symbol, snapshot time, and expiry
        const [chainRows] = await db.query(
            `SELECT 
                strike, ce_ltp, ce_oi, ce_oi_change, ce_iv, ce_volume,
                pe_ltp, pe_oi, pe_oi_change, pe_iv, pe_volume
             FROM option_chain_history
             WHERE symbol = ? AND trade_date = ? AND trade_time = ? AND expiry = ?
             ORDER BY strike ASC`,
            [symbol, trade_date, trade_time, selectedExpiry]
        );

        // 4. Calculate PCR (Put-Call Ratio) and Max Pain
        let totalCallsOi = 0;
        let totalPutsOi = 0;
        let maxPainStrike = null;
        let minPainValue = Infinity;

        // Map database records into rows the component reads cleanly
        const rows = chainRows.map(row => {
            totalCallsOi += (row.ce_oi || 0);
            totalPutsOi += (row.pe_oi || 0);

            // Simple Max Pain Math (Total cash loss for option buyers at each strike)
            let currentStrikePain = 0;
            chainRows.forEach(innerRow => {
                // Call buyers loss if market expires at 'row.strike'
                if (innerRow.strike < row.strike) {
                    currentStrikePain += (row.strike - innerRow.strike) * (innerRow.ce_oi || 0);
                }
                // Put buyers loss if market expires at 'row.strike'
                if (innerRow.strike > row.strike) {
                    currentStrikePain += (innerRow.strike - row.strike) * (innerRow.pe_oi || 0);
                }
            });

            if (currentStrikePain < minPainValue) {
                minPainValue = currentStrikePain;
                maxPainStrike = row.strike;
            }

            // Determine dynamic buildup text (Stock Mojo rules based on Price & OI change)
            const getBuildup = (oiChg, ltp) => {
                if (!oiChg || !ltp) return null;
                // You can add your delta price calculations here to return 'SC', 'LU', 'L', or 'S'
                return null; 
            };

            return {
                strike: parseFloat(row.strike),
                iv: row.ce_iv || row.pe_iv || null,
                ce: {
                    ltp: parseFloat(row.ce_ltp) || 0,
                    oi: parseInt(row.ce_oi) || 0,
                    oiChange: parseInt(row.ce_oi_change) || 0,
                    volume: parseInt(row.ce_volume) || 0,
                    buildup: getBuildup(row.ce_oi_change, row.ce_ltp)
                },
                pe: {
                    ltp: parseFloat(row.pe_ltp) || 0,
                    oi: parseInt(row.pe_oi) || 0,
                    oiChange: parseInt(row.pe_oi_change) || 0,
                    volume: parseInt(row.pe_volume) || 0,
                    buildup: getBuildup(row.pe_oi_change, row.pe_ltp)
                }
            };
        });

        // 5. Round to nearest ATM strike mapping
        const strikeInterval = symbol === 'NIFTY' ? 50 : 100;
        const atmStrike = Math.round(spotPrice / strikeInterval) * strikeInterval;
        const pcr = totalCallsOi > 0 ? parseFloat((totalPutsOi / totalCallsOi).toFixed(2)) : 0;

        // Days to expiry calculation
        const daysToExpiry = Math.ceil((new Date(selectedExpiry) - new Date(trade_date)) / (1000 * 60 * 60 * 24));

        res.json({
            spotPrice: parseFloat(spotPrice),
            atmStrike,
            maxPainStrike,
            pcr,
            selectedExpiry,
            daysToExpiry,
            expiries,
            rows,
            marketStatus: { isOpen: false }, // Wire up real market hour flags here
            timestamp: `${trade_date}T${trade_time}`
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = router;