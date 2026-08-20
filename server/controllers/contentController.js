// controllers/contentController.js — generic slug->content editor (site_content
// table). 'terms' is the plain-text T&C editor (CLAUDE.md Phase 11); 'home'
// (added later) stores the Home page's editable copy/images as a JSON blob
// in the same LONGTEXT `content` column — client/src/pages/Home.jsx parses
// it and merges over its own hardcoded defaults, so an empty/never-edited
//'home' row (or a row missing a given field) still renders the original
// page, never a blank section.
const { pool } = require("../config/db");

const ALLOWED_SLUGS = ["terms", "home"];

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

// POST /api/content/uploads — admin-only image upload backing the Home page
// editor (hero/about/tool-card images). multer has already written the file
// to server/uploads/ by the time this runs (see middleware/upload.js); this
// just reports back the public URL the client should store in the JSON
// content it saves via PUT /api/content/home.
function uploadImage(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: "No image file uploaded" });
    }
    res.json({ url: `/uploads/${req.file.filename}` });
}

module.exports = { getContent, updateContent, uploadImage };
