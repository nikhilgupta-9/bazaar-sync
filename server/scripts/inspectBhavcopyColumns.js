// scripts/inspectBhavcopyColumns.js — one-off diagnostic, NOT part of any
// regular pipeline. Downloads ONE real NSE F&O bhavcopy and prints its full
// header row, so we can confirm whether it carries a lot-size column
// (candidates: NewBrdLotQty, MKT_LOT, LOT_SIZE — real NSE UDiFF bhavcopy
// column naming is not 100% certain without seeing a real file) before
// writing any parser/backfill code against it. Run from the server/
// directory: `node scripts/inspectBhavcopyColumns.js [YYYY-MM-DD]`
// (defaults to the most recent weekday).
const nseBhavcopy = require("../services/nseBhavcopy");

function mostRecentWeekday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
}

async function main() {
    const dateStr = process.argv[2] || mostRecentWeekday();
    console.log(`Fetching NSE bhavcopy for ${dateStr}...`);
    const zipPath = await nseBhavcopy.downloadZip(dateStr);
    const csvText = await nseBhavcopy.extractCsv(zipPath);
    const headerLine = csvText.split("\n")[0].trim();
    const headers = headerLine.split(",").map((h) => h.trim());
    console.log(`\n${headers.length} columns found:\n`);
    headers.forEach((h, i) => console.log(`  [${i}] ${h}`));

    const lotCandidates = headers.filter((h) => /lot/i.test(h));
    console.log(lotCandidates.length ? `\nPossible lot-size column(s): ${lotCandidates.join(", ")}` : "\nNo column with 'lot' in its name found.");

    const firstDataLine = csvText.split("\n")[1];
    console.log(`\nFirst data row (for reference):\n${firstDataLine}`);
}

main().catch((err) => {
    console.error("Failed:", err.message);
    process.exit(1);
});
