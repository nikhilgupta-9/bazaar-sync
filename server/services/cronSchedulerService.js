// services/cronSchedulerService.js — Automated Cron Scheduler for GDrive Archival
const cron = require("node-cron");
const db = require("../config/db");
const archivalPipeline = require("./archivalPipelineService");

let scheduledTask = null;
let currentSettings = {
    enabled: false,
    schedule: "0 3 * * *", // Default 3:00 AM IST daily
    targetYears: ["2023", "2024"],
    symbols: ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX", "ZYDUSLIFE"],
    autoPrune: true,
    lastRun: null,
    nextRun: null,
    status: "idle",
};

/**
 * Load settings from DB
 */
async function loadSettings() {
    try {
        const rows = await db.query(`SELECT setting_key, setting_value FROM gdrive_sync_settings`).catch(() => []);
        const map = {};
        rows.forEach((r) => {
            map[r.setting_key] = r.setting_value;
        });

        if (map.cron_enabled !== undefined) {
            currentSettings.enabled = map.cron_enabled === "true" || map.cron_enabled === "1";
        }
        if (map.cron_schedule) {
            currentSettings.schedule = map.cron_schedule;
        }
        if (map.cron_target_years) {
            try {
                currentSettings.targetYears = JSON.parse(map.cron_target_years);
            } catch {}
        }
        if (map.cron_symbols) {
            try {
                currentSettings.symbols = JSON.parse(map.cron_symbols);
            } catch {}
        }
        if (map.cron_auto_prune !== undefined) {
            currentSettings.autoPrune = map.cron_auto_prune === "true" || map.cron_auto_prune === "1";
        }
        if (map.cron_last_run) {
            currentSettings.lastRun = map.cron_last_run;
        }
    } catch (err) {
        console.warn("[CronScheduler] Could not load settings from DB:", err.message);
    }
}

/**
 * Save settings to DB
 */
async function saveSettings(settings) {
    const keys = [
        ["cron_enabled", settings.enabled ? "true" : "false"],
        ["cron_schedule", settings.schedule],
        ["cron_target_years", JSON.stringify(settings.targetYears)],
        ["cron_symbols", JSON.stringify(settings.symbols)],
        ["cron_auto_prune", settings.autoPrune ? "true" : "false"],
    ];

    for (const [k, v] of keys) {
        await db.query(
            `INSERT INTO gdrive_sync_settings (setting_key, setting_value) 
             VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [k, v]
        ).catch(() => {});
    }
}

/**
 * Restart the cron job with current settings
 */
function reschedule() {
    if (scheduledTask) {
        scheduledTask.stop();
        scheduledTask = null;
    }

    if (!currentSettings.enabled) {
        console.log("[CronScheduler] GDrive Archival Cron is disabled.");
        return;
    }

    if (!cron.validate(currentSettings.schedule)) {
        console.error(`[CronScheduler] Invalid cron expression: "${currentSettings.schedule}"`);
        return;
    }

    console.log(`[CronScheduler] Scheduling GDrive Archival with expression: "${currentSettings.schedule}"`);
    scheduledTask = cron.schedule(
        currentSettings.schedule,
        async () => {
            console.log("[CronScheduler] Triggering scheduled Google Drive archival pipeline...");
            currentSettings.lastRun = new Date().toISOString();
            await db.query(
                `INSERT INTO gdrive_sync_settings (setting_key, setting_value) 
                 VALUES ('cron_last_run', ?) 
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [currentSettings.lastRun]
            ).catch(() => {});

            try {
                await archivalPipeline.startArchivalPipeline({
                    targetYears: currentSettings.targetYears,
                    symbols: currentSettings.symbols,
                    autoPrune: currentSettings.autoPrune,
                    source: "cron",
                });
            } catch (err) {
                console.error("[CronScheduler] Scheduled archival run failed:", err.message);
            }
        },
        {
            timezone: "Asia/Kolkata",
        }
    );
}

/**
 * Initialize scheduler on server start
 */
async function init() {
    await loadSettings();
    reschedule();
}

/**
 * Update scheduler settings
 */
async function updateSettings(newSettings) {
    if (newSettings.enabled !== undefined) currentSettings.enabled = Boolean(newSettings.enabled);
    if (newSettings.schedule && cron.validate(newSettings.schedule)) currentSettings.schedule = newSettings.schedule;
    if (Array.isArray(newSettings.targetYears)) currentSettings.targetYears = newSettings.targetYears;
    if (Array.isArray(newSettings.symbols)) currentSettings.symbols = newSettings.symbols;
    if (newSettings.autoPrune !== undefined) currentSettings.autoPrune = Boolean(newSettings.autoPrune);

    await saveSettings(currentSettings);
    reschedule();

    return getStatus();
}

/**
 * Get current scheduler status
 */
function getStatus() {
    return {
        enabled: currentSettings.enabled,
        schedule: currentSettings.schedule,
        targetYears: currentSettings.targetYears,
        symbols: currentSettings.symbols,
        autoPrune: currentSettings.autoPrune,
        lastRun: currentSettings.lastRun,
        pipelineRunning: archivalPipeline.getPipelineStatus().isRunning,
    };
}

// Auto-initialize scheduler
setTimeout(() => {
    init().catch((err) => console.error("[CronScheduler] Init failed:", err));
}, 3000);

module.exports = {
    init,
    updateSettings,
    getStatus,
};
