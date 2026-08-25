import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceDot, ResponsiveContainer } from "recharts";
import { formatPrice } from "../utils/format";

// Linear-interpolated value of a curve series at an arbitrary price — same
// precision convention as payoff.js's computeBreakevens (only as accurate as
// the curve's sample spacing, fine for a chart marker). Returns null past
// the sampled range's edges or where the series itself is null (e.g. no IV
// snapshot for the "today" curve).
function interpolateAt(curve, price, key) {
    if (!curve.length || price == null) return null;
    if (price <= curve[0].price) return curve[0][key];
    const last = curve[curve.length - 1];
    if (price >= last.price) return last[key];
    for (let i = 1; i < curve.length; i++) {
        if (curve[i].price >= price) {
            const a = curve[i - 1], b = curve[i];
            if (a[key] == null || b[key] == null) return null;
            const t = a.price === b.price ? 0 : (price - a.price) / (b.price - a.price);
            return a[key] + t * (b[key] - a[key]);
        }
    }
    return null;
}

// Shows two curves, matching stockmojo's Strategy Builder: a solid "Expiry"
// line (intrinsic value only, hard kinks at strikes) and a dashed "Today"
// line (Black-Scholes mark-to-market with remaining time value, smooth near
// the money) — plus ±1SD/±2SD expected-move reference lines based on ATM IV,
// and a marker dot on each curve at the current spot price so "where do I
// stand right now" is a glance, not a mental interpolation off the axis.
export default function PayoffChart({ curve, spotPrice, breakevens, expectedMove }) {
    if (!curve.length) {
        return (
            <div className="p-16 text-center text-xs text-gray-400">
                Add a leg from the option chain to see the payoff chart.
            </div>
        );
    }

    const max = Math.max(...curve.map((p) => p.pnl));
    const min = Math.min(...curve.map((p) => p.pnl));
    // Gradient offset placed exactly at pnl=0 so the fill is green above the
    // zero line and red below it, regardless of how skewed the range is.
    const zeroOffset = max <= 0 ? 0 : min >= 0 ? 1 : max / (max - min);

    const hasToday = curve.some((p) => p.todayPnl != null);
    const spotExpiryPnl = spotPrice ? interpolateAt(curve, spotPrice, "pnl") : null;
    const spotTodayPnl = spotPrice && hasToday ? interpolateAt(curve, spotPrice, "todayPnl") : null;

    return (
        <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={curve}>
                <defs>
                    <linearGradient id="payoffGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={0} stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset={zeroOffset} stopColor="#10b981" stopOpacity={0.05} />
                        <stop offset={zeroOffset} stopColor="#f43f5e" stopOpacity={0.05} />
                        <stop offset={1} stopColor="#f43f5e" stopOpacity={0.35} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                {/* type="number" is required — otherwise this defaults to a
                    category axis, and ReferenceLine's x prop can only land on
                    an exact sampled data point (this is why breakeven/SD
                    reference lines silently failed to render: their computed
                    values never exactly matched one of the curve's sample
                    points, unlike Spot which coincidentally did). */}
                <XAxis dataKey="price" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 11 }} tickFormatter={(v) => formatPrice(v)} />
                <YAxis tick={{ fontSize: 11 }} width={60} />
                <Tooltip formatter={(v) => formatPrice(v)} labelFormatter={(l) => `Price ${formatPrice(l)}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#9ca3af" />

                {spotPrice && <ReferenceLine x={spotPrice} stroke="#2563eb" strokeDasharray="4 4" label={{ value: "Spot", fontSize: 10, fill: "#2563eb" }} />}
                {breakevens.map((be) => (
                    <ReferenceLine key={be} x={be} stroke="#a855f7" strokeDasharray="2 2" label={{ value: "BE", fontSize: 9, fill: "#a855f7" }} />
                ))}
                {expectedMove && (
                    <>
                        <ReferenceLine x={expectedMove.minus2sd} stroke="#d1d5db" label={{ value: "-2SD", fontSize: 9, fill: "#9ca3af" }} />
                        <ReferenceLine x={expectedMove.minus1sd} stroke="#d1d5db" label={{ value: "-1SD", fontSize: 9, fill: "#9ca3af" }} />
                        <ReferenceLine x={expectedMove.plus1sd} stroke="#d1d5db" label={{ value: "+1SD", fontSize: 9, fill: "#9ca3af" }} />
                        <ReferenceLine x={expectedMove.plus2sd} stroke="#d1d5db" label={{ value: "+2SD", fontSize: 9, fill: "#9ca3af" }} />
                    </>
                )}

                <Area type="monotone" dataKey="pnl" name="Expiry P&L" stroke="#2563eb" strokeWidth={2} fill="url(#payoffGradient)" />
                {hasToday && (
                    <Line type="monotone" dataKey="todayPnl" name="Today P&L" stroke="#ea580c" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                )}

                {spotExpiryPnl != null && (
                    <ReferenceDot
                        x={spotPrice}
                        y={spotExpiryPnl}
                        r={5}
                        fill="#2563eb"
                        stroke="#fff"
                        strokeWidth={2}
                        label={{ value: formatPrice(spotExpiryPnl), position: "top", fontSize: 10, fontWeight: 700, fill: "#2563eb" }}
                    />
                )}
                {spotTodayPnl != null && (
                    <ReferenceDot
                        x={spotPrice}
                        y={spotTodayPnl}
                        r={5}
                        fill="#ea580c"
                        stroke="#fff"
                        strokeWidth={2}
                        label={{ value: formatPrice(spotTodayPnl), position: "bottom", fontSize: 10, fontWeight: 700, fill: "#ea580c" }}
                    />
                )}
            </ComposedChart>
        </ResponsiveContainer>
    );
}
