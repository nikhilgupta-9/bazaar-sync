// pages/SampleDataImporter.jsx — 1-Click Sample Test Data Generator & Importer
// Allows Admin to seed authentic realistic market data into local database with 1 click:
// - Option Chains (NIFTY, BANKNIFTY, FINNIFTY with Greeks, OI, IV, multi-expiries)
// - India VIX (INDIAVIX volatility index OHLCV candles)
// - Index Futures (NIFTY, BANKNIFTY with basis and volume)
// - Crypto Derivatives (BTCUSD, ETHUSD, SOLUSD option chains & 24/7 simulator data)
// Ensures clients can test all application features offline or outside market hours without external API limits.

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAdminAuth } from "../context/AdminAuthContext";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";
import {
    fetchSampleDataStats,
    importSampleData,
    clearSampleData,
} from "../services/adminApi";
import {
    FiZap,
    FiDatabase,
    FiRefreshCw,
    FiCheckCircle,
    FiAlertCircle,
    FiLayers,
    FiActivity,
    FiTrendingUp,
    FiShield,
    FiTrash2,
    FiExternalLink,
    FiCheck,
    FiPlay,
    FiClock,
    FiCpu,
} from "react-icons/fi";

export default function SampleDataImporter() {
    const { token } = useAdminAuth();

    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null); // 'all' | 'options' | 'vix' | 'futures' | 'crypto' | 'clear'
    const [resultMessage, setResultMessage] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);

    // Fetch Database Stats
    const loadStats = useCallback(async () => {
        if (!token) return;
        try {
            setLoading(true);
            const data = await fetchSampleDataStats(token);
            setStats(data);
            setErrorMessage(null);
        } catch (err) {
            console.error("Failed to fetch sample data stats:", err);
            setErrorMessage(err.message || "Failed to query database counts");
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadStats();
    }, [loadStats]);

    // Handle 1-Click Import
    const handleImport = async (category = "all") => {
        if (!token) return;
        try {
            setActionLoading(category);
            setResultMessage(null);
            setErrorMessage(null);

            const res = await importSampleData(token, category);
            setResultMessage({
                type: "success",
                category,
                data: res.results,
                message: res.message || "Sample test data imported successfully!",
            });
            await loadStats();
        } catch (err) {
            console.error("Import error:", err);
            setErrorMessage(err.message || "Failed to import sample test data");
        } finally {
            setActionLoading(null);
        }
    };

    // Handle Reset / Clear
    const handleClear = async (category = "all") => {
        if (!token) return;
        if (!window.confirm(`Are you sure you want to clear sample test data for ${category.toUpperCase()}?`)) {
            return;
        }

        try {
            setActionLoading("clear");
            setResultMessage(null);
            setErrorMessage(null);

            const res = await clearSampleData(token, category);
            setResultMessage({
                type: "warning",
                category,
                data: res.results,
                message: "Sample test data purged. Database refreshed.",
            });
            await loadStats();
        } catch (err) {
            console.error("Clear error:", err);
            setErrorMessage(err.message || "Failed to clear sample data");
        } finally {
            setActionLoading(null);
        }
    };

    return (
        <div className="space-y-6 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto text-gray-200">
            {/* Unified Data Section Header */}
            <DataNavHeader />

            {/* Page Title & Hero Ribbon */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
                <div>
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-amber-500 text-black shadow-lg shadow-emerald-500/20">
                            <FiZap size={22} className="stroke-[2.5]" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-xl font-extrabold text-white tracking-tight">
                                    1-Click Sample Test Data Generator
                                </h1>
                                <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-[10px] font-black uppercase text-emerald-300">
                                    Local Demo Mode
                                </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Seed comprehensive realistic historical &amp; derivatives market data into local database for client presentations.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                        type="button"
                        onClick={loadStats}
                        disabled={loading || Boolean(actionLoading)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3.5 py-2 text-xs font-bold text-gray-300 transition cursor-pointer disabled:opacity-50"
                        title="Refresh database counts"
                    >
                        <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} />
                        <span>Refresh Counts</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleClear("all")}
                        disabled={Boolean(actionLoading)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 px-3.5 py-2 text-xs font-bold text-rose-400 transition cursor-pointer disabled:opacity-50"
                        title="Purge seeded test records"
                    >
                        <FiTrash2 size={13} />
                        <span>Clear Sample Data</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleImport("all")}
                        disabled={Boolean(actionLoading)}
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 hover:from-emerald-500 hover:to-teal-400 px-5 py-2 text-xs font-black text-white shadow-lg shadow-emerald-950/60 transition cursor-pointer disabled:opacity-50"
                    >
                        {actionLoading === "all" ? (
                            <>
                                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                <span>Generating &amp; Seeding Data…</span>
                            </>
                        ) : (
                            <>
                                <FiZap size={14} />
                                <span>Import All Sample Data (1-Click)</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Notification & Result Banners */}
            {resultMessage && (
                <div
                    className={`rounded-2xl border p-4 text-xs flex items-start justify-between gap-3 animate-in fade-in duration-150 ${
                        resultMessage.type === "success"
                            ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-300"
                            : "border-amber-500/30 bg-amber-950/20 text-amber-300"
                    }`}
                >
                    <div className="flex items-start gap-2.5">
                        <FiCheckCircle size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                        <div>
                            <strong className="font-bold block text-white text-sm">
                                {resultMessage.message}
                            </strong>
                            {resultMessage.data && (
                                <div className="mt-1 flex items-center gap-4 text-xs font-mono text-gray-300">
                                    {resultMessage.data.optionRows != null && (
                                        <span>Options: +{resultMessage.data.optionRows} rows</span>
                                    )}
                                    {resultMessage.data.vixRows != null && (
                                        <span>India VIX: +{resultMessage.data.vixRows} ticks</span>
                                    )}
                                    {resultMessage.data.futuresRows != null && (
                                        <span>Futures: +{resultMessage.data.futuresRows} rows</span>
                                    )}
                                    {resultMessage.data.cryptoRows != null && (
                                        <span>Crypto: +{resultMessage.data.cryptoRows} rows</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setResultMessage(null)}
                        className="text-gray-400 hover:text-white"
                    >
                        ✕
                    </button>
                </div>
            )}

            {errorMessage && (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-4 text-xs text-rose-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <FiAlertCircle size={16} className="text-rose-400 shrink-0" />
                        <span>{errorMessage}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setErrorMessage(null)}
                        className="text-gray-400 hover:text-white"
                    >
                        ✕
                    </button>
                </div>
            )}

            {/* 4 Category Status & Import Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CARD 1: OPTIONS DATA */}
                <div className="rounded-2xl border border-white/10 bg-[#0f1422] p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-emerald-500/30 transition">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                                <FiLayers size={18} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                Options Chain
                            </span>
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-white">Indian Options</h3>
                            <p className="text-[11px] text-gray-400 leading-relaxed">
                                NIFTY, BANKNIFTY &amp; FINNIFTY with strikes, CE/PE LTP, OI, IV &amp; complete Greeks.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-white/5">
                        <div className="flex items-baseline justify-between text-xs">
                            <span className="text-gray-400">Database Rows:</span>
                            <span className="font-mono font-bold text-white text-sm">
                                {loading ? "…" : stats?.optionChains?.totalRows?.toLocaleString("en-IN") || "0"}
                            </span>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleImport("options")}
                            disabled={Boolean(actionLoading)}
                            className="w-full py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white border border-emerald-500/30 font-bold text-xs transition cursor-pointer disabled:opacity-50"
                        >
                            {actionLoading === "options" ? "Importing…" : "Import Options Data"}
                        </button>
                    </div>
                </div>

                {/* CARD 2: INDIA VIX */}
                <div className="rounded-2xl border border-white/10 bg-[#0f1422] p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-indigo-500/30 transition">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                                <FiActivity size={18} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                                Volatility Index
                            </span>
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-white">India VIX Data</h3>
                            <p className="text-[11px] text-gray-400 leading-relaxed">
                                Intraday 15-minute and benchmark daily OHLCV candles (12.80 – 24.50 spike).
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-white/5">
                        <div className="flex items-baseline justify-between text-xs">
                            <span className="text-gray-400">VIX Candles:</span>
                            <span className="font-mono font-bold text-white text-sm">
                                {loading ? "…" : stats?.indiaVix?.totalRows?.toLocaleString("en-IN") || "0"}
                            </span>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleImport("vix")}
                            disabled={Boolean(actionLoading)}
                            className="w-full py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white border border-indigo-500/30 font-bold text-xs transition cursor-pointer disabled:opacity-50"
                        >
                            {actionLoading === "vix" ? "Importing…" : "Import India VIX"}
                        </button>
                    </div>
                </div>

                {/* CARD 3: FUTURES DATA */}
                <div className="rounded-2xl border border-white/10 bg-[#0f1422] p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-purple-500/30 transition">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="w-9 h-9 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400">
                                <FiTrendingUp size={18} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                                Index Futures
                            </span>
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-white">Futures History</h3>
                            <p className="text-[11px] text-gray-400 leading-relaxed">
                                NIFTY &amp; BANKNIFTY contracts with spot basis, open interest &amp; intraday volume.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-white/5">
                        <div className="flex items-baseline justify-between text-xs">
                            <span className="text-gray-400">Futures Records:</span>
                            <span className="font-mono font-bold text-white text-sm">
                                {loading ? "…" : stats?.futures?.totalRows?.toLocaleString("en-IN") || "0"}
                            </span>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleImport("futures")}
                            disabled={Boolean(actionLoading)}
                            className="w-full py-2 rounded-xl bg-purple-600/20 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/30 font-bold text-xs transition cursor-pointer disabled:opacity-50"
                        >
                            {actionLoading === "futures" ? "Importing…" : "Import Futures Data"}
                        </button>
                    </div>
                </div>

                {/* CARD 4: CRYPTO DERIVATIVES */}
                <div className="rounded-2xl border border-white/10 bg-[#0f1422] p-5 flex flex-col justify-between space-y-4 shadow-sm hover:border-amber-500/30 transition">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                                <span className="font-black text-base">₿</span>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                                Crypto 2024–2026
                            </span>
                        </div>
                        <div>
                            <h3 className="font-bold text-sm text-white">Crypto Derivatives</h3>
                            <p className="text-[11px] text-gray-400 leading-relaxed">
                                Strictly BTC, ETH &amp; SOL backtesting strikes, 24/7 ticks &amp; perpetual futures.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3 pt-2 border-t border-white/5">
                        <div className="flex items-baseline justify-between text-xs">
                            <span className="text-gray-400">Crypto Records:</span>
                            <span className="font-mono font-bold text-white text-sm">
                                {loading
                                    ? "…"
                                    : (
                                          (stats?.optionChains?.bySymbol?.find((s) => s.symbol === "BTCUSD")?.count || 0) +
                                          (stats?.optionChains?.bySymbol?.find((s) => s.symbol === "ETHUSD")?.count || 0) +
                                          (stats?.optionChains?.bySymbol?.find((s) => s.symbol === "SOLUSD")?.count || 0)
                                      ).toLocaleString("en-IN")}
                            </span>
                        </div>

                        <button
                            type="button"
                            onClick={() => handleImport("crypto")}
                            disabled={Boolean(actionLoading)}
                            className="w-full py-2 rounded-xl bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/30 font-bold text-xs transition cursor-pointer disabled:opacity-50"
                        >
                            {actionLoading === "crypto" ? "Importing…" : "Import Crypto Data"}
                        </button>
                    </div>
                </div>
            </div>

            {/* Quick Testing Links Card */}
            <div className="rounded-2xl border border-white/10 bg-[#0d121f] p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-bold text-white flex items-center gap-2">
                            <span>Client Demonstration &amp; Feature Testing Links</span>
                        </h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Once sample data is imported, click below to test every application module locally in real-time.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <a
                        href="http://localhost:5175/simulator/crypto"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-amber-500/30 bg-amber-950/10 hover:bg-amber-950/20 transition group"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="text-lg text-amber-400 font-bold">₿</span>
                            <div>
                                <div className="font-bold text-xs text-white group-hover:text-amber-300 transition">
                                    Crypto Options Simulator
                                </div>
                                <div className="text-[10px] text-gray-400">/simulator/crypto (BTC, ETH, SOL)</div>
                            </div>
                        </div>
                        <FiExternalLink size={14} className="text-gray-400 group-hover:text-white transition" />
                    </a>

                    <a
                        href="http://localhost:5175/strategy-builder/crypto"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-purple-500/30 bg-purple-950/10 hover:bg-purple-950/20 transition group"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="text-lg text-purple-400 font-bold">Δ</span>
                            <div>
                                <div className="font-bold text-xs text-white group-hover:text-purple-300 transition">
                                    Crypto Strategy Builder
                                </div>
                                <div className="text-[10px] text-gray-400">/strategy-builder/crypto</div>
                            </div>
                        </div>
                        <FiExternalLink size={14} className="text-gray-400 group-hover:text-white transition" />
                    </a>

                    <a
                        href="http://localhost:5175/simulator"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/10 hover:bg-emerald-950/20 transition group"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="text-lg text-emerald-400 font-bold">⏱</span>
                            <div>
                                <div className="font-bold text-xs text-white group-hover:text-emerald-300 transition">
                                    Indian Options Backtest
                                </div>
                                <div className="text-[10px] text-gray-400">/simulator (NIFTY &amp; BNF)</div>
                            </div>
                        </div>
                        <FiExternalLink size={14} className="text-gray-400 group-hover:text-white transition" />
                    </a>

                    <a
                        href="http://localhost:5175/option-chain"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-blue-500/30 bg-blue-950/10 hover:bg-blue-950/20 transition group"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="text-lg text-blue-400 font-bold">📊</span>
                            <div>
                                <div className="font-bold text-xs text-white group-hover:text-blue-300 transition">
                                    Option Chain Analyzer
                                </div>
                                <div className="text-[10px] text-gray-400">/option-chain</div>
                            </div>
                        </div>
                        <FiExternalLink size={14} className="text-gray-400 group-hover:text-white transition" />
                    </a>

                    <a
                        href="http://localhost:5175/strategy-builder"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-cyan-500/30 bg-cyan-950/10 hover:bg-cyan-950/20 transition group"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="text-lg text-cyan-400 font-bold">⚡</span>
                            <div>
                                <div className="font-bold text-xs text-white group-hover:text-cyan-300 transition">
                                    Indian Strategy Builder
                                </div>
                                <div className="text-[10px] text-gray-400">/strategy-builder</div>
                            </div>
                        </div>
                        <FiExternalLink size={14} className="text-gray-400 group-hover:text-white transition" />
                    </a>

                    <a
                        href="http://localhost:5175/historical-chart"
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between p-3.5 rounded-xl border border-teal-500/30 bg-teal-950/10 hover:bg-teal-950/20 transition group"
                    >
                        <div className="flex items-center gap-2.5">
                            <span className="text-lg text-teal-400 font-bold">📈</span>
                            <div>
                                <div className="font-bold text-xs text-white group-hover:text-teal-300 transition">
                                    Historical Charts &amp; VIX
                                </div>
                                <div className="text-[10px] text-gray-400">/historical-chart</div>
                            </div>
                        </div>
                        <FiExternalLink size={14} className="text-gray-400 group-hover:text-white transition" />
                    </a>
                </div>
            </div>
        </div>
    );
}
