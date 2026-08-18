const express = require("express");
const { createProOrder, verifyProPayment, listPlans } = require("../controllers/subscriptionController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Public — the Pricing page shows real prices to logged-out visitors too.
router.get("/plans", listPlans);
router.post("/order", requireAuth, createProOrder);
router.post("/verify", requireAuth, verifyProPayment);

module.exports = router;
