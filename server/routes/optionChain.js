const express = require("express");
const { getOptionChain } = require("../controllers/optionChainController");

const router = express.Router();

router.get("/:symbol", getOptionChain);

module.exports = router;
