// pages/DataExport.jsx — download a symbol's data (option chain / futures /
// OHLCV, one table or all three zipped) as CSV for a year or month range,
// then optionally delete those same rows from MySQL. Built (2026-09-21) so
// fetched data can move onto a local drive instead of only ever growing the
// DB — export and delete are deliberately separate steps (see
// server/services/dataExportService.js's header): delete only unlocks AFTER
// a successful download in this session, and still needs an explicit
// confirm naming the exact row counts, so a partial/failed download can
// never end up with data gone from both the DB and the disk.
import { useCallback, useEffect, useMemo, useState } from "react";
import { FiDownload, FiTrash2, FiAlertTriangle, FiCheckCircle } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { previewDataExport, downloadDataExport, deleteExportedRows, fetchSymbolList } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const DATA_TYPES = [
    { value: "all", label: "All (Options + Futures + OHLCV)" },
    { value: "option_chain", label: "Option Chain" },
    { value: "futures", label: "Futures" },
    { value: "ohlcv", label: "OHLCV / Spot" },
];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const TABLE_LABELS = { option_chain: "Option Chain", futures: "Futures", ohlcv: "OHLCV / Spot" };

export default function DataExport() {
    const { token } = useAdminAuth();
    const [symbol, setSymbol] = useState("");
    const [dataType, setDataType] = useState("all");
    const [year, setYear] = useState(new Date().getFullYear());
    const [fromMonth, setFromMonth] = useState("");
    const [toMonth, setToMonth] = useState("");
    const [symbolList, setSymbolList] = useState({ indices: [], stocks: [] });

    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [downloaded, setDownloaded] = useState(false); // gates the Delete button — resets on any param change
    const [downloadedFilename, setDownloadedFilename] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(null);
    const [deleteResult, setDeleteResult] = useState(null);

    useEffect(() => {
        fetchSymbolList()
            .then((r) => setSymbolList({ indices: r.indices || [], stocks: r.stocks || [] }))
            .catch(() => { /* text input still works without the datalist */ });
    }, []);

    const params = useMemo(() => ({
        symbol: symbol.trim().toUpperCase(),
        dataType,
        year: Number(year),
        fromMonth: fromMonth ? Number(fromMonth) : undefined,
        toMonth: toMonth ? Number(toMonth) : undefined,
    }), [symbol, dataType, year, fromMonth, toMonth]);

    const canQuery = params.symbol && Number.isInteger(params.year) && params.year >= 2000;

    // Any change to what's being asked for invalidates a previous download —
    // Delete must always match exactly what was just downloaded, never a
    // stale selection from before the user changed the form. Reset inline
    // in each field's own handler (not a useEffect keyed on the params
    // object) so there's no synchronous setState-in-effect cascade.
    function resetDownloadState() {
        setDownloaded(false);
        setDownloadedFilename(null);
        setDeleteResult(null);
    }
    function updateSymbol(v) { setSymbol(v); resetDownloadState(); }
    function updateDataType(v) { setDataType(v); resetDownloadState(); }
    function updateYear(v) { setYear(v); resetDownloadState(); }
    function updateFromMonth(v) { setFromMonth(v); resetDownloadState(); }
    function updateToMonth(v) { setToMonth(v); resetDownloadState(); }

    const loadPreview = useCallback(() => {
        if (!canQuery) { setPreview(null); return undefined; }
        setPreviewLoading(true);
        setError(null);
        previewDataExport(token, params)
            .then(setPreview)
            .catch((err) => { setError(err.message); setPreview(null); })
            .finally(() => setPreviewLoading(false));
    }, [token, params, canQuery]);

    useEffect(() => {
        const id = setTimeout(loadPreview, 300); // debounce while typing a symbol
        return () => clearTimeout(id);
    }, [loadPreview]);

    const totalRows = preview ? Object.values(preview.counts).reduce((a, b) => a + b, 0) : 0;

    async function handleDownload() {
        setDownloading(true);
        setError(null);
        try {
            const { filename } = await downloadDataExport(token, params);
            setDownloaded(true);
            setDownloadedFilename(filename);
        } catch (err) {
            setError(err.message);
        } finally {
            setDownloading(false);
        }
    }

    async function handleDelete() {
        if (!preview) return;
        const lines = Object.entries(preview.counts)
            .filter(([, c]) => c > 0)
            .map(([type, c]) => `  - ${TABLE_LABELS[type]}: ${c.toLocaleString()} rows`)
            .join("\n");
        const confirmed = window.confirm(
            `Delete from the database — this cannot be undone.\n\n` +
            `${params.symbol}, ${preview.start} to ${preview.end}:\n${lines}\n\n` +
            `You downloaded "${downloadedFilename}" for this exact selection. Continue?`
        );
        if (!confirmed) return;
        setDeleting(true);
        setError(null);
        try {
            const result = await deleteExportedRows(token, params);
            setDeleteResult(result);
            setDownloaded(false);
            loadPreview();
        } catch (err) {
            setError(err.message);
        } finally {
            setDeleting(false);
        }
    }

    return (
        <div>
            <TopBar title="Data Export" subtitle="Download a symbol's data as CSV, then free up database space by deleting it — the file on disk becomes the archive." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="Export selection" className="mb-4">
                    <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-40">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Symbol</label>
                            <input
                                list="data-export-symbols"
                                value={symbol}
                                onChange={(e) => updateSymbol(e.target.value)}
                                placeholder="e.g. NIFTY, RELIANCE"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white outline-none focus:border-violet-500"
                            />
                            <datalist id="data-export-symbols">
                                {[...symbolList.indices, ...symbolList.stocks].map((s) => <option key={s} value={s} />)}
                            </datalist>
                        </div>
                        <div className="min-w-56">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Data type</label>
                            <select value={dataType} onChange={(e) => updateDataType(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                                {DATA_TYPES.map((dt) => <option key={dt.value} value={dt.value}>{dt.label}</option>)}
                            </select>
                        </div>
                        <div className="w-24">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Year</label>
                            <input type="number" min="2015" max="2100" value={year} onChange={(e) => updateYear(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500" />
                        </div>
                        <div className="w-28">
                            <label className="mb-1 block text-xs font-medium text-gray-400">From month</label>
                            <select value={fromMonth} onChange={(e) => updateFromMonth(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                                <option value="">1</option>
                                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                        <div className="w-28">
                            <label className="mb-1 block text-xs font-medium text-gray-400">To month</label>
                            <select value={toMonth} onChange={(e) => updateToMonth(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                                <option value="">12</option>
                                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">Leave From/To month blank for the whole year. "All" downloads a .zip of 3 CSVs; a single data type downloads one .csv directly.</div>
                </Card>

                <Card title="Rows in this selection" className="mb-4">
                    {!canQuery ? (
                        <div className="py-6 text-center text-xs text-gray-500">Enter a symbol to see row counts.</div>
                    ) : previewLoading && !preview ? (
                        <div className="py-6 text-center text-xs text-gray-500">Counting…</div>
                    ) : preview ? (
                        <>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {Object.entries(preview.counts).map(([type, count]) => (
                                    <div key={type} className={`rounded-lg border px-3 py-2.5 ${count > 0 ? "border-violet-500/30 bg-violet-500/10" : "border-white/10 bg-white/5"}`}>
                                        <div className="text-[10px] font-semibold uppercase text-gray-400">{TABLE_LABELS[type]}</div>
                                        <div className="mt-1 text-lg font-bold text-white">{count.toLocaleString()}</div>
                                        <div className="text-[10px] text-gray-500">rows</div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-3 text-xs text-gray-500">{preview.start} to {preview.end} · {totalRows.toLocaleString()} total rows</div>

                            <div className="mt-4 flex flex-wrap items-center gap-3">
                                <button
                                    onClick={handleDownload}
                                    disabled={downloading || totalRows === 0}
                                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                                >
                                    <FiDownload className="h-4 w-4" /> {downloading ? "Downloading…" : "Download CSV"}
                                </button>

                                <button
                                    onClick={handleDelete}
                                    disabled={!downloaded || deleting}
                                    title={!downloaded ? "Download this exact selection first" : "Delete these rows from the database"}
                                    className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                                >
                                    <FiTrash2 className="h-4 w-4" /> {deleting ? "Deleting…" : "Delete from DB"}
                                </button>

                                {downloaded && (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300">
                                        <FiCheckCircle className="h-3.5 w-3.5" /> Downloaded "{downloadedFilename}" — Delete is now enabled for this exact selection.
                                    </span>
                                )}
                            </div>

                            {deleteResult && (
                                <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                                    <FiCheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                    <div>
                                        Deleted: {Object.entries(deleteResult.deleted).filter(([, c]) => c > 0).map(([t, c]) => `${TABLE_LABELS[t]} ${c.toLocaleString()}`).join(", ") || "0 rows"}
                                    </div>
                                </div>
                            )}

                            {totalRows === 0 && (
                                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                                    <FiAlertTriangle className="h-3.5 w-3.5" /> No rows for this selection — nothing to download.
                                </div>
                            )}
                        </>
                    ) : null}
                </Card>
            </div>
        </div>
    );
}
