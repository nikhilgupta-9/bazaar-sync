// pages/DataExportPrune.jsx — Database Space Lifecycle & Compressed Export/Prune Manager
import { useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchDiskUsage, fetchSymbolList, previewDataPrune, executeDataPrune } from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";
import {
    FiDownloadCloud,
    FiTrash2,
    FiAlertTriangle,
    FiHardDrive,
    FiCheckCircle,
    FiRefreshCw,
} from "react-icons/fi";

const TABLES = [
    { key: "option_chain_history", label: "Option Chain History (1-Min)", icon: "📊" },
    { key: "ohlcv_data", label: "Underlying Equities & VIX (OHLCV)", icon: "📈" },
    { key: "futures_history", label: "Futures History", icon: "📑" },
];

const YEARS = ["ALL", "2026", "2025", "2024", "2023"];

export default function DataExportPrune() {
    const { token } = useAdminAuth();
    const [diskData, setDiskData] = useState([]);
    const [loadingDisk, setLoadingDisk] = useState(true);
    const [symbolList, setSymbolList] = useState({ indices: [], stocks: [] });

    // Export Form
    const [exportTable, setExportTable] = useState("option_chain_history");
    const [exportSymbol, setExportSymbol] = useState("ALL");
    const [exportYear, setExportYear] = useState("ALL");
    const [isExporting, setIsExporting] = useState(false);

    // Prune Form
    const [pruneTable, setPruneTable] = useState("option_chain_history");
    const [pruneSymbol, setPruneSymbol] = useState("ALL");
    const [pruneYear, setPruneYear] = useState("2023");
    const [prunePreview, setPrunePreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [pruning, setPruning] = useState(false);
    const [pruneResult, setPruneResult] = useState(null);
    const [confirmText, setConfirmText] = useState("");

    function loadDisk() {
        setLoadingDisk(true);
        fetchDiskUsage(token)
            .then((res) => setDiskData(res.tables || []))
            .catch((err) => console.error("Disk usage load failed:", err))
            .finally(() => setLoadingDisk(false));
    }

    useEffect(() => {
        loadDisk();
        fetchSymbolList()
            .then(setSymbolList)
            .catch(() => {});
    }, [token]);

    const allSymbols = ["ALL", ...symbolList.indices, ...symbolList.stocks];

    function handleExport(e) {
        e.preventDefault();
        setIsExporting(true);
        const params = new URLSearchParams({
            table: exportTable,
            symbol: exportSymbol,
            year: exportYear === "ALL" ? "" : exportYear,
        });

        // Trigger direct browser download
        const url = `/api/admin/data/export?${params.toString()}`;
        window.open(url, "_blank");
        setTimeout(() => setIsExporting(false), 2000);
    }

    async function handlePreviewPrune(e) {
        e.preventDefault();
        setPreviewLoading(true);
        setPruneResult(null);
        setPrunePreview(null);
        setConfirmText("");

        try {
            const preview = await previewDataPrune(token, {
                table: pruneTable,
                symbol: pruneSymbol,
                year: pruneYear === "ALL" ? "" : pruneYear,
            });
            setPrunePreview(preview);
        } catch (err) {
            alert(err.message || "Failed to preview prune");
        } finally {
            setPreviewLoading(false);
        }
    }

    async function handleExecutePrune() {
        if (confirmText.toUpperCase() !== "DELETE") {
            alert("Please type DELETE to confirm");
            return;
        }
        if (!window.confirm(`Are you absolutely sure you want to permanently delete ${prunePreview.matchingRows.toLocaleString()} rows from ${pruneTable}?`)) {
            return;
        }

        setPruning(true);
        try {
            const result = await executeDataPrune(token, {
                table: pruneTable,
                symbol: pruneSymbol,
                year: pruneYear === "ALL" ? "" : pruneYear,
            });
            setPruneResult(result);
            setPrunePreview(null);
            setConfirmText("");
            loadDisk(); // refresh table stats
        } catch (err) {
            alert(err.message || "Failed to execute prune");
        } finally {
            setPruning(false);
        }
    }

    return (
        <div className="flex-1 overflow-y-auto">
            <DataNavHeader
                title="Data Export & Space Lifecycle Manager"
                subtitle="Stream compressed backups, inspect MySQL table disk footprints, and reclaim disk space."
            />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-6">

            {/* Table Disk Footprints Banner Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                <div>
                    <h3 className="text-sm font-bold text-white">Database Storage Footprints</h3>
                    <p className="text-xs text-gray-400">Real-time disk consumption and row counts per historical table.</p>
                </div>
                <button
                    onClick={loadDisk}
                    disabled={loadingDisk}
                    className="inline-flex self-start sm:self-auto items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-white/10 hover:text-white transition disabled:opacity-50"
                >
                    <FiRefreshCw className={loadingDisk ? "animate-spin" : ""} size={13} />
                    <span>{loadingDisk ? "Refreshing…" : "Refresh Sizes"}</span>
                </button>
            </div>

            {/* Table Disk Footprints Banner */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {diskData.map((item) => (
                    <div
                        key={item.tableName}
                        className="rounded-xl border border-white/10 bg-[#0e0e14] p-4 shadow-sm relative overflow-hidden"
                    >
                        <div className="flex items-start justify-between">
                            <div>
                                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                                    {item.tableName}
                                </span>
                                <div className="mt-1 text-2xl font-black text-white font-mono">
                                    {item.totalSizeMb} <span className="text-sm font-normal text-gray-400">MB</span>
                                </div>
                            </div>
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <FiHardDrive size={20} />
                            </div>
                        </div>

                        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                            <span>
                                <strong className="text-gray-200">{Number(item.tableRows).toLocaleString()}</strong> rows
                            </span>
                            <span>
                                <strong className="text-gray-200">{item.symbolCount}</strong> symbols
                            </span>
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 truncate">
                            Date span: {item.minDate} → {item.maxDate}
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 1. One-Click Compressed Export */}
                <Card title="1. Selective Compressed Export (.csv.gz)" icon={FiDownloadCloud}>
                    <p className="text-xs text-gray-400 mb-4">
                        Stream multi-gigabyte datasets straight out of MySQL into a lightweight, compressed `.csv.gz` archive for off-site backup or moving to a larger server.
                    </p>

                    <form onSubmit={handleExport} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-300 mb-1">Target Table</label>
                            <select
                                value={exportTable}
                                onChange={(e) => setExportTable(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-[#161622] px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-hidden"
                            >
                                {TABLES.map((t) => (
                                    <option key={t.key} value={t.key}>
                                        {t.icon} {t.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-300 mb-1">Symbol</label>
                                <select
                                    value={exportSymbol}
                                    onChange={(e) => setExportSymbol(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-[#161622] px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-hidden"
                                >
                                    {allSymbols.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-300 mb-1">Year</label>
                                <select
                                    value={exportYear}
                                    onChange={(e) => setExportYear(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-[#161622] px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-hidden"
                                >
                                    {YEARS.map((y) => (
                                        <option key={y} value={y}>
                                            {y}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isExporting}
                            className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg hover:bg-emerald-500 active:scale-98 transition disabled:opacity-50"
                        >
                            <FiDownloadCloud size={16} />
                            <span>{isExporting ? "Starting Stream Download..." : "Download Compressed Export"}</span>
                        </button>
                    </form>
                </Card>

                {/* 2. Safe Pruning & Disk Reclaim */}
                <Card title="2. Safe Prune & Disk Reclaim" icon={FiTrash2}>
                    <p className="text-xs text-gray-400 mb-4">
                        Wipe old or unwanted historical rows from your local database to free up disk space after exporting.
                    </p>

                    <form onSubmit={handlePreviewPrune} className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-300 mb-1">Target Table to Prune</label>
                            <select
                                value={pruneTable}
                                onChange={(e) => setPruneTable(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-[#161622] px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-hidden"
                            >
                                {TABLES.map((t) => (
                                    <option key={t.key} value={t.key}>
                                        {t.icon} {t.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-300 mb-1">Symbol</label>
                                <select
                                    value={pruneSymbol}
                                    onChange={(e) => setPruneSymbol(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-[#161622] px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-hidden"
                                >
                                    {allSymbols.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold text-gray-300 mb-1">Year to Delete</label>
                                <select
                                    value={pruneYear}
                                    onChange={(e) => setPruneYear(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-[#161622] px-3 py-2 text-xs text-white focus:border-rose-500 focus:outline-hidden"
                                >
                                    <option value="2023">2023</option>
                                    <option value="2024">2024</option>
                                    <option value="2025">2025</option>
                                    <option value="2026">2026</option>
                                </select>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={previewLoading}
                            className="w-full flex items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-2 text-xs font-bold text-rose-300 hover:bg-rose-900/50 transition"
                        >
                            <span>{previewLoading ? "Calculating matching rows..." : "Preview Prune Impact"}</span>
                        </button>
                    </form>

                    {/* Dry Run Confirmation Panel */}
                    {prunePreview && (
                        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 space-y-3">
                            <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
                                <FiAlertTriangle size={16} />
                                <span>Dry-Run Analysis Result</span>
                            </div>
                            <div className="text-xs text-gray-300">
                                Found <strong className="text-white font-mono">{prunePreview.matchingRows.toLocaleString()}</strong> rows in <span className="font-mono text-amber-300">{prunePreview.table}</span> ({prunePreview.minDate} to {prunePreview.maxDate}).
                            </div>

                            {prunePreview.matchingRows > 0 ? (
                                <div className="space-y-2 pt-2 border-t border-rose-500/20">
                                    <label className="block text-[11px] text-gray-400">
                                        Type <span className="font-bold text-rose-400">DELETE</span> to confirm permanent deletion:
                                    </label>
                                    <input
                                        type="text"
                                        value={confirmText}
                                        onChange={(e) => setConfirmText(e.target.value)}
                                        placeholder="Type DELETE"
                                        className="w-full rounded-lg border border-rose-500/40 bg-[#161622] px-3 py-1.5 text-xs text-white focus:outline-hidden"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleExecutePrune}
                                        disabled={confirmText.toUpperCase() !== "DELETE" || pruning}
                                        className="w-full rounded-xl bg-rose-600 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-40 shadow-md transition"
                                    >
                                        {pruning ? "Executing Batch Deletion..." : "Permanently Delete and Reclaim Space"}
                                    </button>
                                </div>
                            ) : (
                                <div className="text-xs text-gray-400">No matching records to delete.</div>
                            )}
                        </div>
                    )}

                    {/* Success Notice */}
                    {pruneResult && (
                        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 flex items-center gap-2 text-xs text-emerald-300">
                            <FiCheckCircle size={16} />
                            <span>Successfully pruned {pruneResult.deletedRows.toLocaleString()} rows. Disk space released!</span>
                        </div>
                    )}
                </Card>
            </div>
            </div>
        </div>
    );
}
