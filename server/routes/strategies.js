const express = require("express");
const { createStrategy, listStrategies, deleteStrategy } = require("../controllers/strategiesController");
const { requireAuth } = require("../middleware/auth");
const { requirePro } = require("../middleware/requirePro");

const router = express.Router();

router.post("/", requireAuth, requirePro, createStrategy);
router.get("/", requireAuth, listStrategies);
router.delete("/:id", requireAuth, deleteStrategy);

module.exports = router;
