// config/db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bazaar_sync',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    dateStrings: true,
});

/**
 * Execute a query and return rows
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} - Query results
 */
async function query(sql, params) {
    try {
        const [rows] = await pool.execute(sql, params);
        return rows; // Return just the rows, not the entire result
    } catch (err) {
        console.error('[Database] Query error:', err);
        console.error('[Database] SQL:', sql);
        console.error('[Database] Params:', params);
        throw err;
    }
}

/**
 * Get a connection from the pool
 */
async function getConnection() {
    return await pool.getConnection();
}

/**
 * Check database connection
 */
async function checkConnection() {
    try {
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('[Database] ✅ Connected successfully');
        return true;
    } catch (err) {
        console.error('[Database] ❌ Connection failed:', err.message);
        throw err;
    }
}

/**
 * Execute multiple queries in transaction
 */
async function transaction(callback) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
}

module.exports = {
    pool,
    query,
    getConnection,
    checkConnection,
    transaction,
};