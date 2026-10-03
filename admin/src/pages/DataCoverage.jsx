// pages/DataCoverage.jsx — per-symbol, per-month "how much data do we
// actually have vs. how much should exist" for the 2023-onward target window,
// with integrated Google Drive Cloud Backup & 1-Click Push to Drive sync.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    FiRefreshCw,
    FiSearch,
    FiClock,
    FiDatabase,
    FiCloud,
    FiUploadCloud,
    FiCheckCircle,
    FiExternalLink,
    FiHardDrive,
    FiAlertCircle,
    FiLayers,
    FiCheck,
    FiTrash2,
} from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import {
    fetchCoverageSummary,
    fetchCoverageDetail,
    fetchCoverageDays,
    refreshCoverageCache,
    fetchGDriveCoverage,
    manualArchiveBatch,
    startGDrivePipeline,
} from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";

const SEVEN_INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const YEARS = [2023, 2024, 2025, 2026];

function pctColor(pct) {
    if (pct == null) return "bg-white/5 text-gray-600";
    if (pct >= 90) return "bg-emerald-500/20 text-emerald-300";
    if (pct >= 50) return "bg-amber-500/20 text-amber-300";
    if (pct > 0) return "bg-rose-500/20 text-rose-300";
    return "bg-white/5 text-gray-600";
}

function formatTimestamp(value) {
    if (!value) return "Not available";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
}

function formatNumber(num) {
    if (num == null) return "0";
    return Number(num).toLocaleString("en-IN");
}

export default function DataCoverage() {
    const { token } = useAdminAuth();
    const [dataType, setDataType] = useState("option_chain");
    const [summary, setSummary] = useState(null);
    const [cloudMatrix, setCloudMatrix] = useState(null);
    const [error, setError] = useState(null);
    const [successMessage, setSuccessMessage] = useState(null);
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState("all"); // "all" | "in_drive" | "local_db" | "pending"
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState(null);
    const [days, setDays] = useState(null);

    // Push Action States
    const [pushingYear, setPushingYear] = useState(null); // specific year pushing e.g. 2025
    const [pushingSymbol, setPushingSymbol] = useState(false); // pushing all years for selected symbol
    const [pushingAll, setPushingAll] = useState(false); // pushing all active symbols in category
    const [autoPrune, setAutoPrune] = useState(true);

    const load = useCallback(() => {
        setError(null);
        // Fetch local coverage summary
        const categoryParam = dataType === "vix" ? "vix" : dataType;
        fetchCoverageSummary(token, categoryParam)
            .then((r) => setSummary(r))
            .catch((err) => setError(err.message));

        // Fetch Cloud Google Drive coverage matrix
        fetchGDriveCoverage(token)
            .then((res) => {
                if (res && res.matrix) setCloudMatrix(res);
            })
            .catch((err) => {
                console.warn("GDrive coverage matrix fetch error:", err.message);
            });
    }, [token, dataType]);

    useEffect(load, [load]);

    // Map cloud data by category_symbol
    const cloudAssetMap = useMemo(() => {
        if (!cloudMatrix || !cloudMatrix.matrix) return new Map();
        const map = new Map();
        const catKey = dataType === "vix" ? "india_vix" : dataType;
        cloudMatrix.matrix.forEach((item) => {
            if (item.category === catKey || item.category === dataType) {
                map.set(item.symbol.toUpperCase(), item);
            }
        });
        return map;
    }, [cloudMatrix, dataType]);

    // Compute cloud status for each symbol
    const symbolCloudStatusMap = useMemo(() => {
        const map = new Map();
        if (!summary || !summary.symbols) return map;

        summary.symbols.forEach((s) => {
            const sym = s.symbol.toUpperCase();
            const cloud = cloudAssetMap.get(sym);
            let inDriveCount = 0;
            let localCount = 0;

            if (cloud && cloud.years) {
                YEARS.forEach((yr) => {
                    const yData = cloud.years[yr];
                    if (yData?.status === "gdrive_archived") inDriveCount++;
                    else if (yData?.status === "local_db" || yData?.localCount > 0) localCount++;
                });
            } else if (s.totalDays > 0 || s.totalRows > 0) {
                localCount++;
            }

            let status = "pending";
            if (inDriveCount > 0 && localCount === 0) status = "in_drive";
            else if (inDriveCount > 0 && localCount > 0) status = "partially_in_drive";
            else if (localCount > 0 || s.totalDays > 0) status = "local_db";

            map.set(sym, {
                status,
                inDriveCount,
                localCount,
                cloudData: cloud,
            });
        });
        return map;
    }, [summary, cloudAssetMap]);

    // Computed rows with search & status filters
    const rows = useMemo(() => {
        if (!summary) return [];
        let list = [];

        if (dataType === "vix") {
            list = summary.symbols || [];
        } else {
            const bySymbol = new Map(summary.symbols.map((s) => [s.symbol, s]));
            const indices = SEVEN_INDICES.map(
                (sym) =>
                    bySymbol.get(sym) || {
                        symbol: sym,
                        firstDate: null,
                        lastDate: null,
                        totalRows: 0,
                        totalDays: 0,
                        monthsWithData: 0,
                        lastUpdatedAt: null,
                    }
            );
            const stocks = summary.symbols
                .filter((s) => !SEVEN_INDICES.includes(s.symbol))
                .filter((s) => !search || s.symbol.includes(search.toUpperCase()));
            list = [...indices, ...stocks];
        }

        // Apply Status Filter
        if (statusFilter !== "all") {
            list = list.filter((r) => {
                const info = symbolCloudStatusMap.get(r.symbol);
                if (statusFilter === "in_drive") return info?.status === "in_drive" || info?.status === "partially_in_drive";
                if (statusFilter === "local_db") return info?.status === "local_db" || info?.status === "partially_in_drive";
                if (statusFilter === "pending") return !info || info?.status === "pending";
                return true;
            });
        }

        return list;
    }, [summary, search, dataType, statusFilter, symbolCloudStatusMap]);

    // Cloud & DB Overall Summary Counts
    const overallStats = useMemo(() => {
        let totalSymbols = summary?.symbols?.length || 0;
        let totalDriveFiles = 0;
        let totalDriveBytes = 0;
        let totalLocalRows = 0;
        let symbolsInDrive = 0;
        let symbolsInDb = 0;

        symbolCloudStatusMap.forEach((info) => {
            if (info.inDriveCount > 0) symbolsInDrive++;
            if (info.localCount > 0 || info.status === "local_db") symbolsInDb++;
        });

        if (cloudMatrix && cloudMatrix.matrix) {
            const catKey = dataType === "vix" ? "india_vix" : dataType;
            cloudMatrix.matrix
                .filter((m) => m.category === catKey || m.category === dataType)
                .forEach((m) => {
                    YEARS.forEach((yr) => {
                        const y = m.years?.[yr];
                        if (y?.status === "gdrive_archived") {
                            totalDriveFiles++;
                            totalDriveBytes += y.cloudSizeBytes || 0;
                        }
                        if (y?.localCount > 0) {
                            totalLocalRows += y.localCount;
                        }
                    });
                });
        }

        return {
            totalSymbols,
            symbolsInDrive,
            symbolsInDb,
            totalDriveFiles,
            totalDriveBytes,
            totalLocalRows,
        };
    }, [summary, cloudMatrix, dataType, symbolCloudStatusMap]);

    const selectedSummary = summary?.symbols?.find((row) => row.symbol === selected) || null;
    const selectedCloud = selected ? cloudAssetMap.get(selected.toUpperCase()) : null;

    const latestDataMonth = detail?.filter((month) => month.days > 0).reduce((best, month) => {
        if (!best || month.month > best.month) return month;
        return best;
    }, null);

    function selectSymbol(sym) {
        setSelected(sym);
        setDetail(null);
        setSelectedMonth(null);
        setDays(null);
        setSuccessMessage(null);
        fetchCoverageDetail(token, dataType === "vix" ? "vix" : dataType, sym)
            .then((r) => setDetail(r.months))
            .catch((err) => setError(err.message));
    }

    function selectMonth(month) {
        if (selectedMonth === month) {
            setSelectedMonth(null);
            setDays(null);
            return;
        }
        setSelectedMonth(month);
        setDays(null);
        fetchCoverageDays(token, dataType === "vix" ? "vix" : dataType, selected, month)
            .then((r) => setDays(r.days))
            .catch((err) => setError(err.message));
    }

    async function handleRefresh() {
        setRefreshing(true);
        setError(null);
        setSuccessMessage(null);
        try {
            await refreshCoverageCache(token);
            load();
            if (selected) selectSymbol(selected);
        } catch (err) {
            setError(err.message);
        } finally {
            setRefreshing(false);
        }
    }

    // 1-Click Push a Single Year of the Selected Symbol to Google Drive
    async function handlePushYear(year) {
        if (!selected) return;
        setPushingYear(year);
        setError(null);
        setSuccessMessage(null);
        try {
            const cat = dataType === "vix" ? "india_vix" : dataType;
            const res = await manualArchiveBatch(token, {
                dataType: cat,
                symbol: selected,
                year,
                autoPrune,
            });

            if (res.status === "no_data") {
                setSuccessMessage(`ℹ️ No local records found for ${selected} (${year}).`);
            } else {
                setSuccessMessage(
                    `✅ ${selected} (${year}) successfully uploaded to Google Drive! Archived ${formatNumber(
                        res.recordCount || res.totalRecords
                    )} rows.`
                );
            }
            load();
            if (selected) selectSymbol(selected);
        } catch (err) {
            setError(err.message || `Failed to push ${selected} (${year}) to Google Drive`);
        } finally {
            setPushingYear(null);
        }
    }

    // Push All 4 Years for Selected Symbol
    async function handlePushSymbolAllYears() {
        if (!selected) return;
        setPushingSymbol(true);
        setError(null);
        setSuccessMessage(null);
        try {
            const cat = dataType === "vix" ? "india_vix" : dataType;
            let pushedCount = 0;

            for (const yr of YEARS) {
                const yrData = selectedCloud?.years?.[yr];
                // Push if it has local data or not yet in drive
                if (yrData?.status !== "gdrive_archived" || yrData?.localCount > 0) {
                    await manualArchiveBatch(token, {
                        dataType: cat,
                        symbol: selected,
                        year: yr,
                        autoPrune,
                    });
                    pushedCount++;
                }
            }

            setSuccessMessage(`✅ Successfully synced all available years for ${selected} to Google Drive!`);
            load();
            if (selected) selectSymbol(selected);
        } catch (err) {
            setError(err.message || `Failed to push ${selected} to Google Drive`);
        } finally {
            setPushingSymbol(false);
        }
    }

    // Push All Symbols with Local Data in this Category to Google Drive
    async function handlePushAllCategory() {
        if (!window.confirm(`Are you sure you want to push all pending ${dataType} data to Google Drive?`)) {
            return;
        }
        setPushingAll(true);
        setError(null);
        setSuccessMessage(null);
        try {
            const cat = dataType === "vix" ? "india_vix" : dataType;
            const activeSymbols = summary?.symbols?.map((s) => s.symbol) || [];

            await startGDrivePipeline(token, {
                dataTypes: [cat],
                targetYears: ["2023", "2024", "2025", "2026"],
                symbols: activeSymbols.length > 0 ? activeSymbols : undefined,
                autoPrune,
            });

            setSuccessMessage(`🚀 Google Drive Archival Pipeline initiated! Data is uploading in background.`);
            load();
        } catch (err) {
            setError(err.message || "Failed to start Google Drive archival pipeline");
        } finally {
            setPushingAll(false);
        }
    }

    return (
        <div className="min-h-screen bg-[#08080b] text-gray-100 pb-12">
            <DataNavHeader
                title="Historical Data Coverage & Cloud Archival"
                subtitle={`Completeness audit & 1-Click Google Drive Cloud sync for ${
                    dataType === "futures" ? "Futures" : dataType === "vix" ? "India VIX" : "Option Chain"
                } data (${summary?.coverageStart || "2023-01-01"} onward).`}
            />

            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4">
                {/* Alert Messages */}
                {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <FiAlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                            <span>{error}</span>
                        </div>
                        <button onClick={() => setError(null)} className="text-gray-400 hover:text-white text-xs ml-2">
                            ✕
                        </button>
                    </div>
                )}

                {successMessage && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-medium flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <FiCheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                            <span>{successMessage}</span>
                        </div>
                        <button onClick={() => setSuccessMessage(null)} className="text-gray-400 hover:text-white text-xs ml-2">
                            ✕
                        </button>
                    </div>
                )}

                {/* Top Action Ribbon */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#101015] border border-white/10 rounded-2xl p-3 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <select
                            value={dataType}
                            onChange={(e) => {
                                setDataType(e.target.value);
                                setSelected(null);
                                setDetail(null);
                                setSummary(null);
                                setSelectedMonth(null);
                                setDays(null);
                            }}
                            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs sm:text-sm font-semibold text-white outline-none focus:border-violet-500 cursor-pointer"
                        >
                            <option value="option_chain" className="bg-[#12121a]">
                                ⚡ Option Chain
                            </option>
                            <option value="futures" className="bg-[#12121a]">
                                📈 Futures
                            </option>
                            <option value="vix" className="bg-[#12121a]">
                                📊 India VIX
                            </option>
                        </select>

                        {/* Search Input */}
                        <div className="relative min-w-[200px] max-w-xs">
                            <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                            <input
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search symbol (e.g. NIFTY)…"
                                className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-violet-500 placeholder-gray-500"
                            />
                            {search && (
                                <button
                                    onClick={() => setSearch("")}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-white"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Quick Push & Refresh Actions */}
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-400 bg-white/5 px-2.5 py-1.5 rounded-lg border border-white/5 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoPrune}
                                onChange={(e) => setAutoPrune(e.target.checked)}
                                className="rounded text-violet-500 focus:ring-0 bg-transparent"
                            />
                            <FiTrash2 className="h-3 w-3 text-amber-400" />
                            <span>Auto-free Mac disk</span>
                        </label>

                        <button
                            onClick={handlePushAllCategory}
                            disabled={pushingAll}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-2 text-xs font-bold text-white shadow-md hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 transition"
                            title="Upload all active local DB data for this category directly to Google Drive"
                        >
                            <FiUploadCloud className={`h-3.5 w-3.5 ${pushingAll ? "animate-bounce" : ""}`} />
                            {pushingAll ? "Pushing to Drive…" : "Push All to Drive"}
                        </button>

                        <button
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-white/10 disabled:opacity-50 transition"
                        >
                            <FiRefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
                        </button>
                    </div>
                </div>

                {/* Cloud & Local DB Metric Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-[#12121a] p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                                <FiDatabase className="h-3.5 w-3.5 text-indigo-400" /> Tracked Assets
                            </span>
                            <span className="text-[10px] bg-indigo-500/10 text-indigo-300 font-semibold px-2 py-0.5 rounded-full">
                                {dataType.toUpperCase()}
                            </span>
                        </div>
                        <div className="mt-2 text-xl sm:text-2xl font-black text-white">
                            {summary?.symbols?.length ? formatNumber(summary.symbols.length) : "—"}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">Total symbols in universe</div>
                    </div>

                    <div className="rounded-2xl border border-emerald-500/20 bg-[#12121a] p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                                <FiCloud className="h-3.5 w-3.5" /> In Google Drive
                            </span>
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full">
                                SECURED
                            </span>
                        </div>
                        <div className="mt-2 text-xl sm:text-2xl font-black text-emerald-300">
                            {overallStats.totalDriveFiles} <span className="text-xs font-normal text-gray-400">batches</span>
                        </div>
                        <div className="text-[11px] text-emerald-400/80 truncate mt-0.5">
                            {formatBytes(overallStats.totalDriveBytes)} cloud storage used
                        </div>
                    </div>

                    <div className="rounded-2xl border border-amber-500/20 bg-[#12121a] p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                <FiHardDrive className="h-3.5 w-3.5" /> In Local DB
                            </span>
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 font-bold px-2 py-0.5 rounded-full">
                                READY TO SYNC
                            </span>
                        </div>
                        <div className="mt-2 text-xl sm:text-2xl font-black text-amber-300">
                            {formatNumber(overallStats.symbolsInDb)} <span className="text-xs font-normal text-gray-400">symbols</span>
                        </div>
                        <div className="text-[11px] text-amber-400/80 truncate mt-0.5">
                            Ready to push & free Mac space
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-[#12121a] p-3.5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                                <FiClock className="h-3.5 w-3.5 text-violet-400" /> Coverage Span
                            </span>
                            <span className="text-[10px] bg-violet-500/10 text-violet-300 font-bold px-2 py-0.5 rounded-full">
                                2023-2026
                            </span>
                        </div>
                        <div className="mt-2 text-sm sm:text-base font-bold text-white truncate">
                            {selectedSummary ? selectedSummary.lastDate || "Recent" : "2023 → Present"}
                        </div>
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">
                            {selected ? `${selected} selected` : "Select a symbol on left"}
                        </div>
                    </div>
                </div>

                {/* Main 2-Column Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left Column: Symbols List (5 cols) */}
                    <Card
                        title={
                            <div className="flex items-center justify-between w-full">
                                <span className="flex items-center gap-1.5">
                                    <FiLayers className="h-4 w-4 text-violet-400" />
                                    <span>Symbols ({rows.length})</span>
                                </span>
                                {/* Filter Chips */}
                                <div className="flex items-center gap-1 text-[10px]">
                                    <button
                                        onClick={() => setStatusFilter("all")}
                                        className={`px-2 py-0.5 rounded-md transition font-medium ${
                                            statusFilter === "all" ? "bg-violet-600 text-white" : "bg-white/5 text-gray-400 hover:bg-white/10"
                                        }`}
                                    >
                                        All
                                    </button>
                                    <button
                                        onClick={() => setStatusFilter("in_drive")}
                                        className={`px-2 py-0.5 rounded-md transition font-medium ${
                                            statusFilter === "in_drive" ? "bg-emerald-600 text-white" : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                        }`}
                                    >
                                        🟢 In Drive
                                    </button>
                                    <button
                                        onClick={() => setStatusFilter("local_db")}
                                        className={`px-2 py-0.5 rounded-md transition font-medium ${
                                            statusFilter === "local_db" ? "bg-amber-600 text-white" : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                                        }`}
                                    >
                                        🟡 In DB
                                    </button>
                                </div>
                            </div>
                        }
                        className="lg:col-span-5"
                        bodyClassName="max-h-[72vh] overflow-x-auto overflow-y-auto p-0 custom-scrollbar"
                    >
                        {!summary ? (
                            <div className="py-12 text-center text-xs text-gray-500 flex flex-col items-center justify-center gap-2">
                                <FiRefreshCw className="h-5 w-5 animate-spin text-violet-400" />
                                <span>Scanning historical data coverage matrix…</span>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs">
                                <thead className="sticky top-0 bg-[#101015] border-b border-white/10 text-gray-400 font-semibold z-10">
                                    <tr>
                                        <th className="px-3.5 py-2.5">Symbol</th>
                                        <th className="px-2.5 py-2.5">Drive Status</th>
                                        <th className="px-2.5 py-2.5">Days</th>
                                        <th className="px-2.5 py-2.5">Last Date</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {rows.map((r) => {
                                        const cloudInfo = symbolCloudStatusMap.get(r.symbol);
                                        const isSelected = selected === r.symbol;

                                        return (
                                            <tr
                                                key={r.symbol}
                                                onClick={() => selectSymbol(r.symbol)}
                                                className={`cursor-pointer transition hover:bg-white/5 ${
                                                    isSelected ? "bg-violet-600/15 font-semibold text-white" : "text-gray-300"
                                                }`}
                                            >
                                                <td className="px-3.5 py-2.5">
                                                    <div className="flex items-center gap-2">
                                                        <span
                                                            className={`h-2 w-2 rounded-full shrink-0 ${
                                                                cloudInfo?.status === "in_drive"
                                                                    ? "bg-emerald-400 ring-2 ring-emerald-400/30"
                                                                    : cloudInfo?.status === "partially_in_drive"
                                                                    ? "bg-teal-400"
                                                                    : cloudInfo?.status === "local_db"
                                                                    ? "bg-amber-400 ring-2 ring-amber-400/30"
                                                                    : "bg-gray-600"
                                                            }`}
                                                        />
                                                        <span className="font-bold">{r.symbol}</span>
                                                    </div>
                                                </td>
                                                <td className="px-2.5 py-2.5">
                                                    {cloudInfo?.status === "in_drive" ? (
                                                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                                            <FiCheck className="h-3 w-3" /> Drive ({cloudInfo.inDriveCount}y)
                                                        </span>
                                                    ) : cloudInfo?.status === "partially_in_drive" ? (
                                                        <span className="inline-flex items-center gap-1 rounded-md bg-teal-500/15 px-2 py-0.5 text-[10px] font-bold text-teal-300">
                                                            <FiCloud className="h-3 w-3" /> Drive + DB
                                                        </span>
                                                    ) : cloudInfo?.status === "local_db" ? (
                                                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                                                            <FiHardDrive className="h-3 w-3" /> In Local DB
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-600 text-[10px]">⚪ Pending</span>
                                                    )}
                                                </td>
                                                <td className="px-2.5 py-2.5 font-medium">{r.totalDays || "—"}</td>
                                                <td className="px-2.5 py-2.5 text-gray-400 text-[11px]">{r.lastDate || "—"}</td>
                                            </tr>
                                        );
                                    })}
                                    {rows.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="py-8 text-center text-xs text-gray-500">
                                                No symbols found matching "{search}" or current filter.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        )}
                    </Card>

                    {/* Right Column: Symbol Cloud Archival & Month Coverage (7 cols) */}
                    <Card
                        title={
                            selected ? (
                                <div className="flex items-center justify-between w-full">
                                    <div className="flex items-center gap-2">
                                        <span className="text-base font-black text-white">{selected}</span>
                                        <span className="text-xs text-gray-400 font-normal">Cloud Backup & Coverage Details</span>
                                    </div>
                                    <button
                                        onClick={handlePushSymbolAllYears}
                                        disabled={pushingSymbol}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50 transition shadow-sm"
                                        title="Push all years of this symbol to Google Drive"
                                    >
                                        <FiUploadCloud className={`h-3.5 w-3.5 ${pushingSymbol ? "animate-spin" : ""}`} />
                                        {pushingSymbol ? "Pushing…" : `Push ${selected} to Drive`}
                                    </button>
                                </div>
                            ) : (
                                "Select a Symbol"
                            )
                        }
                        className="lg:col-span-7"
                    >
                        {!selected ? (
                            <div className="py-16 text-center text-xs text-gray-500 flex flex-col items-center justify-center gap-3">
                                <div className="h-12 w-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10">
                                    <FiCloud className="h-6 w-6 text-gray-400" />
                                </div>
                                <div className="font-semibold text-gray-300 text-sm">No symbol selected</div>
                                <p className="max-w-xs text-gray-500">
                                    Click any stock or index on the left table to inspect year-by-year Google Drive backup status and 1-click cloud sync.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Year-wise Cloud Archive Status Cards */}
                                <div className="rounded-xl border border-white/10 bg-white/5 p-3.5 space-y-3">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-gray-200 flex items-center gap-1.5">
                                            <FiCloud className="h-4 w-4 text-emerald-400" />
                                            <span>Google Drive Archival by Year</span>
                                        </span>
                                        <span className="text-[11px] text-gray-400">
                                            Total in Local DB: <strong className="text-white">{formatNumber(selectedSummary?.totalRows || 0)} rows</strong>
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                        {YEARS.map((yr) => {
                                            const yrData = selectedCloud?.years?.[yr];
                                            const isArchived = yrData?.status === "gdrive_archived";
                                            const hasLocal = yrData?.status === "local_db" || yrData?.localCount > 0;
                                            const isPushing = pushingYear === yr;

                                            return (
                                                <div
                                                    key={yr}
                                                    className={`rounded-xl border p-2.5 flex flex-col justify-between transition ${
                                                        isArchived
                                                            ? "border-emerald-500/30 bg-emerald-500/10"
                                                            : hasLocal
                                                            ? "border-amber-500/30 bg-amber-500/10"
                                                            : "border-white/5 bg-white/5"
                                                    }`}
                                                >
                                                    <div>
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs font-bold text-white">{yr}</span>
                                                            {isArchived ? (
                                                                <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/20 px-1.5 py-0.2 rounded">
                                                                    IN DRIVE
                                                                </span>
                                                            ) : hasLocal ? (
                                                                <span className="text-[9px] font-bold text-amber-300 bg-amber-500/20 px-1.5 py-0.2 rounded">
                                                                    LOCAL DB
                                                                </span>
                                                            ) : (
                                                                <span className="text-[9px] text-gray-500">EMPTY</span>
                                                            )}
                                                        </div>

                                                        <div className="mt-1.5 text-[11px] text-gray-300">
                                                            {isArchived ? (
                                                                <div>
                                                                    <div className="font-semibold text-emerald-300">
                                                                        {formatBytes(yrData.cloudSizeBytes)}
                                                                    </div>
                                                                    <div className="text-[10px] text-gray-400">
                                                                        {formatNumber(yrData.cloudRecords)} rows
                                                                    </div>
                                                                </div>
                                                            ) : hasLocal ? (
                                                                <div>
                                                                    <div className="font-semibold text-amber-300">
                                                                        {formatNumber(yrData.localCount)} rows
                                                                    </div>
                                                                    <div className="text-[10px] text-gray-400">Pending sync</div>
                                                                </div>
                                                            ) : (
                                                                <div className="text-gray-500 text-[10px]">No records</div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Action Button */}
                                                    <div className="mt-2.5 pt-2 border-t border-white/5">
                                                        {isArchived && yrData.cloudWebLink ? (
                                                            <a
                                                                href={yrData.cloudWebLink}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="inline-flex items-center justify-center gap-1 w-full text-[10px] font-bold text-emerald-400 hover:text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 py-1 rounded-lg transition"
                                                            >
                                                                <FiExternalLink className="h-3 w-3" /> View in Drive
                                                            </a>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                disabled={isPushing}
                                                                onClick={() => handlePushYear(yr)}
                                                                className="inline-flex items-center justify-center gap-1 w-full text-[10px] font-bold text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/30 py-1 rounded-lg transition disabled:opacity-50"
                                                            >
                                                                <FiUploadCloud className={`h-3 w-3 ${isPushing ? "animate-bounce" : ""}`} />
                                                                {isPushing ? "Pushing…" : "Push to Drive"}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Month-by-Month Matrix */}
                                <div>
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                                        <span className="font-bold text-gray-200">
                                            Monthly Historical Completeness (2023–2026)
                                        </span>
                                        <span>
                                            Latest market month: <strong className="text-white">{latestDataMonth?.month || "—"}</strong>
                                        </span>
                                    </div>

                                    {!detail ? (
                                        <div className="py-8 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
                                            <FiRefreshCw className="h-4 w-4 animate-spin text-violet-400" />
                                            <span>Loading monthly breakdown…</span>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                                            {detail.map((m) => {
                                                const yearNum = parseInt(m.month.slice(0, 4));
                                                const isYearInDrive = selectedCloud?.years?.[yearNum]?.status === "gdrive_archived";

                                                return (
                                                    <button
                                                        type="button"
                                                        key={m.month}
                                                        onClick={() => selectMonth(m.month)}
                                                        className={`rounded-xl p-2 text-center outline-none transition relative ${pctColor(
                                                            m.coveragePct
                                                        )} ${selectedMonth === m.month ? "ring-2 ring-violet-400" : ""}`}
                                                        title={`${m.days} of ${m.expectedDays ?? "?"} expected days, ${formatNumber(
                                                            m.rows
                                                        )} rows ${isYearInDrive ? "· Archived in Google Drive" : ""}`}
                                                    >
                                                        {isYearInDrive && (
                                                            <div
                                                                className="absolute top-1 right-1 text-[9px] text-emerald-300 font-black"
                                                                title="Backed up in Google Drive"
                                                            >
                                                                ☁️
                                                            </div>
                                                        )}
                                                        <div className="text-[10px] font-semibold opacity-90">{m.month}</div>
                                                        <div className="text-xs font-black mt-0.5">
                                                            {m.days}
                                                            {m.expectedDays != null ? `/${m.expectedDays}` : ""}
                                                        </div>
                                                        {m.missingDays > 0 && (
                                                            <div className="text-[9px] opacity-80 text-rose-300">−{m.missingDays}d</div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Selected Month Day-by-Day Breakdown */}
                                {selectedMonth && (
                                    <div className="mt-4 border-t border-white/10 pt-3">
                                        <div className="mb-2 text-xs font-bold text-gray-200 flex items-center justify-between">
                                            <span>
                                                {selected} · {selectedMonth} — Daily Tape Breakdown
                                            </span>
                                            <button
                                                onClick={() => setSelectedMonth(null)}
                                                className="text-gray-400 hover:text-white text-xs font-normal"
                                            >
                                                Close
                                            </button>
                                        </div>
                                        {!days ? (
                                            <div className="py-6 text-center text-xs text-gray-500">Loading daily tape…</div>
                                        ) : (
                                            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
                                                {days.map((d) => (
                                                    <div
                                                        key={d.date}
                                                        className={`rounded-lg px-2 py-1.5 text-center text-[10px] transition ${
                                                            d.hasData
                                                                ? "bg-emerald-500/20 text-emerald-300 font-semibold"
                                                                : "bg-rose-500/15 text-rose-300"
                                                        }`}
                                                        title={
                                                            d.hasData
                                                                ? `${d.date}: ${formatNumber(d.rows)} rows (${formatNumber(
                                                                      d.minuteRows
                                                                  )} minute ticks)`
                                                                : `${d.date}: no data`
                                                        }
                                                    >
                                                        <div className="font-bold">{d.date.slice(8)}</div>
                                                        <div className="opacity-80 text-[9px]">
                                                            {d.hasData ? formatNumber(d.rows) : "—"}
                                                        </div>
                                                    </div>
                                                ))}
                                                {!days.length && (
                                                    <div className="col-span-full py-4 text-center text-xs text-gray-500">
                                                        No trading-day reference for this month.
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}
