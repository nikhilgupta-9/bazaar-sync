const express = require("express");
const { getContent, updateContent } = require("../controllers/contentController");
const { requireAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

// Public — the /terms page needs this without requiring login.
router.get("/:slug", getContent);
router.put("/:slug", requireAuth, requireAdmin, updateContent);

module.exports = router;
