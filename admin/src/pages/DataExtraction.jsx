// pages/DataExtraction.jsx — request a historical-data extraction run,
// picking the source (Angel One / Upstox / ICICI Breeze / Kotak / Bhavcopy),
// and watch/cancel jobs. Each request spawns the real CLI script behind that
// source (data-downloader/ for the year-pipelines, server/scripts for Angel
// One/Kotak) — see server/services/dataDownloaderRunner.js for exactly what
// command each combination runs.
import { useCallback, useEffect, useState } from "react";
import { FiPlay, FiXCircle, FiRefreshCw, FiChevronDown, FiChevronUp, FiTrash2, FiAlertOctagon, FiCheck, FiPlus } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { startExtractionJob, fetchExtractionJobs, fetchExtractionJob, cancelExtractionJob, failExtractionJob, deleteExtractionJob, fetchSymbolList } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

// What each source actually supports — drives which form fields show and
// what the "symbols" field means (comma-list for the year-pipelines, exactly
// one symbol for Angel One/Kotak, since those scripts have no ALL mode).
const SOURCES = {
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
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-white/10 ${checked ? "text-violet-300" : "text-gray-300"}`}
        >
            {mode === "multi" && (
                <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${checked ? "border-violet-500 bg-violet-500" : "border-white/20"}`}>
                    {checked && <FiCheck className="h-2.5 w-2.5 text-white" />}
                </span>
            )}
            <span className="font-mono">{sym}</span>
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
                    {job.summary && <div className="mb-2 whitespace-pre-wrap font-mono text-[11px] text-gray-400">{job.summary}</div>}
                    <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-2.5 font-mono text-[11px] leading-relaxed text-gray-400">
                        {detail?.logTail || "loading log…"}
                    </pre>
                </div>
            )}
        </div>
    );
}

export default function DataExtraction() {
    const { token } = useAdminAuth();
    const [source, setSource] = useState("icici_breeze");
    const [dataType, setDataType] = useState("option_chain");
    const [year, setYear] = useState(new Date().getFullYear());
    const [fromMonth, setFromMonth] = useState("");
    const [toMonth, setToMonth] = useState("");
    const [symbols, setSymbols] = useState("");
    const [extraArgs, setExtraArgs] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [jobs, setJobs] = useState(null);
    const [symbolList, setSymbolList] = useState({ indices: [], stocks: [] });

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

    function handleSourceChange(newSource) {
        setSource(newSource);
        // Clamp dataType to whatever the newly-picked source actually supports.
        if (!SOURCES[newSource].dataTypes.includes(dataType)) setDataType(SOURCES[newSource].dataTypes[0]);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            await startExtractionJob(token, {
                source, dataType, symbols: symbols.trim() || undefined,
                year: meta.mode === "year" ? Number(year) : undefined,
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
            <TopBar title="Data Extraction" subtitle="Request a historical-data pull from a specific source. Each request spawns the real backfill script for that source and streams its log below." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="New extraction request" className="mb-4">
                    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[160px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Source</label>
                            <select value={source} onChange={(e) => handleSourceChange(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                                {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                        </div>
                        <div className="min-w-[140px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Data type</label>
                            <select value={dataType} onChange={(e) => setDataType(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                                {meta.dataTypes.map((dt) => <option key={dt} value={dt}>{DATA_TYPE_LABELS[dt]}</option>)}
                            </select>
                        </div>

                        {meta.mode === "year" && (
                            <>
                                <div className="w-24">
                                    <label className="mb-1 block text-xs font-medium text-gray-400">Year</label>
                                    <input type="number" min="2015" max="2100" value={year} onChange={(e) => setYear(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500" />
                                </div>
                                <div className="w-28">
                                    <label className="mb-1 block text-xs font-medium text-gray-400">From month</label>
                                    <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                                        <option value="">1</option>
                                        {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                <div className="w-28">
                                    <label className="mb-1 block text-xs font-medium text-gray-400">To month</label>
                                    <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                                        <option value="">12</option>
                                        {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                            </>
                        )}
                        {meta.mode === "recent" && (
                            <div className="w-32">
                                <label className="mb-1 block text-xs font-medium text-gray-400">Days back</label>
                                <input type="number" min="1" max="365" placeholder="30" value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500" />
                            </div>
                        )}

                        <div className="min-w-[220px] flex-1">
                            <label className="mb-1 block text-xs font-medium text-gray-400">
                                Symbols {meta.mode !== "year" ? "(one symbol, or ALL for Angel One futures)" : "(comma list, blank = all known)"}
                            </label>
                            <SymbolPicker
                                symbolList={symbolList}
                                mode={meta.mode === "year" ? "multi" : "single"}
                                value={symbols}
                                onChange={setSymbols}
                                allowAll={source === "angelone" && dataType === "futures"}
                                placeholder={meta.mode === "year" ? "All known symbols" : "Select a symbol…"}
                            />
                        </div>

                        <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                            <FiPlay className="h-4 w-4" /> {submitting ? "Starting…" : "Start"}
                        </button>
                    </form>
                    <div className="mt-2 text-xs text-gray-500">{meta.note}</div>
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
