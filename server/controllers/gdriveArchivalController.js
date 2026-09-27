const fs = require("fs");
const path = require("path");
const gdriveService = require("../services/googleDriveService");
const archivalPipeline = require("../services/archivalPipelineService");
const cronScheduler = require("../services/cronSchedulerService");
const importService = require("../services/dataImportService");

const CREDENTIALS_PATH = path.join(__dirname, "../config/google_service_account.json");

function sendError(res, err, fallback) {
    console.error(`[gdriveArchival] ${fallback}:`, err);
    res.status(err.status || 500).json({ error: err.message || fallback });
}

/**
 * Get Google Drive connection status & info (OAuth2 & Service Account details)
 */
async function getGDriveStatus(req, res) {
    try {
        const rootFolderId = gdriveService.getEffectiveRootFolderId();
        const credStatus = gdriveService.getCredentialsStatus();

        let connection = { connected: false, error: null };
        try {
            connection = await gdriveService.testConnection(rootFolderId);
        } catch (err) {
            connection = { connected: false, error: err.message };
        }

        res.json({
            configured: credStatus.configured,
            authType: credStatus.authType || connection.authType,
            userEmail: credStatus.userEmail || connection.user?.emailAddress,
            userName: credStatus.userName || connection.user?.displayName,
            userPicture: credStatus.userPicture || connection.user?.photoLink,
            clientId: credStatus.clientId,
            rootFolderId,
            connection,
            storageQuota: connection.storageQuota || null,
        });
    } catch (err) {
        sendError(res, err, "failed to get Google Drive status");
    }
}

/**
 * Test Google Drive Connection directly
 */
async function testGDriveConnection(req, res) {
    try {
        const folderId = req.body?.folderId || gdriveService.getEffectiveRootFolderId();
        const result = await gdriveService.testConnection(folderId);
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to test Google Drive connection");
    }
}

/**
 * Generate Google OAuth 2.0 Auth URL
 */
async function getOAuthUrl(req, res) {
    try {
        const { clientId, clientSecret, redirectUri } = req.body || {};
        const result = gdriveService.generateOAuthUrl({
            clientId: clientId || process.env.GDRIVE_OAUTH_CLIENT_ID,
            clientSecret: clientSecret || process.env.GDRIVE_OAUTH_CLIENT_SECRET,
            redirectUri: redirectUri || "postmessage",
        });
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to generate Google OAuth URL");
    }
}

/**
 * Handle Google OAuth 2.0 Code Exchange Callback
 */
async function handleOAuthCallback(req, res) {
    try {
        const { code, clientId, clientSecret, redirectUri, rootFolderId } = req.body || {};
        if (!code) {
            return res.status(400).json({ error: "Authorization code is required" });
        }

        const result = await gdriveService.exchangeOAuthCode({
            code,
            clientId: clientId || process.env.GDRIVE_OAUTH_CLIENT_ID,
            clientSecret: clientSecret || process.env.GDRIVE_OAUTH_CLIENT_SECRET,
            redirectUri: redirectUri || "postmessage",
            rootFolderId,
        });

        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to complete Google OAuth token exchange");
    }
}

/**
 * Save Google OAuth 2.0 Client credentials & Refresh token directly
 */
async function saveOAuthCredentials(req, res) {
    try {
        const { clientId, clientSecret, refreshToken, rootFolderId } = req.body || {};
        if (!clientId || !clientSecret || !refreshToken) {
            return res.status(400).json({ error: "clientId, clientSecret, and refreshToken are required" });
        }

        const result = await gdriveService.saveOAuthCredentials({
            clientId,
            clientSecret,
            refreshToken,
            rootFolderId,
        });

        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to save Google OAuth credentials");
    }
}

/**
 * Update Root Folder ID
 */
async function updateRootFolder(req, res) {
    try {
        const { rootFolderId } = req.body || {};
        if (!rootFolderId) {
            return res.status(400).json({ error: "rootFolderId is required" });
        }
        const result = gdriveService.updateRootFolderId(rootFolderId);
        const connection = await gdriveService.testConnection(rootFolderId);
        res.json({ ...result, connection });
    } catch (err) {
        sendError(res, err, "failed to update root folder ID");
    }
}

/**
 * Disconnect Google OAuth account
 */
async function disconnectOAuth(req, res) {
    try {
        const result = gdriveService.disconnectOAuth();
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to disconnect Google OAuth");
    }
}

/**
 * Save Google Service Account credentials JSON (Fallback / Shared Drives)
 */
async function saveGDriveCredentials(req, res) {
    try {
        const { credentialsJson, rootFolderId } = req.body || {};
        if (!credentialsJson) {
            return res.status(400).json({ error: "credentialsJson is required" });
        }

        // Validate JSON
        let parsed;
        try {
            parsed = typeof credentialsJson === "string" ? JSON.parse(credentialsJson) : credentialsJson;
        } catch {
            return res.status(400).json({ error: "Invalid JSON format for service account credentials" });
        }

        if (!parsed.client_email || !parsed.private_key) {
            return res.status(400).json({ error: "Invalid Service Account JSON. Missing client_email or private_key." });
        }

        const configDir = path.join(__dirname, "../config");
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(parsed, null, 2), "utf8");
        gdriveService.resetClient();

        const testRes = await gdriveService.testConnection(rootFolderId || gdriveService.getEffectiveRootFolderId());

        res.json({
            success: true,
            clientEmail: parsed.client_email,
            projectId: parsed.project_id,
            connection: testRes,
        });
    } catch (err) {
        sendError(res, err, "failed to save credentials");
    }
}

/**
 * Get Year-wise Data Coverage & Cloud Archive Matrix
 */
async function getCloudCoverage(req, res) {
    try {
        const matrix = await archivalPipeline.getCloudCoverageMatrix();
        res.json(matrix);
    } catch (err) {
        sendError(res, err, "failed to get cloud coverage matrix");
    }
}

/**
 * Start the pipeline for extraction & GDrive upload
 */
async function startPipeline(req, res) {
    try {
        const { dataTypes, targetYears, symbols, autoPrune } = req.body || {};
        const result = await archivalPipeline.startArchivalPipeline({
            dataTypes,
            targetYears,
            symbols,
            autoPrune,
            source: "manual",
        });
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to start archival pipeline");
    }
}

/**
 * Stop running pipeline
 */
async function stopPipeline(req, res) {
    try {
        const result = archivalPipeline.stopPipeline();
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to stop pipeline");
    }
}

/**
 * Get active pipeline progress & live logs
 */
async function getPipelineStatus(req, res) {
    try {
        const status = archivalPipeline.getPipelineStatus();
        res.json(status);
    } catch (err) {
        sendError(res, err, "failed to get pipeline status");
    }
}

/**
 * Pre-create 4 category folders (Option Chain, Futures, India VIX, Bitcoin) & Year subfolders
 */
async function initDriveFolders(req, res) {
    try {
        const folderId = req.body?.folderId || gdriveService.getEffectiveRootFolderId();
        const results = await gdriveService.initAllCategoryFolders(folderId);
        res.json({ success: true, folders: results });
    } catch (err) {
        sendError(res, err, "failed to initialize Google Drive folder structure");
    }
}

/**
 * Manually archive a single batch (category + symbol + year)
 */
async function manualArchiveBatch(req, res) {
    try {
        const { dataType = "option_chain", symbol, year, autoPrune = true } = req.body || {};
        if (!year) {
            return res.status(400).json({ error: "year is required" });
        }

        const result = await archivalPipeline.processBatch({
            dataType,
            symbol,
            year: parseInt(year),
            autoPrune,
        });
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to archive batch");
    }
}

/**
 * Get cron scheduler status
 */
async function getCronStatus(req, res) {
    try {
        const status = cronScheduler.getStatus();
        res.json(status);
    } catch (err) {
        sendError(res, err, "failed to get cron status");
    }
}

/**
 * Update cron scheduler settings
 */
async function updateCronSettings(req, res) {
    try {
        const updated = await cronScheduler.updateSettings(req.body || {});
        res.json(updated);
    } catch (err) {
        sendError(res, err, "failed to update cron settings");
    }
}

/**
 * List files and folders from Google Drive
 */
async function listGDriveFiles(req, res) {
    try {
        const { folderId, query, pageSize } = req.query || {};
        const result = await gdriveService.listDriveFiles({
            folderId: folderId || null,
            query: query || "",
            pageSize: Number(pageSize) || 60,
        });
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to list Google Drive files");
    }
}

/**
 * Import historical data directly from a Google Drive file / share link
 */
async function importFromGDrive(req, res) {
    try {
        const { fileId, driveUrl, table = "option_chain_history" } = req.body || {};
        const effectiveFileId = gdriveService.extractDriveFileId(fileId || driveUrl);

        if (!effectiveFileId) {
            return res.status(400).json({ error: "Please provide a valid Google Drive File ID or Share URL." });
        }

        console.log(`[GDriveImport] Starting import from GDrive File ID: ${effectiveFileId} into table: ${table}...`);
        const { meta, stream } = await gdriveService.getDriveFileStream({ fileId: effectiveFileId });

        const importRes = await importService.importFromStream({
            readableStream: stream,
            fileName: meta.name || "gdrive_file.csv",
            table,
        });

        console.log(`[GDriveImport] ✅ Successfully imported ${importRes.written} rows from "${meta.name}" into ${table}!`);

        res.status(201).json({
            success: true,
            written: importRes.written,
            fileName: meta.name,
            sizeBytes: Number(meta.size || 0),
            webViewLink: meta.webViewLink || null,
            table,
        });
    } catch (err) {
        if (err.rowErrors) {
            return res.status(400).json({
                error: err.message || "CSV rows failed validation",
                rowErrors: err.rowErrors,
            });
        }
        sendError(res, err, "failed to import data from Google Drive");
    }
}

module.exports = {
    getGDriveStatus,
    testGDriveConnection,
    getOAuthUrl,
    handleOAuthCallback,
    saveOAuthCredentials,
    updateRootFolder,
    disconnectOAuth,
    saveGDriveCredentials,
    getCloudCoverage,
    startPipeline,
    stopPipeline,
    getPipelineStatus,
    initDriveFolders,
    manualArchiveBatch,
    getCronStatus,
    updateCronSettings,
    listGDriveFiles,
    importFromGDrive,
};
