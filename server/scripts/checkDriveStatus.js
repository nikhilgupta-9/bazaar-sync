// server/scripts/checkDriveStatus.js — Live status dashboard for Google Drive Option Chain & OHLCV
//
// Usage:
//   node server/scripts/checkDriveStatus.js [--watch]
//
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DD = path.join(__dirname, "..", "..", "data-downloader");
const LOG_FILE = path.join(DD, "logs", "drive-2026-backfill.log");
const MASS_STATUS_FILE = path.join(DD, "data", "drive-mass-status.json");

function getRunningProcesses() {
    try {
        const out = execSync("ps aux | grep -E 'node.*(upstox|drive|option|breeze)' | grep -v grep", { encoding: "utf8" });
        return out.trim().split("\n").filter(Boolean).map(line => {
            const parts = line.trim().split(/\s+/);
            const pid = parts[1];
            const time = parts[9] || parts[8];
            const cmd = parts.slice(10).join(" ");
            return { pid, time, cmd };
        });
    } catch {
        return [];
    }
}

function loadYearInventory(year) {
    const f = path.join(DD, "data", `drive-${year}-inventory.json`);
    if (fs.existsSync(f)) {
        try {
            return JSON.parse(fs.readFileSync(f, "utf8"));
        } catch {
            return null;
        }
    }
    return null;
}

function getRecentLogTail(lines = 10) {
    if (!fs.existsSync(LOG_FILE)) return "(no backfill log file yet)";
    try {
        const out = execSync(`tail -n ${lines} "${LOG_FILE}"`, { encoding: "utf8" });
        return out.trim();
    } catch (e) {
        return `(error reading log: ${e.message})`;
    }
}

function renderDashboard() {
    const procs = getRunningProcesses();
    const massStatus = fs.existsSync(MASS_STATUS_FILE) ? JSON.parse(fs.readFileSync(MASS_STATUS_FILE, "utf8")) : null;

    console.clear();
    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    console.log("=".repeat(78));
    console.log(` 📊 BAZAAR-SYNC GOOGLE DRIVE OPTION CHAIN & OHLCV MASTER MONITOR (${now} IST)`);
    console.log("=".repeat(78));

    // Active Processes
    console.log("\n⚡ ACTIVE BACKGROUND TASKS:");
    if (procs.length === 0) {
        console.log("   [IDLE] No active archival / backfill process currently running.");
    } else {
        procs.forEach((p, idx) => {
            console.log(`   [RUNNING #${idx + 1}] PID: ${p.pid} | Time: ${p.time}`);
            console.log(`     Command: ${p.cmd.length > 80 ? p.cmd.slice(0, 77) + "..." : p.cmd}`);
        });
    }

    // Per-Year Inventory Summary
    console.log("\n📁 GOOGLE DRIVE DATA INVENTORY (2026 ➔ 2023):");
    console.log("-".repeat(78));
    console.log("Year | Universe | Both Complete | Only OC | Only OHLCV | Missing Both | Status");
    console.log("-".repeat(78));

    const years = ["2026", "2025", "2024", "2023"];
    years.forEach(yr => {
        const inv = loadYearInventory(yr);
        if (!inv) {
            console.log(`${yr} |   --     |      --       |   --    |    --      |      --      | ⏳ Not scanned yet`);
            return;
        }
        const total = inv.universe || 0;
        const both = inv.rows.filter(r => r.optionChain && r.ohlcv).length;
        const onlyOc = inv.rows.filter(r => r.optionChain && !r.ohlcv).length;
        const onlyOh = inv.rows.filter(r => !r.optionChain && r.ohlcv).length;
        const missingBoth = inv.rows.filter(r => !r.optionChain && !r.ohlcv).length;
        const pct = total > 0 ? Math.round((both / total) * 100) : 0;

        let statusBadge = "⚠️ Needs Work";
        if (pct >= 90) statusBadge = "✅ Almost Ready";
        if (pct === 100) statusBadge = "🎉 100% Complete";

        console.log(`${yr} |   ${String(total).padEnd(6)} | ${String(both).padEnd(5)} (${String(pct).padStart(2)}%)   |   ${String(onlyOc).padEnd(5)} |    ${String(onlyOh).padEnd(7)} |     ${String(missingBoth).padEnd(8)} | ${statusBadge}`);
    });
    console.log("-".repeat(78));

    // Polish / Depth Summary if massStatus available
    if (massStatus && massStatus.summary) {
        console.log("\n🔍 POLISH & STRIKE DEPTH METRICS:");
        console.log(`   Last Audit: ${massStatus.lastUpdated || "N/A"}`);
        console.log(`   Verified Full Depth (ATM ±30): ${massStatus.summary.fullDepth || 0}`);
        console.log(`   Dhan ATM ±10 Flagged (Needs Polish): ${massStatus.summary.dhanAtm10 || 0}`);
        console.log(`   Current Action: ${massStatus.currentAction || "Idle"}`);
    }

    // Recent Log Activity
    console.log("\n📝 LIVE RUNNER LOG (LAST 8 LINES):");
    console.log("-".repeat(78));
    const logTail = getRecentLogTail(8);
    console.log(logTail);
    console.log("=".repeat(78));
    console.log("Tip: Run with --watch to auto-refresh every 3 seconds: node server/scripts/checkDriveStatus.js --watch");
}

if (process.argv.includes("--watch")) {
    renderDashboard();
    setInterval(renderDashboard, 3000);
} else {
    renderDashboard();
}
