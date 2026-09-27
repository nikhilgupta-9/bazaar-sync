// pages/DataExtraction.jsx — request a historical-data extraction run,
// picking the source (Dhan / Angel One / Upstox / ICICI Breeze / Kotak / Bhavcopy),
// and watch/cancel jobs. Each request spawns the real CLI script behind that
// source (data-downloader/ for the year-pipelines, server/scripts for Angel
// One/Kotak) — see server/services/dataDownloaderRunner.js for exactly what
// command each combination runs.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiPlay, FiXCircle, FiRefreshCw, FiChevronDown, FiChevronUp, FiTrash2, FiAlertOctagon, FiCheck, FiPlus, FiClock, FiDatabase, FiKey } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { startExtractionJob, fetchExtractionJobs, fetchExtractionJob, cancelExtractionJob, failExtractionJob, deleteExtractionJob, fetchSymbolList, fetchCoverageDetail } from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";
import { SymbolLogo } from "../utils/symbolIcons";

// What each source actually supports — drives which form fields show and
// what the "symbols" field means (comma-list for the year-pipelines, exactly
// one symbol for Angel One/Kotak, since those scripts have no ALL mode).
const SOURCES = {
    dhan: { label: "Dhan API v2", dataTypes: ["option_chain"], mode: "year", fullYearOnly: true, note: "Primary source: 2023+ minute option chain plus index/equity/VIX spot and daily futures. A full calendar year is deleted and fetched fresh per symbol; From/To month is not supported." },
    icici_breeze: { label: "ICICI Breeze", dataTypes: ["option_chain", "futures", "vix"], mode: "year", note: "Deep 2023+ history. Needs a fresh daily session — see Credentials." },
    upstox: { label: "Upstox", dataTypes: ["option_chain", "futures"], mode: "year", note: "Recent window only (~6-11 months back, confirmed live) — no daily login needed." },
    bhavcopy: { label: "NSE+BSE Bhavcopy", dataTypes: ["option_chain", "futures"], mode: "year", note: "Free, EOD-only contract/expiry discovery — the fast, no-auth half of the Breeze pipelines." },
    angelone: { label: "Angel One", dataTypes: ["option_chain", "futures"], mode: "recent", note: "Forward/recent catch-up only (current live contracts) — one symbol per request, or ALL for futures." },
    kotak: { label: "Kotak Neo", dataTypes: ["option_chain"], mode: "poll", note: "No historical API — this takes ONE live snapshot to prove the pipeline. Run the standalone poller for ongoing data." },
};

const DATA_TYPE_LABELS = { option_chain: "Option Chain", futures: "Futures", vix: "India VIX" };
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const STATUS_TONE = {
    queued: "bg-gray-500/15 text-gray-300",
    running: "bg-amber-500/15 text-amber-300",
    completed: "bg-emerald-500/15 text-emerald-300",
    failed: "bg-rose-500/15 text-rose-300",
    cancelled: "bg-gray-500/15 text-gray-400",
};
// A job in one of these states is done, one way or another — safe to delete
// outright. 'queued'/'running' must be stopped (Cancel/Fail) first so a live
// process never gets orphaned with nothing left tracking it (see
// dataDownloaderRunner.js's deleteJob).
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

// One row inside the SymbolPicker popover below — a checkbox for "multi"
// mode (year-pipeline sources, comma list), or a plain highlighted row for
// "single" mode (Angel One/Kotak, exactly one symbol).
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

// Adds a real searchable list (sourced from /api/option-chain/symbols/list —
// the same 7 indices + ~200 F&O stocks the rest of the app already knows
// about) on top of the plain free-text entry this field always had — a
// typo'd symbol here previously just silently ran a job that found "0
// expiries" with no indication the symbol itself was the problem.
//
// Deliberately NOT restricted to only that fetched list: it's derived from
// `SELECT DISTINCT symbol FROM option_chain_history` (see
// optionChainService.computeSymbolList) — i.e. symbols that already have
// SOME data. This page's whole purpose includes fetching a symbol for the
// very first time (a newly-listed F&O stock, say), which by definition has
// no rows yet and so can't appear in that list. Typing a symbol not in the
// list still works via the "Use "<text>"" row below the search results.
//
// `value`/`onChange` still work on the SAME comma-separated string the rest
// of this page already uses, so nothing else on the page needs to change.
function SymbolPicker({ symbolList, mode, value, onChange, allowAll, placeholder }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const selected = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];

    const q = query.toLowerCase();
    const filteredIndices = symbolList.indices.filter((s) => s.toLowerCase().includes(q));
    const filteredStocks = symbolList.stocks.filter((s) => s.toLowerCase().includes(q));
    // A symbol not (yet) in the fetched list — e.g. a newly-listed F&O stock
    // with no data at all yet — is still usable by typing it in full. Same
    // shape check the backend (dataDownloaderRunner.js's SYMBOL_RE) applies,
    // so this never offers something the job would reject anyway.
    const trimmedQuery = query.trim().toUpperCase();
    const alreadyKnown = symbolList.indices.includes(trimmedQuery) || symbolList.stocks.includes(trimmedQuery);
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
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left font-mono text-sm text-white outline-none focus:border-violet-500"
            >
                <span className={`truncate ${selected.length || value === "ALL" ? "text-white" : "text-gray-500"}`}>{summary}</span>
                <FiChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-1 flex max-h-80 w-72 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#101015] shadow-xl">
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
                                        <span className="ml-auto text-[10px] text-gray-500">not in existing data yet</span>
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
        <div className="rounded-lg border border-white/5 bg-white/5">
            <button onClick={toggle} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${STATUS_TONE[job.status] || "bg-gray-500/15 text-gray-300"}`}>{job.status}</span>
                        <span className="text-sm font-medium text-gray-200">{SOURCES[job.source]?.label || job.source}</span>
                        <span className="text-xs text-gray-500">· {DATA_TYPE_LABELS[job.data_type] || job.data_type}</span>
                        {job.year && <span className="text-xs text-gray-500">· {job.year}{job.from_month ? ` (${job.from_month}-${job.to_month || job.from_month})` : ""}</span>}
                        {job.symbols && <span className="font-mono text-xs text-gray-400">· {job.symbols}</span>}
                        {isAuthErr && (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                                🔑 Token Expired
                            </span>
                        )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-gray-600">{job.command}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {job.status === "running" && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onCancel(job.id); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20"
                        >
                            <FiXCircle className="h-3.5 w-3.5" /> Cancel
                        </button>
                    )}
                    {["queued", "running"].includes(job.status) && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onFail(job.id); }}
                            title={job.status === "queued" ? "Stuck in queued and never started? Force it to failed." : "Process looks hung, not just slow? Force it to failed instead of a clean cancel."}
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20"
                        >
                            <FiAlertOctagon className="h-3.5 w-3.5" /> Mark Failed
                        </button>
                    )}
                    {TERMINAL_STATUSES.includes(job.status) && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete(job.id); }}
                            title="Remove this job's record and log permanently"
                            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-medium text-gray-400 hover:bg-white/10 hover:text-gray-200"
                        >
                            <FiTrash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                    )}
                    {open ? <FiChevronUp className="h-4 w-4 text-gray-500" /> : <FiChevronDown className="h-4 w-4 text-gray-500" />}
                </div>
            </button>
            {open && (
                <div className="border-t border-white/5 px-3 py-2.5">
                    {isAuthErr && (
                        <div className="mb-3 flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
                            <div>
                                <span className="font-bold">Authentication / Token Expired:</span> The broker rejected your request with HTTP 401. Generate a new token and update it in Credentials.
                            </div>
                            <Link
                                to="/data-settings"
                                className="ml-3 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow hover:bg-rose-500"
                            >
                                <FiKey className="h-3.5 w-3.5" /> Update in Credentials
                            </Link>
                        </div>
                    )}
                    {job.summary && <div className="mb-2 whitespace-pre-wrap font-mono text-[11px] text-gray-400">{job.summary}</div>}
                    <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-gray-400">
                        {detail?.logTail || "loading log…"}
                    </pre>
                </div>
            )}
        </div>
    );
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default function DataExtraction() {
    const { token } = useAdminAuth();
    const [source, setSource] = useState("dhan");
    const [dataType, setDataType] = useState("option_chain");
    const [year, setYear] = useState(2023);
    const [toYear, setToYear] = useState(2024);
    const [fromLetter, setFromLetter] = useState("");
    const [toLetter, setToLetter] = useState("");
    const [autoGdrive, setAutoGdrive] = useState(true);
    const [fromMonth, setFromMonth] = useState("");
    const [toMonth, setToMonth] = useState("");
    const [symbols, setSymbols] = useState("");
    const [extraArgs, setExtraArgs] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [jobs, setJobs] = useState(null);
    const [symbolList, setSymbolList] = useState({ indices: [], stocks: [] });
    const [coverage, setCoverage] = useState(null);
    const [coverageLoading, setCoverageLoading] = useState(false);

    const meta = SOURCES[source];

    useEffect(() => {
        fetchSymbolList()
            .then((r) => setSymbolList({ indices: r.indices || [], stocks: r.stocks || [] }))
            .catch(() => { /* picker just shows empty — the source/year/month fields still work */ });
    }, []);

    const loadJobs = useCallback(() => {
        fetchExtractionJobs(token).then((r) => setJobs(r.jobs)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(() => {
        loadJobs();
        const id = setInterval(loadJobs, 8000); // poll — a running job's status/log changes without the admin reloading
        return () => clearInterval(id);
    }, [loadJobs]);

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
        // Clamp dataType to whatever the newly-picked source actually supports.
        if (!SOURCES[newSource].dataTypes.includes(dataType)) setDataType(SOURCES[newSource].dataTypes[0]);
    }

    function applyPreset(pSource, pDataType, pYear, pToYear, pFromLetter, pToLetter) {
        setSource(pSource);
        setDataType(pDataType);
        setYear(pYear);
        setToYear(pToYear);
        setFromLetter(pFromLetter);
        setToLetter(pToLetter);
        setSymbols("");
        setAutoGdrive(true);
        setFromMonth("");
        setToMonth("");
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            await startExtractionJob(token, {
                source, dataType, symbols: symbols.trim() || undefined,
                year: meta.mode === "year" ? Number(year) : undefined,
                toYear: meta.mode === "year" && toYear ? Number(toYear) : undefined,
                fromLetter: meta.mode === "year" && fromLetter ? fromLetter : undefined,
                toLetter: meta.mode === "year" && toLetter ? toLetter : undefined,
                autoGdrive: meta.mode === "year" ? Boolean(autoGdrive) : undefined,
                fromMonth: meta.mode === "year" && fromMonth ? Number(fromMonth) : undefined,
                toMonth: meta.mode === "year" && toMonth ? Number(toMonth) : undefined,
                extraArgs: extraArgs.trim() || undefined,
            });
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

    return (
        <div>
            <DataNavHeader
                title="Historical Data Extraction Pipelines"
                subtitle="Request a historical-data pull from Dhan, Breeze, Upstox, Angel One, or Bhavcopy. Each request spawns the real backfill script and streams live logs."
            />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4">
                {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium">{error}</div>}

                {/* Quick Presets Banner */}
                <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-950/40 via-purple-950/20 to-transparent p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="text-xs sm:text-sm font-semibold text-white flex items-center gap-1.5">
                                <span className="text-violet-400">⚡</span> Parallel Pipeline Presets (2023–2024)
                            </h3>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                                Run Dhan (E→P) and ICICI Breeze (Q→Z) concurrently with Auto-Google Drive sync & disk space cleanup.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => applyPreset("dhan", "option_chain", 2023, 2024, "E", "P")}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/30 bg-violet-600/20 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-600/35 transition shadow-sm"
                            >
                                <span>🎯 Preset 1: Dhan (E → P)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => applyPreset("icici_breeze", "option_chain", 2023, 2024, "Q", "Z")}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-600/20 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-600/35 transition shadow-sm"
                            >
                                <span>🚀 Preset 2: Breeze (Q → Z)</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => applyPreset("dhan", "option_chain", 2023, 2024, "A", "D")}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-600/35 transition shadow-sm"
                            >
                                <span>📦 Preset 3: Dhan (A → D)</span>
                            </button>
                        </div>
                    </div>
                </div>

                <Card title="New extraction request">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-end gap-3">
                            <div className="w-full sm:w-auto sm:min-w-40">
                                <label className="mb-1 block text-xs font-medium text-gray-400">Source</label>
                                <select value={source} onChange={(e) => handleSourceChange(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                    {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                </select>
                            </div>
                            <div className="w-full sm:w-auto sm:min-w-35">
                                <label className="mb-1 block text-xs font-medium text-gray-400">Data type</label>
                                <select value={dataType} onChange={(e) => setDataType(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                    {meta.dataTypes.map((dt) => <option key={dt} value={dt}>{DATA_TYPE_LABELS[dt]}</option>)}
                                </select>
                            </div>

                            {meta.mode === "year" && (
                                <>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">From Year</label>
                                        <input type="number" min="2015" max="2100" value={year} onChange={(e) => setYear(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500" />
                                    </div>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">To Year</label>
                                        <input type="number" min="2015" max="2100" value={toYear} onChange={(e) => setToYear(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500" />
                                    </div>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">From Letter</label>
                                        <select value={fromLetter} onChange={(e) => setFromLetter(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                            <option value="">Start (A)</option>
                                            {LETTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                    <div className="w-full sm:w-24">
                                        <label className="mb-1 block text-xs font-medium text-gray-400">To Letter</label>
                                        <select value={toLetter} onChange={(e) => setToLetter(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                            <option value="">End (Z)</option>
                                            {LETTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                    </div>
                                    {!meta.fullYearOnly && (
                                        <div className="w-full sm:w-28">
                                            <label className="mb-1 block text-xs font-medium text-gray-400">From month</label>
                                            <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                                <option value="">1</option>
                                                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    {!meta.fullYearOnly && (
                                        <div className="w-full sm:w-28">
                                            <label className="mb-1 block text-xs font-medium text-gray-400">To month</label>
                                            <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500">
                                                <option value="">12</option>
                                                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                                            </select>
                                        </div>
                                    )}
                                </>
                            )}
                            {meta.mode === "recent" && (
                                <div className="w-full sm:w-32">
                                    <label className="mb-1 block text-xs font-medium text-gray-400">Days back</label>
                                    <input type="number" min="1" max="365" placeholder="30" value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-violet-500" />
                                </div>
                            )}

                            <div className="w-full sm:flex-1 sm:min-w-55">
                                <label className="mb-1 block text-xs font-medium text-gray-400">
                                    Symbols {meta.mode !== "year" ? "(one symbol, or ALL for Angel One futures)" : "(comma list, blank = all in range)"}
                                </label>
                                <SymbolPicker
                                    symbolList={symbolList}
                                    mode={meta.mode === "year" ? "multi" : "single"}
                                    value={symbols}
                                    onChange={setSymbols}
                                    allowAll={source === "angelone" && dataType === "futures"}
                                    placeholder={meta.mode === "year" ? "All symbols in range" : "Select a symbol…"}
                                />
                            </div>

                            <button type="submit" disabled={submitting} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-violet-700 transition disabled:opacity-50 shadow-md shadow-violet-600/20">
                                <FiPlay className="h-4 w-4" /> {submitting ? "Starting…" : "Start Pipeline"}
                            </button>
                        </div>

                        {meta.mode === "year" && (
                            <div className="flex items-center gap-3 pt-2 border-t border-white/5">
                                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={autoGdrive}
                                        onChange={(e) => setAutoGdrive(e.target.checked)}
                                        className="h-4 w-4 rounded border-white/20 bg-white/5 text-violet-600 focus:ring-0 focus:ring-offset-0"
                                    />
                                    <span className="text-xs font-semibold text-gray-200">
                                        ☁️ Auto-Upload to Google Drive & Free Local MySQL Disk Space
                                    </span>
                                </label>
                                <span className="text-[11px] text-gray-500 hidden sm:inline">
                                    (Immediately compresses to .csv.gz on Google One 5TB Drive and purges local MySQL rows to prevent disk filling)
                                </span>
                            </div>
                        )}
                    </form>
                    <div className={`mt-2 text-xs ${meta.fullYearOnly ? "text-amber-300" : "text-gray-500"}`}>{meta.note}</div>
                </Card>

                <Card
                    title={coverageSymbol ? `${coverageSymbol} · ${year} month-wise progress` : "Month-wise extraction progress"}
                    action={coverageSymbol && <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><FiClock className="h-3.5 w-3.5" /> auto-refresh 8s</span>}
                >
                    {!coverageSymbol ? (
                        <div className="flex items-center gap-2 py-5 text-xs text-gray-500">
                            <FiDatabase className="h-4 w-4" /> Select exactly one symbol above to inspect its month-wise historical status.
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

                <Card
                    title="Jobs"
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
