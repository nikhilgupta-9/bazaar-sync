// controllers/contentController.js — generic slug->content editor (site_content
// table). Only 'terms' is used today (T&C editor), see CLAUDE.md Phase 11.
const { pool } = require("../config/db");

const ALLOWED_SLUGS = ["terms"];

// Public — returns null fields (not 404) when nothing's been written yet,
// so the client page can show "not published yet" instead of erroring.
async function getContent(req, res) {
    try {
        const [[row]] = await pool.query("SELECT slug, title, content, updated_at FROM site_content WHERE slug = ?", [req.params.slug]);
        res.json(row || { slug: req.params.slug, title: null, content: null, updated_at: null });
    } catch (err) {
        console.error("[content:get]", err);
        res.status(500).json({ error: "failed to load content" });
    }
}

async function updateContent(req, res) {
    try {
        const { slug } = req.params;
        if (!ALLOWED_SLUGS.includes(slug)) {
            return res.status(400).json({ error: `unknown content slug — allowed: ${ALLOWED_SLUGS.join(", ")}` });
        }
        const { title, content } = req.body || {};
        await pool.query(
            `INSERT INTO site_content (slug, title, content, updated_by) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), updated_by = VALUES(updated_by)`,
            [slug, title || null, content || "", req.user.sub]
        );
        res.status(204).end();
    } catch (err) {
        console.error("[content:update]", err);
        res.status(500).json({ error: "failed to save content" });
    }
}

module.exports = { getContent, updateContent };
