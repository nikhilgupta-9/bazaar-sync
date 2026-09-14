// services/envSettingsService.js — lets the admin panel view/update the
// broker/data-source credentials that live in .env files, instead of
// someone having to SSH in and hand-edit them (Next Steps item: "admin se
// hi .env ke sare access token ... update kr paye").
//
// Scoped deliberately to DATA-SOURCE credentials only (Angel One / Kotak /
// Upstox / ICICI Breeze) — NOT a generic .env editor. DB_PASSWORD,
// JWT_SECRET, RAZORPAY_*, SMTP_* etc. are not exposed here; editing those
// from a web form is a materially bigger blast radius than this feature
// asked for, and none of them need the "update Breeze's daily session
// token" workflow this exists for.
//
// Some of these keys are shared with the standalone data-downloader/ app
// (its own separate .env — see data-downloader/README.md), so an update
// here writes to BOTH files where relevant, keeping them in sync (the same
// manual-sync footgun CLAUDE.md's Gotcha #7 already flags — this replaces
// the "remember to copy it to the other file" step with one button).
//
// Values are NEVER logged. GET responses only ever return a masked preview
// (last 4 characters) — the real value is write-only from the admin's point
// of view once set.

const fs = require("fs");
const path = require("path");

const SERVER_ENV = path.join(__dirname, "..", ".env");
const DATA_DOWNLOADER_ENV = process.env.DATA_DOWNLOADER_DIR
    ? path.join(process.env.DATA_DOWNLOADER_DIR, ".env")
    : path.join(__dirname, "..", "..", "data-downloader", ".env");

// key -> { source, label, files, sensitive, restartNote }
// `files`: which .env files this key should be kept in sync across.
const MANAGED_KEYS = {
    ANGEL_API_KEY: { source: "angelone", label: "API Key", files: [SERVER_ENV] },
    ANGEL_CLIENT_ID: { source: "angelone", label: "Client ID", files: [SERVER_ENV] },
    ANGEL_PASSWORD: { source: "angelone", label: "Login PIN", files: [SERVER_ENV] },
    ANGEL_TOTP_SECRET: { source: "angelone", label: "TOTP Secret", files: [SERVER_ENV] },

    KOTAK_CONSUMER_KEY: { source: "kotak", label: "Consumer Key", files: [SERVER_ENV] },
    KOTAK_CONSUMER_SECRET: { source: "kotak", label: "Consumer Secret", files: [SERVER_ENV] },
    KOTAK_MOBILE: { source: "kotak", label: "Mobile (E.164)", files: [SERVER_ENV] },
    KOTAK_UCC: { source: "kotak", label: "UCC", files: [SERVER_ENV] },
    KOTAK_MPIN: { source: "kotak", label: "MPIN", files: [SERVER_ENV] },
    KOTAK_TOTP_SECRET: { source: "kotak", label: "TOTP Secret", files: [SERVER_ENV] },

    UPSTOX_ACCESS_TOKEN: { source: "upstox", label: "Access Token", files: [SERVER_ENV, DATA_DOWNLOADER_ENV], restartNote: "long-lived (~1yr), no daily refresh needed" },
    UPSTOX_CLIENT_ID: { source: "upstox", label: "Client ID", files: [SERVER_ENV, DATA_DOWNLOADER_ENV] },

    BREEZE_API_KEY: { source: "icici_breeze", label: "API Key", files: [SERVER_ENV, DATA_DOWNLOADER_ENV] },
    BREEZE_API_SECRET: { source: "icici_breeze", label: "API Secret", files: [SERVER_ENV, DATA_DOWNLOADER_ENV] },
    BREEZE_API_SESSION: { source: "icici_breeze", label: "Session Token", files: [SERVER_ENV, DATA_DOWNLOADER_ENV], restartNote: "expires DAILY — get a fresh one via the ICICI login URL each day" },

    // Dhan only ever runs from data-downloader/ (never server/'s own live
    // path) — see data-downloader/dhan/README section — so SERVER_ENV is
    // deliberately not in `files` here, unlike Upstox/Breeze which the
    // server also reads directly.
    DHAN_ACCESS_TOKEN: { source: "dhan", label: "Access Token", files: [DATA_DOWNLOADER_ENV], restartNote: "must be a PERSONAL long-lived token (Dhan app: Profile -> DhanHQ Trading APIs -> Generate Token) — a partner/consent token expires in 24h, confirmed for real" },
    DHAN_CLIENT_ID: { source: "dhan", label: "Client ID", files: [DATA_DOWNLOADER_ENV] },
};

function badRequest(message) {
    return Object.assign(new Error(message), { status: 400 });
}

function readLines(filePath) {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/);
}

function getValueFromLines(lines, key) {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return line !== undefined ? line.slice(key.length + 1) : undefined;
}

function mask(value) {
    if (!value) return null;
    if (value.length <= 4) return "*".repeat(value.length);
    return `${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
}

/** Status of every managed key, grouped by source, with a masked preview per file it lives in. */
function getStatus() {
    const bySource = {};
    for (const [key, meta] of Object.entries(MANAGED_KEYS)) {
        const filesStatus = meta.files.map((filePath) => {
            const lines = readLines(filePath);
            const value = getValueFromLines(lines, key);
            return {
                file: path.basename(path.dirname(filePath)) + "/.env",
                isSet: Boolean(value),
                preview: mask(value),
            };
        });
        const inSync = filesStatus.length < 2 || filesStatus.every((f) => f.preview === filesStatus[0].preview);
        if (!bySource[meta.source]) bySource[meta.source] = [];
        bySource[meta.source].push({
            key,
            label: meta.label,
            files: filesStatus,
            isSet: filesStatus.some((f) => f.isSet),
            inSync,
            restartNote: meta.restartNote || null,
        });
    }
    return bySource;
}

/** Writes `key=value` into one .env file, replacing the existing line if present, appending otherwise. Preserves every other line untouched. */
function writeKeyToFile(filePath, key, value) {
    if (!fs.existsSync(filePath)) {
        throw badRequest(`${filePath} does not exist — create it from .env.example first`);
    }
    const lines = readLines(filePath);
    const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
    const newLine = `${key}=${value}`;
    if (idx >= 0) lines[idx] = newLine;
    else lines.push(newLine);
    // Drop a single trailing empty line the split() may have produced, then
    // rejoin so we don't accumulate blank lines across repeated saves.
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

/**
 * Updates one managed key across every .env file it belongs to, and hot-
 * applies it to this process's `process.env` (best-effort — some things,
 * e.g. anything cached at boot or a separately-running worker/poller
 * process, still need a restart to actually pick it up; callers should
 * surface `restartNote` to the admin, not assume this is instant everywhere).
 */
function updateValue(key, value) {
    const meta = MANAGED_KEYS[key];
    if (!meta) throw badRequest(`"${key}" is not a managed credential`);
    if (typeof value !== "string" || !value.trim()) throw badRequest("value cannot be empty");

    for (const filePath of meta.files) writeKeyToFile(filePath, key, value.trim());
    process.env[key] = value.trim();

    return { key, updatedFiles: meta.files.length, restartNote: meta.restartNote || null };
}

module.exports = { getStatus, updateValue, MANAGED_KEYS, SERVER_ENV, DATA_DOWNLOADER_ENV };
