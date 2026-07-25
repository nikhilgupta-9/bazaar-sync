import { useEffect, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";
import { fetchSimulatorDates, fetchSimulatorChain, runSimulatorReplay } from "../services/simulatorApi";
import { formatPrice } from "../utils/format";
import OiBar from "../components/OiBar";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
const SPEEDS = [1, 2, 4, 8];
const TICK_MS = 350; // wall-clock ms per playback step, regardless of speed multiplier
let legIdCounter = 0;

function formatTime(t) {
    return t ? t.slice(0, 5) : "-";
}

export default function Simulator() {
    const [symbol, setSymbol] = useState("NIFTY");
    const [dates, setDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState("");
    const [chainData, setChainData] = useState(null);
    const [chainError, setChainError] = useState(null);
    const [legs, setLegs] = useState([]);

    const [replayData, setReplayData] = useState(null);
    const [replayError, setReplayError] = useState(null);
    const [running, setRunning] = useState(false);
    const [cursor, setCursor] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);

    const [liveChain, setLiveChain] = useState(null); // option chain at the scrubbed time
    const requestIdRef = useRef(0);

    // Reset everything when the symbol changes.
    useEffect(() => {
        setDates([]);
        setSelectedDate("");
        setChainData(null);
        setLegs([]);
        setReplayData(null);
        fetchSimulatorDates(symbol)
            .then((res) => setDates(res.dates))
            .catch((err) => setChainError(err.message));
    }, [symbol]);

    function loadChain(date, expiry) {
        setChainError(null);
        fetchSimulatorChain(symbol, { date, expiry })
            .then((res) => setChainData(res))
            .catch((err) => {
                setChainError(err.message);
                setChainData(null);
            });
    }

    function selectDate(date) {
        setSelectedDate(date);
        setLegs([]);
        setReplayData(null);
        if (date) loadChain(date);
    }

    function selectExpiry(expiry) {
        setLegs([]);
        setReplayData(null);
        loadChain(selectedDate, expiry);
    }

    function addLeg(strike, type, action) {
        setLegs((prev) => {
            if (prev.length >= 6) return prev;
            return [...prev, { id: ++legIdCounter, strike, type, action, qty: 1 }];
        });
    }

    function removeLeg(id) {
        setLegs((prev) => prev.filter((l) => l.id !== id));
    }

    async function runSimulation() {
        setRunning(true);
        setReplayError(null);
        setPlaying(false);
        try {
            const res = await runSimulatorReplay(symbol, {
                date: selectedDate,
                expiry: chainData.selectedExpiry,
                legs: legs.map(({ strike, type, action, qty }) => ({ strike, type, action, qty })),
            });
            setReplayData(res);
            setCursor(0);
        } catch (err) {
            setReplayError(err.message);
        } finally {
            setRunning(false);
        }
    }

    // Playback loop.
    useEffect(() => {
        if (!playing || !replayData) return;
        const timer = setInterval(() => {
            setCursor((c) => {
                const next = c + speed;
                if (next >= replayData.series.length - 1) {
                    setPlaying(false);
                    return replayData.series.length - 1;
                }
                return next;
            });
        }, TICK_MS);
        return () => clearInterval(timer);
    }, [playing, speed, replayData]);

    // Fetch the option chain at whichever moment is currently scrubbed to, so
    // the table below updates like you're watching the day happen.
    useEffect(() => {
        if (!replayData) return;
        const point = replayData.series[cursor];
        if (!point) return;
        const requestId = ++requestIdRef.current;
        fetchSimulatorChain(symbol, { date: replayData.date, expiry: replayData.expiry, time: point.time })
            .then((res) => {
                if (requestId === requestIdRef.current) setLiveChain(res);
            })
            .catch(() => {
                /* non-fatal — the P&L chart is the primary view */
            });
    }, [cursor, replayData, symbol]);

    const displayRows = liveChain?.rows || chainData?.rows || [];
    const displaySpot = liveChain?.spotPrice ?? chainData?.spotPrice;
    const maxCeOi = Math.max(0, ...displayRows.map((r) => r.ce?.oi || 0));
    const maxPeOi = Math.max(0, ...displayRows.map((r) => r.pe?.oi || 0));
    const currentPoint = replayData?.series?.[cursor];

    return (
        <div className="mx-auto flex max-w-[1600px] gap-5 px-5 py-5 bg-gray-50/40 min-h-screen">
            <div className="w-[520px] shrink-0 flex flex-col">
                <div className="mb-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="flex gap-1.5 bg-gray-100 p-1 rounded-lg">
                        {SYMBOLS.map((s) => (
                            <button
                                key={s}
                                onClick={() => setSymbol(s)}
                                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                                    symbol === s ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-900"
                                }`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                        <label className="text-xs font-semibold text-gray-500">Date</label>
                        <select
                            value={selectedDate}
                            onChange={(e) => selectDate(e.target.value)}
                            className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium bg-gray-50 text-gray-700 outline-none focus:border-blue-500"
                        >
                            <option value="">Select a trading day…</option>
                            {dates.map((d) => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                    </div>
                    {!dates.length && <div className="mt-2 text-[11px] text-gray-400">Loading available dates…</div>}

                    {chainData && chainData.expiries.length > 1 && (
                        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                            {chainData.expiries.map((exp) => (
                                <button
                                    key={exp}
                                    onClick={() => selectExpiry(exp)}
                                    className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                                        exp === chainData.selectedExpiry ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                    }`}
                                >
                                    {exp}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {chainError && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{chainError}</div>}

                {chainData && (
                    <div className="mb-3 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs shadow-sm">
                        <div>
                            <span className="text-gray-400">SPOT: </span>
                            <span className="font-bold tabular-nums text-gray-900">{formatPrice(displaySpot)}</span>
                        </div>
                        <div className="h-4 w-px bg-gray-200" />
                        <div>
                            <span className="text-gray-400">TIME: </span>
                            <span className="font-bold tabular-nums text-gray-900">
                                {formatTime(currentPoint?.time || chainData.selectedTime)}
                            </span>
                        </div>
                        {replayData && (
                            <>
                                <div className="h-4 w-px bg-gray-200" />
                                <div>
                                    <span className="text-gray-400">P&amp;L: </span>
                                    <span className={`font-bold tabular-nums ${currentPoint?.pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                        {currentPoint?.pnl != null ? formatPrice(currentPoint.pnl) : "-"}
                                    </span>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {displayRows.length > 0 && (
                    <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm custom-scrollbar">
                        <table className="w-full border-collapse text-[11px]">
                            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
                                <tr>
                                    <th className="px-1.5 py-2 text-right font-semibold text-gray-400">Call LTP</th>
                                    <th className="px-1.5 py-2 text-right font-semibold text-gray-400">Call OI</th>
                                    <th className="py-2 text-center font-bold text-gray-700 bg-gray-100/80 border-x border-gray-200">Strike</th>
                                    <th className="px-1.5 py-2 text-left font-semibold text-gray-400">Put OI</th>
                                    <th className="px-1.5 py-2 text-left font-semibold text-gray-400">Put LTP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayRows.map((row) => {
                                    const isAtm = chainData && row.strike === chainData.atmStrike;
                                    return (
                                        <tr key={row.strike} className={`border-b border-gray-100/70 ${isAtm ? "bg-blue-50/60 font-semibold" : "hover:bg-gray-50/80"}`}>
                                            <td className="group px-1.5 py-1.5 text-right tabular-nums relative">
                                                <span className="text-gray-700 group-hover:invisible">{formatPrice(row.ce?.ltp)}</span>
                                                {!replayData && (
                                                    <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-0.5 bg-white">
                                                        <button onClick={() => addLeg(row.strike, "CE", "buy")} className="rounded bg-emerald-500 hover:bg-emerald-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">B</button>
                                                        <button onClick={() => addLeg(row.strike, "CE", "sell")} className="rounded bg-rose-500 hover:bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">S</button>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-0 tabular-nums"><OiBar value={row.ce?.oi} max={maxCeOi} side="ce" /></td>
                                            <td className="py-1.5 text-center font-bold text-gray-900 bg-gray-50/40 border-x border-gray-100 text-xs tabular-nums">{row.strike}</td>
                                            <td className="p-0 tabular-nums"><OiBar value={row.pe?.oi} max={maxPeOi} side="pe" /></td>
                                            <td className="group px-1.5 py-1.5 text-left tabular-nums relative">
                                                <span className="text-gray-700 group-hover:invisible">{formatPrice(row.pe?.ltp)}</span>
                                                {!replayData && (
                                                    <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-0.5 bg-white">
                                                        <button onClick={() => addLeg(row.strike, "PE", "buy")} className="rounded bg-emerald-500 hover:bg-emerald-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">B</button>
                                                        <button onClick={() => addLeg(row.strike, "PE", "sell")} className="rounded bg-rose-500 hover:bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">S</button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="flex-1 flex flex-col">
                {!selectedDate && (
                    <div className="flex-1 rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-center text-sm text-gray-400">
                        Pick a symbol and a historical trading day on the left to start. The chain is real data
                        stored from that day — build legs the same way as Strategy Builder, then replay the whole
                        day minute by minute from real recorded prices.
                    </div>
                )}

                {selectedDate && !replayData && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-gray-900">Legs ({legs.length}/6)</h2>
                            {legs.length > 0 && (
                                <button onClick={() => setLegs([])} className="text-xs font-semibold text-gray-500 hover:text-rose-600">
                                    Clear
                                </button>
                            )}
                        </div>
                        {!legs.length ? (
                            <div className="py-6 text-center text-xs text-gray-400">
                                Hover a Call or Put LTP cell in the chain and click B (buy) or S (sell) to add a leg.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {legs.map((leg) => (
                                    <div key={leg.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs">
                                        <span>
                                            <span className={`mr-2 rounded px-1.5 py-0.5 font-bold text-white ${leg.action === "buy" ? "bg-emerald-500" : "bg-rose-500"}`}>
                                                {leg.action === "buy" ? "BUY" : "SELL"}
                                            </span>
                                            {leg.strike} {leg.type}
                                        </span>
                                        <button onClick={() => removeLeg(leg.id)} className="text-gray-400 hover:text-rose-600 font-bold">✕</button>
                                    </div>
                                ))}
                                <button
                                    onClick={runSimulation}
                                    disabled={running}
                                    className="mt-2 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {running ? "Loading real prices…" : `Run Simulation (${selectedDate})`}
                                </button>
                                {replayError && <div className="text-xs text-rose-600">{replayError}</div>}
                            </div>
                        )}
                    </div>
                )}

                {replayData && (
                    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-gray-900">
                                Replaying {replayData.symbol} {replayData.date} · entry {formatTime(replayData.entryTime)}
                            </h2>
                            <button
                                onClick={() => { setReplayData(null); setLiveChain(null); }}
                                className="text-xs font-semibold text-gray-500 hover:text-blue-600"
                            >
                                ← Edit legs
                            </button>
                        </div>

                        <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={replayData.series}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 11 }} width={60} />
                                <Tooltip formatter={(v) => formatPrice(v)} labelFormatter={formatTime} />
                                <ReferenceLine y={0} stroke="#9ca3af" />
                                {currentPoint && (
                                    <ReferenceLine x={currentPoint.time} stroke="#2563eb" strokeDasharray="4 4" />
                                )}
                                <Line type="monotone" dataKey="pnl" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls />
                            </LineChart>
                        </ResponsiveContainer>

                        <div className="mt-3 flex items-center gap-3">
                            <button
                                onClick={() => setPlaying((p) => !p)}
                                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                            >
                                {playing ? "Pause" : "Play"}
                            </button>
                            <input
                                type="range"
                                min={0}
                                max={replayData.series.length - 1}
                                value={cursor}
                                onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
                                className="flex-1"
                            />
                            <select
                                value={speed}
                                onChange={(e) => setSpeed(Number(e.target.value))}
                                className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium bg-gray-50"
                            >
                                {SPEEDS.map((s) => (
                                    <option key={s} value={s}>{s}x</option>
                                ))}
                            </select>
                        </div>

                        <div className="mt-2 text-[11px] text-gray-400">
                            Real stored prices from {replayData.date} — where a minute has no recorded price for a
                            leg's strike, that point is shown as a gap rather than guessed.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
