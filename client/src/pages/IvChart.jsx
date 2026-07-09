import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from "recharts";
import { useOptionChain } from "../hooks/useOptionChain";
import SettingsSidebar from "../components/SettingsSidebar";

const POLL_MS = 15000;
const MAX_POINTS = 200;

export default function IvChart() {
    const { symbol, setSymbol, data, error, load } = useOptionChain();
    const [strikeRange, setStrikeRange] = useState(10);
    const [history, setHistory] = useState([]);
    const expiryRef = useRef(null);

    function handleSymbolChange(sym) {
        setHistory([]);
        setSymbol(sym);
    }
    function handleExpiryChange(exp) {
        setHistory([]);
        load(symbol, exp);
    }

    const atmIv = useMemo(() => {
        if (!data) return null;
        const atmRow = data.rows.find((r) => r.strike === data.atmStrike);
        return atmRow?.iv ?? null;
    }, [data]);

    const smileRows = useMemo(() => {
        if (!data) return [];
        const strikeGap = data.rows[1]?.strike - data.rows[0]?.strike || 50;
        const rows = strikeRange
            ? data.rows.filter((r) => Math.abs(r.strike - data.atmStrike) <= strikeRange * strikeGap)
            : data.rows;
        return rows.map((r) => ({ strike: r.strike, iv: r.iv }));
    }, [data, strikeRange]);

    useEffect(() => {
        if (!data || atmIv == null) return;
        if (expiryRef.current && expiryRef.current !== data.selectedExpiry) setHistory([]);
        expiryRef.current = data.selectedExpiry;

        const point = {
            time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            atmIv,
        };
        setHistory((prev) => [...prev, point].slice(-MAX_POINTS));
    }, [data, atmIv]);

    useEffect(() => {
        const id = setInterval(() => load(symbol, expiryRef.current), POLL_MS);
        return () => clearInterval(id);
    }, [symbol, load]);

    return (
        <div className="mx-auto flex max-w-[1400px] gap-4 px-4 py-4">
            <SettingsSidebar
                symbol={symbol}
                onSymbolChange={handleSymbolChange}
                expiries={data?.expiries}
                selectedExpiry={data?.selectedExpiry}
                onExpiryChange={handleExpiryChange}
                strikeRange={strikeRange}
                onStrikeRangeChange={setStrikeRange}
            />

            <div className="flex-1">
                <div className="mb-3 rounded-lg border border-gray-200 bg-white px-5 py-4">
                    <h1 className="text-base font-semibold text-gray-900">IV Chart</h1>
                    <p className="mt-1 text-xs text-gray-500">
                        IV is computed here via Black-Scholes (Breeze provides none) from live LTP + spot + time-to-expiry.
                        IV Percentile Rank isn't shown — it needs a historical IV time series we don't store yet (our
                        nightly cron persists OHLC/OI, not computed Greeks); adding that is a separate task.
                    </p>
                    {atmIv != null && (
                        <div className="mt-2 text-sm">
                            <span className="text-gray-500">ATM IV ({data.atmStrike}) </span>
                            <span className="text-lg font-bold text-blue-600 tabular-nums">{atmIv}%</span>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                    </div>
                )}

                {data && (
                    <div className="mb-3 rounded-lg border border-gray-200 bg-white p-4">
                        <h2 className="mb-2 text-xs font-semibold text-gray-600">IV Smile (current chain, by strike)</h2>
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={smileRows}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="strike" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} unit="%" width={50} />
                                <Tooltip formatter={(v) => `${v}%`} labelFormatter={(l) => `Strike ${l}`} />
                                <ReferenceLine x={data.atmStrike} stroke="#2563eb" strokeDasharray="4 4" label={{ value: "ATM", fontSize: 10, fill: "#2563eb" }} />
                                <Line type="monotone" dataKey="iv" name="IV" stroke="#7c3aed" dot={false} strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {history.length >= 2 && (
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <h2 className="mb-2 text-xs font-semibold text-gray-600">
                            ATM IV Trend (since page opened — not full-day history)
                        </h2>
                        <ResponsiveContainer width="100%" height={260}>
                            <LineChart data={history}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 11 }} unit="%" width={50} domain={["auto", "auto"]} />
                                <Tooltip formatter={(v) => `${v}%`} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Line type="monotone" dataKey="atmIv" name="ATM IV" stroke="#2563eb" dot={false} strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
