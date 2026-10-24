// server/scripts/massDriveOptionChainPolisher.js — Mass-scale Google Drive Option Chain & OHLCV Auditor and Polisher (2026 ➔ 2023)
//
// Checks data backwards in time: 2026 ➔ 2025 ➔ 2024 ➔ 2023
// Universe: 7 Indices + 210+ F&O Stocks
// Checks:
//   1. Option Chain file presence on Google Drive
//   2. 1-minute OHLCV spot file presence on Google Drive
//   3. Strike completeness (detects Dhan ATM ±10 limitations: <= 21 strikes per expiry)
// Routing:
//   - Years 2026, 2025, 2024 (>= Oct 2024): Upstox API (full ATM ±30 strikes + 1-min OHLCV)
//   - Years 2024 (< Oct 2024), 2023: ICICI Direct Breeze API (deep historical strikes down to 2023)
//
// Usage:
//   node server/scripts/massDriveOptionChainPolisher.js [--check-only] [--years=2026,2025,2024,2023] [--symbols=NIFTY,RELIANCE] [--auto-fetch]
//
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");
const { spawn } = require("child_process");

const gdrive = require("../services/googleDriveService");
const DD = path.join(__dirname, "..", "..", "data-downloader");
const upstoxInstruments = require(path.join(DD, "upstox", "instrumentMaster"));

const INDICES = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"];
const DEFAULT_YEARS = ["2026", "2025", "2024", "2023"];
const FOLDER_MIME = "application/vnd.google-apps.folder";
const STATUS_FILE = path.join(DD, "data", "drive-mass-status.json");

// CLI Flags
function parseArgs() {
    const flags = {};
    for (const a of process.argv.slice(2)) {
        const m = a.match(/^--([a-z-]+)(?:=(.*))?$/);
        if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    }
    return flags;
}

const flags = parseArgs();
const TARGET_YEARS = flags.years ? flags.years.split(",") : DEFAULT_YEARS;
const CHECK_ONLY = flags["check-only"] === true || flags["auto-fetch"] !== true;
const SYMBOL_FILTER = flags.symbols ? new Set(flags.symbols.toUpperCase().split(",")) : null;

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
    const hits = await listAll(drive, `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
    return hits[0] || null;
}

// Full Master Universe (Current Upstox F&O + Historical F&O from scrip master)
async function getMasterUniverse() {
    const set = new Set(INDICES);
    try {
        const csvPath = await upstoxInstruments.downloadInstruments();
        const lines = fs.readFileSync(csvPath, "utf8").split("\n");
        const header = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
        const iSym = header.indexOf("tradingsymbol"), iType = header.indexOf("instrument_type");
        const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const OPTSTK_RE = new RegExp(`^(.+?)(\\d{2})(${MONTHS.join("|")})(\\d+(?:\\.\\d+)?)(CE|PE)$`);
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].includes("OPTSTK")) continue;
            const cells = lines[i].split(",").map((c) => c.replace(/^"(.*)"$/, "$1").trim());
            if (cells[iType] !== "OPTSTK") continue;
            const m = cells[iSym].match(OPTSTK_RE);
            if (m) set.add(m[1].toUpperCase());
        }
    } catch (e) {
        console.warn("[Universe] Warn reading live Upstox instruments:", e.message);
    }

    let list = [...set];
    if (SYMBOL_FILTER) list = list.filter(s => SYMBOL_FILTER.has(s));
    return list.sort((a, b) => {
        const aIdx = INDICES.indexOf(a), bIdx = INDICES.indexOf(b);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.localeCompare(b);
    });
}

// Maps files under a category/year: { SYM: { id, name, sizeBytes } }
async function getCategoryYearFiles(drive, rootId, categoryName, year, dataType) {
    const cat = await childFolder(drive, rootId, categoryName);
    if (!cat) return {};
    const yrFolder = await childFolder(drive, cat.id, year);
    if (!yrFolder) return {};
    let symFolders = await listAll(drive, `'${yrFolder.id}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`);
    if (SYMBOL_FILTER) {
        symFolders = symFolders.filter(f => SYMBOL_FILTER.has(f.name.toUpperCase()));
    }
    const result = {};
    let idx = 0;
    // 8 concurrent workers for fast listing
    await Promise.all(Array.from({ length: 8 }, async () => {
        while (idx < symFolders.length) {
            const f = symFolders[idx++];
            const files = await listAll(drive, `'${f.id}' in parents and trashed = false`);
            const want = `${f.name.replace(/[^A-Za-z0-9_]/g, "")}_${year}_${dataType}.csv.gz`;
            const hit = files.filter(x => x.name === want).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
            if (hit.length) {
                result[f.name] = { id: hit[0].id, name: hit[0].name, sizeBytes: Number(hit[0].size || 0), modifiedTime: hit[0].modifiedTime };
            }
        }
    }));
    return result;
}

// Fast streaming check of strike completeness from Google Drive (reads first ~15,000 lines)
async function inspectStrikeCompleteness(drive, fileId) {
    try {
        const res = await drive.files.get(
            { fileId, alt: "media", supportsAllDrives: true },
            { responseType: "stream" }
        );
        const gunzip = zlib.createGunzip();
        const rl = readline.createInterface({ input: res.data.pipe(gunzip), crlfDelay: Infinity });

        let count = 0;
        const strikesByExpiry = {};
        for await (const line of rl) {
            count++;
            if (count === 1) continue; // header
            const parts = line.split(",");
            const expiry = parts[4];
            const strike = parts[5];
            if (expiry && strike) {
                if (!strikesByExpiry[expiry]) strikesByExpiry[expiry] = new Set();
                strikesByExpiry[expiry].add(strike);
            }
            if (count >= 15000) {
                res.data.destroy();
                break;
            }
        }

        const expiries = Object.keys(strikesByExpiry);
        if (expiries.length === 0) return { hasExpiries: false, maxStrikes: 0, status: "EMPTY_DATA" };
        
        let maxStrikes = 0;
        for (const exp of expiries) {
            if (strikesByExpiry[exp].size > maxStrikes) maxStrikes = strikesByExpiry[exp].size;
        }

        // Dhan API gave ATM ±10 (<= 21 total strikes per expiry). Full chain has > 21 strikes.
        const isDhanAtm10 = maxStrikes > 0 && maxStrikes <= 21;
        return {
            hasExpiries: true,
            expiryCount: expiries.length,
            maxStrikes,
            isDhanAtm10,
            status: isDhanAtm10 ? "DHAN_ATM10_LIMITED" : "FULL_STRIKES_OK"
        };
    } catch (e) {
        return { hasExpiries: false, maxStrikes: 0, status: "READ_ERROR: " + e.message };
    }
}

function updateStatusFile(state) {
    try {
        fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
        fs.writeFileSync(STATUS_FILE, JSON.stringify(state, null, 2));
    } catch (_) {}
}

function runSubprocess(cmd, args, env = {}) {
    return new Promise((resolve, reject) => {
        console.log(`\n[SPAWN] ${cmd} ${args.join(" ")}`);
        const proc = spawn(cmd, args, {
            stdio: "inherit",
            env: { ...process.env, ...env }
        });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Process exited with code ${code}`));
        });
        proc.on("error", reject);
    });
}

async function main() {
    console.log("=".repeat(78));
    console.log(" 🚀 MASS GOOGLE DRIVE OPTION CHAIN & OHLCV AUDITOR / POLISHER (2026 ➔ 2023)");
    console.log("=".repeat(78));
    console.log(`Target Years: ${TARGET_YEARS.join(", ")} (Reverse Chronological)`);
    console.log(`Mode: ${CHECK_ONLY ? "🔍 AUDIT ONLY (Dry Run)" : "⚡ AUDIT & AUTO-FETCH / POLISH"}`);
    console.log("-".repeat(78));

    const drive = await gdrive.getDriveClient();
    const rootId = (gdrive.getEffectiveRootFolderId && gdrive.getEffectiveRootFolderId()) || gdrive.DEFAULT_ROOT_FOLDER_ID;
    const universe = await getMasterUniverse();
    const nIndices = universe.filter(s => INDICES.includes(s)).length;
    const nStocks = universe.length - nIndices;
    console.log(`Universe Size: ${universe.length} symbols (${nIndices} indices + ${nStocks} F&O stocks)\n`);

    const massState = {
        lastUpdated: new Date().toISOString(),
        currentAction: CHECK_ONLY ? "Audit in progress" : "Auditing and Backfilling",
        summary: { fullDepth: 0, dhanAtm10: 0, spotOnlyMissing: 0, optionChainMissing: 0, bothMissing: 0 },
        years: {}
    };

    for (const year of TARGET_YEARS) {
        console.log(`\n==============================================================================`);
        console.log(` 📅 YEAR ${year}: Inspecting Google Drive [Option Chain] & [Stocks OHLCV]`);
        console.log(`==============================================================================`);

        console.log(`Scanning Google Drive folder tree for Year ${year}...`);
        const [ocFiles, ohFiles] = await Promise.all([
            getCategoryYearFiles(drive, rootId, "Option Chain", year, "option_chain"),
            getCategoryYearFiles(drive, rootId, "Stocks OHLCV", year, "ohlcv")
        ]);

        console.log(`Drive scan complete for ${year}: Found ${Object.keys(ocFiles).length} Option Chain files, ${Object.keys(ohFiles).length} OHLCV files.`);

        const yearReport = {
            year,
            total: universe.length,
            verifiedComplete: 0,
            spotOnlyMissing: 0,
            optionChainMissing: 0,
            bothMissing: 0,
            dhanAtm10: 0,
            symbols: {}
        };

        const needsUpstoxFull = [];
        const needsUpstoxSpotOnly = [];
        const needsBreezePolish = [];

        for (let i = 0; i < universe.length; i++) {
            const sym = universe[i];
            const oc = ocFiles[sym] || null;
            const oh = ohFiles[sym] || null;

            let classification = "UNKNOWN";
            let depthInfo = null;

            if (oc && oh) {
                // Both exist. Check size & strike depth
                if (oc.sizeBytes < 5000 || oh.sizeBytes < 5000) {
                    classification = "CORRUPT_OR_EMPTY";
                } else {
                    // For years 2024 and 2023, Dhan API was used, so strike sampling is essential
                    if (year === "2024" || year === "2023") {
                        depthInfo = await inspectStrikeCompleteness(drive, oc.id);
                        if (depthInfo.isDhanAtm10) {
                            classification = "DHAN_ATM10_NEEDS_POLISH";
                            yearReport.dhanAtm10++;
                            massState.summary.dhanAtm10++;
                        } else {
                            classification = "VERIFIED_COMPLETE";
                            yearReport.verifiedComplete++;
                            massState.summary.fullDepth++;
                        }
                    } else {
                        classification = "VERIFIED_COMPLETE";
                        yearReport.verifiedComplete++;
                        massState.summary.fullDepth++;
                    }
                }
            } else if (oc && !oh) {
                classification = "SPOT_ONLY_MISSING";
                yearReport.spotOnlyMissing++;
                massState.summary.spotOnlyMissing++;
            } else if (!oc && oh) {
                classification = "OPTION_CHAIN_MISSING";
                yearReport.optionChainMissing++;
                massState.summary.optionChainMissing++;
            } else {
                classification = "BOTH_MISSING";
                yearReport.bothMissing++;
                massState.summary.bothMissing++;
            }

            yearReport.symbols[sym] = {
                status: classification,
                optionChainBytes: oc ? oc.sizeBytes : 0,
                ohlcvBytes: oh ? oh.sizeBytes : 0,
                depthInfo
            };

            // Provider Routing
            if (classification !== "VERIFIED_COMPLETE") {
                if (year === "2026" || year === "2025" || year === "2024") {
                    if (classification === "SPOT_ONLY_MISSING") {
                        needsUpstoxSpotOnly.push(sym);
                    } else {
                        needsUpstoxFull.push(sym);
                    }
                } else if (year === "2023") {
                    needsBreezePolish.push(sym);
                }
            }

            if ((i + 1) % 25 === 0 || i === universe.length - 1) {
                console.log(`[${year} Progress] ${i + 1}/${universe.length} symbols audited... (Verified: ${yearReport.verifiedComplete}, Dhan ATM10: ${yearReport.dhanAtm10}, Missing: ${yearReport.bothMissing + yearReport.optionChainMissing + yearReport.spotOnlyMissing})`);
            }
        }

        massState.years[year] = yearReport;
        updateStatusFile(massState);

        console.log(`\n📊 YEAR ${year} AUDIT SUMMARY:`);
        console.log(`   Total Universe: ${yearReport.total}`);
        console.log(`   ✅ Verified Complete & Full Depth: ${yearReport.verifiedComplete}`);
        console.log(`   ⚠️ Dhan ATM ±10 Flagged (Needs Polish): ${yearReport.dhanAtm10}`);
        console.log(`   ⚠️ Spot OHLCV Missing Only: ${yearReport.spotOnlyMissing}`);
        console.log(`   ⚠️ Option Chain Missing: ${yearReport.optionChainMissing}`);
        console.log(`   ❌ Missing Both: ${yearReport.bothMissing}`);

        if (CHECK_ONLY) {
            console.log(`\n[Audit Mode] Auto-fetch is not enabled. Run with --auto-fetch to trigger backfill & polish for Year ${year}.`);
        } else {
            // Execution routing
            console.log(`\n⚡ AUTO-FETCH / POLISH ACTIONS FOR YEAR ${year}:`);
            const runnerScript = path.join(__dirname, "upstoxStockOptionChainArchivalRunner.js");

            if (year === "2026" || year === "2025") {
                const toDate = year === "2026" ? "2026-10-16" : `${year}-12-31`;
                console.log(`   Routing to Upstox API Engine (Covers 2024-10 ➔ 2026):`);
                console.log(`   - Spot-only to fetch: ${needsUpstoxSpotOnly.length} symbols`);
                console.log(`   - Full Option Chain + Spot to fetch: ${needsUpstoxFull.length} symbols`);

                if (needsUpstoxSpotOnly.length > 0) {
                    massState.currentAction = `Fetching ${year} spot-only for ${needsUpstoxSpotOnly.length} symbols`;
                    updateStatusFile(massState);
                    try {
                        await runSubprocess("node", [runnerScript, `--symbols=${needsUpstoxSpotOnly.join(",")}`, `--from=${year}-01-01`, `--to=${toDate}`, "--spot-only"]);
                    } catch (err) {
                        console.error(`[Upstox] Spot-only error: ${err.message}`);
                    }
                }

                if (needsUpstoxFull.length > 0) {
                    massState.currentAction = `Fetching ${year} full option chains for ${needsUpstoxFull.length} symbols`;
                    updateStatusFile(massState);
                    try {
                        await runSubprocess("node", [runnerScript, `--symbols=${needsUpstoxFull.join(",")}`, `--from=${year}-01-01`, `--to=${toDate}`]);
                    } catch (err) {
                        console.error(`[Upstox] Full fetch error: ${err.message}`);
                    }
                }
            } else if (year === "2024") {
                console.log(`   Year 2024 Boundary Split:`);
                console.log(`   - Oct 2024 ➔ Dec 2024: Upstox API (${needsUpstoxFull.length} symbols)`);
                console.log(`   - Jan 2024 ➔ Sep 2024 & Polish: ICICI Direct Breeze API (${needsBreezePolish.length} symbols)`);

                if (needsUpstoxFull.length > 0) {
                    massState.currentAction = `Fetching 2024 Q4 Upstox data for ${needsUpstoxFull.length} symbols`;
                    updateStatusFile(massState);
                    try {
                        await runSubprocess("node", [runnerScript, `--symbols=${needsUpstoxFull.join(",")}`, `--from=2024-10-01`, `--to=2024-12-31`]);
                    } catch (err) {
                        console.error(`[Upstox] 2024 Q4 error: ${err.message}`);
                    }
                }

                if (!process.env.BREEZE_API_SESSION) {
                    console.warn(`\n⚠️ [Breeze Action Needed] 2024 (Jan-Sep) & 2023 strike polish requires ICICI Direct Breeze API.`);
                    console.warn(`   Please obtain today's BREEZE_API_SESSION and set it in server/.env or data-downloader/.env.`);
                }
            } else if (year === "2023") {
                console.log(`   Routing to ICICI Direct Breeze API Engine (Covers 2023):`);
                console.log(`   - Polish required for ${needsBreezePolish.length} symbols`);
                if (!process.env.BREEZE_API_SESSION) {
                    console.warn(`\n⚠️ [Breeze Action Needed] 2023 requires ICICI Direct Breeze API session.`);
                    console.warn(`   Please obtain today's BREEZE_API_SESSION and set it in server/.env.`);
                } else {
                    massState.currentAction = `Polishing 2023 via Breeze API for ${needsBreezePolish.length} symbols`;
                    updateStatusFile(massState);
                    // Invoke Breeze option chain universe runner
                    const breezeScript = path.join(DD, "optionchain", "runUniverse.js");
                    if (fs.existsSync(breezeScript)) {
                        try {
                            await runSubprocess("node", [breezeScript, "2023", "2023", `--symbols=${needsBreezePolish.join(",")}`]);
                        } catch (err) {
                            console.error(`[Breeze] 2023 run error: ${err.message}`);
                        }
                    }
                }
            }
        }
    }

    massState.currentAction = "Process completed";
    updateStatusFile(massState);

    console.log("\n" + "=".repeat(78));
    console.log(" ✅ AUDIT & POLISH WORKFLOW COMPLETE");
    console.log(` Detailed status written to: ${STATUS_FILE}`);
    console.log(` Monitor live with: node server/scripts/checkDriveStatus.js`);
    console.log("=".repeat(78));
}

main().catch(err => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
});
