// lib/db.js — MySQL pool for the standalone data-downloader.
//
// Loads THIS folder's own .env (not the parent server/'s) so the downloader
// can run on its own / on another machine, pointed at the same database.
// dateStrings:true is mandatory — every date in this codebase is a plain
// 'YYYY-MM-DD' string (see lib/dates.js).

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "bazaar_sync",
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
    queueLimit: 0,
    enableKeepAlive: true,
    dateStrings: true,
});

async function checkConnection() {
    const conn = await pool.getConnection();
    try {
        await conn.ping();
        return true;
    } finally {
        conn.release();
    }
}

module.exports = { pool, checkConnection };
