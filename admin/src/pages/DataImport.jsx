// pages/DataImport.jsx — Multi-Source Historical Data Ingestion (Local CSV & Google Drive Cloud Ingest)
// Allows manual importing of option_chain_history, futures_history, and ohlcv_data rows
// from both local CSV files and directly from Google Drive / Google One archives (.csv, .csv.gz).
import { useRef, useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
    FiUploadCloud,
    FiDownload,
    FiAlertTriangle,
    FiHardDrive,
    FiFolder,
    FiFileText,
    FiSearch,
    FiCheckCircle,
    FiRefreshCw,
    FiExternalLink,
    FiLink,
    FiDatabase,
    FiArrowRight,
    FiLayers,
    FiTrendingUp,
    FiCpu,
} from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import {
    importData,
    fetchGDriveStatus,
    fetchGDriveFiles,
    importDataFromGDrive,
} from "../services/adminApi";
import DataNavHeader from "../components/DataNavHeader";
import Card from "../components/Card";

const SCHEMAS = {
    option_chain_history: {
        label: "Option Chain",
        icon: FiLayers,
        color: "emerald",
        header: [
            "symbol", "trade_date", "trade_time", "expiry", "strike", "underlying_price",
            "ce_ltp", "ce_oi", "ce_oi_change", "ce_iv", "ce_volume", "ce_delta", "ce_gamma", "ce_theta", "ce_vega",
            "pe_ltp", "pe_oi", "pe_oi_change", "pe_iv", "pe_volume", "pe_delta", "pe_gamma", "pe_theta", "pe_vega",
        ],
        sample: "NIFTY,2024-01-15,09:15:00,2024-01-25,21500,21480.5,120.5,45000,,18.2,320,0.55,0.002,-4.1,10.2,,,,,,,,,,",
    },
    futures_history: {
        label: "Futures",
        icon: FiTrendingUp,
        color: "purple",
        header: ["symbol", "expiry", "trade_date", "trade_time", "open", "high", "low", "close", "volume", "oi", "oi_change", "underlying_price"],
        sample: "NIFTY,2024-01-25,2024-01-15,09:15:00,21500,21520,21480,21495,120000,8500000,,21490.5",
    },
    ohlcv_data: {
        label: "India VIX / OHLCV",
        icon: FiCpu,
        color: "indigo",
        header: ["symbol", "trade_date", "trade_time", "open", "high", "low", "close", "volume"],
        sample: "INDIAVIX,2024-01-15,09:15:00,14.2,14.35,14.1,14.28,",
    },
};

// RFC-4180 CSV line parser
function splitCsvLine(line) {
    const cells = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ",") {
            cells.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
}

const COLUMN_ALIASES = {
    symbol: ["symbol", "ticker", "instrument", "underlying_symbol", "stock", "index", "sym", "name", "contract"],
    trade_date: ["trade_date", "date", "timestamp", "tradedate", "trade date", "trade_dt", "datetime", "dt", "candle_date", "time_stamp"],
    trade_time: ["trade_time", "time", "tradetime", "trade time", "time_str", "bar_time", "candle_time"],
    expiry: ["expiry", "expiry_date", "expirydate", "exp_date", "expiry date", "exp_dt", "expdate", "expiration", "exp"],
    strike: ["strike", "strike_price", "strikeprice", "strike price", "str_prc", "strike_prc", "strikeprc"],
    underlying_price: [
        "underlying_price", "underlying", "spot", "spot_price", "spotprice", "spot price",
        "underlying_val", "underlyingvalue", "underlying_value", "underlying_close", "close", "future_price", "fut_price"
    ],
    ce_ltp: ["ce_ltp", "ce_close", "ce_last_price", "ce_price", "call_ltp", "call_close", "call_price", "ce", "call_last", "c_ltp", "ce_last", "call", "c_close"],
    ce_oi: ["ce_oi", "ce_open_interest", "call_oi", "call_open_interest", "c_oi", "ce_open_int", "call_open_int"],
    ce_oi_change: ["ce_oi_change", "ce_change_in_oi", "ce_chg_oi", "ce_oi_chg", "call_oi_change", "call_chg_in_oi", "c_oi_change", "ce_oi_chnge", "call_oi_chg"],
    ce_iv: ["ce_iv", "ce_implied_volatility", "call_iv", "c_iv", "ce_impl_vol", "call_implied_volatility"],
    ce_volume: ["ce_volume", "ce_vol", "ce_total_traded_volume", "call_volume", "call_vol", "c_volume", "c_vol", "ce_traded_vol"],
    ce_delta: ["ce_delta", "call_delta", "c_delta", "delta_ce", "delta_call"],
    ce_gamma: ["ce_gamma", "call_gamma", "c_gamma", "gamma_ce", "gamma_call"],
    ce_theta: ["ce_theta", "call_theta", "c_theta", "theta_ce", "theta_call"],
    ce_vega: ["ce_vega", "call_vega", "c_vega", "vega_ce", "vega_call"],
    pe_ltp: ["pe_ltp", "pe_close", "pe_last_price", "pe_price", "put_ltp", "put_close", "put_price", "pe", "put_last", "p_ltp", "pe_last", "put", "p_close"],
    pe_oi: ["pe_oi", "pe_open_interest", "put_oi", "put_open_interest", "p_oi", "pe_open_int", "put_open_int"],
    pe_oi_change: ["pe_oi_change", "pe_change_in_oi", "pe_chg_oi", "pe_oi_chg", "put_oi_change", "put_chg_in_oi", "p_oi_change", "pe_oi_chnge", "put_oi_chg"],
    pe_iv: ["pe_iv", "pe_implied_volatility", "put_iv", "p_iv", "pe_impl_vol", "put_implied_volatility"],
    pe_volume: ["pe_volume", "pe_vol", "pe_total_traded_volume", "put_volume", "put_vol", "p_volume", "p_vol", "pe_traded_vol"],
    pe_delta: ["pe_delta", "put_delta", "p_delta", "delta_pe", "delta_put"],
    pe_gamma: ["pe_gamma", "put_gamma", "p_gamma", "gamma_pe", "gamma_put"],
    pe_theta: ["pe_theta", "put_theta", "p_theta", "theta_pe", "theta_put"],
    pe_vega: ["pe_vega", "put_vega", "p_vega", "vega_pe", "vega_put"],
    open: ["open", "open_price", "openprice", "o"],
    high: ["high", "high_price", "highprice", "h"],
    low: ["low", "low_price", "lowprice", "l"],
    close: ["close", "close_price", "closeprice", "c", "ltp", "last_price"],
    volume: ["volume", "vol", "traded_volume", "total_volume", "tot_vol", "v"],
    oi: ["oi", "open_interest", "open_int"],
    oi_change: ["oi_change", "change_in_oi", "oi_chg", "chg_oi", "open_interest_change"],
};

function isLikelyHeaderRow(cells) {
    if (!cells || cells.length === 0) return false;
    let dateOrTimeCount = 0;
    let numericCount = 0;
    let headerKeywordMatches = 0;

    const allAliases = new Set(
        Object.values(COLUMN_ALIASES).flat().map((a) => a.toLowerCase().replace(/[^a-z0-9]/g, ""))
    );
    Object.values(SCHEMAS).forEach((s) => {
        s.header.forEach((h) => allAliases.add(h.toLowerCase().replace(/[^a-z0-9]/g, "")));
    });

    for (let i = 0; i < cells.length; i++) {
        const raw = String(cells[i] || "").replace(/^\uFEFF/, "").replace(/['"]+/g, "").trim();
        if (!raw) continue;
        const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");

        if (allAliases.has(normalized)) {
            headerKeywordMatches++;
        }

        if (/^\d{4}-\d{2}-\d{2}/.test(raw) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(raw)) {
            dateOrTimeCount++;
        } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
            dateOrTimeCount++;
        } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
            numericCount++;
        }
    }

    if (dateOrTimeCount >= 1 || (numericCount > 3 && headerKeywordMatches < 2)) {
        return false;
    }
    return headerKeywordMatches >= 2;
}

function getPositionalMapping(cells, table, schema) {
    const mapping = {};
    const colCount = cells.length;
    const cell0 = String(cells[0] || "").trim();
    const cell1 = String(cells[1] || "").trim();
    const cell2 = String(cells[2] || "").trim();

    const cell0IsNum = /^\d+$/.test(cell0) && cell0.length <= 10;
    const cell1IsSymbol = isNaN(cell1) && /^[a-zA-Z0-9_\-& ]+$/.test(cell1);
    const cell2IsDate = /^\d{4}-\d{2}-\d{2}/.test(cell2) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(cell2);

    const firstIsId = (colCount > schema.header.length || cell0IsNum) && cell1IsSymbol && cell2IsDate;
    const offset = firstIsId ? 1 : 0;

    const cols = schema.header;
    for (let i = 0; i < cols.length; i++) {
        if (i + offset < colCount) {
            mapping[cols[i]] = i + offset;
        }
    }
    return mapping;
}

function parseCsv(text, schema, table = "option_chain_history") {
    const lines = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) return { rows: null, parseError: "The file is empty." };

    const firstLineCells = splitCsvLine(lines[0]);
    const isHeader = isLikelyHeaderRow(firstLineCells);

    let mapping = {};
    let startIdx = 0;

    if (isHeader) {
        const rawHeader = firstLineCells.map((h) =>
            String(h || "")
                .replace(/^\uFEFF/, "")
                .replace(/['"]+/g, "")
                .trim()
                .toLowerCase()
        );

        schema.header.forEach((canonicalCol) => {
            const aliases = COLUMN_ALIASES[canonicalCol] || [canonicalCol];
            for (let i = 0; i < rawHeader.length; i++) {
                if (aliases.includes(rawHeader[i])) {
                    mapping[canonicalCol] = i;
                    break;
                }
            }
        });

        const missingRequired = (schema.required || []).filter((reqCol) => mapping[reqCol] === undefined);
        if (missingRequired.length > 0) {
            return {
                rows: null,
                parseError: `Missing required column(s): ${missingRequired.join(", ")}. Found in file: ${rawHeader.join(", ")}`,
            };
        }
        startIdx = 1;
    } else {
        mapping = getPositionalMapping(firstLineCells, table, schema);
        startIdx = 0;
    }

    const rows = [];
    for (let i = startIdx; i < lines.length; i++) {
        const rowNumber = i + 1;
        const cells = splitCsvLine(lines[i]);
        const row = { rowNumber };
        schema.header.forEach((canonicalCol) => {
            const idx = mapping[canonicalCol];
            row[canonicalCol] = idx !== undefined && idx < cells.length ? cells[idx] : "";
        });
        rows.push(row);
    }
    return { rows, parseError: null };
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

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function DataImport() {
    const { token } = useAdminAuth();
    const [importSource, setImportSource] = useState("gdrive"); // "gdrive" | "local"
    const [table, setTable] = useState("option_chain_history");

    // Local file state
    const fileInputRef = useRef(null);
    const [fileName, setFileName] = useState(null);
    const [localErrors, setLocalErrors] = useState(null);
    const [localSuccess, setLocalSuccess] = useState(null);
    const [localImporting, setLocalImporting] = useState(false);

    // Google Drive state
    const [gdriveStatus, setGdriveStatus] = useState(null);
    const [gdriveUrlInput, setGdriveUrlInput] = useState("");
    const [gdriveFiles, setGdriveFiles] = useState([]);
    const [gdriveLoadingFiles, setGdriveLoadingFiles] = useState(false);
    const [gdriveSearchQuery, setGdriveSearchQuery] = useState("");
    const [currentFolderStack, setCurrentFolderStack] = useState([]); // [{ id, name }]
    const [gdriveImporting, setGdriveImporting] = useState(false);
    const [gdriveImportingFileId, setGdriveImportingFileId] = useState(null);
    const [gdriveSuccess, setGdriveSuccess] = useState(null);
    const [gdriveErrors, setGdriveErrors] = useState(null);

    const schema = SCHEMAS[table];

    // Load Google Drive connection status
    const loadGDriveStatus = useCallback(async () => {
        if (!token) return;
        try {
            const status = await fetchGDriveStatus(token);
            setGdriveStatus(status);
        } catch {
            setGdriveStatus({ connection: { connected: false } });
        }
    }, [token]);

    // Load Google Drive Files list
    const loadDriveFiles = useCallback(
        async (folderId = null, query = "") => {
            if (!token) return;
            setGdriveLoadingFiles(true);
            setGdriveErrors(null);
            try {
                const res = await fetchGDriveFiles(token, {
                    folderId: folderId || undefined,
                    query: query || undefined,
                    pageSize: 80,
                });
                setGdriveFiles(res.files || []);
            } catch (err) {
                setGdriveErrors([{ row: null, message: err.message || "Failed to load Google Drive files" }]);
                setGdriveFiles([]);
            } finally {
                setGdriveLoadingFiles(false);
            }
        },
        [token]
    );

    useEffect(() => {
        loadGDriveStatus();
    }, [loadGDriveStatus]);

    useEffect(() => {
        if (importSource === "gdrive" && gdriveStatus?.connection?.connected) {
            const currentFolder = currentFolderStack.length
                ? currentFolderStack[currentFolderStack.length - 1].id
                : gdriveStatus?.rootFolderId || null;
            loadDriveFiles(currentFolder, gdriveSearchQuery);
        }
    }, [importSource, gdriveStatus, currentFolderStack, gdriveSearchQuery, loadDriveFiles]);

    // Folder navigation handlers
    function handleOpenFolder(folder) {
        setCurrentFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
        setGdriveSearchQuery("");
    }

    function handleNavigateBack(index) {
        if (index === -1) {
            setCurrentFolderStack([]);
        } else {
            setCurrentFolderStack((prev) => prev.slice(0, index + 1));
        }
        setGdriveSearchQuery("");
    }

    // Local CSV file picker
    function handleFilePicked(e) {
        const file = e.target.files && e.target.files[0];
        setLocalErrors(null);
        setLocalSuccess(null);
        if (!file) {
            setFileName(null);
            return;
        }
        setFileName(file.name);

        const reader = new FileReader();
        reader.onload = async () => {
            const { rows, parseError } = parseCsv(String(reader.result), schema, table);
            if (parseError) {
                setLocalErrors([{ row: null, message: parseError }]);
                return;
            }

            setLocalImporting(true);
            try {
                const { written } = await importData(token, table, rows);
                setLocalSuccess(`✓ Successfully imported & verified ${Number(written).toLocaleString("en-IN")} rows into ${table}.`);
                setFileName(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
            } catch (err) {
                if (err.rowErrors) setLocalErrors(err.rowErrors);
                else setLocalErrors([{ row: null, message: err.message }]);
            } finally {
                setLocalImporting(false);
            }
        };
        reader.onerror = () => setLocalErrors([{ row: null, message: "Could not read the local file." }]);
        reader.readAsText(file);
    }

    // Google Drive file import handler
    async function handleGDriveImport({ fileId = null, driveUrl = null, name = null }) {
        setGdriveErrors(null);
        setGdriveSuccess(null);
        setGdriveImporting(true);
        if (fileId) setGdriveImportingFileId(fileId);

        try {
            const res = await importDataFromGDrive(token, {
                fileId: fileId || undefined,
                driveUrl: driveUrl || undefined,
                table,
            });

            setGdriveSuccess(
                `✓ Successfully streamed & imported ${Number(res.written).toLocaleString("en-IN")} rows from "${res.fileName || name || "Google Drive file"}" (${formatBytes(res.sizeBytes)}) into ${table}!`
            );
            setGdriveUrlInput("");
        } catch (err) {
            if (err.rowErrors) {
                setGdriveErrors(err.rowErrors);
            } else {
                setGdriveErrors([{ row: null, message: err.message || "Failed to import from Google Drive" }]);
            }
        } finally {
            setGdriveImporting(false);
            setGdriveImportingFileId(null);
        }
    }

    const isGDriveConnected = gdriveStatus?.connection?.connected;
    const isPersonalOAuth = gdriveStatus?.authType === "oauth2";

    return (
        <div>
            <DataNavHeader
                title="Historical Data Ingest & Import"
                subtitle="Import option chain, futures, or OHLCV historical datasets directly from Google Drive / Google One Cloud or Local CSV uploads."
            />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4">
                {/* SOURCE SELECTOR TABS */}
                <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
                    <button
                        type="button"
                        onClick={() => setImportSource("gdrive")}
                        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                            importSource === "gdrive"
                                ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/25"
                                : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                        }`}
                    >
                        <FiHardDrive className="h-4 w-4" />
                        <span>Google Drive Cloud Ingest</span>
                        {isGDriveConnected && (
                            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setImportSource("local")}
                        className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition-all ${
                            importSource === "local"
                                ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-lg shadow-violet-600/25"
                                : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                        }`}
                    >
                        <FiUploadCloud className="h-4 w-4" />
                        <span>Local CSV File Upload</span>
                    </button>
                </div>

                {/* TARGET TABLE PICKER */}
                <Card title="Target Table Destination">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            {Object.entries(SCHEMAS).map(([k, v]) => {
                                const Icon = v.icon;
                                const isSelected = table === k;
                                return (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => {
                                            setTable(k);
                                            setLocalErrors(null);
                                            setLocalSuccess(null);
                                            setGdriveErrors(null);
                                            setGdriveSuccess(null);
                                        }}
                                        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all ${
                                            isSelected
                                                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 shadow-md shadow-emerald-500/10"
                                                : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                                        }`}
                                    >
                                        <Icon className="h-4 w-4" />
                                        <span>{v.label}</span>
                                        <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px] text-gray-400">
                                            {k}
                                        </code>
                                    </button>
                                );
                            })}
                        </div>

                        <button
                            type="button"
                            onClick={() => downloadTemplate(table, schema)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-white/10 transition"
                        >
                            <FiDownload className="h-3.5 w-3.5" />
                            <span>Download {schema.label} Schema Template</span>
                        </button>
                    </div>

                    <p className="mt-3 text-xs text-gray-400 leading-relaxed border-t border-white/5 pt-2">
                        Required Header Order:{" "}
                        <code className="break-all rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300">
                            {schema.header.join(",")}
                        </code>
                        . Empty numeric fields are stored as NULL (never coerced). Rows are upserted via{" "}
                        <code className="font-mono text-gray-300">ON DUPLICATE KEY UPDATE</code> to prevent duplicates.
                    </p>
                </Card>

                {/* TAB 1: GOOGLE DRIVE CLOUD INGEST */}
                {importSource === "gdrive" && (
                    <div className="space-y-4">
                        {/* Google Drive Status Bar */}
                        <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-gray-900 via-gray-900/90 to-gray-900 p-4 shadow-lg">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold ${
                                            isGDriveConnected
                                                ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                                                : "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40"
                                        }`}
                                    >
                                        <FiHardDrive className="h-5 w-5" />
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-sm font-bold text-white">
                                                Google Drive Cloud Integration
                                            </h3>
                                            {isGDriveConnected ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                                                    <FiCheckCircle className="h-3 w-3" /> Connected (
                                                    {isPersonalOAuth ? "Personal Google Account" : "Service Account"})
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/30">
                                                    <FiAlertTriangle className="h-3 w-3" /> Disconnected
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400">
                                            {gdriveStatus?.userEmail
                                                ? `Connected as: ${gdriveStatus.userEmail}`
                                                : "Connect your Google Account or Service Account to browse and stream files."}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            loadGDriveStatus();
                                            const currentFolder = currentFolderStack.length
                                                ? currentFolderStack[currentFolderStack.length - 1].id
                                                : gdriveStatus?.rootFolderId || null;
                                            loadDriveFiles(currentFolder, gdriveSearchQuery);
                                        }}
                                        disabled={gdriveLoadingFiles}
                                        className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-gray-300 hover:bg-white/10 transition"
                                    >
                                        <FiRefreshCw className={`h-3.5 w-3.5 ${gdriveLoadingFiles ? "animate-spin" : ""}`} />
                                        <span>Refresh</span>
                                    </button>
                                    <Link
                                        to="/google-drive-archive"
                                        className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition"
                                    >
                                        <FiHardDrive className="h-3.5 w-3.5" />
                                        <span>Drive Settings</span>
                                    </Link>
                                </div>
                            </div>
                        </div>

                        {/* MODE A: DIRECT GOOGLE DRIVE URL / FILE ID PASTE */}
                        <Card title="Quick Import via Google Drive Link or File ID">
                            <form
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    if (gdriveUrlInput.trim()) {
                                        handleGDriveImport({ driveUrl: gdriveUrlInput.trim() });
                                    }
                                }}
                                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                            >
                                <div className="relative flex-1">
                                    <FiLink className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="text"
                                        value={gdriveUrlInput}
                                        onChange={(e) => setGdriveUrlInput(e.target.value)}
                                        placeholder="Paste Google Drive file share link (e.g. https://drive.google.com/file/d/1A2B.../view) or File ID"
                                        className="w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 py-2.5 text-xs sm:text-sm text-white placeholder-gray-500 outline-none focus:border-emerald-500"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={gdriveImporting || !gdriveUrlInput.trim()}
                                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition shadow-md shadow-emerald-600/20 shrink-0"
                                >
                                    <FiDatabase className="h-4 w-4" />
                                    <span>{gdriveImporting ? "Streaming & Importing…" : `Import into ${schema.label}`}</span>
                                </button>
                            </form>
                        </Card>

                        {/* MODE B: GOOGLE DRIVE CLOUD FILE EXPLORER */}
                        <Card title="Google Drive Cloud File Explorer">
                            {/* Breadcrumbs & Search */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                                {/* Folder Breadcrumbs */}
                                <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-400">
                                    <button
                                        type="button"
                                        onClick={() => handleNavigateBack(-1)}
                                        className="flex items-center gap-1 font-bold text-emerald-400 hover:underline"
                                    >
                                        <FiHardDrive className="h-3.5 w-3.5" />
                                        <span>Root Archive</span>
                                    </button>
                                    {currentFolderStack.map((f, idx) => (
                                        <div key={f.id} className="flex items-center gap-1.5">
                                            <span>/</span>
                                            <button
                                                type="button"
                                                onClick={() => handleNavigateBack(idx)}
                                                className={`font-semibold ${
                                                    idx === currentFolderStack.length - 1
                                                        ? "text-white font-bold"
                                                        : "text-emerald-400 hover:underline"
                                                }`}
                                            >
                                                {f.name}
                                            </button>
                                        </div>
                                    ))}
                                </div>

                                {/* Search Bar */}
                                <div className="relative min-w-[220px]">
                                    <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                                    <input
                                        type="text"
                                        value={gdriveSearchQuery}
                                        onChange={(e) => setGdriveSearchQuery(e.target.value)}
                                        placeholder="Search files (*.csv, *.gz, NIFTY)…"
                                        className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:border-emerald-500"
                                    />
                                </div>
                            </div>

                            {/* Files Table / Grid */}
                            {gdriveLoadingFiles ? (
                                <div className="flex flex-col items-center justify-center py-12 text-xs text-gray-400 gap-2">
                                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
                                    <span>Listing Google Drive archive contents…</span>
                                </div>
                            ) : gdriveFiles.length === 0 ? (
                                <div className="py-10 text-center text-xs text-gray-500">
                                    {gdriveSearchQuery ? `No files matching "${gdriveSearchQuery}"` : "This folder is empty."}
                                </div>
                            ) : (
                                <div className="mt-3 max-h-[420px] overflow-y-auto rounded-xl border border-white/5 bg-black/20">
                                    <table className="w-full text-left text-xs text-gray-300">
                                        <thead className="sticky top-0 bg-gray-900/90 text-[10px] font-bold uppercase text-gray-400 backdrop-blur-md">
                                            <tr>
                                                <th className="px-4 py-2.5">Name</th>
                                                <th className="px-3 py-2.5">Type</th>
                                                <th className="px-3 py-2.5">Size</th>
                                                <th className="px-3 py-2.5">Modified</th>
                                                <th className="px-4 py-2.5 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5 font-medium">
                                            {gdriveFiles.map((file) => {
                                                const isFolder = file.isFolder;
                                                const isImportingThis = gdriveImporting && gdriveImportingFileId === file.id;
                                                const isCsvOrGz =
                                                    file.name.endsWith(".csv") ||
                                                    file.name.endsWith(".gz") ||
                                                    file.name.endsWith(".gzip");

                                                return (
                                                    <tr key={file.id} className="hover:bg-white/5 transition-colors">
                                                        <td className="px-4 py-2.5">
                                                            {isFolder ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenFolder(file)}
                                                                    className="flex items-center gap-2 font-bold text-emerald-400 hover:text-emerald-300 text-left"
                                                                >
                                                                    <FiFolder className="h-4 w-4 shrink-0 text-amber-400" />
                                                                    <span>{file.name}</span>
                                                                </button>
                                                            ) : (
                                                                <div className="flex items-center gap-2 text-white">
                                                                    <FiFileText className="h-4 w-4 shrink-0 text-gray-400" />
                                                                    <span className="font-mono text-xs">{file.name}</span>
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2.5">
                                                            {isFolder ? (
                                                                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                                                                    Folder
                                                                </span>
                                                            ) : file.name.endsWith(".gz") || file.name.endsWith(".gzip") ? (
                                                                <span className="rounded bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-bold text-teal-400">
                                                                    GZIP Archive
                                                                </span>
                                                            ) : file.name.endsWith(".csv") ? (
                                                                <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-bold text-violet-400">
                                                                    CSV Data
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-500 text-[10px]">File</span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-gray-400 font-mono text-[11px]">
                                                            {isFolder ? "—" : formatBytes(file.sizeBytes)}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-gray-400 text-[11px]">
                                                            {file.modifiedTime
                                                                ? new Date(file.modifiedTime).toLocaleDateString()
                                                                : "—"}
                                                        </td>
                                                        <td className="px-4 py-2.5 text-right">
                                                            {isFolder ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenFolder(file)}
                                                                    className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-gray-300 hover:bg-white/10"
                                                                >
                                                                    <span>Open</span>
                                                                    <FiArrowRight className="h-3 w-3" />
                                                                </button>
                                                            ) : (
                                                                <div className="flex items-center justify-end gap-1.5">
                                                                    {file.webViewLink && (
                                                                        <a
                                                                            href={file.webViewLink}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            title="View in Google Drive"
                                                                            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
                                                                        >
                                                                            <FiExternalLink className="h-3.5 w-3.5" />
                                                                        </a>
                                                                    )}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleGDriveImport({
                                                                                fileId: file.id,
                                                                                name: file.name,
                                                                            })
                                                                        }
                                                                        disabled={gdriveImporting}
                                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold text-white shadow-xs transition ${
                                                                            isImportingThis
                                                                                ? "bg-emerald-700 animate-pulse"
                                                                                : "bg-emerald-600 hover:bg-emerald-700"
                                                                        }`}
                                                                    >
                                                                        <FiDatabase className="h-3.5 w-3.5" />
                                                                        <span>
                                                                            {isImportingThis
                                                                                ? "Importing…"
                                                                                : "Import into DB"}
                                                                        </span>
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* GDrive Success Message */}
                            {gdriveSuccess && (
                                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300 font-semibold animate-fade-in flex items-center gap-2">
                                    <FiCheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                                    <span>{gdriveSuccess}</span>
                                </div>
                            )}

                            {/* GDrive Error Messages */}
                            {gdriveErrors && (
                                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300 animate-fade-in">
                                    <div className="mb-1.5 flex items-center gap-1.5 font-bold">
                                        <FiAlertTriangle className="h-4 w-4 shrink-0" />
                                        <span>Import failed:</span>
                                    </div>
                                    <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 font-mono text-[11px]">
                                        {gdriveErrors.map((e, i) => (
                                            <li key={i}>{e.row ? `Row ${e.row}: ${e.message}` : e.message}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </Card>
                    </div>
                )}

                {/* TAB 2: LOCAL CSV FILE INGEST */}
                {importSource === "local" && (
                    <Card title="Upload Local CSV File">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white hover:bg-violet-700 transition shadow-md shadow-violet-600/20">
                                <FiUploadCloud className="h-4 w-4" />
                                <span>{fileName || "Choose CSV file to upload…"}</span>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv,text/csv"
                                    className="hidden"
                                    onChange={handleFilePicked}
                                    disabled={localImporting}
                                />
                            </label>
                            {localImporting && (
                                <span className="text-xs text-violet-400 font-semibold animate-pulse">
                                    Importing & verifying rows…
                                </span>
                            )}
                        </div>

                        {localSuccess && (
                            <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-semibold">
                                {localSuccess}
                            </div>
                        )}

                        {localErrors && (
                            <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                                <div className="mb-1.5 flex items-center gap-1.5 font-bold">
                                    <FiAlertTriangle className="h-4 w-4 shrink-0" /> Fix your file and re-upload —
                                    nothing was imported:
                                </div>
                                <ul className="max-h-64 list-disc space-y-1 overflow-y-auto pl-5 font-mono text-[11px]">
                                    {localErrors.map((e, i) => (
                                        <li key={i}>{e.row ? `Row ${e.row}: ${e.message}` : e.message}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </Card>
                )}
            </div>
        </div>
    );
}
