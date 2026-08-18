// data/tools.js — the tool catalog shared between Home.jsx's grid and
// Footer.jsx's link list, so the two can never drift out of sync with each
// other (previously this array only lived inline in Home.jsx).
export const TOOLS = [
    { to: "/option-chain", title: "Option Chain", image: "/images/oi.png", desc: "Full chain with OI, buildup, Greeks" },
    { to: "/strategy-builder", title: "Strategy Builder", icon: "strategy", desc: "Multi-leg payoff + live Greeks" },
    { to: "/simulator", title: "Simulator", icon: "backtest", desc: "Replay a real past day minute by minute" },
    { to: "/paper-trade", title: "Paper Trade", icon: "papertrade", desc: "Trade virtual capital on real historical data" },
    { to: "/historical-chart", title: "Historical Chart", icon: "historicalchart", desc: "Multi-day historical price charts" },
    { to: "/equity-data", title: "Equity Data", icon: "equitydata", desc: "Sector rotation, market map, 52W high/low & more" },
];

export const POPULAR = ["/option-chain", "/strategy-builder", "/paper-trade", "/simulator", "/historical-chart"];
