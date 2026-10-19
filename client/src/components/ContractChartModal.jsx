// components/ContractChartModal.jsx
//
// Slide-up chart for one option contract (strike + expiry + CE/PE), opened
// from the chart icon next to an LTP in Option Chain / Strategy Builder /
// Simulator. Rendered with the local TradingView Charting Library
// (client/public/charting_library) so every native tool is available —
// drawing toolbar, 100+ indicators, chart types, timeframes, compare,
// screenshot. Bars come from server/routes/tvDatafeed.js, which builds them
// from the REAL stored ticks/snapshots for the contract (live_option_ticks +
// option_chain_history) — a contract with nothing stored shows the library's
// own "no data" state rather than invented candles.
import { useEffect, useState } from "react";
import { FiMaximize, FiMinimize, FiX, FiPlus, FiMinus } from "react-icons/fi";
import TradingViewChart from "./TradingViewChart";
import { optionTicker } from "../lib/tvDatafeed";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatExpiry(expiry) {
    const [y, m, d] = String(expiry || "").slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return expiry || "";
    return `${d} ${MONTHS[m - 1]} ${y}`;
}

export default function ContractChartModal({ symbol, strike, expiry, right, onClose, onAddLeg = null }) {
    const [open, setOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Slide up on mount, slide down before closing
    useEffect(() => {
        const raf = requestAnimationFrame(() => setOpen(true));
        return () => cancelAnimationFrame(raf);
    }, []);

    function handleClose() {
        setOpen(false);
        setTimeout(onClose, 200);
    }

    // Esc closes — the chart iframe keeps its own keyboard shortcuts while focused.
    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && handleClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const ticker = optionTicker(symbol, expiry, strike, right);
    const isCall = right === "CE";

    const [chartMode, setChartMode] = useState("contract"); // "contract" | "spot"
    const activeSymbol = chartMode === "contract" ? ticker : symbol;

    return (
        <div
            className={`fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-2xs transition-opacity duration-200 ${
                open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
            onClick={handleClose}
        >
            <div
                className={`w-full transition-all duration-300 ease-out rounded-t-2xl sm:rounded-t-3xl bg-surface border-t border-x border-line shadow-2xl flex flex-col overflow-hidden ${
                    isFullscreen ? "h-[96vh]" : "h-[86vh] sm:h-[84vh] max-h-[92vh]"
                } ${open ? "translate-y-0" : "translate-y-full"}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Drag handle */}
                <div className="w-12 h-1 rounded-full bg-line mx-auto mt-2 shrink-0" />

                {/* Header: contract, expiry, mode switch, leg actions, fullscreen, close */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-muted px-3 sm:px-4 py-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {/* Segmented Mode Switcher: Option Contract vs Spot Index */}
                        <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-xs">
                            <button
                                onClick={() => setChartMode("contract")}
                                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                                    chartMode === "contract"
                                        ? isCall
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "bg-rose-600 text-white shadow-xs"
                                        : "text-fg-muted hover:text-fg"
                                }`}
                            >
                                {symbol} {strike} {right}
                            </button>
                            <button
                                onClick={() => setChartMode("spot")}
                                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all cursor-pointer ${
                                    chartMode === "spot"
                                        ? "bg-emerald-600 text-white shadow-xs"
                                        : "text-fg-muted hover:text-fg"
                                }`}
                            >
                                {symbol} Spot
                            </button>
                        </div>

                        {chartMode === "contract" && (
                            <span className="rounded-lg bg-surface-raised px-2 py-0.5 text-label font-semibold text-fg-muted">
                                Exp: {formatExpiry(expiry)}
                            </span>
                        )}
                        <span className="hidden sm:inline text-label text-fg-subtle">
                            TradingView · Real-time ticks &amp; indicators
                        </span>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2">
                        {onAddLeg && chartMode === "contract" && (
                            <div className="mr-1 flex items-center gap-1.5">
                                <button
                                    onClick={() => onAddLeg("buy")}
                                    className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 cursor-pointer"
                                >
                                    <FiPlus size={14} />
                                    <span>Buy Leg</span>
                                </button>
                                <button
                                    onClick={() => onAddLeg("sell")}
                                    className="flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-rose-700 cursor-pointer"
                                >
                                    <FiMinus size={14} />
                                    <span>Sell Leg</span>
                                </button>
                            </div>
                        )}
                        <button
                            onClick={() => setIsFullscreen((f) => !f)}
                            className="rounded-xl border border-line bg-surface p-2 text-fg-muted shadow-xs transition hover:bg-surface-hover hover:text-fg cursor-pointer"
                            title={isFullscreen ? "Dock Chart" : "Expand"}
                        >
                            {isFullscreen ? <FiMinimize size={16} /> : <FiMaximize size={16} />}
                        </button>
                        <button
                            onClick={handleClose}
                            className="rounded-xl border border-line bg-surface p-2 text-fg-muted shadow-xs transition hover:bg-surface-hover hover:text-fg cursor-pointer"
                            title="Close Chart"
                        >
                            <FiX size={18} />
                        </button>
                    </div>
                </div>

                {/* TradingView terminal — full toolset */}
                <div className="min-h-0 flex-1">
                    <TradingViewChart key={activeSymbol} symbol={activeSymbol} interval="5" height="100%" />
                </div>
            </div>
        </div>
    );
}
