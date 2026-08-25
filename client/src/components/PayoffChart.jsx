import { ComposedChart, Area, Line, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceDot, ResponsiveContainer } from "recharts";
import { formatPrice } from "../utils/format";
import { computeDensityCurve } from "../utils/payoff";

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

function CustomTooltip({ active, payload, label, spotPrice }) {
    if (!active || !payload?.length) return null;
    const pnlEntry = payload.find((p) => p.dataKey === "pnl");
    const todayEntry = payload.find((p) => p.dataKey === "todayPnl");
    const pctFromSpot = spotPrice ? ((label - spotPrice) / spotPrice) * 100 : null;
    return (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
            <div className="mb-1 font-bold text-gray-800">
                {formatPrice(label)}
                {pctFromSpot != null && (
                    <span className={`ml-1.5 font-semibold ${pctFromSpot >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        ({pctFromSpot >= 0 ? "+" : ""}{pctFromSpot.toFixed(2)}%)
                    </span>
                )}
            </div>
            {pnlEntry && (
                <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-400">Expiry P&L</span>
                    <span className={`font-bold ${pnlEntry.value >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatPrice(pnlEntry.value)}</span>
                </div>
            )}
            {todayEntry?.value != null && (
                <div className="flex items-center justify-between gap-4">
                    <span className="text-gray-400">Today P&L</span>
                    <span className={`font-bold ${todayEntry.value >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatPrice(todayEntry.value)}</span>
                </div>
            )}
        </div>
    );
}

// Shows two curves, matching stockmojo's Strategy Builder: a solid "Expiry"
// line (intrinsic value only, hard kinks at strikes) and a dashed "Today"
// line (Black-Scholes mark-to-market with remaining time value, smooth near
// the money) — plus ±1SD/±2SD expected-move reference lines based on ATM IV,
// a light probability-density histogram in the background (decorative, same
// normal-distribution approximation computePOP already uses, not a precise
// distribution), and a marker dot on each curve at the current spot price.
//
// Spot/SD values are shown in a header row above the chart, not as inline
// chart labels — cramming "-2SD -1SD BE Spot BE +1SD +2SD" text into the
// plot area produced illegible overlapping labels, worse right at the spot
// P&L dots where the Expiry/Today values used to be drawn as text directly
// on the curve and collided with each other whenever the two curves were
// close together (routinely, near the money). The header row + a single
// "P&L at spot" line below it carry that information instead; the chart
// itself keeps only the reference lines and two small unlabeled dots.
export default function PayoffChart({ curve, spotPrice, breakevens, expectedMove, atmIv, yearsRemaining }) {
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

    const density = atmIv && yearsRemaining != null ? computeDensityCurve(curve, spotPrice, atmIv, yearsRemaining) : null;
    const chartData = density ? curve.map((p, i) => ({ ...p, density: density[i] })) : curve;

    return (
        <div>
            {(spotPrice || expectedMove) && (
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-semibold text-gray-400">
                    <span>{expectedMove ? formatPrice(expectedMove.minus2sd) : ""}<span className="ml-1 text-gray-300">−2SD</span></span>
                    <span>{expectedMove ? formatPrice(expectedMove.minus1sd) : ""}<span className="ml-1 text-gray-300">−1SD</span></span>
                    <span className="text-sm font-bold text-blue-600">{spotPrice ? `Spot ${formatPrice(spotPrice)}` : ""}</span>
                    <span>{expectedMove ? formatPrice(expectedMove.plus1sd) : ""}<span className="ml-1 text-gray-300">+1SD</span></span>
                    <span>{expectedMove ? formatPrice(expectedMove.plus2sd) : ""}<span className="ml-1 text-gray-300">+2SD</span></span>
                </div>
            )}

            <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={chartData}>
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
                    <YAxis yAxisId="pnl" tick={{ fontSize: 11 }} width={60} />
                    {/* Hidden secondary axis just for the density bars, fixed
                        0-4 range (density is normalized 0-1 already, so this
                        keeps the tallest bar to roughly a quarter of the plot
                        height — a background texture, not a competing series). */}
                    {density && <YAxis yAxisId="density" domain={[0, 4]} hide />}
                    <Tooltip content={<CustomTooltip spotPrice={spotPrice} />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />

                    {density && (
                        <Bar yAxisId="density" dataKey="density" barSize={6} isAnimationActive={false} legendType="none">
                            {chartData.map((p, i) => (
                                <Cell key={i} fill={p.pnl >= 0 ? "#10b981" : "#f43f5e"} fillOpacity={0.12} />
                            ))}
                        </Bar>
                    )}

                    <ReferenceLine yAxisId="pnl" y={0} stroke="#9ca3af" />
                    {spotPrice && <ReferenceLine yAxisId="pnl" x={spotPrice} stroke="#2563eb" strokeDasharray="4 4" />}
                    {breakevens.map((be) => (
                        <ReferenceLine key={be} yAxisId="pnl" x={be} stroke="#a855f7" strokeDasharray="2 2" />
                    ))}
                    {expectedMove && (
                        <>
                            <ReferenceLine yAxisId="pnl" x={expectedMove.minus2sd} stroke="#e5e7eb" />
                            <ReferenceLine yAxisId="pnl" x={expectedMove.minus1sd} stroke="#e5e7eb" />
                            <ReferenceLine yAxisId="pnl" x={expectedMove.plus1sd} stroke="#e5e7eb" />
                            <ReferenceLine yAxisId="pnl" x={expectedMove.plus2sd} stroke="#e5e7eb" />
                        </>
                    )}

                    <Area yAxisId="pnl" type="monotone" dataKey="pnl" name="Expiry P&L" stroke="#2563eb" strokeWidth={2} fill="url(#payoffGradient)" />
                    {hasToday && (
                        <Line yAxisId="pnl" type="monotone" dataKey="todayPnl" name="Today P&L" stroke="#ea580c" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                    )}

                    {spotExpiryPnl != null && (
                        <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotExpiryPnl} r={5} fill="#2563eb" stroke="#fff" strokeWidth={2} />
                    )}
                    {spotTodayPnl != null && (
                        <ReferenceDot yAxisId="pnl" x={spotPrice} y={spotTodayPnl} r={5} fill="#ea580c" stroke="#fff" strokeWidth={2} />
                    )}
                </ComposedChart>
            </ResponsiveContainer>

            {(spotExpiryPnl != null || spotTodayPnl != null) && (
                <div className="mt-1 flex items-center justify-center gap-5 text-[11px] font-semibold">
                    {spotExpiryPnl != null && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-blue-600" />
                            <span className="text-gray-400">P&L at spot (Expiry):</span>
                            <span className={spotExpiryPnl >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatPrice(spotExpiryPnl)}</span>
                        </span>
                    )}
                    {spotTodayPnl != null && (
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-orange-600" />
                            <span className="text-gray-400">P&L at spot (Today):</span>
                            <span className={spotTodayPnl >= 0 ? "text-emerald-600" : "text-rose-600"}>{formatPrice(spotTodayPnl)}</span>
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
