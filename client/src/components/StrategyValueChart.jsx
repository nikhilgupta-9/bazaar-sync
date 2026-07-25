// components/StrategyValueChart.jsx
import { useEffect, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { formatPrice } from "../utils/format";

const SAMPLE_MS = 15000; // one trend point per 15s (live frames arrive ~1/s)
const MAX_POINTS = 200;

/**
 * "Strategy Chart" tab — no persisted intraday P&L series exists anywhere in
 * this app (only end-of-day rows), so this is the same session-only,
 * client-sampled pattern StraddleChart.jsx/PutCallRatio.jsx already use for
 * the same limitation: the combined live P&L of the position, sampled every
 * 15s from when the position was built, not a historical chart.
 */
export default function StrategyValueChart({ totalPnl, resetKey }) {
    const [history, setHistory] = useState([]);
    const lastPointAtRef = useRef(0);
    const resetKeyRef = useRef(resetKey);

    useEffect(() => {
        if (resetKeyRef.current !== resetKey) {
            resetKeyRef.current = resetKey;
            setHistory([]);
            lastPointAtRef.current = 0;
        }
    }, [resetKey]);

    useEffect(() => {
        if (totalPnl == null) return;
        if (Date.now() - lastPointAtRef.current < SAMPLE_MS) return;
        lastPointAtRef.current = Date.now();

        const point = {
            time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            pnl: totalPnl,
        };
        setHistory((prev) => [...prev, point].slice(-MAX_POINTS));
    }, [totalPnl]);

    if (history.length < 2) {
        return (
            <div className="p-16 text-center text-xs text-gray-400">
                Collecting data points… the session P&L trend needs at least two samples (~{SAMPLE_MS / 1000}s apart).
            </div>
        );
    }

    return (
        <div>
            <ResponsiveContainer width="100%" height={340}>
                <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} width={70} tickFormatter={(v) => formatPrice(v)} />
                    <Tooltip formatter={(v) => formatPrice(v)} />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    <Line type="monotone" dataKey="pnl" name="Live Strategy P&L" stroke="#2563eb" strokeWidth={2} dot={false} />
                </LineChart>
            </ResponsiveContainer>
            <div className="mt-1 text-[10px] text-gray-400">
                Session-only: combined live P&L of all legs, sampled every {SAMPLE_MS / 1000}s since this position was
                built — not persisted across reloads.
            </div>
        </div>
    );
}
