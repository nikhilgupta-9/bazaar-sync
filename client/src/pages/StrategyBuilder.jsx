import { useMemo, useState } from "react";
import { useOptionChain } from "../hooks/useOptionChain";
import { formatPrice } from "../utils/format";
import {
    computePayoffCurve, computeBreakevens, computeMaxProfitLoss, computeNetGreeks,
    addMarkToMarketCurve, computeExpectedMove, computePOP,
} from "../utils/payoff";
import { yearsToExpiry, daysUntilExpiry } from "../utils/blackScholes";
import PayoffChart from "../components/PayoffChart";
import PresetStrategies from "../components/PresetStrategies";
import SaveButton from "../components/SaveButton";
import OiBar from "../components/OiBar";
import { saveStrategy } from "../services/strategiesApi";

function formatDelta(value) {
    return value == null || Number.isNaN(value) ? "-" : Number(value).toFixed(2);
}

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
let legIdCounter = 0;

function legFromRow(row, right, action) {
    const side = right === "CE" ? row.ce : row.pe;
    return {
        id: ++legIdCounter,
        action, // 'buy' | 'sell'
        type: right, // 'CE' | 'PE'
        strike: row.strike,
        premium: side.ltp,
        qty: 1,
        iv: side.iv,
        delta: side.delta,
        gamma: side.gamma,
        theta: side.theta,
        vega: side.vega,
    };
}

function Stat({ label, value, tone, hint }) {
    return (
        <div title={hint} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
            <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{label}</div>
            <div className={`text-sm font-bold tabular-nums mt-0.5 ${tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : "text-gray-800"}`}>
                {value}
            </div>
        </div>
    );
}

export default function StrategyBuilder() {
    const { symbol, setSymbol, data, loading, error, load } = useOptionChain();
    const [legs, setLegs] = useState([]);
    const [tab, setTab] = useState("positions"); // 'positions' | 'greeks'

    function addLeg(row, right, action) {
        setLegs((prev) => {
            if (prev.length >= 6) return prev; 
            return [...prev, legFromRow(row, right, action)];
        });
    }

    function removeLeg(id) {
        setLegs((prev) => prev.filter((l) => l.id !== id));
    }

    function updateQty(id, qty) {
        setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, qty: Math.max(1, qty) } : l)));
    }

    function resetLegs() {
        setLegs([]);
    }

    function applyPreset(presetLegs) {
        setLegs(presetLegs.map((l) => ({ ...l, id: ++legIdCounter })));
    }

    const rowByStrike = useMemo(() => {
        const map = new Map();
        if (!data || !data.rows) return map;
        data.rows.forEach((r) => map.set(r.strike, r));
        return map;
    }, [data]);

    const { maxCeOi, maxPeOi } = useMemo(() => {
        if (!data || !data.rows) return { maxCeOi: 0, maxPeOi: 0 };
        return data.rows.reduce(
            (acc, r) => ({
                maxCeOi: Math.max(acc.maxCeOi, r.ce?.oi || 0),
                maxPeOi: Math.max(acc.maxPeOi, r.pe?.oi || 0),
            }),
            { maxCeOi: 0, maxPeOi: 0 }
        );
    }, [data]);

    function legLivePnl(leg) {
        const row = rowByStrike.get(leg.strike);
        const currentLtp = row ? (leg.type === "CE" ? row.ce.ltp : row.pe.ltp) : null;
        if (currentLtp == null) return null;
        const diff = leg.action === "buy" ? currentLtp - leg.premium : leg.premium - currentLtp;
        return diff * leg.qty;
    }

    const { curve, breakevens, maxProfit, maxLoss, netGreeks, currentPnl, pop, expectedMove } = useMemo(() => {
        if (!legs.length || !data || !data.spotPrice) {
            return { curve: [], breakevens: [], maxProfit: null, maxLoss: null, netGreeks: null, currentPnl: null, pop: null, expectedMove: null };
        }
        
        try {
            const spread = data.spotPrice * 0.08;
            let curveData = computePayoffCurve(legs, { minPrice: data.spotPrice - spread, maxPrice: data.spotPrice + spread }) || [];
            const breakEvs = computeBreakevens(curveData) || [];
            const { maxProfit: mxProf, maxLoss: mxLoss } = computeMaxProfitLoss(legs, curveData);
            const netGrks = computeNetGreeks(legs);

            const yearsRemaining = yearsToExpiry(data.selectedExpiry);
            const atmRow = data.rows ? data.rows.find((r) => r.strike === data.atmStrike) : null;
            const atmIv = atmRow?.iv ?? null;

            curveData = (atmIv && typeof addMarkToMarketCurve === "function") ? addMarkToMarketCurve(curveData, legs, yearsRemaining) : curveData;
            const expMv = (atmIv && typeof computeExpectedMove === "function") ? computeExpectedMove(data.spotPrice, atmIv, yearsRemaining) : null;
            const popVal = (atmIv && typeof computePOP === "function") ? computePOP(curveData, data.spotPrice, atmIv, yearsRemaining) : null;

            const closest = curveData.length > 0 
                ? curveData.reduce((a, b) => (Math.abs(b.price - data.spotPrice) < Math.abs(a.price - data.spotPrice) ? b : a))
                : { pnl: 0 };

            return { curve: curveData, breakevens: breakEvs, maxProfit: mxProf, maxLoss: mxLoss, netGreeks: netGrks, currentPnl: closest.pnl, pop: popVal, expectedMove: expMv };
        } catch (err) {
            console.error(err);
            return { curve: [], breakevens: [], maxProfit: null, maxLoss: null, netGreeks: null, currentPnl: null, pop: null, expectedMove: null };
        }
    }, [legs, data]);

    return (
        <div className="mx-auto flex max-w-[1600px] gap-5 px-5 py-5 bg-gray-50/40 min-h-screen">
            {/* Left Column: Option Chain Window */}
            <div className="w-[540px] shrink-0 flex flex-col">
                <div className="mb-3 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="flex gap-1.5 bg-gray-100 p-1 rounded-lg">
                        {SYMBOLS.map((s) => (
                            <button
                                key={s}
                                onClick={() => { setSymbol(s); resetLegs(); }}
                                className={`rounded-md px-3 py-1.5 text-xs font-bold transition-all ${
                                    symbol === s ? "bg-white text-blue-600 shadow-sm" : "text-gray-600 hover:text-gray-900"
                                }`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>
                    {data && data.expiries && (
                        <select
                            value={data.selectedExpiry || ""}
                            onChange={(e) => load(symbol, e.target.value)}
                            className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium bg-gray-50 text-gray-700 outline-none focus:border-blue-500"
                        >
                            {data.expiries.map((exp) => (
                                <option key={exp} value={exp}>{exp} ({daysUntilExpiry ? daysUntilExpiry(exp) : 0}d)</option>
                            ))}
                        </select>
                    )}
                </div>

                {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
                {loading && !data && <div className="rounded-xl border border-gray-200 bg-white px-3 py-12 text-center text-xs text-gray-400">Fetching option matrix...</div>}

                {data && data.rows && (
                    <div className="max-h-[82vh] overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-sm custom-scrollbar">
                        <table className="w-full border-collapse text-[11px]">
                            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10 shadow-[0_1px_0_0_rgba(229,231,235,1)]">
                                <tr>
                                    <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[13%]">Call Δ</th>
                                    <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[15%]">LTP</th>
                                    <th className="px-1.5 py-2 text-right font-semibold text-gray-400 w-[18%]">OI</th>
                                    <th className="py-2 text-center font-bold text-gray-700 bg-gray-100/80 w-[16%] border-x border-gray-200">Strike</th>
                                    <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">OI</th>
                                    <th className="px-1.5 py-2 text-left font-semibold text-gray-400 w-[18%]">LTP</th>
                                    <th className="px-1.5 py-2 text-center font-semibold text-gray-400 w-[10%]">Put Δ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => {
                                    const ceItm = row.strike < data.spotPrice;
                                    const peItm = row.strike > data.spotPrice;
                                    const isAtm = row.strike === data.atmStrike;
                                    return (
                                        <tr key={row.strike} className={`border-b border-gray-100/70 transition-colors ${isAtm ? "bg-blue-50/60 font-semibold" : "hover:bg-gray-50/80"}`}>
                                            <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                {formatDelta(row.ce?.delta)}
                                            </td>
                                            {/* CALL SIDE */}
                                            <td className={`group px-1.5 py-1.5 text-right tabular-nums relative ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                <span className="text-gray-700 group-hover:invisible">{formatPrice(row.ce?.ltp)}</span>
                                                <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-0.5 bg-white">
                                                    <button onClick={() => addLeg(row, "CE", "buy")} className="rounded bg-emerald-500 hover:bg-emerald-600 shadow-sm px-1.5 py-0.5 text-[9px] font-extrabold text-white">B</button>
                                                    <button onClick={() => addLeg(row, "CE", "sell")} className="rounded bg-rose-500 hover:bg-rose-600 shadow-sm px-1.5 py-0.5 text-[9px] font-extrabold text-white">S</button>
                                                </div>
                                            </td>
                                            <td className={`p-0 tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                <OiBar value={row.ce?.oi} max={maxCeOi} side="ce" />
                                            </td>

                                            {/* STRIKE PRICE */}
                                            <td className="py-1.5 text-center font-bold text-gray-900 bg-gray-50/40 border-x border-gray-100 text-xs tabular-nums">{row.strike}</td>

                                            {/* PUT SIDE */}
                                            <td className={`p-0 tabular-nums ${peItm ? "bg-amber-50/60" : ""}`}>
                                                <OiBar value={row.pe?.oi} max={maxPeOi} side="pe" />
                                            </td>
                                            <td className={`group px-1.5 py-1.5 text-left tabular-nums relative ${peItm ? "bg-amber-50/60" : ""}`}>
                                                <span className="text-gray-700 group-hover:invisible">{formatPrice(row.pe?.ltp)}</span>
                                                <div className="invisible group-hover:visible absolute inset-0 flex items-center justify-center gap-0.5 bg-white">
                                                    <button onClick={() => addLeg(row, "PE", "buy")} className="rounded bg-emerald-500 hover:bg-emerald-600 shadow-sm px-1.5 py-0.5 text-[9px] font-extrabold text-white">B</button>
                                                    <button onClick={() => addLeg(row, "PE", "sell")} className="rounded bg-rose-500 hover:bg-rose-600 shadow-sm px-1.5 py-0.5 text-[9px] font-extrabold text-white">S</button>
                                                </div>
                                            </td>
                                            <td className={`px-1.5 py-1.5 text-center tabular-nums text-gray-400 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                {formatDelta(row.pe?.delta)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Right Column: Analytics, Chart, Profiles */}
            <div className="flex-1 flex flex-col">
                {legs.length === 0 ? (
                    <div className="flex-1 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                        <PresetStrategies data={data} onApply={applyPreset} />
                    </div>
                ) : (
                    <>
                        <div className="mb-3 flex items-center justify-end gap-2">
                            <SaveButton
                                itemLabel="strategy"
                                onSave={(token, name) => saveStrategy(token, { name, underlying: symbol, legs })}
                            />
                            <button onClick={resetLegs} className="rounded-xl border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 shadow-sm transition">
                                Reset Workspace
                            </button>
                        </div>

                        <div className="mb-4 flex gap-4 items-stretch">
                            {/* StockMojo Matched Vertical Status Column */}
                            <div className="w-48 shrink-0 flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                                <Stat label="Strategy P&L" value={formatPrice(currentPnl)} tone={currentPnl >= 0 ? "positive" : "negative"} />
                                <Stat label="Probability of Profit (POP)" value={pop != null ? `${pop.toFixed(0)}%` : "—"} hint="Normal distribution assumption breakdown strategy" />
                                <Stat label="Max Profit Potential" value={typeof maxProfit === "number" ? formatPrice(maxProfit) : (maxProfit || "Unlimited")} tone="positive" />
                                <Stat label="Max Loss Risk" value={typeof maxLoss === "number" ? formatPrice(maxLoss) : (maxLoss || "Unlimited")} tone="negative" />
                                <Stat label="Breakeven Thresholds" value={breakevens && breakevens.length ? breakevens.join(", ") : "None"} />
                                <Stat label="Workspace Constraints" value={`${legs.length} of 6 active legs`} />
                            </div>

                            <div className="flex-1 rounded-xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col justify-center">
                                <PayoffChart curve={curve} spotPrice={data?.spotPrice} breakevens={breakevens} expectedMove={expectedMove} />
                            </div>
                        </div>

                        {/* Interactive Position and Greeks Segment Control */}
                        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                            <div className="flex border-b border-gray-200 bg-gray-50/50 text-xs font-semibold">
                                <button
                                    onClick={() => setTab("positions")}
                                    className={`px-5 py-3 transition-colors ${tab === "positions" ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-800"}`}
                                >
                                    Active Positions ({legs.length})
                                </button>
                                <button
                                    onClick={() => setTab("greeks")}
                                    className={`px-5 py-3 transition-colors ${tab === "greeks" ? "border-b-2 border-blue-600 text-blue-600 bg-white" : "text-gray-500 hover:text-gray-800"}`}
                                >
                                    Portfolio Greeks
                                </button>
                            </div>

                            {tab === "positions" ? (
                                <table className="w-full border-collapse text-xs">
                                    <thead>
                                        <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-100">
                                            <th className="px-4 py-2.5 text-left font-medium">Action</th>
                                            <th className="px-4 py-2.5 text-left font-medium">Type</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Strike</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Entry Price</th>
                                            <th className="px-4 py-2.5 text-right font-medium">LTP</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Live P&L</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Lot Qty</th>
                                            <th className="px-4 py-2.5 w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {legs.map((leg) => {
                                            const row = rowByStrike.get(leg.strike);
                                            const currentLtp = row ? (leg.type === "CE" ? row.ce?.ltp : row.pe?.ltp) : null;
                                            const livePnl = legLivePnl(leg);
                                            return (
                                                <tr key={leg.id} className="hover:bg-gray-50/40 transition-colors">
                                                    <td className="px-4 py-2.5">
                                                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold text-white shadow-sm ${leg.action === "buy" ? "bg-emerald-500" : "bg-rose-500"}`}>
                                                            {leg.action === "buy" ? "BUY" : "SELL"}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2.5 font-medium text-gray-700">{leg.type}</td>
                                                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-gray-900">{leg.strike}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{formatPrice(leg.premium)}</td>
                                                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-900">{currentLtp != null ? formatPrice(currentLtp) : "-"}</td>
                                                    <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${livePnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                        {livePnl != null ? formatPrice(livePnl) : "-"}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            value={leg.qty}
                                                            onChange={(e) => updateQty(leg.id, Number(e.target.value))}
                                                            className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-right font-medium text-gray-800 focus:border-blue-500 outline-none"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2.5 text-center">
                                                        <button onClick={() => removeLeg(leg.id)} className="text-gray-400 hover:text-rose-600 font-bold transition">✕</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <table className="w-full border-collapse text-xs">
                                    <thead>
                                        <tr className="text-gray-400 bg-gray-50/40 border-b border-gray-100">
                                            <th className="px-4 py-2.5 text-left font-medium">Leg Matrix</th>
                                            <th className="px-4 py-2.5 text-right font-medium">IV %</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Delta</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Gamma</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Theta</th>
                                            <th className="px-4 py-2.5 text-right font-medium">Vega</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {legs.map((leg) => (
                                            <tr key={leg.id} className="hover:bg-gray-50/40 transition-colors">
                                                <td className="px-4 py-2.5 font-medium text-gray-700">{leg.action === "buy" ? "B" : "S"} {leg.strike} {leg.type}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.iv ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.delta ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.gamma ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.theta ?? "-"}</td>
                                                <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{leg.vega ?? "-"}</td>
                                            </tr>
                                        ))}
                                        {netGreeks && (
                                            <tr className="font-bold bg-blue-50/30 border-t-2 border-gray-200 text-gray-900">
                                                <td className="px-4 py-3">Net Risk Aggregates</td>
                                                <td className="px-4 py-3"></td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.delta || 0).toFixed(3)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.gamma || 0).toFixed(6)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.theta || 0).toFixed(3)}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-blue-600">{(netGreeks.vega || 0).toFixed(3)}</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}