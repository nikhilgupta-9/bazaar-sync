// routes/equity.js — Express routes for Equity Hub
const express = require("express");
const {
    getMarketMap,
    get52WeekHighLow,
    getIndustryMomentum,
    getMostActive,
    getSectorIndices,
} = require("../controllers/equityController");

const router = express.Router();

router.get("/market-map", getMarketMap);
router.get("/52-week-high-low", get52WeekHighLow);
router.get("/industry-momentum", getIndustryMomentum);
router.get("/most-active", getMostActive);
router.get("/sectors", getSectorIndices);

module.exports = router;
