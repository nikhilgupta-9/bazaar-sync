import React, { useState, useEffect } from "react";
// pages/HistoricalChart.jsx — Fullscreen TradingView Workstation
// Edge-to-edge chart terminal matching stockmojo.in's Historical Chart page: a single slim
// market/symbol bar above the native TradingView charting library, which already supplies
// symbol search, resolution, chart style, indicators (fx), undo/redo, and fullscreen — so we
// don't duplicate any of that in custom chrome, same as the reference site.
import { Link, useSearchParams } from "react-router-dom";
import { fetchSymbolList } from "../services/optionChainApi";
import TradingViewChart from "../components/TradingViewChart";
import { FiHelpCircle, FiMaximize2, FiMinimize2, FiExternalLink, FiX, FiLayers, FiTrendingUp } from "react-icons/fi";

const CORE_INDIAN_CHIPS = [
    { label: "NIFTY", symbol: "NIFTY" },
    { label: "SENSEX", symbol: "SENSEX" },
    { label: "MIDCAP", symbol: "MIDCPNIFTY" },
];
const DEFAULT_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "BANKEX"];

const CRYPTO_COINS = [
    { symbol: "BTC", name: "Bitcoin", icon: "₿", color: "text-amber-500 dark:text-amber-400" },
    { symbol: "ETH", name: "Ethereum", icon: "Ξ", color: "text-blue-500 dark:text-blue-400" },
    { symbol: "SOL", name: "Solana", icon: "◎", color: "text-purple-500 dark:text-purple-400" },
];

export default function HistoricalChart() {
    const [searchParams] = useSearchParams();
    const initialMarket = searchParams.get("market") === "crypto" ? "crypto" : "indian";
    const initialSymbol = searchParams.get("symbol") || (initialMarket === "crypto" ? "BTC" : "NIFTY");

    const [marketType, setMarketType] = useState(initialMarket);
    const [symbolList, setSymbolList] = useState({ indices: DEFAULT_INDICES, stocks: [] });
    const [symbol, setSymbol] = useState(initialSymbol);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showShortcutsModal, setShowShortcutsModal] = useState(false);

    useEffect(() => {
        fetchSymbolList()
            .then((res) => {
                setSymbolList({
                    indices: res.indices?.length ? res.indices : DEFAULT_INDICES,
                    stocks: res.stocks || [],
                });
            })
            .catch(() => {});
    }, []);

    const handleMarketTypeChange = (type) => {
        setMarketType(type);
        setSymbol(type === "crypto" ? "BTC" : "NIFTY");
    };

    const isCrypto = marketType === "crypto";
    const chartHeight = isFullscreen ? "calc(100vh - 44px)" : "calc(100vh - 128px)";

    return (
        <div
            className={`flex w-full flex-col bg-surface text-fg transition-colors ${
                isFullscreen ? "fixed inset-0 z-50 h-screen w-screen overflow-hidden" : "h-full min-h-[calc(100vh-84px)] flex-1"
            }`}
        >
            {/* SLIM MARKET / SYMBOL BAR — everything else (search, resolution, style, indicators,
                undo/redo, fullscreen) is the native TradingView toolbar rendered inside the chart. */}
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-surface px-3 text-xs">
                <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
                    {/* Market Switcher */}
                    <div className="flex shrink-0 rounded-lg border border-line bg-surface-raised p-0.5">
                        <button
                            onClick={() => handleMarketTypeChange("indian")}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                                marketType === "indian"
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                            title="Indian Markets (NSE / BSE Indices & Equities)"
                        >
                            <span>🇮🇳</span>
                            <span className="hidden sm:inline">Indian Market</span>
                        </button>
                        <button
                            onClick={() => handleMarketTypeChange("crypto")}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-bold transition-all ${
                                marketType === "crypto"
                                    ? "bg-purple-600 text-white shadow-xs"
                                    : "text-fg-muted hover:text-fg"
                            }`}
                            title="Cryptocurrency (BTC, ETH, SOL)"
                        >
                            <span>⚡</span>
                            <span className="hidden sm:inline">Crypto</span>
                        </button>
                    </div>

                    <span className="text-line">|</span>

                    {/* Quick Symbol Chips */}
                    {isCrypto ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                            {CRYPTO_COINS.map((c) => (
                                <button
                                    key={c.symbol}
                                    onClick={() => setSymbol(c.symbol)}
                                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold transition-all ${
                                        symbol === c.symbol
                                            ? "border-purple-600 bg-purple-600 text-white shadow-xs"
                                            : "border-line bg-surface text-fg-muted hover:border-fg-subtle hover:text-fg"
                                    }`}
                                >
                                    <span className={symbol === c.symbol ? "text-white" : c.color}>{c.icon}</span>
                                    <span>{c.name}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex shrink-0 items-center gap-1.5">
                            {CORE_INDIAN_CHIPS.map((chip) => {
                                const isActive =
                                    symbol === chip.symbol ||
                                    (chip.symbol === "MIDCPNIFTY" && (symbol === "MIDCAP" || symbol === "MIDCPNIFTY"));
                                return (
                                    <button
                                        key={chip.symbol}
                                        onClick={() => setSymbol(chip.symbol)}
                                        className={`rounded-md border px-2.5 py-1 text-xs font-bold transition-all ${
                                            isActive
                                                ? "border-emerald-600 bg-emerald-600 text-white shadow-xs"
                                                : "border-line bg-surface text-fg-muted hover:border-fg-subtle hover:text-fg"
                                        }`}
                                    >
                                        {chip.label}
                                    </button>
                                );
                            })}
                            <select
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value)}
                                className="shrink-0 cursor-pointer rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-bold text-fg shadow-xs outline-none focus:border-emerald-500"
                            >
                                <optgroup label="Other Indices">
                                    {symbolList.indices
                                        .filter((s) => !["NIFTY", "SENSEX", "MIDCPNIFTY"].includes(s))
                                        .map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                </optgroup>
                                {symbolList.stocks.length > 0 && (
                                    <optgroup label="F&O Stocks">
                                        {symbolList.stocks.map((s) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </optgroup>
                                )}
                                <optgroup label="Core Indices">
                                    <option value="NIFTY">NIFTY</option>
                                    <option value="SENSEX">SENSEX</option>
                                    <option value="MIDCPNIFTY">MIDCAP (MIDCPNIFTY)</option>
                                </optgroup>
                            </select>
                        </div>
                    )}
                </div>

                {/* Right: Quick Navigation, Shortcuts & Fullscreen */}
                <div className="flex shrink-0 items-center gap-1.5 pl-2">
                    {isCrypto ? (
                        <Link
                            to="/strategy-builder/crypto"
                            className="hidden items-center gap-1 rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs font-semibold text-purple-700 hover:border-purple-500 sm:flex dark:text-purple-300"
                        >
                            <span>Builder</span>
                            <FiExternalLink className="h-3 w-3" />
                        </Link>
                    ) : (
                        <>
                            <Link
                                to={`/option-chain/${symbol.toLowerCase()}`}
                                className="hidden items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-fg-muted hover:border-emerald-500 hover:text-emerald-600 md:flex"
                            >
                                <span>Chain</span>
                                <FiExternalLink className="h-3 w-3" />
                            </Link>
                            <Link
                                to="/strategy-builder"
                                className="hidden items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-fg-muted hover:border-emerald-500 hover:text-emerald-600 sm:flex"
                            >
                                <span>Builder</span>
                                <FiExternalLink className="h-3 w-3" />
                            </Link>
                        </>
                    )}

                    <button
                        onClick={() => setShowShortcutsModal(true)}
                        className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs font-semibold text-fg-muted shadow-2xs hover:bg-surface-hover"
                        title="Drawing Tools & Keyboard Shortcuts"
                    >
                        <FiHelpCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="hidden xl:inline">Hotkeys</span>
                    </button>

                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-bold shadow-2xs transition-all ${
                            isFullscreen
                                ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700"
                                : "border-line bg-surface text-fg-muted hover:bg-surface-hover"
                        }`}
                        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                    >
                        {isFullscreen ? (
                            <>
                                <FiMinimize2 className="h-3.5 w-3.5" />
                                <span>Exit</span>
                            </>
                        ) : (
                            <>
                                <FiMaximize2 className="h-3.5 w-3.5" />
                                <span className="hidden sm:inline">Fullscreen</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* CHART WORKSTATION BODY — the native TradingView toolbar lives inside this */}
            <div className="relative w-full flex-1 overflow-hidden bg-surface" style={{ height: chartHeight, minHeight: "560px" }}>
                <TradingViewChart
                    symbol={symbol}
                    interval="D"
                    studies={["STD;EMA", "STD;RSI", "STD;MACD", "STD;Bollinger_Bands", "STD;Volume"]}
                    height={chartHeight}
                    className="h-full w-full"
                />
            </div>

            {/* SHORTCUTS & TRICKS MODAL */}
            {showShortcutsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
                    <div className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-5 shadow-2xl sm:p-6">
                        <div className="flex items-center justify-between border-b border-line pb-3">
                            <div className="flex items-center gap-2">
                                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-sm font-bold text-white">
                                    ⚡
                                </span>
                                <div>
                                    <h2 className="text-base font-extrabold text-fg">
                                        TradingView Hotkeys & Drawing Shortcuts
                                    </h2>
                                    <p className="text-xs text-fg-muted">Quick shortcuts to speed up your technical chart analysis</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowShortcutsModal(false)}
                                className="rounded-lg p-1.5 text-fg-subtle hover:bg-surface-hover"
                            >
                                <FiX className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="mt-4 grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
                            <div className="rounded-xl border border-line bg-surface-muted p-3.5">
                                <h4 className="mb-2 flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                                    <FiLayers className="h-4 w-4" /> Pro Drawing Tools & Hotkeys
                                </h4>
                                <ul className="space-y-1.5 text-fg-muted">
                                    <li className="flex justify-between">
                                        <span>Trendline:</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Alt + T</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Horizontal Level:</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Alt + H</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Fibonacci Retracement:</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Alt + F</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Demand/Supply Zone:</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Alt + R</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Long Risk:Reward (R:R):</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Alt + L</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Short Risk:Reward (R:R):</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Alt + S</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Price Range (Ruler):</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Alt + M</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Undo / Redo:</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Ctrl + Z / Y</kbd>
                                    </li>
                                </ul>
                            </div>

                            <div className="rounded-xl border border-line bg-surface-muted p-3.5">
                                <h4 className="mb-2 flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                                    <FiTrendingUp className="h-4 w-4" /> Chart Navigation & Tools
                                </h4>
                                <ul className="space-y-1.5 text-fg-muted">
                                    <li className="flex justify-between">
                                        <span>Drawing Toolbar:</span> <span className="font-medium text-emerald-600 dark:text-emerald-400">Left Sidebar</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Technical Indicators:</span> <span className="font-medium text-emerald-600 dark:text-emerald-400">Top fx Button</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Take Screenshot:</span> <span className="font-medium">Camera Icon (PNG)</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Fullscreen Mode:</span> <span className="font-medium">Top Bar Button</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Cancel Tool / Deselect:</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
                                    </li>
                                    <li className="flex justify-between">
                                        <span>Delete Selected:</span> <kbd className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[10px]">Delete</kbd>
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div className="mt-5 flex justify-end">
                            <button
                                onClick={() => setShowShortcutsModal(false)}
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
