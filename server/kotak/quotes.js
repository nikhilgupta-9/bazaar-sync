// kotak/quotes.js — Kotak Neo REST Quotes.
//
// One GET can carry many instruments (comma-separated "seg|token"). We chunk
// to stay under any per-request cap and under the rate limit (~10 req/s).
// On a 401/403 we re-login once and retry the same chunk.
//
// Kotak sends short feed keys; we normalize to friendly names. Different
// quote types populate different subsets — for the option chain we ask for
// "all" (LTP + OI + volume + best bid/ask). Index rows report LTP under `iv`.

const cfg = require("../config/kotak");
const { authHeaders, refresh } = require("./auth");
const { dbLogger } = require("../config/logger");

function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

function n(v) {
    if (v === undefined || v === null || v === "") return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
}

function pick(obj, keys) {
    for (const k of keys) {
        const val = n(obj[k]);
        if (val !== null) return val;
    }
    return null;
}

// Map one raw Kotak quote object to a normalized shape.
function normalize(q) {
    const seg = q.e || q.exchange_segment || q.exchange || "";
    const token = q.tk || q.instrument_token || q.token || "";
    const isIndex = q.name === "if" || (q.iv !== undefined && q.ltp === undefined);

    return {
        key: seg && token ? `${seg}|${token}` : null,
        seg,
        token: String(token),
        tradingSymbol: q.ts || q.trading_symbol || null,
        ltp: isIndex ? pick(q, ["iv", "ltp", "last_traded_price"]) : pick(q, ["ltp", "last_traded_price"]),
        prevClose: pick(q, isIndex ? ["ic", "prev_day_close", "c"] : ["c", "close", "prev_day_close"]),
        open: pick(q, ["op", "openingPrice", "open"]),
        high: pick(q, ["h", "highPrice", "high"]),
        low: pick(q, ["lo", "lowPrice", "low"]),
        volume: pick(q, ["v", "volume"]),
        oi: pick(q, ["oi", "open_interest"]),
        bid: pick(q, ["bp", "buy_price"]),
        ask: pick(q, ["sp", "sell_price"]),
        changePct: pick(q, ["nc", "net_change_percentage", "cng"]),
        feedTs: pick(q, ["ltt", "ftdm", "tvalue"]),
    };
}

/**
 * @param {Array<{token:string, seg:string}>} instruments
 * @param {"all"|"ltp"|"oi"|"ohlc"} type
 * @returns {Promise<Map<string, object>>}  key `${seg}|${token}` -> normalized quote
 */
async function getQuotes(instruments, type = "all") {
    const result = new Map();
    if (!instruments.length) return result;

    for (const group of chunk(instruments, cfg.quotesChunkSize)) {
        const neoSymbols = group.map((i) => `${i.seg}|${i.token}`).join(",");
        const path = cfg.paths.quotes
            .replace("{neoSymbols}", encodeURIComponent(neoSymbols))
            .replace("{type}", type);
        const url = `${cfg.loginBase}${path}`;

        let res = await fetch(url, { headers: await authHeaders() });
        if (res.status === 401 || res.status === 403) {
            await refresh();
            res = await fetch(url, { headers: await authHeaders() });
        }
        if (!res.ok) {
            dbLogger.error(`[kotak] quotes ${res.status} for ${group.length} tokens`);
            throw new Error(`kotak quotes HTTP ${res.status}`);
        }

        const json = await res.json();
        // Response shape varies by revision:
        //   { data: [ {...} ] }  |  { data: { "seg|tok": {...} } }  |  [ {...} ]  |  { "seg|tok": {...} }
        const items = Array.isArray(json)
            ? json
            : Array.isArray(json.data)
              ? json.data
              : json.data && typeof json.data === "object"
                ? Object.values(json.data)
                : Object.values(json).filter((v) => v && typeof v === "object");

        for (const raw of items) {
            const norm = normalize(raw);
            if (norm.key) result.set(norm.key, norm);
        }
    }
    return result;
}

/** Single-instrument convenience: returns the normalized quote or null. */
async function getOne(token, seg, type = "all") {
    const map = await getQuotes([{ token: String(token), seg }], type);
    return [...map.values()][0] || null;
}

module.exports = { getQuotes, getOne };
