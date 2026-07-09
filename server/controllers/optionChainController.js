const breeze = require("../services/breeze");
const bs = require("../utils/blackScholes");

const SYMBOL_MAP = { nifty: "NIFTY", banknifty: "BANKNIFTY", finnifty: "FINNIFTY" };

// Long Buildup / Short Buildup / Short Covering / Long Unwinding — derived
// from price direction + OI direction, both of which Breeze does give us
// (ltp_percent_change, chnge_oi). Returns null when either is missing.
function classifyBuildup(priceChangePercent, oiChange) {
    if (priceChangePercent == null || oiChange == null) return null;
    const priceUp = priceChangePercent > 0;
    const oiUp = oiChange > 0;
    if (priceUp && oiUp) return "L";
    if (!priceUp && oiUp) return "S";
    if (priceUp && !oiUp) return "SC";
    return "LU";
}

function computeAtmStrike(strikes, spot) {
    return strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]);
}

// Strike that minimizes total intrinsic-value payout to option holders at
// expiry — the classic "max pain" definition (max pain for buyers = min
// loss for writers).
function computeMaxPain(rows) {
    let bestStrike = rows[0]?.strike ?? null;
    let bestPayout = Infinity;
    for (const candidate of rows) {
        const S = candidate.strike;
        let payout = 0;
        for (const r of rows) {
            payout += (r.ceOi || 0) * Math.max(0, S - r.strike);
            payout += (r.peOi || 0) * Math.max(0, r.strike - S);
        }
        if (payout < bestPayout) {
            bestPayout = payout;
            bestStrike = S;
        }
    }
    return bestStrike;
}

function computePcr(rows) {
    const totalCe = rows.reduce((s, r) => s + (r.ceOi || 0), 0);
    const totalPe = rows.reduce((s, r) => s + (r.peOi || 0), 0);
    return totalCe ? Number((totalPe / totalCe).toFixed(2)) : null;
}

async function buildOptionChainPayload(displaySymbol, requestedExpiry) {
    const stockCode = breeze.SYMBOL_CODES[displaySymbol]; // e.g. BANKNIFTY -> CNXBAN, see breeze.js
    await breeze.connect();
    const { spotPrice, expiries } = await breeze.discoverChain({ stockCode });
    if (!expiries.length) {
        const err = new Error("No expiries returned by Breeze");
        err.status = 502;
        throw err;
    }

    const selectedExpiry = expiries.includes(requestedExpiry) ? requestedExpiry : expiries[0];
    const apiExpiry = breeze.expiryDisplayToApi(selectedExpiry);

    const rawRows = await breeze.getFullOptionChain({ stockCode, expiryDate: apiExpiry });
    const t = bs.yearsToExpiry(breeze.expiryApiToSql(apiExpiry));

    const rows = rawRows
        .filter((r) => r.strike)
        .sort((a, b) => a.strike - b.strike)
        .map((r) => {
            const spot = r.underlyingPrice || spotPrice;
            const ceIv = bs.impliedVolatility({ marketPrice: r.ceLtp, spot, strike: r.strike, t, right: "call" });
            const peIv = bs.impliedVolatility({ marketPrice: r.peLtp, spot, strike: r.strike, t, right: "put" });
            const ceGreeks = ceIv ? bs.greeks({ spot, strike: r.strike, t, vol: ceIv, right: "call" }) : null;
            const peGreeks = peIv ? bs.greeks({ spot, strike: r.strike, t, vol: peIv, right: "put" }) : null;

            return {
                strike: r.strike,
                iv: ceIv && peIv ? Number((((ceIv + peIv) / 2) * 100).toFixed(1)) : null,
                ce: {
                    ltp: r.ceLtp ?? null,
                    changePercent: r.ceLtpChangePercent ?? null,
                    oi: r.ceOi ?? null,
                    oiChange: r.ceOiChange ?? null,
                    volume: r.ceVolume ?? null,
                    iv: ceIv ? Number((ceIv * 100).toFixed(1)) : null,
                    delta: ceGreeks ? Number(ceGreeks.delta.toFixed(3)) : null,
                    gamma: ceGreeks ? Number(ceGreeks.gamma.toFixed(6)) : null,
                    theta: ceGreeks ? Number(ceGreeks.theta.toFixed(3)) : null,
                    vega: ceGreeks ? Number(ceGreeks.vega.toFixed(3)) : null,
                    buildup: classifyBuildup(r.ceLtpChangePercent, r.ceOiChange),
                },
                pe: {
                    ltp: r.peLtp ?? null,
                    changePercent: r.peLtpChangePercent ?? null,
                    oi: r.peOi ?? null,
                    oiChange: r.peOiChange ?? null,
                    volume: r.peVolume ?? null,
                    iv: peIv ? Number((peIv * 100).toFixed(1)) : null,
                    delta: peGreeks ? Number(peGreeks.delta.toFixed(3)) : null,
                    gamma: peGreeks ? Number(peGreeks.gamma.toFixed(6)) : null,
                    theta: peGreeks ? Number(peGreeks.theta.toFixed(3)) : null,
                    vega: peGreeks ? Number(peGreeks.vega.toFixed(3)) : null,
                    buildup: classifyBuildup(r.peLtpChangePercent, r.peOiChange),
                },
            };
        });

    const atmStrike = computeAtmStrike(rows.map((r) => r.strike), spotPrice);
    const maxPainStrike = computeMaxPain(rows.map((r) => ({ strike: r.strike, ceOi: r.ce.oi, peOi: r.pe.oi })));
    const pcr = computePcr(rows.map((r) => ({ ceOi: r.ce.oi, peOi: r.pe.oi })));

    return { symbol: displaySymbol, spotPrice, atmStrike, maxPainStrike, pcr, expiries, selectedExpiry, rows };
}

// Coalesces identical concurrent/rapid requests (e.g. React StrictMode's
// double-invoked effects, or several users loading the same chain at once)
// into one upstream Breeze call, and short-TTL-caches the result. This is
// the "request queuing" the project rules call for around Breeze rate
// limits — retries alone weren't enough (verified: 6 concurrent requests
// still produced 2 failures with retry-only).
const CACHE_TTL_MS = 3000;
const cache = new Map(); // key -> { promise, expiresAt }

function getCached(key, fetcher) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.promise;

    const promise = fetcher().catch((err) => {
        cache.delete(key); // don't cache failures
        throw err;
    });
    cache.set(key, { promise, expiresAt: now + CACHE_TTL_MS });
    return promise;
}

async function getOptionChain(req, res) {
    try {
        const displaySymbol = SYMBOL_MAP[req.params.symbol?.toLowerCase()];
        if (!displaySymbol) {
            return res.status(400).json({ error: "symbol must be one of nifty, banknifty, finnifty" });
        }

        const requestedExpiry = req.query.expiry; // display format, e.g. "07-Jul-2026"
        const cacheKey = `${displaySymbol}:${requestedExpiry || ""}`;
        const payload = await getCached(cacheKey, () => buildOptionChainPayload(displaySymbol, requestedExpiry));

        res.json(payload);
    } catch (err) {
        console.error("[optionChain]", err);
        res.status(err.status || 500).json({ error: err.message });
    }
}

module.exports = { getOptionChain };
