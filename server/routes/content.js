const express = require("express");
const { getContent, updateContent, uploadImage } = require("../controllers/contentController");
const { requireAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/requireAdmin");
const { upload } = require("../middleware/upload");

const router = express.Router();

// Must come before the generic "/:slug" GET below, otherwise "uploads" would
// be parsed as a slug lookup.
router.post("/uploads", requireAuth, requireAdmin, (req, res) => {
    upload.single("image")(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message || "Upload failed" });
        uploadImage(req, res);
    });
});

// Public — the /terms page needs this without requiring login.
router.get("/:slug", getContent);
router.put("/:slug", requireAuth, requireAdmin, updateContent);

module.exports = router;
