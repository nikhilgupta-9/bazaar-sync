// lib/tvDatafeed.js — datafeed adapter for the TradingView Charting Library,
// backed by our UDF endpoints in server/routes/tvDatafeed.js (/api/tv/*).
//
// This is a hand-written thin datafeed rather than TradingView's bundled
// `Datafeeds.UDFCompatibleDatafeed` so the app doesn't depend on their
// datafeeds/ bundle being copied in too — only the charting_library/ folder
// itself is required (see client/public/charting_library/README.md).
//
// Historical-only: subscribeBars/unsubscribeBars are no-ops (ohlcv_data is a
// stored backfill, not a live tick feed — the live path is Angel One and is
// deliberately separate). All drawing tools + indicators are inside the
// library; this only supplies bars.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";
const TV_BASE = `${API_URL}/api/tv`;

async function getJson(path) {
    const res = await fetch(`${TV_BASE}${path}`);
    if (!res.ok) throw new Error(`tv datafeed ${path} → HTTP ${res.status}`);
    return res.json();
}

const configuration = {
    supported_resolutions: ["1", "5", "15", "60", "1D", "1W", "1M"],
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [{ value: "NSE", name: "NSE", desc: "Bazaar Sync stored data" }],
    symbols_types: [
        { name: "All", value: "" },
        { name: "Index", value: "index" },
        { name: "Stock", value: "stock" },
    ],
};

export function createBazaarDatafeed() {
    return {
        onReady(callback) {
            setTimeout(() => callback(configuration), 0);
        },

        searchSymbols(userInput, exchange, symbolType, onResult) {
            const params = new URLSearchParams({ query: userInput || "", type: symbolType || "", limit: "30" });
            getJson(`/search?${params}`)
                .then((rows) => onResult(rows || []))
                .catch(() => onResult([]));
        },

        resolveSymbol(symbolName, onResolve, onError) {
            getJson(`/symbols?symbol=${encodeURIComponent(symbolName)}`)
                .then((info) => {
                    if (!info || info.s === "error") return onError("symbol not found");
                    onResolve(info);
                })
                .catch((err) => onError(err.message || "resolveSymbol failed"));
        },

        getBars(symbolInfo, resolution, periodParams, onResult, onError) {
            const { from, to, firstDataRequest } = periodParams;
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
                        time: time * 1000, // library wants ms
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

        // Stored backfill — no realtime stream. Keep the handles so the
        // library's bookkeeping stays happy, but never push updates.
        subscribeBars() {},
        unsubscribeBars() {},

        getServerTime(callback) {
            fetch(`${TV_BASE}/time`)
                .then((r) => r.text())
                .then((t) => callback(parseInt(t, 10)))
                .catch(() => {});
        },
    };
}
