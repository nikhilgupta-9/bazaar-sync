import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useOptionChain } from "../hooks/useOptionChain";
import SettingsSidebar from "../components/SettingsSidebar";
import { formatPrice } from "../utils/format";

const SAMPLE_MS = 15000; // one trend point per 15s (live frames arrive ~1/s)
const MAX_POINTS = 200;

export default function StraddleChart() {
    // Live updates arrive through the shared hook's socket.io feed (with a
    // slow REST fallback when the market's closed) — no page-level polling.
    const { symbol, setSymbol, data, error, load } = useOptionChain();
    const [history, setHistory] = useState([]);
    const expiryRef = useRef(null);
    const lastPointAtRef = useRef(0);

    function handleSymbolChange(sym) {
        setHistory([]);
        lastPointAtRef.current = 0;
        setSymbol(sym);
    }
    function handleExpiryChange(exp) {
        setHistory([]);
        lastPointAtRef.current = 0;
        load(symbol, exp);
    }

    const straddle = useMemo(() => {
        if (!data) return null;
        const atmRow = data.rows.find((r) => r.strike === data.atmStrike);
        if (!atmRow || atmRow.ce.ltp == null || atmRow.pe.ltp == null) return null;
        return atmRow.ce.ltp + atmRow.pe.ltp;
    }, [data]);

    useEffect(() => {
        if (!data || straddle == null) return;
        if (expiryRef.current && expiryRef.current !== data.selectedExpiry) {
            setHistory([]);
            lastPointAtRef.current = 0;
        }
        expiryRef.current = data.selectedExpiry;

        if (Date.now() - lastPointAtRef.current < SAMPLE_MS) return;
        lastPointAtRef.current = Date.now();

        const point = {
            time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            straddle,
            spot: data.spotPrice,
        };
        setHistory((prev) => [...prev, point].slice(-MAX_POINTS));
    }, [data, straddle]);

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
                    <h1 className="text-base font-semibold text-gray-900">Straddle Chart</h1>
                    <p className="mt-1 text-xs text-gray-500">
                        ATM straddle cost (Call LTP + Put LTP at the ATM strike) vs underlying price, live via socket
                        push, sampled every {SAMPLE_MS / 1000}s — accumulates from when you opened this page.
                    </p>
                    {straddle != null && (
                        <div className="mt-2 flex gap-8 text-sm">
                            <div>
                                <div className="text-gray-500">ATM Straddle ({data.atmStrike})</div>
                                <div className="text-lg font-bold text-purple-600 tabular-nums">{formatPrice(straddle)}</div>
                            </div>
                            <div>
                                <div className="text-gray-500">Spot</div>
                                <div className="text-lg font-semibold tabular-nums">{formatPrice(data.spotPrice)}</div>
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
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <ResponsiveContainer width="100%" height={340}>
                            <LineChart data={history}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                                <YAxis yAxisId="spot" tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={70} />
                                <YAxis yAxisId="straddle" orientation="right" tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={60} />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Line yAxisId="spot" type="monotone" dataKey="spot" name="Spot" stroke="#9ca3af" strokeDasharray="4 4" dot={false} />
                                <Line yAxisId="straddle" type="monotone" dataKey="straddle" name="ATM Straddle" stroke="#7c3aed" dot={false} strokeWidth={2} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>
        </div>
    );
}
