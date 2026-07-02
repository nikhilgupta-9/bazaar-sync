const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true,
});

async function checkConnection() {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
}

module.exports = { pool, checkConnection };
