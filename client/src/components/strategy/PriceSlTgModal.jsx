// components/strategy/PriceSlTgModal.jsx
//
// Simulator Stop-Loss / Target editor (StockMojo parity):
// Supports input by % Percentage, Points, or Absolute Option Price.
// The level is checked every minute the simulator lands on (stepping, Autoplay, or replay run).
// "Alert + Square Off" automatically squares off the leg at market price.
// "Alert Only" raises a toast notification while keeping the position open.
import React, { useState, useEffect } from "react";
import { FiX } from "react-icons/fi";
import { formatPrice } from "../../utils/format";
import { legMultiplier } from "../../utils/payoff";
import { SLTG_MODES } from "./sltgModes";

export default function PriceSlTgModal({ leg, ltp, onClose, onSave }) {
    if (!leg) return null;

    const isSell = leg.action === "sell";
    const entry = Number(leg.premium) || 0;
    const currentLtp = ltp != null ? Number(ltp) : entry;
    const mult = legMultiplier(leg);

    // Initial mode: default to percent (StockMojo style), unless leg explicitly has absolute price only
    const [inputMode, setInputMode] = useState(
        leg.slPrice != null && leg.slPercent == null && leg.tgPercent == null ? "price" : "percent"
    );

    // Initial values
    const [slPercent, setSlPercent] = useState(
        leg.slPercent != null
            ? String(leg.slPercent)
            : leg.slPrice != null && entry > 0
            ? String(Math.abs(Math.round(((leg.slPrice - entry) / entry) * 100)))
            : ""
    );
    const [tgPercent, setTgPercent] = useState(
        leg.tgPercent != null
            ? String(leg.tgPercent)
            : leg.tgPrice != null && entry > 0
            ? String(Math.abs(Math.round(((entry - leg.tgPrice) / entry) * 100)))
            : ""
    );

    const [slPoints, setSlPoints] = useState(
        leg.slPrice != null && entry > 0
            ? String(Math.abs(Math.round((leg.slPrice - entry) * 100) / 100))
            : ""
    );
    const [tgPoints, setTgPoints] = useState(
        leg.tgPrice != null && entry > 0
            ? String(Math.abs(Math.round((entry - leg.tgPrice) * 100) / 100))
            : ""
    );

    const [slPriceStr, setSlPriceStr] = useState(leg.slPrice != null ? String(leg.slPrice) : "");
    const [tgPriceStr, setTgPriceStr] = useState(leg.tgPrice != null ? String(leg.tgPrice) : "");

    const [mode, setMode] = useState(leg.sltgMode || SLTG_MODES.SQUARE_OFF);

    // Compute active target price and stop loss price based on current inputMode
    let activeSlPrice = null;
    let activeTgPrice = null;

    if (inputMode === "percent") {
        const sPct = parseFloat(slPercent);
        if (!isNaN(sPct) && sPct > 0 && entry > 0) {
            activeSlPrice = isSell
                ? Math.round((entry * (1 + sPct / 100)) * 100) / 100
                : Math.max(0.05, Math.round((entry * (1 - sPct / 100)) * 100) / 100);
        }
        const tPct = parseFloat(tgPercent);
        if (!isNaN(tPct) && tPct > 0 && entry > 0) {
            activeTgPrice = isSell
                ? Math.max(0.05, Math.round((entry * (1 - tPct / 100)) * 100) / 100)
                : Math.round((entry * (1 + tPct / 100)) * 100) / 100;
        }
    } else if (inputMode === "points") {
        const sPts = parseFloat(slPoints);
        if (!isNaN(sPts) && sPts > 0 && entry > 0) {
            activeSlPrice = isSell
                ? Math.round((entry + sPts) * 100) / 100
                : Math.max(0.05, Math.round((entry - sPts) * 100) / 100);
        }
        const tPts = parseFloat(tgPoints);
        if (!isNaN(tPts) && tPts > 0 && entry > 0) {
            activeTgPrice = isSell
                ? Math.max(0.05, Math.round((entry - tPts) * 100) / 100)
                : Math.round((entry + tPts) * 100) / 100;
        }
    } else {
        const sPrice = parseFloat(slPriceStr);
        if (!isNaN(sPrice) && sPrice > 0) {
            activeSlPrice = Math.round(sPrice * 100) / 100;
        }
        const tPrice = parseFloat(tgPriceStr);
        if (!isNaN(tPrice) && tPrice > 0) {
            activeTgPrice = Math.round(tPrice * 100) / 100;
        }
    }

    // Projected P&L when price hits a level
    const pnlAt = (price) => {
        if (price == null || isNaN(price)) return null;
        const diff = isSell ? entry - price : price - entry;
        return diff * mult;
    };

    // Validation
    let slError = null;
    if (activeSlPrice != null) {
        if (activeSlPrice <= 0) {
            slError = "Stop Loss price must be greater than 0";
        } else if (isSell && activeSlPrice <= entry) {
            slError = `For a SELL leg, Stop Loss must be above entry (${formatPrice(entry)})`;
        } else if (!isSell && activeSlPrice >= entry) {
            slError = `For a BUY leg, Stop Loss must be below entry (${formatPrice(entry)})`;
        }
    }

    let tgError = null;
    if (activeTgPrice != null) {
        if (activeTgPrice <= 0) {
            tgError = "Target price must be greater than 0";
        } else if (isSell && activeTgPrice >= entry) {
            tgError = `For a SELL leg, Target must be below entry (${formatPrice(entry)})`;
        } else if (!isSell && activeTgPrice <= entry) {
            tgError = `For a BUY leg, Target must be above entry (${formatPrice(entry)})`;
        }
    }

    const canSave = (!slError && !tgError) && (activeSlPrice != null || activeTgPrice != null);

    const handleSave = () => {
        onSave({
            slPrice: activeSlPrice ?? null,
            tgPrice: activeTgPrice ?? null,
            slPercent: inputMode === "percent" && slPercent ? parseFloat(slPercent) : null,
            tgPercent: inputMode === "percent" && tgPercent ? parseFloat(tgPercent) : null,
            sltgMode: mode,
        });
    };

    const handleClear = () => {
        onSave({
            slPrice: null,
            tgPrice: null,
            slPercent: null,
            tgPercent: null,
            sltgMode: mode,
        });
    };

    const slPnl = pnlAt(activeSlPrice);
    const tgPnl = pnlAt(activeTgPrice);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-xs" onClick={onClose}>
            <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#0b1420] p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-150" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-gray-100 dark:border-white/10 pb-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-base font-black text-gray-900 dark:text-white">
                                {leg.strike} {leg.type}
                            </span>
                            <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                    isSell
                                        ? "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/40"
                                        : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-900/40"
                                }`}
                            >
                                {isSell ? "SELL" : "BUY"}
                            </span>
                            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                ({leg.qty} {leg.qty === 1 ? "lot" : "lots"} · {mult} qty)
                            </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs">
                            <span className="text-gray-500 dark:text-gray-400">
                                Entry: <b className="font-mono text-gray-900 dark:text-white font-bold">{formatPrice(entry)}</b>
                            </span>
                            <span className="text-gray-300 dark:text-gray-600">|</span>
                            <span className="text-gray-500 dark:text-gray-400">
                                LTP: <b className="font-mono text-gray-900 dark:text-white font-bold">{formatPrice(currentLtp)}</b>
                            </span>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition" aria-label="Close">
                        <FiX size={18} />
                    </button>
                </div>

                {/* Input Mode Selector Tabs */}
                <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-gray-100 dark:bg-[#070e17] p-1 text-xs font-bold">
                    <button
                        type="button"
                        onClick={() => setInputMode("percent")}
                        className={`rounded-lg py-1.5 transition ${
                            inputMode === "percent"
                                ? "bg-white dark:bg-gray-800 text-[#1677ff] dark:text-blue-400 shadow-xs"
                                : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                        }`}
                    >
                        % Percentage
                    </button>
                    <button
                        type="button"
                        onClick={() => setInputMode("points")}
                        className={`rounded-lg py-1.5 transition ${
                            inputMode === "points"
                                ? "bg-white dark:bg-gray-800 text-[#1677ff] dark:text-blue-400 shadow-xs"
                                : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                        }`}
                    >
                        Points (pts)
                    </button>
                    <button
                        type="button"
                        onClick={() => setInputMode("price")}
                        className={`rounded-lg py-1.5 transition ${
                            inputMode === "price"
                                ? "bg-white dark:bg-gray-800 text-[#1677ff] dark:text-blue-400 shadow-xs"
                                : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-200"
                        }`}
                    >
                        Price (₹)
                    </button>
                </div>

                {/* Fields */}
                <div className="space-y-4 mb-4">
                    {/* Stop Loss Section */}
                    <div className="rounded-xl border border-rose-200/70 dark:border-rose-900/30 bg-rose-50/30 dark:bg-rose-950/10 p-3">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-rose-700 dark:text-rose-400">
                                🛑 Stop Loss {inputMode === "percent" ? "(%)" : inputMode === "points" ? "(Points)" : "(Price)"}
                            </span>
                            {activeSlPrice != null && (
                                <span className="text-xs font-bold font-mono text-gray-800 dark:text-gray-200">
                                    Trigger @ ₹{activeSlPrice.toFixed(2)}
                                </span>
                            )}
                        </div>

                        {/* Input Row */}
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={inputMode === "percent" ? slPercent : inputMode === "points" ? slPoints : slPriceStr}
                                    onChange={(e) => {
                                        const v = e.target.value.replace(/[^\d.]/g, "");
                                        if (inputMode === "percent") setSlPercent(v);
                                        else if (inputMode === "points") setSlPoints(v);
                                        else setSlPriceStr(v);
                                    }}
                                    placeholder={
                                        inputMode === "percent"
                                            ? "e.g. 20"
                                            : inputMode === "points"
                                            ? "e.g. 15"
                                            : `e.g. ${isSell ? Math.round(entry * 1.2) : Math.round(entry * 0.8)}`
                                    }
                                    className="w-full rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#070e17] px-3 py-1.5 text-xs font-mono font-bold tabular-nums text-gray-900 dark:text-white outline-none focus:border-rose-500"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">
                                    {inputMode === "percent" ? "%" : inputMode === "points" ? "pts" : "₹"}
                                </span>
                            </div>
                        </div>

                        {/* Quick Presets */}
                        {inputMode === "percent" && (
                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                {[10, 20, 30, 50, 100].map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setSlPercent(String(p))}
                                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                                            slPercent === String(p)
                                                ? "bg-rose-600 text-white shadow-xs"
                                                : "bg-white dark:bg-[#070e17] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-rose-400"
                                        }`}
                                    >
                                        +{p}%
                                    </button>
                                ))}
                            </div>
                        )}

                        {inputMode === "points" && (
                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                {[5, 10, 15, 25, 50].map((pts) => (
                                    <button
                                        key={pts}
                                        type="button"
                                        onClick={() => setSlPoints(String(pts))}
                                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                                            slPoints === String(pts)
                                                ? "bg-rose-600 text-white shadow-xs"
                                                : "bg-white dark:bg-[#070e17] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-rose-400"
                                        }`}
                                    >
                                        {pts} pts
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Resulting P&L preview or error */}
                        {slError ? (
                            <div className="mt-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">{slError}</div>
                        ) : slPnl != null ? (
                            <div className="mt-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center justify-between">
                                <span>Max Loss on hit:</span>
                                <span className="font-mono tabular-nums">{formatPrice(slPnl)}</span>
                            </div>
                        ) : null}
                    </div>

                    {/* Target Section */}
                    <div className="rounded-xl border border-emerald-200/70 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-950/10 p-3">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                🎯 Target {inputMode === "percent" ? "(%)" : inputMode === "points" ? "(Points)" : "(Price)"}
                            </span>
                            {activeTgPrice != null && (
                                <span className="text-xs font-bold font-mono text-gray-800 dark:text-gray-200">
                                    Trigger @ ₹{activeTgPrice.toFixed(2)}
                                </span>
                            )}
                        </div>

                        {/* Input Row */}
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={inputMode === "percent" ? tgPercent : inputMode === "points" ? tgPoints : tgPriceStr}
                                    onChange={(e) => {
                                        const v = e.target.value.replace(/[^\d.]/g, "");
                                        if (inputMode === "percent") setTgPercent(v);
                                        else if (inputMode === "points") setTgPoints(v);
                                        else setTgPriceStr(v);
                                    }}
                                    placeholder={
                                        inputMode === "percent"
                                            ? "e.g. 30"
                                            : inputMode === "points"
                                            ? "e.g. 25"
                                            : `e.g. ${isSell ? Math.round(entry * 0.7) : Math.round(entry * 1.3)}`
                                    }
                                    className="w-full rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#070e17] px-3 py-1.5 text-xs font-mono font-bold tabular-nums text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">
                                    {inputMode === "percent" ? "%" : inputMode === "points" ? "pts" : "₹"}
                                </span>
                            </div>
                        </div>

                        {/* Quick Presets */}
                        {inputMode === "percent" && (
                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                {[20, 30, 50, 70, 90].map((p) => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => setTgPercent(String(p))}
                                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                                            tgPercent === String(p)
                                                ? "bg-emerald-600 text-white shadow-xs"
                                                : "bg-white dark:bg-[#070e17] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-emerald-400"
                                        }`}
                                    >
                                        {p}%
                                    </button>
                                ))}
                            </div>
                        )}

                        {inputMode === "points" && (
                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                                {[10, 20, 30, 50, 75].map((pts) => (
                                    <button
                                        key={pts}
                                        type="button"
                                        onClick={() => setTgPoints(String(pts))}
                                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition ${
                                            tgPoints === String(pts)
                                                ? "bg-emerald-600 text-white shadow-xs"
                                                : "bg-white dark:bg-[#070e17] border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:border-emerald-400"
                                        }`}
                                    >
                                        {pts} pts
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Resulting P&L preview or error */}
                        {tgError ? (
                            <div className="mt-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">{tgError}</div>
                        ) : tgPnl != null ? (
                            <div className="mt-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
                                <span>Profit on hit:</span>
                                <span className="font-mono tabular-nums">+{formatPrice(tgPnl)}</span>
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* SLTG Mode Option: StockMojo Parity */}
                <div className="mb-4 rounded-xl bg-gray-50 dark:bg-[#070e17] p-2.5 border border-gray-100 dark:border-white/5">
                    <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Execution Mode</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${mode === SLTG_MODES.SQUARE_OFF ? "bg-blue-50/60 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold" : "border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400"}`}>
                            <input
                                type="radio"
                                name="sltg-mode"
                                checked={mode === SLTG_MODES.SQUARE_OFF}
                                onChange={() => setMode(SLTG_MODES.SQUARE_OFF)}
                                className="accent-[#1677ff]"
                            />
                            <span>Alert + Square Off</span>
                        </label>
                        <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${mode === SLTG_MODES.ALERT ? "bg-blue-50/60 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold" : "border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-400"}`}>
                            <input
                                type="radio"
                                name="sltg-mode"
                                checked={mode === SLTG_MODES.ALERT}
                                onChange={() => setMode(SLTG_MODES.ALERT)}
                                className="accent-[#1677ff]"
                            />
                            <span>Alert Only</span>
                        </label>
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-xl border border-gray-200 dark:border-white/10 py-2.5 text-xs font-bold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={!canSave}
                        className="rounded-xl bg-[#1677ff] hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed py-2.5 text-xs font-bold text-white shadow-md shadow-blue-500/20 transition"
                    >
                        Save SL / Target
                    </button>
                </div>

                {(leg.slPrice != null || leg.tgPrice != null) && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="mt-2.5 w-full text-center text-xs font-bold text-rose-600 dark:text-rose-400 hover:underline transition"
                    >
                        Remove Existing SL / Target
                    </button>
                )}
            </div>
        </div>
    );
}
