// controllers/seoController.js — per-page meta tag editor (title/description/
// og:image per client route). See client/src/hooks/usePageSeo.js for how
// these get applied — client-side only (no SSR), so this helps JS-executing
// crawlers but isn't full SSR-grade SEO; stated honestly, not oversold.
const { pool } = require("../config/db");

// Public — GET /api/seo?path=/pricing. Returns null fields (not 404) when
// nothing's been set for that path, so the hook can just skip applying tags.
async function getSeoMeta(req, res) {
    try {
        const path = req.query.path || "/";
        const [[row]] = await pool.query(
            "SELECT path, title, description, og_image FROM seo_meta WHERE path = ?", [path]
        );
        res.json(row || { path, title: null, description: null, og_image: null });
    } catch (err) {
        console.error("[seo:get]", err);
        res.status(500).json({ error: "failed to load SEO meta" });
    }
}

async function listAllSeoMeta(req, res) {
    try {
        const [rows] = await pool.query("SELECT * FROM seo_meta ORDER BY path ASC");
        res.json({ entries: rows });
    } catch (err) {
        console.error("[seo:listAll]", err);
        res.status(500).json({ error: "failed to load SEO entries" });
    }
}

async function upsertSeoMeta(req, res) {
    try {
        const { path, title, description, ogImage } = req.body || {};
        if (!path || !path.startsWith("/")) {
            return res.status(400).json({ error: "path is required and must start with /" });
        }
        await pool.query(
            `INSERT INTO seo_meta (path, title, description, og_image, updated_by) VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description),
               og_image = VALUES(og_image), updated_by = VALUES(updated_by)`,
            [path, title || null, description || null, ogImage || null, req.user.sub]
        );
        res.status(204).end();
    } catch (err) {
        console.error("[seo:upsert]", err);
        res.status(500).json({ error: "failed to save SEO entry" });
    }
}

async function deleteSeoMeta(req, res) {
    try {
        await pool.query("DELETE FROM seo_meta WHERE id = ?", [req.params.id]);
        res.status(204).end();
    } catch (err) {
        console.error("[seo:delete]", err);
        res.status(500).json({ error: "failed to delete SEO entry" });
    }
}

module.exports = { getSeoMeta, listAllSeoMeta, upsertSeoMeta, deleteSeoMeta };
