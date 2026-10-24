// server/services/spanMarginService.js — option margin from NSE Clearing's own SPAN risk file.
//
// NSE Clearing publishes the SPAN risk-parameter file brokers margin with, free, every
// trading day (nsearchives …/nsccl/span/nsccl.YYYYMMDD.{i1..i5,s}.zip — intraday snapshots
// i1-i5 and the end-of-day "s"). Each listed option carries a 16-scenario risk array (loss per
// unit of a long position under each price/vol move). A basket's margin is computed the way
// NSE does it:
//
//   scan risk      = worst of the 16 scenarios of Σ riskArray × signed quantity (whole basket,
//                    so hedges really offset — a debit spread's scan risk is a few thousand)
//   calendar charge= the file's flat per-unit inter-month spread charge (dSpread) on delta
//                    offset across expiries
//   exposure (ELM) = per SHORT option: 2% of notional for index options, 3.5% for stock
//                    options, + an extra 2% on the expiry day for short index options
//                    (SEBI, Nov-2024)
//
// Checked against stockmojo.in's margins on 2026-10-19: within ~10% (they use a later
// intraday file). SOMC is 0 in the current files, so it is ignored. Index options on BSE
// (SENSEX, BANKEX) are not in NSE's file — callers fall back to their own estimate.
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");

const CACHE_DIR = path.join(__dirname, "..", "data", "span");
const REFRESH_MS = 30 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const INDEX_UNDERLYINGS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"]);
const ELM_INDEX = 0.02;
const ELM_STOCK = 0.035;
const ELM_EXPIRY_DAY_INDEX = 0.02;

let state = { xml: null, file: null, loadedAt: 0, ccIndex: null, oopIndex: null, parsed: new Map() };
let loading = null;

// ---------------------------------------------------------------- download / unzip
function get(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.nseindia.com/" }, timeout: 60000 }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
            }
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve(Buffer.concat(chunks)));
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", reject);
    });
}

// Minimal ZIP reader (single-entry archives) via the central directory — no npm dependency.
function unzipFirst(buf) {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error("not a zip file");
    const cdOffset = buf.readUInt32LE(eocd + 16);
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error("bad zip central directory");
    const method = buf.readUInt16LE(cdOffset + 10);
    const compSize = buf.readUInt32LE(cdOffset + 20);
    const localOffset = buf.readUInt32LE(cdOffset + 42);
    const nameLen = buf.readUInt16LE(localOffset + 26);
    const extraLen = buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(localOffset + 30 + nameLen + extraLen, localOffset + 30 + nameLen + extraLen + compSize);
    return method === 0 ? data : zlib.inflateRawSync(data);
}

function ymd(d) {
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Newest first: today's EOD, today's intraday i5..i1, then the previous days the same way.
function candidateNames() {
    const out = [];
    const nowIst = new Date(Date.now() + IST_OFFSET_MS);
    for (let back = 0; back < 8; back++) {
        const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - back));
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
        const day = ymd(d);
        for (const suffix of ["s", "i5", "i4", "i3", "i2", "i1"]) out.push(`nsccl.${day}.${suffix}`);
    }
    return out;
}

async function fetchLatest() {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    for (const name of candidateNames()) {
        const cached = path.join(CACHE_DIR, `${name}.spn`);
        if (fs.existsSync(cached)) return { name, xml: fs.readFileSync(cached, "utf8") };
        try {
            const zip = await get(`https://nsearchives.nseindia.com/archives/nsccl/span/${name}.zip`);
            const xml = unzipFirst(zip).toString("utf8");
            fs.writeFileSync(cached, xml);
            // keep only the newest few files on disk
            const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".spn")).sort();
            for (const old of files.slice(0, Math.max(0, files.length - 3))) fs.unlinkSync(path.join(CACHE_DIR, old));
            return { name, xml };
        } catch (err) {
            if (err.status !== 404 && err.status !== 403) console.warn(`[span] ${name}: ${err.message}`);
        }
    }
    throw new Error("no NSE SPAN file available for the last 8 days");
}

// pfCode -> [start, end) of its <oopPf> block, and cc -> its <ccDef> block
function buildIndexes(xml) {
    const oopIndex = new Map();
    const re = /<oopPf>\s*<pfId>\d+<\/pfId>\s*<pfCode>([^<]+)<\/pfCode>/g;
    let m;
    while ((m = re.exec(xml))) {
        const end = xml.indexOf("</oopPf>", m.index);
        oopIndex.set(m[1].trim().toUpperCase(), [m.index, end]);
    }
    const ccIndex = new Map();
    const re2 = /<ccDef>\s*<cc>([^<]+)<\/cc>/g;
    while ((m = re2.exec(xml))) {
        const end = xml.indexOf("</ccDef>", m.index);
        ccIndex.set(m[1].trim().toUpperCase(), [m.index, end]);
    }
    return { oopIndex, ccIndex };
}

async function ensureLoaded() {
    if (state.xml && Date.now() - state.loadedAt < REFRESH_MS) return state;
    if (loading) return loading;
    loading = (async () => {
        try {
            const { name, xml } = await fetchLatest();
            if (name !== state.file) {
                const { oopIndex, ccIndex } = buildIndexes(xml);
                state = { xml, file: name, loadedAt: Date.now(), oopIndex, ccIndex, parsed: new Map() };
                console.log(`[span] loaded ${name} (${oopIndex.size} option portfolios)`);
            } else {
                state.loadedAt = Date.now();
            }
        } catch (err) {
            if (!state.xml) throw err;
            console.warn(`[span] refresh failed, keeping ${state.file}: ${err.message}`);
            state.loadedAt = Date.now();
        } finally {
            loading = null;
        }
        return state;
    })();
    return loading;
}

const num = (s, tag) => {
    const m = s.match(new RegExp(`<${tag}>([-\\d.]+)</${tag}>`));
    return m ? Number(m[1]) : null;
};

// symbol -> { series: Map<'YYYY-MM-DD', Map<'strike|CE', {price, ra, delta}>>, spreads: [{rate, a, b}] }
function parseSymbol(symbol) {
    if (state.parsed.has(symbol)) return state.parsed.get(symbol);
    const span = state.oopIndex.get(symbol);
    if (!span) {
        state.parsed.set(symbol, null);
        return null;
    }
    const blk = state.xml.slice(span[0], span[1]);
    const series = new Map();
    for (const sm of blk.matchAll(/<series>([\s\S]*?)<\/series>/g)) {
        const s = sm[1];
        const pe = (s.match(/<pe>(\d{8})<\/pe>/) || [])[1];
        if (!pe) continue;
        const exp = `${pe.slice(0, 4)}-${pe.slice(4, 6)}-${pe.slice(6, 8)}`;
        const opts = new Map();
        for (const om of s.matchAll(/<opt>([\s\S]*?)<\/opt>/g)) {
            const o = om[1];
            const raBlk = (o.match(/<ra>([\s\S]*?)<\/ra>/) || [])[1] || "";
            const ra = [...raBlk.matchAll(/<a>([-\d.]+)<\/a>/g)].map((x) => Number(x[1]));
            if (ra.length !== 16) continue;
            const type = (o.match(/<o>(\w)<\/o>/) || [])[1] === "C" ? "CE" : "PE";
            opts.set(`${num(o, "k")}|${type}`, { price: num(o, "p"), ra, delta: num(raBlk, "d") ?? 0 });
        }
        series.set(exp, opts);
    }
    const spreads = [];
    const cc = state.ccIndex.get(symbol);
    if (cc) {
        const cblk = state.xml.slice(cc[0], cc[1]);
        for (const dm of cblk.matchAll(/<dSpread>([\s\S]*?)<\/dSpread>/g)) {
            const d = dm[1];
            const rate = num((d.match(/<rate>([\s\S]*?)<\/rate>/) || [])[1] || "", "val");
            const legs = [...d.matchAll(/<pLeg>[\s\S]*?<pe>(\d{8})<\/pe>[\s\S]*?<rs>(\w)<\/rs>[\s\S]*?<\/pLeg>/g)]
                .map((x) => `${x[1].slice(0, 4)}-${x[1].slice(4, 6)}-${x[1].slice(6, 8)}`);
            if (rate != null && legs.length === 2) spreads.push({ rate, a: legs[0], b: legs[1] });
        }
    }
    const parsed = { series, spreads };
    state.parsed.set(symbol, parsed);
    return parsed;
}

function todayIstStr() {
    const d = new Date(Date.now() + IST_OFFSET_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Margin for a basket of option legs on one underlying.
 * legs: [{ expiry: 'YYYY-MM-DD', strike, type: 'CE'|'PE', action: 'buy'|'sell', lots, lotSize }]
 * Returns { available:false, reason } when NSE's file can't price it (BSE index, unknown contract).
 */
async function calculateMargin({ symbol, spot, legs }) {
    const sym = String(symbol || "").toUpperCase();
    if (!Array.isArray(legs) || !legs.length) return { available: false, reason: "no legs" };
    await ensureLoaded();
    const data = parseSymbol(sym);
    if (!data) return { available: false, reason: `${sym} is not in NSE's SPAN file`, file: state.file };

    const positions = [];
    const missing = [];
    for (const leg of legs) {
        const expiry = String(leg.expiry || "").slice(0, 10);
        const type = String(leg.type || leg.optRight || "").toUpperCase() === "PE" ? "PE" : "CE";
        const strike = Number(leg.strike);
        const units = Number(leg.lots || leg.qty || 1) * Number(leg.lotSize || 1);
        const sign = String(leg.action || leg.side || "buy").toLowerCase().startsWith("s") ? -1 : 1;
        const opt = data.series.get(expiry)?.get(`${strike}|${type}`);
        if (!opt) {
            missing.push(`${expiry} ${strike} ${type}`);
            continue;
        }
        positions.push({ expiry, strike, type, qty: sign * units, units, opt, index: positions.length });
    }
    if (missing.length) return { available: false, reason: `not in SPAN file: ${missing.join(", ")}`, missing, file: state.file };

    const shorts = positions.filter((p) => p.qty < 0);
    if (!shorts.length) return { available: true, file: state.file, scanRisk: 0, calendarCharge: 0, exposure: 0, expiryDayExposure: 0, margin: 0, standaloneMargin: 0, perLeg: positions.map(() => 0) };

    // scan risk over the 16 NSE scenarios, whole basket together
    let scanRisk = 0;
    for (let s = 0; s < 16; s++) {
        let loss = 0;
        for (const p of positions) loss += p.opt.ra[s] * p.qty;
        if (loss > scanRisk) scanRisk = loss;
    }

    // calendar spread charge: offset delta between expiries, charged at the file's flat rate
    const deltaByExpiry = new Map();
    for (const p of positions) deltaByExpiry.set(p.expiry, (deltaByExpiry.get(p.expiry) || 0) + p.opt.delta * p.qty);
    let calendarCharge = 0;
    for (const sp of data.spreads) {
        const da = deltaByExpiry.get(sp.a) || 0;
        const db = deltaByExpiry.get(sp.b) || 0;
        if (da === 0 || db === 0 || Math.sign(da) === Math.sign(db)) continue;
        const n = Math.min(Math.abs(da), Math.abs(db));
        calendarCharge += n * sp.rate;
        deltaByExpiry.set(sp.a, da - Math.sign(da) * n);
        deltaByExpiry.set(sp.b, db - Math.sign(db) * n);
    }

    // exposure (ELM) on short options' notional
    const isIndex = INDEX_UNDERLYINGS.has(sym);
    const today = todayIstStr();
    const underlying = Number(spot) > 0 ? Number(spot) : null;
    let exposure = 0;
    let expiryDayExposure = 0;
    for (const p of shorts) {
        const notional = (underlying || p.strike) * p.units;
        exposure += notional * (isIndex ? ELM_INDEX : ELM_STOCK);
        if (isIndex && p.expiry === today) expiryDayExposure += notional * ELM_EXPIRY_DAY_INDEX;
    }

    // what each short leg would block on its own (no hedge offset): the per-leg "Margin" column
    // and the "hedge benefit" baseline. Long legs block nothing.
    const perLeg = positions.map((p) => {
        if (p.qty >= 0) return 0;
        let worst = 0;
        for (let s = 0; s < 16; s++) worst = Math.max(worst, p.opt.ra[s] * p.qty);
        const notional = (underlying || p.strike) * p.units;
        const elm = notional * (isIndex ? ELM_INDEX : ELM_STOCK) + (isIndex && p.expiry === today ? notional * ELM_EXPIRY_DAY_INDEX : 0);
        return Math.round((worst + elm) * 100) / 100;
    });

    const r = (v) => Math.round(v * 100) / 100;
    return {
        available: true,
        file: state.file,
        scanRisk: r(scanRisk),
        calendarCharge: r(calendarCharge),
        exposure: r(exposure),
        expiryDayExposure: r(expiryDayExposure),
        margin: r(scanRisk + calendarCharge + exposure + expiryDayExposure),
        standaloneMargin: r(perLeg.reduce((a, b) => a + b, 0)),
        perLeg, // aligned with the request's legs

    };
}

function status() {
    return { file: state.file, loadedAt: state.loadedAt ? new Date(state.loadedAt).toISOString() : null, portfolios: state.oopIndex?.size || 0 };
}

module.exports = { calculateMargin, ensureLoaded, status };
