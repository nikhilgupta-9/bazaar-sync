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
import { saveStrategy } from "../services/strategiesApi";

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

export default function StrategyBuilder() {
    const { symbol, setSymbol, data, loading, error, load } = useOptionChain();
    const [legs, setLegs] = useState([]);
    const [tab, setTab] = useState("positions"); // 'positions' | 'greeks'

    function addLeg(row, right, action) {
        setLegs((prev) => {
            if (prev.length >= 6) return prev; // up to 6 legs
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

    // Live premium lookup for each leg's strike, from the currently loaded
    // chain — this is the *real* current LTP (not a Black-Scholes estimate),
    // used for the per-leg P&L column in the Positions table.
    const rowByStrike = useMemo(() => {
        const map = new Map();
        data?.rows.forEach((r) => map.set(r.strike, r));
        return map;
    }, [data]);

    function legLivePnl(leg) {
        const row = rowByStrike.get(leg.strike);
        const currentLtp = row ? (leg.type === "CE" ? row.ce.ltp : row.pe.ltp) : null;
        if (currentLtp == null) return null;
        const diff = leg.action === "buy" ? currentLtp - leg.premium : leg.premium - currentLtp;
        return diff * leg.qty;
    }

    const { curve, breakevens, maxProfit, maxLoss, netGreeks, currentPnl, pop, expectedMove } = useMemo(() => {
        if (!legs.length || !data) {
            return { curve: [], breakevens: [], maxProfit: null, maxLoss: null, netGreeks: null, currentPnl: null, pop: null, expectedMove: null };
        }
        const spread = data.spotPrice * 0.08;
        let curve = computePayoffCurve(legs, { minPrice: data.spotPrice - spread, maxPrice: data.spotPrice + spread });
        const breakevens = computeBreakevens(curve);
        const { maxProfit, maxLoss } = computeMaxProfitLoss(legs, curve);
        const netGreeks = computeNetGreeks(legs);

        const yearsRemaining = yearsToExpiry(data.selectedExpiry);
        const atmRow = data.rows.find((r) => r.strike === data.atmStrike);
        const atmIv = atmRow?.iv ?? null;

        curve = atmIv ? addMarkToMarketCurve(curve, legs, yearsRemaining) : curve;
        const expectedMove = atmIv ? computeExpectedMove(data.spotPrice, atmIv, yearsRemaining) : null;
        const pop = atmIv ? computePOP(curve, data.spotPrice, atmIv, yearsRemaining) : null;

        const closest = curve.reduce((a, b) => (Math.abs(b.price - data.spotPrice) < Math.abs(a.price - data.spotPrice) ? b : a));
        return { curve, breakevens, maxProfit, maxLoss, netGreeks, currentPnl: closest.pnl, pop, expectedMove };
    }, [legs, data]);

    return (
        <div className="mx-auto flex max-w-[1500px] gap-4 px-4 py-4">
            {/* Left: compact option chain with inline Buy/Sell */}
            <div className="w-[420px] shrink-0">
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                    {SYMBOLS.map((s) => (
                        <button
                            key={s}
                            onClick={() => { setSymbol(s); resetLegs(); }}
                            className={`rounded-md px-2 py-1 text-xs font-semibold ${
                                symbol === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                        >
                            {s}
                        </button>
                    ))}
                    {data && (
                        <select
                            value={data.selectedExpiry}
                            onChange={(e) => load(symbol, e.target.value)}
                            className="ml-auto rounded-md border border-gray-300 px-2 py-1 text-xs"
                        >
                            {data.expiries.map((exp) => (
                                <option key={exp} value={exp}>{exp} ({daysUntilExpiry(exp)}d)</option>
                            ))}
                        </select>
                    )}
                </div>

                {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
                {loading && !data && <div className="rounded-lg border border-gray-200 bg-white px-3 py-6 text-center text-xs text-gray-500">Loading…</div>}

                {data && (
                    <div className="max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white">
                        <table className="w-full border-collapse text-[11px]">
                            <thead className="sticky top-0 bg-gray-50">
                                <tr>
                                    <th className="border-b border-gray-200 px-2 py-1.5 text-left font-medium text-gray-500">Call LTP</th>
                                    <th className="border-b border-gray-200 px-2 py-1.5 font-semibold text-gray-700">Strike</th>
                                    <th className="border-b border-gray-200 px-2 py-1.5 text-right font-medium text-gray-500">Put LTP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.rows.map((row) => (
                                    <tr key={row.strike} className={row.strike === data.atmStrike ? "bg-blue-50" : "hover:bg-gray-50"}>
                                        <td className="group relative px-2 py-1 tabular-nums">
                                            {formatPrice(row.ce.ltp)}
                                            <span className="ml-1 hidden gap-0.5 group-hover:inline-flex">
                                                <button onClick={() => addLeg(row, "CE", "buy")} className="rounded bg-emerald-500 px-1 text-[10px] font-bold text-white">B</button>
                                                <button onClick={() => addLeg(row, "CE", "sell")} className="rounded bg-rose-500 px-1 text-[10px] font-bold text-white">S</button>
                                            </span>
                                        </td>
                                        <td className="px-2 py-1 text-center font-semibold tabular-nums">{row.strike}</td>
                                        <td className="group relative px-2 py-1 text-right tabular-nums">
                                            <span className="mr-1 hidden gap-0.5 group-hover:inline-flex">
                                                <button onClick={() => addLeg(row, "PE", "buy")} className="rounded bg-emerald-500 px-1 text-[10px] font-bold text-white">B</button>
                                                <button onClick={() => addLeg(row, "PE", "sell")} className="rounded bg-rose-500 px-1 text-[10px] font-bold text-white">S</button>
                                            </span>
                                            {formatPrice(row.pe.ltp)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Right: presets, payoff, positions/greeks */}
            <div className="flex-1">
                {legs.length === 0 ? (
                    <PresetStrategies data={data} onApply={applyPreset} />
                ) : (
                    <>
                        <div className="mb-3 flex items-center justify-end gap-2">
                            <SaveButton
                                itemLabel="strategy"
                                onSave={(token, name) => saveStrategy(token, { name, underlying: symbol, legs })}
                            />
                            <button onClick={resetLegs} className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
                                Reset
                            </button>
                        </div>

                        <div className="mb-3 flex gap-3">
                            {/* Vertical stats sidebar, matching stockmojo's layout (not horizontal cards) */}
                            <div className="w-44 shrink-0 space-y-3 rounded-lg border border-gray-200 bg-white p-3">
                                <Stat label="P&L" value={formatPrice(currentPnl)} tone={currentPnl >= 0 ? "positive" : "negative"} />
                                <Stat label="Est. Margin" value="—" hint="Not computed — needs broker SPAN margin data" />
                                <Stat label="POP" value={pop != null ? `${pop.toFixed(0)}%` : "—"} hint="Approximate — assumes a normal price distribution" />
                                <Stat label="Max Profit" value={typeof maxProfit === "number" ? formatPrice(maxProfit) : maxProfit} tone="positive" />
                                <Stat label="Max Loss" value={typeof maxLoss === "number" ? formatPrice(maxLoss) : maxLoss} tone="negative" />
                                <Stat label="Breakevens" value={breakevens.length ? breakevens.join(", ") : "-"} />
                                <Stat label="Legs" value={`${legs.length} / 6`} />
                            </div>

                            <div className="flex-1 rounded-lg border border-gray-200 bg-white p-4">
                                <PayoffChart curve={curve} spotPrice={data?.spotPrice} breakevens={breakevens} expectedMove={expectedMove} />
                            </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white">
                            <div className="flex border-b border-gray-200 text-sm">
                                <button
                                    onClick={() => setTab("positions")}
                                    className={`px-4 py-2 font-medium ${tab === "positions" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
                                >
                                    Positions
                                </button>
                                <button
                                    onClick={() => setTab("greeks")}
                                    className={`px-4 py-2 font-medium ${tab === "greeks" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}
                                >
                                    Greeks
                                </button>
                            </div>

                            {tab === "positions" ? (
                                <table className="w-full border-collapse text-xs">
                                    <thead>
                                        <tr className="text-gray-500">
                                            <th className="px-3 py-2 text-left font-medium">Action</th>
                                            <th className="px-3 py-2 text-left font-medium">Type</th>
                                            <th className="px-3 py-2 text-right font-medium">Strike</th>
                                            <th className="px-3 py-2 text-right font-medium">Entry</th>
                                            <th className="px-3 py-2 text-right font-medium">LTP</th>
                                            <th className="px-3 py-2 text-right font-medium">P&L</th>
                                            <th className="px-3 py-2 text-right font-medium">Qty</th>
                                            <th className="px-3 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {legs.map((leg) => {
                                            const row = rowByStrike.get(leg.strike);
                                            const currentLtp = row ? (leg.type === "CE" ? row.ce.ltp : row.pe.ltp) : null;
                                            const livePnl = legLivePnl(leg);
                                            return (
                                                <tr key={leg.id} className="border-t border-gray-100">
                                                    <td className="px-3 py-2">
                                                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${leg.action === "buy" ? "bg-emerald-500" : "bg-rose-500"}`}>
                                                            {leg.action === "buy" ? "BUY" : "SELL"}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2">{leg.type}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{leg.strike}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{formatPrice(leg.premium)}</td>
                                                    <td className="px-3 py-2 text-right tabular-nums">{currentLtp != null ? formatPrice(currentLtp) : "-"}</td>
                                                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${livePnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                        {livePnl != null ? formatPrice(livePnl) : "-"}
                                                    </td>
                                                    <td className="px-3 py-2 text-right">
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            value={leg.qty}
                                                            onChange={(e) => updateQty(leg.id, Number(e.target.value))}
                                                            className="w-16 rounded border border-gray-300 px-1 py-0.5 text-right tabular-nums"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 text-right">
                                                        <button onClick={() => removeLeg(leg.id)} className="text-gray-400 hover:text-rose-600">✕</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            ) : (
                                <table className="w-full border-collapse text-xs">
                                    <thead>
                                        <tr className="text-gray-500">
                                            <th className="px-3 py-2 text-left font-medium">Leg</th>
                                            <th className="px-3 py-2 text-right font-medium">IV</th>
                                            <th className="px-3 py-2 text-right font-medium">Delta</th>
                                            <th className="px-3 py-2 text-right font-medium">Gamma</th>
                                            <th className="px-3 py-2 text-right font-medium">Theta</th>
                                            <th className="px-3 py-2 text-right font-medium">Vega</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {legs.map((leg) => (
                                            <tr key={leg.id} className="border-t border-gray-100">
                                                <td className="px-3 py-2">{leg.action === "buy" ? "B" : "S"} {leg.strike} {leg.type}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{leg.iv ?? "-"}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{leg.delta ?? "-"}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{leg.gamma ?? "-"}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{leg.theta ?? "-"}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{leg.vega ?? "-"}</td>
                                            </tr>
                                        ))}
                                        {netGreeks && (
                                            <tr className="border-t-2 border-gray-300 font-semibold">
                                                <td className="px-3 py-2">Net</td>
                                                <td className="px-3 py-2"></td>
                                                <td className="px-3 py-2 text-right tabular-nums">{netGreeks.delta.toFixed(3)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{netGreeks.gamma.toFixed(6)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{netGreeks.theta.toFixed(3)}</td>
                                                <td className="px-3 py-2 text-right tabular-nums">{netGreeks.vega.toFixed(3)}</td>
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

function Stat({ label, value, tone, hint }) {
    return (
        <div title={hint}>
            <div className="text-[11px] text-gray-500">{label}</div>
            <div className={`text-sm font-bold tabular-nums ${tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : "text-gray-900"}`}>
                {value}
            </div>
        </div>
    );
}
