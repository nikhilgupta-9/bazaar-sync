// services/instituteAccessService.js — institute free access via IP
// allowlist (see CLAUDE.md: confirmed as IP-based, not MAC — browsers don't
// expose device MAC addresses to a website). An allowlisted IP/CIDR grants a
// logged-in user Pro-equivalent access for that request; it never mutates
// users.tier — see requirePro.js/requirePaperAccess.js for where this is
// OR'd into the existing Pro check, and authController.js's `me` for how the
// client learns about it.
const { pool } = require("../config/db");

// Express's req.ip, when trust proxy is off (the default), often comes back
// as an IPv4-mapped IPv6 address for IPv4 connections ('::ffff:127.0.0.1') —
// normalize before comparing against admin-entered plain IPv4 entries.
function normalizeIp(ip) {
    if (!ip) return ip;
    return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function ipToInt(ip) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// entry is either a plain IP ('203.0.113.5') or CIDR ('203.0.113.0/24').
// IPv6 only supports exact match (no CIDR arithmetic implemented for it).
function matchesEntry(ip, entry) {
    if (entry.includes("/")) {
        const [range, prefixStr] = entry.split("/");
        const prefix = Number(prefixStr);
        const ipInt = ipToInt(ip);
        const rangeInt = ipToInt(range);
        if (ipInt === null || rangeInt === null || Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;
        const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
        return (ipInt & mask) === (rangeInt & mask);
    }
    return ip === entry;
}

async function isInstituteIp(rawIp) {
    const ip = normalizeIp(rawIp);
    if (!ip) return false;
    const [rows] = await pool.query("SELECT ip_or_cidr FROM institute_ip_allowlist");
    return rows.some((r) => matchesEntry(ip, r.ip_or_cidr));
}

module.exports = { isInstituteIp, normalizeIp };
