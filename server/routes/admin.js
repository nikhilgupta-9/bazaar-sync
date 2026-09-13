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
    startExtractionJob, listExtractionJobs, getExtractionJob, cancelExtractionJob, failExtractionJob, deleteExtractionJob,
    getCoverageSummary, getCoverageDetail, getExpiryStatus, getGreeksCoverage, refreshCoverageCache,
    importData,
} = require("../controllers/dataOpsController");
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

router.get("/data/coverage/summary", getCoverageSummary);
router.get("/data/coverage/detail", getCoverageDetail);
router.post("/data/coverage/refresh", refreshCoverageCache);
router.get("/data/expiry-status", getExpiryStatus);
router.get("/data/greeks-coverage", getGreeksCoverage);

router.post("/data/import", importData);

module.exports = router;
