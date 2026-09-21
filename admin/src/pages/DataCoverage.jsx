// pages/DataCoverage.jsx — per-symbol, per-month "how much data do we
// actually have vs. how much should exist" for the 2023-onward target
// window. Two levels: a summary table (every symbol, overall stats) and a
// month-by-month grid for whichever symbol is selected — "expected days"
// per month is derived from the data itself (the best-covered symbol that
// month), not a hardcoded holiday calendar; see
// server/services/dataCoverageService.js's header for why.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiRefreshCw, FiSearch, FiClock, FiDatabase, FiChevronRight } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchCoverageSummary, fetchCoverageDetail, fetchCoverageDays, fetchCoverageMinutes, fetchCoverageMinuteRows, refreshCoverageCache } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const SEVEN_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];

function pctColor(pct) {
    if (pct == null) return "bg-white/5 text-gray-600";
    if (pct >= 90) return "bg-emerald-500/20 text-emerald-300";
    if (pct >= 50) return "bg-amber-500/20 text-amber-300";
    if (pct > 0) return "bg-rose-500/20 text-rose-300";
    return "bg-white/5 text-gray-600";
}

function formatTimestamp(value) {
    if (!value) return "Not available";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

export default function DataCoverage() {
    const { token } = useAdminAuth();
    const [dataType, setDataType] = useState("option_chain");
    const [summary, setSummary] = useState(null);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(null);
    const [days, setDays] = useState(null);
    const [selectedDay, setSelectedDay] = useState(null);
    const [minutes, setMinutes] = useState(null);
    const [selectedTime, setSelectedTime] = useState(null);
    const [minuteRows, setMinuteRows] = useState(null);

    const load = useCallback(() => {
        fetchCoverageSummary(token, dataType).then((r) => setSummary(r)).catch((err) => setError(err.message));
    }, [token, dataType]);

    useEffect(load, [load]);

    const rows = useMemo(() => {
        if (!summary) return [];
        // VIX is a single series (INDIAVIX), not "7 indices + stocks" — the
        // pinning below doesn't apply, just show whatever summary.symbols
        // has (0 or 1 row).
        if (dataType === "vix") return summary.symbols;
        const bySymbol = new Map(summary.symbols.map((s) => [s.symbol, s]));
        // 7 indices pinned first (even if missing entirely — shows as a blank row), then the rest matching the search.
        const indices = SEVEN_INDICES.map((sym) => bySymbol.get(sym) || { symbol: sym, firstDate: null, lastDate: null, totalRows: 0, totalDays: 0, monthsWithData: 0, lastUpdatedAt: null });
        const stocks = summary.symbols
            .filter((s) => !SEVEN_INDICES.includes(s.symbol))
            .filter((s) => !search || s.symbol.includes(search.toUpperCase()));
        return [...indices, ...stocks];
    }, [summary, search, dataType]);

    const selectedSummary = summary?.symbols?.find((row) => row.symbol === selected) || null;
    const freshestRow = summary?.symbols?.reduce((best, row) => {
        if (!row.lastUpdatedAt) return best;
        return !best || new Date(row.lastUpdatedAt) > new Date(best.lastUpdatedAt) ? row : best;
    }, null);
    const latestDataMonth = detail?.filter((month) => month.days > 0).reduce((best, month) => {
        if (!best || month.month > best.month) return month;
        return best;
    }, null);

    function selectSymbol(symbol) {
        setSelected(symbol);
        setDetail(null);
        setSelectedMonth(null);
        setDays(null);
        setSelectedDay(null);
        setMinutes(null);
        setSelectedTime(null);
        setMinuteRows(null);
        fetchCoverageDetail(token, dataType, symbol).then((r) => setDetail(r.months)).catch((err) => setError(err.message));
    }

    function selectMonth(month) {
        if (selectedMonth === month) { setSelectedMonth(null); setDays(null); return; } // click again to collapse
        setSelectedMonth(month);
        setDays(null);
        setSelectedDay(null);
        setMinutes(null);
        fetchCoverageDays(token, dataType, selected, month).then((r) => setDays(r.days)).catch((err) => setError(err.message));
    }

    function selectDay(date) {
        if (selectedDay === date) { setSelectedDay(null); setMinutes(null); return; }
        setSelectedDay(date);
        setMinutes(null);
        setSelectedTime(null);
        setMinuteRows(null);
        fetchCoverageMinutes(token, dataType, selected, date).then(setMinutes).catch((err) => setError(err.message));
    }

    function selectMinute(time) {
        if (selectedTime === time) { setSelectedTime(null); setMinuteRows(null); return; }
        setSelectedTime(time);
        setMinuteRows(null);
        fetchCoverageMinuteRows(token, dataType, selected, selectedDay, time).then(setMinuteRows).catch((err) => setError(err.message));
    }

    async function handleRefresh() {
        setRefreshing(true);
        try {
            await refreshCoverageCache(token);
            load();
            if (selected) selectSymbol(selected);
        } finally {
            setRefreshing(false);
        }
    }

    return (
        <div>
            <TopBar title="Data Coverage" subtitle={`How much ${dataType === "futures" ? "futures" : dataType === "vix" ? "India VIX" : "option-chain"} data exists${dataType === "vix" ? "" : " per symbol"} per month, ${summary?.coverageStart || "2023-01-01"} onward. "Expected" is the best-covered symbol that month, not a hardcoded holiday list.`} />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <div className="mb-4 flex flex-wrap items-center gap-3">
                    <select value={dataType} onChange={(e) => { setDataType(e.target.value); setSelected(null); setDetail(null); setSummary(null); setSelectedMonth(null); setDays(null); setSelectedDay(null); setMinutes(null); }} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                        <option value="option_chain">Option Chain</option>
                        <option value="futures">Futures</option>
                        <option value="vix">India VIX</option>
                    </select>
                    <div className="relative min-w-45 max-w-xs flex-1">
                        <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stock symbol…" className="w-full rounded-lg border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-violet-500" />
                    </div>
                    <button onClick={handleRefresh} disabled={refreshing} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300 hover:bg-white/10 disabled:opacity-50">
                        <FiRefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh data
                    </button>
                </div>

                {summary && (
                    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500"><FiDatabase className="h-3.5 w-3.5" /> Symbols with data</div>
                            <div className="mt-1 text-lg font-semibold text-white">{summary.symbols.length.toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500"><FiClock className="h-3.5 w-3.5" /> Coverage verified</div>
                            <div className="mt-1 text-sm font-semibold text-white">{formatTimestamp(freshestRow?.lastUpdatedAt)}</div>
                            <div className="text-[11px] text-gray-500">{freshestRow?.symbol || "No summary available"}</div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-gray-500"><FiClock className="h-3.5 w-3.5" /> Selected data through</div>
                            <div className="mt-1 text-sm font-semibold text-white">{selectedSummary?.lastDate || "Select a symbol"}</div>
                            <div className="text-[11px] text-gray-500">{selectedSummary ? `Summary updated ${formatTimestamp(selectedSummary.lastUpdatedAt)}` : "Click a symbol for month details"}</div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                    <Card title={`Symbols${summary ? ` (${rows.length})` : ""}`} className="lg:col-span-2" bodyClassName="max-h-[70vh] overflow-y-auto p-0">
                        {!summary ? (
                            <div className="py-10 text-center text-xs text-gray-500">Loading (first load can take up to a minute — full-history scan)…</div>
                        ) : (
                            <table className="w-full text-left text-xs">
                                <thead className="sticky top-0 bg-[#101015] text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2 font-medium">Symbol</th>
                                        <th className="px-3 py-2 font-medium">Days</th>
                                        <th className="px-3 py-2 font-medium">Months</th>
                                        <th className="px-3 py-2 font-medium">Last date</th>
                                        <th className="px-3 py-2 font-medium">Updated</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((r) => (
                                        <tr
                                            key={r.symbol}
                                            onClick={() => selectSymbol(r.symbol)}
                                            className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${selected === r.symbol ? "bg-violet-600/10" : ""} ${SEVEN_INDICES.includes(r.symbol) ? "font-semibold text-gray-200" : "text-gray-300"}`}
                                        >
                                            <td className="px-3 py-2">{r.symbol}</td>
                                            <td className="px-3 py-2">{r.totalDays || "—"}</td>
                                            <td className="px-3 py-2">{r.monthsWithData || "—"}</td>
                                            <td className="px-3 py-2 text-gray-500">{r.lastDate || "no data"}</td>
                                            <td className="px-3 py-2 text-gray-500" title={formatTimestamp(r.lastUpdatedAt)}>{r.lastUpdatedAt ? formatTimestamp(r.lastUpdatedAt) : "—"}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Card>

                    <Card title={selected ? `${selected} — month by month` : "Select a symbol"} className="lg:col-span-3">
                        {!selected ? (
                            <div className="py-10 text-center text-xs text-gray-500">Click a symbol on the left to see its monthly coverage.</div>
                        ) : !detail ? (
                            <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                        ) : (
                            <>
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                                    <span>{detail.filter((month) => month.days > 0).length} months with data · {selectedSummary?.totalDays?.toLocaleString() || 0} total days</span>
                                    <span>Latest market month: <strong className="text-gray-300">{latestDataMonth?.month || "—"}</strong>{latestDataMonth?.lastUpdatedAt ? ` · verified ${formatTimestamp(latestDataMonth.lastUpdatedAt)}` : ""}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                                    {detail.map((m) => (
                                        <button
                                            type="button"
                                            key={m.month}
                                            onClick={() => selectMonth(m.month)}
                                            className={`rounded-lg px-2 py-2 text-center outline-none ${pctColor(m.coveragePct)} ${selectedMonth === m.month ? "ring-2 ring-violet-400" : ""}`}
                                            title={`${m.days} of ${m.expectedDays ?? "?"} expected days, ${m.rows.toLocaleString()} rows, updated ${formatTimestamp(m.lastUpdatedAt)} — click to see exactly which days`}
                                        >
                                            <div className="text-[10px] font-medium opacity-80">{m.month}</div>
                                            <div className="text-sm font-bold">{m.days}{m.expectedDays != null ? `/${m.expectedDays}` : ""}</div>
                                            {dataType === "option_chain" && <div className="text-[9px] opacity-80">Opt {m.optionDays} · Spot {m.ohlcvDays}</div>}
                                            {dataType !== "option_chain" && <div className="text-[9px] opacity-80">{m.rows.toLocaleString()} rows</div>}
                                            {m.missingDays > 0 && <div className="text-[10px] opacity-80">−{m.missingDays}</div>}
                                            {m.lastUpdatedAt && <div className="mt-0.5 text-[9px] opacity-70">updated</div>}
                                        </button>
                                    ))}
                                </div>

                                {selectedMonth && (
                                    <div className="mt-4 border-t border-white/5 pt-3">
                                        <div className="mb-2 text-xs font-semibold text-gray-300">{selected} · {selectedMonth} — day by day</div>
                                        {!days ? (
                                            <div className="py-6 text-center text-xs text-gray-500">Loading…</div>
                                        ) : (
                                            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                                                {days.map((d) => (
                                                    <button
                                                        type="button"
                                                        onClick={() => selectDay(d.date)}
                                                        key={d.date}
                                                        className={`rounded-md px-1.5 py-1.5 text-center text-[10px] outline-none hover:ring-1 hover:ring-violet-400 ${d.hasData ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"} ${selectedDay === d.date ? "ring-2 ring-violet-400" : ""}`}
                                                        title={d.hasData ? `${d.date}: ${d.rows.toLocaleString()} rows (${d.minuteRows.toLocaleString()} minute rows)` : `${d.date}: no data — a genuine gap for this symbol`}
                                                    >
                                                        <div className="font-semibold">{d.date.slice(8)}</div>
                                                        <div className="opacity-80">{d.hasOptions ? `O ${d.rows.toLocaleString()}` : "O —"}</div>
                                                        <div className="opacity-80">{d.hasOhlcv ? `S ${d.ohlcvRows.toLocaleString()}` : "S —"}</div>
                                                    </button>
                                                ))}
                                                {!days.length && <div className="col-span-full py-4 text-center text-xs text-gray-500">No trading-day reference for this month.</div>}
                                            </div>
                                        )}
                                    </div>
                                )}
                                {selectedDay && (
                                    <div className="mt-4 border-t border-white/5 pt-3">
                                        <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-gray-300">
                                            <FiChevronRight className="h-3.5 w-3.5 text-violet-400" /> {selected} · {selectedDay} — minute by minute
                                        </div>
                                        {!minutes ? (
                                            <div className="py-6 text-center text-xs text-gray-500">Loading minute coverage…</div>
                                        ) : !minutes.minutes.length ? (
                                            <div className="py-6 text-center text-xs text-gray-500">No minute rows for this day.</div>
                                        ) : (
                                            <div className="max-h-80 overflow-auto rounded-lg border border-white/5">
                                                <table className="w-full text-left text-[11px]">
                                                    <thead className="sticky top-0 bg-[#101015] text-gray-500">
                                                        <tr>
                                                            <th className="px-2 py-2 font-medium">Time</th>
                                                            {dataType === "option_chain" ? <>
                                                                <th className="px-2 py-2 font-medium">Rows</th><th className="px-2 py-2 font-medium">CE / PE</th><th className="px-2 py-2 font-medium">CE vol</th><th className="px-2 py-2 font-medium">PE vol</th><th className="px-2 py-2 font-medium">Spot</th>
                                                            </> : <><th className="px-2 py-2 font-medium">Rows</th><th className="px-2 py-2 font-medium">Volume</th></>}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {minutes.minutes.map((row) => (
                                                            <tr key={row.time} onClick={() => selectMinute(row.time)} className={`cursor-pointer border-t border-white/5 text-gray-300 hover:bg-violet-500/10 ${selectedTime === row.time ? "bg-violet-500/10" : ""}`}>
                                                                <td className="px-2 py-1.5 font-mono">{row.time}</td>
                                                                {dataType === "option_chain" ? <>
                                                                    <td className="px-2 py-1.5">{row.rows.toLocaleString()}</td><td className="px-2 py-1.5">{row.ceRows} / {row.peRows}</td><td className="px-2 py-1.5">{row.ceVolume.toLocaleString()}</td><td className="px-2 py-1.5">{row.peVolume.toLocaleString()}</td><td className="px-2 py-1.5">{row.ohlcvMinuteRows ? "yes" : "—"}</td>
                                                                </> : <><td className="px-2 py-1.5">{row.rows.toLocaleString()}</td><td className="px-2 py-1.5">{row.volume.toLocaleString()}</td></>}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                        {selectedTime && (
                                            <div className="mt-3">
                                                {!minuteRows ? (
                                                    <div className="py-5 text-center text-xs text-gray-500">Loading strike snapshot…</div>
                                                ) : !minuteRows.rows.length ? (
                                                    <div className="py-5 text-center text-xs text-gray-500">No strike rows for this minute.</div>
                                                ) : (
                                                    <div className="max-h-96 overflow-auto rounded-lg border border-white/5">
                                                        <div className="border-b border-white/5 px-3 py-2 text-[11px] text-gray-500">{selectedDay} {selectedTime} · {minuteRows.rows.length.toLocaleString()} strikes</div>
                                                        <table className="w-full min-w-[760px] text-left text-[11px]">
                                                            <thead className="sticky top-0 bg-[#101015] text-gray-500">
                                                                <tr>
                                                                    <th className="px-2 py-2 font-medium">Strike</th><th className="px-2 py-2 font-medium">CE LTP</th><th className="px-2 py-2 font-medium">CE OI</th><th className="px-2 py-2 font-medium">CE Vol</th><th className="px-2 py-2 font-medium">CE Delta</th><th className="px-2 py-2 font-medium">PE LTP</th><th className="px-2 py-2 font-medium">PE OI</th><th className="px-2 py-2 font-medium">PE Vol</th><th className="px-2 py-2 font-medium">PE Delta</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {minuteRows.rows.map((row) => (
                                                                    <tr key={`${row.expiry}-${row.strike}`} className="border-t border-white/5 text-gray-300">
                                                                        <td className="px-2 py-1.5 font-semibold text-white">{row.strike.toLocaleString()}</td><td className="px-2 py-1.5 text-emerald-300">{row.ceLtp ?? "—"}</td><td className="px-2 py-1.5">{row.ceOi?.toLocaleString?.() ?? "—"}</td><td className="px-2 py-1.5">{row.ceVolume?.toLocaleString?.() ?? "—"}</td><td className="px-2 py-1.5">{row.ceDelta ?? "—"}</td><td className="px-2 py-1.5 text-rose-300">{row.peLtp ?? "—"}</td><td className="px-2 py-1.5">{row.peOi?.toLocaleString?.() ?? "—"}</td><td className="px-2 py-1.5">{row.peVolume?.toLocaleString?.() ?? "—"}</td><td className="px-2 py-1.5">{row.peDelta ?? "—"}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}
