// test/testDhan.js — THROWAWAY empirical probe, not the real pipeline.
//
// Purpose: Dhan's own docs are ambiguous/self-contradictory about whether
// /charts/intraday can serve an EXPIRED option/future contract (it needs a
// securityId, and the public scrip-master CSV likely only lists currently
// tradable securities), versus /charts/rollingoption (built specifically for
// expired options, addresses strikes as ATM-relative offsets instead of a
// securityId). This script hits the real API with the user's real
// credentials and prints exactly what comes back for each real question,
// so the actual pipeline (dhan/ folder, not written yet) gets built against
// confirmed behavior instead of guesses. Safe to delete once dhan/ exists
// and its own test script supersedes this.
//
// Run: cd data-downloader && node test/testDhan.js

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const axios = require("axios");

const BASE = "https://api.dhan.co/v2";
const headers = {
    "access-token": process.env.DHAN_ACCESS_TOKEN,
    "client-id": process.env.DHAN_CLIENT_ID,
    "Content-Type": "application/json",
};
// Try both header spellings docs disagree on ("dhanClientId" vs "client-id").
const headersAlt = {
    "access-token": process.env.DHAN_ACCESS_TOKEN,
    "dhanClientId": process.env.DHAN_CLIENT_ID,
    "Content-Type": "application/json",
};

function section(title) {
    console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

async function post(path, body, useAlt) {
    try {
        const res = await axios.post(`${BASE}${path}`, body, { headers: useAlt ? headersAlt : headers, validateStatus: () => true });
        return { status: res.status, data: res.data };
    } catch (err) {
        return { status: "ERR", data: err.message };
    }
}

function shortDump(data) {
    const s = JSON.stringify(data);
    return s.length > 1200 ? s.slice(0, 1200) + "...(truncated)" : s;
}

(async () => {
    if (!process.env.DHAN_ACCESS_TOKEN || !process.env.DHAN_CLIENT_ID) {
        console.error("DHAN_ACCESS_TOKEN / DHAN_CLIENT_ID missing from data-downloader/.env");
        process.exit(1);
    }

    section("0. Which auth header spelling actually works? (tiny live intraday call, today's date)");
    {
        const today = new Date().toISOString().slice(0, 10);
        const r1 = await post("/charts/intraday", {
            securityId: "13", exchangeSegment: "IDX_I", instrument: "INDEX",
            interval: "1", fromDate: today + " 09:15:00", toDate: today + " 09:20:00",
        }, false);
        console.log("client-id header ->", r1.status, shortDump(r1.data));
        const r2 = await post("/charts/intraday", {
            securityId: "13", exchangeSegment: "IDX_I", instrument: "INDEX",
            interval: "1", fromDate: today + " 09:15:00", toDate: today + " 09:20:00",
        }, true);
        console.log("dhanClientId header ->", r2.status, shortDump(r2.data));
    }

    section("1. Instrument master CSVs — do they exist, and can we find NIFTY's securityId?");
    for (const url of [
        "https://images.dhan.co/api-data/api-scrip-master.csv",
        "https://images.dhan.co/api-data/api-scrip-master-detailed.csv",
    ]) {
        try {
            const res = await axios.get(url, { responseType: "text", timeout: 30000 });
            const lines = res.data.split("\n");
            console.log(`${url}\n  ${lines.length} lines. header: ${lines[0]}`);
            const niftyIndexLine = lines.find((l) => /NIFTY/.test(l) && /INDEX/i.test(l));
            console.log(`  sample NIFTY INDEX row: ${niftyIndexLine ? niftyIndexLine.slice(0, 300) : "(none found)"}`);
        } catch (err) {
            console.log(`${url} -> FAILED: ${err.message}`);
        }
    }

    section("2. INDEX spot historical (NIFTY, securityId=13, exchangeSegment=IDX_I) — Jan 2023, daily");
    {
        const r = await post("/charts/historical", {
            securityId: "13", exchangeSegment: "IDX_I", instrument: "INDEX",
            fromDate: "2023-01-01", toDate: "2023-01-31",
        }, false);
        console.log(r.status, shortDump(r.data));
    }

    section("3. INDEX spot historical INTRADAY (NIFTY) — Jan 2023, 1-minute (does intraday even accept a 2023 date?)");
    {
        const r = await post("/charts/intraday", {
            securityId: "13", exchangeSegment: "IDX_I", instrument: "INDEX",
            interval: "1", fromDate: "2023-01-02 09:15:00", toDate: "2023-01-02 15:30:00",
        }, false);
        console.log(r.status, shortDump(r.data));
    }

    section("4. INDIA VIX historical (try securityId=21, IDX_I) — Jan 2023 daily");
    {
        const r = await post("/charts/historical", {
            securityId: "21", exchangeSegment: "IDX_I", instrument: "INDEX",
            fromDate: "2023-01-01", toDate: "2023-01-31",
        }, false);
        console.log("securityId=21 ->", r.status, shortDump(r.data));
    }

    section("5. Expired options via /charts/rollingoption — NIFTY, Jan 2023, ATM CALL, weekly expiryCode=1");
    {
        const r = await post("/charts/rollingoption", {
            exchangeSegment: "NSE_FNO", interval: "1", securityId: "13", instrument: "OPTIDX",
            expiryFlag: "WEEK", expiryCode: 1, strike: "ATM", drvOptionType: "CALL",
            requiredData: ["open", "high", "low", "close", "volume", "oi", "strike", "spot"],
            fromDate: "2023-01-01", toDate: "2023-01-31",
        }, false);
        console.log(r.status, shortDump(r.data));
    }

    section("6. Same rollingoption call, expiryFlag MONTH, expiryCode 1..3 (see what each resolves to)");
    for (const code of [1, 2, 3]) {
        const r = await post("/charts/rollingoption", {
            exchangeSegment: "NSE_FNO", interval: "1", securityId: "13", instrument: "OPTIDX",
            expiryFlag: "MONTH", expiryCode: code, strike: "ATM", drvOptionType: "CALL",
            requiredData: ["open", "close", "strike", "spot"],
            fromDate: "2023-01-01", toDate: "2023-01-31",
        }, false);
        const data = r.data && r.data.data;
        const ts = data && data.ce && data.ce.timestamp;
        const firstTs = ts && ts.length ? new Date(ts[0] * 1000).toISOString() : null;
        const lastTs = ts && ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString() : null;
        console.log(`expiryCode=${code} -> status=${r.status} timestamps: first=${firstTs} last=${lastTs} count=${ts ? ts.length : 0}`);
        if (r.status !== 200) console.log("   ", shortDump(r.data));
    }

    section("7. Expired futures via /charts/rollingoption with instrument=FUTIDX (does it even accept this?)");
    {
        const r = await post("/charts/rollingoption", {
            exchangeSegment: "NSE_FNO", interval: "1", securityId: "13", instrument: "FUTIDX",
            expiryFlag: "MONTH", expiryCode: 1,
            requiredData: ["open", "close"],
            fromDate: "2023-01-01", toDate: "2023-01-31",
        }, false);
        console.log(r.status, shortDump(r.data));
    }

    section("8. Expired futures daily via /charts/historical with expiryCode (FUTIDX, Jan 2023)");
    {
        const r = await post("/charts/historical", {
            securityId: "13", exchangeSegment: "NSE_FNO", instrument: "FUTIDX", expiryCode: 1,
            fromDate: "2023-01-01", toDate: "2023-01-31",
        }, false);
        console.log(r.status, shortDump(r.data));
    }

    console.log("\n\nDONE. Paste this whole output back for analysis before any real pipeline code is written.");
})().catch((err) => {
    console.error("DHAN TEST FAILED:", err instanceof Error ? err.stack : String(err));
    process.exit(1);
});
