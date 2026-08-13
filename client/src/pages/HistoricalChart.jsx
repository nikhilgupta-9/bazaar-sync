// pages/HistoricalChart.jsx — multi-day index/stock price chart, built from
// our own stored ohlcv_data (distinct from the intraday-only chart tabs in
// Strategy Builder). Reuses UnderlyingChart.jsx (already does the candlestick
// rendering + fetch) and the existing symbol-list endpoint — no new backend
// work needed, GET /:symbol/underlying-history already takes a days param.
import { useEffect, useState } from "react";
import { fetchSymbolList } from "../services/optionChainApi";
import UnderlyingChart from "../components/UnderlyingChart";

const DEFAULT_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

const RANGE_OPTIONS = [
    { label: "7D", days: 7 },
    { label: "1M", days: 30 },
    { label: "3M", days: 90 },
    { label: "6M", days: 180 },
    { label: "1Y", days: 365 },
];

export default function HistoricalChart() {
    const [symbolList, setSymbolList] = useState({ indices: DEFAULT_INDICES, stocks: [] });
    const [symbol, setSymbol] = useState("NIFTY");
    const [days, setDays] = useState(30);

    useEffect(() => {
        fetchSymbolList()
            .then((res) =>
                setSymbolList({
                    indices: res.indices?.length ? res.indices : DEFAULT_INDICES,
                    stocks: res.stocks || [],
                })
            )
            .catch(() => {
                /* keep the fallback index list — symbol picker still works */
            });
    }, []);

    return (
        <div className="mx-auto max-w-5xl px-5 py-6">
            <h1 className="text-lg font-bold text-gray-900">Historical Chart</h1>
            <p className="mt-1 text-xs text-gray-500">
                Multi-day price history from our own stored data — not a live feed.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-800 shadow-sm outline-none focus:border-blue-500"
                >
                    <optgroup label="Index">
                        {symbolList.indices.map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </optgroup>
                    {symbolList.stocks.length > 0 && (
                        <optgroup label="Stocks">
                            {symbolList.stocks.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </optgroup>
                    )}
                </select>

                <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
                    {RANGE_OPTIONS.map((r) => (
                        <button
                            key={r.label}
                            onClick={() => setDays(r.days)}
                            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                                days === r.days
                                    ? "bg-blue-600 text-white"
                                    : "text-gray-500 hover:bg-gray-100"
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <UnderlyingChart symbol={symbol} days={days} />
            </div>
        </div>
    );
}
