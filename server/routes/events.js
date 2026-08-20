const express = require("express");
const { listPublishedEvents, listAllEvents, createEvent, updateEvent, deleteEvent } = require("../controllers/eventsController");
const { requireAuth } = require("../middleware/auth");
const { requireAdmin } = require("../middleware/requireAdmin");

const router = express.Router();

// Public — the /events page needs this without requiring login.
router.get("/", listPublishedEvents);

router.get("/admin/all", requireAuth, requireAdmin, listAllEvents);
router.post("/admin", requireAuth, requireAdmin, createEvent);
router.put("/admin/:id", requireAuth, requireAdmin, updateEvent);
router.delete("/admin/:id", requireAuth, requireAdmin, deleteEvent);

module.exports = router;
