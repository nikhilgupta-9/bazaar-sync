// server/services/adminSecurityService.js — Admin IP restriction and security manager
const { pool } = require("../config/db");

function normalizeIp(ip) {
    if (!ip) return "";
    let clean = ip.trim();
    if (clean.startsWith("::ffff:")) {
        clean = clean.slice(7);
    }
    return clean;
}

function getClientIp(req) {
    if (!req) return "";
    const headers = req.headers || {};
    const xForwardedFor = headers["x-forwarded-for"] || headers["cf-connecting-ip"] || headers["x-real-ip"];
    let rawIp = "";
    if (xForwardedFor) {
        rawIp = xForwardedFor.split(",")[0].trim();
    }
    if (!rawIp) {
        rawIp = req.ip || req.socket?.remoteAddress || "";
    }
    return normalizeIp(rawIp);
}

function ipToInt(ip) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function matchesEntry(ip, entry) {
    if (!ip || !entry) return false;
    const cleanIp = normalizeIp(ip);
    const cleanEntry = normalizeIp(entry);

    if (cleanIp === cleanEntry) return true;

    // CIDR range matching for IPv4
    if (cleanEntry.includes("/")) {
        const [range, prefixStr] = cleanEntry.split("/");
        const prefix = Number(prefixStr);
        const ipInt = ipToInt(cleanIp);
        const rangeInt = ipToInt(range);
        if (ipInt === null || rangeInt === null || Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;
        const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
        return (ipInt & mask) === (rangeInt & mask);
    }

    return false;
}

async function isIpRestrictionEnabled() {
    try {
        const [[row]] = await pool.query(
            "SELECT setting_value FROM admin_security_settings WHERE setting_key = 'ip_restriction_enabled'"
        );
        return row ? row.setting_value === "1" : false;
    } catch (err) {
        console.error("[adminSecurityService:isIpRestrictionEnabled]", err.message);
        return false;
    }
}

async function getAllowedIps() {
    try {
        const [rows] = await pool.query(
            "SELECT id, ip_or_cidr, label, created_at, updated_at FROM admin_ip_allowlist ORDER BY id DESC"
        );
        return rows || [];
    } catch (err) {
        console.error("[adminSecurityService:getAllowedIps]", err.message);
        return [];
    }
}

async function isIpAllowed(rawIp) {
    const clientIp = normalizeIp(rawIp);
    const enabled = await isIpRestrictionEnabled();
    if (!enabled) {
        return { allowed: true, isRestricted: false, clientIp };
    }

    // Always allow localhost in development/local environments
    if (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "localhost") {
        return { allowed: true, isRestricted: true, clientIp, isLocalhost: true };
    }

    const rows = await getAllowedIps();
    const isMatched = rows.some((r) => matchesEntry(clientIp, r.ip_or_cidr));

    return {
        allowed: isMatched,
        isRestricted: true,
        clientIp,
        matched: isMatched,
    };
}

async function getSecurityStatus(req) {
    const clientIp = getClientIp(req);
    const isRestricted = await isIpRestrictionEnabled();
    const allowedIps = await getAllowedIps();

    const isCurrentIpAllowed = !isRestricted ||
        clientIp === "127.0.0.1" ||
        clientIp === "::1" ||
        allowedIps.some((r) => matchesEntry(clientIp, r.ip_or_cidr));

    return {
        clientIp,
        isRestricted,
        allowedIps,
        isCurrentIpAllowed,
    };
}

async function addAllowedIp({ ip_or_cidr, label }) {
    if (!ip_or_cidr || !ip_or_cidr.trim()) {
        throw new Error("IP address or CIDR range is required");
    }
    const cleanEntry = ip_or_cidr.trim();
    // Validate entry format (IPv4, IPv6, or CIDR)
    if (!cleanEntry.includes("/") && !cleanEntry.includes(":") && ipToInt(cleanEntry) === null) {
        throw new Error("Invalid IP address format");
    }

    const [res] = await pool.query(
        "INSERT INTO admin_ip_allowlist (ip_or_cidr, label) VALUES (?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label)",
        [cleanEntry, label?.trim() || null]
    );
    return { success: true, id: res.insertId, ip_or_cidr: cleanEntry };
}

async function removeAllowedIp(id) {
    await pool.query("DELETE FROM admin_ip_allowlist WHERE id = ?", [id]);
    return { success: true };
}

async function toggleIpRestriction(enable, req) {
    const shouldEnable = Boolean(enable);
    const clientIp = getClientIp(req);

    if (shouldEnable) {
        // Safety lock check: Ensure at least one entry exists, or auto-add current client IP
        const rows = await getAllowedIps();
        if (rows.length === 0 && clientIp) {
            await pool.query(
                "INSERT IGNORE INTO admin_ip_allowlist (ip_or_cidr, label) VALUES (?, 'Current Admin IP (Auto)')",
                [clientIp]
            );
        }
    }

    await pool.query(
        "INSERT INTO admin_security_settings (setting_key, setting_value) VALUES ('ip_restriction_enabled', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
        [shouldEnable ? "1" : "0"]
    );

    return {
        success: true,
        isRestricted: shouldEnable,
        clientIp,
    };
}

module.exports = {
    normalizeIp,
    getClientIp,
    matchesEntry,
    isIpRestrictionEnabled,
    getAllowedIps,
    isIpAllowed,
    getSecurityStatus,
    addAllowedIp,
    removeAllowedIp,
    toggleIpRestriction,
};
