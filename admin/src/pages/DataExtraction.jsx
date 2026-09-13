// pages/DataExtraction.jsx — request a historical-data extraction run,
// picking the source (Angel One / Upstox / ICICI Breeze / Kotak / Bhavcopy),
// and watch/cancel jobs. Each request spawns the real CLI script behind that
// source (data-downloader/ for the year-pipelines, server/scripts for Angel
// One/Kotak) — see server/services/dataDownloaderRunner.js for exactly what
// command each combination runs.
import { useCallback, useEffect, useState } from "react";
import { FiPlay, FiXCircle, FiRefreshCw, FiChevronDown, FiChevronUp } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { startExtractionJob, fetchExtractionJobs, fetchExtractionJob, cancelExtractionJob } from "../services/adminApi";
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

function JobRow({ job, onCancel }) {
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

    const meta = SOURCES[source];

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

                        <div className="min-w-[180px] flex-1">
                            <label className="mb-1 block text-xs font-medium text-gray-400">
                                Symbols {meta.mode !== "year" ? "(one symbol, or ALL for Angel One futures)" : "(comma list, blank = all known)"}
                            </label>
                            <input
                                type="text" value={symbols} onChange={(e) => setSymbols(e.target.value.toUpperCase())}
                                placeholder={meta.mode === "year" ? "NIFTY,BANKNIFTY" : "NIFTY"}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500"
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
                            {jobs.map((job) => <JobRow key={job.id} job={job} onCancel={handleCancel} />)}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
