const express = require("express");
const { listUsers, getUserDetail, getOverview, listPayments, listAllPositions, listAllStrategies } = require("../controllers/adminController");
const { requireAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

router.get("/overview", requireAuth, requireAdmin, getOverview);
router.get("/users", requireAuth, requireAdmin, listUsers);
router.get("/users/:id", requireAuth, requireAdmin, getUserDetail);
router.get("/payments", requireAuth, requireAdmin, listPayments);
router.get("/positions", requireAuth, requireAdmin, listAllPositions);
router.get("/strategies", requireAuth, requireAdmin, listAllStrategies);

module.exports = router;
