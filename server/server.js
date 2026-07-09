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

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.json({ message: "Server is running" });
});

app.get("/health", async (req, res) => {
    try {
        await checkConnection();
        res.json({ status: "ok", database: "connected" });
    } catch (err) {
        res.status(500).json({ status: "error", database: "disconnected", message: err.message });
    }
});

app.use("/api/option-chain", optionChainRoutes);
app.use("/api/backtest", backtestRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/strategies", strategyRoutes);

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    cronService.start();
});