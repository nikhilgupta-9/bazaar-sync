// server.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { checkConnection } = require("./config/db");
const cronService = require("./services/cron");
const optionChainRoutes = require("./routes/optionChain");
const backtestRoutes = require("./routes/backtest");
const authRoutes = require("./routes/auth");
const strategyRoutes = require("./routes/strategies");

const app = express();

// Enhanced CORS configuration
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Health check endpoint
app.get("/health", async (req, res) => {
    try {
        await checkConnection();
        res.json({ 
            status: "ok", 
            database: "connected",
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Health] Database error:', err);
        res.status(500).json({ 
            status: "error", 
            database: "disconnected", 
            message: err.message 
        });
    }
});
    
// API Routes
app.use("/api/option-chain", optionChainRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/strategies", strategyRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('[Global Error]', err);
    res.status(500).json({ 
        error: err.message || 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 5001;

// Start server with proper error handling
const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/health`);
    console.log(`📍 API base: http://localhost:${PORT}/api`);
    cronService.start();
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Please free it up or use a different port.`);
    } else {
        console.error('❌ Server error:', err);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        cronService.stop();
    });
});

module.exports = app;