const express = require("express");
const { createProOrder, verifyProPayment } = require("../controllers/subscriptionController");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/order", requireAuth, createProOrder);
router.post("/verify", requireAuth, verifyProPayment);

module.exports = router;
