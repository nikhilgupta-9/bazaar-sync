// kotak/marketData.js — assemble one live snapshot from Kotak Neo.
//
// buildChainSnapshot(symbol):  works for any of the 7 F&O indices OR any of
// the ~210 F&O stocks.
//   1. quote the spot                 -> underlying price
//   2. resolve strike window          (N strikes around the listed strike
//                                      nearest spot, nearest expiry)
//   3. quote every CE/PE in the window
//   4. compute IV + Greeks per contract via utils/blackScholes.js
//      (identical convention to services/cron.js's storeOptionChainMinutes)
//
// getVix() / getFuture(symbol): single-instrument quotes for the header
// tiles + ohlcv_data persistence.

const cfg = require("../config/kotak");
const bs = require("../utils/blackScholes");
const instruments = require("./instruments");
const { getQuotes, getOne } = require("./quotes");
const { dbLogger } = require("../config/logger");

function greeksFor(right, { ltp, spot, strike, t }) {
    const blank = { iv: null, delta: null, gamma: null, theta: null, vega: null };
    if (!(ltp > 0) || !(spot > 0) || !(t > 0)) return blank;
    const bsRight = right === "CE" ? "call" : "put";
    const iv = bs.impliedVolatility({ marketPrice: ltp, spot, strike, t, right: bsRight });
    if (iv == null) return blank;
    const g = bs.greeks({ spot, strike, t, vol: iv, right: bsRight });
    return {
        iv: Number((iv * 100).toFixed(2)),
        delta: Number(g.delta.toFixed(4)),
        gamma: Number(g.gamma.toFixed(6)),
        theta: Number(g.theta.toFixed(4)),
        vega: Number(g.vega.toFixed(4)),
    };
}

/**
 * @param {string} symbol  index key or stock symbol
 * @param {{ strikesPerSide?: number, expiryOffset?: number }} opts
 * @returns {Promise<{ underlying, expiry, spot, atm, snapshotAt, spotQuote, rows }>}
 */
async function buildChainSnapshot(symbol, { strikesPerSide, expiryOffset = 0 } = {}) {
    const sym = symbol.toUpperCase();
    const tier = instruments.isIndex(sym) ? cfg.tiers.index : cfg.tiers.stock;
    const perSide = strikesPerSide ?? tier.strikesPerSide;

    // 1) spot
    const spotRef = await instruments.getSpot(sym);
    const spotQuote = spotRef
        ? await getOne(spotRef.token, spotRef.seg, "ltp")
        : await getOne(cfg.indices[sym]?.indexName || sym, cfg.seg.NSE_CASH, "ltp");
    const spot = spotQuote?.ltp;
    if (!(spot > 0)) throw new Error(`kotak: no spot for ${sym}`);

    // 2) nearest expiry + strike window
    const expiries = await instruments.getExpiries(sym);
    const expiry = expiries[expiryOffset] || expiries[0];
    if (!expiry) throw new Error(`kotak: no future expiry for ${sym}`);

    const { contracts, atm } = await instruments.getOptionContracts(sym, expiry, {
        centerPrice: spot,
        strikesPerSide: perSide,
    });
    if (!contracts.length) throw new Error(`kotak: no contracts for ${sym} ${expiry}`);

    // 3) quote (contracts may span nse_fo or bse_fo — group by their own seg)
    const quoteMap = await getQuotes(
        contracts.map((c) => ({ token: c.token, seg: c.seg })),
        "all"
    );

    // 4) merge per strike + Greeks
    const t = bs.yearsToExpiry(expiry);
    const byStrike = new Map();
    for (const c of contracts) {
        let row = byStrike.get(c.strike);
        if (!row) {
            row = { strike: c.strike, ce: null, pe: null };
            byStrike.set(c.strike, row);
        }
        const q = quoteMap.get(`${c.seg}|${c.token}`);
        const side = q
            ? {
                  token: c.token,
                  ltp: q.ltp,
                  oi: q.oi,
                  volume: q.volume,
                  bid: q.bid,
                  ask: q.ask,
                  ...greeksFor(c.right, { ltp: q.ltp, spot, strike: c.strike, t }),
              }
            : { token: c.token, ltp: null, oi: null, volume: null, bid: null, ask: null, iv: null, delta: null, gamma: null, theta: null, vega: null };
        if (c.right === "CE") row.ce = side;
        else row.pe = side;
    }

    const rows = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
    dbLogger.info(`[kotak] ${sym} ${expiry} spot=${spot} atm=${atm} strikes=${rows.length}`);
    return { underlying: sym, expiry, spot, atm, snapshotAt: new Date(), spotQuote, rows };
}

/** India VIX normalized quote. */
async function getVix() {
    const token = await instruments.getVixToken();
    return token
        ? getOne(token, cfg.seg.NSE_CASH, "all")
        : getOne(cfg.vixQuoteName, cfg.seg.NSE_CASH, "all");
}

/** Nearest-future normalized quote + contract meta, or null. */
async function getFuture(symbol) {
    const fut = await instruments.getNearestFuture(symbol);
    if (!fut) return null;
    const q = await getOne(fut.token, fut.seg, "all");
    return q ? { ...q, expiry: fut.expiry, lotSize: fut.lotSize } : null;
}

module.exports = { buildChainSnapshot, getVix, getFuture };
