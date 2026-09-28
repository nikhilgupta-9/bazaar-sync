// components/PresetStrategies.jsx — StockMojo-parity Ready-Made Strategy Matrix
// Comprehensive options strategy templates with live chain strike mapping,
// category filtering, instant search, risk classifications, and 1-click execution.

import React, { useMemo, useState } from "react";
import PayoffIcon from "./PayoffIcon";
import { FiSearch, FiArrowRight, FiShield, FiTrendingUp, FiTrendingDown, FiActivity } from "react-icons/fi";

const CATEGORIES = ["All", "Bullish", "Bearish", "Neutral", "Volatility"];

function buildPresets(data) {
    if (!data || !data.rows?.length) return [];
    const gap = data.rows[1]?.strike - data.rows[0]?.strike || 50;
    const atm = data.atmStrike;
    const rowAt = (strike) => data.rows.find((r) => r.strike === strike);
    const leg = (strike, type, action, qty = 1) => {
        const row = rowAt(strike);
        if (!row) return null;
        const side = type === "CE" ? row.ce : row.pe;
        return {
            action,
            type,
            strike,
            premium: side?.ltp ?? 0,
            qty,
            lotSize: data.lotSize || 50,
            iv: side?.iv,
            delta: side?.delta,
            gamma: side?.gamma,
            theta: side?.theta,
            vega: side?.vega,
            expiry: data.selectedExpiry,
        };
    };
    const compact = (legs) => legs.filter(Boolean);

    const farExpiry = data.expiries && data.selectedExpiry
        ? data.expiries.find((e) => e > data.selectedExpiry) || null
        : null;

    return [
        // ===================== NEUTRAL STRATEGIES =====================
        {
            name: "Short Straddle",
            bias: "Neutral",
            risk: "Undefined",
            flow: "Credit",
            summary: "Sell ATM Call + Put. Max profit when underlying expires exactly at strike with low volatility.",
            shape: "short-straddle",
            legs: compact([leg(atm, "CE", "sell"), leg(atm, "PE", "sell")]),
        },
        {
            name: "Short Strangle",
            bias: "Neutral",
            risk: "Undefined",
            flow: "Credit",
            summary: "Sell OTM Call + OTM Put. Wide profit range between strikes, benefits from rapid theta decay.",
            shape: "short-strangle",
            legs: compact([leg(atm + 2 * gap, "CE", "sell"), leg(atm - 2 * gap, "PE", "sell")]),
        },
        {
            name: "Short Iron Condor",
            bias: "Neutral",
            risk: "Defined",
            flow: "Credit",
            summary: "4-leg credit spread. Protected wings limit maximum risk while collecting range-bound premium.",
            shape: "short-iron-condor",
            legs: compact([
                leg(atm + 2 * gap, "CE", "sell"),
                leg(atm + 4 * gap, "CE", "buy"),
                leg(atm - 2 * gap, "PE", "sell"),
                leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Short Iron Butterfly",
            bias: "Neutral",
            risk: "Defined",
            flow: "Credit",
            summary: "Sell ATM Straddle + Buy OTM protective wings. High reward-to-risk with strictly capped loss.",
            shape: "short-iron-butterfly",
            legs: compact([
                leg(atm, "CE", "sell"),
                leg(atm, "PE", "sell"),
                leg(atm + 4 * gap, "CE", "buy"),
                leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Jade Lizard",
            bias: "Neutral",
            risk: "Undefined Downside",
            flow: "Credit",
            summary: "Short OTM Put + Bear Call Spread. No upside risk if net credit exceeds call spread width.",
            shape: "jade-lizard",
            legs: compact([
                leg(atm - 3 * gap, "PE", "sell"),
                leg(atm + 2 * gap, "CE", "sell"),
                leg(atm + 4 * gap, "CE", "buy"),
            ]),
        },
        {
            name: "Reverse Jade Lizard",
            bias: "Neutral",
            risk: "Undefined Upside",
            flow: "Credit",
            summary: "Short OTM Call + Bull Put Spread. No downside risk if net credit exceeds put spread width.",
            shape: "reverse-jade-lizard",
            legs: compact([
                leg(atm + 3 * gap, "CE", "sell"),
                leg(atm - 2 * gap, "PE", "sell"),
                leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Batman Strategy",
            bias: "Neutral",
            risk: "Defined",
            flow: "Debit",
            summary: "Twin-peak modified butterfly with sweet spots on both sides of current ATM price.",
            shape: "batman",
            legs: compact([
                leg(atm, "CE", "buy"),
                leg(atm + 2 * gap, "CE", "sell", 2),
                leg(atm + 4 * gap, "CE", "buy"),
                leg(atm, "PE", "buy"),
                leg(atm - 2 * gap, "PE", "sell", 2),
                leg(atm - 4 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Double Plateau",
            bias: "Neutral",
            risk: "Defined",
            flow: "Credit",
            summary: "Two adjacent credit spreads creating dual profit plateau zones.",
            shape: "double-plateau",
            legs: compact([
                leg(atm + gap, "CE", "sell"),
                leg(atm + 3 * gap, "CE", "buy"),
                leg(atm - gap, "PE", "sell"),
                leg(atm - 3 * gap, "PE", "buy"),
            ]),
        },

        // ===================== BULLISH STRATEGIES =====================
        {
            name: "Bull Call Spread",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ATM Call + Sell OTM Call. Lower cost than naked call with capped upside risk/reward.",
            shape: "bull-call-spread",
            legs: compact([leg(atm, "CE", "buy"), leg(atm + 4 * gap, "CE", "sell")]),
        },
        {
            name: "Bull Put Spread",
            bias: "Bullish",
            risk: "Defined",
            flow: "Credit",
            summary: "Sell higher Put + Buy lower Put. Profit if underlying stays above short strike.",
            shape: "bull-put-spread",
            legs: compact([leg(atm, "PE", "sell"), leg(atm - 4 * gap, "PE", "buy")]),
        },
        {
            name: "Buy Call (Long Call)",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Simple directional long call. Unlimited upside potential with risk capped to premium paid.",
            shape: "buy-call",
            legs: compact([leg(atm, "CE", "buy")]),
        },
        {
            name: "Sell Put (Short Put)",
            bias: "Bullish",
            risk: "Undefined",
            flow: "Credit",
            summary: "Bullish income strategy. Collect full premium if stock stays flat or moves higher.",
            shape: "sell-put",
            legs: compact([leg(atm, "PE", "sell")]),
        },
        {
            name: "Long Synthetic Future",
            bias: "Bullish",
            risk: "Undefined",
            flow: "Even",
            summary: "Buy ATM Call + Sell ATM Put. Replicates a 100-delta long future with near-zero capital drag.",
            shape: "long-synthetic-future",
            legs: compact([leg(atm, "CE", "buy"), leg(atm, "PE", "sell")]),
        },
        {
            name: "Bull Condor",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "4-strike call spread with a wide elevated profit zone above current price.",
            shape: "bull-condor",
            legs: compact([
                leg(atm + gap, "CE", "buy"),
                leg(atm + 2 * gap, "CE", "sell"),
                leg(atm + 4 * gap, "CE", "sell"),
                leg(atm + 5 * gap, "CE", "buy"),
            ]),
        },
        {
            name: "Bull Butterfly",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Targeted upside peak with low capital outlay and high reward:risk ratio.",
            shape: "bull-butterfly",
            legs: compact([
                leg(atm + gap, "CE", "buy"),
                leg(atm + 3 * gap, "CE", "sell", 2),
                leg(atm + 5 * gap, "CE", "buy"),
            ]),
        },
        {
            name: "Long Calendar with Calls",
            bias: "Bullish",
            risk: "Defined",
            flow: "Debit",
            summary: "Sell near-expiry ATM Call + Buy far-expiry ATM Call. Exploits fast near-term time decay.",
            shape: "long-calendar-call",
            legCount: farExpiry ? 2 : 0,
            buildLegs: farExpiry
                ? async (fetchExpiryRows) => {
                    const nearLeg = leg(atm, "CE", "sell");
                    if (!nearLeg || !fetchExpiryRows) return [];
                    const farRows = await fetchExpiryRows(farExpiry);
                    const farRow = farRows.find((r) => r.strike === atm);
                    if (!farRow || farRow.ce?.ltp == null) return [];
                    const farLeg = {
                        action: "buy",
                        type: "CE",
                        strike: atm,
                        qty: 1,
                        lotSize: data.lotSize || 50,
                        premium: farRow.ce.ltp,
                        iv: farRow.ce.iv,
                        delta: farRow.ce.delta,
                        gamma: farRow.ce.gamma,
                        theta: farRow.ce.theta,
                        vega: farRow.ce.vega,
                        expiry: farExpiry,
                    };
                    return [nearLeg, farLeg];
                }
                : null,
        },

        // ===================== BEARISH STRATEGIES =====================
        {
            name: "Bear Put Spread",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ATM Put + Sell OTM Put. Moderate bearish move expectation with reduced entry cost.",
            shape: "bear-put-spread",
            legs: compact([leg(atm, "PE", "buy"), leg(atm - 4 * gap, "PE", "sell")]),
        },
        {
            name: "Bear Call Spread",
            bias: "Bearish",
            risk: "Defined",
            flow: "Credit",
            summary: "Sell ATM Call + Buy OTM Call. Collect upfront credit with safety wing capping upside risk.",
            shape: "bear-call-spread",
            legs: compact([leg(atm, "CE", "sell"), leg(atm + 4 * gap, "CE", "buy")]),
        },
        {
            name: "Buy Put (Long Put)",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Pure bearish directional bet. Substantial profits on sharp downward momentum.",
            shape: "buy-put",
            legs: compact([leg(atm, "PE", "buy")]),
        },
        {
            name: "Sell Call (Short Call)",
            bias: "Bearish",
            risk: "Undefined",
            flow: "Credit",
            summary: "Bearish income trade. Max profit is the credit kept if underlying stays below strike.",
            shape: "sell-call",
            legs: compact([leg(atm, "CE", "sell")]),
        },
        {
            name: "Short Synthetic Future",
            bias: "Bearish",
            risk: "Undefined",
            flow: "Even",
            summary: "Buy ATM Put + Sell ATM Call. Replicates short futures position with 1:1 downside delta.",
            shape: "short-synthetic-future",
            legs: compact([leg(atm, "PE", "buy"), leg(atm, "CE", "sell")]),
        },
        {
            name: "Bear Condor",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "4-strike put spread with an elevated profit range below current market price.",
            shape: "bear-condor",
            legs: compact([
                leg(atm - gap, "PE", "buy"),
                leg(atm - 2 * gap, "PE", "sell"),
                leg(atm - 4 * gap, "PE", "sell"),
                leg(atm - 5 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Bear Butterfly",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Single sharp peak below current spot. High leverage on targeted downward moves.",
            shape: "bear-butterfly",
            legs: compact([
                leg(atm - gap, "PE", "buy"),
                leg(atm - 3 * gap, "PE", "sell", 2),
                leg(atm - 5 * gap, "PE", "buy"),
            ]),
        },
        {
            name: "Long Calendar with Puts",
            bias: "Bearish",
            risk: "Defined",
            flow: "Debit",
            summary: "Sell near-expiry ATM Put + Buy far-expiry ATM Put. Captures differential theta decay.",
            shape: "long-calendar-put",
            legCount: farExpiry ? 2 : 0,
            buildLegs: farExpiry
                ? async (fetchExpiryRows) => {
                    const nearLeg = leg(atm, "PE", "sell");
                    if (!nearLeg || !fetchExpiryRows) return [];
                    const farRows = await fetchExpiryRows(farExpiry);
                    const farRow = farRows.find((r) => r.strike === atm);
                    if (!farRow || farRow.pe?.ltp == null) return [];
                    const farLeg = {
                        action: "buy",
                        type: "PE",
                        strike: atm,
                        qty: 1,
                        lotSize: data.lotSize || 50,
                        premium: farRow.pe.ltp,
                        iv: farRow.pe.iv,
                        delta: farRow.pe.delta,
                        gamma: farRow.pe.gamma,
                        theta: farRow.pe.theta,
                        vega: farRow.pe.vega,
                        expiry: farExpiry,
                    };
                    return [nearLeg, farLeg];
                }
                : null,
        },

        // ===================== VOLATILITY / BREAKOUT STRATEGIES =====================
        {
            name: "Long Straddle",
            bias: "Volatility",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ATM Call + Buy ATM Put. Generates explosive profits on large moves in either direction.",
            shape: "long-straddle",
            legs: compact([leg(atm, "CE", "buy"), leg(atm, "PE", "buy")]),
        },
        {
            name: "Long Strangle",
            bias: "Volatility",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy OTM Call + Buy OTM Put. Lower initial cost than straddle; ideal for big event breakouts.",
            shape: "long-strangle",
            legs: compact([leg(atm + 2 * gap, "CE", "buy"), leg(atm - 2 * gap, "PE", "buy")]),
        },
        {
            name: "Long Iron Condor",
            bias: "Volatility",
            risk: "Defined",
            flow: "Debit",
            summary: "Reverse iron condor. Profit when underlying makes a huge move outside the inner strikes.",
            shape: "long-iron-condor",
            legs: compact([
                leg(atm + 2 * gap, "CE", "buy"),
                leg(atm + 4 * gap, "CE", "sell"),
                leg(atm - 2 * gap, "PE", "buy"),
                leg(atm - 4 * gap, "PE", "sell"),
            ]),
        },
        {
            name: "Long Iron Butterfly",
            bias: "Volatility",
            risk: "Defined",
            flow: "Debit",
            summary: "Buy ATM Straddle + Sell OTM wings. Low net debit for big volatility expansion.",
            shape: "long-iron-butterfly",
            legs: compact([
                leg(atm, "CE", "buy"),
                leg(atm, "PE", "buy"),
                leg(atm + 4 * gap, "CE", "sell"),
                leg(atm - 4 * gap, "PE", "sell"),
            ]),
        },
        {
            name: "Call Ratio Spread",
            bias: "Volatility",
            risk: "Undefined Upside",
            flow: "Credit",
            summary: "Buy 1 ATM Call + Sell 2 OTM Calls. Net credit trade with high profit if stock reaches short strike.",
            shape: "call-ratio-spread",
            legs: compact([leg(atm, "CE", "buy"), leg(atm + 3 * gap, "CE", "sell", 2)]),
        },
        {
            name: "Put Ratio Spread",
            bias: "Volatility",
            risk: "Undefined Downside",
            flow: "Credit",
            summary: "Buy 1 ATM Put + Sell 2 OTM Puts. Net credit trade targeting a moderate drop down to short strikes.",
            shape: "put-ratio-spread",
            legs: compact([leg(atm, "PE", "buy"), leg(atm - 3 * gap, "PE", "sell", 2)]),
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
        const res = { All: presets.length, Bullish: 0, Bearish: 0, Neutral: 0, Volatility: 0 };
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
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-6 shadow-xs">
            {/* Header Title & Search Bar */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
                <div>
                    <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        <span>Ready-Made Option Strategies</span>
                        <span className="rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                            {presets.length} Presets
                        </span>
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Select a battle-tested strategy preset to auto-populate strikes based on current ATM price ({data?.atmStrike ?? "—"}).
                    </p>
                </div>

                {/* Search input */}
                <div className="relative w-full md:w-64">
                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={14} />
                    <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search strategy or bias…"
                        className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 py-1.5 pl-8 pr-3 text-xs text-gray-900 dark:text-gray-100 outline-none focus:border-emerald-500 focus:bg-white dark:focus:bg-gray-900 transition"
                    />
                </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-5 border-b border-gray-100 dark:border-gray-800 pb-3">
                {CATEGORIES.map((c) => {
                    const isActive = selectedCategory === c;
                    return (
                        <button
                            key={c}
                            onClick={() => setSelectedCategory(c)}
                            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                isActive
                                    ? "bg-emerald-600 dark:bg-emerald-500 text-white shadow-xs"
                                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"
                            }`}
                        >
                            {c === "Bullish" && <FiTrendingUp size={12} />}
                            {c === "Bearish" && <FiTrendingDown size={12} />}
                            {c === "Neutral" && <FiShield size={12} />}
                            {c === "Volatility" && <FiActivity size={12} />}
                            <span>{c}</span>
                            <span
                                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                                    isActive ? "bg-emerald-700 text-emerald-100" : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
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
                                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                                : p.bias === "Bearish"
                                ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
                                : p.bias === "Neutral"
                                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                                : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800";

                        const riskColor = p.risk.startsWith("Defined")
                            ? "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"
                            : "bg-rose-50/70 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800";

                        return (
                            <div
                                key={p.name}
                                className="group relative flex flex-col justify-between rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-850 p-3.5 shadow-xs transition-all hover:-translate-y-1 hover:border-emerald-500 dark:hover:border-emerald-500 hover:shadow-md"
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
                                    <div className="rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/80 p-2.5 transition group-hover:bg-emerald-50/30 dark:group-hover:bg-emerald-950/20">
                                        <PayoffIcon shape={p.shape} />
                                    </div>

                                    {/* Strategy Info */}
                                    <div className="mt-3">
                                        <div className="flex items-baseline justify-between gap-1">
                                            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
                                                {p.name}
                                            </h3>
                                            <span className="shrink-0 text-[11px] font-bold text-gray-400 dark:text-gray-400">
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
                                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 transition group-hover:border-emerald-600 group-hover:bg-emerald-600 group-hover:text-white dark:group-hover:bg-emerald-600 dark:group-hover:border-emerald-600 dark:group-hover:text-white disabled:opacity-40"
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
