// pages/PaperTrade.jsx — Real-time Commercial Paper Trading Platform
// Follows Bazaar Sync / StockMojo green brand identity across Light & Dark themes.
// Uses semantic Tailwind classes (bg-white, bg-gray-50, border-gray-200, text-gray-900,
// emerald-600 for brand green/long/profit, rose-600 for short/loss, amber for Pro/warnings).
// Automatically re-themes cleanly in dark mode via index.css CSS variables.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";
import { useAuth } from "../context/AuthContext";
import { useOptionChain } from "../hooks/useOptionChain";
import { fetchWallet, createRefillOrder, verifyRefillPayment, fetchPositions, openPosition, closePosition } from "../services/paperTradeApi";
import { createProOrder, verifyProPayment } from "../services/subscriptionApi";
import { loadRazorpayCheckout } from "../utils/loadRazorpayCheckout";
import { formatRupees, formatPrice, formatPercent, formatOi, formatDateTime } from "../utils/format";
import { computePayoffCurve, computeBreakevens, computeMaxProfitLoss } from "../utils/payoff";
import PayoffChart from "../components/PayoffChart";
import { fetchSymbolList } from "../services/optionChainApi";

const FALLBACK_SYMBOLS = { indices: ["NIFTY", "BANKNIFTY", "FINNIFTY"], stocks: [], liveSymbols: ["NIFTY", "BANKNIFTY", "FINNIFTY"] };
const POSITIONS_POLL_MS = 12000;
const STRIKE_RANGES = [
    { label: "±10", value: 10 },
    { label: "±20", value: 20 },
    { label: "±50", value: 50 },
    { label: "All", value: null },
];

const LEDGER_LABELS = {
    trial_grant: "Free trial grant",
    pro_purchase_grant: "Pro membership purchase",
    refill_purchase: "Paper capital refill",
    trade_debit: "Bought option",
    trade_credit: "Closed option",
};
const CAPITAL_GRANT_TYPES = new Set(["trial_grant", "pro_purchase_grant", "refill_purchase"]);

function timeLeft(untilIso) {
    if (!untilIso) return "expired";
    const ms = new Date(untilIso).getTime() - Date.now();
    if (ms <= 0) return "expired";
    const hours = Math.floor(ms / 3_600_000);
    const days = Math.floor(hours / 24);
    if (days >= 1) return `${days}d ${hours % 24}h left`;
    return `${hours}h left`;
}

function todayIst() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function isToday(dateTimeStr) {
    return typeof dateTimeStr === "string" && dateTimeStr.slice(0, 10) === todayIst();
}

function pnlColor(v) {
    if (v == null || v === 0) return "text-gray-400";
    return v > 0 ? "text-emerald-600" : "text-rose-600";
}

function pnlBg(v) {
    if (v == null || v === 0) return "bg-gray-100 text-gray-700 border border-gray-200";
    return v > 0
        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
        : "bg-rose-50 text-rose-700 border border-rose-200";
}

// Searchable symbol picker with quick Index chips
function SymbolSelector({ symbol, symbolList, onPick }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");

    const filteredIndices = symbolList.indices.filter((s) => s.toLowerCase().includes(query.toLowerCase()));
    const filteredStocks = symbolList.stocks.filter((s) => s.toLowerCase().includes(query.toLowerCase()));

    function pick(s) {
        onPick(s);
        setOpen(false);
        setQuery("");
    }

    return (
        <div className="relative flex items-center gap-1.5">
            {/* Quick Index Pills */}
            <div className="hidden sm:flex items-center gap-1">
                {["NIFTY", "BANKNIFTY", "FINNIFTY"].map((idxSym) => (
                    <button
                        key={idxSym}
                        onClick={() => onPick(idxSym)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                            symbol === idxSym
                                ? "bg-emerald-600 text-white shadow-xs"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                    >
                        {idxSym}
                    </button>
                ))}
            </div>

            {/* Dropdown for All Symbols */}
            <div className="relative">
                <button
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-bold text-gray-900 shadow-xs hover:bg-gray-50"
                >
                    <span>{symbol}</span>
                    <span className="text-gray-400">▾</span>
                </button>
                {open && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                        <div className="absolute left-0 top-full z-50 mt-1.5 max-h-96 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-2xl">
                            <div className="sticky top-0 border-b border-gray-100 bg-white p-2">
                                <input
                                    autoFocus
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search symbol…"
                                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-900 outline-none focus:border-emerald-500"
                                />
                            </div>
                            {filteredIndices.length > 0 && (
                                <div className="py-1">
                                    <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">Indices</div>
                                    {filteredIndices.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => pick(s)}
                                            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium hover:bg-gray-50 ${
                                                s === symbol ? "bg-emerald-50 text-emerald-700 font-bold" : "text-gray-800"
                                            }`}
                                        >
                                            <span>{s}</span>
                                            {symbolList.liveSymbols.includes(s) ? (
                                                <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-bold text-emerald-700">LIVE</span>
                                            ) : (
                                                <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[9px] text-gray-400">Historical</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {filteredStocks.length > 0 && (
                                <div className="border-t border-gray-100 py-1">
                                    <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">F&O Stocks</div>
                                    {filteredStocks.map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => pick(s)}
                                            className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium hover:bg-gray-50 ${
                                                s === symbol ? "bg-emerald-50 text-emerald-700 font-bold" : "text-gray-800"
                                            }`}
                                        >
                                            <span>{s}</span>
                                            <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[9px] text-gray-400">Historical</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {!filteredIndices.length && !filteredStocks.length && (
                                <div className="px-3 py-8 text-center text-xs text-gray-400">No symbols found</div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// Option Chain Cell for Call/Put side with direct Buy / Sell triggers
function TradeCell({ strike, optRight, side, loggedIn, canTrade, onOpenTrade, onLoginRequired }) {
    if (!side || side.ltp == null) return <span className="text-gray-400">-</span>;

    return (
        <div className="group relative flex items-center justify-end">
            <span className="tabular-nums font-semibold text-gray-900 group-hover:invisible">
                {formatPrice(side.ltp)}
            </span>
            {!loggedIn ? (
                <button
                    onClick={onLoginRequired}
                    className="invisible absolute inset-y-0 right-0 whitespace-nowrap rounded border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-bold text-emerald-700 shadow-xs hover:bg-emerald-100 group-hover:visible"
                >
                    Login
                </button>
            ) : (
                canTrade && (
                    <div className="invisible absolute inset-y-0 right-0 flex items-center gap-1 group-hover:visible">
                        <button
                            onClick={() => onOpenTrade(strike, optRight, "long", side)}
                            title="Buy Call/Put (Debit)"
                            className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95"
                        >
                            B
                        </button>
                        <button
                            onClick={() => onOpenTrade(strike, optRight, "short", side)}
                            title="Sell Call/Put (Credit / Margin)"
                            className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95"
                        >
                            S
                        </button>
                    </div>
                )
            )}
        </div>
    );
}

// KPI Stat Card
function StatCard({ label, value, subtext, valueClassName, icon, badge }) {
    return (
        <div className="flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 shadow-xs transition-all sm:p-4">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
                {badge || (icon && <span className="text-gray-400">{icon}</span>)}
            </div>
            <div className={`mt-1 text-lg sm:text-xl font-extrabold tabular-nums tracking-tight ${valueClassName || "text-gray-900"}`}>
                {value}
            </div>
            {subtext && <div className="mt-0.5 text-[11px] text-gray-400">{subtext}</div>}
        </div>
    );
}

// Order Placement Drawer (Slide-Over / Bottom-Sheet)
function TradeDrawer({
    symbol,
    draft,
    lots,
    setLots,
    lotSize,
    spotPrice,
    curveInfo,
    wallet,
    submitting,
    success,
    onConfirm,
    onClose,
    onViewPositions,
}) {
    if (!draft) return null;
    const isShort = draft.side === "short";
    const sideTheme = isShort
        ? {
              label: "SELL",
              type: "Credit",
              badge: "bg-rose-100 text-rose-700 border border-rose-200",
              btn: "bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20",
          }
        : {
              label: "BUY",
              type: "Debit",
              badge: "bg-emerald-100 text-emerald-700 border border-emerald-200",
              btn: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20",
          };

    const effectiveLotSize = lotSize || 1;
    const totalQty = lots * effectiveLotSize;
    const estAmount = (draft.row.ltp || 0) * totalQty;
    const reqMargin = isShort ? (spotPrice || draft.strike) * totalQty * 0.15 : estAmount;
    const hasEnoughBalance = wallet ? wallet.balance >= (isShort ? reqMargin : estAmount) : true;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity" onClick={onClose} />
            <div className="relative z-10 flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white text-gray-900 shadow-2xl sm:border-l sm:border-gray-200">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 p-4">
                    <div className="flex items-center gap-2">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-black uppercase ${sideTheme.badge}`}>
                            {sideTheme.label}
                        </span>
                        <div>
                            <div className="text-base font-extrabold text-gray-900">
                                {symbol} {draft.strike} {draft.optRight}
                            </div>
                            <div className="text-xs text-gray-400">
                                LTP: <span className="font-bold text-gray-900">{formatPrice(draft.row.ltp)}</span> · Spot: {formatPrice(spotPrice)}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    >
                        ✕
                    </button>
                </div>

                {!success ? (
                    <div className="flex flex-1 flex-col justify-between p-4 space-y-4">
                        <div className="space-y-4">
                            {/* Quantity & Lots Stepper */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-wider text-gray-400">Order Quantity</div>
                                        <div className="text-xs text-gray-500">
                                            {lots} {lots === 1 ? "Lot" : "Lots"} = <span className="font-bold text-gray-900">{totalQty} qty</span> ({effectiveLotSize}/lot)
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setLots((l) => Math.max(1, l - 1))}
                                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white font-bold text-gray-700 hover:bg-gray-100 active:scale-95"
                                        >
                                            −
                                        </button>
                                        <input
                                            type="number"
                                            min="1"
                                            max="100"
                                            value={lots}
                                            onChange={(e) => setLots(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                                            className="h-8 w-14 rounded-lg border border-gray-300 bg-white text-center text-sm font-bold text-gray-900 outline-none focus:border-emerald-500"
                                        />
                                        <button
                                            onClick={() => setLots((l) => Math.min(100, l + 1))}
                                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 bg-white font-bold text-gray-700 hover:bg-gray-100 active:scale-95"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                {/* Preset Lot Chips */}
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {[1, 2, 5, 10, 20].map((preset) => (
                                        <button
                                            key={preset}
                                            onClick={() => setLots(preset)}
                                            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                                                lots === preset
                                                    ? "bg-emerald-600 text-white font-bold shadow-xs"
                                                    : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                                            }`}
                                        >
                                            {preset} {preset === 1 ? "lot" : "lots"}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Estimated Capital & Margin summary */}
                            <div className="grid grid-cols-2 gap-2.5">
                                <div className="rounded-xl border border-gray-200 bg-white p-3">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                                        {isShort ? "Est. Margin Required" : "Est. Premium Required"}
                                    </div>
                                    <div className="mt-0.5 text-base font-bold tabular-nums text-gray-900">
                                        {formatRupees(isShort ? reqMargin : estAmount)}
                                    </div>
                                    {isShort && (
                                        <div className="text-[10px] text-emerald-600">
                                            Premium Credit: +{formatRupees(estAmount)}
                                        </div>
                                    )}
                                </div>

                                <div className="rounded-xl border border-gray-200 bg-white p-3">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Available Virtual Cash</div>
                                    <div className="mt-0.5 text-base font-bold tabular-nums text-gray-900">
                                        {wallet ? formatRupees(wallet.balance) : "—"}
                                    </div>
                                    {!hasEnoughBalance && (
                                        <div className="text-[10px] font-bold text-rose-600">Insufficient balance</div>
                                    )}
                                </div>
                            </div>

                            {/* Risk & Reward preview */}
                            <div className="grid grid-cols-2 gap-2.5">
                                <div className="rounded-xl border border-gray-200 bg-white p-3">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Max Profit</div>
                                    <div className="mt-0.5 text-sm font-bold tabular-nums text-emerald-600">
                                        {curveInfo.maxProfit === "Unlimited"
                                            ? "Unlimited"
                                            : curveInfo.maxProfit != null
                                            ? formatRupees(curveInfo.maxProfit)
                                            : "—"}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-gray-200 bg-white p-3">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Max Loss</div>
                                    <div className="mt-0.5 text-sm font-bold tabular-nums text-rose-600">
                                        {curveInfo.maxLoss === "Unlimited"
                                            ? "Unlimited"
                                            : curveInfo.maxLoss != null
                                            ? formatRupees(curveInfo.maxLoss)
                                            : "—"}
                                    </div>
                                </div>
                            </div>

                            {/* Payoff Chart */}
                            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-2">
                                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Payoff Diagram</div>
                                <PayoffChart
                                    curve={curveInfo.curve}
                                    spotPrice={spotPrice}
                                    breakevens={curveInfo.breakevens}
                                    expectedMove={null}
                                    height={200}
                                />
                            </div>
                        </div>

                        {/* Action Footer */}
                        <div className="pt-2">
                            <button
                                onClick={onConfirm}
                                disabled={submitting || !hasEnoughBalance}
                                className={`w-full rounded-xl py-3 text-sm font-black uppercase tracking-wider disabled:opacity-50 ${sideTheme.btn}`}
                            >
                                {submitting ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                        Placing Virtual Order…
                                    </span>
                                ) : (
                                    `${sideTheme.label} ${lots} ${lots === 1 ? "Lot" : "Lots"} · ${symbol} ${draft.strike} ${draft.optRight}`
                                )}
                            </button>
                        </div>
                    </div>
                ) : (
                    /* Trade Confirmation Receipt */
                    <div className="flex flex-1 flex-col justify-between p-6">
                        <div className="space-y-4 text-center">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-600">
                                ✓
                            </div>
                            <div>
                                <h3 className="text-lg font-black text-gray-900">Order Successfully Placed!</h3>
                                <p className="mt-1 text-xs text-gray-400">
                                    Your virtual paper order was executed at real-time market price.
                                </p>
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
                                <div className="flex justify-between py-1 text-xs">
                                    <span className="text-gray-400">Contract</span>
                                    <span className="font-bold text-gray-900">
                                        {symbol} {draft.strike} {draft.optRight}
                                    </span>
                                </div>
                                <div className="flex justify-between py-1 text-xs">
                                    <span className="text-gray-400">Side</span>
                                    <span className={`font-bold ${isShort ? "text-rose-600" : "text-emerald-600"}`}>
                                        {isShort ? "SELL (Short)" : "BUY (Long)"}
                                    </span>
                                </div>
                                <div className="flex justify-between py-1 text-xs">
                                    <span className="text-gray-400">Executed Quantity</span>
                                    <span className="font-bold text-gray-900">
                                        {lots} lots ({totalQty} qty)
                                    </span>
                                </div>
                                <div className="flex justify-between py-1 text-xs">
                                    <span className="text-gray-400">Execution Price (LTP)</span>
                                    <span className="font-bold text-gray-900">
                                        {formatPrice(draft.row.ltp)}
                                    </span>
                                </div>
                            </div>

                            {/* Payoff Chart in Confirmation */}
                            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-2">
                                <PayoffChart
                                    curve={curveInfo.curve}
                                    spotPrice={spotPrice}
                                    breakevens={curveInfo.breakevens}
                                    expectedMove={null}
                                    height={180}
                                />
                            </div>
                        </div>

                        <div className="flex gap-2 pt-4">
                            <button
                                onClick={onClose}
                                className="flex-1 rounded-xl border border-gray-300 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
                            >
                                Place Another
                            </button>
                            <button
                                onClick={() => {
                                    onClose();
                                    onViewPositions();
                                }}
                                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow hover:bg-emerald-700"
                            >
                                View Positions →
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Confirmation modal before closing all positions
function SquareOffModal({ isOpen, onClose, onConfirm, positionCount, totalPnl, busy }) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl">
                <div className="text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-xl text-rose-600">
                        ⚠️
                    </div>
                    <h3 className="text-base font-extrabold text-gray-900">
                        Square Off {positionCount > 1 ? `All ${positionCount} Positions` : "Position"}?
                    </h3>
                    <p className="mt-1 text-xs text-gray-400">
                        This will market exit your open paper positions and lock in your unrealized MTM P&L.
                    </p>
                    {totalPnl != null && (
                        <div className="mt-3 rounded-xl bg-gray-50 p-2.5">
                            <span className="text-xs text-gray-400">Unrealized MTM P&L: </span>
                            <span className={`text-sm font-black tabular-nums ${pnlColor(totalPnl)}`}>
                                {totalPnl >= 0 ? "+" : ""}
                                {formatRupees(totalPnl)}
                            </span>
                        </div>
                    )}
                </div>

                <div className="mt-5 flex gap-2">
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="flex-1 rounded-xl border border-gray-300 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={busy}
                        className="flex-1 rounded-xl bg-rose-600 py-2 text-xs font-bold text-white shadow-md hover:bg-rose-700 disabled:opacity-50"
                    >
                        {busy ? "Squaring off…" : "Confirm Exit"}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Commercial Pro Upgrade & Refill Banner
function CommercialBanner({ wallet, user, onBuyPro, onBuyRefill, busy }) {
    if (!user) {
        return (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-xs">
                <div className="space-y-0.5 text-center sm:text-left">
                    <div className="text-sm font-extrabold text-emerald-900">Start 2-Day Free Virtual Paper Trading Trial</div>
                    <div className="text-xs text-emerald-700">
                        Get ₹50,000 virtual balance to test options strategies with live tick data risk-free.
                    </div>
                </div>
                <Link
                    to="/login"
                    className="whitespace-nowrap rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white shadow-md hover:bg-emerald-700 active:scale-95"
                >
                    Claim ₹50,000 Free Trial →
                </Link>
            </div>
        );
    }

    if (wallet?.isPro) {
        return (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50/60 p-4">
                <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-lg text-white shadow-xs font-black">
                        ★
                    </span>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-gray-900">Pro Member Active</span>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-800">
                                Unlimited Live Trading
                            </span>
                        </div>
                        <div className="text-xs text-gray-400">
                            Available Balance: <span className="font-bold tabular-nums text-gray-900">{formatRupees(wallet.balance)}</span>
                        </div>
                    </div>
                </div>
                <button
                    onClick={onBuyRefill}
                    disabled={busy === "refill"}
                    className="rounded-xl border border-amber-500 bg-white px-4 py-2 text-xs font-bold text-amber-800 shadow-xs hover:bg-amber-50 disabled:opacity-50"
                >
                    {busy === "refill" ? "Opening Razorpay…" : "Refill ₹5,00,000 — ₹100"}
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-600 to-teal-700 p-4 text-white shadow-md">
            <div className="space-y-0.5 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start gap-2">
                    <span className="text-sm font-black">Upgrade to Pro Membership</span>
                    <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-black uppercase text-gray-900">
                        ₹499/mo
                    </span>
                </div>
                <div className="text-xs text-emerald-100">
                    {wallet?.trialActive ? (
                        <span>Free Trial active ({timeLeft(wallet.trialExpiresAt)}). Upgrade now for unlimited trades & ₹5L refills.</span>
                    ) : (
                        <span>Your free trial has ended. Upgrade to Pro to resume real-time paper trading.</span>
                    )}
                </div>
            </div>
            <button
                onClick={onBuyPro}
                disabled={busy === "pro"}
                className="whitespace-nowrap rounded-xl bg-amber-400 px-5 py-2 text-xs font-black text-gray-900 shadow-md hover:bg-amber-300 active:scale-95 disabled:opacity-50"
            >
                {busy === "pro" ? "Opening Razorpay…" : "Unlock Pro for ₹499 →"}
            </button>
        </div>
    );
}

export default function PaperTrade() {
    const { user, token, refreshUser } = useAuth();
    const navigate = useNavigate();

    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(() => !!token);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null); // 'pro' | 'refill' | null

    const [positions, setPositions] = useState([]);
    const [closedPositions, setClosedPositions] = useState([]);
    const [closingId, setClosingId] = useState(null);
    const [closingAll, setClosingAll] = useState(false);
    const [showSquareOffModal, setShowSquareOffModal] = useState(false);

    const [activeTab, setActiveTab] = useState("positions");
    const [strikeRange, setStrikeRange] = useState(20);

    const [tradeDraft, setTradeDraft] = useState(null);
    const [tradeLots, setTradeLots] = useState(1);
    const [tradeSubmitting, setTradeSubmitting] = useState(false);
    const [tradeSuccess, setTradeSuccess] = useState(false);

    const { symbol, setSymbol, data, marketStatus } = useOptionChain("NIFTY");
    const positionsPollRef = useRef(null);
    const atmRowRef = useRef(null);
    const [symbolList, setSymbolList] = useState(FALLBACK_SYMBOLS);

    useEffect(() => {
        fetchSymbolList()
            .then((d) => setSymbolList(d))
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!data?.rows?.length) return;
        const raf = requestAnimationFrame(() =>
            atmRowRef.current?.scrollIntoView({ behavior: "instant", block: "center" })
        );
        return () => cancelAnimationFrame(raf);
    }, [data?.selectedExpiry, symbol, data?.rows?.length, strikeRange]);

    const loadWallet = useCallback(async () => {
        try {
            const d = await fetchWallet(token);
            setWallet(d);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [token]);

    const loadPositions = useCallback(async () => {
        try {
            const [open, closed] = await Promise.all([
                fetchPositions(token, "open"),
                fetchPositions(token, "closed"),
            ]);
            setPositions(open.positions || []);
            setClosedPositions(closed.positions || []);
        } catch {
            // Keep last state on transient failure
        }
    }, [token]);

    useEffect(() => {
        if (token) {
            loadWallet();
            loadPositions();
        } else {
            setLoading(false);
        }
    }, [token, loadWallet, loadPositions]);

    useEffect(() => {
        if (!token) return;
        positionsPollRef.current = setInterval(loadPositions, POSITIONS_POLL_MS);
        return () => clearInterval(positionsPollRef.current);
    }, [token, loadPositions]);

    async function runCheckout({ createOrder, verifyPayment, description, onDone }) {
        setError(null);
        try {
            const Razorpay = await loadRazorpayCheckout();
            const order = await createOrder(token);
            const rzp = new Razorpay({
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                order_id: order.orderId,
                name: "Bazaar Sync",
                description,
                handler: async (response) => {
                    try {
                        await verifyPayment(token, {
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                        });
                        await onDone();
                    } catch (err) {
                        setError(err.message);
                    } finally {
                        setBusy(null);
                    }
                },
                modal: { ondismiss: () => setBusy(null) },
                theme: { color: "#059669" },
            });
            rzp.on("payment.failed", (resp) => {
                setError(resp.error?.description || "Payment failed");
                setBusy(null);
            });
            rzp.open();
        } catch (err) {
            setError(err.message);
            setBusy(null);
        }
    }

    function buyPro() {
        setBusy("pro");
        runCheckout({
            createOrder: createProOrder,
            verifyPayment: verifyProPayment,
            description: "Pro membership — ₹499/mo",
            onDone: async () => {
                await refreshUser();
                await loadWallet();
            },
        });
    }

    function buyRefill() {
        setBusy("refill");
        runCheckout({
            createOrder: createRefillOrder,
            verifyPayment: verifyRefillPayment,
            description: "Paper capital refill — ₹5,00,000",
            onDone: loadWallet,
        });
    }

    function openTrade(strike, optRight, side, row) {
        setError(null);
        setTradeDraft({ strike, optRight, side, row });
        setTradeSuccess(false);
        setTradeLots(1);
    }

    function closeDrawer() {
        setTradeDraft(null);
        setTradeSuccess(false);
        setTradeLots(1);
    }

    async function confirmTrade() {
        if (!tradeDraft) return;
        setError(null);
        setTradeSubmitting(true);
        try {
            await openPosition(token, {
                symbol,
                expiry: data.selectedExpiry,
                strike: tradeDraft.strike,
                optRight: tradeDraft.optRight,
                lots: tradeLots,
                side: tradeDraft.side,
            });
            setTradeSuccess(true);
            await Promise.all([loadWallet(), loadPositions()]);
        } catch (err) {
            setError(err.message);
        } finally {
            setTradeSubmitting(false);
        }
    }

    const tradeDrawerCurve = useMemo(() => {
        if (!tradeDraft || !data?.spotPrice) return { curve: [], breakevens: [], maxProfit: null, maxLoss: null };
        const leg = {
            action: tradeDraft.side === "long" ? "buy" : "sell",
            type: tradeDraft.optRight,
            strike: tradeDraft.strike,
            premium: tradeDraft.row.ltp,
            qty: tradeLots,
            lotSize: data.lotSize,
            iv: tradeDraft.row.iv,
            expiry: data.selectedExpiry,
        };
        const spread = data.spotPrice * 0.08;
        const curve = computePayoffCurve([leg], { minPrice: data.spotPrice - spread, maxPrice: data.spotPrice + spread }) || [];
        const breakevens = computeBreakevens(curve) || [];
        const { maxProfit, maxLoss } = computeMaxProfitLoss([leg], curve);
        return { curve, breakevens, maxProfit, maxLoss };
    }, [tradeDraft, tradeLots, data]);

    async function handleClose(id) {
        setError(null);
        setClosingId(id);
        try {
            await closePosition(token, id);
            await Promise.all([loadWallet(), loadPositions()]);
        } catch (err) {
            setError(err.message);
        } finally {
            setClosingId(null);
        }
    }

    async function handleConfirmSquareOffAll() {
        setError(null);
        setClosingAll(true);
        try {
            const results = await Promise.allSettled(positions.map((p) => closePosition(token, p.id)));
            const failed = results.filter((r) => r.status === "rejected").length;
            if (failed) setError(`${failed} position(s) failed to close — please check network and try again.`);
            await Promise.all([loadWallet(), loadPositions()]);
            setShowSquareOffModal(false);
        } finally {
            setClosingAll(false);
        }
    }

    const filteredChainRows = useMemo(() => {
        if (!data?.rows?.length) return [];
        if (strikeRange == null) return data.rows;
        const atmIndex = data.rows.findIndex((r) => r.strike === data.atmStrike);
        if (atmIndex === -1) return data.rows;
        const start = Math.max(0, atmIndex - strikeRange);
        const end = Math.min(data.rows.length, atmIndex + strikeRange + 1);
        return data.rows.slice(start, end);
    }, [data?.rows, data?.atmStrike, strikeRange]);

    const equitySeries = useMemo(() => {
        if (!wallet?.ledger?.length) return [];
        return [...wallet.ledger].reverse().map((row, i) => ({ i, balance: Number(row.balance_after) }));
    }, [wallet]);

    const totalGranted = useMemo(() => {
        if (!wallet?.ledger?.length) return 0;
        return wallet.ledger
            .filter((r) => CAPITAL_GRANT_TYPES.has(r.type))
            .reduce((sum, r) => sum + Number(r.amount), 0);
    }, [wallet]);

    const openUnrealized = useMemo(
        () => positions.reduce((sum, p) => sum + (p.unrealizedPnl != null ? Number(p.unrealizedPnl) : 0), 0),
        [positions]
    );

    const totalPnl = wallet ? wallet.balance + openUnrealized - totalGranted : null;
    const totalPnlPct = wallet && totalGranted > 0 ? (totalPnl / totalGranted) * 100 : null;

    const todaysPnl = useMemo(() => {
        const fromOpen = positions
            .filter((p) => isToday(p.entry_time))
            .reduce((sum, p) => sum + (p.unrealizedPnl != null ? Number(p.unrealizedPnl) : 0), 0);
        const fromClosed = closedPositions
            .filter((p) => isToday(p.exit_time))
            .reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0);
        return fromOpen + fromClosed;
    }, [positions, closedPositions]);

    const winRate = closedPositions.length
        ? (closedPositions.filter((p) => Number(p.realized_pnl) > 0).length / closedPositions.length) * 100
        : null;

    const capitalDeployed = useMemo(
        () =>
            positions.reduce((sum, p) => {
                if (p.side === "short") return sum + Number(p.margin_blocked || 0);
                return sum + Number(p.entry_price) * p.lots * p.lot_size;
            }, 0),
        [positions]
    );

    const closedStats = useMemo(() => {
        if (!closedPositions.length) return null;
        let totalRealized = 0;
        let winCount = 0;
        let lossCount = 0;
        let totalWinAmt = 0;
        let totalLossAmt = 0;

        for (const p of closedPositions) {
            const val = Number(p.realized_pnl || 0);
            totalRealized += val;
            if (val > 0) {
                winCount++;
                totalWinAmt += val;
            } else if (val < 0) {
                lossCount++;
                totalLossAmt += Math.abs(val);
            }
        }
        const profitFactor = totalLossAmt > 0 ? totalWinAmt / totalLossAmt : totalWinAmt > 0 ? 99 : 0;
        return {
            totalRealized,
            winCount,
            lossCount,
            avgWin: winCount > 0 ? totalWinAmt / winCount : 0,
            avgLoss: lossCount > 0 ? totalLossAmt / lossCount : 0,
            profitFactor,
        };
    }, [closedPositions]);

    const isLiveSymbol = symbolList.liveSymbols.includes(symbol);
    const canTrade = !!user && wallet?.accessAllowed && marketStatus?.isOpen && isLiveSymbol && !!data?.rows?.length;
    const goToLogin = () => navigate("/login");

    if (loading) {
        return (
            <div className="flex min-h-[calc(100vh-57px)] items-center justify-center bg-gray-50 text-sm font-semibold text-gray-400">
                <div className="flex items-center gap-2">
                    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                    Loading Paper Trading Dashboard…
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[calc(100vh-57px)] w-full bg-gray-50 text-gray-900">
            <div className="mx-auto max-w-[1700px] px-3 py-4 sm:px-6 space-y-4">
                {/* Top Commercial Banner */}
                <CommercialBanner
                    wallet={wallet}
                    user={user}
                    onBuyPro={buyPro}
                    onBuyRefill={buyRefill}
                    busy={busy}
                />

                {/* Header bar: Symbol Selector, Spot Quote & Global Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-xs sm:px-5 sm:py-3.5">
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white font-black text-xs shadow-xs">
                                ⚡
                            </span>
                            <span className="text-sm font-extrabold tracking-tight text-gray-900">
                                Paper Trading
                            </span>
                        </div>

                        <div className="h-4 w-px bg-gray-200 hidden sm:block" />

                        <SymbolSelector symbol={symbol} symbolList={symbolList} onPick={setSymbol} />

                        {data && (
                            <div className="flex items-baseline gap-2 text-xs sm:text-sm">
                                <span className="font-extrabold tabular-nums text-gray-900">
                                    {formatPrice(data.spotPrice)}
                                </span>
                                <span className={`font-bold tabular-nums ${pnlColor(data.spotChange)}`}>
                                    {data.spotChange != null ? (
                                        <>
                                            {data.spotChange >= 0 ? "▲" : "▼"} {formatPrice(Math.abs(data.spotChange))} (
                                            {formatPercent(data.spotChangePercent)})
                                        </>
                                    ) : (
                                        ""
                                    )}
                                </span>
                            </div>
                        )}

                        {data?.vix != null && (
                            <div className="hidden md:flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                <span className="text-gray-400">VIX:</span>
                                <span className="font-bold tabular-nums text-gray-900">{formatPrice(data.vix)}</span>
                            </div>
                        )}
                        {data?.futurePrice != null && (
                            <div className="hidden lg:flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                <span className="text-gray-400">FUT:</span>
                                <span className="font-bold tabular-nums text-gray-900">{formatPrice(data.futurePrice)}</span>
                            </div>
                        )}
                    </div>

                    {/* Right side market & account indicators */}
                    <div className="flex items-center gap-2">
                        {marketStatus?.isOpen ? (
                            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                                LIVE MARKET
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 border border-amber-200">
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                MARKET CLOSED
                            </span>
                        )}

                        <Link
                            to="/strategy-builder"
                            className="hidden sm:flex items-center gap-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-100"
                        >
                            <span>Strategy Builder</span>
                            <span>→</span>
                        </Link>
                    </div>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs font-medium text-rose-700">
                        ⚠️ {error}
                    </div>
                )}

                {/* Market Warnings */}
                {!marketStatus?.isOpen && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-800">
                        ⚡ Market is currently closed. Live option pricing and instant simulated fills are active during market hours (09:15 - 15:30 IST).
                    </div>
                )}

                {marketStatus?.isOpen && !isLiveSymbol && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-800">
                        Note: {symbol} is available for historical exploration. Active live paper execution is supported for NIFTY, BANKNIFTY, and FINNIFTY.
                    </div>
                )}

                {/* KPI Metrics Dashboard */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
                    {/* 1. Total MTM / Overall P&L */}
                    <div className="col-span-2 sm:col-span-1 rounded-xl border border-gray-200 bg-white p-3 shadow-xs sm:p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Total Unrealized P&L</span>
                            {totalPnlPct != null && (
                                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${pnlBg(totalPnl)}`}>
                                    {totalPnl >= 0 ? "+" : ""}{totalPnlPct.toFixed(2)}%
                                </span>
                            )}
                        </div>
                        <div className={`mt-1 text-xl sm:text-2xl font-black tabular-nums tracking-tight ${pnlColor(totalPnl)}`}>
                            {totalPnl != null ? formatRupees(totalPnl) : "—"}
                        </div>
                        {equitySeries.length > 1 && (
                            <div className="mt-1 h-8">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={equitySeries} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="ptEquityMini" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                                                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <Tooltip
                                            contentStyle={{
                                                background: "#ffffff",
                                                border: "1px solid #e5e7eb",
                                                borderRadius: 6,
                                                fontSize: 10,
                                            }}
                                            formatter={(v) => [formatRupees(v), "Balance"]}
                                        />
                                        <Area type="monotone" dataKey="balance" stroke="#10b981" strokeWidth={1.5} fill="url(#ptEquityMini)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* 2. Today's P&L */}
                    <StatCard
                        label="Today's P&L"
                        value={formatRupees(todaysPnl)}
                        valueClassName={pnlColor(todaysPnl)}
                        subtext="Intraday unrealized + realized"
                    />

                    {/* 3. Available Virtual Cash */}
                    <StatCard
                        label="Virtual Cash"
                        value={wallet ? formatRupees(wallet.balance) : "—"}
                        subtext={capitalDeployed > 0 ? `Margin Deployed: ${formatRupees(capitalDeployed)}` : "100% Capital Available"}
                    />

                    {/* 4. Win Rate & Trades */}
                    <StatCard
                        label="Win Rate"
                        value={winRate != null ? `${winRate.toFixed(0)}%` : "—"}
                        subtext={`${positions.length} Open · ${closedPositions.length} Closed`}
                    />

                    {/* 5. Account & Commercial Tier */}
                    <div className="col-span-2 sm:col-span-2 md:col-span-4 lg:col-span-1 flex flex-col justify-between rounded-xl border border-gray-200 bg-white p-3 shadow-xs sm:p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Account Tier</span>
                            {wallet?.isPro ? (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-800">
                                    PRO
                                </span>
                            ) : wallet?.trialActive ? (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                    TRIAL
                                </span>
                            ) : (
                                <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">
                                    EXPIRED
                                </span>
                            )}
                        </div>
                        <div className="mt-1 text-sm font-extrabold text-gray-900">
                            {wallet?.isPro
                                ? "Unlimited Trading"
                                : wallet?.trialActive
                                ? timeLeft(wallet.trialExpiresAt)
                                : "Upgrade Required"}
                        </div>
                        <div className="mt-1 flex gap-1">
                            {!wallet?.isPro && (
                                <button
                                    onClick={buyPro}
                                    disabled={busy === "pro"}
                                    className="w-full rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-black text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                    {busy === "pro" ? "Opening…" : "Get Pro ₹499"}
                                </button>
                            )}
                            {wallet?.isPro && (
                                <button
                                    onClick={buyRefill}
                                    disabled={busy === "refill"}
                                    className="w-full rounded-lg border border-emerald-500 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                >
                                    {busy === "refill" ? "Opening…" : "Refill ₹5L (₹100)"}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Responsive Navigation Tabs (Mobile, Tablet, Desktop) */}
                <div className="flex items-center justify-between border-b border-gray-200">
                    <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto pb-1 scrollbar-none">
                        <button
                            onClick={() => setActiveTab("positions")}
                            className={`flex items-center gap-1.5 rounded-t-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                                activeTab === "positions"
                                    ? "border-b-2 border-emerald-600 text-emerald-600 bg-emerald-50/60"
                                    : "text-gray-500 hover:text-gray-900"
                            }`}
                        >
                            <span>📊 Open Positions</span>
                            <span className="rounded-full bg-gray-200 px-1.5 py-0.2 text-[10px] font-extrabold text-gray-700">
                                {positions.length}
                            </span>
                        </button>

                        <button
                            onClick={() => setActiveTab("chain")}
                            className={`flex items-center gap-1.5 rounded-t-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                                activeTab === "chain"
                                    ? "border-b-2 border-emerald-600 text-emerald-600 bg-emerald-50/60"
                                    : "text-gray-500 hover:text-gray-900"
                            }`}
                        >
                            <span>⚡ Option Chain / Trade</span>
                        </button>

                        <button
                            onClick={() => setActiveTab("closed")}
                            className={`flex items-center gap-1.5 rounded-t-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                                activeTab === "closed"
                                    ? "border-b-2 border-emerald-600 text-emerald-600 bg-emerald-50/60"
                                    : "text-gray-500 hover:text-gray-900"
                            }`}
                        >
                            <span>📜 Closed Trades</span>
                            <span className="rounded-full bg-gray-200 px-1.5 py-0.2 text-[10px] font-extrabold text-gray-700">
                                {closedPositions.length}
                            </span>
                        </button>

                        <button
                            onClick={() => setActiveTab("wallet")}
                            className={`flex items-center gap-1.5 rounded-t-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                                activeTab === "wallet"
                                    ? "border-b-2 border-emerald-600 text-emerald-600 bg-emerald-50/60"
                                    : "text-gray-500 hover:text-gray-900"
                            }`}
                        >
                            <span>💳 Ledger & Wallet</span>
                        </button>
                    </div>

                    {/* Quick Action Button in Tab Bar */}
                    {activeTab === "positions" && positions.length > 0 && (
                        <button
                            onClick={() => setShowSquareOffModal(true)}
                            disabled={closingAll}
                            className="rounded-xl border border-rose-500 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 shadow-xs hover:bg-rose-100 disabled:opacity-50"
                        >
                            Square Off All ({positions.length})
                        </button>
                    )}
                </div>

                {/* TAB 1: OPEN POSITIONS */}
                {activeTab === "positions" && (
                    <div className="space-y-4">
                        {!user ? (
                            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-xs">
                                <h3 className="text-base font-extrabold text-gray-900">Track Live Real-time Positions</h3>
                                <p className="mx-auto mt-2 max-w-md text-xs text-gray-400">
                                    Log in to start your free trial with ₹50,000 virtual balance. Trade live options and view real-time MTM updates.
                                </p>
                                <button
                                    onClick={goToLogin}
                                    className="mt-4 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white shadow-md hover:bg-emerald-700"
                                >
                                    Log in to start trading
                                </button>
                            </div>
                        ) : positions.length > 0 ? (
                            <div className="space-y-3">
                                {/* Desktop Table View */}
                                <div className="hidden md:block overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-100 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                                                <th className="px-4 py-3">Instrument</th>
                                                <th className="px-4 py-3">Side</th>
                                                <th className="px-4 py-3 text-right">Qty (Lots)</th>
                                                <th className="px-4 py-3 text-right">Entry Price</th>
                                                <th className="px-4 py-3 text-right">Live LTP</th>
                                                <th className="px-4 py-3 text-right">Unrealized P&L</th>
                                                <th className="px-4 py-3 text-right">Entry Time</th>
                                                <th className="px-4 py-3 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {positions.map((p) => {
                                                const pnlVal = p.unrealizedPnl != null ? Number(p.unrealizedPnl) : null;
                                                const pnlPct =
                                                    pnlVal != null && p.entry_price > 0
                                                        ? (pnlVal / (p.entry_price * p.lots * p.lot_size)) * 100
                                                        : null;

                                                return (
                                                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-3 font-extrabold text-gray-900">
                                                            {p.symbol} {p.strike} {p.opt_right}
                                                            <span className="ml-1.5 text-[10px] font-normal text-gray-400">
                                                                ({p.expiry})
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span
                                                                className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${
                                                                    p.side === "short"
                                                                        ? "bg-rose-100 text-rose-700"
                                                                        : "bg-emerald-100 text-emerald-700"
                                                                }`}
                                                            >
                                                                {p.side === "short" ? "SELL / SHORT" : "BUY / LONG"}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-800">
                                                            {p.lots * p.lot_size} ({p.lots} {p.lots === 1 ? "lot" : "lots"})
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-800">
                                                            {formatPrice(p.entry_price)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-bold tabular-nums text-gray-900">
                                                            {p.livePrice != null ? formatPrice(p.livePrice) : "—"}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <div className={`font-black tabular-nums ${pnlColor(pnlVal)}`}>
                                                                {pnlVal != null ? `${pnlVal >= 0 ? "+" : ""}${formatRupees(pnlVal)}` : "—"}
                                                            </div>
                                                            {pnlPct != null && (
                                                                <div className={`text-[10px] font-bold tabular-nums ${pnlColor(pnlVal)}`}>
                                                                    {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-gray-400 text-[11px]">
                                                            {formatDateTime(p.entry_time)}
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <button
                                                                onClick={() => handleClose(p.id)}
                                                                disabled={closingId === p.id}
                                                                className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-50"
                                                            >
                                                                {closingId === p.id ? "Exiting…" : "Square Off"}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Cards View */}
                                <div className="space-y-2.5 md:hidden">
                                    {positions.map((p) => {
                                        const pnlVal = p.unrealizedPnl != null ? Number(p.unrealizedPnl) : null;
                                        const pnlPct =
                                            pnlVal != null && p.entry_price > 0
                                                ? (pnlVal / (p.entry_price * p.lots * p.lot_size)) * 100
                                                : null;

                                        return (
                                            <div
                                                key={p.id}
                                                className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-xs space-y-2.5"
                                            >
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <div className="flex items-center gap-1.5">
                                                            <span
                                                                className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                                                    p.side === "short"
                                                                        ? "bg-rose-100 text-rose-700"
                                                                        : "bg-emerald-100 text-emerald-700"
                                                                }`}
                                                            >
                                                                {p.side === "short" ? "SELL" : "BUY"}
                                                            </span>
                                                            <span className="font-extrabold text-sm text-gray-900">
                                                                {p.symbol} {p.strike} {p.opt_right}
                                                            </span>
                                                        </div>
                                                        <div className="mt-0.5 text-[11px] text-gray-400">
                                                            {p.lots} {p.lots === 1 ? "lot" : "lots"} ({p.lots * p.lot_size} qty) · {p.expiry}
                                                        </div>
                                                    </div>

                                                    <div className="text-right">
                                                        <div className={`text-sm font-black tabular-nums ${pnlColor(pnlVal)}`}>
                                                            {pnlVal != null ? `${pnlVal >= 0 ? "+" : ""}${formatRupees(pnlVal)}` : "—"}
                                                        </div>
                                                        {pnlPct != null && (
                                                            <div className={`text-[10px] font-bold tabular-nums ${pnlColor(pnlVal)}`}>
                                                                {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
                                                    <div className="text-gray-400">
                                                        Entry: <span className="font-bold text-gray-700">{formatPrice(p.entry_price)}</span> · LTP: <span className="font-bold text-gray-900">{p.livePrice != null ? formatPrice(p.livePrice) : "—"}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => handleClose(p.id)}
                                                        disabled={closingId === p.id}
                                                        className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white shadow-xs hover:bg-rose-700 active:scale-95 disabled:opacity-50"
                                                    >
                                                        {closingId === p.id ? "Exiting…" : "Square Off"}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-xs">
                                <div className="text-3xl mb-2">🎯</div>
                                <h3 className="text-sm font-extrabold text-gray-900">No Open Positions</h3>
                                <p className="mt-1 text-xs text-gray-400">
                                    Open the Option Chain tab to place a paper order or build a strategy.
                                </p>
                                <button
                                    onClick={() => setActiveTab("chain")}
                                    className="mt-4 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700"
                                >
                                    Browse Option Chain →
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* TAB 2: OPTION CHAIN / TRADE */}
                {activeTab === "chain" && (
                    <div className="rounded-2xl border border-gray-200 bg-white shadow-xs overflow-hidden">
                        {/* Option Chain Control Strip */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-black text-white">
                                    {symbol} CHAIN
                                </span>
                                {data && (
                                    <span className="text-xs text-gray-400">
                                        Lot size: <strong className="text-gray-700">{data.lotSize ?? "-"}</strong>
                                    </span>
                                )}
                            </div>

                            {/* Expiry Selector Pills */}
                            {data?.expiries?.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1">
                                    <span className="text-[10px] font-bold uppercase text-gray-400 mr-1 hidden sm:inline">Expiry:</span>
                                    {data.expiries.slice(0, 6).map((exp) => (
                                        <span
                                            key={exp}
                                            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                                                exp === data.selectedExpiry
                                                    ? "bg-emerald-600 text-white shadow-xs"
                                                    : "bg-white text-gray-600 border border-gray-200"
                                            }`}
                                        >
                                            {exp}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Strike Range Filter Pills */}
                            <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold uppercase text-gray-400 mr-1 hidden sm:inline">Strikes:</span>
                                {STRIKE_RANGES.map((rng) => (
                                    <button
                                        key={rng.label}
                                        onClick={() => setStrikeRange(rng.value)}
                                        className={`rounded-lg px-2 py-0.5 text-[11px] font-bold transition-colors ${
                                            strikeRange === rng.value
                                                ? "bg-emerald-600 text-white shadow-xs"
                                                : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-100"
                                        }`}
                                    >
                                        {rng.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Option Chain Table */}
                        <div className="max-h-[620px] overflow-y-auto overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50 text-gray-600 backdrop-blur-xs">
                                        <th className="px-3 py-2 text-right font-semibold">OI (CE)</th>
                                        <th className="px-3 py-2 text-right font-semibold hidden sm:table-cell">Vol</th>
                                        <th className="px-3 py-2 text-right font-semibold hidden md:table-cell">IV</th>
                                        <th className="px-3 py-2 text-right font-bold text-emerald-600">Call LTP</th>
                                        <th className="px-3 py-2 text-center font-black text-gray-900 bg-gray-100">
                                            STRIKE
                                        </th>
                                        <th className="px-3 py-2 text-left font-bold text-rose-600">Put LTP</th>
                                        <th className="px-3 py-2 text-left font-semibold hidden md:table-cell">IV</th>
                                        <th className="px-3 py-2 text-left font-semibold hidden sm:table-cell">Vol</th>
                                        <th className="px-3 py-2 text-left font-semibold">OI (PE)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredChainRows.map((row) => {
                                        const isAtm = row.strike === data.atmStrike;
                                        return (
                                            <tr
                                                key={row.strike}
                                                ref={isAtm ? atmRowRef : null}
                                                className={`border-t border-gray-100 transition-colors ${
                                                    isAtm
                                                        ? "bg-amber-50 font-bold ring-1 ring-inset ring-amber-400"
                                                        : "hover:bg-gray-50"
                                                }`}
                                            >
                                                <td className="px-3 py-2 text-right tabular-nums text-gray-400">
                                                    {formatOi(row.ce?.oi)}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums text-gray-400 hidden sm:table-cell">
                                                    {formatOi(row.ce?.volume)}
                                                </td>
                                                <td className="px-3 py-2 text-right tabular-nums text-gray-400 hidden md:table-cell">
                                                    {row.ce?.iv != null ? `${Number(row.ce.iv).toFixed(1)}%` : "-"}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <TradeCell
                                                        strike={row.strike}
                                                        optRight="CE"
                                                        side={row.ce}
                                                        loggedIn={!!user}
                                                        canTrade={canTrade}
                                                        onOpenTrade={openTrade}
                                                        onLoginRequired={goToLogin}
                                                    />
                                                </td>
                                                <td
                                                    className={`px-3 py-2 text-center font-black tabular-nums bg-gray-50 ${
                                                        isAtm ? "text-amber-700" : "text-gray-900"
                                                    }`}
                                                >
                                                    {row.strike}
                                                </td>
                                                <td className="px-3 py-2">
                                                    <TradeCell
                                                        strike={row.strike}
                                                        optRight="PE"
                                                        side={row.pe}
                                                        loggedIn={!!user}
                                                        canTrade={canTrade}
                                                        onOpenTrade={openTrade}
                                                        onLoginRequired={goToLogin}
                                                    />
                                                </td>
                                                <td className="px-3 py-2 text-left tabular-nums text-gray-400 hidden md:table-cell">
                                                    {row.pe?.iv != null ? `${Number(row.pe.iv).toFixed(1)}%` : "-"}
                                                </td>
                                                <td className="px-3 py-2 text-left tabular-nums text-gray-400 hidden sm:table-cell">
                                                    {formatOi(row.pe?.volume)}
                                                </td>
                                                <td className="px-3 py-2 text-left tabular-nums text-gray-400">
                                                    {formatOi(row.pe?.oi)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {!filteredChainRows.length && (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-12 text-center text-xs text-gray-400">
                                                No option chain data available for selected filter.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Chain Analytics Footer */}
                        <div className="flex flex-wrap items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-400">
                            <div className="flex items-center gap-4">
                                <span>
                                    Spot: <strong className="text-gray-900">{formatPrice(data?.spotPrice)}</strong>
                                </span>
                                <span>
                                    Max Pain: <strong className="text-gray-900">{data?.maxPainStrike ?? "-"}</strong>
                                </span>
                                <span>
                                    PCR: <strong className="text-gray-900">{data?.pcr ?? "-"}</strong>
                                </span>
                            </div>
                            <div className="text-[11px] text-gray-400">
                                Hover over LTP cell to Buy (B) or Sell (S) into Paper Portfolio
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 3: CLOSED TRADES HISTORY */}
                {activeTab === "closed" && (
                    <div className="space-y-4">
                        {closedStats && (
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <StatCard
                                    label="Total Realized P&L"
                                    value={formatRupees(closedStats.totalRealized)}
                                    valueClassName={pnlColor(closedStats.totalRealized)}
                                />
                                <StatCard
                                    label="Win / Loss Ratio"
                                    value={`${closedStats.winCount}W / ${closedStats.lossCount}L`}
                                    subtext={`Profit Factor: ${closedStats.profitFactor.toFixed(2)}`}
                                />
                                <StatCard
                                    label="Avg Win"
                                    value={formatRupees(closedStats.avgWin)}
                                    valueClassName="text-emerald-600"
                                />
                                <StatCard
                                    label="Avg Loss"
                                    value={formatRupees(closedStats.avgLoss)}
                                    valueClassName="text-rose-600"
                                />
                            </div>
                        )}

                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
                            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3 flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                                    Historical Closed Trades ({closedPositions.length})
                                </h3>
                            </div>

                            {closedPositions.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                                                <th className="px-4 py-3">Contract</th>
                                                <th className="px-4 py-3">Side</th>
                                                <th className="px-4 py-3 text-right">Qty</th>
                                                <th className="px-4 py-3 text-right">Entry Price</th>
                                                <th className="px-4 py-3 text-right">Exit Price</th>
                                                <th className="px-4 py-3 text-right">Realized P&L</th>
                                                <th className="px-4 py-3 text-right">Exit Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {closedPositions.map((cp) => {
                                                const pnlVal = Number(cp.realized_pnl || 0);
                                                return (
                                                    <tr key={cp.id} className="hover:bg-gray-50">
                                                        <td className="px-4 py-3 font-bold text-gray-900">
                                                            {cp.symbol} {cp.strike} {cp.opt_right}
                                                            <span className="ml-1 text-[10px] text-gray-400 font-normal">({cp.expiry})</span>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <span
                                                                className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                                                    cp.side === "short"
                                                                        ? "bg-rose-100 text-rose-700"
                                                                        : "bg-emerald-100 text-emerald-700"
                                                                }`}
                                                            >
                                                                {cp.side === "short" ? "SELL" : "BUY"}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-800">
                                                            {cp.lots * cp.lot_size} ({cp.lots}L)
                                                        </td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                                                            {formatPrice(cp.entry_price)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                                                            {formatPrice(cp.exit_price)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right">
                                                            <span className={`font-black tabular-nums ${pnlColor(pnlVal)}`}>
                                                                {pnlVal >= 0 ? "+" : ""}{formatRupees(pnlVal)}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-right text-gray-400 text-[11px]">
                                                            {formatDateTime(cp.exit_time)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="p-8 text-center text-xs text-gray-400">
                                    No closed trades yet. Closed positions will automatically record here.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TAB 4: WALLET & LEDGER */}
                {activeTab === "wallet" && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            {/* Wallet Summary */}
                            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs space-y-4">
                                <h3 className="text-sm font-extrabold text-gray-900">Virtual Wallet Details</h3>
                                <div className="rounded-xl bg-gray-50 p-4 space-y-2">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-400">Virtual Cash Balance:</span>
                                        <span className="font-extrabold tabular-nums text-gray-900">
                                            {wallet ? formatRupees(wallet.balance) : "—"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-400">Margin Deployed:</span>
                                        <span className="font-bold tabular-nums text-gray-700">
                                            {formatRupees(capitalDeployed)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-400">Total Virtual Capital Granted:</span>
                                        <span className="font-bold tabular-nums text-gray-700">
                                            {formatRupees(totalGranted)}
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <button
                                        onClick={buyRefill}
                                        disabled={busy === "refill" || !wallet?.isPro}
                                        className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white shadow-md hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        {busy === "refill" ? "Opening Razorpay…" : "Refill ₹5,00,000 Capital (₹100)"}
                                    </button>
                                    {!wallet?.isPro && (
                                        <p className="text-[10px] text-center text-amber-600">
                                            Pro Membership required to purchase refills.
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Pro Membership Promotion */}
                            <div className="rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-700 to-teal-800 p-5 text-white shadow-lg lg:col-span-2 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-black uppercase text-gray-900">
                                            PRO MEMBERSHIP
                                        </span>
                                        <h3 className="mt-1 text-lg font-black">Trade Real Options With Pro Edge</h3>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-2xl font-black">₹499</div>
                                        <div className="text-[10px] text-emerald-100">/ month</div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-emerald-50">
                                    <div className="flex items-center gap-2">
                                        <span className="text-amber-300">✓</span> Real-time tick streaming execution
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-amber-300">✓</span> Unlimited paper positions & multi-leg baskets
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-amber-300">✓</span> Institutional Greeks & Intraday Payoffs
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-amber-300">✓</span> ₹5L virtual refills for only ₹100
                                    </div>
                                </div>

                                {!wallet?.isPro ? (
                                    <button
                                        onClick={buyPro}
                                        disabled={busy === "pro"}
                                        className="w-full sm:w-auto rounded-xl bg-amber-400 px-6 py-2.5 text-xs font-black text-gray-900 shadow-md hover:bg-amber-300 disabled:opacity-50"
                                    >
                                        {busy === "pro" ? "Opening Razorpay…" : "Upgrade to Pro Now →"}
                                    </button>
                                ) : (
                                    <div className="text-xs font-bold text-amber-300">
                                        ★ Your Pro subscription is active. Enjoy unlimited platform access!
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Recent Activity Ledger Table */}
                        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
                            <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">
                                    Wallet Audit Ledger
                                </h3>
                            </div>
                            {wallet?.ledger?.length ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-100 bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                                                <th className="px-4 py-3">Timestamp</th>
                                                <th className="px-4 py-3">Transaction Type</th>
                                                <th className="px-4 py-3 text-right">Amount</th>
                                                <th className="px-4 py-3 text-right">Balance After</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {wallet.ledger.map((row, i) => {
                                                const amt = Number(row.amount);
                                                return (
                                                    <tr key={i} className="hover:bg-gray-50">
                                                        <td className="px-4 py-3 text-gray-400 text-[11px]">
                                                            {formatDateTime(row.created_at)}
                                                        </td>
                                                        <td className="px-4 py-3 font-semibold text-gray-900">
                                                            {LEDGER_LABELS[row.type] || row.type}
                                                        </td>
                                                        <td className={`px-4 py-3 text-right font-bold tabular-nums ${pnlColor(amt)}`}>
                                                            {amt >= 0 ? "+" : ""}{formatRupees(amt)}
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-700">
                                                            {formatRupees(row.balance_after)}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="p-8 text-center text-xs text-gray-400">No transaction activity recorded yet.</div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Slide-Over / Bottom Sheet Order Placement Drawer */}
            <TradeDrawer
                symbol={symbol}
                draft={tradeDraft}
                lots={tradeLots}
                setLots={setTradeLots}
                lotSize={data?.lotSize}
                spotPrice={data?.spotPrice}
                curveInfo={tradeDrawerCurve}
                wallet={wallet}
                submitting={tradeSubmitting}
                success={tradeSuccess}
                onConfirm={confirmTrade}
                onClose={closeDrawer}
                onViewPositions={() => setActiveTab("positions")}
            />

            {/* Square Off Confirmation Modal */}
            <SquareOffModal
                isOpen={showSquareOffModal}
                onClose={() => setShowSquareOffModal(false)}
                onConfirm={handleConfirmSquareOffAll}
                positionCount={positions.length}
                totalPnl={openUnrealized}
                busy={closingAll}
            />
        </div>
    );
}
