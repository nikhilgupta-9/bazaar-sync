const express = require("express");
const { getWallet, createRefillOrder, verifyRefillPayment } = require("../controllers/paperWalletController");
const { openPosition, closePosition, listPositions } = require("../controllers/paperPositionController");
const { requireAuth } = require("../middleware/auth");
const { requirePro } = require("../middleware/requirePro");
const { requirePaperAccess } = require("../middleware/requirePaperAccess");

const router = express.Router();

router.get("/wallet", requireAuth, getWallet);
router.post("/refill/order", requireAuth, requirePro, createRefillOrder);
router.post("/refill/verify", requireAuth, requirePro, verifyRefillPayment);

router.get("/positions", requireAuth, listPositions);
router.post("/positions", requireAuth, requirePaperAccess, openPosition);
router.post("/positions/:id/close", requireAuth, requirePaperAccess, closePosition);

module.exports = router;
