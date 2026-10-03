import { useState, useEffect, useRef, useMemo } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import DataNavHeader from "../components/DataNavHeader";
import {
    fetchBitcoinStatus,
    startBitcoinPipeline,
    stopBitcoinPipeline,
    fetchGDriveFiles,
} from "../services/adminApi";
import {
    FiPlay,
    FiSquare,
    FiRefreshCw,
    FiCheckCircle,
    FiAlertCircle,
    FiCloud,
    FiExternalLink,
    FiActivity,
    FiDatabase,
    FiCalendar,
    FiHardDrive,
    FiTerminal,
    FiTrendingUp,
    FiSearch,
    FiPlus,
    FiX,
    FiCheck,
    FiLayers,
    FiShield,
} from "react-icons/fi";

const POPULAR_CRYPTOS = [
    { symbol: "BTCUSDT", name: "Bitcoin", icon: "₿", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
    { symbol: "ETHUSDT", name: "Ethereum", icon: "Ξ", color: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
    { symbol: "SOLUSDT", name: "Solana", icon: "◎", color: "text-purple-400 bg-purple-500/10 border-purple-500/30" },
    { symbol: "BNBUSDT", name: "BNB Chain", icon: "⬡", color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30" },
    { symbol: "XRPUSDT", name: "Ripple", icon: "✕", color: "text-sky-400 bg-sky-500/10 border-sky-500/30" },
    { symbol: "DOGEUSDT", name: "Dogecoin", icon: "Ð", color: "text-amber-300 bg-amber-400/10 border-amber-400/30" },
    { symbol: "ADAUSDT", name: "Cardano", icon: "₳", color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30" },
    { symbol: "AVAXUSDT", name: "Avalanche", icon: "▲", color: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
    { symbol: "LINKUSDT", name: "Chainlink", icon: "⬡", color: "text-blue-300 bg-blue-400/10 border-blue-400/30" },
    { symbol: "SUIUSDT", name: "Sui", icon: "💧", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30" },
    { symbol: "NEARUSDT", name: "NEAR Protocol", icon: "Ⓝ", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
    { symbol: "DOTUSDT", name: "Polkadot", icon: "●", color: "text-pink-400 bg-pink-500/10 border-pink-500/30" },
    { symbol: "MATICUSDT", name: "Polygon", icon: "⬡", color: "text-purple-300 bg-purple-400/10 border-purple-400/30" },
    { symbol: "PEPEUSDT", name: "Pepe", icon: "🐸", color: "text-green-400 bg-green-500/10 border-green-500/30" },
    { symbol: "SHIBUSDT", name: "Shiba Inu", icon: "🐕", color: "text-orange-400 bg-orange-500/10 border-orange-500/30" },
];

const YEARS = [2023, 2024, 2025, 2026];

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function BitcoinDownloader() {
    const { token } = useAdminAuth();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);
    const [driveFiles, setDriveFiles] = useState([]);

    // Multi-crypto selection states
    const [selectedSymbols, setSelectedSymbols] = useState(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    const [selectedYears, setSelectedYears] = useState([2023, 2024, 2025, 2026]);
    const [customSymbolInput, setCustomSymbolInput] = useState("");
    const [symbolFilterSearch, setSymbolFilterSearch] = useState("");
    const [customCoinList, setCustomCoinList] = useState([]);
    const [ledgerFilterSymbol, setLedgerFilterSymbol] = useState("all");

    const logContainerRef = useRef(null);

    const loadStatus = async () => {
        if (!token) return;
        try {
            const res = await fetchBitcoinStatus(token);
            setStatus(res);
            setError(null);
        } catch (err) {
            console.error("Failed to load crypto status:", err);
            if (!err.message?.includes("token")) {
                setError(err.message);
            }
        } finally {
            setLoading(false);
        }
    };

    const loadDriveFiles = async () => {
        if (!token) return;
        try {
            const res = await fetchGDriveFiles(token, { query: "crypto" });
            if (res && res.files) {
                setDriveFiles(res.files);
            }
        } catch (err) {
            console.error("Failed to load GDrive files:", err);
        }
    };

    useEffect(() => {
        if (!token) return;
        loadStatus();
        loadDriveFiles();
        const interval = setInterval(() => {
            loadStatus();
        }, 2500);
        return () => clearInterval(interval);
    }, [token]);

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [status?.logs]);

    // All available coins (presets + user added)
    const allCoins = useMemo(() => {
        const map = new Map();
        POPULAR_CRYPTOS.forEach((c) => map.set(c.symbol, c));
        customCoinList.forEach((c) => {
            if (!map.has(c.symbol)) {
                map.set(c.symbol, c);
            }
        });
        return Array.from(map.values());
    }, [customCoinList]);

    const filteredCoins = useMemo(() => {
        if (!symbolFilterSearch.trim()) return allCoins;
        const q = symbolFilterSearch.toLowerCase().trim();
        return allCoins.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    }, [allCoins, symbolFilterSearch]);

    const handleAddCustomSymbol = () => {
        if (!customSymbolInput.trim()) return;
        let sym = customSymbolInput.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!sym.endsWith("USDT") && !sym.endsWith("FDUSD") && !sym.endsWith("BUSD") && !sym.endsWith("USDC")) {
            sym = `${sym}USDT`;
        }
        if (!customCoinList.some((c) => c.symbol === sym)) {
            setCustomCoinList((prev) => [
                ...prev,
                { symbol: sym, name: sym.replace("USDT", ""), icon: "🪙", color: "text-amber-400 bg-amber-500/10 border-amber-500/30" },
            ]);
        }
        if (!selectedSymbols.includes(sym)) {
            setSelectedSymbols((prev) => [...prev, sym]);
        }
        setCustomSymbolInput("");
    };

    const handleToggleSymbol = (sym) => {
        if (selectedSymbols.includes(sym)) {
            setSelectedSymbols(selectedSymbols.filter((s) => s !== sym));
        } else {
            setSelectedSymbols([...selectedSymbols, sym]);
        }
    };

    const handleToggleYear = (yr) => {
        if (selectedYears.includes(yr)) {
            setSelectedYears(selectedYears.filter((y) => y !== yr));
        } else {
            setSelectedYears([...selectedYears, yr].sort((a, b) => a - b));
        }
    };

    const handleStart = async () => {
        if (selectedSymbols.length === 0) {
            setError("Please select at least 1 crypto currency symbol.");
            return;
        }
        if (selectedYears.length === 0) {
            setError("Please select at least 1 year.");
            return;
        }

        const confirmMsg = `Start 1-Minute historical data extraction for ${selectedSymbols.length} Crypto Symbol(s) (${selectedSymbols.join(", ")}) across Years (${selectedYears.join(", ")}) and push directly to Google Drive?`;
        if (!window.confirm(confirmMsg)) return;

        setActionLoading(true);
        setError(null);
        setSuccessMsg(null);
        try {
            await startBitcoinPipeline(token, {
                symbols: selectedSymbols,
                years: selectedYears,
            });
            setSuccessMsg(`Crypto Pipeline started for ${selectedSymbols.length} coin(s)! Fetching 1m candles & streaming to Google Drive...`);
            await loadStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleStop = async () => {
        setActionLoading(true);
        setError(null);
        try {
            await stopBitcoinPipeline(token);
            setSuccessMsg("Crypto pipeline stopped.");
            await loadStatus();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionLoading(false);
        }
    };

    const isRunning = status?.isRunning;
    const progress = status || {};
    const percent = progress.progressPct || 0;
    const archives = status?.archives || [];

    const filteredArchives = useMemo(() => {
        if (ledgerFilterSymbol === "all") return archives;
        return archives.filter((a) => a.symbol === ledgerFilterSymbol);
    }, [archives, ledgerFilterSymbol]);

    return (
        <div className="min-h-screen bg-[#07070b] text-gray-100 pb-16">
            <DataNavHeader
                title="Crypto Historical Data Downloader & Cloud Archiver"
                subtitle="High-speed Binance 1-Minute BTC, ETH, SOL, and all USDT Crypto candle extraction with direct Google Drive cloud storage (2023–2026)."
            />

            <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
                {/* Alerts */}
                {error && (
                    <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FiAlertCircle className="shrink-0 text-rose-400" size={20} />
                            <span className="text-xs font-semibold">{error}</span>
                        </div>
                        <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200 text-xs">Dismiss</button>
                    </div>
                )}
                {successMsg && (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FiCheckCircle className="shrink-0 text-emerald-400" size={20} />
                            <span className="text-xs font-semibold">{successMsg}</span>
                        </div>
                        <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200 text-xs">Dismiss</button>
                    </div>
                )}

                {/* Hero / Control Card */}
                <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-[#121118] via-[#0d0d14] to-[#151008] p-6 shadow-2xl space-y-6">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 relative z-10">
                        <div className="space-y-1">
                            <div className="flex items-center gap-3">
                                <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-black font-black text-xl shadow-lg shadow-amber-500/20">
                                    ₿
                                </div>
                                <div>
                                    <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                                        Multi-Crypto (BTC, ETH, SOL...) 1-Minute Historical Engine
                                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider uppercase border ${
                                            isRunning
                                                ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
                                                : "bg-gray-800 text-gray-400 border-gray-700"
                                        }`}>
                                            {isRunning ? "Pipeline Running" : "Idle"}
                                        </span>
                                    </h2>
                                    <p className="text-xs text-gray-400">
                                        Extract 3+ Years of 1-minute OHLCV candles (~525,600 min/year per coin) from Binance Public API and compress directly into Google Drive.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-3 shrink-0">
                            {!isRunning ? (
                                <button
                                    onClick={handleStart}
                                    disabled={actionLoading || selectedSymbols.length === 0}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                                >
                                    <FiPlay size={14} className="fill-current" />
                                    <span>Start Extraction ({selectedSymbols.length} Coins)</span>
                                </button>
                            ) : (
                                <button
                                    onClick={handleStop}
                                    disabled={actionLoading}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-rose-600/30 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                                >
                                    <FiSquare size={14} className="fill-current" />
                                    <span>Stop Pipeline</span>
                                </button>
                            )}

                            <button
                                onClick={() => { loadStatus(); loadDriveFiles(); }}
                                className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 transition-colors"
                                title="Refresh Status"
                            >
                                <FiRefreshCw size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Progress Bar (Visible when running or completed) */}
                    {(isRunning || percent > 0) && (
                        <div className="pt-4 border-t border-white/10 space-y-2">
                            <div className="flex flex-wrap items-center justify-between text-xs gap-2">
                                <div className="flex items-center gap-3">
                                    <span className="font-semibold text-gray-300">
                                        Current Batch: <strong className="text-amber-400 font-bold">{progress.currentSymbol || selectedSymbols[0]}</strong> ({progress.currentYear || "Starting"})
                                    </span>
                                    {progress.targetSymbols?.length > 1 && (
                                        <span className="text-gray-500">
                                            ({progress.targetSymbols.indexOf(progress.currentSymbol) + 1} of {progress.targetSymbols.length} coins)
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-4 text-gray-400">
                                    <span>Candles: <strong className="text-white font-mono">{(progress.totalCandles || 0).toLocaleString()}</strong></span>
                                    <span>Files: <strong className="text-emerald-400 font-mono">{progress.uploadedFiles || 0}</strong></span>
                                    <span className="font-mono text-amber-400 font-bold">{percent}%</span>
                                </div>
                            </div>
                            <div className="h-2.5 w-full bg-black/60 rounded-full overflow-hidden border border-white/5">
                                <div
                                    className="h-full bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-400 transition-all duration-500"
                                    style={{ width: `${percent}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Crypto Symbols & Years Selector Panel */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4 border-t border-white/10">
                        {/* Target Cryptos Selection (2 Cols) */}
                        <div className="lg:col-span-2 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <label className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                                        Target Crypto Currencies
                                    </label>
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-black">
                                        {selectedSymbols.length} Selected
                                    </span>
                                </div>

                                <div className="flex items-center gap-1.5 text-[10px]">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedSymbols(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"])}
                                        className="px-2 py-1 rounded bg-white/5 text-amber-300 hover:bg-amber-500/20 font-bold transition"
                                    >
                                        Top 5
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedSymbols(POPULAR_CRYPTOS.slice(0, 10).map((c) => c.symbol))}
                                        className="px-2 py-1 rounded bg-white/5 text-amber-300 hover:bg-amber-500/20 font-bold transition"
                                    >
                                        Top 10
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedSymbols(allCoins.map((c) => c.symbol))}
                                        className="px-2 py-1 rounded bg-white/5 text-gray-300 hover:bg-white/10 font-bold transition"
                                    >
                                        All ({allCoins.length})
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedSymbols([])}
                                        className="px-2 py-1 rounded bg-white/5 text-gray-400 hover:text-red-400 font-bold transition"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>

                            {/* Search & Custom Input Bar */}
                            <div className="flex flex-col sm:flex-row items-center gap-2">
                                <div className="relative flex-1 w-full">
                                    <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" size={12} />
                                    <input
                                        type="text"
                                        placeholder="Filter coins (BTC, ETH, SOL, DOGE, PEPE...)"
                                        value={symbolFilterSearch}
                                        onChange={(e) => setSymbolFilterSearch(e.target.value)}
                                        className="w-full pl-7 pr-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-xs text-white placeholder-gray-500 focus:border-amber-500 focus:outline-none"
                                    />
                                </div>

                                <div className="flex items-center gap-1.5 w-full sm:w-auto">
                                    <input
                                        type="text"
                                        placeholder="Add Coin (e.g. RENDER, INJ)"
                                        value={customSymbolInput}
                                        onChange={(e) => setCustomSymbolInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && handleAddCustomSymbol()}
                                        className="px-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-xs text-amber-300 placeholder-gray-500 focus:border-amber-500 focus:outline-none w-full sm:w-44 uppercase font-mono font-bold"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddCustomSymbol}
                                        className="p-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold transition shrink-0"
                                        title="Add Custom Pair"
                                    >
                                        <FiPlus size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Coin Chips Grid */}
                            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2.5 rounded-xl bg-black/40 border border-white/10 custom-scrollbar">
                                {filteredCoins.map((coin) => {
                                    const isSelected = selectedSymbols.includes(coin.symbol);
                                    return (
                                        <button
                                            key={coin.symbol}
                                            type="button"
                                            onClick={() => handleToggleSymbol(coin.symbol)}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                                                isSelected
                                                    ? "bg-amber-500/20 border-amber-500/50 text-white shadow-sm shadow-amber-500/10"
                                                    : "bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                                            }`}
                                        >
                                            <span className={`w-5 h-5 rounded-lg flex items-center justify-center text-xs font-black ${
                                                isSelected ? "bg-amber-500 text-black" : "bg-white/10 text-gray-300"
                                            }`}>
                                                {coin.icon || "₿"}
                                            </span>
                                            <span>{coin.symbol}</span>
                                            {isSelected && <FiCheck size={12} className="text-amber-400" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Target Years Selection (1 Col) */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-gray-200 uppercase tracking-wider">
                                    Target Years
                                </label>
                                <span className="text-[11px] text-gray-400">
                                    {selectedYears.length} Selected
                                </span>
                            </div>

                            <div className="space-y-2">
                                {YEARS.map((yr) => {
                                    const isSelected = selectedYears.includes(yr);
                                    return (
                                        <button
                                            key={yr}
                                            type="button"
                                            onClick={() => handleToggleYear(yr)}
                                            className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-bold border transition ${
                                                isSelected
                                                    ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                                                    : "bg-white/5 border-white/5 text-gray-400 hover:bg-white/10"
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <FiCalendar size={13} className={isSelected ? "text-amber-400" : "text-gray-500"} />
                                                <span>Year {yr}</span>
                                                {yr === 2026 && (
                                                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                                        YTD Live
                                                    </span>
                                                )}
                                            </div>
                                            <div className={`w-4 h-4 rounded flex items-center justify-center border ${
                                                isSelected ? "bg-amber-500 border-amber-500 text-black" : "border-gray-600 bg-transparent"
                                            }`}>
                                                {isSelected && <FiCheck size={10} />}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-[11px] text-gray-400 space-y-1">
                                <div className="flex items-center justify-between">
                                    <span>Cloud Destination:</span>
                                    <strong className="text-emerald-400 font-mono">Google Drive</strong>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Folder Hierarchy:</span>
                                    <span className="text-gray-300 font-mono">/Crypto/{`{coin}`}/{`{year}`}/</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Logs Terminal & Google Drive Multi-Crypto Archival Ledger */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Live Terminal Logs */}
                    <div className="rounded-2xl border border-white/10 bg-[#0a0a0f] p-4 flex flex-col h-[450px]">
                        <div className="flex items-center justify-between pb-3 border-b border-white/10">
                            <div className="flex items-center gap-2">
                                <FiTerminal className="text-amber-400" size={16} />
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Live Pipeline Terminal</h3>
                            </div>
                            <span className="text-[10px] text-gray-500 font-mono">Binance API & GDrive Stream</span>
                        </div>
                        <div
                            ref={logContainerRef}
                            className="flex-1 overflow-y-auto font-mono text-[11px] text-gray-300 p-3 space-y-1 bg-black/40 rounded-xl mt-3 border border-white/5 select-text custom-scrollbar"
                        >
                            {status?.logs && status.logs.length > 0 ? (
                                status.logs.map((log, idx) => (
                                    <div key={idx} className="leading-relaxed">
                                        <span className="text-gray-300">
                                            {log}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="text-gray-600 italic text-center py-20">
                                    No active pipeline logs. Select coins and click "Start Extraction" to begin streaming.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Google Drive Multi-Crypto Archives Ledger */}
                    <div className="rounded-2xl border border-white/10 bg-[#0a0a0f] p-4 flex flex-col h-[450px]">
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
                            <div className="flex items-center gap-2">
                                <FiCloud className="text-emerald-400" size={16} />
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                                    Google Drive Crypto Archives ({archives.length})
                                </h3>
                            </div>

                            {/* Filter by symbol */}
                            <div className="flex items-center gap-1.5 text-xs">
                                <select
                                    value={ledgerFilterSymbol}
                                    onChange={(e) => setLedgerFilterSymbol(e.target.value)}
                                    className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs font-semibold focus:outline-none"
                                >
                                    <option value="all" className="bg-[#0d0d14]">All Coins ({archives.length})</option>
                                    {Array.from(new Set(archives.map((a) => a.symbol))).map((s) => (
                                        <option key={s} value={s} className="bg-[#0d0d14]">{s}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto mt-3 space-y-2 custom-scrollbar">
                            {filteredArchives.length > 0 ? (
                                filteredArchives.map((file, idx) => (
                                    <div
                                        key={`${file.symbol}_${file.year}_${idx}`}
                                        className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 flex items-center justify-between gap-3 text-xs"
                                    >
                                        <div className="min-w-0">
                                            <div className="font-mono font-semibold text-white truncate flex items-center gap-2">
                                                <span className="text-amber-400 font-bold">🪙</span>
                                                <span className="text-amber-300 font-black">{file.symbol}</span>
                                                <span className="text-gray-400">({file.year})</span>
                                            </div>
                                            <div className="text-[10px] text-gray-500 mt-0.5">
                                                {formatBytes(file.file_size_bytes)} • {Number(file.record_count || 0).toLocaleString()} 1m candles • {file.uploaded_at ? new Date(file.uploaded_at).toLocaleDateString() : "Uploaded"}
                                            </div>
                                        </div>
                                        {file.gdrive_web_link ? (
                                            <a
                                                href={file.gdrive_web_link}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold transition-colors"
                                            >
                                                Open Drive <FiExternalLink size={12} />
                                            </a>
                                        ) : (
                                            <span className="text-[10px] text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-500/10">
                                                Archived
                                            </span>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-20 text-gray-500 text-xs">
                                    <FiCloud className="mx-auto mb-2 text-gray-600" size={32} />
                                    No Crypto files archived yet in Google Drive. Start a pipeline above.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
