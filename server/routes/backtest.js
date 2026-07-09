const express = require("express");
const { postBacktest, saveBacktest, listBacktests } = require("../controllers/backtestController");
const { requireAuth } = require("../middleware/auth");
const { requirePro } = require("../middleware/requirePro");

const router = express.Router();

// Backtesting itself (not just saving a result) is Pro-only per the hard
// rules: "Free tier users cannot access Strategy Builder save, Backtesting,
// or full history" — Free tier is "Live dashboard only".
router.post("/", requireAuth, requirePro, postBacktest);
router.post("/save", requireAuth, requirePro, saveBacktest);
router.get("/saved", requireAuth, listBacktests);

module.exports = router;
