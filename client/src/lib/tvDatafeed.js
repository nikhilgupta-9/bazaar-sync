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
    if (["BTC", "ETH", "SOL"].some((c) => clean.startsWith(c))) {
        return `${clean.replace(/USDT$/, "")}USDT`;
    }
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
                        onResult([], { noData: true, nextTime: data.nextTime });
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
            const pair = getCryptoPair(symbolInfo.ticker || symbolInfo.name);
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
