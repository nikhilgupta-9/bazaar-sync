// pages/DataImport.jsx — manually import option_chain_history/
// futures_history rows from a CSV, for the specific case the Data Coverage
// page exists to surface: a month is missing and none of the automated
// sources can fill it, but someone has the data from elsewhere. Same
// all-or-nothing, report-every-problem-row pattern as LotSizeHistory.jsx's
// bulk import — CSV parsing happens here client-side, the backend
// (services/dataImportService.js) validates every field against the real
// table schema and never guesses/coerces, so a bad file fails clearly
// instead of silently writing wrong data.
import { useRef, useState } from "react";
import { FiUploadCloud, FiDownload, FiAlertTriangle } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { importData } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const SCHEMAS = {
    option_chain_history: {
        label: "Option Chain",
        header: [
            "symbol", "trade_date", "trade_time", "expiry", "strike", "underlying_price",
            "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
            "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega",
        ],
        sample: "NIFTY,2024-01-15,09:15:00,2024-01-25,21500,21480.5,120.5,45000,,18.2,320,0.55,0.002,-4.1,10.2,,,,,,,,,,",
    },
    futures_history: {
        label: "Futures",
        header: ["symbol", "expiry", "trade_date", "trade_time", "open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
        sample: "NIFTY,2024-01-25,2024-01-15,09:15:00,21500,21520,21480,21495,120000,8500000,,21490.5",
    },
    ohlcv_data: {
        label: "India VIX / OHLCV",
        header: ["symbol", "trade_date", "trade_time", "open", "high", "low", "close", "volume"],
        sample: "INDIAVIX,2024-01-15,09:15:00,14.2,14.35,14.1,14.28,",
    },
};

// Same RFC-4180-ish splitter as LotSizeHistory.jsx (quoted fields, escaped "").
function splitCsvLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
            else cur += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ",") { cells.push(cur); cur = ""; }
        else cur += c;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
}

function parseCsv(text, header) {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) return { rows: null, parseError: "the file is empty" };

    const gotHeader = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
    const headerOk = gotHeader.length === header.length && header.every((h, i) => gotHeader[i] === h);
    if (!headerOk) return { rows: null, parseError: `first row must be exactly this header: ${header.join(",")}` };

    const rows = [];
    const structuralErrors = [];
    for (let i = 1; i < lines.length; i++) {
        const rowNumber = i + 1;
        const cells = splitCsvLine(lines[i]);
        if (cells.length !== header.length) {
            structuralErrors.push({ row: rowNumber, message: `expected ${header.length} columns, got ${cells.length}` });
            continue;
        }
        const row = { rowNumber };
        header.forEach((col, idx) => { row[col] = cells[idx]; });
        rows.push(row);
    }
    if (structuralErrors.length) return { rows: null, parseError: null, structuralErrors };
    return { rows, parseError: null, structuralErrors: null };
}

function downloadTemplate(table, schema) {
    const blob = new Blob([[schema.header.join(","), schema.sample].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table}-import-template.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export default function DataImport() {
    const { token } = useAdminAuth();
    const [table, setTable] = useState("option_chain_history");
    const fileInputRef = useRef(null);
    const [fileName, setFileName] = useState(null);
    const [errors, setErrors] = useState(null);
    const [success, setSuccess] = useState(null);
    const [importing, setImporting] = useState(false);

    const schema = SCHEMAS[table];

    function handleFilePicked(e) {
        const file = e.target.files && e.target.files[0];
        setErrors(null);
        setSuccess(null);
        if (!file) { setFileName(null); return; }
        setFileName(file.name);

        const reader = new FileReader();
        reader.onload = async () => {
            const { rows, parseError, structuralErrors } = parseCsv(String(reader.result), schema.header);
            if (parseError) { setErrors([{ row: null, message: parseError }]); return; }
            if (structuralErrors) { setErrors(structuralErrors); return; }

            setImporting(true);
            try {
                const { written } = await importData(token, table, rows);
                setSuccess(`Imported/updated ${written} row${written === 1 ? "" : "s"}.`);
                setFileName(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
            } catch (err) {
                if (err.rowErrors) setErrors(err.rowErrors);
                else setErrors([{ row: null, message: err.message }]);
            } finally {
                setImporting(false);
            }
        };
        reader.onerror = () => setErrors([{ row: null, message: "could not read the file" }]);
        reader.readAsText(file);
    }

    return (
        <div>
            <TopBar title="Data Import (CSV)" subtitle="Manually fill a gap Data Coverage found and no automated source can cover — upload a CSV in the exact table format. Nothing is written unless every row matches; on a mismatch you get the exact reason for every bad row." />
            <div className="p-6">
                <Card title="Import" className="mb-4">
                    <div className="mb-4 flex items-center gap-3">
                        <label className="text-xs font-medium text-gray-400">Table</label>
                        <select value={table} onChange={(e) => { setTable(e.target.value); setErrors(null); setSuccess(null); }} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500">
                            {Object.entries(SCHEMAS).map(([k, v]) => <option key={k} value={k}>{v.label} ({k})</option>)}
                        </select>
                    </div>

                    <p className="mb-3 text-xs text-gray-400">
                        Header must be exactly: <code className="rounded bg-white/10 px-1 py-0.5 text-gray-200">{schema.header.join(",")}</code>.
                        Non-required numeric fields may be left blank (stored as NULL, never guessed). Rows are upserted — a row for a
                        symbol/date/time/strike (option chain), symbol/expiry/date/time (futures), or symbol/date/time (India VIX / OHLCV)
                        that already exists gets its values refreshed, never duplicated.
                    </p>

                    <div className="flex flex-wrap items-center gap-3">
                        <button type="button" onClick={() => downloadTemplate(table, schema)} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-white/10">
                            <FiDownload className="h-4 w-4" /> Download CSV template
                        </button>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-white/10">
                            <FiUploadCloud className="h-4 w-4" />
                            {fileName || "Choose CSV file…"}
                            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFilePicked} disabled={importing} />
                        </label>
                        {importing && <span className="text-xs text-gray-500">Importing…</span>}
                    </div>

                    {success && <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{success}</div>}

                    {errors && (
                        <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                            <div className="mb-1 flex items-center gap-1.5 font-semibold"><FiAlertTriangle className="h-3.5 w-3.5" /> Fix your file and re-upload — nothing was imported:</div>
                            <ul className="max-h-64 list-disc space-y-0.5 overflow-y-auto pl-4">
                                {errors.map((e, i) => <li key={i}>{e.row ? `Row ${e.row}: ${e.message}` : e.message}</li>)}
                            </ul>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
