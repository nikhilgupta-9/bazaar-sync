const express = require("express");
const { getSeoMeta, listAllSeoMeta, upsertSeoMeta, deleteSeoMeta } = require("../controllers/seoController");
const { requireAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

// Public — usePageSeo.js fetches this on every route change, no login needed.
router.get("/", getSeoMeta);

router.get("/admin/all", requireAuth, requireAdmin, listAllSeoMeta);
router.post("/admin", requireAuth, requireAdmin, upsertSeoMeta);
router.delete("/admin/:id", requireAuth, requireAdmin, deleteSeoMeta);

module.exports = router;
