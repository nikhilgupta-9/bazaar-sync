// pages/HistoricalChart.jsx — full-width multi-day index/stock price history
// from Bazaar Sync's own stored ohlcv_data (distinct from Strategy Builder's
// intraday-only chart tabs).
//
// The GET /:symbol/underlying-history endpoint serves whatever granularity is
// stored (a mix of 1-minute and EOD rows depending on the source); this page
// aggregates it to one candle per calendar day so a "1Y" view is ~250
// readable daily candles rather than tens of thousands of ticks, and derives
// its stat tiles from that same aggregation. The chart itself
// (HistoricalPriceChart) carries the drawing tools / indicators / chart-type
// / fullscreen toolbar.
import { useEffect, useMemo, useState } from "react";
import { fetchSymbolList, fetchUnderlyingHistory } from "../services/optionChainApi";
import TradingViewChart from "../components/TradingViewChart";

const DEFAULT_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

const RANGE_OPTIONS = [
    { label: "1M", days: 30 },
    { label: "3M", days: 90 },
    { label: "6M", days: 180 },
    { label: "1Y", days: 365 },
];

// One candle per UTC calendar day: open of the first row, close of the last,
// high/low across the day, volume summed. Points arrive time-ascending.
function toDailyCandles(points) {
    const byDay = new Map();
    for (const p of points) {
        if (p.close == null) continue;
        const dayKey = Math.floor(p.time / 86400) * 86400;
        const g = byDay.get(dayKey);
        if (!g) {
            byDay.set(dayKey, { time: dayKey, open: p.open, high: p.high, low: p.low, close: p.close, volume: p.volume || 0 });
        } else {
            g.high = Math.max(g.high, p.high);
            g.low = Math.min(g.low, p.low);
            g.close = p.close;
            g.volume += p.volume || 0;
        }
    }
    return [...byDay.values()].sort((a, b) => a.time - b.time);
}

function computeStats(daily) {
    if (!daily.length) return null;
    const first = daily[0];
    const last = daily[daily.length - 1];
    const change = last.close - first.close;
    const changePct = first.close ? (change / first.close) * 100 : 0;

    let hi = daily[0], lo = daily[0], volSum = 0, volDays = 0;
    for (const d of daily) {
        if (d.high > hi.high) hi = d;
        if (d.low < lo.low) lo = d;
        if (d.volume > 0) { volSum += d.volume; volDays += 1; }
    }
    return {
        last: last.close,
        lastDate: isoDay(last.time),
        change,
        changePct,
        high: hi.high,
        highDate: isoDay(hi.time),
        low: lo.low,
        lowDate: isoDay(lo.time),
        sessions: daily.length,
        avgVolume: volDays ? volSum / volDays : null,
    };
}

function isoDay(epochSec) {
    return new Date(epochSec * 1000).toISOString().slice(0, 10);
}
function fmtNum(v) {
    return v == null ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function fmtVol(v) {
    if (v == null) return "—";
    if (v >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
    return String(Math.round(v));
}

function StatTile({ label, value, sub, tone }) {
    const toneClass = tone === "up" ? "text-emerald-600" : tone === "down" ? "text-rose-600" : "text-gray-900";
    return (
        <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-sm">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
            <div className={`mt-0.5 text-base font-bold tabular-nums ${toneClass}`}>{value}</div>
            {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
        </div>
    );
}

export default function HistoricalChart() {
    const [symbolList, setSymbolList] = useState({ indices: DEFAULT_INDICES, stocks: [] });
    const [symbol, setSymbol] = useState("NIFTY");
    const [days, setDays] = useState(90);

    // { key, points, error } keyed by symbol:days so `loading` is derived
    // rather than set synchronously inside the effect body.
    const [result, setResult] = useState(null);

    useEffect(() => {
        fetchSymbolList()
            .then((res) =>
                setSymbolList({
                    indices: res.indices?.length ? res.indices : DEFAULT_INDICES,
                    stocks: res.stocks || [],
                })
            )
            .catch(() => {});
    }, []);

    useEffect(() => {
        const key = `${symbol}:${days}`;
        let cancelled = false;
        fetchUnderlyingHistory(symbol, days)
            .then((res) => !cancelled && setResult({ key, points: res.points || [], error: null }))
            .catch((err) => !cancelled && setResult({ key, points: [], error: err.message || "Failed to load" }));
        return () => {
            cancelled = true;
        };
    }, [symbol, days]);

    const currentKey = `${symbol}:${days}`;
    const loading = !result || result.key !== currentKey;
    const error = loading ? null : result.error;
    const rawPoints = loading ? null : result.points;

    const daily = useMemo(() => toDailyCandles(rawPoints || []), [rawPoints]);
    const stats = useMemo(() => computeStats(daily), [daily]);
    const rangeLabel = RANGE_OPTIONS.find((r) => r.days === days)?.label || "";
    const up = stats && stats.change >= 0;

    return (
        <div className="w-full px-3 py-5 sm:px-5">
            {/* Header */}
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">Historical Chart</h1>
                    <p className="mt-0.5 text-xs text-gray-500">
                        Daily price history from Bazaar Sync's own stored data — not a live feed.
                    </p>
                </div>
                {stats && (
                    <div className="text-right">
                        <div className="text-2xl font-bold tabular-nums text-gray-900">{fmtNum(stats.last)}</div>
                        <div className={`text-xs font-semibold tabular-nums ${up ? "text-emerald-600" : "text-rose-600"}`}>
                            {up ? "▲" : "▼"} {up ? "+" : ""}{fmtNum(stats.change)} ({up ? "+" : ""}{stats.changePct.toFixed(2)}%) · {rangeLabel}
                        </div>
                    </div>
                )}
            </div>

            {/* Symbol + range */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
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
                                days === r.days ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"
                            }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Stat tiles */}
            {stats && (
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                    <StatTile label="Last Close" value={fmtNum(stats.last)} sub={stats.lastDate} />
                    <StatTile
                        label={`Change (${rangeLabel})`}
                        value={`${up ? "+" : ""}${stats.changePct.toFixed(2)}%`}
                        sub={`${up ? "+" : ""}${fmtNum(stats.change)} pts`}
                        tone={up ? "up" : "down"}
                    />
                    <StatTile label="Period High" value={fmtNum(stats.high)} sub={stats.highDate} tone="up" />
                    <StatTile label="Period Low" value={fmtNum(stats.low)} sub={stats.lowDate} tone="down" />
                    <StatTile
                        label={stats.avgVolume != null ? "Avg Volume" : "Sessions"}
                        value={stats.avgVolume != null ? fmtVol(stats.avgVolume) : String(stats.sessions)}
                        sub={stats.avgVolume != null ? `${stats.sessions} sessions` : "trading days"}
                    />
                </div>
            )}

            {/* Chart */}
            <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                {loading ? (
                    <div className="flex h-[62vh] min-h-[420px] items-center justify-center text-xs text-gray-400">Loading {symbol} history…</div>
                ) : error ? (
                    <div className="flex h-[62vh] min-h-[420px] items-center justify-center text-xs text-rose-600">Failed to load: {error}</div>
                ) : daily.length === 0 ? (
                    <div className="flex h-[62vh] min-h-[420px] flex-col items-center justify-center gap-1 text-xs text-gray-400">
                        <span className="text-sm font-semibold text-gray-500">No stored history for {symbol}</span>
                        <span>Nothing has been backfilled into ohlcv_data for this symbol yet.</span>
                    </div>
                ) : (
                    <>
                        <TradingViewChart points={daily} symbol={symbol} rangeLabel={rangeLabel} />
                        <div className="mt-1.5 text-[10px] text-gray-400">
                            {daily.length} daily candles · from Bazaar Sync's stored OHLCV via the /api/tv datafeed — not a live feed.
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
