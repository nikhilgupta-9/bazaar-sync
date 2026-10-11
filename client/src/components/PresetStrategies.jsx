// components/PresetStrategies.jsx — StockMojo-parity Ready-Made Strategy Matrix
// Comprehensive options strategy templates with live chain strike mapping,
// category filtering, instant search, risk classifications, and 1-click execution.

import React, { useMemo, useState } from "react";
import PayoffIcon from "./PayoffIcon";
import { FiSearch, FiArrowRight, FiShield, FiTrendingUp, FiTrendingDown, FiActivity } from "react-icons/fi";

const CATEGORIES = ["Bullish", "Bearish", "Neutral", "Other"];

function buildPresets(data) {
    if (!data || !data.rows?.length) return [];
    
    // Sorted strikes list
    const strikes = data.rows.map((r) => Number(r.strike)).sort((a, b) => a - b);
    const atm = Number(data.atmStrike);
    let atmIdx = strikes.indexOf(atm);
    if (atmIdx === -1) {
        // Find closest strike to ATM
        let closestDist = Infinity;
        strikes.forEach((s, idx) => {
            const dist = Math.abs(s - atm);
            if (dist < closestDist) {
                closestDist = dist;
                atmIdx = idx;
            }
        });
    }

    const legAtOffset = (offset, type, action, qty = 1, exp = data.selectedExpiry) => {
        const targetIdx = atmIdx + offset;
        if (targetIdx < 0 || targetIdx >= strikes.length) return null;
        const targetStrike = strikes[targetIdx];
        const row = data.rows.find((r) => Number(r.strike) === targetStrike);
        if (!row) return null;
        const side = type === "CE" ? row.ce : row.pe;
        return {
            action, // "buy" | "sell"
            type,   // "CE" | "PE"
            strike: targetStrike,
            premium: Number(side?.ltp ?? 0),
            qty,
            lotSize: data.lotSize || 50,
            iv: side?.iv != null ? Number(side.iv) : null,
            delta: side?.delta != null ? Number(side.delta) : null,
            gamma: side?.gamma != null ? Number(side.gamma) : null,
            theta: side?.theta != null ? Number(side.theta) : null,
            vega: side?.vega != null ? Number(side.vega) : null,
            expiry: exp,
        };
    };

    const compact = (legs) => legs.filter(Boolean);

    const farExpiry = data.expiries && data.selectedExpiry
        ? data.expiries.find((e) => e > data.selectedExpiry) || null
        : null;

    return [
        // ================================================================
        // 1. BULLISH STRATEGIES (9 strategies matching StockMojo)
        // ================================================================
        {
            name: "Buy Call",
            type: "buy_call",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Single ATM Call option buy. Maximum profit is unlimited as underlying moves higher.",
            shape: "buy-call",
            legs: compact([legAtOffset(0, "CE", "buy")]),
        },
        {
            name: "Sell Put",
            type: "sell_put",
            bias: "Bullish",
            risk: "Undefined",
            flow: "Credit",
            summary: "Single ATM Put sell. Bullish income generation, collects full premium if underlying stays above strike.",
            shape: "sell-put",
            legs: compact([legAtOffset(0, "PE", "sell")]),
        },
        {
            name: "Long Synthetic Future",
            type: "long_synthetic_future",
            bias: "Bullish",
            risk: "Undefined",
            flow: "Debit / Credit",
            summary: "Buy ATM Call + Sell ATM Put. Fully replicates a long futures position with 1.0 delta.",
            shape: "long-synthetic-future",
            legs: compact([legAtOffset(0, "CE", "buy"), legAtOffset(0, "PE", "sell")]),
        },
        {
            name: "Bull Call Spread",
            type: "bull_call_spread",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ATM Call + Sell OTM Call (+2 strikes). Lower entry debit with strictly capped risk.",
            shape: "bull-call-spread",
            legs: compact([legAtOffset(0, "CE", "buy"), legAtOffset(2, "CE", "sell")]),
        },
        {
            name: "Bull Put Spread",
            type: "bull_put_spread",
            bias: "Bullish",
            risk: "Defined",
            flow: "Credit",
            summary: "Buy OTM Put (-2 strikes) + Sell ATM Put. Net credit spread, profits if underlying closes above ATM.",
            shape: "bull-put-spread",
            legs: compact([legAtOffset(-2, "PE", "buy"), legAtOffset(0, "PE", "sell")]),
        },
        {
            name: "Long Calendar with Calls",
            type: "long_calendar_with_calls",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Sell near-expiry OTM Call (+2 strikes) + Buy far-expiry OTM Call (+2 strikes). Capitalizes on time decay.",
            shape: "long-calendar-call",
            legCount: farExpiry ? 2 : 0,
            buildLegs: farExpiry
                ? async (fetchExpiryRows) => {
                    const nearLeg = legAtOffset(2, "CE", "sell", 1, data.selectedExpiry);
                    if (!nearLeg || !fetchExpiryRows) return [];
                    const farRows = await fetchExpiryRows(farExpiry);
                    const farRow = farRows.find((r) => Number(r.strike) === nearLeg.strike);
                    if (!farRow || farRow.ce?.ltp == null) return [];
                    const farLeg = {
                        action: "buy",
                        type: "CE",
                        strike: nearLeg.strike,
                        qty: 1,
                        lotSize: data.lotSize || 50,
                        premium: Number(farRow.ce.ltp),
                        iv: farRow.ce.iv != null ? Number(farRow.ce.iv) : null,
                        delta: farRow.ce.delta != null ? Number(farRow.ce.delta) : null,
                        expiry: farExpiry,
                    };
                    return [nearLeg, farLeg];
                }
                : null,
            legs: compact([legAtOffset(2, "CE", "sell")]),
        },
        {
            name: "Bull Condor",
            type: "bull_condor",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ITM Call (-2 strikes) + Sell ITM Call (-1 strike) + Sell OTM Call (+1 strike) + Buy OTM Call (+2 strikes).",
            shape: "bull-condor",
            legs: compact([
                legAtOffset(-2, "CE", "buy"),
                legAtOffset(-1, "CE", "sell"),
                legAtOffset(1, "CE", "sell"),
                legAtOffset(2, "CE", "buy"),
            ]),
        },
        {
            name: "Bull Butterfly",
            type: "bull_butterfly",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy Call (+2 strikes) + Sell 2 Calls (+4 strikes) + Buy Call (+6 strikes). Targeted upside peak.",
            shape: "bull-butterfly",
            legs: compact([
                legAtOffset(2, "CE", "buy"),
                legAtOffset(4, "CE", "sell", 2),
                legAtOffset(6, "CE", "buy"),
            ]),
        },
        {
            name: "Range Forward",
            type: "range_forward",
            bias: "Bullish",
            risk: "Undefined Downside",
            flow: "Zero Cost / Credit",
            summary: "Sell OTM Put (-3 strikes) + Buy OTM Call (+3 strikes). Synthetic future with a flat cost buffer.",
            shape: "range-forward",
            legs: compact([
                legAtOffset(-3, "PE", "sell"),
                legAtOffset(3, "CE", "buy"),
            ]),
        },

        // ================================================================
        // 2. BEARISH STRATEGIES (9 strategies matching StockMojo)
        // ================================================================
        {
            name: "Buy Put",
            type: "buy_put",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Single ATM Put option buy. Maximum profit expands as underlying falls.",
            shape: "buy-put",
            legs: compact([legAtOffset(0, "PE", "buy")]),
        },
        {
            name: "Sell Call",
            type: "sell_call",
            bias: "Bearish",
            risk: "Undefined",
            flow: "Credit",
            summary: "Single ATM Call option sell. Collects premium if underlying remains below strike.",
            shape: "sell-call",
            legs: compact([legAtOffset(0, "CE", "sell")]),
        },
        {
            name: "Short Synthetic Future",
            type: "short_synthetic_future",
            bias: "Bearish",
            risk: "Undefined",
            flow: "Debit / Credit",
            summary: "Sell ATM Call + Buy ATM Put. Fully replicates a short futures position with -1.0 delta.",
            shape: "short-synthetic-future",
            legs: compact([legAtOffset(0, "CE", "sell"), legAtOffset(0, "PE", "buy")]),
        },
        {
            name: "Bear Call Spread",
            type: "bear_call_spread",
            bias: "Bearish",
            risk: "Defined",
            flow: "Credit",
            summary: "Buy OTM Call (+2 strikes) + Sell ATM Call. Net credit spread, maximum profit if price drops.",
            shape: "bear-call-spread",
            legs: compact([legAtOffset(2, "CE", "buy"), legAtOffset(0, "CE", "sell")]),
        },
        {
            name: "Bear Put Spread",
            type: "bear_put_spread",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ATM Put + Sell OTM Put (-2 strikes). Cost-effective bearish strategy with defined protection.",
            shape: "bear-put-spread",
            legs: compact([legAtOffset(0, "PE", "buy"), legAtOffset(-2, "PE", "sell")]),
        },
        {
            name: "Long Calendar with Puts",
            type: "long_calendar_with_puts",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Sell near-expiry OTM Put (-2 strikes) + Buy far-expiry OTM Put (-2 strikes). Benefits from theta decay.",
            shape: "long-calendar-put",
            legCount: farExpiry ? 2 : 0,
            buildLegs: farExpiry
                ? async (fetchExpiryRows) => {
                    const nearLeg = legAtOffset(-2, "PE", "sell", 1, data.selectedExpiry);
                    if (!nearLeg || !fetchExpiryRows) return [];
                    const farRows = await fetchExpiryRows(farExpiry);
                    const farRow = farRows.find((r) => Number(r.strike) === nearLeg.strike);
                    if (!farRow || farRow.pe?.ltp == null) return [];
                    const farLeg = {
                        action: "buy",
                        type: "PE",
                        strike: nearLeg.strike,
                        qty: 1,
                        lotSize: data.lotSize || 50,
                        premium: Number(farRow.pe.ltp),
                        iv: farRow.pe.iv != null ? Number(farRow.pe.iv) : null,
                        delta: farRow.pe.delta != null ? Number(farRow.pe.delta) : null,
                        expiry: farExpiry,
                    };
                    return [nearLeg, farLeg];
                }
                : null,
            legs: compact([legAtOffset(-2, "PE", "sell")]),
        },
        {
            name: "Bear Condor",
            type: "bear_condor",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ITM Put (+2 strikes) + Sell ITM Put (+1 strike) + Sell OTM Put (-1 strike) + Buy OTM Put (-2 strikes).",
            shape: "bear-condor",
            legs: compact([
                legAtOffset(2, "PE", "buy"),
                legAtOffset(1, "PE", "sell"),
                legAtOffset(-1, "PE", "sell"),
                legAtOffset(-2, "PE", "buy"),
            ]),
        },
        {
            name: "Bear Butterfly",
            type: "bear_butterfly",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy Put (-1 strike) + Sell 2 Puts (-3 strikes) + Buy Put (-5 strikes). Targeted downside profit peak.",
            shape: "bear-butterfly",
            legs: compact([
                legAtOffset(-1, "PE", "buy"),
                legAtOffset(-3, "PE", "sell", 2),
                legAtOffset(-5, "PE", "buy"),
            ]),
        },
        {
            name: "Risk Reversal",
            type: "risk_reversal",
            bias: "Bearish",
            risk: "Undefined Upside",
            flow: "Credit / Debit",
            summary: "Sell OTM Call (+3 strikes) + Buy OTM Put (-3 strikes). Downside hedge financed by upside call credit.",
            shape: "risk-reversal",
            legs: compact([
                legAtOffset(3, "CE", "sell"),
                legAtOffset(-3, "PE", "buy"),
            ]),
        },

        // ================================================================
        // 3. NEUTRAL STRATEGIES (8 strategies matching StockMojo)
        // ================================================================
        {
            name: "Short Straddle",
            type: "short_straddle",
            bias: "Neutral",
            risk: "Undefined",
            flow: "Credit",
            summary: "Sell ATM Call + Sell ATM Put. Max profit collected when underlying expires precisely at ATM strike.",
            shape: "short-straddle",
            legs: compact([legAtOffset(0, "CE", "sell"), legAtOffset(0, "PE", "sell")]),
        },
        {
            name: "Short Strangle",
            type: "short_strangle",
            bias: "Neutral",
            risk: "Undefined",
            flow: "Credit",
            summary: "Sell OTM Call (+2 strikes) + Sell OTM Put (-2 strikes). Wide profit zone between strikes.",
            shape: "short-strangle",
            legs: compact([legAtOffset(2, "CE", "sell"), legAtOffset(-2, "PE", "sell")]),
        },
        {
            name: "Short Iron Condor",
            type: "short_iron_condor",
            bias: "Neutral",
            risk: "Defined",
            flow: "Credit",
            summary: "Buy Call (+3) + Sell Call (+1) + Sell Put (-1) + Buy Put (-3). Defined risk neutral income range.",
            shape: "short-iron-condor",
            legs: compact([
                legAtOffset(3, "CE", "buy"),
                legAtOffset(1, "CE", "sell"),
                legAtOffset(-1, "PE", "sell"),
                legAtOffset(-3, "PE", "buy"),
            ]),
        },
        {
            name: "Short Iron Butterfly",
            type: "short_iron_butterfly",
            bias: "Neutral",
            risk: "Defined",
            flow: "Credit",
            summary: "Buy Call (+2) + Sell ATM Call + Sell ATM Put + Buy Put (-2). High credit with capped wings.",
            shape: "short-iron-butterfly",
            legs: compact([
                legAtOffset(2, "CE", "buy"),
                legAtOffset(0, "CE", "sell"),
                legAtOffset(0, "PE", "sell"),
                legAtOffset(-2, "PE", "buy"),
            ]),
        },
        {
            name: "Batman",
            type: "batman",
            bias: "Neutral",
            risk: "Defined",
            flow: "Credit / Debit",
            summary: "Buy Call (+3) + Sell 2 Calls (+4) + Buy Put (-3) + Sell 2 Puts (-4). Double peak sweet spot wings.",
            shape: "batman",
            legs: compact([
                legAtOffset(3, "CE", "buy"),
                legAtOffset(4, "CE", "sell", 2),
                legAtOffset(-3, "PE", "buy"),
                legAtOffset(-4, "PE", "sell", 2),
            ]),
        },
        {
            name: "Jade Lizard",
            type: "jade_lizard",
            bias: "Neutral",
            risk: "Undefined Downside",
            flow: "Credit",
            summary: "Sell OTM Put (-2) + Sell ATM Call + Buy OTM Call (+2). No upside risk if net credit > spread width.",
            shape: "jade-lizard",
            legs: compact([
                legAtOffset(-2, "PE", "sell"),
                legAtOffset(0, "CE", "sell"),
                legAtOffset(2, "CE", "buy"),
            ]),
        },
        {
            name: "Reverse Jade Lizard",
            type: "reverse_jade_lizard",
            bias: "Neutral",
            risk: "Undefined Upside",
            flow: "Credit",
            summary: "Sell OTM Call (+2) + Sell ATM Put + Buy OTM Put (-2). No downside risk if net credit > spread width.",
            shape: "reverse-jade-lizard",
            legs: compact([
                legAtOffset(2, "CE", "sell"),
                legAtOffset(0, "PE", "sell"),
                legAtOffset(-2, "PE", "buy"),
            ]),
        },
        {
            name: "Double Plateau",
            type: "double_plateau",
            bias: "Neutral",
            risk: "Defined",
            flow: "Credit",
            summary: "Multi-leg ladder spread with two distinct flat profit plateau zones on either side of ATM.",
            shape: "double-plateau",
            legs: compact([
                legAtOffset(2, "CE", "buy"),
                legAtOffset(4, "CE", "sell"),
                legAtOffset(6, "CE", "sell"),
                legAtOffset(8, "CE", "buy"),
                legAtOffset(-2, "PE", "buy"),
                legAtOffset(-4, "PE", "sell"),
                legAtOffset(-6, "PE", "sell"),
                legAtOffset(-8, "PE", "buy"),
            ]),
        },

        // ================================================================
        // 4. OTHER STRATEGIES (6 strategies matching StockMojo)
        // ================================================================
        {
            name: "Long Straddle",
            type: "long_straddle",
            bias: "Other",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ATM Call + Buy ATM Put. Generates explosive profits on high volatility breakout in either direction.",
            shape: "long-straddle",
            legs: compact([legAtOffset(0, "CE", "buy"), legAtOffset(0, "PE", "buy")]),
        },
        {
            name: "Long Strangle",
            type: "long_strangle",
            bias: "Other",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy OTM Call (+2 strikes) + Buy OTM Put (-2 strikes). Inexpensive volatility breakout trade.",
            shape: "long-strangle",
            legs: compact([legAtOffset(2, "CE", "buy"), legAtOffset(-2, "PE", "buy")]),
        },
        {
            name: "Long Iron Condor",
            type: "long_iron_condor",
            bias: "Other",
            risk: "Defined",
            flow: "Debit",
            summary: "Sell Call (+3) + Buy Call (+1) + Buy Put (-1) + Sell Put (-3). Profit on large breakout outside strikes.",
            shape: "long-iron-condor",
            legs: compact([
                legAtOffset(3, "CE", "sell"),
                legAtOffset(1, "CE", "buy"),
                legAtOffset(-1, "PE", "buy"),
                legAtOffset(-3, "PE", "sell"),
            ]),
        },
        {
            name: "Long Iron Butterfly",
            type: "long_iron_butterfly",
            bias: "Other",
            risk: "Defined",
            flow: "Debit",
            summary: "Sell Call (+2) + Buy ATM Call + Buy ATM Put + Sell Put (-2). Defined debit breakout butterfly.",
            shape: "long-iron-butterfly",
            legs: compact([
                legAtOffset(2, "CE", "sell"),
                legAtOffset(0, "CE", "buy"),
                legAtOffset(0, "PE", "buy"),
                legAtOffset(-2, "PE", "sell"),
            ]),
        },
        {
            name: "Call Ratio Spread",
            type: "call_ratio_spread",
            bias: "Other",
            risk: "Undefined Upside",
            flow: "Credit",
            summary: "Buy ATM Call + Sell 2 OTM Calls (+2 strikes). Low or zero cost bullish-neutral strategy.",
            shape: "call-ratio-spread",
            legs: compact([legAtOffset(0, "CE", "buy"), legAtOffset(2, "CE", "sell", 2)]),
        },
        {
            name: "Put Ratio Spread",
            type: "put_ratio_spread",
            bias: "Other",
            risk: "Undefined Downside",
            flow: "Credit",
            summary: "Buy ATM Put + Sell 2 OTM Puts (-2 strikes). Low or zero cost bearish-neutral strategy.",
            shape: "put-ratio-spread",
            legs: compact([legAtOffset(0, "PE", "buy"), legAtOffset(-2, "PE", "sell", 2)]),
        },
    ];
}

export default function PresetStrategies({ data, onApply, fetchExpiryRows }) {
    const presets = useMemo(() => buildPresets(data), [data]);
    const [selectedCategory, setSelectedCategory] = useState("Neutral");
    const [searchQuery, setSearchQuery] = useState("");
    const [loadingPreset, setLoadingPreset] = useState(null);

    const filtered = useMemo(() => {
        let list = presets;
        if (selectedCategory !== "All") {
            list = list.filter((p) => p.bias === selectedCategory);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(
                (p) =>
                    p.name.toLowerCase().includes(q) ||
                    p.summary.toLowerCase().includes(q) ||
                    p.risk.toLowerCase().includes(q) ||
                    p.bias.toLowerCase().includes(q)
            );
        }
        return list;
    }, [presets, selectedCategory, searchQuery]);

    const counts = useMemo(() => {
        const res = { Bullish: 0, Bearish: 0, Neutral: 0, Other: 0 };
        presets.forEach((p) => {
            if (res[p.bias] != null) res[p.bias]++;
        });
        return res;
    }, [presets]);

    async function handleApply(p) {
        if (p.legs && p.legs.length) {
            onApply(p.legs);
            return;
        }
        if (p.buildLegs) {
            setLoadingPreset(p.name);
            try {
                const builtLegs = await p.buildLegs(fetchExpiryRows);
                if (builtLegs && builtLegs.length) onApply(builtLegs);
            } catch (err) {
                console.error("[PresetStrategies] failed to build preset:", p.name, err);
            } finally {
                setLoadingPreset(null);
            }
        }
    }

    return (
        <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] p-3 sm:p-4 shadow-xs transition-colors">
            {/* Header Title & Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 mb-3.5">
                <div>
                    <h2 className="text-sm sm:text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
                        <span>Ready-Made Strategies</span>
                        <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 px-2 py-0.2 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                            {presets.length} Presets
                        </span>
                    </h2>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                        StockMojo preset templates mapped to ATM ({data?.atmStrike ?? "—"}).
                    </p>
                </div>

                {/* Search input */}
                <div className="relative w-full sm:w-56">
                    <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={13} />
                    <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search strategy…"
                        className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#070e17] py-1.5 pl-7 pr-2.5 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500 transition placeholder:text-gray-400"
                    />
                </div>
            </div>

            {/* Category Filter Pills (Matching StockMojo 4 Tabs: Bullish | Bearish | Neutral | Other) */}
            <div className="grid grid-cols-4 sm:flex items-center gap-1.5 mb-3.5 border-b border-gray-100 dark:border-white/10 pb-2.5">
                {CATEGORIES.map((c) => {
                    const isActive = selectedCategory === c;
                    return (
                        <button
                            key={c}
                            onClick={() => setSelectedCategory(c)}
                            className={`flex items-center justify-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer truncate ${
                                isActive
                                    ? "bg-emerald-500/15 border border-emerald-500 text-emerald-600 dark:text-emerald-400 shadow-xs"
                                    : "bg-gray-100 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:border-emerald-500/60 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            <span>{c}</span>
                            <span
                                className={`rounded-full px-1 py-0.1 text-[9.5px] font-mono ${
                                    isActive ? "bg-emerald-600 text-white" : "bg-gray-200 dark:bg-white/10 text-gray-500 dark:text-gray-400"
                                }`}
                            >
                                {counts[c] || 0}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Grid of Strategy Cards */}
            {!data ? (
                <div className="py-12 text-center text-sm font-medium text-gray-400 dark:text-gray-500 animate-pulse">
                    Loading live option chain strikes…
                </div>
            ) : filtered.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                    No strategies found matching &quot;{searchQuery}&quot;.
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                    {filtered.map((p) => {
                        const legCount = p.legs ? p.legs.length : p.legCount || 0;
                        const isLoading = loadingPreset === p.name;

                        // Bias colors
                        const biasColor =
                            p.bias === "Bullish"
                                ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60"
                                : p.bias === "Bearish"
                                ? "bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/60"
                                : p.bias === "Neutral"
                                ? "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/60"
                                : "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/60";

                        const riskColor = p.risk.startsWith("Defined")
                            ? "bg-gray-50 dark:bg-white/5 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-white/10"
                            : "bg-rose-50/70 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/50";

                        return (
                            <div
                                key={p.name}
                                className="group relative flex flex-col justify-between rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] p-3.5 shadow-xs transition-all hover:-translate-y-1 hover:border-emerald-500 dark:hover:border-emerald-500 hover:shadow-md dark:hover:shadow-emerald-950/20"
                            >
                                <div>
                                    {/* Top Metadata Badges */}
                                    <div className="flex items-center justify-between gap-1.5 mb-2.5">
                                        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-extrabold ${biasColor}`}>
                                            {p.bias}
                                        </span>
                                        <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${riskColor}`}>
                                            {p.risk}
                                        </span>
                                    </div>

                                    {/* Payoff Diagram Visual Box */}
                                    <div className="rounded-xl border border-gray-100 dark:border-white/10 bg-gray-50/70 dark:bg-[#0b1420] p-2.5 transition group-hover:bg-emerald-50/30 dark:group-hover:bg-emerald-950/20">
                                        <PayoffIcon shape={p.shape} />
                                    </div>

                                    {/* Strategy Info */}
                                    <div className="mt-3">
                                        <div className="flex items-baseline justify-between gap-1">
                                            <h3 className="text-sm font-bold text-gray-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
                                                {p.name}
                                            </h3>
                                            <span className="shrink-0 text-[11px] font-bold text-gray-400 dark:text-gray-500">
                                                {legCount} {legCount === 1 ? "Leg" : "Legs"}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-2">
                                            {p.summary}
                                        </p>
                                    </div>
                                </div>

                                {/* Apply Action Button */}
                                <button
                                    onClick={() => handleApply(p)}
                                    disabled={!legCount || isLoading}
                                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 transition group-hover:border-emerald-600 group-hover:bg-emerald-600 group-hover:text-white dark:group-hover:bg-emerald-600 dark:group-hover:border-emerald-600 dark:group-hover:text-white disabled:opacity-40"
                                >
                                    <span>{isLoading ? "Building Strategy…" : "Build Strategy"}</span>
                                    {!isLoading && <FiArrowRight size={13} className="transition group-hover:translate-x-0.5" />}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
