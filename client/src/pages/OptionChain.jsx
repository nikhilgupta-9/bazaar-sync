// pages/OptionChain.jsx
import { useMemo, useState, useRef, useEffect } from "react";
import { useOptionChain } from "../hooks/useOptionChain";
import { formatPrice, formatPercent, formatDateTime, formatOi } from "../utils/format";
import { fetchSymbolList } from "../services/optionChainApi";
import ContractChartModal from "../components/ContractChartModal";
import OiBar from "../components/OiBar";
import BuildupBadge from "../components/BuildupBadge";

// Small chart icon shown on hover over an LTP cell
function ChartIcon() {
    return (
        <svg viewBox="0 0 20 20" fill="none" className="size-3.5">
            <path d="M3 15.5 7.5 10l3 3L17 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 5h4v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Fallback shown for the brief moment before /symbols/list resolves (or if
// it fails) — the 3 symbols the live worker actually covers.
const FALLBACK_SYMBOLS = { indices: ["NIFTY", "BANKNIFTY", "FINNIFTY"], stocks: [], liveSymbols: ["NIFTY", "BANKNIFTY", "FINNIFTY"] };

// Format Greeks with proper decimal places
function formatGreek(value, decimals = 2) {
    if (value == null || isNaN(value)) return "-";
    return Number(value).toFixed(decimals);
}

// Ratio helper for the Vol/OI column — how much of today's open interest
// traded hands today, a liquidity/freshness signal stockmojo shows per row.
function formatRatio(volume, oi) {
    if (!oi) return "-";
    return ((volume || 0) / oi).toFixed(2);
}

// Per-strike PCR / PCR(Vol) — the ratio at THIS strike only (not the chain-
// wide PCR shown in the header), matching stockmojo's middle-zone columns.
// Guards against near-empty-OI strikes producing meaningless triple-digit
// ratios (e.g. 5 contracts of OI on one side) — below MIN_BASE it's noise,
// not a real ratio, so show "-" instead of a distorted number.
const MIN_RATIO_BASE = 10;
function formatStrikeRatio(numerator, denominator) {
    if (!denominator || denominator < MIN_RATIO_BASE) return "-";
    return (numerator / denominator).toFixed(2);
}

// Big value on top, small colored %-change underneath — the LTP/IV cell
// pattern stockmojo uses everywhere (e.g. "364.00" / "-14%").
function ValueWithChange({ value, change, formatValue = formatPrice, align = "right" }) {
    return (
        <div className={`flex flex-col ${align === "right" ? "items-end" : "items-center"} leading-tight`}>
            <span className="tabular-nums">{formatValue(value)}</span>
            <span className={`text-[9px] tabular-nums ${change >= 0 ? "text-emerald-600" : change < 0 ? "text-rose-600" : "text-gray-300"}`}>
                {change != null ? formatPercent(change) : "-"}
            </span>
        </div>
    );
}

// Heatmap background for Volume/OI-Chg cells — intensity scales with
// magnitude relative to the max seen in the currently loaded chain, mirrors
// stockmojo's darker-green-for-bigger-numbers treatment.
function heatStyle(value, maxAbs) {
    if (value == null || !maxAbs) return {};
    const intensity = Math.min(1, Math.abs(value) / maxAbs);
    if (intensity < 0.05) return {};
    const alpha = 0.12 + intensity * 0.45;
    const color = value >= 0 ? `rgba(16,185,129,${alpha.toFixed(2)})` : `rgba(244,63,94,${alpha.toFixed(2)})`;
    return { backgroundColor: color };
}

export default function OptionChain() {
    const {
        symbol,
        data,
        loading,
        error,
        marketStatus,
        isLive,
        lastUpdated,
        setSymbol,
        load,
        refresh,
    } = useOptionChain();

    const [expiryFilter, setExpiryFilter] = useState(null);
    const [chartTarget, setChartTarget] = useState(null); // { strike, right } | null
    const [symbolList, setSymbolList] = useState(FALLBACK_SYMBOLS);
    const tableContainerRef = useRef(null);

    // Every symbol with real historical data (indices + 200+ F&O stocks from
    // Bhavcopy/Breeze) — fetched once, not the old hardcoded 3-index list.
    useEffect(() => {
        let cancelled = false;
        fetchSymbolList()
            .then((list) => {
                if (!cancelled) setSymbolList(list);
            })
            .catch(() => {
                /* keep FALLBACK_SYMBOLS — the dropdown still works with just the 3 live symbols */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Group into ITM, OTM, and Grand Totals
    const totals = useMemo(() => {
        if (!data || !data.rows) return null;
        const spot = data.spotPrice || 0;

        let ceItmOi = 0, ceItmVol = 0, ceOtmOi = 0, ceOtmVol = 0;
        let peItmOi = 0, peItmVol = 0, peOtmOi = 0, peOtmVol = 0;

        data.rows.forEach((r) => {
            if (r.strike < spot) {
                ceItmOi += r.ce.oi || 0;
                ceItmVol += r.ce.volume || 0;
                peOtmOi += r.pe.oi || 0;
                peOtmVol += r.pe.volume || 0;
            } else {
                ceOtmOi += r.ce.oi || 0;
                ceOtmVol += r.ce.volume || 0;
                peItmOi += r.pe.oi || 0;
                peItmVol += r.pe.volume || 0;
            }
        });

        return {
            ceItm: { oi: ceItmOi, vol: ceItmVol },
            ceOtm: { oi: ceOtmOi, vol: ceOtmVol },
            peItm: { oi: peItmOi, vol: peItmVol },
            peOtm: { oi: peOtmOi, vol: peOtmVol },
            totalCeOi: ceItmOi + ceOtmOi,
            totalPeOi: peItmOi + peOtmOi,
        };
    }, [data]);

    // Scaling references for the OI inline bars and the Volume/OI-Chg heatmap
    // shading — recomputed whenever the loaded chain changes, shared across
    // both call and put sides so the two halves of the table stay visually
    // comparable (a bigger bar always means a bigger number, same scale).
    const scale = useMemo(() => {
        if (!data || !data.rows) return { maxOi: 0, maxVolume: 0, maxOiChange: 0 };
        let maxOi = 0, maxVolume = 0, maxOiChange = 0;
        data.rows.forEach((r) => {
            maxOi = Math.max(maxOi, r.ce.oi || 0, r.pe.oi || 0);
            maxVolume = Math.max(maxVolume, r.ce.volume || 0, r.pe.volume || 0);
            maxOiChange = Math.max(maxOiChange, Math.abs(r.ce.oiChange || 0), Math.abs(r.pe.oiChange || 0));
        });
        return { maxOi, maxVolume, maxOiChange };
    }, [data]);

    const handleExpiryChange = (e) => {
        const expiry = e.target.value;
        setExpiryFilter(expiry);
        load(symbol, expiry);
    };

    return (
        <div className="mx-auto max-w-[1500px] px-2 py-4 bg-slate-50 min-h-screen font-sans text-gray-900">

            {/* Header Ribbon */}
            <div className="mb-4 bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <label htmlFor="asset-select" className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                            Select Asset:
                        </label>
                        <div className="relative inline-block text-left">
                            <select
                                id="asset-select"
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value)}
                                className="rounded border border-gray-300 bg-white appearance-none text-black-700 text-sm font-semibold rounded-md px-3 py-1 outline-hidden cursor-pointer transition-all shadow-sm max-w-[160px]"
                            >
                                <optgroup label="Indices">
                                    {symbolList.indices.map((s) => (
                                        <option key={s} value={s} className="bg-white text-black-700">
                                            {s}
                                            {!symbolList.liveSymbols.includes(s) ? " (Historical)" : ""}
                                        </option>
                                    ))}
                                </optgroup>
                                {symbolList.stocks.length > 0 && (
                                    <optgroup label="F&O Stocks">
                                        {symbolList.stocks.map((s) => (
                                            <option key={s} value={s} className="bg-white text-black-700">
                                                {s}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                                <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                                </svg>
                            </div>
                        </div>
                        <div className="relative inline-block text-left">
                            <select
                                value={data?.selectedExpiry || expiryFilter || ""}
                                onChange={handleExpiryChange}
                                className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium focus:outline-none focus:border-blue-500"
                            >
                                {data?.expiries?.map((exp) => (
                                    <option key={exp} value={exp}>{exp}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={refresh}
                            disabled={loading}
                            className="rounded bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition"
                        >
                            {loading ? "Refreshing..." : "⟳ Refresh"}
                        </button>
                    </div>
                </div>

                {/* Live Metrics Row */}
                {data && (
                    <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-6 text-xs text-gray-600">
                        <div className="flex items-center gap-1.5">
                            <span className={`inline-block h-2 w-2 rounded-full ${marketStatus.isOpen ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
                            <span className="font-bold uppercase">{marketStatus.isOpen ? 'Live' : 'Market Closed'}</span>
                        </div>
                        <div>Spot: <span className="font-bold text-gray-900 text-sm tabular-nums">{formatPrice(data.spotPrice)}</span></div>
                        <div>PCR: <span className={`font-bold tabular-nums ${data.pcr >= 1 ? 'text-emerald-600' : 'text-rose-600'}`}>{data.pcr ?? "-"}</span></div>
                        <div>Max Pain: <span className="font-bold text-orange-600 tabular-nums">{data.maxPainStrike}</span></div>
                        {data.daysToExpiry != null && (
                            <div className="text-gray-400">
                                {data.daysToExpiry} days to expiry
                            </div>
                        )}
                    </div>
                )}
            </div>

            {error && <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded text-xs">⚠️ {error}</div>}

            {chartTarget && data && (
                <ContractChartModal
                    symbol={data.symbol}
                    strike={chartTarget.strike}
                    expiry={data.selectedExpiry}
                    right={chartTarget.right}
                    onClose={() => setChartTarget(null)}
                />
            )}

            {/* Main Option Chain Grid with Greeks */}
            {data && data.rows ? (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto" ref={tableContainerRef}>
                        <table className="w-full text-left border-collapse text-[11px]">
                            <thead>
                                <tr className="text-center font-bold text-sm">
                                    <th colSpan={9} className="bg-emerald-50 text-emerald-800 border-b border-gray-200 py-2">CALLS</th>
                                    <th colSpan={4} className="bg-gray-100 border-b border-gray-200"></th>
                                    <th colSpan={5} className="bg-rose-50 text-rose-800 border-b border-gray-200 py-2">PUTS</th>
                                </tr>
                                <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-200 text-center">
                                    <th className="p-1.5">Delta</th>
                                    <th className="p-1.5">Buildup</th>
                                    <th className="p-1.5 text-right">Vol/OI</th>
                                    <th className="p-1.5 text-right">Volume</th>
                                    <th className="p-1.5 text-right">OI Chg%</th>
                                    <th className="p-1.5 text-right">OI Chg</th>
                                    <th className="p-1.5 text-right">OI</th>
                                    <th className="p-1.5 text-right">IV</th>
                                    <th className="p-1.5 text-right">LTP</th>
                                    <th className="bg-gray-100 text-gray-800 font-bold p-1.5">Strike</th>
                                    <th className="p-1.5 text-right">IV</th>
                                    <th className="p-1.5 text-right">PCR</th>
                                    <th className="p-1.5 text-right">PCR(Vol)</th>
                                    <th className="p-1.5 text-right">LTP</th>
                                    <th className="p-1.5 text-right">IV</th>
                                    <th className="p-1.5 text-right">OI</th>
                                    <th className="p-1.5 text-right">OI Chg</th>
                                    <th className="p-1.5 text-right">OI Chg%</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-100">
                                {data.rows.map((row) => {
                                    const ceItm = row.strike < data.spotPrice;
                                    const peItm = row.strike > data.spotPrice;
                                    const isMaxPain = row.strike === data.maxPainStrike;
                                    const isAtm = row.strike === data.atmStrike;

                                    return (
                                        <tr
                                            key={row.strike}
                                            className={`hover:bg-slate-50 transition-colors text-center font-medium ${
                                                isAtm ? "ring-1 ring-inset ring-blue-400" : ""
                                            }`}
                                        >
                                            {/* CALL SIDE */}
                                            <td className={`p-1 tabular-nums font-mono ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                {formatGreek(row.ce.delta)}
                                            </td>
                                            <td className={`p-1 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                <BuildupBadge code={row.ce.buildup} />
                                            </td>
                                            <td className={`p-1 text-right tabular-nums text-gray-500 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                {formatRatio(row.ce.volume, row.ce.oi)}
                                            </td>
                                            <td
                                                className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}
                                                style={heatStyle(row.ce.volume, scale.maxVolume)}
                                            >
                                                {formatOi(row.ce.volume)}
                                            </td>
                                            <td
                                                className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""} ${
                                                    row.ce.oiChangePercent >= 0 ? "text-emerald-600" : "text-rose-600"
                                                }`}
                                            >
                                                {row.ce.oiChangePercent != null ? formatPercent(row.ce.oiChangePercent) : "-"}
                                            </td>
                                            <td
                                                className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}
                                                style={heatStyle(row.ce.oiChange, scale.maxOiChange)}
                                            >
                                                {row.ce.oiChange != null ? formatOi(row.ce.oiChange) : "-"}
                                            </td>
                                            <td className={`p-1 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                <OiBar value={row.ce.oi} max={scale.maxOi} side="ce" />
                                            </td>
                                            <td className={`p-1 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                <ValueWithChange value={row.ce.iv} change={row.ce.ivChangePercent} formatValue={(v) => (v != null ? v : "-")} />
                                            </td>
                                            <td className={`group p-1 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                <span className="inline-flex items-center justify-end gap-1 w-full">
                                                    <ValueWithChange value={row.ce.ltp} change={row.ce.changePercent} />
                                                    <button
                                                        type="button"
                                                        onClick={() => setChartTarget({ strike: row.strike, right: "CE" })}
                                                        title="View chart"
                                                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity"
                                                    >
                                                        <ChartIcon />
                                                    </button>
                                                </span>
                                            </td>

                                            {/* STRIKE PRICE */}
                                            <td className="p-1 text-center font-bold bg-gray-100 border-x border-gray-200 text-gray-900 text-xs relative min-w-[70px]">
                                                {row.strike}
                                                {isMaxPain && (
                                                    <span className="block text-[8px] font-bold text-orange-600 leading-tight">Max Pain</span>
                                                )}
                                            </td>

                                            {/* NEUTRAL MIDDLE ZONE — put IV shown early (matches stockmojo), plus per-strike PCR */}
                                            <td className="p-1">
                                                <ValueWithChange value={row.pe.iv} change={row.pe.ivChangePercent} formatValue={(v) => (v != null ? v : "-")} align="center" />
                                            </td>
                                            <td className="p-1 text-right tabular-nums text-gray-600">{formatStrikeRatio(row.pe.oi, row.ce.oi)}</td>
                                            <td className="p-1 text-right tabular-nums text-gray-600">{formatStrikeRatio(row.pe.volume, row.ce.volume)}</td>

                                            {/* PUT SIDE */}
                                            <td className={`group p-1 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                <span className="inline-flex items-center justify-end gap-1 w-full">
                                                    <button
                                                        type="button"
                                                        onClick={() => setChartTarget({ strike: row.strike, right: "PE" })}
                                                        title="View chart"
                                                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity"
                                                    >
                                                        <ChartIcon />
                                                    </button>
                                                    <ValueWithChange value={row.pe.ltp} change={row.pe.changePercent} />
                                                </span>
                                            </td>
                                            <td className={`p-1 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                <ValueWithChange value={row.pe.iv} change={row.pe.ivChangePercent} formatValue={(v) => (v != null ? v : "-")} />
                                            </td>
                                            <td className={`p-1 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                <OiBar value={row.pe.oi} max={scale.maxOi} side="pe" />
                                            </td>
                                            <td
                                                className={`p-1 text-right tabular-nums ${peItm ? "bg-amber-50/60" : ""}`}
                                                style={heatStyle(row.pe.oiChange, scale.maxOiChange)}
                                            >
                                                {row.pe.oiChange != null ? formatOi(row.pe.oiChange) : "-"}
                                            </td>
                                            <td
                                                className={`p-1 text-right tabular-nums ${peItm ? "bg-amber-50/60" : ""} ${
                                                    row.pe.oiChangePercent >= 0 ? "text-emerald-600" : "text-rose-600"
                                                }`}
                                            >
                                                {row.pe.oiChangePercent != null ? formatPercent(row.pe.oiChangePercent) : "-"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>

                            {/* Totals Footer */}
                            {totals && (
                                <tfoot className="bg-slate-100 text-[11px] font-bold border-t-2 border-gray-300 text-right divide-y divide-gray-200">
                                    <tr>
                                        <td colSpan={3} className="p-1.5 text-emerald-700 text-left">ITM Total</td>
                                        <td colSpan={6} className="p-1.5 text-emerald-700">{formatOi(totals.ceItm.oi)}</td>
                                        <td className="bg-gray-200 p-1.5 text-center">ITM</td>
                                        <td colSpan={3} className="p-1.5 text-left text-rose-700">{formatOi(totals.peItm.oi)}</td>
                                        <td colSpan={5} className="p-1.5 text-left text-rose-700">ITM Total</td>
                                    </tr>
                                    <tr>
                                        <td colSpan={3} className="p-1.5 text-gray-600 text-left">OTM Total</td>
                                        <td colSpan={6} className="p-1.5 text-gray-600">{formatOi(totals.ceOtm.oi)}</td>
                                        <td className="bg-gray-200 p-1.5 text-center">OTM</td>
                                        <td colSpan={3} className="p-1.5 text-left text-gray-600">{formatOi(totals.peOtm.oi)}</td>
                                        <td colSpan={5} className="p-1.5 text-left text-gray-600">OTM Total</td>
                                    </tr>
                                    <tr className="bg-slate-200 text-gray-900">
                                        <td colSpan={3} className="p-2 text-left">Grand Total OI</td>
                                        <td colSpan={6} className="p-2 text-sm font-black">{formatOi(totals.totalCeOi)}</td>
                                        <td className="bg-gray-300 p-2 text-center text-xs">TOTALS</td>
                                        <td colSpan={3} className="p-2 text-sm font-black">{formatOi(totals.totalPeOi)}</td>
                                        <td colSpan={5} className="p-2 text-left">Grand Total OI</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            ) : (
                loading && <div className="p-12 text-center text-sm text-gray-500">Fetching live matrix feeds...</div>
            )}

            {/* Bottom Content Sections */}
            <hr className="my-8 border-gray-200" />

            {/* Section 1: Options Greeks Explanation */}
            <div className="mb-8">
                <h2 className="mb-4 text-xl font-bold text-gray-800">
                    {symbol === "NIFTY" ? "Nifty 50 (NIFTY)" : symbol} Option Chain: Greeks — Delta, Theta, Gamma, Vega
                </h2>
                <div className="grid gap-6 md:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            What is Delta in the {symbol} option chain?
                        </h3>
                        <p className="text-xs leading-relaxed text-gray-600">
                            Delta measures how much the {symbol} option premium changes when the underlying moves by 1 point. In the {symbol} chain, Delta ranges from 0 to 1 for calls and 0 to -1 for puts. ATM options have Delta near 0.5 — a 1-point {symbol} move changes the premium by about 0.50. Deep ITM options have Delta near 1.0 (moving point-for-point). Far OTM options have Delta near 0 (barely reacting).
                        </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            What is Theta and how it affects {symbol} option prices daily
                        </h3>
                        <p className="text-xs leading-relaxed text-gray-600">
                            Theta is the daily time decay — how much premium the {symbol} option loses each day just from time passing. In the option chain, ATM strikes show the highest Theta because they have the most time value to lose. Theta is always negative for option buyers (you lose money daily) and positive for sellers.
                        </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            What Gamma reveals about {symbol} options near expiry
                        </h3>
                        <p className="text-xs leading-relaxed text-gray-600">
                            Gamma measures how fast Delta changes as {symbol} moves. It is highest for ATM options near expiry. In the {symbol} chain, high Gamma strikes are the most reactive — small underlying moves cause large premium swings. On expiry day, Gamma at ATM {symbol} options can be extremely high.
                        </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            How Vega in the {symbol} chain helps you trade volatility
                        </h3>
                        <p className="text-xs leading-relaxed text-gray-600">
                            Vega tells you how much premium changes for a 1% change in IV. In the {symbol} option chain, ATM options typically have the highest Vega. If Vega is 10 and IV rises by 2%, the premium increases by Rs. 20 — regardless of what {symbol} price does.
                        </p>
                    </div>
                </div>
            </div>

            {/* Section 2: Intraday Trading Analysis */}
            <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-bold text-gray-800">
                    How to Analyse {symbol === "NIFTY" ? "Nifty 50 (NIFTY)" : symbol} Option Chain for Intraday Trading
                </h2>
                <div className="space-y-4 text-xs">
                    <div className="border-b border-gray-100 pb-3">
                        <h4 className="font-semibold text-gray-900 mb-1">Pre-market preparation</h4>
                        <p className="text-gray-600 leading-relaxed">
                            Before the market opens, check the {symbol} option chain's previous close data. Identify the top 3 call OI strikes (resistance) and top 3 put OI strikes (support). Note the PCR — above 1.0 is bullish bias, below 0.8 is bearish. Check max pain — where is the gravitational pull for expiry?
                        </p>
                    </div>
                    <div className="border-b border-gray-100 pb-3">
                        <h4 className="font-semibold text-gray-900 mb-1">Reading the first 15 minutes</h4>
                        <p className="text-gray-600 leading-relaxed">
                            The opening 15 minutes of the {symbol} option chain are the most information-rich of the day. Watch which strikes show the biggest OI Change — these are institutional orders setting the day's tone. Heavy put writing (Short Buildup at put strikes with rising OI) in the first 15 minutes is bullish.
                        </p>
                    </div>
                    <div className="border-b border-gray-100 pb-3">
                        <h4 className="font-semibold text-gray-900 mb-1">Tracking key levels throughout the session</h4>
                        <p className="text-gray-600 leading-relaxed">
                            During the session, the {symbol} option chain tells you when key levels are under pressure. Watch the OI Change at the highest put OI strike — if it turns negative (OI declining), support is crumbling. Watch the highest call OI strike — if OI drops there, resistance is breaking.
                        </p>
                    </div>
                    <div>
                        <h4 className="font-semibold text-gray-900 mb-1">End-of-day signals</h4>
                        <p className="text-gray-600 leading-relaxed">
                            The last hour (2:30-3:30 PM) is when institutions make their final positioning decisions. OI Change during this period is highly predictive for the next session. If fresh put writing appears in the last hour, institutions are bullish overnight.
                        </p>
                    </div>
                </div>
            </div>

            {/* Section 3: Deep Dive Meta Content */}
            <div className="mb-8 grid gap-6 md:grid-cols-3 text-xs">
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-2">About the NSE Option Chain</h4>
                    <p className="text-gray-600 leading-relaxed">
                        Free real-time and historical option chain with OI, volume, Greeks, and IV for Nifty 50, BankNifty, Sensex, and 200+ F&O stocks. Updates every second in live mode.
                    </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-2">Open Interest in the chain</h4>
                    <p className="text-gray-600 leading-relaxed">
                        Open Interest is the total count of outstanding option contracts. In the NSE chain, every strike has separate OI figures for calls and puts. Rising OI is fresh money entering, falling OI is positions getting squared off.
                    </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-2">Using the chain for Trading</h4>
                    <p className="text-gray-600 leading-relaxed">
                        Professional traders start the day by scanning the chain for the highest OI strikes on both sides. These define the expected range. If the top Call OI is at 22,500 and top Put OI is at 22,000, the implied range is 22,000-22,500.
                    </p>
                </div>
            </div>

            {/* Section 4: Accordion FAQs */}
            <div className="mb-8">
                <h2 className="mb-4 text-xl font-bold text-gray-800">Frequently Asked Questions</h2>
                <div className="space-y-3">
                    {[
                        {
                            q: "What is an option chain and how do you read it?",
                            a: "An option chain is a matrix listing all available strike prices for a stock or index, along with their corresponding Call and Put premiums, Open Interest (OI), and Volatility metrics. You read it by checking Calls on the left and Puts on the right, mapped directly against the centralized Strike prices."
                        },
                        {
                            q: "What columns matter most in the option chain?",
                            a: "The most vital columns are OI (Open Interest position sizing), Change in OI (intraday smart money positioning), LTP (Last Traded Price), Volume, and the real-time dynamic Buildup indicators."
                        },
                        {
                            q: "How are Greeks calculated in real time?",
                            a: "Greeks are calculated dynamically using the Black-Scholes pricing model, taking into account the live spot index price, option strike, current implied volatility (IV), risk-free interest rates, and exact time left until the final settlement boundary."
                        },
                        {
                            q: "What does open interest tell traders?",
                            a: "Open Interest reveals where option sellers have concentrated their capital risk. Large Call OI concentrations stand as heavy resistance barriers, while heavy Put OI blocks act as structural price floors."
                        }
                    ].map((faq, index) => (
                        <details key={index} className="group rounded-lg border border-gray-200 bg-white p-4 [&_summary::-webkit-details-marker]:hidden">
                            <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                                <span className="text-xs font-semibold text-gray-900">{faq.q}</span>
                                <span className="transition group-open:-rotate-180 text-gray-400 text-xs">▼</span>
                            </summary>
                            <p className="mt-3 text-xs leading-relaxed text-gray-600 border-t border-gray-100 pt-3">
                                {faq.a}
                            </p>
                        </details>
                    ))}
                </div>
            </div>

            {/* Section 5: Related Tools */}
            <div className="mb-12">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Related Tools</h3>
                <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 text-xs">
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">Max Pain</span>
                        <span className="text-[10px] text-gray-400">Where option sellers have minimum loss</span>
                    </div>
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">Open Interest</span>
                        <span className="text-[10px] text-gray-400">Call vs Put OI buildup matrix</span>
                    </div>
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">Put Call Ratio</span>
                        <span className="text-[10px] text-gray-400">Market sentiment tracker via PCR</span>
                    </div>
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">IV Chart</span>
                        <span className="text-[10px] text-gray-400">Implied volatility scaling trends</span>
                    </div>
                </div>
            </div>
        </div>
    );
}