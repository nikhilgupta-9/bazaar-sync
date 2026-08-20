const express = require("express");
const {
    listUsers, getUserDetail, getOverview, listPayments, listAllPositions, listAllStrategies,
    listInstituteIps, addInstituteIp, removeInstituteIp,
    listCoupons, createCoupon, setCouponActive, deleteCoupon,
} = require("../controllers/adminController");
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

router.get("/coupons", listCoupons);
router.post("/coupons", createCoupon);
router.patch("/coupons/:id", setCouponActive);
router.delete("/coupons/:id", deleteCoupon);

module.exports = router;
