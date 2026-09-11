// scripts/kotakPollOnce.js — run ONE Kotak Neo snapshot and exit.
//
// Verifies the integration end to end (login -> scrip master -> quotes ->
// Greeks -> MySQL upsert) without leaving a poller running. Works for any of
// the 7 F&O indices or any F&O stock symbol.
//
//   cd server
//   TZ=Asia/Kolkata node scripts/kotakPollOnce.js              # NIFTY
//   TZ=Asia/Kolkata node scripts/kotakPollOnce.js SENSEX
//   TZ=Asia/Kolkata node scripts/kotakPollOnce.js RELIANCE
//   TZ=Asia/Kolkata node scripts/kotakPollOnce.js --list       # show resolved universe
//
// Best run during market hours — outside them quotes may be zero/stale.

require("dotenv").config();

const instruments = require("../kotak/instruments");
const { buildChainSnapshot, getVix, getFuture } = require("../kotak/marketData");
const repo = require("../kotak/repo");
const { pool } = require("../config/db");

const arg = (process.argv[2] || "NIFTY").toUpperCase();

(async () => {
    if (arg === "--LIST") {
        const idx = await instruments.listIndices();
        const stk = await instruments.listStocks();
        console.log(`\nindices (${idx.length}): ${idx.join(", ")}`);
        console.log(`\nstocks  (${stk.length}): ${stk.join(", ")}\n`);
        await pool.end();
        return;
    }

    console.log(`\n== Kotak Neo one-shot: ${arg} ==\n`);

    const spot = await instruments.getSpot(arg);
    const fut = await instruments.getNearestFuture(arg);
    const expiries = await instruments.getExpiries(arg);
    console.log("spot       :", spot ? `${spot.token} (${spot.seg})` : "(name fallback)");
    console.log("future     :", fut ? `${fut.token} (${fut.seg}) exp ${fut.expiry}` : "(none)");
    console.log("expiries   :", expiries.slice(0, 6).join(", "), "\n");

    const vix = await getVix();
    console.log("India VIX  :", vix?.ltp);
    if (vix) await repo.saveVix(vix);

    const futQ = await getFuture(arg);
    console.log("future LTP :", futQ?.ltp, "\n");
    if (futQ) await repo.saveFuture(arg, futQ);

    const chain = await buildChainSnapshot(arg);
    console.log(`chain: ${arg} ${chain.expiry}  spot=${chain.spot}  atm=${chain.atm}  strikes=${chain.rows.length}`);
    console.table(
        chain.rows.slice(0, 6).map((r) => ({
            strike: r.strike,
            ce_ltp: r.ce?.ltp ?? null,
            ce_oi: r.ce?.oi ?? null,
            ce_iv: r.ce?.iv ?? null,
            pe_ltp: r.pe?.ltp ?? null,
            pe_oi: r.pe?.oi ?? null,
            pe_iv: r.pe?.iv ?? null,
        }))
    );

    const stored = await repo.saveChainSnapshot(chain);
    await repo.saveSpot(arg, chain.spotQuote || { ltp: chain.spot }, chain.snapshotAt);
    console.log(`\nstored ${stored} option_chain_history rows + spot into ohlcv_data\n`);

    await pool.end();
})().catch((err) => {
    console.error("\nFAILED:", err.message, "\n");
    process.exit(1);
});
