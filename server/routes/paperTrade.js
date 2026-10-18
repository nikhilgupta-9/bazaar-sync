const express = require("express");
const { getWallet, createRefillOrder, verifyRefillPayment } = require("../controllers/paperWalletController");
const {
    openPosition,
    openStrategy,
    closePosition,
    closeAllPositions,
    listPositions,
    placeOrder,
    cancelOrder,
    listOrders,
    updatePositionBracket,
    getLeaderboard,
} = require("../controllers/paperPositionController");
const { requireAuth } = require("../middleware/auth");
const { requirePro } = require("../middleware/requirePro");
const { requirePaperAccess } = require("../middleware/requirePaperAccess");

const router = express.Router();

router.get("/wallet", requireAuth, getWallet);
router.get("/leaderboard", requireAuth, getLeaderboard);
router.post("/refill/order", requireAuth, requirePro, createRefillOrder);
router.post("/refill/verify", requireAuth, requirePro, verifyRefillPayment);

// Positions
router.get("/positions", requireAuth, listPositions);
router.post("/positions", requireAuth, requirePaperAccess, openPosition);
router.post("/positions/:id/bracket", requireAuth, requirePaperAccess, updatePositionBracket);
router.post("/strategy", requireAuth, requirePaperAccess, openStrategy);
router.post("/positions/close-all", requireAuth, requirePaperAccess, closeAllPositions);
router.post("/positions/:id/close", requireAuth, requirePaperAccess, closePosition);

// Orders (Market, Limit, SL, SL-M)
router.get("/orders", requireAuth, listOrders);
router.post("/orders", requireAuth, requirePaperAccess, placeOrder);
router.delete("/orders/:id", requireAuth, requirePaperAccess, cancelOrder);
router.post("/orders/:id/cancel", requireAuth, requirePaperAccess, cancelOrder);

module.exports = router;
