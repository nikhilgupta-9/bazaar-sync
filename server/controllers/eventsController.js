// controllers/eventsController.js — simple admin-managed announcement/
// webinar listing (no registration/ticketing), public read + admin CRUD.
const { pool } = require("../config/db");

// Public — upcoming published events first, then past ones (still shown so
// the page isn't empty right after an event date passes), newest-past-first.
async function listPublishedEvents(req, res) {
    try {
        const [rows] = await pool.query(
            `SELECT id, title, description, event_date, event_time, link, created_at
             FROM events WHERE is_published = TRUE
             ORDER BY (event_date >= CURDATE()) DESC, event_date ASC`
        );
        res.json({ events: rows });
    } catch (err) {
        console.error("[events:listPublished]", err);
        res.status(500).json({ error: "failed to load events" });
    }
}

// Admin — every event regardless of published state.
async function listAllEvents(req, res) {
    try {
        const [rows] = await pool.query("SELECT * FROM events ORDER BY event_date DESC");
        res.json({ events: rows });
    } catch (err) {
        console.error("[events:listAll]", err);
        res.status(500).json({ error: "failed to load events" });
    }
}

async function createEvent(req, res) {
    try {
        const { title, description, eventDate, eventTime, link, isPublished } = req.body || {};
        if (!title || !eventDate) {
            return res.status(400).json({ error: "title and eventDate are required" });
        }
        const [result] = await pool.query(
            `INSERT INTO events (title, description, event_date, event_time, link, is_published, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [title, description || null, eventDate, eventTime || null, link || null, isPublished !== false, req.user.sub]
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) {
        console.error("[events:create]", err);
        res.status(500).json({ error: "failed to create event" });
    }
}

async function updateEvent(req, res) {
    try {
        const { title, description, eventDate, eventTime, link, isPublished } = req.body || {};
        if (!title || !eventDate) {
            return res.status(400).json({ error: "title and eventDate are required" });
        }
        await pool.query(
            `UPDATE events SET title = ?, description = ?, event_date = ?, event_time = ?, link = ?, is_published = ?
             WHERE id = ?`,
            [title, description || null, eventDate, eventTime || null, link || null, isPublished !== false, req.params.id]
        );
        res.status(204).end();
    } catch (err) {
        console.error("[events:update]", err);
        res.status(500).json({ error: "failed to update event" });
    }
}

async function deleteEvent(req, res) {
    try {
        await pool.query("DELETE FROM events WHERE id = ?", [req.params.id]);
        res.status(204).end();
    } catch (err) {
        console.error("[events:delete]", err);
        res.status(500).json({ error: "failed to delete event" });
    }
}

module.exports = { listPublishedEvents, listAllEvents, createEvent, updateEvent, deleteEvent };
