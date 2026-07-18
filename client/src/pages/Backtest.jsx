import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { runBacktest } from "../services/backtestApi";
import { saveBacktestResult } from "../services/strategiesApi";
import { formatPrice } from "../utils/format";
import { downloadCsv } from "../utils/csv";
import SaveButton from "../components/SaveButton";
import { useAuth } from "../context/AuthContext";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
let legIdCounter = 0;
const blankLeg = () => ({ id: ++legIdCounter, action: "buy", type: "CE", strikeOffset: 0, qty: 1 });

export default function Backtest() {
    const { user, isPro, token } = useAuth();
    const navigate = useNavigate();
    const [symbol, setSymbol] = useState("NIFTY");
    const [expiryType, setExpiryType] = useState("weekly");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [entryTime, setEntryTime] = useState("09:20:00");
    const [dte, setDte] = useState("");
    const [stopLossPct, setStopLossPct] = useState("");
    const [targetPct, setTargetPct] = useState("");
    const [legs, setLegs] = useState([blankLeg()]);

    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    function updateLeg(id, patch) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    }
    function addLeg() {
        setLegs((prev) => (prev.length >= 6 ? prev : [...prev, blankLeg()]));
    }
    function removeLeg(id) {
        setLegs((prev) => prev.filter((l) => l.id !== id));
    }

    async function handleRun() {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const r = await runBacktest(token, {
                symbol, expiryType, startDate, endDate, entryTime,
                dte: dte === "" ? null : Number(dte),
                stopLossPct: stopLossPct === "" ? null : Number(stopLossPct),
                targetPct: targetPct === "" ? null : Number(targetPct),
                legs: legs.map(({ action, type, strikeOffset, qty }) => ({ action, type, strikeOffset: Number(strikeOffset), qty: Number(qty) })),
            });
            setResult(r);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    function exportCsv() {
        if (!result?.trades?.length) return;
        downloadCsv(
            `backtest_${symbol}_${startDate}_${endDate}.csv`,
            result.trades.map((t) => ({
                date: t.entryDate, expiry: t.expiry, entryTime: t.entryTime, exitTime: t.exitTime,
                entryCost: t.entryCost, pnl: t.pnl, exitReason: t.exitReason,
            }))
        );
    }

    return (
        <div className="mx-auto max-w-[1300px] px-4 py-4">
            <div className="mb-3 rounded-lg border border-gray-200 bg-white p-4">
                <h1 className="mb-3 text-base font-semibold text-gray-900">Backtest</h1>
                <p className="mb-4 text-xs text-gray-500">
                    Reads only from stored historical data (MySQL) — never the live broker API, per project rule.
                    Legs are defined relative to that day's ATM strike (offset in strike-gap multiples), since the
                    actual ATM strike moves across the date range.
                </p>

                <div className="mb-3 grid grid-cols-6 gap-3 text-xs">
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">Symbol</label>
                        <div className="flex gap-1">
                            {SYMBOLS.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => setSymbol(s)}
                                    className={`rounded px-2 py-1 font-semibold ${symbol === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600"}`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">Expiry Type</label>
                        <select value={expiryType} onChange={(e) => setExpiryType(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1">
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                        </select>
                    </div>
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">Start Date</label>
                        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" />
                    </div>
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">End Date</label>
                        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" />
                    </div>
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">Entry Time</label>
                        <input type="time" step="1" value={entryTime} onChange={(e) => setEntryTime(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1" />
                    </div>
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">DTE (optional)</label>
                        <input type="number" value={dte} onChange={(e) => setDte(e.target.value)} placeholder="any" className="w-full rounded border border-gray-300 px-2 py-1" />
                    </div>
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">Stop Loss %</label>
                        <input type="number" value={stopLossPct} onChange={(e) => setStopLossPct(e.target.value)} placeholder="none" className="w-full rounded border border-gray-300 px-2 py-1" />
                    </div>
                    <div>
                        <label className="mb-1 block font-medium text-gray-500">Target %</label>
                        <input type="number" value={targetPct} onChange={(e) => setTargetPct(e.target.value)} placeholder="none" className="w-full rounded border border-gray-300 px-2 py-1" />
                    </div>
                </div>

                <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-500">Legs (strike offset in multiples of that day's strike gap; 0 = ATM)</label>
                        <button onClick={addLeg} disabled={legs.length >= 6} className="text-xs font-medium text-blue-600 disabled:text-gray-300">+ Add leg</button>
                    </div>
                    <div className="space-y-1">
                        {legs.map((leg) => (
                            <div key={leg.id} className="flex items-center gap-2 text-xs">
                                <select value={leg.action} onChange={(e) => updateLeg(leg.id, { action: e.target.value })} className="rounded border border-gray-300 px-2 py-1">
                                    <option value="buy">Buy</option>
                                    <option value="sell">Sell</option>
                                </select>
                                <select value={leg.type} onChange={(e) => updateLeg(leg.id, { type: e.target.value })} className="rounded border border-gray-300 px-2 py-1">
                                    <option value="CE">CE</option>
                                    <option value="PE">PE</option>
                                </select>
                                <input type="number" value={leg.strikeOffset} onChange={(e) => updateLeg(leg.id, { strikeOffset: e.target.value })} className="w-20 rounded border border-gray-300 px-2 py-1" placeholder="offset" />
                                <input type="number" min={1} value={leg.qty} onChange={(e) => updateLeg(leg.id, { qty: e.target.value })} className="w-16 rounded border border-gray-300 px-2 py-1" placeholder="qty" />
                                <button onClick={() => removeLeg(leg.id)} className="text-gray-400 hover:text-rose-600">✕</button>
                            </div>
                        ))}
                    </div>
                </div>

                {!user ? (
                    <button
                        onClick={() => navigate("/login")}
                        className="rounded-md border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                    >
                        Log in to run a backtest
                    </button>
                ) : !isPro ? (
                    <button
                        disabled
                        title="Backtesting requires a Pro subscription — see hard rules: Free tier is live dashboard only"
                        className="cursor-not-allowed rounded-md border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-400"
                    >
                        Run Backtest (Pro only)
                    </button>
                ) : (
                    <button
                        onClick={handleRun}
                        disabled={loading || !startDate || !endDate || !legs.length}
                        className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? "Running…" : "Run Backtest"}
                    </button>
                )}
            </div>

            {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            {result?.note && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{result.note}</div>
            )}

            {result && !result.note && (
                <>
                    <div className="mb-3 flex items-center justify-end">
                        <SaveButton
                            itemLabel="backtest result"
                            onSave={(token, name) => saveBacktestResult(token, {
                                symbol, expiryType, startDate, endDate,
                                params: { entryTime, dte, stopLossPct, targetPct, legs, name },
                                result,
                            })}
                        />
                    </div>

                    <div className="mb-3 grid grid-cols-5 gap-3">
                        <Stat label="Net P&L" value={formatPrice(result.netPnl)} positive={result.netPnl >= 0} />
                        <Stat label="Win Rate" value={`${result.winRate}%`} />
                        <Stat label="Total Trades" value={result.totalTrades} />
                        <Stat label="Max Drawdown" value={formatPrice(result.maxDrawdown)} />
                        <Stat label="Sharpe (approx.)" value={result.sharpeRatio} />
                    </div>

                    {result.equityCurve?.length > 1 && (
                        <div className="mb-3 rounded-lg border border-gray-200 bg-white p-4">
                            <h2 className="mb-2 text-xs font-semibold text-gray-600">Equity Curve</h2>
                            <ResponsiveContainer width="100%" height={280}>
                                <LineChart data={result.equityCurve}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatPrice(v)} width={70} />
                                    <Tooltip formatter={(v) => formatPrice(v)} />
                                    <ReferenceLine y={0} stroke="#9ca3af" />
                                    <Line type="monotone" dataKey="equity" stroke="#2563eb" dot={false} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-xs font-semibold text-gray-600">Trade Log ({result.trades.length})</h2>
                            <button onClick={exportCsv} disabled={!result.trades.length} className="text-xs font-medium text-blue-600 disabled:text-gray-300">
                                Export CSV
                            </button>
                        </div>
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr className="text-gray-500">
                                    <th className="px-2 py-1 text-left font-medium">Date</th>
                                    <th className="px-2 py-1 text-left font-medium">Expiry</th>
                                    <th className="px-2 py-1 text-right font-medium">Entry</th>
                                    <th className="px-2 py-1 text-right font-medium">Exit</th>
                                    <th className="px-2 py-1 text-right font-medium">Cost</th>
                                    <th className="px-2 py-1 text-right font-medium">P&L</th>
                                    <th className="px-2 py-1 text-left font-medium">Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.trades.map((t, i) => (
                                    <tr key={i} className="border-t border-gray-100">
                                        <td className="px-2 py-1">{t.entryDate}</td>
                                        <td className="px-2 py-1">{t.expiry}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{t.entryTime}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{t.exitTime}</td>
                                        <td className="px-2 py-1 text-right tabular-nums">{formatPrice(t.entryCost)}</td>
                                        <td className={`px-2 py-1 text-right font-medium tabular-nums ${t.pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                            {formatPrice(t.pnl)}
                                        </td>
                                        <td className="px-2 py-1">{t.exitReason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {!result.trades.length && (
                            <div className="py-6 text-center text-xs text-gray-500">
                                No trades matched these parameters ({result.skipped?.length ?? 0} day(s) skipped — see reasons in the API response).
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function Stat({ label, value, positive }) {
    return (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">{label}</div>
            <div className={`text-sm font-bold tabular-nums ${positive === undefined ? "text-gray-900" : positive ? "text-emerald-600" : "text-rose-600"}`}>
                {value}
            </div>
        </div>
    );
}
