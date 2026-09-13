// pages/LotSizeHistory.jsx — admin-entered historical F&O lot sizes,
// effective-dated. NSE revises lot sizes periodically (SEBI-driven review,
// roughly every 6 months) — Simulator/Backtest need the lot size that was
// actually in effect on a historical trade date, not today's, and none of
// our data sources (Bhavcopy/Breeze/Upstox, Angel One's scrip master) carry
// that historically. See server/services/lotSizeHistoryService.js's header
// comment: this is deliberately admin-entered from NSE's own published
// lot-size-revision circulars, not auto-populated or guessed.
import { useCallback, useEffect, useRef, useState } from "react";
import { FiTrash2, FiUploadCloud, FiDownload } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchLotSizeHistory, addLotSizeHistoryEntry, bulkImportLotSizeHistory, removeLotSizeHistoryEntry } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

// The bulk-import CSV format — a fixed 4-column layout so a hand-rolled parser is enough
// (no SheetJS/xlsx dependency, same "no SDK when a few lines suffice" convention this
// codebase already uses elsewhere, e.g. razorpayService.js/couponService.js). Admins edit
// this in Excel and use File > Save As > CSV (.csv) before uploading — real .xlsx binary
// files are not parsed.
const CSV_HEADER = ["symbol", "lot_size", "effective_from", "effective_to"];
const CSV_TEMPLATE = [
    CSV_HEADER.join(","),
    "NIFTY,75,2026-04-01,",
    "BANKNIFTY,35,2026-04-01,2026-09-30",
].join("\n");

// Minimal RFC-4180-ish CSV line splitter (quoted fields, escaped "" inside quotes) — none of
// this data actually needs commas-in-quotes, but handling it costs a few lines and means a
// stray comma pasted into a cell by mistake fails clearly instead of silently misaligning columns.
function splitCsvLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
            } else cur += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ",") { cells.push(cur); cur = ""; }
        else cur += c;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
}

// Parses raw CSV text into { rows, parseError }. Only checks CSV *structure* (header matches
// the template, every row has exactly 4 columns) — actual field validation (is lot_size a
// positive integer, are the dates real, etc.) is left to the backend so there's one source
// of truth for that (lotSizeHistoryService.js's validateEntryFields), shared with the
// single-entry form above.
function parseLotSizeCsv(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) return { rows: null, parseError: "the file is empty" };

    const header = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
    const headerOk = header.length === CSV_HEADER.length && CSV_HEADER.every((h, i) => header[i] === h);
    if (!headerOk) {
        return {
            rows: null,
            parseError: `first row must be exactly this header: ${CSV_HEADER.join(",")} (got: ${lines[0]})`,
        };
    }

    const rows = [];
    const structuralErrors = [];
    for (let i = 1; i < lines.length; i++) {
        const rowNumber = i + 1; // 1-indexed, header is line 1
        const cells = splitCsvLine(lines[i]);
        if (cells.length !== CSV_HEADER.length) {
            structuralErrors.push({ row: rowNumber, message: `expected ${CSV_HEADER.length} columns, got ${cells.length}` });
            continue;
        }
        const [symbol, lotSize, effectiveFrom, effectiveTo] = cells;
        rows.push({ rowNumber, symbol, lotSize, effectiveFrom, effectiveTo });
    }
    if (structuralErrors.length) return { rows: null, parseError: null, structuralErrors };
    return { rows, parseError: null, structuralErrors: null };
}

function downloadCsvTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lot-size-history-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export default function LotSizeHistory() {
    const { token } = useAdminAuth();
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);
    const [symbol, setSymbol] = useState("");
    const [lotSize, setLotSize] = useState("");
    const [effectiveFrom, setEffectiveFrom] = useState("");
    const [effectiveTo, setEffectiveTo] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const fileInputRef = useRef(null);
    const [importFileName, setImportFileName] = useState(null);
    const [importErrors, setImportErrors] = useState(null); // [{row, message}] | null
    const [importSuccess, setImportSuccess] = useState(null); // "Imported N rows." | null
    const [importing, setImporting] = useState(false);

    const load = useCallback(() => {
        fetchLotSizeHistory(token).then((r) => setEntries(r.entries)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleAdd(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await addLotSizeHistoryEntry(token, {
                symbol: symbol.trim(),
                lotSize: Number(lotSize),
                effectiveFrom,
                effectiveTo: effectiveTo || null,
            });
            setSymbol("");
            setLotSize("");
            setEffectiveFrom("");
            setEffectiveTo("");
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    function handleFilePicked(e) {
        const file = e.target.files && e.target.files[0];
        setImportErrors(null);
        setImportSuccess(null);
        if (!file) {
            setImportFileName(null);
            return;
        }
        setImportFileName(file.name);

        const reader = new FileReader();
        reader.onload = async () => {
            const { rows, parseError, structuralErrors } = parseLotSizeCsv(String(reader.result));
            if (parseError) {
                setImportErrors([{ row: null, message: parseError }]);
                return;
            }
            if (structuralErrors) {
                setImportErrors(structuralErrors);
                return;
            }
            setImporting(true);
            try {
                const { inserted } = await bulkImportLotSizeHistory(token, rows);
                setImportSuccess(`Imported ${inserted} row${inserted === 1 ? "" : "s"}.`);
                setImportFileName(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
                load();
            } catch (err) {
                if (err.rowErrors) setImportErrors(err.rowErrors);
                else setImportErrors([{ row: null, message: err.message }]);
            } finally {
                setImporting(false);
            }
        };
        reader.onerror = () => setImportErrors([{ row: null, message: "could not read the file" }]);
        reader.readAsText(file);
    }

    async function handleRemove(id) {
        try {
            await removeLotSizeHistoryEntry(token, id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div>
            <TopBar
                title="Lot Size History"
                subtitle="Real historical F&O lot sizes, effective-dated — Simulator and Backtest use the value in effect on the historical trade date, not today's. Enter these from NSE's own published lot-size-revision circulars only; nothing here is auto-populated or guessed."
            />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="Add an entry" className="mb-4">
                    <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[120px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Symbol</label>
                            <input
                                required value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                placeholder="NIFTY"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="min-w-[100px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Lot size</label>
                            <input
                                required type="number" min="1" value={lotSize} onChange={(e) => setLotSize(e.target.value)}
                                placeholder="75"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="min-w-[160px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Effective from</label>
                            <input
                                required type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="min-w-[160px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Effective to (optional)</label>
                            <input
                                type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <button
                            type="submit" disabled={submitting}
                            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                            {submitting ? "Adding…" : "Add"}
                        </button>
                    </form>
                </Card>

                <Card title="Bulk import from CSV" className="mb-4">
                    <p className="mb-3 text-xs text-gray-400">
                        Upload a CSV with the header <code className="rounded bg-white/10 px-1 py-0.5 text-gray-200">{CSV_HEADER.join(",")}</code> — one
                        row per lot-size revision. Edit it in Excel, then <span className="text-gray-300">File → Save As → CSV (.csv)</span> before
                        uploading (real .xlsx files aren't read). If any row doesn't match the format, nothing is imported — every problem row is
                        listed below so you can fix the file and re-upload.
                    </p>

                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button" onClick={downloadCsvTemplate}
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-white/10"
                        >
                            <FiDownload className="h-4 w-4" /> Download CSV template
                        </button>

                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-white/10">
                            <FiUploadCloud className="h-4 w-4" />
                            {importFileName || "Choose CSV file…"}
                            <input
                                ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden"
                                onChange={handleFilePicked} disabled={importing}
                            />
                        </label>

                        {importing && <span className="text-xs text-gray-500">Importing…</span>}
                    </div>

                    {importSuccess && (
                        <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                            {importSuccess}
                        </div>
                    )}

                    {importErrors && (
                        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                            <div className="mb-1 font-semibold">Fix your file and re-upload — nothing was imported:</div>
                            <ul className="list-disc space-y-0.5 pl-4">
                                {importErrors.map((e, i) => (
                                    <li key={i}>{e.row ? `Row ${e.row}: ${e.message}` : e.message}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </Card>

                <Card title={`Entries${entries ? ` (${entries.length})` : ""}`}>
                    {!entries ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : entries.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500">
                            No entries yet — Simulator/Backtest fall back to today's live scrip-master lot size until real historical coverage is entered here.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {entries.map((e) => (
                                <div key={e.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm">
                                    <div>
                                        <span className="font-mono font-medium text-gray-200">{e.symbol}</span>
                                        <span className="ml-2 text-gray-300">lot {e.lot_size}</span>
                                        <div className="text-xs text-gray-500">
                                            {e.effective_from} → {e.effective_to || "present"}
                                        </div>
                                    </div>
                                    <button onClick={() => handleRemove(e.id)} className="rounded-lg p-2 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Remove">
                                        <FiTrash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
