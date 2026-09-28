import React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeLiveTicks } from "../services/liveSocket";
import { formatPrice, formatPercent } from "../utils/format";
import { SymbolLogo } from "../utils/symbolIcons";

const DEFAULT_INDICES = [
    { symbol: "NIFTY", name: "NIFTY 50", price: 24850.50, change: 84.20, pChange: 0.34 },
    { symbol: "BANKNIFTY", name: "BANK NIFTY", price: 52140.80, change: -120.40, pChange: -0.23 },
    { symbol: "FINNIFTY", name: "FIN NIFTY", price: 23620.10, change: 45.60, pChange: 0.19 },
    { symbol: "INDIAVIX", name: "INDIA VIX", price: 13.45, change: -0.35, pChange: -2.54 },
];

export default function MarketTickerBar() {
    const [indices, setIndices] = useState(DEFAULT_INDICES);

    useEffect(() => {
        const unsubs = ["NIFTY", "BANKNIFTY", "FINNIFTY"].map((sym) =>
            subscribeLiveTicks(sym, (frame) => {
                if (!frame) return;
                setIndices((prev) =>
                    prev.map((item) => {
                        if (item.symbol === sym && frame.spotPrice != null) {
                            const prevPrice = item.price || frame.spotPrice;
                            const diff = frame.spotPrice - prevPrice;
                            return {
                                ...item,
                                price: frame.spotPrice,
                                change: diff !== 0 ? diff : item.change,
                                pChange: diff !== 0 && prevPrice > 0 ? (diff / prevPrice) * 100 : item.pChange,
                            };
                        }
                        if (item.symbol === "INDIAVIX" && frame.vix != null) {
                            return {
                                ...item,
                                price: frame.vix,
                            };
                        }
                        return item;
                    })
                );
            })
        );

        return () => {
            unsubs.forEach((unsub) => unsub && unsub());
        };
    }, []);

    return (
        <div className="bg-gray-900 text-gray-200 text-xs py-1.5 px-4 border-b border-gray-800 overflow-x-auto no-scrollbar select-none">
            <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-6">
                <div className="flex items-center gap-6 shrink-0">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-gray-400 uppercase">
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Market Pulse
                    </span>
                    <div className="flex items-center gap-6">
                        {indices.map((idx) => {
                            const isPositive = idx.change >= 0;
                            const isVix = idx.symbol === "INDIAVIX";
                            return (
                                <Link
                                    key={idx.symbol}
                                    to={isVix ? "/option-chain/nifty" : `/option-chain/${idx.symbol.toLowerCase()}`}
                                    className="flex items-center gap-2 hover:text-white transition-colors group"
                                >
                                    <SymbolLogo symbol={idx.symbol} size="xs" />
                                    <span className="font-medium text-gray-300 group-hover:text-emerald-400">{idx.name}</span>
                                    <span className="font-semibold tabular-nums text-white font-mono">{formatPrice(idx.price)}</span>
                                    <span
                                        className={`flex items-center text-[11px] tabular-nums font-medium font-mono ${
                                            isPositive ? "text-emerald-400" : "text-rose-400"
                                        }`}
                                    >
                                        {isPositive ? "+" : ""}{idx.change != null ? idx.change.toFixed(2) : "0.00"} ({formatPercent(idx.pChange)})
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                <div className="hidden lg:flex items-center gap-4 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1">
                        <span className="text-gray-500">Live Feed:</span>
                        <span className="text-emerald-400 font-medium">SmartAPI WS 2.0</span>
                    </span>
                    <span className="text-gray-700">|</span>
                    <Link to="/pricing" className="text-amber-400 hover:text-amber-300 font-medium">
                        ✦ Upgrade to Pro
                    </Link>
                </div>
            </div>
        </div>
    );
}
