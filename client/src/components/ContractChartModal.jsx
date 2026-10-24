// components/ContractChartModal.jsx
//
// Full-width chart modal for an option contract (strike + expiry + CE/PE) or spot,
// opened from the chart icon next to an LTP in Option Chain / Strategy Builder /
// Simulator. Rendered with the local TradingView Charting Library
// (client/public/charting_library) with all native drawing tools, 100+ indicators,
// multi-timeframe resolution, and real-time bars.
import { useEffect, useState } from "react";
import { FiMaximize, FiMinimize, FiX, FiPlus, FiMinus } from "react-icons/fi";
import TradingViewChart from "./TradingViewChart";
import { optionTicker } from "../lib/tvDatafeed";
import { useTheme } from "../context/ThemeContext";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatExpiry(expiry) {
    const [y, m, d] = String(expiry || "").slice(0, 10).split("-").map(Number);
    if (!y || !m || !d) return expiry || "";
    return `${d} ${MONTHS[m - 1]} ${y}`;
}

export default function ContractChartModal({ symbol, strike, expiry, right, onClose, onAddLeg = null }) {
    const { isDark } = useTheme();
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
            className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm transition-opacity duration-200 ${
                open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            }`}
            onClick={handleClose}
        >
            <div
                className={`w-screen max-w-none transition-all duration-300 ease-out flex flex-col overflow-hidden bg-white dark:bg-[#070e17] border-t border-gray-200 dark:border-white/10 shadow-2xl ${
                    isFullscreen
                        ? "fixed inset-0 h-screen w-screen rounded-none z-50"
                        : "h-[90vh] sm:h-[92vh] w-full rounded-t-2xl sm:rounded-t-3xl"
                } ${open ? "translate-y-0" : "translate-y-full"}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Drag handle on mobile */}
                <div className="w-12 h-1 rounded-full bg-gray-300 dark:bg-white/20 mx-auto mt-2 shrink-0 sm:hidden" />

                {/* Header: contract, expiry, mode switch, leg actions, fullscreen, close */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-white/10 bg-gray-50/90 dark:bg-[#0b1420]/90 px-3 sm:px-5 py-2.5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                        {/* Segmented Mode Switcher: Option Contract vs Spot Index */}
                        <div className="flex items-center rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] p-0.5 shadow-xs">
                            <button
                                onClick={() => setChartMode("contract")}
                                className={`rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                                    chartMode === "contract"
                                        ? isCall
                                            ? "bg-emerald-600 text-white shadow-xs"
                                            : "bg-rose-600 text-white shadow-xs"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                }`}
                            >
                                {symbol} {strike} {right}
                            </button>
                            <button
                                onClick={() => setChartMode("spot")}
                                className={`rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                                    chartMode === "spot"
                                        ? "bg-blue-600 text-white shadow-xs"
                                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                                }`}
                            >
                                {symbol} Spot
                            </button>
                        </div>

                        {chartMode === "contract" && (
                            <span className="rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#121c2b] px-2.5 py-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300 shadow-2xs">
                                Exp: {formatExpiry(expiry)}
                            </span>
                        )}
                        <span className="hidden sm:inline text-[11.5px] font-medium text-gray-500 dark:text-gray-400">
                            TradingView · Real-time ticks &amp; 100+ indicators
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
                            className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] p-2 text-gray-600 dark:text-gray-300 shadow-xs transition hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white cursor-pointer"
                            title={isFullscreen ? "Dock Chart" : "Expand Fullscreen"}
                        >
                            {isFullscreen ? <FiMinimize size={16} /> : <FiMaximize size={16} />}
                        </button>
                        <button
                            onClick={handleClose}
                            className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#070e17] p-2 text-gray-600 dark:text-gray-300 shadow-xs transition hover:bg-gray-100 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white cursor-pointer"
                            title="Close Chart"
                        >
                            <FiX size={18} />
                        </button>
                    </div>
                </div>

                {/* TradingView terminal — full screen width */}
                <div className="min-h-0 flex-1 w-full bg-white dark:bg-[#0b1420]">
                    <TradingViewChart key={`${activeSymbol}_${isDark ? "dark" : "light"}`} symbol={activeSymbol} interval="5" height="100%" />
                </div>
            </div>
        </div>
    );
}
