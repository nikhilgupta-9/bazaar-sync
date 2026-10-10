// pages/DataExtraction.jsx — Historical Data Extraction, Live Terminal, Watchdog Supervisor & Google Drive Cloud Archival Matrix
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import {
    FiPlay, FiXCircle, FiRefreshCw, FiChevronDown, FiChevronUp, FiTrash2,
    FiAlertOctagon, FiCheck, FiPlus, FiClock, FiDatabase, FiKey,
    FiActivity, FiCloud, FiCopy, FiExternalLink, FiUploadCloud,
    FiShield, FiZap, FiSearch, FiLayers, FiTrendingUp, FiCpu, FiHardDrive,
    FiCheckCircle, FiTarget, FiSliders, FiCalendar
} from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import {
    startExtractionJob,
    fetchExtractionJobs,
    fetchExtractionJob,
    cancelExtractionJob,
    failExtractionJob,
    deleteExtractionJob,
    fetchSymbolList,
    fetchCoverageDetail,
    fetchGDriveCoverage,
    manualArchiveBatch
} from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";
import { SymbolLogo } from "../utils/symbolIcons";

const SOURCES = {
    dhan: { label: "Dhan API v2", dataTypes: ["option_chain"], mode: "year", fullYearOnly: true, note: "Primary source: 2023+ minute option chain plus index/equity/VIX spot and daily futures. A full calendar year is fetched per symbol with auto-cloud upload & disk space cleanup." },
    icici_breeze: { label: "ICICI Breeze", dataTypes: ["option_chain", "futures", "vix"], mode: "year", note: "Deep 2023+ history. Needs a fresh daily session — see Credentials." },
    upstox: { label: "Upstox", dataTypes: ["option_chain", "futures"], mode: "year", note: "Recent window only (~6-11 months back, confirmed live) — no daily login needed." },
    bhavcopy: { label: "NSE+BSE Bhavcopy", dataTypes: ["option_chain", "futures"], mode: "year", note: "Free, EOD-only contract/expiry discovery — the fast, no-auth half of the Breeze pipelines." },
    angelone: { label: "Angel One", dataTypes: ["option_chain", "futures"], mode: "recent", note: "Forward/recent catch-up only (current live contracts) — one symbol per request, or ALL for futures." },
    kotak: { label: "Kotak Neo", dataTypes: ["option_chain"], mode: "poll", note: "No historical API — takes ONE live snapshot to prove the pipeline." },
};

const DATA_TYPE_LABELS = {
    option_chain: "Option Chain",
    futures: "Futures",
    vix: "India VIX",
    india_vix: "India VIX",
    ohlcv: "Stocks OHLCV",
    bitcoin: "Bitcoin",
};

const MAJOR_INDICES_META = [
    { symbol: "NIFTY", name: "NIFTY 50", exchange: "NSE", type: "Index", tag: "Benchmark" },
    { symbol: "BANKNIFTY", name: "BANK NIFTY", exchange: "NSE", type: "Index", tag: "Banking" },
    { symbol: "FINNIFTY", name: "FIN NIFTY", exchange: "NSE", type: "Index", tag: "Financials" },
    { symbol: "MIDCPNIFTY", name: "MIDCAP NIFTY", exchange: "NSE", type: "Index", tag: "Midcap" },
    { symbol: "NIFTYNXT50", name: "NIFTY NEXT 50", exchange: "NSE", type: "Index", tag: "Largecap" },
    { symbol: "SENSEX", name: "BSE SENSEX", exchange: "BSE", type: "Index", tag: "30 Large" },
    { symbol: "BANKEX", name: "BSE BANKEX", exchange: "BSE", type: "Index", tag: "Banking" },
    { symbol: "INDIAVIX", name: "INDIA VIX", exchange: "NSE", type: "Volatility", tag: "Vol Index" },
    { symbol: "BTCUSDT", name: "BITCOIN", exchange: "Crypto", type: "Crypto", tag: "1-Min Tape" },
];

const POPULAR_FO_STOCKS = [
    "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "ITC",
    "SBIN", "BHARTIARTL", "KOTAKBANK", "LT", "TATAMOTORS", "BAJFINANCE"
];

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const STATUS_TONE = {
    queued: "bg-gray-500/15 text-gray-300",
    running: "bg-amber-500/15 text-amber-300",
    completed: "bg-emerald-500/15 text-emerald-300",
    failed: "bg-rose-500/15 text-rose-300",
    cancelled: "bg-gray-500/15 text-gray-400",
};

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatNumber(num) {
    if (!num) return "0";
    return Number(num).toLocaleString("en-IN");
}

function SymbolOptionRow({ sym, checked, mode, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-white/10 ${checked ? "text-emerald-300 font-bold" : "text-gray-300"}`}
        >
            {mode === "multi" && (
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${checked ? "border-emerald-500 bg-emerald-500" : "border-white/20"}`}>
                    {checked && <FiCheck className="h-2.5 w-2.5 text-white" />}
                </span>
            )}
            <SymbolLogo symbol={sym} size="xs" />
            <span className="font-mono text-xs font-semibold">{sym}</span>
        </button>
    );
}

function SymbolPicker({ symbolList, mode, value, onChange, allowAll, placeholder }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selected = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];

    const q = query.toLowerCase();
    const filteredIndices = (symbolList.indices || []).filter((s) => s.toLowerCase().includes(q));
    const filteredStocks = (symbolList.stocks || []).filter((s) => s.toLowerCase().includes(q));
    const trimmedQuery = query.trim().toUpperCase();
    const alreadyKnown = (symbolList.indices || []).includes(trimmedQuery) || (symbolList.stocks || []).includes(trimmedQuery);
    const customCandidate = trimmedQuery && !alreadyKnown && /^[A-Z0-9&.-]{1,20}$/.test(trimmedQuery) ? trimmedQuery : null;

    function toggle(sym) {
        if (mode === "single") {
            onChange(sym);
            setOpen(false);
            setQuery("");
            return;
        }
        const set = new Set(selected);
        if (set.has(sym)) set.delete(sym);
        else set.add(sym);
        onChange([...set].join(","));
    }

    function useAll() {
        onChange("ALL");
        setOpen(false);
    }

    const summary =
        value === "ALL"
            ? "ALL"
            : selected.length
                ? mode === "single"
                    ? selected[0]
                    : selected.length <= 3
                        ? selected.join(", ")
                        : `${selected.length} symbols selected`
                : placeholder;

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left font-mono text-sm text-white outline-none focus:border-violet-500"
            >
                <span className={`truncate ${selected.length || value === "ALL" ? "text-white font-semibold" : "text-gray-500"}`}>{summary}</span>
                <FiChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-1 flex max-h-80 w-72 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#101015] shadow-xl">
                        <div className="border-b border-white/10 p-2">
                            <input
                                autoFocus
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search symbol…"
                                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        {(mode === "multi" || allowAll) && (
                            <div className="flex items-center justify-between border-b border-white/10 px-2 py-1.5 text-[11px]">
                                {mode === "multi" ? (
                                    <button type="button" onClick={() => onChange("")} className="text-gray-400 hover:text-gray-200">
                                        Clear{selected.length ? ` (${selected.length})` : ""} — blank = all known
                                    </button>
                                ) : <span />}
                                {allowAll && (
                                    <button type="button" onClick={useAll} className="font-semibold text-violet-400 hover:text-violet-300">
                                        Use ALL
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="overflow-y-auto">
                            {filteredIndices.length > 0 && (
                                <div>
                                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-gray-500">Index</div>
                                    {filteredIndices.map((s) => (
                                        <SymbolOptionRow key={s} sym={s} checked={selected.includes(s)} mode={mode} onClick={() => toggle(s)} />
                                    ))}
                                </div>
                            )}
                            {filteredStocks.length > 0 && (
                                <div>
                                    <div className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-gray-500">Stocks</div>
                                    {filteredStocks.map((s) => (
                                        <SymbolOptionRow key={s} sym={s} checked={selected.includes(s)} mode={mode} onClick={() => toggle(s)} />
                                    ))}
                                </div>
                            )}
                            {customCandidate && (
                                <div className="border-t border-white/10">
                                    <button
                                        type="button"
                                        onClick={() => { toggle(customCandidate); setQuery(""); }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-violet-300 hover:bg-white/10"
                                    >
                                        <FiPlus className="h-3 w-3 shrink-0" />
                                        Use <span className="font-mono font-semibold">"{customCandidate}"</span>
                                        <span className="ml-auto text-[10px] text-gray-500">custom symbol</span>
                                    </button>
                                </div>
                            )}
                            {!filteredIndices.length && !filteredStocks.length && !customCandidate && (
                                <div className="px-3 py-6 text-center text-xs text-gray-500">No matches</div>
                            )}
                        </div>
                        {mode === "multi" && (
                            <div className="border-t border-white/10 p-2">
                                <button type="button" onClick={() => setOpen(false)} className="w-full rounded-md bg-violet-600 py-1.5 text-xs font-bold text-white hover:bg-violet-700">
                                    Done
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function isAuthFailureLog(text) {
    if (!text) return false;
    return /401|auth preflight failed|invalid or expired|Invalid_Authentication|DH-901|DHAN_ACCESS_TOKEN|access token is invalid/i.test(text);
}

function JobRow({ job, onCancel, onFail, onDelete }) {
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState(null);
    const { token } = useAdminAuth();

    async function toggle() {
        if (!open && !detail) {
            try {
                const r = await fetchExtractionJob(token, job.id);
                setDetail(r.job);
            } catch { /* show what we have */ }
        }
        setOpen((v) => !v);
    }

    const isAuthErr = isAuthFailureLog(job.summary) || isAuthFailureLog(detail?.logTail);

    return (
        <div className="rounded-xl border border-white/5 bg-white/5 overflow-hidden">
            <button onClick={toggle} className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left hover:bg-white/5 transition">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[job.status] || "bg-gray-500/15 text-gray-300"}`}>{job.status}</span>
                        <span className="text-sm font-bold text-gray-200">{SOURCES[job.source]?.label || job.source}</span>
                        <span className="text-xs text-gray-400">· {DATA_TYPE_LABELS[job.data_type] || job.data_type}</span>
                        {job.year && <span className="text-xs text-violet-300 font-semibold">· {job.year}{job.from_month ? ` (${job.from_month}-${job.to_month || job.from_month})` : ""}</span>}
                        {job.symbols && <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded">· {job.symbols}</span>}
                        {isAuthErr && (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                                🔑 Token Expired
                            </span>
                        )}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-gray-500">{job.command}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {job.status === "running" && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onCancel(job.id); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20"
                        >
                            <FiXCircle className="h-3.5 w-3.5" /> Cancel
                        </button>
                    )}
                    {["queued", "running"].includes(job.status) && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onFail(job.id); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                        >
                            <FiAlertOctagon className="h-3.5 w-3.5" /> Mark Failed
                        </button>
                    )}
                    {TERMINAL_STATUSES.includes(job.status) && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(job.id); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-gray-400 hover:bg-white/10 hover:text-gray-200"
                        >
                            <FiTrash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                    )}
                    {open ? <FiChevronUp className="h-4 w-4 text-gray-500" /> : <FiChevronDown className="h-4 w-4 text-gray-500" />}
                </div>
            </button>
            {open && (
                <div className="border-t border-white/5 px-3.5 py-3 bg-black/20">
                    {isAuthErr && (
                        <div className="mb-3 flex items-center justify-between rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                            <div>
                                <span className="font-bold">Authentication / Token Expired:</span> The broker rejected your request with HTTP 401. Generate a new token and update it in Credentials.
                            </div>
                            <Link
                                to="/data-settings"
                                className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-rose-500"
                            >
                                <FiKey className="h-3.5 w-3.5" /> Update in Credentials
                            </Link>
                        </div>
                    )}
                    {job.summary && <div className="mb-2 whitespace-pre-wrap font-mono text-[11px] text-gray-400">{job.summary}</div>}
                    <pre className="max-h-64 overflow-auto rounded-xl bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-gray-300 border border-white/5">
                        {detail?.logTail || "loading log…"}
                    </pre>
                </div>
            )}
        </div>
    );
}

function LiveExtractionMonitor({ jobs, onCancel, onFail, onRefresh }) {
    const { token } = useAdminAuth();
    const [activeDetail, setActiveDetail] = useState(null);
    const [copied, setCopied] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const logContainerRef = useRef(null);

    const runningJob = jobs?.find((j) => j.status === "running" || j.status === "queued");
    const activeJob = runningJob || jobs?.[0];

    useEffect(() => {
        if (!activeJob) {
            setActiveDetail(null);
            return;
        }

        let isMounted = true;
        const fetchDetail = async () => {
            try {
                const res = await fetchExtractionJob(token, activeJob.id);
                if (isMounted && res?.job) {
                    setActiveDetail(res.job);
                }
            } catch {
                // Ignore network blips during polling
            }
        };

        fetchDetail();
        const interval = setInterval(fetchDetail, activeJob.status === "running" ? 2000 : 6000);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [activeJob?.id, activeJob?.status, token]);

    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [activeDetail?.logTail, autoScroll]);

    function handleCopy() {
        if (!activeDetail?.logTail) return;
        navigator.clipboard.writeText(activeDetail.logTail);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    if (!activeJob) return null;

    const isRunning = activeJob.status === "running" || activeJob.status === "queued";
    const logLines = activeDetail?.logTail ? activeDetail.logTail.split("\n") : ["Connecting to pipeline stream..."];

    return (
        <div className="rounded-2xl border border-white/10 bg-[#0d0e15] p-4 sm:p-5 shadow-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        {isRunning && (
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        )}
                        <span className={`relative inline-flex rounded-full h-3 w-3 ${isRunning ? "bg-emerald-500" : "bg-gray-500"}`}></span>
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-white font-mono">
                        {isRunning ? "LIVE PIPELINE ACTIVE" : "LAST PIPELINE SESSION"}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE[activeJob.status] || "bg-gray-500/20 text-gray-300"}`}>
                        {activeJob.status}
                    </span>
                    <span className="text-xs text-gray-400 font-mono hidden sm:inline">
                        · {SOURCES[activeJob.source]?.label || activeJob.source} ({DATA_TYPE_LABELS[activeJob.data_type] || activeJob.data_type})
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setAutoScroll((v) => !v)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold border transition ${autoScroll ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-white/5 border-white/10 text-gray-400"}`}
                        title="Auto-scroll to latest log output"
                    >
                        Auto-Scroll {autoScroll ? "ON" : "OFF"}
                    </button>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-gray-300 hover:bg-white/10"
                    >
                        {copied ? <FiCheck className="text-emerald-400" /> : <FiCopy />} {copied ? "Copied" : "Copy Log"}
                    </button>
                    {isRunning && (
                        <button
                            type="button"
                            onClick={() => onCancel(activeJob.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/20 px-3 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/30 shadow-sm"
                        >
                            <FiXCircle /> Stop Process
                        </button>
                    )}
                </div>
            </div>

            <div className="relative rounded-xl border border-emerald-500/20 bg-[#040508] shadow-inner overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5 text-[11px] text-gray-400 font-mono">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-rose-500/80 inline-block"></span>
                        <span className="h-2 w-2 rounded-full bg-amber-500/80 inline-block"></span>
                        <span className="h-2 w-2 rounded-full bg-emerald-500/80 inline-block"></span>
                        <span className="ml-2 text-emerald-400 font-semibold">process_stdout.log</span>
                    </span>
                    <span className="text-[10px] text-gray-500">PID: {activeJob.pid || "Active"} · Updated live (2s polling)</span>
                </div>
                <div
                    ref={logContainerRef}
                    className="p-3.5 max-h-80 overflow-y-auto font-mono text-xs leading-relaxed space-y-0.5 select-text"
                >
                    {logLines.map((line, idx) => {
                        let colorClass = "text-gray-300";
                        if (line.includes("[ERROR]") || line.includes("failed") || line.includes("ERR") || line.includes("401") || line.includes("404")) {
                            colorClass = "text-rose-400 font-semibold";
                        } else if (line.includes("[AutoGDrive]") || line.includes("ArchivalPipeline") || line.includes("✅") || line.includes("Uploaded")) {
                            colorClass = "text-emerald-400 font-semibold";
                        } else if (line.includes("[Watchdog]") || line.includes("Restarting") || line.includes("auto-restart")) {
                            colorClass = "text-indigo-400 font-bold";
                        } else if (line.includes("[bhavcopy]") || line.includes("[discovery]") || line.includes("downloading")) {
                            colorClass = "text-cyan-300";
                        } else if (line.includes("[enrich]") || line.includes("budget") || line.includes("WARN") || line.includes("⚠")) {
                            colorClass = "text-amber-300";
                        } else if (line.startsWith("===") || line.startsWith("========")) {
                            colorClass = "text-violet-300 font-bold";
                        }

                        return (
                            <div key={idx} className={`flex gap-3 hover:bg-white/5 px-1 rounded ${colorClass}`}>
                                <span className="text-gray-600 select-none text-[10px] w-6 text-right shrink-0">{idx + 1}</span>
                                <span className="break-all">{line}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function DataExtraction() {
    const { token } = useAdminAuth();
    const [scopeMode, setScopeMode] = useState("specific"); // "specific" | "universe" | "single_date"
    const [source, setSource] = useState("dhan");
    const [dataType, setDataType] = useState("option_chain");
    const [year, setYear] = useState(2023);
    const [toYear, setToYear] = useState(2024);
    const [singleDate, setSingleDate] = useState("");
    const [fromLetter, setFromLetter] = useState("");
    const [toLetter, setToLetter] = useState("");
    const [autoGdrive, setAutoGdrive] = useState(true);
    const [autoRestart, setAutoRestart] = useState(true);
    const [fromMonth, setFromMonth] = useState("");
    const [toMonth, setToMonth] = useState("");
    const [symbols, setSymbols] = useState("NIFTY");
    const [extraArgs, setExtraArgs] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [actionMessage, setActionMessage] = useState(null);
    const [jobs, setJobs] = useState(null);
    const [symbolList, setSymbolList] = useState({ indices: [], stocks: [] });
    const [coverage, setCoverage] = useState(null);
    const [coverageLoading, setCoverageLoading] = useState(false);

    // Google Drive & Local Extraction Matrix State
    const [coverageData, setCoverageData] = useState(null);
    const [coverageMatrixLoading, setCoverageMatrixLoading] = useState(false);
    const [matrixCategoryTab, setMatrixCategoryTab] = useState("all");
    const [matrixStatusFilter, setMatrixStatusFilter] = useState("all"); // "all" | "gdrive_archived" | "local_db" | "pending"
    const [matrixSearchQuery, setMatrixSearchQuery] = useState("");
    const [matrixPage, setMatrixPage] = useState(1);
    const [matrixPageSize, setMatrixPageSize] = useState(25);
    const [pushingBatch, setPushingBatch] = useState({});

    const meta = SOURCES[source];

    // Load Symbol List
    useEffect(() => {
        fetchSymbolList()
            .then((r) => setSymbolList({ indices: r.indices || [], stocks: r.stocks || [] }))
            .catch(() => {});
    }, []);

    // Load Jobs
    const loadJobs = useCallback(() => {
        fetchExtractionJobs(token).then((r) => setJobs(r.jobs)).catch((err) => setError(err.message));
    }, [token]);

    // Load Coverage Matrix
    const loadCoverageMatrix = useCallback(() => {
        if (!token) return;
        setCoverageMatrixLoading(true);
        fetchGDriveCoverage(token)
            .then((res) => {
                setCoverageData(res);
            })
            .catch((err) => console.warn("Failed to load coverage matrix:", err.message))
            .finally(() => setCoverageMatrixLoading(false));
    }, [token]);

    useEffect(() => {
        loadJobs();
        loadCoverageMatrix();
        const id = setInterval(() => {
            loadJobs();
        }, 8000);
        return () => clearInterval(id);
    }, [loadJobs, loadCoverageMatrix]);

    const coverageSymbol = symbols.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean).length === 1
        ? symbols.trim().toUpperCase()
        : null;
    const coverageType = dataType;

    const loadCoverage = useCallback(() => {
        if (meta.mode !== "year" || !coverageSymbol || coverageSymbol === "ALL") {
            setCoverage(null);
            return Promise.resolve();
        }
        setCoverageLoading(true);
        return fetchCoverageDetail(token, coverageType, coverageSymbol)
            .then((result) => setCoverage(result.months || []))
            .catch((err) => setError(err.message))
            .finally(() => setCoverageLoading(false));
    }, [token, meta.mode, coverageSymbol, coverageType]);

    useEffect(() => {
        if (meta.mode !== "year" || !coverageSymbol) return undefined;
        const initial = setTimeout(loadCoverage, 0);
        const id = setInterval(loadCoverage, 8000);
        return () => { clearTimeout(initial); clearInterval(id); };
    }, [loadCoverage, meta.mode, coverageSymbol]);

    function handleSourceChange(newSource) {
        setSource(newSource);
        if (SOURCES[newSource].fullYearOnly) {
            setFromMonth("");
            setToMonth("");
        }
        if (!SOURCES[newSource].dataTypes.includes(dataType)) setDataType(SOURCES[newSource].dataTypes[0]);
    }

    // Quick select an index or specific asset
    function handleSelectIndexQuick(sym) {
        setScopeMode("specific");
        setSymbols(sym);
        if (sym === "INDIAVIX") {
            setDataType("vix");
            setSource("icici_breeze");
        } else if (sym === "BTCUSDT") {
            setDataType("option_chain");
            setSource("dhan");
        } else {
            setDataType("option_chain");
            setSource("dhan");
        }
        setActionMessage(`🎯 Selected ${sym}! Choose target year and click "Start Extraction".`);
    }

    function handleAddAllIndices() {
        setScopeMode("specific");
        setSymbols("NIFTY,BANKNIFTY,FINNIFTY,MIDCPNIFTY,NIFTYNXT50,SENSEX,BANKEX");
        setDataType("option_chain");
        setSource("dhan");
        setActionMessage("🎯 Selected all 7 Major Indices (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50, SENSEX, BANKEX).");
    }

    function handleAddTopStocks() {
        setScopeMode("specific");
        setSymbols(POPULAR_FO_STOCKS.join(","));
        setDataType("option_chain");
        setSource("dhan");
        setActionMessage("🎯 Selected Top 12 High-Volume F&O Stocks.");
    }

    function applyPreset(pSource, pDataType, pYear, pToYear, pFromLetter, pToLetter) {
        setScopeMode("universe");
        setSource(pSource);
        setDataType(pDataType);
        setYear(pYear);
        setToYear(pToYear);
        setFromLetter(pFromLetter);
        setToLetter(pToLetter);
        setSymbols("");
        setAutoGdrive(true);
        setAutoRestart(true);
        setFromMonth("");
        setToMonth("");
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        setActionMessage(null);
        try {
            const symParam = scopeMode === "universe" ? (symbols.trim() || undefined) : symbols.trim();
            await startExtractionJob(token, {
                source,
                dataType,
                symbols: symParam || undefined,
                year: meta.mode === "year" ? Number(year) : undefined,
                toYear: meta.mode === "year" && toYear ? Number(toYear) : undefined,
                date: scopeMode === "single_date" && singleDate ? singleDate : undefined,
                fromLetter: scopeMode === "universe" && fromLetter ? fromLetter : undefined,
                toLetter: scopeMode === "universe" && toLetter ? toLetter : undefined,
                autoGdrive: Boolean(autoGdrive),
                autoRestart: Boolean(autoRestart),
                fromMonth: meta.mode === "year" && fromMonth ? Number(fromMonth) : undefined,
                toMonth: meta.mode === "year" && toMonth ? Number(toMonth) : undefined,
                extraArgs: extraArgs.trim() || undefined,
            });
            setActionMessage(`🚀 Extraction pipeline launched for ${symbols || "Universe"}! Auto-GDrive sync & Watchdog Auto-Restart are active.`);
            loadJobs();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleCancel(id) {
        try {
            await cancelExtractionJob(token, id);
            loadJobs();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleFail(id) {
        try {
            await failExtractionJob(token, id);
            loadJobs();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDelete(id) {
        if (!window.confirm("Delete this job's record and log permanently? This can't be undone.")) return;
        try {
            await deleteExtractionJob(token, id);
            loadJobs();
        } catch (err) {
            setError(err.message);
        }
    }

    // 1-Click Push to Google Drive from Extraction Matrix
    async function handlePushToDrive(catKey, sym, yr) {
        const key = `${catKey}_${sym}_${yr}`;
        setPushingBatch((prev) => ({ ...prev, [key]: true }));
        try {
            const res = await manualArchiveBatch(token, { dataType: catKey, symbol: sym, year: yr, autoPrune: true });
            setActionMessage(`✅ Successfully archived [${catKey.toUpperCase()}] ${sym} (${yr}) to Google Drive! (${formatBytes(res.fileSize)})`);
            loadCoverageMatrix();
        } catch (err) {
            setError(`Failed to push ${sym} to Google Drive: ${err.message}`);
        } finally {
            setPushingBatch((prev) => ({ ...prev, [key]: false }));
        }
    }

    // Populate form to extract a specific symbol
    function handleSelectSymbolForFetch(sym, yr, catKey) {
        setScopeMode("specific");
        setSymbols(sym);
        if (yr) {
            setYear(Number(yr));
            setToYear(Number(yr));
        }
        if (catKey === "futures") {
            setDataType("futures");
            if (source === "dhan") setSource("icici_breeze");
        } else if (catKey === "india_vix") {
            setDataType("vix");
            setSource("icici_breeze");
        } else {
            setDataType("option_chain");
            setSource("dhan");
        }
        setActionMessage(`🎯 Loaded ${sym} (${yr || "All"}). Adjust settings and click "Start Pipeline".`);
        window.scrollTo({ top: 380, behavior: "smooth" });
    }

    // Filter Coverage Matrix Items
    const filteredMatrix = useMemo(() => {
        if (!coverageData?.matrix) return [];
        return coverageData.matrix.filter((item) => {
            const matchesQuery =
                !matrixSearchQuery.trim() ||
                item.symbol.toLowerCase().includes(matrixSearchQuery.toLowerCase()) ||
                (item.name && item.name.toLowerCase().includes(matrixSearchQuery.toLowerCase()));

            const matchesCategory = matrixCategoryTab === "all" || item.category === matrixCategoryTab;
            if (!matchesQuery || !matchesCategory) return false;

            if (matrixStatusFilter === "all") return true;

            const yearEntries = Object.values(item.years || {});
            if (matrixStatusFilter === "gdrive_archived") {
                return yearEntries.some((y) => y.status === "gdrive_archived");
            }
            if (matrixStatusFilter === "local_db") {
                return yearEntries.some((y) => y.status === "local_db" && y.localCount > 0);
            }
            if (matrixStatusFilter === "pending") {
                return yearEntries.some((y) => y.status === "pending");
            }

            return true;
        });
    }, [coverageData?.matrix, matrixSearchQuery, matrixCategoryTab, matrixStatusFilter]);

    // Pagination for matrix
    const totalMatrixPages = useMemo(() => {
        if (matrixPageSize === "all") return 1;
        return Math.max(1, Math.ceil(filteredMatrix.length / Number(matrixPageSize)));
    }, [filteredMatrix.length, matrixPageSize]);

    const paginatedMatrix = useMemo(() => {
        if (matrixPageSize === "all") return filteredMatrix;
        const size = Number(matrixPageSize);
        const start = (matrixPage - 1) * size;
        return filteredMatrix.slice(start, start + size);
    }, [filteredMatrix, matrixPage, matrixPageSize]);

    // Aggregate summary stats
    const matrixStats = useMemo(() => {
        let totalArchivedBatches = 0;
        let totalLocalDbBatches = 0;
        let totalArchivedBytes = 0;

        (coverageData?.matrix || []).forEach((item) => {
            Object.values(item.years || {}).forEach((y) => {
                if (y.status === "gdrive_archived") {
                    totalArchivedBatches++;
                    totalArchivedBytes += y.cloudSizeBytes || 0;
                } else if (y.status === "local_db" && y.localCount > 0) {
                    totalLocalDbBatches++;
                }
            });
        });

        return {
            totalSymbols: coverageData?.availableSymbols?.length || 272,
            totalArchivedBatches,
            totalLocalDbBatches,
            totalArchivedBytes,
        };
    }, [coverageData]);

    return (
        <div className="min-h-screen bg-[#08080b] text-gray-100 pb-16">
            <DataNavHeader
                title="Historical Data Extraction & Cloud Archival"
                subtitle="Fetch 1-Minute minute option chain, spot, & futures data for specific Indices or Stocks with live watchdog auto-restart & auto-Google Drive push."
            />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-5">
                {error && (
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium flex items-center justify-between">
                        <span>{error}</span>
                        <button onClick={() => setError(null)} className="text-gray-400 hover:text-white">✕</button>
                    </div>
                )}
                {actionMessage && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-medium flex items-center justify-between">
                        <span>{actionMessage}</span>
                        <button onClick={() => setActionMessage(null)} className="text-gray-400 hover:text-white">✕</button>
                    </div>
                )}

                {/* Top Status & Capabilities Ribbon */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-gray-400 text-xs font-medium">
                            <span>Tracked Universe</span>
                            <FiDatabase className="text-violet-400" />
                        </div>
                        <div className="text-xl font-bold text-white">{matrixStats.totalSymbols} <span className="text-xs font-normal text-gray-400">symbols</span></div>
                        <div className="text-[11px] text-gray-500">7 Indices + 210+ F&O Stocks</div>
                    </div>

                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-emerald-400 text-xs font-medium">
                            <span>Archived in Drive</span>
                            <FiCloud className="text-emerald-400" />
                        </div>
                        <div className="text-xl font-bold text-emerald-300">{matrixStats.totalArchivedBatches} <span className="text-xs font-normal text-emerald-400/70">batches</span></div>
                        <div className="text-[11px] text-emerald-400/80">{formatBytes(matrixStats.totalArchivedBytes)} compressed</div>
                    </div>

                    <div className="rounded-2xl border border-indigo-500/20 bg-indigo-950/20 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-indigo-400 text-xs font-medium">
                            <span>Auto-Restart Watchdog</span>
                            <FiShield className="text-indigo-400" />
                        </div>
                        <div className="text-xl font-bold text-indigo-300">ACTIVE <span className="text-xs font-normal text-indigo-400/70">5 Retries</span></div>
                        <div className="text-[11px] text-indigo-400/80">Auto-recovery on disconnect</div>
                    </div>

                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-950/20 p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-cyan-400 text-xs font-medium">
                            <span>Immediate Auto-Prune</span>
                            <FiZap className="text-cyan-400" />
                        </div>
                        <div className="text-xl font-bold text-cyan-300">ENABLED</div>
                        <div className="text-[11px] text-cyan-400/80">Reclaims disk on fetch finish</div>
                    </div>
                </div>

                {/* 🌟 1-CLICK QUICK EXTRACT: MAJOR INDICES & KEY ASSETS */}
                <div className="rounded-2xl border border-violet-500/30 bg-[#0e0e17] p-4 sm:p-5 shadow-xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                                <FiTarget className="text-violet-400" />
                                🎯 1-Click Quick Extract: Major Indices & Specific Assets
                            </h3>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Select any index or symbol below to immediately focus the pipeline on that specific asset.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleAddAllIndices}
                                className="inline-flex items-center gap-1 text-[11px] font-bold bg-violet-600/30 hover:bg-violet-600/50 text-violet-200 border border-violet-500/30 px-2.5 py-1 rounded-lg transition"
                            >
                                <FiPlus className="h-3 w-3" /> Select All 7 Indices
                            </button>
                            <button
                                type="button"
                                onClick={handleAddTopStocks}
                                className="inline-flex items-center gap-1 text-[11px] font-bold bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/30 px-2.5 py-1 rounded-lg transition"
                            >
                                <FiPlus className="h-3 w-3" /> Select Top 12 Stocks
                            </button>
                        </div>
                    </div>

                    {/* Quick Index Tiles Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
                        {MAJOR_INDICES_META.map((idx) => {
                            const isSelected = symbols.split(",").map(s => s.trim().toUpperCase()).includes(idx.symbol);
                            return (
                                <button
                                    key={idx.symbol}
                                    type="button"
                                    onClick={() => handleSelectIndexQuick(idx.symbol)}
                                    className={`group flex flex-col items-center justify-center p-2.5 rounded-xl border transition text-center ${
                                        isSelected
                                            ? "border-emerald-500 bg-emerald-950/40 text-emerald-300 ring-2 ring-emerald-500/30 shadow-md"
                                            : "border-white/10 bg-white/5 hover:border-violet-500/40 hover:bg-white/10 text-gray-300"
                                    }`}
                                >
                                    <SymbolLogo symbol={idx.symbol} size="sm" />
                                    <div className="mt-1.5 font-bold font-mono text-xs">{idx.symbol}</div>
                                    <div className="text-[10px] text-gray-400 truncate max-w-full">{idx.name}</div>
                                    <span className="mt-1 text-[9px] font-semibold px-1.5 py-0.2 rounded bg-white/10 text-gray-400 group-hover:text-white">
                                        {idx.tag}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Popular Stocks Quick Chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/5 text-xs">
                        <span className="text-gray-400 text-[11px] font-medium mr-1">Popular F&O Stocks:</span>
                        {POPULAR_FO_STOCKS.map((stk) => {
                            const isSelected = symbols.split(",").map(s => s.trim().toUpperCase()).includes(stk);
                            return (
                                <button
                                    key={stk}
                                    type="button"
                                    onClick={() => {
                                        setScopeMode("specific");
                                        setSymbols(stk);
                                        setDataType("option_chain");
                                        setSource("dhan");
                                    }}
                                    className={`px-2 py-0.5 rounded-lg border text-[11px] font-mono font-semibold transition ${
                                        isSelected
                                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                                            : "border-white/10 bg-white/5 hover:bg-white/10 text-gray-300"
                                    }`}
                                >
                                    {stk}
                                </button>
                            );
                        })}
                        {symbols && (
                            <button
                                type="button"
                                onClick={() => setSymbols("")}
                                className="text-[11px] text-gray-500 hover:text-gray-300 underline ml-2"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>

                {/* Live Extraction Monitor */}
                <LiveExtractionMonitor
                    jobs={jobs}
                    onCancel={handleCancel}
                    onFail={handleFail}
                    onRefresh={loadJobs}
                />

                {/* Extraction Request Form */}
                <Card
                    title={
                        <div className="flex items-center justify-between w-full">
                            <span className="flex items-center gap-2">
                                <FiSliders className="text-violet-400" />
                                Extraction Configuration
                            </span>
                            {/* Scope Mode Switcher */}
                            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setScopeMode("specific")}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                                        scopeMode === "specific"
                                            ? "bg-violet-600 text-white shadow-sm"
                                            : "text-gray-400 hover:text-white"
                                    }`}
                                >
                                    🎯 Specific Symbol(s)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScopeMode("universe")}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                                        scopeMode === "universe"
                                            ? "bg-violet-600 text-white shadow-sm"
                                            : "text-gray-400 hover:text-white"
                                    }`}
                                >
                                    🌐 Universe (A → Z)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setScopeMode("single_date")}
                                    className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                                        scopeMode === "single_date"
                                            ? "bg-violet-600 text-white shadow-sm"
                                            : "text-gray-400 hover:text-white"
                                    }`}
                                >
                                    📅 Single Date Force
                                </button>
                            </div>
                        </div>
                    }
                >
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-end gap-3">
                            <div className="w-full sm:w-auto sm:min-w-40">
                                <label className="mb-1 block text-xs font-medium text-gray-400">Data Source</label>
                                <select
                                    value={source}
                                    onChange={(e) => handleSourceChange(e.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500 font-semibold"
                                >
                                    {Object.entries(SOURCES).map(([k, v]) => (
                                        <option key={k} value={k} className="bg-[#12121a]">
                                            {v.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="w-full sm:w-auto sm:min-w-35">
                                <label className="mb-1 block text-xs font-medium text-gray-400">Data Type</label>
                                <select
                                    value={dataType}
                                    onChange={(e) => setDataType(e.target.value)}
                                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500 font-semibold"
                                >
                                    {meta.dataTypes.map((dt) => (
                                        <option key={dt} value={dt} className="bg-[#12121a]">
                                            {DATA_TYPE_LABELS[dt]}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Mode A: Specific Symbol */}
                            {scopeMode === "specific" && (
                                <>
                                    <div className="w-full sm:flex-1 sm:min-w-60">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">
                                            Target Symbol(s) <span className="text-violet-400 font-bold">(e.g. NIFTY, BANKNIFTY, RELIANCE)</span>
                                        </label>
                                        <SymbolPicker
                                            symbolList={symbolList}
                                            mode="multi"
                                            value={symbols}
                                            onChange={setSymbols}
                                            allowAll={true}
                                            placeholder="Type or select symbol…"
                                        />
                                    </div>

                                    <div className="w-full sm:w-28">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">Target Year</label>
                                        <input
                                            type="number"
                                            min="2015"
                                            max="2100"
                                            value={year}
                                            onChange={(e) => {
                                                setYear(e.target.value);
                                                setToYear(e.target.value);
                                            }}
                                            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500 font-bold font-mono"
                                        />
                                    </div>

                                    <div className="w-full sm:w-28">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">To Year (Optional)</label>
                                        <input
                                            type="number"
                                            min="2015"
                                            max="2100"
                                            value={toYear}
                                            onChange={(e) => setToYear(e.target.value)}
                                            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500 font-bold font-mono"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Mode B: Universe A to Z */}
                            {scopeMode === "universe" && (
                                <>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">From Year</label>
                                        <input type="number" min="2015" max="2100" value={year} onChange={(e) => setYear(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500 font-mono" />
                                    </div>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">To Year</label>
                                        <input type="number" min="2015" max="2100" value={toYear} onChange={(e) => setToYear(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500 font-mono" />
                                    </div>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">From Letter</label>
                                        <select value={fromLetter} onChange={(e) => setFromLetter(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                            <option value="">A</option>
                                            {LETTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">To Letter</label>
                                        <select value={toLetter} onChange={(e) => setToLetter(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                            <option value="">Z</option>
                                            {LETTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                </>
                            )}

                            {/* Mode C: Single Date */}
                            {scopeMode === "single_date" && (
                                <>
                                    <div className="w-full sm:flex-1 sm:min-w-48">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">Symbol</label>
                                        <SymbolPicker
                                            symbolList={symbolList}
                                            mode="single"
                                            value={symbols}
                                            onChange={setSymbols}
                                            placeholder="Select symbol…"
                                        />
                                    </div>
                                    <div className="w-full sm:w-44">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">Specific Date (YYYY-MM-DD)</label>
                                        <input
                                            type="date"
                                            value={singleDate}
                                            onChange={(e) => setSingleDate(e.target.value)}
                                            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500 font-mono"
                                        />
                                    </div>
                                </>
                            )}

                            <button
                                type="submit"
                                disabled={submitting || (scopeMode === "specific" && !symbols.trim())}
                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-2.5 text-xs sm:text-sm font-bold text-white hover:from-violet-500 hover:to-indigo-500 transition disabled:opacity-50 shadow-md shadow-violet-600/30"
                            >
                                <FiPlay className="h-4 w-4" /> {submitting ? "Starting…" : `Start Extraction (${symbols || "Universe"})`}
                            </button>
                        </div>

                        {/* Toggles Bar */}
                        <div className="flex flex-wrap items-center gap-5 pt-3 border-t border-white/5">
                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={autoGdrive}
                                    onChange={(e) => setAutoGdrive(e.target.checked)}
                                    className="h-4 w-4 rounded border-white/20 bg-white/5 text-violet-600 focus:ring-0 focus:ring-offset-0"
                                />
                                <span className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                                    <FiCloud className="text-emerald-400" /> Auto-Upload to Google Drive & Free Local MySQL Disk
                                </span>
                            </label>

                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={autoRestart}
                                    onChange={(e) => setAutoRestart(e.target.checked)}
                                    className="h-4 w-4 rounded border-white/20 bg-white/5 text-indigo-600 focus:ring-0 focus:ring-offset-0"
                                />
                                <span className="text-xs font-semibold text-gray-200 flex items-center gap-1.5">
                                    <FiShield className="text-indigo-400" /> Watchdog Supervisor: Auto-Restart on Interruption / Network Drop
                                </span>
                            </label>
                        </div>
                    </form>
                    <div className={`mt-2 text-xs ${meta.fullYearOnly ? "text-amber-300" : "text-gray-500"}`}>{meta.note}</div>
                </Card>

                {/* Symbol Extraction & Google Drive Archival Matrix Table */}
                <div className="rounded-2xl border border-white/10 bg-[#0d0e15] p-4 sm:p-6 shadow-xl space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pb-3 border-b border-white/10">
                        <div>
                            <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                                <FiDatabase className="text-violet-400" />
                                Extracted Symbols & Google Drive Archival Status
                            </h3>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Real-time status of all {matrixStats.totalSymbols} symbols: click "+ Extract" on any row to fetch that symbol directly.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" />
                                <input
                                    type="text"
                                    placeholder="Search symbol (e.g. NIFTY)…"
                                    value={matrixSearchQuery}
                                    onChange={(e) => {
                                        setMatrixSearchQuery(e.target.value);
                                        setMatrixPage(1);
                                    }}
                                    className="rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-violet-500 w-40 sm:w-56"
                                />
                            </div>

                            <button
                                type="button"
                                onClick={loadCoverageMatrix}
                                disabled={coverageMatrixLoading}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-white/10 transition"
                            >
                                <FiRefreshCw className={`h-3.5 w-3.5 ${coverageMatrixLoading ? "animate-spin" : ""}`} />
                                Refresh Status
                            </button>
                        </div>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                            {[
                                { key: "all", label: "All Assets", icon: FiDatabase },
                                { key: "option_chain", label: "Option Chain", icon: FiLayers },
                                { key: "futures", label: "Futures", icon: FiTrendingUp },
                                { key: "ohlcv", label: "Stocks OHLCV", icon: FiDatabase },
                                { key: "india_vix", label: "India VIX", icon: FiCpu },
                            ].map((tab) => {
                                const Icon = tab.icon;
                                const isActive = matrixCategoryTab === tab.key;
                                return (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={() => {
                                            setMatrixCategoryTab(tab.key);
                                            setMatrixPage(1);
                                        }}
                                        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                                            isActive
                                                ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                                                : "bg-white/5 border border-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                                        }`}
                                    >
                                        <Icon className="h-3.5 w-3.5" /> {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex items-center gap-2">
                            <select
                                value={matrixStatusFilter}
                                onChange={(e) => {
                                    setMatrixStatusFilter(e.target.value);
                                    setMatrixPage(1);
                                }}
                                className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-violet-500"
                            >
                                <option value="all">All Statuses</option>
                                <option value="gdrive_archived">🟢 Archived in Drive</option>
                                <option value="local_db">🔵 In Local DB (Needs Push)</option>
                                <option value="pending">⚪ Pending Extraction</option>
                            </select>

                            <select
                                value={matrixPageSize}
                                onChange={(e) => {
                                    setMatrixPageSize(e.target.value === "all" ? "all" : Number(e.target.value));
                                    setMatrixPage(1);
                                }}
                                className="rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 outline-none focus:border-violet-500"
                            >
                                <option value={25}>25 / page</option>
                                <option value={50}>50 / page</option>
                                <option value={100}>100 / page</option>
                                <option value="all">All</option>
                            </select>
                        </div>
                    </div>

                    {/* Matrix Table */}
                    <div className="overflow-x-auto rounded-xl border border-white/5">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-white/10 bg-white/5 text-gray-400 uppercase text-[10px] tracking-wider font-semibold">
                                    <th className="py-3 px-3">Symbol & Category</th>
                                    <th className="py-3 px-2 text-center">Type</th>
                                    <th className="py-3 px-2 text-center">2023</th>
                                    <th className="py-3 px-2 text-center">2024</th>
                                    <th className="py-3 px-2 text-center">2025</th>
                                    <th className="py-3 px-2 text-center">2026</th>
                                    <th className="py-3 px-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 font-mono">
                                {paginatedMatrix.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="py-8 text-center text-gray-500 text-xs">
                                            {coverageMatrixLoading ? "Loading extraction status..." : "No symbols matching current filters."}
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedMatrix.map((item, idx) => {
                                        const isIndex = item.type === "index";
                                        const isVol = item.type === "volatility";
                                        const typeBadgeClass = isIndex
                                            ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                                            : isVol
                                            ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-300"
                                            : "bg-blue-500/10 border-blue-500/20 text-blue-300";

                                        return (
                                            <tr key={`${item.category}_${item.symbol}_${idx}`} className="hover:bg-white/5 transition-colors">
                                                <td className="py-2.5 px-3">
                                                    <div className="flex items-center gap-2.5 font-sans">
                                                        <SymbolLogo symbol={item.symbol} size="sm" />
                                                        <div>
                                                            <div className="font-bold text-white font-mono text-xs">{item.symbol}</div>
                                                            <div className="text-[10px] text-gray-400">{item.categoryName || item.category}</div>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="py-2.5 px-2 text-center">
                                                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${typeBadgeClass}`}>
                                                        {item.type}
                                                    </span>
                                                </td>

                                                {[2023, 2024, 2025, 2026].map((yr) => {
                                                    const yData = item.years?.[yr];
                                                    const isArchived = yData?.status === "gdrive_archived";
                                                    const isLocal = yData?.status === "local_db" || (yData?.localCount > 0);
                                                    const batchKey = `${item.category}_${item.symbol}_${yr}`;
                                                    const isPushing = pushingBatch[batchKey];

                                                    if (isArchived) {
                                                        return (
                                                            <td key={yr} className="py-2.5 px-2 text-center">
                                                                <a
                                                                    href={yData?.cloudWebLink || `https://drive.google.com/file/d/${yData?.cloudFileId}/view`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="group inline-flex flex-col items-center gap-0.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300 hover:bg-emerald-500/20 hover:border-emerald-500/50 transition shadow-sm"
                                                                    title={`Archived in Google Drive: ${formatNumber(yData?.cloudRecords)} rows (${formatBytes(yData?.cloudSizeBytes)}). Click to open in Drive.`}
                                                                >
                                                                    <div className="flex items-center gap-1 text-[10px] font-bold">
                                                                        <FiCheckCircle className="h-3 w-3 text-emerald-400" />
                                                                        <span>GDrive</span>
                                                                        <FiExternalLink className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100" />
                                                                    </div>
                                                                    <span className="text-[9px] text-emerald-400/80 font-mono">
                                                                        {formatBytes(yData?.cloudSizeBytes)}
                                                                    </span>
                                                                </a>
                                                            </td>
                                                        );
                                                    }

                                                    if (isLocal) {
                                                        return (
                                                            <td key={yr} className="py-2.5 px-2 text-center">
                                                                <div className="inline-flex flex-col items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-300">
                                                                    <span className="text-[10px] font-bold">
                                                                        {formatNumber(yData?.localCount)} rows
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handlePushToDrive(item.category, item.symbol, yr)}
                                                                        disabled={isPushing}
                                                                        className="inline-flex items-center gap-1 text-[9px] font-bold bg-sky-600 hover:bg-sky-500 text-white rounded px-1.5 py-0.5 transition disabled:opacity-50"
                                                                        title="Push to Google Drive & Free Local Disk"
                                                                    >
                                                                        <FiUploadCloud className={`h-2.5 w-2.5 ${isPushing ? "animate-spin" : ""}`} />
                                                                        {isPushing ? "Pushing…" : "Push Drive"}
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        );
                                                    }

                                                    return (
                                                        <td key={yr} className="py-2.5 px-2 text-center">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleSelectSymbolForFetch(item.symbol, yr, item.category)}
                                                                className="rounded-lg border border-white/5 bg-white/5 px-2 py-1 text-[10px] text-gray-500 hover:text-violet-300 hover:border-violet-500/30 hover:bg-violet-500/10 transition"
                                                                title={`Pending extraction for ${item.symbol} (${yr}). Click to load in fetch form.`}
                                                            >
                                                                + Extract
                                                            </button>
                                                        </td>
                                                    );
                                                })}

                                                <td className="py-2.5 px-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectSymbolForFetch(item.symbol, 2023, item.category)}
                                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-400 hover:text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 rounded-lg px-2 py-1 transition"
                                                    >
                                                        <FiPlay className="h-3 w-3" /> Fetch
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Bar */}
                    {totalMatrixPages > 1 && (
                        <div className="flex items-center justify-between pt-3 border-t border-white/5 text-xs text-gray-400 font-sans">
                            <div>
                                Showing {(matrixPage - 1) * (matrixPageSize === "all" ? filteredMatrix.length : matrixPageSize) + 1} to{" "}
                                {Math.min(matrixPage * (matrixPageSize === "all" ? filteredMatrix.length : matrixPageSize), filteredMatrix.length)} of {filteredMatrix.length} symbols
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    type="button"
                                    disabled={matrixPage === 1}
                                    onClick={() => setMatrixPage((p) => Math.max(1, p - 1))}
                                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
                                >
                                    Prev
                                </button>
                                <span className="px-2 font-mono font-bold text-white">
                                    {matrixPage} / {totalMatrixPages}
                                </span>
                                <button
                                    type="button"
                                    disabled={matrixPage === totalMatrixPages}
                                    onClick={() => setMatrixPage((p) => Math.min(totalMatrixPages, p + 1))}
                                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Detailed Month-wise Progress for Selected Symbol */}
                <Card
                    title={coverageSymbol ? `${coverageSymbol} · ${year} month-wise minute data breakdown` : "Month-wise minute data breakdown"}
                    action={coverageSymbol && <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><FiClock className="h-3.5 w-3.5" /> auto-refresh 8s</span>}
                >
                    {!coverageSymbol ? (
                        <div className="flex items-center gap-2 py-5 text-xs text-gray-500">
                            <FiDatabase className="h-4 w-4" /> Select exactly one symbol above to inspect its month-wise minute candle breakdown.
                        </div>
                    ) : coverageLoading && !coverage ? (
                        <div className="py-5 text-center text-xs text-gray-500">Loading month coverage…</div>
                    ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2">
                            {Array.from({ length: 12 }, (_, index) => {
                                const month = `${year}-${String(index + 1).padStart(2, "0")}`;
                                const item = coverage?.find((entry) => entry.month === month);
                                const hasMinuteData = Boolean(item?.minuteRows);
                                const hasOhlcvMinuteData = Boolean(item?.ohlcvMinuteRows);
                                const hasAnyData = Boolean(item?.optionDays || item?.ohlcvDays);
                                const complete = item?.expectedDays != null && item.days >= item.expectedDays && hasMinuteData && hasOhlcvMinuteData;
                                const tone = complete
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                    : hasMinuteData && hasOhlcvMinuteData
                                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                                    : hasAnyData
                                    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                                    : "border-white/10 bg-white/5 text-gray-500";
                                return (
                                    <div key={month} className={`rounded-xl border p-2 text-center sm:text-left ${tone}`} title={`${month}: ${item?.days || 0}/${item?.expectedDays ?? "?"} days, ${(item?.minuteRows || 0).toLocaleString()} minute rows`}>
                                        <div className="text-[10px] font-semibold">{month}</div>
                                        <div className="mt-1 text-sm font-bold">{item?.days || 0}{item?.expectedDays != null ? `/${item.expectedDays}` : ""}</div>
                                        <div className="text-[10px] opacity-80 truncate">
                                            {complete ? "Complete" : hasMinuteData && hasOhlcvMinuteData ? "Partial" : hasMinuteData ? "Missing OHLCV" : hasOhlcvMinuteData ? "Missing options" : hasAnyData ? "EOD/partial" : "No data"}
                                        </div>
                                        {(item?.minuteRows > 0 || item?.ohlcvMinuteRows > 0) && <div className="mt-1 text-[9px] opacity-70 truncate">opt {item.minuteRows.toLocaleString()} · spot {item.ohlcvMinuteRows.toLocaleString()}</div>}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {coverageSymbol && coverage && <div className="mt-3 text-[11px] text-gray-500">Green = all expected trading days with minute data · Amber = partial minute data · Red = incomplete · Gray = no data. EOD-only rows are never marked complete.</div>}
                </Card>

                {/* Jobs History Card */}
                <Card
                    title="Extraction Jobs History"
                    action={
                        <button onClick={loadJobs} className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/10">
                            <FiRefreshCw className="h-3.5 w-3.5" /> Refresh
                        </button>
                    }
                >
                    {!jobs ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : jobs.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500">No extraction jobs requested yet.</div>
                    ) : (
                        <div className="space-y-2">
                            {jobs.map((job) => <JobRow key={job.id} job={job} onCancel={handleCancel} onFail={handleFail} onDelete={handleDelete} />)}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
