// data/tools.js — the tool catalog shared between Home.jsx's grid and Footer.jsx's link list
export const TOOLS = [
    { to: "/strategy-builder", title: "Strategy Builder", image: "/images/hero_3d.jpg", icon: "strategy", desc: "Multi-leg strategy builder with real-time Black-Scholes Greeks, dynamic payoff curve, and trade adjustments." },
    { to: "/simulator", title: "Option Backtester", image: "/images/analytics_3d.jpg", icon: "backtest", desc: "Minute-by-minute historical tick replay with full multi-strike option chains, contract charts, and real execution." },
    { to: "/option-chain", title: "Live Option Chain Matrix", image: "/images/hero_3d.jpg", icon: "chain", desc: "High-density matrix with live LTP, PCR, Max Pain, Open Interest change, and IV skew." },
    { to: "/equity-data", title: "Equity Data & Market Map", image: "/images/analytics_3d.jpg", icon: "equitydata", desc: "Real-time sector heatmaps, 52-week high/low scanners, industry momentum leaderboards, and active volumes." },
    { to: "/historical-chart", title: "Historical Contract Charts", image: "/images/hero_3d.jpg", icon: "historicalchart", desc: "1-min to daily database-driven candlestick charts with multi-timeframes and complete technical drawing tools." },
    { to: "/paper-trade", title: "Virtual Paper Trading", image: "/images/analytics_3d.jpg", icon: "papertrade", desc: "Forward paper trade execution with ₹50,000 virtual margin, real-time MTM, and position analytics." },
];

export const POPULAR = ["/strategy-builder", "/simulator", "/option-chain", "/equity-data", "/historical-chart", "/paper-trade"];
