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
async function getOptionChainSide({ stockCode, exchangeCode = "NFO", expiryDate, right, strikePrice }) {
    await connect();
    const body = { stock_code: stockCode, exchange_code: exchangeCode, product_type: "options" };
    if (expiryDate) body.expiry_date = expiryDate;
    if (right) body.right = right;
    if (strikePrice) body.strike_price = strikePrice;

    const headers = breeze.generateHeaders(body);
    const res = await breeze.makeRequest(apiRequest.GET, apiEndpoint.OPT_CHAIN, body, headers);
    if (res.data.Status && res.data.Status !== 200) {
        throw new Error(`Breeze option chain error: ${res.data.Error}`);
    }
    return res.data.Success ?? [];
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
            underlyingPrice: Number(c.spot_price),
            ceLtp: c.ltp, ceOi: c.open_interest, ceOiChange: c.chnge_oi,
            ceVolume: Number(c.total_quantity_traded),
        });
    }
    for (const p of puts) {
        const row = byStrike.get(p.strike_price) ?? { strike: p.strike_price, underlyingPrice: Number(p.spot_price) };
        row.peLtp = p.ltp; row.peOi = p.open_interest; row.peOiChange = p.chnge_oi;
        row.peVolume = Number(p.total_quantity_traded);
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
    getOptionChainSide,
    getFullOptionChain,
    getContractHistory,
    getHistoricalData,
    subscribeLiveFeed,
    unsubscribeLiveFeed,
    disconnectLiveFeed,
};
