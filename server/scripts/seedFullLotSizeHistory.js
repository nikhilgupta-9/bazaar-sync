// scripts/seedFullLotSizeHistory.js
// Authoritative historical lot sizes for Indian Indices & F&O contracts (2015 - 2026)
// Sources: NSE & BSE Official Circulars, StockMojo, Opstra, Sensibull archive.

require("dotenv").config({ path: "/Applications/XAMPP/xamppfiles/htdocs/bazaar-sync/server/.env" });
const { pool } = require("../config/db");

const HISTORICAL_REVISIONS = [
    // --- NIFTY 50 ---
    { symbol: "NIFTY", lot_size: 75, effective_from: "2015-10-30", effective_to: "2021-06-24" },
    { symbol: "NIFTY", lot_size: 50, effective_from: "2021-06-25", effective_to: "2024-04-25" },
    { symbol: "NIFTY", lot_size: 25, effective_from: "2024-04-26", effective_to: "2024-11-19" },
    { symbol: "NIFTY", lot_size: 75, effective_from: "2024-11-20", effective_to: "2025-10-27" },
    { symbol: "NIFTY", lot_size: 65, effective_from: "2025-10-28", effective_to: null },

    // --- BANKNIFTY ---
    { symbol: "BANKNIFTY", lot_size: 20, effective_from: "2016-07-01", effective_to: "2020-06-25" },
    { symbol: "BANKNIFTY", lot_size: 25, effective_from: "2020-06-26", effective_to: "2023-06-29" },
    { symbol: "BANKNIFTY", lot_size: 15, effective_from: "2023-06-30", effective_to: "2024-11-19" },
    { symbol: "BANKNIFTY", lot_size: 30, effective_from: "2024-11-20", effective_to: "2025-04-24" },
    { symbol: "BANKNIFTY", lot_size: 35, effective_from: "2025-04-25", effective_to: "2025-10-27" },
    { symbol: "BANKNIFTY", lot_size: 30, effective_from: "2025-10-28", effective_to: null },

    // --- FINNIFTY ---
    { symbol: "FINNIFTY", lot_size: 40, effective_from: "2021-01-11", effective_to: "2024-04-25" },
    { symbol: "FINNIFTY", lot_size: 25, effective_from: "2024-04-26", effective_to: "2024-11-19" },
    { symbol: "FINNIFTY", lot_size: 65, effective_from: "2024-11-20", effective_to: "2025-10-27" },
    { symbol: "FINNIFTY", lot_size: 60, effective_from: "2025-10-28", effective_to: null },

    // --- MIDCPNIFTY ---
    { symbol: "MIDCPNIFTY", lot_size: 75, effective_from: "2022-01-24", effective_to: "2024-04-25" },
    { symbol: "MIDCPNIFTY", lot_size: 50, effective_from: "2024-04-26", effective_to: "2024-11-19" },
    { symbol: "MIDCPNIFTY", lot_size: 120, effective_from: "2024-11-20", effective_to: "2025-04-24" },
    { symbol: "MIDCPNIFTY", lot_size: 140, effective_from: "2025-04-25", effective_to: "2025-10-27" },
    { symbol: "MIDCPNIFTY", lot_size: 120, effective_from: "2025-10-28", effective_to: null },

    // --- NIFTYNXT50 ---
    { symbol: "NIFTYNXT50", lot_size: 10, effective_from: "2024-04-26", effective_to: "2024-11-19" },
    { symbol: "NIFTYNXT50", lot_size: 25, effective_from: "2024-11-20", effective_to: null },

    // --- SENSEX (BSE) ---
    { symbol: "SENSEX", lot_size: 10, effective_from: "2023-05-15", effective_to: "2024-11-19" },
    { symbol: "SENSEX", lot_size: 20, effective_from: "2024-11-20", effective_to: null },

    // --- BANKEX (BSE) ---
    { symbol: "BANKEX", lot_size: 15, effective_from: "2023-05-15", effective_to: "2024-11-19" },
    { symbol: "BANKEX", lot_size: 30, effective_from: "2024-11-20", effective_to: null },

    // --- Major F&O Equities ---
    { symbol: "RELIANCE", lot_size: 250, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "HDFCBANK", lot_size: 550, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "INFY", lot_size: 300, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "TCS", lot_size: 175, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "ICICIBANK", lot_size: 700, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "SBIN", lot_size: 1500, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "TATASTEEL", lot_size: 5500, effective_from: "2022-07-29", effective_to: "2024-11-19" },
    { symbol: "BAJFINANCE", lot_size: 125, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "AXISBANK", lot_size: 625, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "LT", lot_size: 150, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "KOTAKBANK", lot_size: 400, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "MARUTI", lot_size: 100, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "TATAMOTORS", lot_size: 1425, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "BAJAJ-AUTO", lot_size: 125, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "BHARTIARTL", lot_size: 950, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "ASIANPAINT", lot_size: 200, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "TITAN", lot_size: 175, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "WIPRO", lot_size: 1500, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "SUNPHARMA", lot_size: 700, effective_from: "2020-10-30", effective_to: "2024-11-19" },
    { symbol: "HINDUNILVR", lot_size: 300, effective_from: "2020-10-30", effective_to: "2024-11-19" },
];

async function seed() {
    console.log("Seeding historical lot sizes...");
    for (const r of HISTORICAL_REVISIONS) {
        // Check if existing
        const [existing] = await pool.query(
            `SELECT id FROM lot_size_history WHERE symbol = ? AND effective_from = ?`,
            [r.symbol, r.effective_from]
        );
        if (existing.length) {
            await pool.query(
                `UPDATE lot_size_history SET lot_size = ?, effective_to = ? WHERE id = ?`,
                [r.lot_size, r.effective_to, existing[0].id]
            );
        } else {
            await pool.query(
                `INSERT INTO lot_size_history (symbol, lot_size, effective_from, effective_to) VALUES (?, ?, ?, ?)`,
                [r.symbol, r.lot_size, r.effective_from, r.effective_to]
            );
        }
    }
    console.log(`✅ Successfully seeded ${HISTORICAL_REVISIONS.length} historical lot size revision records.`);
    await pool.end();
}

seed().catch(err => {
    console.error("Seed error:", err);
    process.exit(1);
});
