// services/googleDriveService.js — Google Drive Cloud Storage Integration (OAuth2 & Service Account API v3)
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../config/db");

const DEFAULT_ROOT_FOLDER_ID = process.env.GDRIVE_ROOT_FOLDER_ID || "1bHf18SyIES1hdnXl7Z7d4x5g_j7mOOmt";
const OAUTH_CONFIG_PATH = path.join(__dirname, "../config/google_oauth.json");
const CREDENTIALS_PATH = path.join(__dirname, "../config/google_service_account.json");

let driveClient = null;
let currentAuth = null;
let currentAuthType = null; // "oauth2" | "service_account" | null

/**
 * Gets effective Root Folder ID (from OAuth config, env, or default)
 */
function getEffectiveRootFolderId() {
    if (fs.existsSync(OAUTH_CONFIG_PATH)) {
        try {
            const oauthConfig = JSON.parse(fs.readFileSync(OAUTH_CONFIG_PATH, "utf8"));
            if (oauthConfig.root_folder_id) return oauthConfig.root_folder_id;
        } catch (_) {}
    }
    return process.env.GDRIVE_ROOT_FOLDER_ID || DEFAULT_ROOT_FOLDER_ID;
}

/**
 * Initializes and caches Google Drive Auth client (Prioritizing OAuth 2.0 User Account, then Service Account)
 */
async function getDriveClient() {
    if (driveClient) return driveClient;

    let auth = null;
    let authType = null;

    // 1. Check if OAuth 2.0 User credentials exist in config/google_oauth.json
    if (fs.existsSync(OAUTH_CONFIG_PATH)) {
        try {
            const oauthConfig = JSON.parse(fs.readFileSync(OAUTH_CONFIG_PATH, "utf8"));
            if (oauthConfig.client_id && oauthConfig.client_secret && oauthConfig.refresh_token) {
                const oauth2Client = new google.auth.OAuth2(
                    oauthConfig.client_id,
                    oauthConfig.client_secret,
                    oauthConfig.redirect_uri || "postmessage"
                );

                oauth2Client.setCredentials({
                    refresh_token: oauthConfig.refresh_token,
                    access_token: oauthConfig.access_token,
                    expiry_date: oauthConfig.expiry_date,
                });

                // Auto-save refreshed tokens
                oauth2Client.on("tokens", (tokens) => {
                    try {
                        const existing = JSON.parse(fs.readFileSync(OAUTH_CONFIG_PATH, "utf8"));
                        const updated = {
                            ...existing,
                            access_token: tokens.access_token || existing.access_token,
                            expiry_date: tokens.expiry_date || existing.expiry_date,
                            refresh_token: tokens.refresh_token || existing.refresh_token,
                        };
                        fs.writeFileSync(OAUTH_CONFIG_PATH, JSON.stringify(updated, null, 2), "utf8");
                    } catch (err) {
                        console.warn("[GoogleDrive] Error saving refreshed tokens:", err.message);
                    }
                });

                auth = oauth2Client;
                authType = "oauth2";
            }
        } catch (err) {
            console.warn("[GoogleDrive] Failed to load OAuth config from file:", err.message);
        }
    }

    // 2. Check if OAuth 2.0 is in environment variables
    if (!auth && process.env.GDRIVE_OAUTH_CLIENT_ID && process.env.GDRIVE_OAUTH_CLIENT_SECRET && process.env.GDRIVE_OAUTH_REFRESH_TOKEN) {
        try {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GDRIVE_OAUTH_CLIENT_ID,
                process.env.GDRIVE_OAUTH_CLIENT_SECRET,
                process.env.GDRIVE_OAUTH_REDIRECT_URI || "postmessage"
            );

            oauth2Client.setCredentials({
                refresh_token: process.env.GDRIVE_OAUTH_REFRESH_TOKEN,
                access_token: process.env.GDRIVE_OAUTH_ACCESS_TOKEN,
            });

            auth = oauth2Client;
            authType = "oauth2";
        } catch (err) {
            console.warn("[GoogleDrive] Failed to create OAuth2 auth from env:", err.message);
        }
    }

    // 3. Fallback: Check if service account JSON file exists
    if (!auth && fs.existsSync(CREDENTIALS_PATH)) {
        try {
            auth = new google.auth.GoogleAuth({
                keyFile: CREDENTIALS_PATH,
                scopes: ["https://www.googleapis.com/auth/drive"],
            });
            authType = "service_account";
        } catch (err) {
            console.warn("[GoogleDrive] Failed to load service account credentials:", err.message);
        }
    }

    // 4. Fallback: Check if service account is in env
    if (!auth && process.env.GDRIVE_SERVICE_ACCOUNT_JSON) {
        try {
            const credentials = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
            auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/drive"],
            });
            authType = "service_account";
        } catch (err) {
            console.warn("[GoogleDrive] Failed to parse GDRIVE_SERVICE_ACCOUNT_JSON:", err.message);
        }
    }

    if (!auth) {
        throw new Error(
            "Google Drive credentials not found. Please connect your Personal Google Account (OAuth 2.0) or provide Service Account credentials."
        );
    }

    currentAuth = auth;
    currentAuthType = authType;
    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
}

/**
 * Reset cached client
 */
function resetClient() {
    driveClient = null;
    currentAuth = null;
    currentAuthType = null;
}

/**
 * Generate Google OAuth 2.0 Authorization URL
 */
function generateOAuthUrl({ clientId, clientSecret, redirectUri }) {
    if (!clientId || !clientSecret) {
        throw new Error("Client ID and Client Secret are required to generate authorization URL.");
    }

    const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri || "postmessage"
    );

    const scopes = [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
    ];

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        prompt: "consent",
    });

    return { authUrl };
}

/**
 * Exchange OAuth Authorization Code for tokens and persist
 */
async function exchangeOAuthCode({ code, clientId, clientSecret, redirectUri, rootFolderId }) {
    if (!code || !clientId || !clientSecret) {
        throw new Error("Authorization code, Client ID, and Client Secret are required.");
    }

    const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri || "postmessage"
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user profile info
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    let userInfo = {};
    try {
        const userRes = await oauth2.userinfo.get();
        userInfo = userRes.data || {};
    } catch (_) {}

    const configData = {
        auth_type: "oauth2",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri || "postmessage",
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expiry_date: tokens.expiry_date,
        root_folder_id: rootFolderId || getEffectiveRootFolderId(),
        user_email: userInfo.email,
        user_name: userInfo.name,
        user_picture: userInfo.picture,
        updated_at: new Date().toISOString(),
    };

    const configDir = path.dirname(OAUTH_CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(OAUTH_CONFIG_PATH, JSON.stringify(configData, null, 2), "utf8");
    resetClient();

    const connection = await testConnection(configData.root_folder_id);

    return {
        success: true,
        user: userInfo,
        rootFolderId: configData.root_folder_id,
        connection,
    };
}

/**
 * Manually save OAuth 2.0 Credentials / Tokens
 */
async function saveOAuthCredentials({ clientId, clientSecret, refreshToken, rootFolderId }) {
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Client ID, Client Secret, and Refresh Token are required.");
    }

    const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        "postmessage"
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Test token validity & retrieve user info
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    let userInfo = {};
    try {
        const userRes = await oauth2.userinfo.get();
        userInfo = userRes.data || {};
    } catch (_) {}

    const configData = {
        auth_type: "oauth2",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        root_folder_id: rootFolderId || getEffectiveRootFolderId(),
        user_email: userInfo.email,
        user_name: userInfo.name,
        user_picture: userInfo.picture,
        updated_at: new Date().toISOString(),
    };

    const configDir = path.dirname(OAUTH_CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(OAUTH_CONFIG_PATH, JSON.stringify(configData, null, 2), "utf8");
    resetClient();

    const connection = await testConnection(configData.root_folder_id);

    return {
        success: true,
        user: userInfo,
        rootFolderId: configData.root_folder_id,
        connection,
    };
}

/**
 * Update Root Folder ID
 */
function updateRootFolderId(newFolderId) {
    if (!newFolderId || !newFolderId.trim()) {
        throw new Error("Valid Google Drive folder ID is required.");
    }

    const folderId = newFolderId.trim();

    if (fs.existsSync(OAUTH_CONFIG_PATH)) {
        try {
            const existing = JSON.parse(fs.readFileSync(OAUTH_CONFIG_PATH, "utf8"));
            existing.root_folder_id = folderId;
            fs.writeFileSync(OAUTH_CONFIG_PATH, JSON.stringify(existing, null, 2), "utf8");
        } catch (_) {}
    }

    return { rootFolderId: folderId };
}

/**
 * Disconnect Google OAuth account
 */
function disconnectOAuth() {
    if (fs.existsSync(OAUTH_CONFIG_PATH)) {
        fs.unlinkSync(OAUTH_CONFIG_PATH);
    }
    resetClient();
    return { disconnected: true };
}

/**
 * Get Google Drive Account & 5TB Storage Quota details
 */
async function getDriveAbout() {
    try {
        const drive = await getDriveClient();
        const res = await drive.about.get({
            fields: "user, storageQuota",
        });

        const quota = res.data.storageQuota || {};
        const limitBytes = quota.limit ? Number(quota.limit) : null;
        const usageBytes = quota.usage ? Number(quota.usage) : 0;
        const usageInDriveBytes = quota.usageInDrive ? Number(quota.usageInDrive) : 0;
        const percentUsed = limitBytes ? Math.min(100, (usageBytes / limitBytes) * 100) : null;

        return {
            user: res.data.user || {},
            storageQuota: {
                limitBytes,
                usageBytes,
                usageInDriveBytes,
                percentUsed: percentUsed !== null ? parseFloat(percentUsed.toFixed(2)) : null,
                freeBytes: limitBytes ? Math.max(0, limitBytes - usageBytes) : null,
            },
        };
    } catch (err) {
        return {
            error: err.message,
            storageQuota: null,
        };
    }
}

/**
 * Test connection to target Google Drive folder & verify write permissions
 */
async function testConnection(folderId = null) {
    const targetFolderId = folderId || getEffectiveRootFolderId();
    try {
        const drive = await getDriveClient();
        const res = await drive.files.get({
            fileId: targetFolderId,
            fields: "id, name, mimeType, capabilities, owners, shared, webViewLink",
            supportsAllDrives: true,
        });

        const isFolder = res.data.mimeType === "application/vnd.google-apps.folder";
        const canAddChildren = res.data.capabilities?.canAddChildren ?? true;

        const about = await getDriveAbout();

        return {
            connected: true,
            authType: currentAuthType,
            folderId: res.data.id,
            folderName: res.data.name,
            isFolder,
            canUpload: canAddChildren,
            webViewLink: res.data.webViewLink,
            owners: res.data.owners?.map((o) => o.displayName || o.emailAddress) || [],
            user: about.user,
            storageQuota: about.storageQuota,
        };
    } catch (err) {
        return {
            connected: false,
            authType: currentAuthType,
            error: err.message || "Failed to connect to Google Drive folder",
            folderId: targetFolderId,
            hint:
                currentAuthType === "oauth2"
                    ? "Check that your Google account has access to this folder."
                    : "For personal accounts, connect using OAuth 2.0 or share folder with Service Account as Editor.",
        };
    }
}

const CATEGORY_NAMES = {
    option_chain: "Option Chain",
    futures: "Futures",
    india_vix: "India VIX",
    bitcoin: "Bitcoin",
};

/**
 * Finds or creates a subfolder under a parent folder
 */
async function ensureSubFolder(folderName, parentFolderId) {
    const drive = await getDriveClient();

    // Check if folder already exists under parent
    const query = `'${parentFolderId}' in parents and name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const listRes = await drive.files.list({
        q: query,
        fields: "files(id, name)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    if (listRes.data.files && listRes.data.files.length > 0) {
        return listRes.data.files[0].id;
    }

    // Create new folder
    const createRes = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentFolderId],
        },
        fields: "id, name",
        supportsAllDrives: true,
    });

    return createRes.data.id;
}

/**
 * Ensures Category / Year / Symbol hierarchy:
 * RootFolder -> Category (Option Chain | Futures | India VIX | Bitcoin) -> Year (2023 | 2024 | 2025 | 2026) -> (Optional) Symbol
 */
async function ensureCategoryYearHierarchy(category, year, symbol = null, rootFolderId = null) {
    const effectiveRoot = rootFolderId || getEffectiveRootFolderId();
    const categoryFolderTitle = CATEGORY_NAMES[category] || category || "Option Chain";
    const categoryFolderId = await ensureSubFolder(categoryFolderTitle, effectiveRoot);
    const yearFolderId = await ensureSubFolder(String(year), categoryFolderId);

    let targetFolderId = yearFolderId;
    let symbolFolderId = null;

    if (symbol && category !== "india_vix" && category !== "bitcoin") {
        symbolFolderId = await ensureSubFolder(String(symbol).toUpperCase(), yearFolderId);
        targetFolderId = symbolFolderId;
    }

    return {
        rootFolderId: effectiveRoot,
        categoryFolderId,
        yearFolderId,
        symbolFolderId,
        targetFolderId,
    };
}

/**
 * Pre-creates all 4 core category folders and their 2023-2026 year subfolders
 */
async function initAllCategoryFolders(rootFolderId = null) {
    const effectiveRoot = rootFolderId || getEffectiveRootFolderId();
    const years = ["2023", "2024", "2025", "2026"];
    const results = {};

    for (const [key, name] of Object.entries(CATEGORY_NAMES)) {
        const catId = await ensureSubFolder(name, effectiveRoot);
        results[key] = { id: catId, name, years: {} };

        for (const yr of years) {
            const yrId = await ensureSubFolder(yr, catId);
            results[key].years[yr] = yrId;
        }
    }

    return results;
}

/**
 * Legacy compatibility wrapper for Option Chain
 */
async function ensureYearSymbolHierarchy(year, symbol, rootFolderId = null) {
    return ensureCategoryYearHierarchy("option_chain", year, symbol, rootFolderId);
}

/**
 * Upload a local file to Google Drive under a specific folder
 */
async function uploadFile({ filePath, fileName, mimeType = "application/gzip", parentFolderId }) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found at path: ${filePath}`);
    }

    const drive = await getDriveClient();
    const fileSize = fs.statSync(filePath).size;
    const fileStream = fs.createReadStream(filePath);

    // Calculate SHA256 checksum
    const hash = crypto.createHash("sha256");
    const fileBuffer = fs.readFileSync(filePath);
    hash.update(fileBuffer);
    const checksumSha256 = hash.digest("hex");

    const media = {
        mimeType,
        body: fileStream,
    };

    const requestBody = {
        name: fileName || path.basename(filePath),
        parents: [parentFolderId],
        description: `BazaarSync Cloud Archive - SHA256: ${checksumSha256}`,
    };

    const res = await drive.files.create({
        requestBody,
        media,
        fields: "id, name, size, md5Checksum, webViewLink, webContentLink, createdTime",
        supportsAllDrives: true,
    });

    return {
        fileId: res.data.id,
        fileName: res.data.name,
        sizeBytes: Number(res.data.size || fileSize),
        webViewLink: res.data.webViewLink,
        webContentLink: res.data.webContentLink,
        md5Checksum: res.data.md5Checksum,
        checksumSha256,
        createdTime: res.data.createdTime,
    };
}

/**
 * Download a file from Google Drive to local destination
 */
async function downloadFile({ fileId, destinationPath }) {
    const drive = await getDriveClient();
    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    const destStream = fs.createWriteStream(destinationPath);

    const res = await drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
    );

    return new Promise((resolve, reject) => {
        res.data
            .pipe(destStream)
            .on("finish", () => resolve({ destinationPath, success: true }))
            .on("error", (err) => reject(err));
    });
}

/**
 * Save / Update Google Drive service account credentials
 */
function saveServiceAccountCredentials(jsonString) {
    const parsed = typeof jsonString === "string" ? JSON.parse(jsonString) : jsonString;
    if (!parsed.client_email || !parsed.private_key) {
        throw new Error("Invalid Google Service Account JSON. Missing client_email or private_key.");
    }

    const configDir = path.dirname(CREDENTIALS_PATH);
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(parsed, null, 2), "utf8");
    resetClient();

    return {
        saved: true,
        clientEmail: parsed.client_email,
        projectId: parsed.project_id,
    };
}

/**
 * Get complete authentication status
 */
function getCredentialsStatus() {
    let authType = null;
    let userEmail = null;
    let userName = null;
    let userPicture = null;
    let clientId = null;
    let rootFolderId = getEffectiveRootFolderId();

    if (fs.existsSync(OAUTH_CONFIG_PATH)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(OAUTH_CONFIG_PATH, "utf8"));
            if (parsed.refresh_token) {
                authType = "oauth2";
                userEmail = parsed.user_email;
                userName = parsed.user_name;
                userPicture = parsed.user_picture;
                clientId = parsed.client_id;
                if (parsed.root_folder_id) rootFolderId = parsed.root_folder_id;
            }
        } catch (_) {}
    } else if (process.env.GDRIVE_OAUTH_REFRESH_TOKEN) {
        authType = "oauth2";
        userEmail = process.env.GDRIVE_OAUTH_USER_EMAIL || "Personal Google Account";
        clientId = process.env.GDRIVE_OAUTH_CLIENT_ID;
    }

    if (!authType) {
        if (fs.existsSync(CREDENTIALS_PATH)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
                userEmail = parsed.client_email;
                authType = "service_account";
            } catch (_) {}
        } else if (process.env.GDRIVE_SERVICE_ACCOUNT_JSON) {
            try {
                const parsed = JSON.parse(process.env.GDRIVE_SERVICE_ACCOUNT_JSON);
                userEmail = parsed.client_email;
                authType = "service_account";
            } catch (_) {}
        } else if (process.env.GDRIVE_CLIENT_EMAIL) {
            userEmail = process.env.GDRIVE_CLIENT_EMAIL;
            authType = "service_account";
        }
    }

    return {
        configured: Boolean(authType),
        authType,
        userEmail,
        userName,
        userPicture,
        clientId,
        rootFolderId,
        defaultFolderId: DEFAULT_ROOT_FOLDER_ID,
    };
}

module.exports = {
    getDriveClient,
    testConnection,
    getDriveAbout,
    generateOAuthUrl,
    exchangeOAuthCode,
    saveOAuthCredentials,
    updateRootFolderId,
    disconnectOAuth,
    ensureSubFolder,
    ensureCategoryYearHierarchy,
    initAllCategoryFolders,
    ensureYearSymbolHierarchy,
    uploadFile,
    downloadFile,
    saveServiceAccountCredentials,
    getCredentialsStatus,
    getEffectiveRootFolderId,
    resetClient,
    DEFAULT_ROOT_FOLDER_ID,
    CATEGORY_NAMES,
};
