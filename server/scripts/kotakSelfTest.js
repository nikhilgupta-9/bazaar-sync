// scripts/kotakSelfTest.js — offline sanity check. No credentials, no DB, no
// network. Feeds synthetic scrip-master CSVs through the REAL parser and
// checks token resolution, the epoch->date conversion, the ATM window, and
// the Greeks/normalize helpers.
//
//   cd server && node scripts/kotakSelfTest.js
//
// This does NOT prove the live API works (see scripts/kotakPollOnce.js for
// that) — it proves the parsing / math logic is intact after any edit.

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");

// --- write synthetic fixtures into a temp dir, point the loader at it ------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kotak-selftest-"));
process.env.KOTAK_SCRIP_CACHE_DIR = dir;

const EXPIRY_SEC = Date.UTC(2026, 8, 25) / 1000 - 315513000; // -> 2026-09-25

fs.writeFileSync(
    path.join(dir, "kotak_nse_cm.csv"),
    `pSymbol,pExchSeg,pSymbolName,pTrdSymbol,pGroup,pInstType,pOptionType,dStrikePrice,pExpiryDate,lLotSize
26000,nse_cm,NIFTY,Nifty 50,INDEX,,,-1,-1,1
2885,nse_cm,RELIANCE,RELIANCE-EQ,EQ,,,-1,-1,1
26017,nse_cm,INDIAVIX,India VIX,INDEX,,,-1,-1,1
`
);
fs.writeFileSync(
    path.join(dir, "kotak_bse_cm.csv"),
    `pSymbol,pExchSeg,pSymbolName,pTrdSymbol,pGroup,pInstType,pOptionType,dStrikePrice,pExpiryDate,lLotSize
1,bse_cm,SENSEX,SENSEX,INDEX,,,-1,-1,1
`
);
const fno = ["pSymbol,pExchSeg,pSymbolName,pTrdSymbol,pGroup,pInstType,pOptionType,dStrikePrice,pExpiryDate,lLotSize"];
for (const k of [23900, 24000, 24100, 24200, 24300, 24400])
    for (const r of ["CE", "PE"])
        fno.push(`${100000 + k + (r === "CE" ? 0 : 1)},nse_fo,NIFTY,NIFTY25SEP${k}${r},,OPTIDX,${r},${k * 100},${EXPIRY_SEC},75`);
for (const k of [1400, 1420, 1440, 1460, 1480])
    for (const r of ["CE", "PE"])
        fno.push(`${200000 + k + (r === "CE" ? 0 : 1)},nse_fo,RELIANCE,RELIANCE25SEP${k}${r},,OPTSTK,${r},${k * 100},${EXPIRY_SEC},500`);
fno.push(`900001,nse_fo,NIFTY,NIFTY25SEPFUT,,FUTIDX,XX,-1,${EXPIRY_SEC},75`);
fs.writeFileSync(path.join(dir, "kotak_nse_fo.csv"), fno.join("\n") + "\n");

const bfo = ["pSymbol,pExchSeg,pSymbolName,pTrdSymbol,pGroup,pInstType,pOptionType,dStrikePrice,pExpiryDate,lLotSize"];
for (const k of [81000, 81500, 82000, 82500])
    for (const r of ["CE", "PE"])
        bfo.push(`${300000 + k + (r === "CE" ? 0 : 1)},bse_fo,SENSEX,SENSEX25SEP${k}${r},,OPTIDX,${r},${k * 100},${EXPIRY_SEC},20`);
fs.writeFileSync(path.join(dir, "kotak_bse_fo.csv"), bfo.join("\n") + "\n");

const instruments = require("../kotak/instruments");

let pass = 0;
function check(label, fn) {
    try {
        fn();
        console.log(`  ok   ${label}`);
        pass++;
    } catch (e) {
        console.log(`  FAIL ${label}\n       ${e.message}`);
        process.exitCode = 1;
    }
}

(async () => {
    console.log("\nKotak Neo self-test (offline)\n");

    await instruments.ensureLoaded({ force: true });

    const niftySpot = await instruments.getSpot("NIFTY");
    check("index spot: NIFTY -> nse_cm 26000", () => assert.deepStrictEqual(niftySpot, { token: "26000", seg: "nse_cm" }));

    const relSpot = await instruments.getSpot("RELIANCE");
    check("stock spot: RELIANCE -> nse_cm 2885", () => assert.deepStrictEqual(relSpot, { token: "2885", seg: "nse_cm" }));

    const sensexSpot = await instruments.getSpot("SENSEX");
    check("BSE index spot: SENSEX -> bse_cm 1", () => assert.deepStrictEqual(sensexSpot, { token: "1", seg: "bse_cm" }));

    const vix = await instruments.getVixToken();
    check("India VIX token -> 26017", () => assert.strictEqual(vix, "26017"));

    const idxList = await instruments.listIndices();
    check("listIndices finds NIFTY + SENSEX", () => {
        assert.ok(idxList.includes("NIFTY") && idxList.includes("SENSEX"), JSON.stringify(idxList));
    });

    const stocks = await instruments.listStocks();
    check("listStocks = [RELIANCE] (not the indices)", () => assert.deepStrictEqual(stocks, ["RELIANCE"]));

    const exp = (await instruments.getExpiries("NIFTY"))[0];
    check("expiry epoch -> 2026-09-25", () => assert.strictEqual(exp, "2026-09-25"));

    const win = await instruments.getOptionContracts("NIFTY", exp, { centerPrice: 24170, strikesPerSide: 1 });
    check("ATM window: center 24170 -> atm 24200", () => assert.strictEqual(win.atm, 24200));
    check("ATM window: ±1 strike -> 6 contracts (24100/24200/24300 x CE/PE)", () =>
        assert.strictEqual(win.contracts.length, 6));
    check("window strikes correct", () =>
        assert.deepStrictEqual([...new Set(win.contracts.map((c) => c.strike))].sort((a, b) => a - b), [24100, 24200, 24300]));

    const fut = await instruments.getNearestFuture("NIFTY");
    check("nearest future: token 900001, expiry 2026-09-25", () => {
        assert.strictEqual(fut.token, "900001");
        assert.strictEqual(fut.expiry, "2026-09-25");
    });

    const bs = require("../utils/blackScholes");
    check("blackScholes IV solver returns a positive vol for an ATM call", () => {
        const t = bs.yearsToExpiry("2026-09-25");
        const iv = bs.impliedVolatility({ marketPrice: 150, spot: 24200, strike: 24200, t, right: "call" });
        assert.ok(iv > 0 && iv < 5, `iv=${iv}`);
    });

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`\n${process.exitCode ? "SOME CHECKS FAILED" : `all ${pass} checks passed`}\n`);
})().catch((e) => {
    console.error(e);
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(1);
});
