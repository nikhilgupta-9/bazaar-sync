const express = require("express");
const { createProOrder, verifyProPayment, listPlans, validateCouponForAllPlans } = require("../controllers/subscriptionController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Public — the Pricing page shows real prices (and, with a coupon typed in,
// the real discounted prices) to logged-out visitors too.
router.get("/plans", listPlans);
router.post("/coupon/validate", validateCouponForAllPlans);
router.post("/order", requireAuth, createProOrder);
router.post("/verify", requireAuth, verifyProPayment);

module.exports = router;
