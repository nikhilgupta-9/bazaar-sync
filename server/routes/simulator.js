const express = require("express");
const router = express.Router();
const { listDates, getChainAtTime, replay, getCandles } = require("../controllers/simulatorController");

router.get("/dates/:symbol", listDates);
router.get("/chain/:symbol", getChainAtTime);
router.get("/candles/:symbol", getCandles);
router.post("/replay/:symbol", replay);

module.exports = router;
