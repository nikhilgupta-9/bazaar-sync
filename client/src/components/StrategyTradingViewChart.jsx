// components/StrategyTradingViewChart.jsx
//
// Strategy Builder's "Strategy Chart" / "NIFTY Chart" / "Strategy Chart +
// NIFTY Chart" tabs on the local TradingView Charting Library
// (client/public/charting_library) — full drawing toolbar, indicators,
// timeframes and screenshot on every tab.
//
//   mode="nifty"    — the underlying's own candles (real index minute bars).
//   mode="strategy" — the strategy's running P&L in ₹ as a line, built from
//                     every leg's REAL stored option bars (lib/tvDatafeed.js
//                     registerStrategy) — not a Black-Scholes estimate.
//   mode="combined" — strategy P&L with the underlying overlaid (Compare).
//
// Editing the legs re-registers the strategy under a new ticker; the chart
// switches symbol in place, so drawings and indicators survive.
import { useMemo } from "react";
import TradingViewChart from "./TradingViewChart";
import { registerStrategy } from "../lib/tvDatafeed";

export default function StrategyTradingViewChart({ symbol, legs, mode = "strategy", height = 460 }) {
    const strategyTicker = useMemo(() => (mode === "nifty" ? null : registerStrategy(symbol, legs)), [symbol, legs, mode]);

    if (mode !== "nifty" && !strategyTicker) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface-muted py-16 text-center" style={{ minHeight: height }}>
                <div className="text-sm font-bold text-fg">No strategy yet</div>
                <div className="mt-1 max-w-xs text-xs text-fg-muted">Add a leg from the option chain — its real running P&amp;L will chart here, on the full TradingView terminal.</div>
            </div>
        );
    }

    return (
        <div className="w-full overflow-hidden rounded-xl border border-line" style={{ height }}>
            {mode === "nifty" ? (
                <TradingViewChart key={`nifty-${symbol}`} symbol={symbol} interval="1" height="100%" />
            ) : (
                <TradingViewChart
                    // remount only when switching between plain and combined view; leg edits switch symbol in place
                    key={`strategy-${mode}`}
                    symbol={strategyTicker}
                    interval="1"
                    chartStyle="2"
                    compareSymbol={mode === "combined" ? symbol : null}
                    height="100%"
                />
            )}
            <p className="sr-only">
                {mode === "nifty" ? `${symbol} chart` : "Strategy P&L built from each leg's stored option prices; a leg with no trade in a minute carries its last price."}
            </p>
        </div>
    );
}
