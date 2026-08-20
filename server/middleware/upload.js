// middleware/upload.js — image uploads for admin-editable page content (Home
// page hero/about/tool-card images, see contentController.js). Local disk
// storage under server/uploads/ (gitignored, served statically by
// server.js), not S3/Cloudinary — this project has no cloud storage account
// and the Hostinger VPS deployment (README.md) already serves client/dist
// and admin/dist as static files from the same box, so a static-served
// local folder fits the existing architecture rather than adding a new
// external dependency.
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"]);
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : "";
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
            return cb(new Error("Only JPEG, PNG, WEBP, GIF or SVG images are allowed"));
        }
        cb(null, true);
    },
});

module.exports = { upload, UPLOAD_DIR };
