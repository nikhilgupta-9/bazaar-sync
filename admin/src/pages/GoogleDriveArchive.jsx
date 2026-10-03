// pages/GoogleDriveArchive.jsx — Multi-Asset Automated Cloud Archival & Storage Manager
// Supports Personal Google Account (OAuth 2.0 with 5TB Google One Storage) & Google Workspace Shared Drives
import { useState, useEffect, useCallback, useMemo } from "react";
import {
    FiHardDrive,
    FiCloud,
    FiCheckCircle,
    FiAlertCircle,
    FiPlay,
    FiSquare,
    FiRefreshCw,
    FiExternalLink,
    FiKey,
    FiClock,
    FiTerminal,
    FiSearch,
    FiFolder,
    FiDatabase,
    FiFolderPlus,
    FiCpu,
    FiLayers,
    FiTrendingUp,
    FiUser,
    FiShield,
    FiEdit3,
    FiCopy,
    FiCheck,
    FiLogOut,
    FiInfo,
    FiChevronLeft,
    FiChevronRight,
    FiFilter,
    FiUploadCloud,
    FiZap,
    FiCheckSquare,
} from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import DataNavHeader from "../components/DataNavHeader";
import {
    fetchGDriveStatus,
    testGDriveConnection,
    saveGDriveCredentials,
    initGDriveFolders,
    fetchGDriveCoverage,
    startGDrivePipeline,
    stopGDrivePipeline,
    fetchGDrivePipelineStatus,
    manualArchiveBatch,
    fetchGDriveCronStatus,
    updateGDriveCronSettings,
    fetchGDriveOAuthUrl,
    exchangeGDriveOAuthCode,
    saveGDriveOAuthCredentials,
    disconnectGDriveOAuth,
    updateGDriveRootFolder,
} from "../services/adminApi";

const CATEGORIES = [
    { key: "option_chain", name: "Option Chain", icon: FiLayers, color: "emerald", desc: "1-Minute strike-level option chain, IV, Delta, Theta, Vega, Gamma & OI" },
    { key: "futures", name: "Futures", icon: FiTrendingUp, color: "purple", desc: "1-Minute / Daily Index & Stock derivative futures contracts with Open Interest" },
    { key: "india_vix", name: "India VIX", icon: FiCpu, color: "indigo", desc: "NSE India Volatility Index 1-minute historical intraday candles" },
    { key: "bitcoin", name: "Bitcoin", icon: FiHardDrive, color: "amber", desc: "BTC/USDT Crypto 1-minute historical candles & market volume" },
];

const ALL_SYMBOLS = [
    { symbol: "NIFTY", name: "NIFTY 50", type: "index" },
    { symbol: "BANKNIFTY", name: "NIFTY BANK", type: "index" },
    { symbol: "FINNIFTY", name: "NIFTY FINANCIAL", type: "index" },
    { symbol: "MIDCPNIFTY", name: "NIFTY MIDCAP", type: "index" },
    { symbol: "SENSEX", name: "BSE SENSEX", type: "index" },
    { symbol: "ZYDUSLIFE", name: "Zydus Lifesciences", type: "stock" },
    { symbol: "RELIANCE", name: "Reliance Industries", type: "stock" },
    { symbol: "HDFCBANK", name: "HDFC Bank", type: "stock" },
    { symbol: "TCS", name: "Tata Consultancy Services", type: "stock" },
    { symbol: "INFY", name: "Infosys", type: "stock" },
    { symbol: "ICICIBANK", name: "ICICI Bank", type: "stock" },
    { symbol: "LT", name: "Larsen & Toubro", type: "stock" },
    { symbol: "SBIN", name: "State Bank of India", type: "stock" },
    { symbol: "BHARTIARTL", name: "Bharti Airtel", type: "stock" },
    { symbol: "ITC", name: "ITC Limited", type: "stock" },
    { symbol: "TATAMOTORS", name: "Tata Motors", type: "stock" },
    { symbol: "M_M", name: "Mahindra & Mahindra", type: "stock" },
    { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", type: "stock" },
    { symbol: "AXISBANK", name: "Axis Bank", type: "stock" },
    { symbol: "SUNPHARMA", name: "Sun Pharma", type: "stock" },
    { symbol: "BAJFINANCE", name: "Bajaj Finance", type: "stock" },
    { symbol: "MARUTI", name: "Maruti Suzuki", type: "stock" },
    { symbol: "TITAN", name: "Titan Company", type: "stock" },
];

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

export default function GoogleDriveArchive() {
    const { token } = useAdminAuth();

    // Connection & Settings
    const [driveStatus, setDriveStatus] = useState(null);
    const [testingConnection, setTestingConnection] = useState(false);
    const [initializingFolders, setInitializingFolders] = useState(false);

    // OAuth & Credentials Modal State
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authModalTab, setAuthModalTab] = useState("oauth_wizard"); // "oauth_wizard" | "oauth_direct" | "service_account"
    const [oauthClientId, setOauthClientId] = useState("");
    const [oauthClientSecret, setOauthClientSecret] = useState("");
    const [oauthAuthCode, setOauthAuthCode] = useState("");
    const [oauthRefreshToken, setOauthRefreshToken] = useState("");
    const [oauthAuthUrl, setOauthAuthUrl] = useState("");
    const [generatingOAuthUrl, setGeneratingOAuthUrl] = useState(false);
    const [connectingOAuth, setConnectingOAuth] = useState(false);
    const [serviceAccountJsonInput, setServiceAccountJsonInput] = useState("");
    const [savingServiceAccount, setSavingServiceAccount] = useState(false);

    // Edit Root Folder Modal
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [newFolderInput, setNewFolderInput] = useState("");
    const [savingFolder, setSavingFolder] = useState(false);

    // Copied indicator
    const [copiedUrl, setCopiedUrl] = useState(false);

    // Pipeline Execution State
    const [pipelineStatus, setPipelineStatus] = useState(null);
    const [selectedCategories, setSelectedCategories] = useState(["option_chain", "futures", "india_vix", "bitcoin"]);
    const [selectedYears, setSelectedYears] = useState(["2023", "2024", "2025", "2026"]);
    const [selectedSymbols, setSelectedSymbols] = useState(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "ZYDUSLIFE"]);
    const [autoPrune, setAutoPrune] = useState(true);
    const [startingPipeline, setStartingPipeline] = useState(false);
    const [singleBatchLoading, setSingleBatchLoading] = useState({});

    // Target Symbols selector filter states
    const [symbolSearch, setSymbolSearch] = useState("");
    const [symbolFilterTab, setSymbolFilterTab] = useState("all"); // "all" | "with_data" | "indices" | "stocks"

    // Matrix Table Filter & Pagination States
    const [matrixPage, setMatrixPage] = useState(1);
    const [matrixPageSize, setMatrixPageSize] = useState(25); // 25, 50, 100, "all"
    const [matrixOnlyWithData, setMatrixOnlyWithData] = useState(false);
    const [matrixStatusFilter, setMatrixStatusFilter] = useState("all"); // "all" | "gdrive" | "local_db" | "pending"

    // Cron Automation State
    const [cronStatus, setCronStatus] = useState(null);
    const [cronSchedule, setCronSchedule] = useState("0 3 * * *");
    const [cronEnabled, setCronEnabled] = useState(false);
    const [savingCron, setSavingCron] = useState(false);

    // Matrix & Coverage
    const [coverageData, setCoverageData] = useState(null);
    const [coverageLoading, setCoverageLoading] = useState(false);
    const [activeCategoryTab, setActiveCategoryTab] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");

    // Notification toast / alert
    const [bannerMessage, setBannerMessage] = useState(null);

    const rootFolderId = driveStatus?.rootFolderId || "1bHf18SyIES1hdnXl7Z7d4x5g_j7mOOmt";
    const isConnected = driveStatus?.connection?.connected;
    const authType = driveStatus?.authType;
    const isPersonalOAuth = authType === "oauth2";
    const storageQuota = driveStatus?.storageQuota;

    // Initial Load
    const loadAllData = useCallback(async () => {
        if (!token) return;
        try {
            setCoverageLoading(true);
            const [statusRes, covRes, cronRes, pipeRes] = await Promise.all([
                fetchGDriveStatus(token).catch((err) => ({ error: err.message })),
                fetchGDriveCoverage(token).catch((err) => ({ error: err.message })),
                fetchGDriveCronStatus(token).catch((err) => ({ error: err.message })),
                fetchGDrivePipelineStatus(token).catch((err) => ({ error: err.message })),
            ]);

            setDriveStatus(statusRes);
            setCoverageData(covRes);
            if (cronRes && !cronRes.error) {
                setCronStatus(cronRes);
                setCronEnabled(cronRes.enabled);
                setCronSchedule(cronRes.schedule || "0 3 * * *");
            }
            if (pipeRes && !pipeRes.error) {
                setPipelineStatus(pipeRes);
            }
        } finally {
            setCoverageLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadAllData();
    }, [loadAllData]);

    // Polling while pipeline is running
    useEffect(() => {
        if (!token) return;
        let interval = null;
        if (pipelineStatus?.isRunning) {
            interval = setInterval(async () => {
                const status = await fetchGDrivePipelineStatus(token).catch(() => null);
                if (status) {
                    setPipelineStatus(status);
                    if (!status.isRunning) {
                        fetchGDriveCoverage(token).then(setCoverageData).catch(() => {});
                    }
                }
            }, 2000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [token, pipelineStatus?.isRunning]);

    // Test Connection
    const handleTestConnection = async () => {
        if (!token) return;
        setTestingConnection(true);
        try {
            const res = await testGDriveConnection(token, rootFolderId);
            setDriveStatus((prev) => ({
                ...prev,
                connection: res,
                configured: res.connected,
                storageQuota: res.storageQuota || prev?.storageQuota,
            }));
            if (res.connected) {
                setBannerMessage({
                    type: "success",
                    text: `Google Drive Connected! Target folder: "${res.folderName || rootFolderId}" (${res.authType === "oauth2" ? "Personal Account 5TB" : "Service Account"})`,
                });
            } else {
                setBannerMessage({ type: "error", text: "Google Drive connection test failed: " + (res.error || "Permission denied") });
            }
        } catch (err) {
            setBannerMessage({ type: "error", text: "Test failed: " + err.message });
        } finally {
            setTestingConnection(false);
        }
    };

    // Pre-create 4 folder hierarchy on Google Drive
    const handleInitDriveFolders = async () => {
        if (!token || initializingFolders) return;
        setInitializingFolders(true);
        try {
            await initGDriveFolders(token, rootFolderId);
            setBannerMessage({
                type: "success",
                text: "Google Drive folder hierarchy created successfully! (Option Chain, Futures, India VIX, Bitcoin -> 2023, 2024, 2025, 2026)",
            });
        } catch (err) {
            setBannerMessage({ type: "error", text: "Folder creation failed: " + err.message });
        } finally {
            setInitializingFolders(false);
        }
    };

    // Generate OAuth Authorization URL
    const handleGenerateOAuthUrl = async () => {
        if (!token || !oauthClientId.trim() || !oauthClientSecret.trim()) return;
        setGeneratingOAuthUrl(true);
        try {
            const res = await fetchGDriveOAuthUrl(token, {
                clientId: oauthClientId.trim(),
                clientSecret: oauthClientSecret.trim(),
                redirectUri: "postmessage",
            });
            if (res.authUrl) {
                setOauthAuthUrl(res.authUrl);
                window.open(res.authUrl, "_blank", "width=600,height=700");
            }
        } catch (err) {
            setBannerMessage({ type: "error", text: "Failed to generate authorization URL: " + err.message });
        } finally {
            setGeneratingOAuthUrl(false);
        }
    };

    // Complete OAuth Code Exchange
    const handleCompleteOAuthExchange = async () => {
        if (!token || !oauthAuthCode.trim()) return;
        setConnectingOAuth(true);
        try {
            const res = await exchangeGDriveOAuthCode(token, {
                code: oauthAuthCode.trim(),
                clientId: oauthClientId.trim(),
                clientSecret: oauthClientSecret.trim(),
                redirectUri: "postmessage",
                rootFolderId,
            });
            if (res.success) {
                setBannerMessage({
                    type: "success",
                    text: `Personal Google Account connected successfully! (${res.user?.email || "Google Drive Active"})`,
                });
                setShowAuthModal(false);
                setOauthAuthCode("");
                loadAllData();
            }
        } catch (err) {
            setBannerMessage({ type: "error", text: "OAuth connection failed: " + err.message });
        } finally {
            setConnectingOAuth(false);
        }
    };

    // Save Direct OAuth Refresh Token
    const handleSaveDirectOAuth = async () => {
        if (!token || !oauthClientId.trim() || !oauthClientSecret.trim() || !oauthRefreshToken.trim()) return;
        setConnectingOAuth(true);
        try {
            const res = await saveGDriveOAuthCredentials(token, {
                clientId: oauthClientId.trim(),
                clientSecret: oauthClientSecret.trim(),
                refreshToken: oauthRefreshToken.trim(),
                rootFolderId,
            });
            if (res.success) {
                setBannerMessage({
                    type: "success",
                    text: `Google OAuth credentials saved! (${res.user?.email || "Connected"})`,
                });
                setShowAuthModal(false);
                loadAllData();
            }
        } catch (err) {
            setBannerMessage({ type: "error", text: "Failed to verify OAuth credentials: " + err.message });
        } finally {
            setConnectingOAuth(false);
        }
    };

    // Save Service Account JSON (Fallback)
    const handleSaveServiceAccount = async () => {
        if (!token || !serviceAccountJsonInput.trim()) return;
        setSavingServiceAccount(true);
        try {
            await saveGDriveCredentials(token, serviceAccountJsonInput.trim(), rootFolderId);
            setBannerMessage({ type: "success", text: "Service Account credentials saved successfully!" });
            setShowAuthModal(false);
            setServiceAccountJsonInput("");
            loadAllData();
        } catch (err) {
            setBannerMessage({ type: "error", text: "Failed to save Service Account: " + err.message });
        } finally {
            setSavingServiceAccount(false);
        }
    };

    // Disconnect OAuth
    const handleDisconnectOAuth = async () => {
        if (!token || !window.confirm("Are you sure you want to disconnect this Google Account?")) return;
        try {
            await disconnectGDriveOAuth(token);
            setBannerMessage({ type: "info", text: "Google Account disconnected." });
            loadAllData();
        } catch (err) {
            setBannerMessage({ type: "error", text: "Failed to disconnect: " + err.message });
        }
    };

    // Update Root Folder ID
    const handleUpdateRootFolder = async () => {
        if (!token || !newFolderInput.trim()) return;
        setSavingFolder(true);
        try {
            await updateGDriveRootFolder(token, newFolderInput.trim());
            setBannerMessage({ type: "success", text: `Root folder ID updated to ${newFolderInput.trim()}` });
            setShowFolderModal(false);
            loadAllData();
        } catch (err) {
            setBannerMessage({ type: "error", text: "Failed to update folder ID: " + err.message });
        } finally {
            setSavingFolder(false);
        }
    };

    // Trigger Pipeline
    const handleStartPipeline = async () => {
        if (!token || startingPipeline) return;
        setStartingPipeline(true);
        try {
            await startGDrivePipeline(token, {
                dataTypes: selectedCategories,
                targetYears: selectedYears,
                symbols: selectedSymbols,
                autoPrune,
            });
            setPipelineStatus((prev) => ({ ...prev, isRunning: true, logs: ["Starting multi-asset cloud archival pipeline..."] }));
            setBannerMessage({ type: "success", text: "Archival pipeline launched! Syncing selected categories & uploading to Google Drive." });
        } catch (err) {
            setBannerMessage({ type: "error", text: "Pipeline failed to start: " + err.message });
        } finally {
            setStartingPipeline(false);
        }
    };

    // Stop Pipeline
    const handleStopPipeline = async () => {
        if (!token) return;
        try {
            await stopGDrivePipeline(token);
            setBannerMessage({ type: "info", text: "Archival pipeline stop signal sent." });
        } catch (err) {
            setBannerMessage({ type: "error", text: "Failed to stop pipeline: " + err.message });
        }
    };

    // Save Cron Settings
    const handleSaveCron = async () => {
        if (!token || savingCron) return;
        setSavingCron(true);
        try {
            const updated = await updateGDriveCronSettings(token, {
                enabled: cronEnabled,
                schedule: cronSchedule,
                targetYears: selectedYears,
                symbols: selectedSymbols,
                autoPrune,
            });
            setCronStatus(updated);
            setBannerMessage({
                type: "success",
                text: `Automated Archival Cron ${cronEnabled ? "Activated (" + cronSchedule + ")" : "Deactivated"} successfully!`,
            });
        } catch (err) {
            setBannerMessage({ type: "error", text: "Failed to save Cron settings: " + err.message });
        } finally {
            setSavingCron(false);
        }
    };

    // Manual single batch archive
    const handleManualBatchArchive = async (dataType, symbol, year) => {
        if (!token) return;
        const key = `${dataType}_${symbol}_${year}`;
        setSingleBatchLoading((prev) => ({ ...prev, [key]: true }));
        try {
            const res = await manualArchiveBatch(token, { dataType, symbol, year, autoPrune });
            setBannerMessage({
                type: "success",
                text: `Successfully archived [${dataType.toUpperCase()}] ${symbol} (${year}) to Google Drive! Saved ${formatBytes(res.fileSize)} disk space.`,
            });
            const cov = await fetchGDriveCoverage(token);
            setCoverageData(cov);
        } catch (err) {
            setBannerMessage({ type: "error", text: `Archival failed for [${dataType}] ${symbol} (${year}): ${err.message}` });
        } finally {
            setSingleBatchLoading((prev) => ({ ...prev, [key]: false }));
        }
    };

    // Dynamic symbols list from database with fallback
    const availableSymbolsList = useMemo(() => {
        if (coverageData?.availableSymbols?.length) {
            return coverageData.availableSymbols;
        }
        return ALL_SYMBOLS.map((s) => ({
            symbol: s.symbol,
            name: s.name,
            type: s.type,
            hasLocalData: true,
            categories: ["option_chain", "futures"],
        }));
    }, [coverageData?.availableSymbols]);

    // Symbols available for the Target Symbols selector with search and tabs
    const filteredTargetSymbols = useMemo(() => {
        return availableSymbolsList.filter((item) => {
            const matchesSearch =
                !symbolSearch.trim() ||
                item.symbol.toLowerCase().includes(symbolSearch.toLowerCase()) ||
                (item.name && item.name.toLowerCase().includes(symbolSearch.toLowerCase()));
            if (!matchesSearch) return false;
            if (symbolFilterTab === "with_data") return item.hasLocalData;
            if (symbolFilterTab === "indices") return item.type === "index";
            if (symbolFilterTab === "stocks") return item.type === "stock";
            return true;
        });
    }, [availableSymbolsList, symbolSearch, symbolFilterTab]);

    // Summary status statistics across all assets in the matrix
    const matrixStats = useMemo(() => {
        if (!coverageData?.matrix) return { total: 0, gdrive: 0, localDb: 0, pending: 0 };
        let gdrive = 0;
        let localDb = 0;
        let pending = 0;
        coverageData.matrix.forEach((item) => {
            const hasArchived = Object.values(item.years || {}).some(
                (y) => y.status === "gdrive_archived" || (y.cloudRecords && y.cloudRecords > 0)
            );
            const hasLocal = Object.values(item.years || {}).some(
                (y) => y.status === "local_db" || (y.localCount && y.localCount > 0)
            );
            if (hasArchived) gdrive++;
            if (hasLocal) localDb++;
            if (!hasArchived && !hasLocal) pending++;
        });
        return {
            total: coverageData.matrix.length,
            gdrive,
            localDb,
            pending,
        };
    }, [coverageData?.matrix]);

    // Filter matrix assets
    const filteredMatrix = useMemo(() => {
        if (!coverageData?.matrix) return [];
        return coverageData.matrix.filter((item) => {
            const matchesQuery =
                !searchQuery.trim() ||
                item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.name && item.name.toLowerCase().includes(searchQuery.toLowerCase()));
            const matchesCategory = activeCategoryTab === "all" || item.category === activeCategoryTab;
            
            if (matrixOnlyWithData) {
                const hasAnyData = Object.values(item.years || {}).some(
                    (y) => (y.localCount && y.localCount > 0) || (y.cloudRecords && y.cloudRecords > 0) || y.status === "gdrive_archived"
                );
                if (!hasAnyData) return false;
            }

            if (matrixStatusFilter === "gdrive") {
                const hasArchived = Object.values(item.years || {}).some(
                    (y) => y.status === "gdrive_archived" || (y.cloudRecords && y.cloudRecords > 0)
                );
                if (!hasArchived) return false;
            } else if (matrixStatusFilter === "local_db") {
                const hasLocal = Object.values(item.years || {}).some(
                    (y) => y.status === "local_db" || (y.localCount && y.localCount > 0)
                );
                if (!hasLocal) return false;
            } else if (matrixStatusFilter === "pending") {
                const hasArchived = Object.values(item.years || {}).some(
                    (y) => y.status === "gdrive_archived" || (y.cloudRecords && y.cloudRecords > 0)
                );
                const hasLocal = Object.values(item.years || {}).some(
                    (y) => y.status === "local_db" || (y.localCount && y.localCount > 0)
                );
                if (hasArchived || hasLocal) return false;
            }

            return matchesQuery && matchesCategory;
        });
    }, [coverageData?.matrix, searchQuery, activeCategoryTab, matrixOnlyWithData, matrixStatusFilter]);

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

    // 1-Click Push All Local DB Data to GDrive
    const handlePushAllLocalData = async () => {
        if (!token || startingPipeline) return;
        const symbolsWithData = availableSymbolsList.filter((s) => s.hasLocalData).map((s) => s.symbol);
        const targetSyms = symbolsWithData.length > 0 ? symbolsWithData : availableSymbolsList.map((s) => s.symbol);
        setSelectedSymbols(targetSyms);
        setSelectedCategories(["option_chain", "futures", "india_vix", "bitcoin"]);
        setSelectedYears(["2023", "2024", "2025", "2026"]);

        setStartingPipeline(true);
        try {
            await startGDrivePipeline(token, {
                dataTypes: ["option_chain", "futures", "india_vix", "bitcoin"],
                targetYears: ["2023", "2024", "2025", "2026"],
                symbols: targetSyms,
                autoPrune,
            });
            setPipelineStatus((prev) => ({ ...prev, isRunning: true, logs: [`Archiving all ${targetSyms.length} symbols with local DB data to Google Drive...`] }));
            setBannerMessage({ type: "success", text: `Pipeline launched for all ${targetSyms.length} symbols! Archiving & pushing to Google Drive.` });
        } catch (err) {
            setBannerMessage({ type: "error", text: "Pipeline failed: " + err.message });
        } finally {
            setStartingPipeline(false);
        }
    };

    // Compute Totals
    const stats = useMemo(() => {
        let totalCloudFiles = 0;
        let totalCloudBytes = 0;
        let totalCloudRecords = 0;
        let totalLocalRecords = 0;

        if (coverageData?.matrix) {
            coverageData.matrix.forEach((row) => {
                Object.values(row.years || {}).forEach((y) => {
                    if (y.status === "gdrive_archived") {
                        totalCloudFiles++;
                        totalCloudBytes += y.cloudSizeBytes || 0;
                        totalCloudRecords += y.cloudRecords || 0;
                    } else if (y.status === "local_db") {
                        totalLocalRecords += y.localCount || 0;
                    }
                });
            });
        }

        const estimatedDiskSavedBytes = totalCloudBytes * 8.5;

        return {
            totalCloudFiles,
            totalCloudBytes,
            totalCloudRecords,
            totalLocalRecords,
            estimatedDiskSavedBytes,
        };
    }, [coverageData]);

    return (
        <div className="min-h-screen bg-[#07070a] text-gray-100">
            <DataNavHeader
                title="Google Drive Cloud Archival & Storage Manager"
                subtitle="Personal 5TB Google One Cloud Sync across Option Chain, Futures, India VIX, and Bitcoin with immediate Mac disk space auto-prune."
            />

            <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
                {/* Banner Notification */}
                {bannerMessage && (
                    <div
                        className={`flex items-center justify-between p-4 rounded-xl border backdrop-blur-md transition-all ${
                            bannerMessage.type === "success"
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                : bannerMessage.type === "error"
                                ? "bg-red-500/10 border-red-500/30 text-red-300"
                                : "bg-blue-500/10 border-blue-500/30 text-blue-300"
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            {bannerMessage.type === "success" ? <FiCheckCircle size={20} /> : <FiAlertCircle size={20} />}
                            <span className="text-sm font-semibold">{bannerMessage.text}</span>
                        </div>
                        <button
                            onClick={() => setBannerMessage(null)}
                            className="text-xs opacity-70 hover:opacity-100 font-bold px-2 py-1 rounded bg-white/5"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {/* Top Metrics Ribbon */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Google Drive Status Card */}
                    <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-lg relative overflow-hidden group">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className={`p-3 rounded-xl ${isConnected ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                                    <FiCloud size={24} />
                                </div>
                                <div className="min-w-0">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Google Drive Account</h3>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
                                        <span className="text-sm font-black text-white truncate">
                                            {isConnected
                                                ? isPersonalOAuth
                                                    ? "Personal Account (5TB Pro)"
                                                    : "Service Account"
                                                : "Auth Required"}
                                        </span>
                                    </div>
                                    {driveStatus?.userEmail && (
                                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{driveStatus.userEmail}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs">
                            <button
                                onClick={() => {
                                    setNewFolderInput(rootFolderId);
                                    setShowFolderModal(true);
                                }}
                                className="text-violet-400 hover:text-violet-300 flex items-center gap-1 font-semibold truncate max-w-[160px]"
                                title="Click to change Root Folder ID"
                            >
                                <span>Folder: {rootFolderId.slice(0, 8)}...</span>
                                <FiEdit3 size={11} />
                            </button>
                            <button
                                onClick={handleTestConnection}
                                disabled={testingConnection}
                                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 font-bold transition flex items-center gap-1.5"
                            >
                                <FiRefreshCw size={11} className={testingConnection ? "animate-spin" : ""} />
                                <span>{testingConnection ? "Testing..." : "Test"}</span>
                            </button>
                        </div>
                    </div>

                    {/* Google One 5TB Storage Quota Card */}
                    <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-lg relative overflow-hidden">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400">
                                <FiHardDrive size={24} />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">5TB Google Cloud Storage</h3>
                                <div className="text-lg font-black text-white mt-0.5 truncate">
                                    {storageQuota?.limitBytes
                                        ? `${formatBytes(storageQuota.usageBytes)} / ${formatBytes(storageQuota.limitBytes)}`
                                        : "~5.00 TB Google One"}
                                </div>
                            </div>
                        </div>
                        {storageQuota?.limitBytes ? (
                            <div className="mt-3 space-y-1">
                                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full"
                                        style={{ width: `${Math.max(2, storageQuota.percentUsed || 0)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] text-gray-400 pt-1">
                                    <span>{storageQuota.percentUsed}% Used</span>
                                    <span>{formatBytes(storageQuota.freeBytes)} Available</span>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                                <span>Archived Size: {formatBytes(stats.totalCloudBytes)}</span>
                                <span className="text-blue-400 font-bold">5TB Capacity</span>
                            </div>
                        )}
                    </div>

                    {/* Mac Disk Space Reclaimed */}
                    <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-lg relative overflow-hidden">
                        <div className="flex items-center gap-3">
                            <div className="p-3 rounded-xl bg-purple-500/10 text-purple-400">
                                <FiDatabase size={24} />
                            </div>
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Mac Disk Saved</h3>
                                <div className="text-xl font-black text-white mt-0.5">
                                    ~{formatBytes(stats.estimatedDiskSavedBytes)}
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                            <span>Compressed Size: {formatBytes(stats.totalCloudBytes)}</span>
                            <span className="text-purple-400 font-bold">~8.5x Gzip</span>
                        </div>
                    </div>

                    {/* Automated Background Cron */}
                    <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-lg relative overflow-hidden">
                        <div className="flex items-center gap-3">
                            <div className={`p-3 rounded-xl ${cronStatus?.enabled ? "bg-indigo-500/10 text-indigo-400" : "bg-gray-800 text-gray-400"}`}>
                                <FiClock size={24} />
                            </div>
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Auto Cron Job</h3>
                                <div className="text-base font-black text-white mt-0.5 flex items-center gap-1.5">
                                    <span className={`inline-block h-2 w-2 rounded-full ${cronStatus?.enabled ? "bg-indigo-400" : "bg-gray-500"}`} />
                                    <span>{cronStatus?.enabled ? "Active (Daily)" : "Paused / Manual"}</span>
                                </div>
                            </div>
                        </div>
                        <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                            <span>Auto-Prune DB:</span>
                            <span className="text-emerald-400 font-bold">Enabled</span>
                        </div>
                    </div>
                </div>

                {/* 4 Google Drive Category Folders Showcase */}
                <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-6 shadow-xl space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30">
                                <FiFolder size={20} />
                            </div>
                            <div>
                                <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
                                    <span>Google Drive 4-Category Hierarchy</span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">
                                        Root: {rootFolderId}
                                    </span>
                                </h2>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Organized into 4 core folders with 2023, 2024, 2025, and 2026 subfolders in your 5TB personal Google Drive.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={handleInitDriveFolders}
                            disabled={initializingFolders}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-violet-600/20 transition active:scale-95 disabled:opacity-50"
                        >
                            <FiFolderPlus size={14} className={initializingFolders ? "animate-spin" : ""} />
                            <span>{initializingFolders ? "Creating Folders..." : "Pre-Create All 4 Folders & Years on Drive"}</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
                        {CATEGORIES.map((cat) => {
                            const Icon = cat.icon;
                            return (
                                <div
                                    key={cat.key}
                                    className="rounded-xl border border-white/5 bg-black/40 p-4 space-y-2 hover:border-white/20 transition group"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <div className={`p-2 rounded-lg bg-${cat.color}-500/10 text-${cat.color}-400 border border-${cat.color}-500/20`}>
                                                <Icon size={16} />
                                            </div>
                                            <span className="font-black text-sm text-white">{cat.name}</span>
                                        </div>
                                        <span className="text-[10px] font-bold text-gray-400">Folder</span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 line-clamp-2">{cat.desc}</p>
                                    <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                                        <span className="text-gray-500 font-mono">Years:</span>
                                        <span className="text-gray-300 font-bold">2023 • 2024 • 2025 • 2026</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Pipeline Runner & Controls Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Pipeline Launcher (2 cols) */}
                    <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-[#0d0d14] p-6 shadow-xl space-y-5">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                            <div>
                                <h2 className="text-base font-black text-white flex items-center gap-2">
                                    <FiPlay className="text-emerald-400" />
                                    <span>Run Multi-Asset Archival Pipeline</span>
                                </h2>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Extracts data, compresses into `.csv.gz`, syncs into Google Drive category folders, and auto-prunes local MySQL database.
                                </p>
                            </div>

                            <div className="flex items-center gap-2">
                                {pipelineStatus?.isRunning ? (
                                    <button
                                        onClick={handleStopPipeline}
                                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black text-xs shadow-lg shadow-red-600/30 transition active:scale-95"
                                    >
                                        <FiSquare size={14} />
                                        <span>Stop Pipeline</span>
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleStartPipeline}
                                        disabled={startingPipeline}
                                        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg shadow-emerald-600/30 transition active:scale-95 disabled:opacity-50"
                                    >
                                        <FiPlay size={14} className={startingPipeline ? "animate-spin" : ""} />
                                        <span>{startingPipeline ? "Launching..." : "Start Archival Pipeline"}</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 1-Click Push All DB Data Banner */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-gradient-to-r from-violet-950/40 via-purple-900/30 to-indigo-950/40 border border-violet-500/30">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-300">
                                    <FiUploadCloud size={18} />
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-white flex items-center gap-2">
                                        <span>One-Click Cloud Sync ({availableSymbolsList.filter((s) => s.hasLocalData).length} Assets in DB)</span>
                                        <span className="text-[10px] font-black uppercase px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                            Ready to Sync
                                        </span>
                                    </div>
                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                        Auto-selects all {availableSymbolsList.filter((s) => s.hasLocalData).length} symbols with staged MySQL records and archives them into Google Drive.
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={handlePushAllLocalData}
                                disabled={startingPipeline || pipelineStatus?.isRunning}
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-violet-600/30 transition active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5 whitespace-nowrap"
                            >
                                <FiZap size={13} className={startingPipeline ? "animate-spin" : ""} />
                                <span>Sync All DB Data to GDrive</span>
                            </button>
                        </div>

                        {/* Category Selector */}
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-300">Target Categories</label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {CATEGORIES.map((cat) => {
                                    const isSelected = selectedCategories.includes(cat.key);
                                    return (
                                        <button
                                            key={cat.key}
                                            type="button"
                                            onClick={() => {
                                                if (isSelected) {
                                                    if (selectedCategories.length > 1) {
                                                        setSelectedCategories(selectedCategories.filter((c) => c !== cat.key));
                                                    }
                                                } else {
                                                    setSelectedCategories([...selectedCategories, cat.key]);
                                                }
                                            }}
                                            className={`p-2.5 rounded-xl text-xs font-bold border transition flex items-center justify-between ${
                                                isSelected
                                                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                                                    : "bg-white/5 border-white/5 text-gray-400 hover:bg-white/10"
                                            }`}
                                        >
                                            <span>{cat.name}</span>
                                            {isSelected && <FiCheckCircle size={14} className="text-emerald-400" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Year & Symbol Selection */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Year Selection */}
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-300">Target Years</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {["2023", "2024", "2025", "2026"].map((yr) => {
                                        const isSelected = selectedYears.includes(yr);
                                        return (
                                            <button
                                                key={yr}
                                                type="button"
                                                onClick={() => {
                                                    if (isSelected) {
                                                        if (selectedYears.length > 1) {
                                                            setSelectedYears(selectedYears.filter((y) => y !== yr));
                                                        }
                                                    } else {
                                                        setSelectedYears([...selectedYears, yr]);
                                                    }
                                                }}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-black transition border ${
                                                    isSelected
                                                        ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                                                        : "bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                                                }`}
                                            >
                                                {yr}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Symbols Universe (Dynamic 271+ DB Symbols) */}
                            <div className="space-y-2 sm:col-span-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                        <label className="text-xs font-bold text-gray-300">
                                            Target Symbols
                                        </label>
                                        <span className="px-2 py-0.5 rounded-full bg-violet-600/30 text-violet-300 text-[11px] font-extrabold border border-violet-500/40">
                                            {selectedSymbols.length} / {availableSymbolsList.length} Selected
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const withData = availableSymbolsList.filter((s) => s.hasLocalData).map((s) => s.symbol);
                                                setSelectedSymbols(withData.length > 0 ? withData : availableSymbolsList.map((s) => s.symbol));
                                            }}
                                            className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 font-bold transition flex items-center gap-1"
                                            title="Select only symbols that currently have records in local MySQL DB"
                                        >
                                            <FiZap size={10} />
                                            <span>With DB Data ({availableSymbolsList.filter((s) => s.hasLocalData).length})</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSymbols(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"])}
                                            className="px-2 py-0.5 rounded bg-white/5 text-violet-300 hover:bg-violet-600/20 border border-white/10 font-bold transition"
                                        >
                                            Indices (5)
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSymbols(availableSymbolsList.map((s) => s.symbol))}
                                            className="px-2 py-0.5 rounded bg-white/5 text-violet-300 hover:bg-violet-600/20 border border-white/10 font-bold transition"
                                        >
                                            All ({availableSymbolsList.length})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedSymbols([])}
                                            className="px-2 py-0.5 rounded bg-white/5 text-gray-400 hover:bg-red-500/20 hover:text-red-300 border border-white/10 font-bold transition"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                </div>

                                {/* Symbol Search & Filter Tabs */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                        <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" size={12} />
                                        <input
                                            type="text"
                                            placeholder="Search from 271+ DB symbols (e.g. RELIANCE, NIFTY)..."
                                            value={symbolSearch}
                                            onChange={(e) => setSymbolSearch(e.target.value)}
                                            className="w-full pl-7 pr-2.5 py-1 rounded-lg bg-black/50 border border-white/10 text-xs text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none"
                                        />
                                        {symbolSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setSymbolSearch("")}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs font-bold"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center rounded-lg bg-white/5 p-0.5 border border-white/10 text-[10px]">
                                        {[
                                            { key: "all", label: "All" },
                                            { key: "with_data", label: "In DB" },
                                            { key: "indices", label: "Indices" },
                                            { key: "stocks", label: "Stocks" },
                                        ].map((tab) => (
                                            <button
                                                key={tab.key}
                                                type="button"
                                                onClick={() => setSymbolFilterTab(tab.key)}
                                                className={`px-2 py-0.5 rounded font-bold transition ${
                                                    symbolFilterTab === tab.key
                                                        ? "bg-violet-600 text-white shadow-sm"
                                                        : "text-gray-400 hover:text-gray-200"
                                                }`}
                                            >
                                                {tab.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Symbol Chips Grid */}
                                <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto custom-scrollbar p-2 rounded-xl bg-black/40 border border-white/10">
                                    {filteredTargetSymbols.length === 0 ? (
                                        <div className="w-full text-center py-3 text-xs text-gray-500 italic">
                                            No symbols match filter "{symbolSearch}"
                                        </div>
                                    ) : (
                                        filteredTargetSymbols.map((item) => {
                                            const isSelected = selectedSymbols.includes(item.symbol);
                                            return (
                                                <button
                                                    key={item.symbol}
                                                    type="button"
                                                    onClick={() => {
                                                        if (isSelected) {
                                                            setSelectedSymbols(selectedSymbols.filter((s) => s !== item.symbol));
                                                        } else {
                                                            setSelectedSymbols([...selectedSymbols, item.symbol]);
                                                        }
                                                    }}
                                                    className={`px-2 py-0.5 rounded text-[11px] font-bold border transition flex items-center gap-1 ${
                                                        isSelected
                                                            ? "bg-violet-600/40 border-violet-400 text-white shadow-sm"
                                                            : "bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200"
                                                    }`}
                                                    title={`${item.name || item.symbol} ${item.hasLocalData ? "• (Has Local DB Data)" : ""}`}
                                                >
                                                    <span>{item.symbol}</span>
                                                    {item.hasLocalData && (
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Has Local DB Records" />
                                                    )}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Auto Prune Checkbox */}
                        <div className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-white/5">
                            <div className="flex items-center gap-2.5">
                                <input
                                    type="checkbox"
                                    id="autoPrune"
                                    checked={autoPrune}
                                    onChange={(e) => setAutoPrune(e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-emerald-500 focus:ring-emerald-500/30"
                                />
                                <label htmlFor="autoPrune" className="text-xs text-gray-300 font-semibold cursor-pointer">
                                    <span className="text-white font-bold">Auto-Prune Local MySQL DB</span> (Immediately delete rows & run <code className="text-[11px] text-emerald-400 bg-black px-1 rounded">OPTIMIZE TABLE</code> to reclaim Mac disk space upon verified Google Drive upload)
                                </label>
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                Safe Verify Active
                            </span>
                        </div>

                        {/* Live Terminal & Logs */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 font-bold text-gray-300">
                                    <FiTerminal className="text-violet-400" />
                                    <span>Pipeline Live Execution Stream</span>
                                </div>
                                {pipelineStatus?.isRunning && (
                                    <div className="flex items-center gap-2 text-emerald-400 font-bold text-[11px]">
                                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                                        <span>
                                            Processing: [{pipelineStatus.currentDataType?.toUpperCase()}] {pipelineStatus.currentSymbol} ({pipelineStatus.currentYear})
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Progress bar */}
                            {pipelineStatus?.totalBatches > 0 && (
                                <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                                    <div
                                        className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2 rounded-full transition-all duration-500"
                                        style={{ width: `${pipelineStatus.progressPct || 0}%` }}
                                    />
                                </div>
                            )}

                            {/* Terminal Box */}
                            <div className="h-40 overflow-y-auto custom-scrollbar rounded-xl bg-[#08080c] border border-white/10 p-3 font-mono text-[11px] text-gray-300 space-y-1">
                                {pipelineStatus?.logs?.length > 0 ? (
                                    pipelineStatus.logs.map((log, idx) => (
                                        <div key={idx} className="leading-relaxed break-all">
                                            {log.includes("ERROR") ? (
                                                <span className="text-red-400">{log}</span>
                                            ) : log.includes("SUCCESS") || log.includes("Upload") ? (
                                                <span className="text-emerald-400">{log}</span>
                                            ) : log.includes("PRUNED") ? (
                                                <span className="text-purple-400">{log}</span>
                                            ) : (
                                                <span className="text-gray-300">{log}</span>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div className="text-gray-500 italic flex items-center justify-center h-full">
                                        Pipeline idle. Select categories and click "Start Archival Pipeline" to sync data.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Panel: Automated Cron & Personal Auth (1 col) */}
                    <div className="space-y-6">
                        {/* Automated Cron Settings */}
                        <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-xl space-y-4">
                            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                                <h3 className="text-sm font-black text-white flex items-center gap-2">
                                    <FiClock className="text-indigo-400" />
                                    <span>Automated Background Cron</span>
                                </h3>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={cronEnabled}
                                        onChange={(e) => setCronEnabled(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                                </label>
                            </div>

                            <p className="text-xs text-gray-400">
                                Automatically syncs Option Chain, Futures, VIX, and Bitcoin into your 5TB Google Drive on schedule.
                            </p>

                            <div className="space-y-3">
                                <div>
                                    <label className="text-xs font-bold text-gray-300">Schedule (IST)</label>
                                    <select
                                        value={cronSchedule}
                                        onChange={(e) => setCronSchedule(e.target.value)}
                                        className="mt-1 w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-indigo-500 font-mono"
                                    >
                                        <option value="0 3 * * *">Daily at 03:00 AM IST (Recommended)</option>
                                        <option value="0 1 * * *">Daily at 01:00 AM IST</option>
                                        <option value="0 */6 * * *">Every 6 Hours</option>
                                        <option value="0 0 * * 0">Weekly (Sunday Midnight)</option>
                                    </select>
                                </div>

                                <div className="text-[11px] text-gray-400 space-y-1 bg-black/30 p-2.5 rounded-lg border border-white/5">
                                    <div className="flex justify-between">
                                        <span>Status:</span>
                                        <span className={cronEnabled ? "text-indigo-400 font-bold" : "text-gray-500"}>
                                            {cronEnabled ? "Active & Scheduled" : "Disabled"}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Last Run:</span>
                                        <span className="font-mono text-gray-300">
                                            {cronStatus?.lastRun ? new Date(cronStatus.lastRun).toLocaleString("en-IN") : "Never"}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    onClick={handleSaveCron}
                                    disabled={savingCron}
                                    className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/20 transition disabled:opacity-50"
                                >
                                    {savingCron ? "Saving..." : "Save Cron Settings"}
                                </button>
                            </div>
                        </div>

                        {/* Google Drive Auth Box */}
                        <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-5 shadow-xl space-y-4">
                            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                                <h3 className="text-sm font-black text-white flex items-center gap-2">
                                    <FiShield className="text-blue-400" />
                                    <span>Google Drive Auth</span>
                                </h3>
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${isConnected ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                                    {isConnected ? (isPersonalOAuth ? "Personal 5TB Active" : "Service Account") : "Setup Required"}
                                </span>
                            </div>

                            <div className="text-xs text-gray-400 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span>Target Folder:</span>
                                    <a
                                        href={`https://drive.google.com/drive/u/0/folders/${rootFolderId}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="font-mono text-violet-400 hover:underline flex items-center gap-1"
                                    >
                                        <span>{rootFolderId.slice(0, 12)}...</span>
                                        <FiExternalLink size={10} />
                                    </a>
                                </div>

                                {driveStatus?.userEmail && (
                                    <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-200 flex items-center gap-2">
                                        <FiUser size={14} className="text-blue-400 shrink-0" />
                                        <div className="min-w-0">
                                            <div className="font-bold text-white truncate">{driveStatus.userName || "Personal Account"}</div>
                                            <div className="text-blue-300/80 truncate text-[10px]">{driveStatus.userEmail}</div>
                                        </div>
                                    </div>
                                )}

                                {!isPersonalOAuth && (
                                    <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-200/90 leading-relaxed space-y-1">
                                        <div className="font-bold flex items-center gap-1.5 text-amber-300">
                                            <FiInfo size={13} />
                                            <span>Personal 5TB Account:</span>
                                        </div>
                                        <p>Connect your Personal Google Account via OAuth 2.0 to upload files directly into your 5TB Google One storage without service account quota limits.</p>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2 pt-1">
                                <button
                                    onClick={() => {
                                        setAuthModalTab("oauth_wizard");
                                        setShowAuthModal(true);
                                    }}
                                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition flex items-center justify-center gap-2"
                                >
                                    <FiKey size={14} />
                                    <span>{isConnected && isPersonalOAuth ? "Manage Google Account" : "Connect Personal Google Account (5TB)"}</span>
                                </button>

                                {isPersonalOAuth && (
                                    <button
                                        onClick={handleDisconnectOAuth}
                                        className="w-full py-2 rounded-xl bg-white/5 hover:bg-red-500/10 hover:text-red-300 text-gray-400 text-xs font-bold transition flex items-center justify-center gap-1.5"
                                    >
                                        <FiLogOut size={12} />
                                        <span>Disconnect Google Account</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Multi-Asset Year-wise Coverage & Cloud Archive Matrix */}
                <div className="rounded-2xl border border-white/10 bg-[#0d0d14] p-6 shadow-xl space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                        <div>
                            <h2 className="text-base font-black text-white flex items-center gap-2">
                                <FiDatabase className="text-violet-400" />
                                <span>Multi-Asset Cloud Archive & Local DB Matrix</span>
                            </h2>
                            <p className="text-xs text-gray-400 mt-0.5">
                                Live status of Option Chain, Futures, India VIX, and Bitcoin across 2023, 2024, 2025, and 2026.
                            </p>
                        </div>

                        {/* Search, Filter & Pagination Controls */}
                        <div className="flex flex-wrap items-center gap-2.5">
                            <div className="relative">
                                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
                                <input
                                    type="text"
                                    placeholder="Search 271+ assets..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        setMatrixPage(1);
                                    }}
                                    className="pl-8 pr-3 py-1.5 rounded-xl bg-black/50 border border-white/10 text-xs text-white placeholder-gray-500 focus:border-violet-500 w-36 sm:w-48"
                                />
                            </div>

                            {/* Category Filter Tabs */}
                            <div className="flex items-center rounded-xl bg-white/5 p-0.5 border border-white/5">
                                {[
                                    { key: "all", label: "All Assets" },
                                    { key: "option_chain", label: "Options" },
                                    { key: "futures", label: "Futures" },
                                    { key: "india_vix", label: "India VIX" },
                                    { key: "bitcoin", label: "Bitcoin" },
                                ].map((tab) => (
                                    <button
                                        key={tab.key}
                                        onClick={() => {
                                            setActiveCategoryTab(tab.key);
                                            setMatrixPage(1);
                                        }}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                                            activeCategoryTab === tab.key
                                                ? "bg-violet-600 text-white shadow-sm"
                                                : "text-gray-400 hover:text-gray-200"
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Status Filter Tabs (Drive vs Local DB vs Pending) */}
                            <div className="flex items-center rounded-xl bg-black/40 p-0.5 border border-white/10 text-xs">
                                {[
                                    { key: "all", label: `All (${matrixStats.total})`, activeColor: "bg-white/20 text-white" },
                                    { key: "gdrive", label: `🟢 In Drive (${matrixStats.gdrive})`, activeColor: "bg-emerald-600 text-white" },
                                    { key: "local_db", label: `🟡 Local DB (${matrixStats.localDb})`, activeColor: "bg-amber-600 text-white" },
                                    { key: "pending", label: `⚪ Pending (${matrixStats.pending})`, activeColor: "bg-gray-700 text-gray-200" },
                                ].map((tab) => (
                                    <button
                                        key={tab.key}
                                        onClick={() => {
                                            setMatrixStatusFilter(tab.key);
                                            setMatrixPage(1);
                                        }}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                                            matrixStatusFilter === tab.key
                                                ? `${tab.activeColor} shadow-sm`
                                                : "text-gray-400 hover:text-gray-200"
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Page Size Selector */}
                            <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-xl px-2.5 py-1 text-xs text-gray-400">
                                <span>Show:</span>
                                <select
                                    value={matrixPageSize}
                                    onChange={(e) => {
                                        setMatrixPageSize(e.target.value === "all" ? "all" : Number(e.target.value));
                                        setMatrixPage(1);
                                    }}
                                    className="bg-transparent text-white font-bold text-xs focus:outline-none cursor-pointer"
                                >
                                    <option value={25} className="bg-[#0d0d14] text-white">25</option>
                                    <option value={50} className="bg-[#0d0d14] text-white">50</option>
                                    <option value={100} className="bg-[#0d0d14] text-white">100</option>
                                    <option value="all" className="bg-[#0d0d14] text-white">All ({filteredMatrix.length})</option>
                                </select>
                            </div>

                            <button
                                onClick={loadAllData}
                                disabled={coverageLoading}
                                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition"
                                title="Refresh Matrix"
                            >
                                <FiRefreshCw size={14} className={coverageLoading ? "animate-spin" : ""} />
                            </button>
                        </div>
                    </div>

                    {/* Matrix Status & Count Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400 px-1">
                        <div className="flex items-center gap-2">
                            <span>Showing <strong className="text-white">{paginatedMatrix.length}</strong> of <strong className="text-white">{filteredMatrix.length}</strong> assets</span>
                            {coverageData?.totalSymbols && (
                                <span className="text-[11px] text-gray-500">
                                    (Total {coverageData.totalSymbols} universe symbols in DB)
                                </span>
                            )}
                        </div>
                        {totalMatrixPages > 1 && (
                            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-400">
                                <span>Page {matrixPage} of {totalMatrixPages}</span>
                            </div>
                        )}
                    </div>

                    {/* Table Matrix */}
                    <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/10 text-[11px] font-bold text-gray-400 uppercase tracking-wider bg-black/20">
                                    <th className="py-3 px-4 min-w-[180px]">Asset / Category</th>
                                    {["2023", "2024", "2025", "2026"].map((yr) => (
                                        <th key={yr} className="py-3 px-4 min-w-[200px] text-center">
                                            Year {yr}
                                        </th>
                                    ))}
                                    <th className="py-3 px-4 text-right">Quick Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-xs">
                                {paginatedMatrix.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="py-8 text-center text-gray-500 italic">
                                            No assets match the selected filter or search query.
                                        </td>
                                    </tr>
                                ) : (
                                    paginatedMatrix.map((item) => {
                                        return (
                                            <tr key={`${item.category}_${item.symbol}`} className="hover:bg-white/[0.02] transition">
                                                <td className="py-3.5 px-4">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="p-2 rounded-lg bg-white/5 border border-white/5 text-gray-300">
                                                            <FiFolder size={14} className="text-violet-400" />
                                                        </div>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-black text-white">{item.symbol}</span>
                                                                <span className="text-[10px] text-violet-300 uppercase px-1.5 py-0.2 rounded bg-violet-500/10 border border-violet-500/20">
                                                                    {item.categoryName}
                                                                </span>
                                                            </div>
                                                            <div className="text-[11px] text-gray-400 mt-0.5">{item.name}</div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {["2023", "2024", "2025", "2026"].map((yr) => {
                                                    const cell = item.years?.[yr] || { status: "pending" };
                                                    const isArchived = cell.status === "gdrive_archived";
                                                    const isLocal = cell.status === "local_db";
                                                    const isSingleLoading = singleBatchLoading[`${item.category}_${item.symbol}_${yr}`];

                                                    return (
                                                        <td key={yr} className="py-3.5 px-4 text-center">
                                                            {isArchived ? (
                                                                <div className="inline-flex flex-col items-center gap-1 p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 w-full">
                                                                    <div className="flex items-center gap-1.5 font-bold text-xs">
                                                                        <FiCheckCircle size={13} className="text-emerald-400" />
                                                                        <span>GDrive Archived</span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between w-full text-[10px] opacity-80 px-1 pt-1 border-t border-emerald-500/20">
                                                                        <span>{formatBytes(cell.cloudSizeBytes)}</span>
                                                                        <span>{formatNumber(cell.cloudRecords)} rows</span>
                                                                    </div>
                                                                    {cell.cloudWebLink && (
                                                                        <a
                                                                            href={cell.cloudWebLink}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 font-semibold mt-0.5"
                                                                        >
                                                                            <span>Open on Drive</span>
                                                                            <FiExternalLink size={10} />
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            ) : isLocal ? (
                                                                <div className="inline-flex flex-col items-center gap-1 p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 w-full">
                                                                    <div className="flex items-center gap-1.5 font-bold text-xs">
                                                                        <FiHardDrive size={13} className="text-amber-400" />
                                                                        <span>Local DB Staged</span>
                                                                    </div>
                                                                    <div className="text-[10px] opacity-80">
                                                                        {formatNumber(cell.localCount)} rows in DB
                                                                    </div>
                                                                    <button
                                                                        onClick={() => handleManualBatchArchive(item.category, item.symbol, yr)}
                                                                        disabled={isSingleLoading}
                                                                        className="mt-1 px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-bold transition flex items-center gap-1"
                                                                    >
                                                                        <FiCloud size={11} className={isSingleLoading ? "animate-spin" : ""} />
                                                                        <span>{isSingleLoading ? "Syncing..." : "Sync & Free Space"}</span>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="inline-flex flex-col items-center gap-1 p-2 rounded-xl bg-white/[0.02] border border-white/5 text-gray-500 w-full">
                                                                    <span className="text-[11px] font-medium italic">Pending / Not in DB</span>
                                                                    <button
                                                                        onClick={() => handleManualBatchArchive(item.category, item.symbol, yr)}
                                                                        disabled={isSingleLoading}
                                                                        className="mt-0.5 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 text-[10px] font-bold transition"
                                                                    >
                                                                        {isSingleLoading ? "Extracting..." : "Extract & Sync"}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}

                                                <td className="py-3.5 px-4 text-right">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedCategories([item.category]);
                                                            if (item.symbol !== "INDIAVIX" && item.symbol !== "BTCUSDT") {
                                                                setSelectedSymbols([item.symbol]);
                                                            }
                                                            window.scrollTo({ top: 0, behavior: "smooth" });
                                                        }}
                                                        className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-violet-600/20 border border-white/5 hover:border-violet-500/30 text-gray-300 hover:text-violet-300 text-xs font-bold transition"
                                                    >
                                                        Select
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination Footer */}
                    {totalMatrixPages > 1 && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-white/5">
                            <span className="text-xs text-gray-400">
                                Page <strong className="text-white">{matrixPage}</strong> of <strong className="text-white">{totalMatrixPages}</strong> ({filteredMatrix.length} total matching assets)
                            </span>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => setMatrixPage((p) => Math.max(1, p - 1))}
                                    disabled={matrixPage === 1}
                                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1"
                                >
                                    <FiChevronLeft size={14} />
                                    <span>Prev</span>
                                </button>
                                {Array.from({ length: Math.min(5, totalMatrixPages) }, (_, i) => {
                                    let pageNum;
                                    if (totalMatrixPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (matrixPage <= 3) {
                                        pageNum = i + 1;
                                    } else if (matrixPage >= totalMatrixPages - 2) {
                                        pageNum = totalMatrixPages - 4 + i;
                                    } else {
                                        pageNum = matrixPage - 2 + i;
                                    }
                                    return (
                                        <button
                                            key={pageNum}
                                            onClick={() => setMatrixPage(pageNum)}
                                            className={`w-8 h-8 rounded-lg text-xs font-bold transition ${
                                                matrixPage === pageNum
                                                    ? "bg-violet-600 text-white shadow"
                                                    : "bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                                            }`}
                                        >
                                            {pageNum}
                                        </button>
                                    );
                                })}
                                <button
                                    onClick={() => setMatrixPage((p) => Math.min(totalMatrixPages, p + 1))}
                                    disabled={matrixPage === totalMatrixPages}
                                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1"
                                >
                                    <span>Next</span>
                                    <FiChevronRight size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {/* Google Auth & Connection Modal */}
            {showAuthModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
                    <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0e0e16] p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto custom-scrollbar">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <div>
                                <h3 className="text-base font-black text-white flex items-center gap-2">
                                    <FiKey className="text-blue-400" />
                                    <span>Connect Google Drive (5TB Personal Account)</span>
                                </h3>
                                <p className="text-xs text-gray-400 mt-0.5">
                                    Authenticate using OAuth 2.0 to upload historical data straight into your 5TB Google One account.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowAuthModal(false)}
                                className="text-gray-400 hover:text-white text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Modal Tabs */}
                        <div className="flex rounded-xl bg-white/5 p-1 border border-white/5 text-xs font-bold">
                            <button
                                onClick={() => setAuthModalTab("oauth_wizard")}
                                className={`flex-1 py-2 rounded-lg transition ${authModalTab === "oauth_wizard" ? "bg-blue-600 text-white shadow-md" : "text-gray-400 hover:text-gray-200"}`}
                            >
                                1. Google OAuth Setup
                            </button>
                            <button
                                onClick={() => setAuthModalTab("oauth_direct")}
                                className={`flex-1 py-2 rounded-lg transition ${authModalTab === "oauth_direct" ? "bg-blue-600 text-white shadow-md" : "text-gray-400 hover:text-gray-200"}`}
                            >
                                2. Direct Token / Refresh Key
                            </button>
                            <button
                                onClick={() => setAuthModalTab("service_account")}
                                className={`flex-1 py-2 rounded-lg transition ${authModalTab === "service_account" ? "bg-blue-600 text-white shadow-md" : "text-gray-400 hover:text-gray-200"}`}
                            >
                                3. Service Account JSON
                            </button>
                        </div>

                        {/* TAB 1: OAuth Wizard */}
                        {authModalTab === "oauth_wizard" && (
                            <div className="space-y-4">
                                <div className="p-3.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-200 space-y-2">
                                    <div className="font-bold flex items-center gap-1.5 text-blue-300">
                                        <FiInfo size={14} />
                                        <span>How to get your OAuth Client ID & Secret in 2 minutes:</span>
                                    </div>
                                    <ol className="list-decimal list-inside space-y-1 text-[11px] text-blue-200/90 leading-relaxed">
                                        <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline font-bold text-white">Google Cloud Console &rarr; Credentials</a>.</li>
                                        <li>Click <strong>+ Create Credentials &rarr; OAuth client ID</strong>.</li>
                                        <li>Choose Application type: <strong>Web application</strong> (or Desktop).</li>
                                        <li>Under <strong>Authorized redirect URIs</strong>, add <code className="bg-black/50 px-1 py-0.5 rounded text-blue-300">https://developers.google.com/oauthplayground</code> (or leave default).</li>
                                        <li>Copy your <strong>Client ID</strong> and <strong>Client Secret</strong> below.</li>
                                    </ol>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-bold text-gray-300">Google OAuth Client ID</label>
                                        <input
                                            type="text"
                                            value={oauthClientId}
                                            onChange={(e) => setOauthClientId(e.target.value)}
                                            placeholder="123456789-xxx.apps.googleusercontent.com"
                                            className="mt-1 w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-blue-500 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-300">Client Secret</label>
                                        <input
                                            type="password"
                                            value={oauthClientSecret}
                                            onChange={(e) => setOauthClientSecret(e.target.value)}
                                            placeholder="GOCSPX-xxxxxxxxxxxx"
                                            className="mt-1 w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-blue-500 font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="pt-1 flex items-center gap-3">
                                    <button
                                        onClick={handleGenerateOAuthUrl}
                                        disabled={generatingOAuthUrl || !oauthClientId.trim() || !oauthClientSecret.trim()}
                                        className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/20 transition flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        <FiExternalLink size={13} />
                                        <span>{generatingOAuthUrl ? "Generating..." : "Step 1: Open Google Sign-In Window"}</span>
                                    </button>
                                </div>

                                {oauthAuthUrl && (
                                    <div className="space-y-3 p-3.5 rounded-xl bg-black/40 border border-white/10">
                                        <div className="flex items-center justify-between text-xs text-gray-300 font-semibold">
                                            <span>Step 2: Paste the Authorization Code from Google:</span>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(oauthAuthUrl);
                                                    setCopiedUrl(true);
                                                    setTimeout(() => setCopiedUrl(false), 2000);
                                                }}
                                                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[11px]"
                                            >
                                                {copiedUrl ? <FiCheck size={12} /> : <FiCopy size={12} />}
                                                <span>{copiedUrl ? "Copied Link" : "Copy Login Link"}</span>
                                            </button>
                                        </div>

                                        <input
                                            type="text"
                                            value={oauthAuthCode}
                                            onChange={(e) => setOauthAuthCode(e.target.value)}
                                            placeholder="4/0AWtg... (Paste authorization code or access code here)"
                                            className="w-full bg-black/60 border border-blue-500/40 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-blue-500 font-mono"
                                        />

                                        <button
                                            onClick={handleCompleteOAuthExchange}
                                            disabled={connectingOAuth || !oauthAuthCode.trim()}
                                            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
                                        >
                                            {connectingOAuth ? "Verifying & Saving Tokens..." : "Step 3: Connect 5TB Google Account"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* TAB 2: Direct Token / Refresh Token Paste */}
                        {authModalTab === "oauth_direct" && (
                            <div className="space-y-4">
                                <p className="text-xs text-gray-400">
                                    If you generated a Google OAuth Refresh Token via Google OAuth Playground or CLI, paste your credentials below:
                                </p>

                                <div className="space-y-3">
                                    <div>
                                        <label className="text-xs font-bold text-gray-300">Client ID</label>
                                        <input
                                            type="text"
                                            value={oauthClientId}
                                            onChange={(e) => setOauthClientId(e.target.value)}
                                            placeholder="Client ID"
                                            className="mt-1 w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-300">Client Secret</label>
                                        <input
                                            type="password"
                                            value={oauthClientSecret}
                                            onChange={(e) => setOauthClientSecret(e.target.value)}
                                            placeholder="Client Secret"
                                            className="mt-1 w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-gray-300">Refresh Token (<code className="text-blue-300">1//...</code>)</label>
                                        <input
                                            type="password"
                                            value={oauthRefreshToken}
                                            onChange={(e) => setOauthRefreshToken(e.target.value)}
                                            placeholder="1//04xxxxxxxxxxxxxxxxxxxxxxx"
                                            className="mt-1 w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono"
                                        />
                                    </div>
                                </div>

                                <button
                                    onClick={handleSaveDirectOAuth}
                                    disabled={connectingOAuth || !oauthClientId.trim() || !oauthClientSecret.trim() || !oauthRefreshToken.trim()}
                                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs shadow-md shadow-blue-600/20 transition disabled:opacity-50"
                                >
                                    {connectingOAuth ? "Verifying Account..." : "Save & Verify 5TB Account"}
                                </button>
                            </div>
                        )}

                        {/* TAB 3: Service Account JSON */}
                        {authModalTab === "service_account" && (
                            <div className="space-y-4">
                                <p className="text-xs text-gray-400">
                                    Service accounts only work if the root folder is located inside a <strong>Google Workspace Shared Drive (Team Drive)</strong>.
                                </p>

                                <div>
                                    <label className="text-xs font-bold text-gray-300">Service Account JSON</label>
                                    <textarea
                                        rows={7}
                                        value={serviceAccountJsonInput}
                                        onChange={(e) => setServiceAccountJsonInput(e.target.value)}
                                        placeholder='{\n  "type": "service_account",\n  "client_email": "...",\n  "private_key": "..."\n}'
                                        className="mt-1 w-full bg-black/60 border border-white/10 rounded-xl p-3 text-xs text-white font-mono placeholder-gray-600 focus:border-amber-500"
                                    />
                                </div>

                                <button
                                    onClick={handleSaveServiceAccount}
                                    disabled={savingServiceAccount || !serviceAccountJsonInput.trim()}
                                    className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs shadow-md shadow-amber-600/20 transition disabled:opacity-50"
                                >
                                    {savingServiceAccount ? "Verifying..." : "Save Service Account JSON"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Target Root Folder Modal */}
            {showFolderModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0e0e16] p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3">
                            <h3 className="text-sm font-black text-white flex items-center gap-2">
                                <FiFolder className="text-violet-400" />
                                <span>Change Google Drive Root Folder</span>
                            </h3>
                            <button
                                onClick={() => setShowFolderModal(false)}
                                className="text-gray-400 hover:text-white text-lg font-bold"
                            >
                                ✕
                            </button>
                        </div>

                        <p className="text-xs text-gray-400">
                            Enter the Folder ID of any folder in your personal Google Drive (found in the URL after <code className="text-violet-300">folders/</code>):
                        </p>

                        <div>
                            <label className="text-xs font-bold text-gray-300">Google Drive Folder ID</label>
                            <input
                                type="text"
                                value={newFolderInput}
                                onChange={(e) => setNewFolderInput(e.target.value)}
                                placeholder="1bHf18SyIES1hdnXl7Z7d4x5g_j7mOOmt"
                                className="mt-1 w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-violet-500"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-2">
                            <button
                                onClick={() => setShowFolderModal(false)}
                                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 text-xs font-bold transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateRootFolder}
                                disabled={savingFolder || !newFolderInput.trim()}
                                className="px-5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-black shadow-md shadow-violet-600/20 transition disabled:opacity-50"
                            >
                                {savingFolder ? "Saving..." : "Save & Verify Folder"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
