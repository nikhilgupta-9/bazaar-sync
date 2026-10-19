// lib/tvDatafeed.js — datafeed adapter for the TradingView Charting Library,
// backed by our UDF endpoints in server/routes/tvDatafeed.js (/api/tv/*)
// and direct Binance public endpoints for Crypto (BTC, ETH, SOL).
//
// All drawing tools + 100+ technical indicators live inside the standalone
// TradingView library; this adapter supplies historical & real-time bars.

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";
const TV_BASE = `${API_URL}/api/tv`;

async function getJson(path) {
    const res = await fetch(`${TV_BASE}${path}`);
    if (!res.ok) throw new Error(`tv datafeed ${path} → HTTP ${res.status}`);
    return res.json();
}

const CRYPTO_MAP = {
    BTC: "BTCUSDT",
    ETH: "ETHUSDT",
    SOL: "SOLUSDT",
    BTCUSDT: "BTCUSDT",
    ETHUSDT: "ETHUSDT",
    SOLUSDT: "SOLUSDT",
    "BTC/USDT": "BTCUSDT",
    "ETH/USDT": "ETHUSDT",
    "SOL/USDT": "SOLUSDT",
};

function getCryptoPair(name) {
    if (!name) return null;
    const clean = String(name).toUpperCase().replace(/^BINANCE:/, "").replace(/^CRYPTO:/, "").trim();
    if (CRYPTO_MAP[clean]) return CRYPTO_MAP[clean];
    // Exact coin names only — a prefix match sent NSE stocks like SOLARINDS
    // (and their option tickers) to Binance.
    return null;
}

function mapToBinanceInterval(resolution) {
    const r = String(resolution || "1D").toUpperCase();
    if (r === "1D" || r === "D") return "1d";
    if (r === "1W" || r === "W") return "1w";
    if (r === "1M" || r === "M") return "1M";
    if (r === "60") return "1h";
    if (r === "120") return "2h";
    if (r === "240") return "4h";
    const num = parseInt(r, 10);
    return isNaN(num) ? "1d" : `${num}m`;
}

const configuration = {
    supported_resolutions: ["1", "5", "15", "60", "1D", "1W", "1M"],
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [
        { value: "NSE", name: "NSE", desc: "Bazaar Sync stored data" },
        { value: "BINANCE", name: "BINANCE", desc: "Binance Real-Time Crypto" },
    ],
    symbols_types: [
        { name: "All", value: "" },
        { name: "Index", value: "index" },
        { name: "Stock", value: "stock" },
        { name: "Crypto", value: "crypto" },
    ],
};

const cryptoSockets = new Map();

// Option contract tickers (NIFTY_20261019_23150_CE) — see
// server/routes/tvDatafeed.js. Built from the chain's strike/expiry/right.
export function optionTicker(symbol, expiry, strike, right) {
    const ymd = String(expiry || "").slice(0, 10).replace(/-/g, "");
    return `${String(symbol || "").toUpperCase()}_${ymd}_${Number(strike)}_${right}`;
}
const OPTION_TICKER_RE = /^[A-Z0-9&-]+_\d{8}_\d+(\.\d+)?_(CE|PE)$/;
const isOptionTicker = (name) => OPTION_TICKER_RE.test(String(name || "").toUpperCase().replace(/^(NFO|BFO|NSE|BSE):/, ""));

// Option charts poll the stored live ticks for the current bar — the market
// worker writes them every ~2s, so a 15s poll keeps the last candle moving
// during market hours without a socket subscription per chart.
const OPTION_POLL_MS = 15000;
const RESOLUTION_SECONDS = { 1: 60, 5: 300, 15: 900, 60: 3600 };
const optionPollers = new Map();

// UDF /history → { bars (ms times), noData, nextTime (ms) }.
async function fetchHistoryBars(ticker, resolution, from, to) {
    const params = new URLSearchParams({ symbol: ticker, resolution, from: String(from), to: String(to) });
    const data = await getJson(`/history?${params}`);
    if (data.s === "no_data") return { bars: [], noData: true, nextTime: data.nextTime != null ? data.nextTime * 1000 : undefined };
    if (data.s !== "ok") throw new Error(data.errmsg || "getBars failed");
    const bars = data.t.map((time, i) => ({
        time: time * 1000,
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v ? data.v[i] : undefined,
    }));
    return { bars, noData: bars.length === 0 };
}

// ---------------------------------------------------------------------------
// Strategy "symbols" — STRATEGY_<hash>. A page registers its legs and gets a
// ticker back; the library then charts the strategy's real running P&L (₹)
// as if it were an instrument. Each bar = Σ side × (leg price − entry) ×
// qty × lot size, from every leg's REAL stored option bars (the same
// /history option tickers the contract chart uses). A leg with no bar in a
// minute carries its last price; minutes before every leg has traded once
// are skipped (the strategy can't be valued yet). Bar high/low are the
// open/close envelope — summing per-leg highs would overstate the range.
// ---------------------------------------------------------------------------
const strategies = new Map(); // ticker -> { symbol, label, spec: [{ ticker, sign, mult, entry }] }

function hashKey(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36).toUpperCase();
}

export function registerStrategy(symbol, legs) {
    const clean = (legs || []).filter(
        (l) => l && l.active !== false && !l.exit && l.strike && l.expiry && (l.type === "CE" || l.type === "PE") && Number.isFinite(Number(l.premium))
    );
    if (!clean.length) return null;
    const spec = clean.map((l) => ({
        ticker: optionTicker(symbol, l.expiry, l.strike, l.type),
        sign: l.action === "buy" ? 1 : -1,
        mult: (Number(l.qty) || 1) * (Number(l.lotSize) || 1),
        entry: Number(l.premium),
    }));
    const ticker = `STRATEGY_${hashKey(JSON.stringify(spec))}`;
    const label = clean.map((l) => `${l.action === "buy" ? "B" : "S"} ${l.qty}× ${Number(l.strike)} ${l.type}`).join(" · ");
    strategies.set(ticker, { symbol: String(symbol || "").toUpperCase(), label, spec });
    return ticker;
}
const strategyOf = (name) => strategies.get(String(name || "").toUpperCase().replace(/^BAZAAR:/, ""));

async function strategyBars(strat, resolution, from, to) {
    const results = await Promise.all(strat.spec.map((leg) => fetchHistoryBars(leg.ticker, resolution, from, to).catch(() => ({ bars: [], noData: true }))));
    if (results.every((r) => !r.bars.length)) {
        const nexts = results.map((r) => r.nextTime).filter(Boolean);
        return { bars: [], noData: true, nextTime: nexts.length ? Math.max(...nexts) : undefined };
    }
    const byLeg = results.map((r) => new Map(r.bars.map((b) => [b.time, b])));
    const times = [...new Set(results.flatMap((r) => r.bars.map((b) => b.time)))].sort((a, b) => a - b);
    const last = strat.spec.map(() => null);
    const bars = [];
    for (const t of times) {
        let o = 0;
        let c = 0;
        let ready = true;
        strat.spec.forEach((leg, i) => {
            const b = byLeg[i].get(t);
            const open = b ? b.open : last[i];
            const close = b ? b.close : last[i];
            if (b) last[i] = b.close;
            if (close == null) {
                ready = false;
                return;
            }
            o += leg.sign * ((open ?? close) - leg.entry) * leg.mult;
            c += leg.sign * (close - leg.entry) * leg.mult;
        });
        if (!ready) continue;
        o = Math.round(o * 100) / 100;
        c = Math.round(c * 100) / 100;
        bars.push({ time: t, open: o, high: Math.max(o, c), low: Math.min(o, c), close: c });
    }
    return { bars, noData: bars.length === 0 };
}

const INTRADAY_POLL_RESOLUTIONS = new Set(["1", "5", "15", "60"]);

export function createBazaarDatafeed() {
    return {
        onReady(callback) {
            setTimeout(() => callback(configuration), 0);
        },

        searchSymbols(userInput, exchange, symbolType, onResult) {
            const queryUpper = (userInput || "").toUpperCase();
            const cryptoMatches = [
                { symbol: "BTC", full_name: "BINANCE:BTCUSDT", description: "Bitcoin / Tether USD", exchange: "BINANCE", ticker: "BTCUSDT", type: "crypto" },
                { symbol: "ETH", full_name: "BINANCE:ETHUSDT", description: "Ethereum / Tether USD", exchange: "BINANCE", ticker: "ETHUSDT", type: "crypto" },
                { symbol: "SOL", full_name: "BINANCE:SOLUSDT", description: "Solana / Tether USD", exchange: "BINANCE", ticker: "SOLUSDT", type: "crypto" },
            ].filter((c) => !userInput || c.symbol.includes(queryUpper) || c.ticker.includes(queryUpper));

            const params = new URLSearchParams({ query: userInput || "", type: symbolType || "", limit: "30" });
            getJson(`/search?${params}`)
                .then((rows) => {
                    const combined = [...cryptoMatches, ...(rows || [])];
                    onResult(combined);
                })
                .catch(() => onResult(cryptoMatches));
        },

        resolveSymbol(symbolName, onResolve, onError) {
            const strat = strategyOf(symbolName);
            if (strat) {
                const name = String(symbolName).toUpperCase().replace(/^BAZAAR:/, "");
                return setTimeout(
                    () =>
                        onResolve({
                            name,
                            ticker: name,
                            full_name: `BAZAAR:${name}`,
                            description: `${strat.symbol} Strategy P&L (₹) — ${strat.label}`,
                            "exchange-traded": "BAZAAR",
                            "exchange-listed": "BAZAAR",
                            exchange: "BAZAAR",
                            listed_exchange: "BAZAAR",
                            type: "index",
                            session: "0915-1530",
                            timezone: "Asia/Kolkata",
                            minmov: 1,
                            pricescale: 100,
                            has_intraday: true,
                            has_daily: false,
                            intraday_multipliers: ["1", "5", "15", "60"],
                            supported_resolutions: ["1", "5", "15", "60"],
                            volume_precision: 0,
                            has_no_volume: true,
                            data_status: "streaming",
                        }),
                    0
                );
            }
            const pair = getCryptoPair(symbolName);
            if (pair) {
                const base = pair.replace("USDT", "");
                const symbolInfo = {
                    name: base,
                    ticker: pair,
                    full_name: `BINANCE:${pair}`,
                    description: `${base} / Tether USD`,
                    "exchange-traded": "BINANCE",
                    "exchange-listed": "BINANCE",
                    exchange: "BINANCE",
                    listed_exchange: "BINANCE",
                    type: "crypto",
                    session: "24x7",
                    timezone: "Etc/UTC",
                    minmov: 1,
                    pricescale: base === "BTC" ? 100 : base === "ETH" ? 100 : 1000,
                    has_intraday: true,
                    has_daily: true,
                    has_weekly_and_monthly: true,
                    supported_resolutions: ["1", "5", "15", "60", "1D", "1W", "1M"],
                    volume_precision: 2,
                    data_status: "streaming",
                };
                return setTimeout(() => onResolve(symbolInfo), 0);
            }

            getJson(`/symbols?symbol=${encodeURIComponent(symbolName)}`)
                .then((info) => {
                    if (!info || info.s === "error") return onError("symbol not found");
                    onResolve(info);
                })
                .catch((err) => onError(err.message || "resolveSymbol failed"));
        },

        getBars(symbolInfo, resolution, periodParams, onResult, onError) {
            const { from, to, firstDataRequest } = periodParams;
            const strat = strategyOf(symbolInfo.ticker || symbolInfo.name);
            if (strat) {
                strategyBars(strat, resolution, from, to)
                    .then((r) => onResult(r.bars, r.bars.length ? { noData: false } : { noData: true, nextTime: r.nextTime }))
                    .catch((err) => onError(err.message || "strategy getBars failed"));
                return;
            }
            const pair = getCryptoPair(symbolInfo.ticker || symbolInfo.name);

            // Crypto via Binance public klines
            if (pair) {
                const bInterval = mapToBinanceInterval(resolution);
                const startTime = from * 1000;
                const endTime = to * 1000;
                const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${bInterval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;

                fetch(url)
                    .then((res) => {
                        if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
                        return res.json();
                    })
                    .then((data) => {
                        if (!Array.isArray(data) || data.length === 0) {
                            return onResult([], { noData: true });
                        }
                        const bars = data.map((r) => ({
                            time: Number(r[0]),
                            open: parseFloat(r[1]),
                            high: parseFloat(r[2]),
                            low: parseFloat(r[3]),
                            close: parseFloat(r[4]),
                            volume: parseFloat(r[5]),
                        }));
                        onResult(bars, { noData: bars.length === 0 && !firstDataRequest });
                    })
                    .catch((err) => {
                        console.error("[tvDatafeed/crypto]", err);
                        onError(err.message || "Binance getBars failed");
                    });
                return;
            }

            // Indian Market via Bazaar Sync stored UDF
            const params = new URLSearchParams({
                symbol: symbolInfo.ticker || symbolInfo.name,
                resolution,
                from: String(from),
                to: String(to),
            });
            getJson(`/history?${params}`)
                .then((data) => {
                    if (data.s === "no_data") {
                        // UDF sends seconds; the JS API expects milliseconds
                        onResult([], { noData: true, nextTime: data.nextTime != null ? data.nextTime * 1000 : undefined });
                        return;
                    }
                    if (data.s !== "ok") {
                        onError(data.errmsg || "getBars failed");
                        return;
                    }
                    const bars = data.t.map((time, i) => ({
                        time: time * 1000, // library expects ms
                        open: data.o[i],
                        high: data.h[i],
                        low: data.l[i],
                        close: data.c[i],
                        volume: data.v ? data.v[i] : undefined,
                    }));
                    onResult(bars, { noData: bars.length === 0 && !firstDataRequest });
                })
                .catch((err) => onError(err.message || "getBars failed"));
        },

        subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID) {
            const tickerName = symbolInfo.ticker || symbolInfo.name;
            const strat = strategyOf(tickerName);
            // Options, strategies and NSE/BSE indices/stocks: poll the stored
            // live ticks for the latest bar (intraday resolutions only — a
            // daily bar of stored data doesn't move).
            if (strat || isOptionTicker(tickerName) || (!getCryptoPair(tickerName) && INTRADAY_POLL_RESOLUTIONS.has(String(resolution)))) {
                const step = RESOLUTION_SECONDS[resolution] || 86400;
                let lastTime = 0;
                const poll = () => {
                    const now = Math.floor(Date.now() / 1000);
                    const from = now - Math.max(step * 3, 4 * 3600);
                    const load = strat ? strategyBars(strat, resolution, from, now + 60) : fetchHistoryBars(tickerName, resolution, from, now + 60);
                    load
                        .then(({ bars }) => {
                            const bar = bars[bars.length - 1];
                            if (!bar || bar.time < lastTime) return;
                            lastTime = bar.time;
                            onRealtimeCallback(bar);
                        })
                        .catch(() => {});
                };
                optionPollers.set(subscriberUID, setInterval(poll, OPTION_POLL_MS));
                return;
            }

            const pair = getCryptoPair(tickerName);
            if (!pair) return;

            const bInterval = mapToBinanceInterval(resolution);
            try {
                const ws = new WebSocket(
                    `wss://stream.binance.com:9443/ws/${pair.toLowerCase()}@kline_${bInterval}`
                );
                ws.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg && msg.k) {
                            const k = msg.k;
                            onRealtimeCallback({
                                time: Number(k.t),
                                open: parseFloat(k.o),
                                high: parseFloat(k.h),
                                low: parseFloat(k.l),
                                close: parseFloat(k.c),
                                volume: parseFloat(k.v),
                            });
                        }
                    } catch {
                        /* ignore parsing err */
                    }
                };
                cryptoSockets.set(subscriberUID, ws);
            } catch {
                /* safe ignore if ws unavailable */
            }
        },

        unsubscribeBars(subscriberUID) {
            const poller = optionPollers.get(subscriberUID);
            if (poller) {
                clearInterval(poller);
                optionPollers.delete(subscriberUID);
            }
            const ws = cryptoSockets.get(subscriberUID);
            if (ws) {
                try {
                    ws.close();
                } catch {
                    /* safe */
                }
                cryptoSockets.delete(subscriberUID);
            }
        },

        getServerTime(callback) {
            fetch(`${TV_BASE}/time`)
                .then((r) => r.text())
                .then((t) => callback(parseInt(t, 10)))
                .catch(() => callback(Math.floor(Date.now() / 1000)));
        },
    };
}
