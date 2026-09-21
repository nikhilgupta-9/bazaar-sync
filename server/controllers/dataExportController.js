// controllers/dataExportController.js — admin Data Export page: preview row
// counts, download CSV (or a ZIP of several CSVs), and delete those same
// rows from MySQL afterward. See services/dataExportService.js's header for
// the full design rationale (export and delete are deliberately separate
// calls, never combined).

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const dataExportService = require("../services/dataExportService");

const EXPORT_TMP_DIR = path.join(__dirname, "..", "data", "export-tmp");
if (!fs.existsSync(EXPORT_TMP_DIR)) fs.mkdirSync(EXPORT_TMP_DIR, { recursive: true });

function sendError(res, err, fallback) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[dataExportController] ${fallback}:`, err);
    res.status(status).json({ error: err.message || fallback });
}

async function previewExport(req, res) {
    try {
        const { symbol, dataType, year, fromMonth, toMonth } = req.query;
        const result = await dataExportService.countRows({ symbol, dataType, year, fromMonth, toMonth });
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to count rows for export");
    }
}

async function downloadExport(req, res) {
    const { symbol, dataType, year, fromMonth, toMonth } = req.query;
    let tmpFiles = [];
    let zipPath = null;
    try {
        if (!symbol) throw Object.assign(new Error("symbol is required"), { status: 400 });
        const types = dataExportService.resolveTableTypes(dataType);
        const { start, end } = dataExportService.resolveRange({ year, fromMonth, toMonth });
        const rangeLabel = start === end ? start : `${start}_to_${end}`;

        if (types.length === 1) {
            const type = types[0];
            const filename = `${symbol}_${type}_${rangeLabel}.csv`;
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            await dataExportService.writeTableCsv(res, type, symbol, start, end);
            res.end();
            return;
        }

        // Multiple tables (dataType=all) — each table's CSV is written to a
        // temp file on disk (streamed, never held fully in memory — same
        // chunked-query discipline as the single-table path), then zipped.
        // adm-zip itself needs the final zip in memory to write it, but
        // compressed CSV text is typically far smaller than the raw rows —
        // reasonable for one symbol/year, unlike the earlier Dhan pipeline
        // memory issue which was an unbounded cache across 218 symbols.
        const jobId = `${symbol}_${Date.now()}`;
        for (const type of types) {
            const tmpPath = path.join(EXPORT_TMP_DIR, `${jobId}_${type}.csv`);
            const writeStream = fs.createWriteStream(tmpPath);
            await dataExportService.writeTableCsv(writeStream, type, symbol, start, end);
            await new Promise((resolve, reject) => writeStream.end((err) => (err ? reject(err) : resolve())));
            tmpFiles.push({ path: tmpPath, type });
        }

        const zip = new AdmZip();
        for (const f of tmpFiles) {
            zip.addLocalFile(f.path, "", `${symbol}_${f.type}_${rangeLabel}.csv`);
        }
        zipPath = path.join(EXPORT_TMP_DIR, `${jobId}.zip`);
        zip.writeZip(zipPath);

        res.download(zipPath, `${symbol}_${rangeLabel}.zip`, (err) => {
            for (const f of tmpFiles) fs.unlink(f.path, () => {});
            fs.unlink(zipPath, () => {});
            if (err) console.error("[dataExportController] zip download stream error:", err.message);
        });
    } catch (err) {
        for (const f of tmpFiles) fs.unlink(f.path, () => {});
        if (zipPath) fs.unlink(zipPath, () => {});
        if (res.headersSent) {
            res.end();
        } else {
            sendError(res, err, "failed to build export");
        }
    }
}

async function deleteExport(req, res) {
    try {
        const { symbol, dataType, year, fromMonth, toMonth } = req.body || {};
        const result = await dataExportService.deleteRows({ symbol, dataType, year, fromMonth, toMonth });
        res.json(result);
    } catch (err) {
        sendError(res, err, "failed to delete exported rows");
    }
}

module.exports = { previewExport, downloadExport, deleteExport };
