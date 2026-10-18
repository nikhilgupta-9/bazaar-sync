// server/services/cryptoHistoricalService.js — real historical crypto option chains
// for the Crypto Backtester (/simulator/crypto).
//
// Source: Delta Exchange's public candle API, which keeps 1-minute history for
// EXPIRED products too (checked back to Dec 2023):
//   - underlying:  /v2/history/candles?symbol=.DEXBTUSD   (spot index)
//   - options:     /v2/history/candles?symbol=MARK:C-BTC-84000-250926  (mark price)
// Delta exposes no bid/ask/OI history, so those fields are null here; IV and
// Greeks are solved from the real mark price + real spot at that minute
// (Black-Scholes, r = 0 for crypto) — same convention as the rest of the app.
//
// A "day" is the IST calendar day (00:00–23:59 IST); Delta settles options at
// 12:00 UTC = 17:30 IST. Past data never changes, so everything is cached.
const https = require("https");
const { impliedVolatility, greeks } = require("../utils/blackScholes");

const DELTA_BASE_URL = "https://api.delta.exchange";
// Same products, but India keeps a few index histories global doesn't (e.g. .DESOLUSD).
const DELTA_INDIA_URL = "https://api.india.delta.exchange";
const IST_OFFSET_SEC = 5.5 * 3600;
const MIN_DATE = "2024-01-01";
const HALF_STRIKES = 16; // strikes probed each side of the day's opening ATM (~33 rows, like the live chain)
const CONCURRENCY = 8;
const YEAR_SEC = 365 * 24 * 3600;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Strike grid per coin by days-to-expiry. Probed strikes that Delta never
// listed simply come back empty and are dropped, so a fine grid is safe.
const COINS = {
    BTC: { index: ".DEXBTUSD", contractValue: 0.001, steps: [[3, 200], [14, 500], [Infinity, 1000]], probeStep: 1000 },
    ETH: { index: ".DEETHUSD", contractValue: 0.01, steps: [[3, 20], [14, 50], [Infinity, 100]], probeStep: 100 },
    SOL: { index: ".DESOLUSD", contractValue: 1, steps: null, probeStep: null }, // Delta lists no SOL options
};

function badRequest(msg) {
    return Object.assign(new Error(msg), { status: 400 });
}

function fetchJson(path, base = DELTA_BASE_URL) {
    return new Promise((resolve, reject) => {
        const req = https.get(
            base + path,
            { headers: { "User-Agent": "BazaarSync-DeltaHistory/1.0", Accept: "application/json" }, timeout: 15000 },
            (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => {
                    if (res.statusCode !== 200) return reject(new Error(`Delta API HTTP ${res.statusCode}: ${body.slice(0, 120)}`));
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(e);
                    }
                });
            }
        );
        req.on("timeout", () => req.destroy(new Error("Delta API timeout")));
        req.on("error", reject);
    });
}

// 1-minute candles for [startSec, endSec). Returns [] for symbols Delta never listed.
async function candles(symbol, startSec, endSec) {
    const q = `/v2/history/candles?resolution=1m&symbol=${encodeURIComponent(symbol)}&start=${startSec}&end=${endSec}`;
    const json = await fetchJson(q);
    const rows = Array.isArray(json.result) ? json.result : [];
    if (rows.length || !symbol.startsWith(".")) return rows;
    const india = await fetchJson(q, DELTA_INDIA_URL);
    return Array.isArray(india.result) ? india.result : [];
}

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

// Small LRU so a few hundred replay requests don't grow memory without bound.
function lru(max) {
    const m = new Map();
    return {
        get(k) {
            if (!m.has(k)) return undefined;
            const v = m.get(k);
            m.delete(k);
            m.set(k, v);
            return v;
        },
        set(k, v) {
            m.delete(k);
            m.set(k, v);
            while (m.size > max) m.delete(m.keys().next().value);
        },
    };
}
const dayCache = lru(40); // coin|date        -> { spot[], expiries[] }
const chainCache = lru(60); // coin|date|expiry -> { strikes[] }
const inflight = new Map(); // dedupe concurrent loads of the same key

function once(key, loader) {
    if (inflight.has(key)) return inflight.get(key);
    const p = loader().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
}

// ---------------------------------------------------------------- date helpers
// Plain-string date math only (CLAUDE.md Gotcha #12).
function parseDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
    if (!m) throw badRequest("date must be YYYY-MM-DD");
    return { y: +m[1], mo: +m[2], d: +m[3] };
}
function istDayStartSec(dateStr) {
    const { y, mo, d } = parseDate(dateStr);
    return Date.UTC(y, mo - 1, d) / 1000 - IST_OFFSET_SEC;
}
function todayIst() {
    const t = new Date(Date.now() + IST_OFFSET_SEC * 1000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function settleSec(y, mo, d) {
    return Date.UTC(y, mo - 1, d, 12, 0, 0) / 1000; // Delta settles at 12:00 UTC
}
function ddmmyy(sec) {
    const t = new Date(sec * 1000);
    return `${String(t.getUTCDate()).padStart(2, "0")}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCFullYear()).slice(2)}`;
}
function expiryLabel(sec) {
    const t = new Date(sec * 1000);
    return `${String(t.getUTCDate()).padStart(2, "0")} ${MONTHS[t.getUTCMonth()]} ${String(t.getUTCFullYear()).slice(2)}`;
}
function timeLeft(fromSec, toSec) {
    const diff = toSec - fromSec;
    if (diff <= 0) return "Expired";
    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    return days > 0 ? `${days}d:${hours}h:${mins}m` : `${hours}h:${mins}m`;
}

// Delta's expiry calendar: dailies, Friday weeklies, last-Friday monthlies and
// quarterlies. Generate every plausible settlement alive during the day; the
// probe below keeps only the ones that really traded.
function candidateExpiries(dayStart) {
    const set = new Set();
    const first = new Date(dayStart * 1000);
    for (let i = 0; i <= 120; i++) {
        const t = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate() + i));
        const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1, d = t.getUTCDate();
        const s = settleSec(y, mo, d);
        if (s <= dayStart) continue;
        const isFriday = t.getUTCDay() === 5;
        const lastOfMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const isLastFriday = isFriday && d + 7 > lastOfMonth;
        if (i <= 3 || (isFriday && i <= 35) || isLastFriday) set.add(s);
    }
    return [...set].sort((a, b) => a - b);
}

function stepFor(coin, daysToExpiry) {
    for (const [maxDays, step] of COINS[coin].steps) if (daysToExpiry <= maxDays) return step;
    return COINS[coin].steps.at(-1)[1];
}

// minute index (0..1439 in the IST day) -> close, carried forward over gaps
function toMinuteSeries(rows, dayStart) {
    const out = new Array(1440).fill(null);
    for (const c of rows) {
        const i = Math.floor((c.time - dayStart) / 60);
        if (i >= 0 && i < 1440 && Number.isFinite(c.close)) out[i] = c.close;
    }
    let last = null;
    for (let i = 0; i < 1440; i++) {
        if (out[i] == null) out[i] = last;
        else last = out[i];
    }
    return out;
}

// ---------------------------------------------------------------- loaders
async function loadDay(coin, date) {
    const key = `${coin}|${date}`;
    const hit = dayCache.get(key);
    if (hit) return hit;
    return once(key, async () => {
        const cfg = COINS[coin];
        const dayStart = istDayStartSec(date);
        const spotRows = await candles(cfg.index, dayStart, dayStart + 86400);
        if (!spotRows.length) throw Object.assign(new Error(`No ${coin} price history on Delta Exchange for ${date}`), { status: 404 });
        const spot = toMinuteSeries(spotRows, dayStart);
        const openSpot = spot.find((v) => v != null);

        let expiries = [];
        if (cfg.steps) {
            const cands = candidateExpiries(dayStart);
            const found = await mapLimit(cands, CONCURRENCY, async (s) => {
                const k = Math.round(openSpot / cfg.probeStep) * cfg.probeStep;
                for (const strike of [k, k + cfg.probeStep, k - cfg.probeStep]) {
                    const rows = await candles(`MARK:C-${coin}-${strike}-${ddmmyy(s)}`, dayStart, Math.min(dayStart + 86400, s));
                    if (rows.length) return s;
                }
                return null;
            });
            expiries = found.filter(Boolean);
        }
        const day = { dayStart, spot, openSpot, expiries };
        dayCache.set(key, day);
        return day;
    });
}

async function loadChain(coin, date, expirySec, day) {
    const key = `${coin}|${date}|${expirySec}`;
    const hit = chainCache.get(key);
    if (hit) return hit;
    return once(key, async () => {
        const cfg = COINS[coin];
        const end = Math.min(day.dayStart + 86400, expirySec + 60);
        const step = stepFor(coin, (expirySec - day.dayStart) / 86400);
        const atm = Math.round(day.openSpot / step) * step;
        const strikes = [];
        for (let i = -HALF_STRIKES; i <= HALF_STRIKES; i++) strikes.push(atm + i * step);

        const tag = ddmmyy(expirySec);
        const loaded = await mapLimit(strikes, CONCURRENCY, async (strike) => {
            const [c, p] = await Promise.all([
                candles(`MARK:C-${coin}-${strike}-${tag}`, day.dayStart, end),
                candles(`MARK:P-${coin}-${strike}-${tag}`, day.dayStart, end),
            ]);
            if (!c.length && !p.length) return null;
            return {
                strike,
                call: c.length ? toMinuteSeries(c, day.dayStart) : null,
                put: p.length ? toMinuteSeries(p, day.dayStart) : null,
            };
        });
        const chain = { strikes: loaded.filter(Boolean) };
        chainCache.set(key, chain);
        return chain;
    });
}

// ---------------------------------------------------------------- public API
function meta() {
    return { minDate: MIN_DATE, maxDate: previousDay(todayIst()), coins: Object.keys(COINS), optionCoins: ["BTC", "ETH"] };
}
function previousDay(dateStr) {
    const { y, mo, d } = parseDate(dateStr);
    const t = new Date(Date.UTC(y, mo - 1, d - 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

// Delta marks options off its own underlying (a touch above the spot index —
// ~0.15% in samples), so solving IV against the index makes ITM puts look
// like 0% IV. Recover that underlying from put-call parity instead
// (C - P = F - K at r = 0): median of K + C - P over the 5 strikes nearest spot.
function parityForward(strikes, i, spot) {
    const pts = strikes
        .filter((s) => s.call && s.put && s.call[i] > 0 && s.put[i] > 0)
        .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
        .slice(0, 5)
        .map((s) => s.strike + s.call[i] - s.put[i])
        .sort((a, b) => a - b);
    if (!pts.length) return null;
    const mid = Math.floor(pts.length / 2);
    return pts.length % 2 ? pts[mid] : (pts[mid - 1] + pts[mid]) / 2;
}

function sideAt(series, i, ctx, right, strike, symbol, expirySec) {
    const mark = series ? series[i] : null;
    if (mark == null || !(mark > 0)) return null;
    const t = Math.max((expirySec - ctx.ts) / YEAR_SEC, 1 / (365 * 24 * 4)); // 15-min floor, like yearsToExpiry
    const iv = impliedVolatility({ marketPrice: mark, spot: ctx.spot, strike, t, right, r: 0 });
    const g = iv ? greeks({ spot: ctx.spot, strike, t, vol: iv, right, r: 0 }) : { delta: null, gamma: null, theta: null, vega: null };
    return {
        symbol,
        productId: null,
        contractType: right,
        strike,
        expiryDate: new Date(expirySec * 1000).toISOString(),
        expiryLabel: expiryLabel(expirySec),
        markPrice: Number(mark.toFixed(4)),
        markIv: iv ? Number((iv * 100).toFixed(2)) : null,
        // Delta keeps no bid/ask/OI history — left empty rather than invented
        bidPrice: null, bidIv: null, bidQty: null,
        askPrice: null, askIv: null, askQty: null,
        oi: null, oiValueUsd: null, volume: null, oiPercent: 0,
        delta: g.delta, gamma: g.gamma, theta: g.theta, vega: g.vega,
        leverage: null,
        contractValue: COINS[ctx.coin].contractValue,
    };
}

/**
 * Option chain as it stood at `time` (HH:MM IST) on `date`, in the same shape
 * as the live /api/crypto/option-chain response so the Strategy Builder UI can
 * render it unchanged. Expiries already settled by `time` are left out.
 */
async function getHistoricalChain({ underlying = "BTC", date, time = "09:15", expiry = null }) {
    const coin = String(underlying).toUpperCase();
    if (!COINS[coin]) throw badRequest(`Unsupported coin ${underlying}`);
    const { minDate, maxDate } = meta();
    if (!date || date < minDate || date > maxDate) throw badRequest(`date must be between ${minDate} and ${maxDate}`);
    const tm = /^(\d{1,2}):(\d{2})$/.exec(String(time));
    if (!tm || +tm[1] > 23 || +tm[2] > 59) throw badRequest("time must be HH:MM (IST)");
    const minute = +tm[1] * 60 + +tm[2];

    const day = await loadDay(coin, date);
    const ts = day.dayStart + minute * 60;
    const spot = day.spot[minute];
    if (spot == null) throw Object.assign(new Error(`No ${coin} price for ${date} ${time} IST`), { status: 404 });

    const alive = day.expiries.filter((s) => s > ts);
    const expiries = alive.map((s) => ({ raw: new Date(s * 1000).toISOString(), label: expiryLabel(s), timeToExpiry: timeLeft(ts, s), timestamp: s * 1000 }));
    const wanted = expiry ? Math.floor(new Date(expiry).getTime() / 1000) : null;
    const activeSec = alive.includes(wanted) ? wanted : alive[0] || null;

    let chain = [];
    let ivUnderlying = null;
    if (activeSec) {
        const series = await loadChain(coin, date, activeSec, day);
        ivUnderlying = parityForward(series.strikes, minute, spot);
        const ctx = { coin, spot: ivUnderlying ?? spot, ts }; // IV/Greeks priced off Delta's own underlying
        const tag = ddmmyy(activeSec);
        chain = series.strikes
            .map((s) => ({
                strike: s.strike,
                call: sideAt(s.call, minute, ctx, "call", s.strike, `C-${coin}-${s.strike}-${tag}`, activeSec),
                put: sideAt(s.put, minute, ctx, "put", s.strike, `P-${coin}-${s.strike}-${tag}`, activeSec),
            }))
            .filter((r) => r.call || r.put);
    }

    return {
        underlying: coin,
        spotPrice: Number(spot.toFixed(2)),
        spot24hChange: day.openSpot ? Number((((spot - day.openSpot) / day.openSpot) * 100).toFixed(4)) : null, // vs 00:00 IST
        spot24hVol: null,
        expiries,
        activeExpiry: expiries.find((e) => e.timestamp === activeSec * 1000) || null,
        chain,
        totalStrikes: chain.length,
        timestamp: ts * 1000,
        historical: {
            date,
            time: `${tm[1].padStart(2, "0")}:${tm[2]}`,
            dayOpenSpot: day.openSpot,
            ivUnderlying: ivUnderlying != null ? Number(ivUnderlying.toFixed(2)) : null, // put-call-parity forward used for IV/Greeks
            source: "Delta Exchange 1-min mark price (IV/Greeks solved from mark)",
            hasOptions: Boolean(COINS[coin].steps),
        },
    };
}

/** Minute-by-minute spot for the day — powers the replay scrubber's price line. */
async function getHistoricalSpotSeries({ underlying = "BTC", date }) {
    const coin = String(underlying).toUpperCase();
    if (!COINS[coin]) throw badRequest(`Unsupported coin ${underlying}`);
    const day = await loadDay(coin, date);
    return { underlying: coin, date, spot: day.spot };
}

module.exports = { meta, getHistoricalChain, getHistoricalSpotSeries };
