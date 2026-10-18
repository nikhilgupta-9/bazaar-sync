// server/scripts/drive2026Inventory.js — READ-ONLY check of what 2026 data is really on Google Drive.
//
// Lists <root>/Option Chain/<YEAR>/<SYM>/<SYM>_<YEAR>_option_chain.csv.gz and
// <root>/Stocks OHLCV/<YEAR>/<SYM>/<SYM>_<YEAR>_ohlcv.csv.gz straight from the
// Drive API (not the gdrive_archive_records table, not the runner's progress
// file) and compares them with the 7 indices + every live Upstox F&O stock.
// Writes data-downloader/data/drive-<YEAR>-inventory.json.
//
//   node server/scripts/drive2026Inventory.js [--year=2026]

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const fs = require("fs");
const gdrive = require("../services/googleDriveService");

const DD = path.join(__dirname, "..", "..", "data-downloader");
const upstoxInstruments = require(path.join(DD, "upstox", "instrumentMaster"));
const INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const FOLDER = "application/vnd.google-apps.folder";
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const OPTSTK_RE = new RegExp(`^(.+?)(\\d{2})(${MONTHS.join("|")})(\\d+(?:\\.\\d+)?)(CE|PE)$`);

const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const YEAR = String(flags.year || 2026);

async function listAll(drive, q) {
    const out = [];
    let pageToken;
    do {
        const res = await drive.files.list({
            q, pageSize: 1000, pageToken,
            fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime)",
            supportsAllDrives: true, includeItemsFromAllDrives: true,
        });
        out.push(...(res.data.files || []));
        pageToken = res.data.nextPageToken;
    } while (pageToken);
    return out;
}

async function childFolder(drive, parentId, name) {
    const hits = await listAll(drive, `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER}' and trashed = false`);
    return hits[0] || null;
}

// { SYM: { name, sizeBytes, modifiedTime } } for one category/year
async function categoryFiles(drive, root, categoryName, dataType) {
    const cat = await childFolder(drive, root, categoryName);
    if (!cat) return {};
    const yearFolder = await childFolder(drive, cat.id, YEAR);
    if (!yearFolder) return {};
    const symFolders = (await listAll(drive, `'${yearFolder.id}' in parents and mimeType = '${FOLDER}' and trashed = false`));
    const result = {};
    let i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (i < symFolders.length) {
            const f = symFolders[i++];
            const files = await listAll(drive, `'${f.id}' in parents and trashed = false`);
            // archivalPipelineService strips non-alphanumerics from file names (M&M -> MM_2026_...)
            const want = `${f.name.replace(/[^A-Za-z0-9_]/g, "")}_${YEAR}_${dataType}.csv.gz`;
            const hit = files.filter((x) => x.name === want).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
            if (hit.length) {
                result[f.name] = { name: hit[0].name, sizeBytes: Number(hit[0].size || 0), modifiedTime: hit[0].modifiedTime, copies: hit.length };
            }
        }
    }));
    return result;
}

async function liveStockUniverse() {
    const csvPath = await upstoxInstruments.downloadInstruments();
    const lines = fs.readFileSync(csvPath, "utf8").split("\n");
    const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
    // `name` is the company name for OPTSTK rows — take the symbol from tradingsymbol,
    // exactly like upstoxStockOptionChainArchivalRunner.js does
    const iSym = header.indexOf("tradingsymbol"), iType = header.indexOf("instrument_type");
    const set = new Set();
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].includes("OPTSTK")) continue;
        const cells = lines[i].split(",").map((c) => c.replace(/^"(.*)"$/, "$1").trim());
        if (cells[iType] !== "OPTSTK") continue;
        const m = cells[iSym].match(OPTSTK_RE);
        if (m) set.add(m[1].toUpperCase());
    }
    return [...set].sort();
}

async function main() {
    const drive = await gdrive.getDriveClient();
    const root = (gdrive.getEffectiveRootFolderId && gdrive.getEffectiveRootFolderId()) || gdrive.DEFAULT_ROOT_FOLDER_ID;
    const [oc, oh, stocks] = await Promise.all([
        categoryFiles(drive, root, "Option Chain", "option_chain"),
        categoryFiles(drive, root, "Stocks OHLCV", "ohlcv"),
        liveStockUniverse(),
    ]);
    const universe = [...INDICES, ...stocks];
    const rows = universe.map((s) => ({ symbol: s, index: INDICES.includes(s), optionChain: oc[s] || null, ohlcv: oh[s] || null }));
    const both = rows.filter((r) => r.optionChain && r.ohlcv);
    const missing = rows.filter((r) => !r.optionChain || !r.ohlcv);
    const report = {
        year: YEAR, checkedAt: new Date().toISOString(), universe: universe.length,
        complete: both.length, missing: missing.length,
        extrasOnDrive: Object.keys(oc).filter((s) => !universe.includes(s)),
        rows,
    };
    const out = path.join(DD, "data", `drive-${YEAR}-inventory.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 2));

    console.log(`Drive ${YEAR}: universe ${universe.length} (7 indices + ${stocks.length} stocks)`);
    console.log(`  both option_chain + ohlcv on Drive: ${both.length}`);
    console.log(`  missing one or both:              ${missing.length}`);
    console.log(`  indices on Drive: ${rows.filter((r) => r.index && r.optionChain).map((r) => r.symbol).join(", ") || "none"}`);
    console.log(`  stocks with option chain on Drive: ${rows.filter((r) => !r.index && r.optionChain).map((r) => r.symbol).join(", ")}`);
    console.log(`  report: ${out}`);
}

main().then(() => process.exit(0)).catch((e) => {
    console.error("ERR", e.message);
    process.exit(1);
});
