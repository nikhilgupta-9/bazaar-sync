// server/controllers/adminSecurityController.js — Admin IP restriction and security endpoints
const adminSecurityService = require("../services/adminSecurityService");

async function getAdminSecurityStatus(req, res) {
    try {
        const status = await adminSecurityService.getSecurityStatus(req);
        res.json(status);
    } catch (err) {
        console.error("[getAdminSecurityStatus]", err);
        res.status(500).json({ error: err.message || "Failed to fetch security status" });
    }
}

async function toggleAdminIpRestriction(req, res) {
    try {
        const { enabled } = req.body;
        const result = await adminSecurityService.toggleIpRestriction(enabled, req);
        res.json(result);
    } catch (err) {
        console.error("[toggleAdminIpRestriction]", err);
        res.status(500).json({ error: err.message || "Failed to update IP restriction setting" });
    }
}

async function addAdminAllowedIp(req, res) {
    try {
        const { ipOrCidr, label } = req.body;
        const result = await adminSecurityService.addAllowedIp({
            ip_or_cidr: ipOrCidr,
            label,
        });
        res.status(201).json(result);
    } catch (err) {
        console.error("[addAdminAllowedIp]", err);
        res.status(400).json({ error: err.message || "Failed to add allowed IP" });
    }
}

async function removeAdminAllowedIp(req, res) {
    try {
        const { id } = req.params;
        const result = await adminSecurityService.removeAllowedIp(id);
        res.json(result);
    } catch (err) {
        console.error("[removeAdminAllowedIp]", err);
        res.status(500).json({ error: err.message || "Failed to remove allowed IP" });
    }
}

module.exports = {
    getAdminSecurityStatus,
    toggleAdminIpRestriction,
    addAdminAllowedIp,
    removeAdminAllowedIp,
};
