const express = require("express");
const {
    listUsers, getUserDetail, getOverview, listPayments, listAllPositions, listAllStrategies,
    listInstituteIps, addInstituteIp, removeInstituteIp,
    listPlansAdmin, createPlanAdmin, updatePlanAdmin, setPlanActiveAdmin, deletePlanAdmin,
    listCoupons, createCoupon, setCouponActive, deleteCoupon,
    listLotSizeHistoryAdmin, addLotSizeHistoryEntry, bulkImportLotSizeHistory, removeLotSizeHistoryEntry,
} = require("../controllers/adminController");
const {
    getEnvStatus, updateEnvValue,
    startExtractionJob, listExtractionJobs, getExtractionJob, cancelExtractionJob, failExtractionJob, deleteExtractionJob, restartExtractionJob,
    getCoverageSummary, getCoverageDetail, getCoverageDays, getCoverageMinutes, getCoverageMinuteRows, getExpiryStatus, getGreeksCoverage, refreshCoverageCache,
    importData,
    getDiskUsage, exportData, previewDataPrune, executeDataPrune,
} = require("../controllers/dataOpsController");
const { previewExport, downloadExport, deleteExport } = require("../controllers/dataExportController");
const { requireAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get("/overview", getOverview);
router.get("/users", listUsers);
router.get("/users/:id", getUserDetail);
router.get("/payments", listPayments);
router.get("/positions", listAllPositions);
router.get("/strategies", listAllStrategies);

router.get("/institute-ips", listInstituteIps);
router.post("/institute-ips", addInstituteIp);
router.delete("/institute-ips/:id", removeInstituteIp);

router.get("/plans", listPlansAdmin);
router.post("/plans", createPlanAdmin);
router.put("/plans/:id", updatePlanAdmin);
router.patch("/plans/:id", setPlanActiveAdmin);
router.delete("/plans/:id", deletePlanAdmin);

router.get("/coupons", listCoupons);
router.post("/coupons", createCoupon);
router.patch("/coupons/:id", setCouponActive);
router.delete("/coupons/:id", deleteCoupon);

router.get("/lot-size-history", listLotSizeHistoryAdmin);
router.post("/lot-size-history", addLotSizeHistoryEntry);
router.post("/lot-size-history/bulk", bulkImportLotSizeHistory);
router.delete("/lot-size-history/:id", removeLotSizeHistoryEntry);

// --- Data section (2026-09-13): credentials, extraction jobs, coverage/
// expiry/Greeks reporting, manual CSV import. See dataOpsController.js. ---
router.get("/data/env", getEnvStatus);
router.post("/data/env", updateEnvValue);

router.post("/data/jobs", startExtractionJob);
router.get("/data/jobs", listExtractionJobs);
router.get("/data/jobs/:id", getExtractionJob);
router.post("/data/jobs/:id/cancel", cancelExtractionJob);
router.post("/data/jobs/:id/fail", failExtractionJob);
router.delete("/data/jobs/:id", deleteExtractionJob);
router.post("/data/jobs/:id/restart", restartExtractionJob);

router.get("/data/coverage/summary", getCoverageSummary);
router.get("/data/coverage/detail", getCoverageDetail);
router.get("/data/coverage/days", getCoverageDays);
router.get("/data/coverage/minutes", getCoverageMinutes);
router.get("/data/coverage/minute-rows", getCoverageMinuteRows);
router.post("/data/coverage/refresh", refreshCoverageCache);
router.get("/data/expiry-status", getExpiryStatus);
router.get("/data/greeks-coverage", getGreeksCoverage);

router.post("/data/import", importData);
router.get("/data/disk-usage", getDiskUsage);
router.get("/data/export", exportData);
router.post("/data/prune-preview", previewDataPrune);
router.post("/data/prune", executeDataPrune);

const {
    getGDriveStatus, testGDriveConnection, saveGDriveCredentials,
    getCloudCoverage, startPipeline, stopPipeline, getPipelineStatus,
    initDriveFolders, manualArchiveBatch, getCronStatus, updateCronSettings,
    getOAuthUrl, handleOAuthCallback, saveOAuthCredentials, disconnectOAuth, updateRootFolder,
    listGDriveFiles, importFromGDrive,
} = require("../controllers/gdriveArchivalController");

router.get("/data/gdrive/status", getGDriveStatus);
router.post("/data/gdrive/test", testGDriveConnection);
router.post("/data/gdrive/credentials", saveGDriveCredentials);
router.post("/data/gdrive/oauth/url", getOAuthUrl);
router.post("/data/gdrive/oauth/callback", handleOAuthCallback);
router.post("/data/gdrive/oauth/credentials", saveOAuthCredentials);
router.post("/data/gdrive/oauth/disconnect", disconnectOAuth);
router.post("/data/gdrive/root-folder", updateRootFolder);
router.post("/data/gdrive/init-folders", initDriveFolders);
router.get("/data/gdrive/coverage", getCloudCoverage);
router.post("/data/gdrive/pipeline/start", startPipeline);
router.post("/data/gdrive/pipeline/stop", stopPipeline);
router.get("/data/gdrive/pipeline/status", getPipelineStatus);
router.post("/data/gdrive/manual-archive", manualArchiveBatch);
router.get("/data/gdrive/cron", getCronStatus);
router.post("/data/gdrive/cron", updateCronSettings);
router.get("/data/gdrive/files", listGDriveFiles);
router.post("/data/gdrive/import", importFromGDrive);

router.get("/data/export/preview", previewExport);
router.get("/data/export/download", downloadExport);
router.post("/data/export/delete", deleteExport);

module.exports = router;

