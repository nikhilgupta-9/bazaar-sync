const { BreezeConnect } = require("breezeconnect");
const { apiRequest, apiEndpoint } = require("breezeconnect/config");

// The breezeconnect package sets process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
// as an import side effect, which disables TLS certificate verification for
// the ENTIRE process. Node re-checks this env var per connection (it isn't
// cached at import time), so restoring it here re-enables verification for
// every HTTPS call made afterwards, including breezeconnect's own.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";

const appKey = process.env.BREEZE_API_KEY;
const appSecret = process.env.BREEZE_API_SECRET;
// Breeze requires a session token generated daily via a manual browser login
// (2FA/TOTP means there is no pure API login flow):
// https://api.icicidirect.com/apiuser/login?api_key=<url-encoded BREEZE_API_KEY>
// Copy the API_Session value from the redirect URL into BREEZE_API_SESSION in .env.
const apiSession = process.env.BREEZE_API_SESSION;

const breeze = new BreezeConnect({ appKey });

let sessionReady = null;

function connect() {
    if (!appKey || !appSecret || !apiSession) {
        throw new Error(
            "Missing BREEZE_API_KEY, BREEZE_API_SECRET or BREEZE_API_SESSION in .env"
        );
    }
    if (!sessionReady) {
        sessionReady = breeze.generateSession(appSecret, apiSession);
    }
    return sessionReady;
}

// breezeconnect@1.0.31's getOptionChainQuotes() has a broken exchange-code
// check — `x.toLowerCase() !== "nfo" || x.toLowerCase() !== "bfo"` is always
// true for any string, so it rejects every call. We bypass it and call the
// same "optionchain" endpoint directly with breeze's own header signing
// (generateHeaders/makeRequest are public instance methods, just undocumented).
// Verified against the live API (2026-07-02): passing only {right, expiryDate}
// (no strikePrice) returns every strike for that expiry+right in one call.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Concurrent/rapid requests get rate-limited by Breeze — and breezeconnect's
// own error handler has a scope bug (references a try-block `let url` from
// inside its catch block), so a rate-limit failure surfaces as a confusing
// "url is not defined" ReferenceError instead of the real cause. Retrying
// with backoff papers over both: the transient rate limit, and the bug that
// obscures it. Verified: 4 concurrent identical requests reliably produced
// one such failure.
async function withRetry(fn, { attempts = 3, baseDelayMs = 300 } = {}) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i < attempts - 1) await sleep(baseDelayMs * (i + 1));
        }
    }
    throw lastErr;
}

async function getOptionChainSide({ stockCode, exchangeCode = "NFO", expiryDate, right, strikePrice }) {
    await connect();
    const body = { stock_code: stockCode, exchange_code: exchangeCode, product_type: "options" };
    if (expiryDate) body.expiry_date = expiryDate;
    if (right) body.right = right;
    if (strikePrice) body.strike_price = strikePrice;

    return withRetry(async () => {
        const headers = breeze.generateHeaders(body);
        const res = await breeze.makeRequest(apiRequest.GET, apiEndpoint.OPT_CHAIN, body, headers);
        if (res.data.Status && res.data.Status !== 200) {
            throw new Error(`Breeze option chain error: ${res.data.Error}`);
        }
        return res.data.Success ?? [];
    });
}

// Merges call + put legs for one expiry into one row per strike, matching
// the option_chain_history schema. Breeze's option chain response has no
// Greeks or IV — those are computed separately (see server/utils once built).
async function getFullOptionChain({ stockCode, exchangeCode = "NFO", expiryDate }) {
    const [calls, puts] = await Promise.all([
        getOptionChainSide({ stockCode, exchangeCode, expiryDate, right: "call" }),
        getOptionChainSide({ stockCode, exchangeCode, expiryDate, right: "put" }),
    ]);

    const byStrike = new Map();
    for (const c of calls) {
        byStrike.set(c.strike_price, {
            strike: c.strike_price,
            expiry: c.expiry_date,
            underlyingPrice: Number(c.spot_price),
            ceLtp: c.ltp, ceOi: c.open_interest, ceOiChange: c.chnge_oi,
            ceVolume: Number(c.total_quantity_traded), ceLtpChangePercent: c.ltp_percent_change,
        });
    }
    for (const p of puts) {
        const row = byStrike.get(p.strike_price) ?? { strike: p.strike_price, expiry: p.expiry_date, underlyingPrice: Number(p.spot_price) };
        row.peLtp = p.ltp; row.peOi = p.open_interest; row.peOiChange = p.chnge_oi;
        row.peVolume = Number(p.total_quantity_traded); row.peLtpChangePercent = p.ltp_percent_change;
        byStrike.set(p.strike_price, row);
    }
    return Array.from(byStrike.values());
}

async function getHistoricalData({
    interval,
    fromDate,
    toDate,
    stockCode,
    exchangeCode = "NFO",
    productType,
    expiryDate,
    right,
    strikePrice,
}) {
    await connect();
    return breeze.getHistoricalDatav2({
        interval,
        fromDate,
        toDate,
        stockCode,
        exchangeCode,
        productType,
        expiryDate,
        right,
        strikePrice,
    });
}

async function subscribeLiveFeed(feedParams, onTick) {
    await connect();
    breeze.onTicks = onTick;
    breeze.wsConnect();
    return breeze.subscribeFeeds(feedParams);
}

function unsubscribeLiveFeed(feedParams) {
    return breeze.unsubscribeFeeds(feedParams);
}

function disconnectLiveFeed() {
    breeze.wsDisconnect();
}

// Breeze's option chain *response* gives expiry as "07-Jul-2026" (display
// format), but *requests* (getFullOptionChain, getContractHistory) need ISO
// "2026-07-07T07:00:00.000Z". These two helpers convert between them.
// Parsed manually (not via `new Date(string)`) because that's timezone-
// dependent — on this IST machine it silently rolled the date back a day
// (toISOString() converts to UTC, crossing midnight); on a UTC server it
// would parse differently again. A calendar date string needs no timezone.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function expiryDisplayToApi(display) {
    const [day, mon, year] = display.split("-");
    const month = String(MONTHS.indexOf(mon) + 1).padStart(2, "0");
    return `${year}-${month}-${day.padStart(2, "0")}T07:00:00.000Z`;
}

function expiryApiToSql(apiDate) {
    return apiDate.slice(0, 10);
}

// Breeze's option-chain/historical endpoints use their own internal stock
// codes for indices, NOT the common display names — this isn't documented
// anywhere and was only found by trial: BankNifty and FinNifty both threw
// "Error while calling service, Please contact admin" under every strike
// with the obvious names, and that generic error gave no hint the stock
// code itself was wrong. Verified against the live API (2026-07-02).
// cron.js and optionChainController.js both key off the display name and
// must resolve through this map before calling any breeze.* function.
const SYMBOL_CODES = { NIFTY: "NIFTY", BANKNIFTY: "CNXBAN", FINNIFTY: "NIFFIN" };

// Rough central strike per symbol (keyed by the real Breeze code above), used
// only to bootstrap expiry discovery (see discoverChain below) — not the real
// ATM strike. TODO: replace with a dedicated spot-price lookup (e.g.
// breeze.getQuotes for the cash index) instead of guessing a listed strike.
const PROBE_STRIKE = { NIFTY: "25000", CNXBAN: "55000", NIFFIN: "26000" };

// Breeze has no "list expiries" endpoint. Passing {right, strikePrice} with no
// expiryDate returns every expiry currently listed for that one strike, and
// every response row also carries the live spot_price — so one call gives us
// both the available expiries and a live spot price to compute the real ATM
// strike from. `stockCode` here must already be a real Breeze code (see
// SYMBOL_CODES) — this function doesn't do the display-name mapping.
async function discoverChain({ stockCode, exchangeCode = "NFO" }) {
    const probeStrike = PROBE_STRIKE[stockCode] ?? "25000";
    const rows = await getOptionChainSide({ stockCode, exchangeCode, right: "call", strikePrice: probeStrike });
    if (!rows.length) throw new Error(`No option chain data found for ${stockCode} (probe strike ${probeStrike})`);
    const expiries = [...new Set(rows.map((r) => r.expiry_date))].sort(
        (a, b) => expiryDisplayToApi(a).localeCompare(expiryDisplayToApi(b))
    );
    return { spotPrice: Number(rows[0].spot_price), expiries };
}

// Historical OHLCV+OI time series for one specific contract (strike+right+expiry),
// via getHistoricalDatav2 — this is the only way to get intraday/historical option
// data; the live "optionchain" endpoint only returns a single current snapshot.
async function getContractHistory({ stockCode, exchangeCode = "NFO", expiryDate, right, strikePrice, fromDate, toDate, interval = "1minute" }) {
    return getHistoricalData({
        interval, fromDate, toDate, stockCode, exchangeCode,
        productType: "options", expiryDate, right, strikePrice,
    });
}

module.exports = {
    connect,
    SYMBOL_CODES,
    getOptionChainSide,
    getFullOptionChain,
    discoverChain,
    expiryDisplayToApi,
    expiryApiToSql,
    getContractHistory,
    getHistoricalData,
    subscribeLiveFeed,
    unsubscribeLiveFeed,
    disconnectLiveFeed,
};
