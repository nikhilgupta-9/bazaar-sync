import { useEffect, useMemo, useRef, useState } from "react";
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useOptionChain } from "../hooks/useOptionChain";
import SettingsSidebar from "../components/SettingsSidebar";
import { formatPrice, formatOi } from "../utils/format";

const POLL_MS = 15000;
const MAX_POINTS = 200; // cap memory for a long-running session

export default function PutCallRatio() {
    const { symbol, setSymbol, data, error, load } = useOptionChain();
    const [history, setHistory] = useState([]);
    const expiryRef = useRef(null);

    // New symbol/expiry starts a fresh trend line rather than mixing series.
    function handleSymbolChange(sym) {
        setHistory([]);
        setSymbol(sym);
    }
    function handleExpiryChange(exp) {
        setHistory([]);
        load(symbol, exp);
    }

    useEffect(() => {
        if (!data) return;
        if (expiryRef.current && expiryRef.current !== data.selectedExpiry) setHistory([]);
        expiryRef.current = data.selectedExpiry;

        const totalCeOi = data.rows.reduce((s, r) => s + (r.ce.oi || 0), 0);
        const totalPeOi = data.rows.reduce((s, r) => s + (r.pe.oi || 0), 0);
        const point = {
            time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            pcr: data.pcr,
            spot: data.spotPrice,
            totalCeOi,
            totalPeOi,
        };
        setHistory((prev) => [...prev, point].slice(-MAX_POINTS));
    }, [data]);

    useEffect(() => {
        const id = setInterval(() => load(symbol, expiryRef.current), POLL_MS);
        return () => clearInterval(id);
    }, [symbol, load]);

    const latest = history[history.length - 1];

    return (
        <div className="mx-auto flex max-w-[1400px] gap-4 px-4 py-4">
            <SettingsSidebar
                symbol={symbol}
                onSymbolChange={handleSymbolChange}
                expiries={data?.expiries}
                selectedExpiry={data?.selectedExpiry}
                onExpiryChange={handleExpiryChange}
            />

            <div className="flex-1">
                <div className="mb-3 rounded-lg border border-gray-200 bg-white px-5 py-4">
                    <h1 className="text-base font-semibold text-gray-900">Put-Call Ratio</h1>
                    <p className="mt-1 text-xs text-gray-500">
                        Live, polled every {POLL_MS / 1000}s — this trend accumulates from when you opened this page,
                        it isn't full trading-day history (we don't store intraday snapshots yet).
                    </p>
                    {latest && (
                        <div className="mt-2 flex gap-8 text-sm">
                            <div>
                                <div className="text-gray-500">Current PCR</div>
                                <div className="text-lg font-bold text-blue-600 tabular-nums">{latest.pcr}</div>
                            </div>
                            <div>
                                <div className="text-gray-500">Spot</div>
                                <div className="text-lg font-semibold tabular-nums">{formatPrice(latest.spot)}</div>
                            </div>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {error}
                    </div>
                )}

                {history.length < 2 && !error && (
                    <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
                        Collecting data points… the trend line needs at least two samples.
                    </div>
                )}

                {history.length >= 2 && (
                    <>
                        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-4">
                            <h2 className="mb-2 text-xs font-semibold text-gray-600">PCR vs Spot Price</h2>
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={history}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                                    <YAxis yAxisId="spot" tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={70} />
                                    <YAxis yAxisId="pcr" orientation="right" tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={50} />
                                    <Tooltip />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Line yAxisId="spot" type="monotone" dataKey="spot" name="Spot" stroke="#9ca3af" strokeDasharray="4 4" dot={false} />
                                    <Line yAxisId="pcr" type="monotone" dataKey="pcr" name="PCR" stroke="#2563eb" dot={false} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white p-4">
                            <h2 className="mb-2 text-xs font-semibold text-gray-600">Total OI (Call vs Put)</h2>
                            <ResponsiveContainer width="100%" height={260}>
                                <LineChart data={history}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatOi(v)} width={70} />
                                    <Tooltip formatter={(v) => formatOi(v)} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Line type="monotone" dataKey="totalCeOi" name="Call OI" stroke="#10b981" dot={false} strokeWidth={2} />
                                    <Line type="monotone" dataKey="totalPeOi" name="Put OI" stroke="#f43f5e" dot={false} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
