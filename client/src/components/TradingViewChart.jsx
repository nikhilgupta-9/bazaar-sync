import React from "react";
// components/TradingViewChart.jsx — Mounts the official TradingView Advanced Real-Time Chart
// with 100% of native drawing tools, 100+ technical indicators, multi-timeframe resolution,
// and Dhan-style instant trading tools for Indian market indices and F&O equities.
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";

const TV_SCRIPT_URL = "https://s3.tradingview.com/tv.js";

let scriptState = "idle"; // "idle" | "loading" | "ready" | "error"
let scriptWaiters = [];

function loadTvScript() {
    return new Promise((resolve) => {
        if (typeof window !== "undefined" && window.TradingView && window.TradingView.widget) {
            scriptState = "ready";
            return resolve(true);
        }
        if (scriptState === "ready") return resolve(true);
        if (scriptState === "error") return resolve(false);

        scriptWaiters.push(resolve);
        if (scriptState === "loading") return;

        scriptState = "loading";
        const settle = (ok) => {
            scriptState = ok ? "ready" : "error";
            const waiters = scriptWaiters;
            scriptWaiters = [];
            waiters.forEach((r) => r(ok));
        };

        const existing = document.querySelector(`script[src="${TV_SCRIPT_URL}"]`);
        if (existing) {
            if (window.TradingView && window.TradingView.widget) {
                return settle(true);
            }
            // If already loaded or errored
            existing.addEventListener("load", () => settle(!!(window.TradingView && window.TradingView.widget)));
            existing.addEventListener("error", () => settle(false));
            // In case load already fired before listener was attached:
            setTimeout(() => {
                if (window.TradingView && window.TradingView.widget) {
                    settle(true);
                }
            }, 300);
            return;
        }

        const script = document.createElement("script");
        script.src = TV_SCRIPT_URL;
        script.async = true;
        script.onload = () => settle(!!(window.TradingView && window.TradingView.widget));
        script.onerror = () => settle(false);
        document.head.appendChild(script);
    });
}

const TV_SYMBOL_MAP = {
    // Core Indian Indices
    NIFTY: "NSE:NIFTY",
    NIFTY50: "NSE:NIFTY",
    "NIFTY 50": "NSE:NIFTY",
    BANKNIFTY: "NSE:BANKNIFTY",
    "NIFTY BANK": "NSE:BANKNIFTY",
    FINNIFTY: "NSE:CNXFINANCE",
    "NIFTY FIN SERVICE": "NSE:CNXFINANCE",
    "FIN FINANCIAL SERVICES": "NSE:CNXFINANCE",
    MIDCPNIFTY: "NSE:NIFTY_MID_SELECT",
    "NIFTY MID SELECT": "NSE:NIFTY_MID_SELECT",
    "NIFTY MIDCAP SELECT": "NSE:NIFTY_MID_SELECT",
    SENSEX: "BSE:SENSEX",
    "BSE SENSEX": "BSE:SENSEX",
    BANKEX: "BSE:BANKEX",
    "BSE BANKEX": "BSE:BANKEX",
    INDIAVIX: "NSE:INDIAVIX",
    "INDIA VIX": "NSE:INDIAVIX",

    // Sectoral & Thematic Indices
    CNXIT: "NSE:CNXIT",
    NIFTYIT: "NSE:CNXIT",
    "NIFTY IT": "NSE:CNXIT",
    CNXAUTO: "NSE:CNXAUTO",
    NIFTYAUTO: "NSE:CNXAUTO",
    "NIFTY AUTO": "NSE:CNXAUTO",
    CNXPHARMA: "NSE:CNXPHARMA",
    NIFTYPHARMA: "NSE:CNXPHARMA",
    "NIFTY PHARMA": "NSE:CNXPHARMA",
    CNXFMCG: "NSE:CNXFMCG",
    NIFTYFMCG: "NSE:CNXFMCG",
    "NIFTY FMCG": "NSE:CNXFMCG",
    CNXMETAL: "NSE:CNXMETAL",
    NIFTYMETAL: "NSE:CNXMETAL",
    "NIFTY METAL": "NSE:CNXMETAL",
    CNXREALTY: "NSE:CNXREALTY",
    NIFTYREALTY: "NSE:CNXREALTY",
    "NIFTY REALTY": "NSE:CNXREALTY",
    CNXENERGY: "NSE:CNXENERGY",
    NIFTYENERGY: "NSE:CNXENERGY",
    "NIFTY ENERGY": "NSE:CNXENERGY",
    CNXPSE: "NSE:CNXPSE",
    NIFTYPSE: "NSE:CNXPSE",
    CNXINFRA: "NSE:CNXINFRA",
    NIFTYINFRA: "NSE:CNXINFRA",

    // Stock Name Normalizations
    "M&M": "NSE:M_M",
    "M&MFIN": "NSE:M_MFIN",
    "BAJAJ-AUTO": "NSE:BAJAJ_AUTO",
    "L&TFH": "NSE:L_TFH",
    "MCDOWELL-N": "NSE:UNITDSPR",

    // Crypto Pairs (Binance / Delta Real-Time Feeds)
    BTC: "BINANCE:BTCUSDT",
    "BTC/USDT": "BINANCE:BTCUSDT",
    BTCUSDT: "BINANCE:BTCUSDT",
    BTCUSD: "BINANCE:BTCUSD",
    BITCOIN: "BINANCE:BTCUSDT",
    ETH: "BINANCE:ETHUSDT",
    "ETH/USDT": "BINANCE:ETHUSDT",
    ETHUSDT: "BINANCE:ETHUSDT",
    ETHUSD: "BINANCE:ETHUSD",
    ETHEREUM: "BINANCE:ETHUSDT",
    SOL: "BINANCE:SOLUSDT",
    "SOL/USDT": "BINANCE:SOLUSDT",
    SOLUSDT: "BINANCE:SOLUSDT",
    SOLUSD: "BINANCE:SOLUSD",
    SOLANA: "BINANCE:SOLUSDT",
    XAUT: "BINANCE:PAXGUSDT",
    "XAUT/USDT": "BINANCE:PAXGUSDT",
    XAUTUSDT: "BINANCE:PAXGUSDT",
    PAXG: "BINANCE:PAXGUSDT",
    PAXGUSDT: "BINANCE:PAXGUSDT",
    DOGE: "BINANCE:DOGEUSDT",
    DOGEUSDT: "BINANCE:DOGEUSDT",
    XRP: "BINANCE:XRPUSDT",
    XRPUSDT: "BINANCE:XRPUSDT",
    BNB: "BINANCE:BNBUSDT",
    BNBUSDT: "BINANCE:BNBUSDT",
};

function formatTvSymbol(rawSymbol) {
    if (!rawSymbol) return "NSE:NIFTY";
    const clean = String(rawSymbol).trim().toUpperCase();
    if (TV_SYMBOL_MAP[clean]) {
        return TV_SYMBOL_MAP[clean];
    }
    if (
        clean.startsWith("NSE:") ||
        clean.startsWith("BSE:") ||
        clean.startsWith("INDEX:") ||
        clean.startsWith("BINANCE:") ||
        clean.startsWith("COINBASE:") ||
        clean.startsWith("BYBIT:") ||
        clean.startsWith("CRYPTO:") ||
        clean.startsWith("BITSTAMP:") ||
        clean.startsWith("FX:") ||
        clean.startsWith("OANDA:")
    ) {
        return clean;
    }
    const sanitized = clean.replace(/&/g, "_").replace(/-/g, "_");
    return `NSE:${sanitized}`;
}

let containerSeq = 0;

const TV_STUDY_MAP = {
    "STD;EMA": "MASimple@tv-basicstudies",
    "STD;RSI": "RSI@tv-basicstudies",
    "STD;MACD": "MACD@tv-basicstudies",
    "STD;Bollinger_Bands": "BollingerBands@tv-basicstudies",
    "STD;Volume": "Volume@tv-basicstudies",
    "STD;Supertrend": "MASimple@tv-basicstudies",
    EMA: "MASimple@tv-basicstudies",
    RSI: "RSI@tv-basicstudies",
    MACD: "MACD@tv-basicstudies",
    "Bollinger Bands": "BollingerBands@tv-basicstudies",
    Volume: "Volume@tv-basicstudies",
};

export default function TradingViewChart({
    symbol = "NIFTY",
    interval = "D",
    chartStyle = "1",
    studies = ["Volume@tv-basicstudies", "MASimple@tv-basicstudies", "RSI@tv-basicstudies"],
    height = "680px",
    className = "",
}) {
    const { isDark } = useTheme();
    const containerRef = useRef(null);
    const widgetRef = useRef(null);
    const [containerId] = useState(() => `tv_chart_${++containerSeq}`);
    const [loaded, setLoaded] = useState(
        typeof window !== "undefined" && window.TradingView && window.TradingView.widget ? true : null
    );

    useEffect(() => {
        let cancelled = false;
        loadTvScript().then((ok) => {
            if (!cancelled) setLoaded(ok);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const studiesKey = Array.isArray(studies) ? studies.join(",") : String(studies || "");

    // Dynamic in-place Chart Style Switcher (Candles, Heikin Ashi, Line) without destroying widget
    useEffect(() => {
        if (!widgetRef.current) return;
        try {
            const chart = typeof widgetRef.current.chart === "function"
                ? widgetRef.current.chart()
                : (typeof widgetRef.current.activeChart === "function" ? widgetRef.current.activeChart() : null);
            if (chart && typeof chart.setChartType === "function") {
                chart.setChartType(Number(chartStyle));
            }
        } catch {
            /* ignore */
        }
    }, [chartStyle]);

    // Dynamic in-place Resolution Switcher
    useEffect(() => {
        if (!widgetRef.current) return;
        try {
            const chart = typeof widgetRef.current.chart === "function"
                ? widgetRef.current.chart()
                : (typeof widgetRef.current.activeChart === "function" ? widgetRef.current.activeChart() : null);
            if (chart && typeof chart.setResolution === "function") {
                chart.setResolution(interval);
            }
        } catch {
            /* ignore */
        }
    }, [interval]);

    useEffect(() => {
        if (!loaded || !containerRef.current || !window.TradingView) return;

        if (containerRef.current) {
            containerRef.current.innerHTML = "";
            containerRef.current.id = containerId;
        }

        const formattedSymbol = formatTvSymbol(symbol);

        // Map studies to valid TradingView technical basic studies
        const cleanStudies = (Array.isArray(studies) ? studies : [])
            .map((s) => TV_STUDY_MAP[s] || s)
            .filter(Boolean);

        try {
            const widget = new window.TradingView.widget({
                autosize: true,
                symbol: formattedSymbol,
                interval: interval,
                timezone: "Asia/Kolkata",
                theme: isDark ? "dark" : "light",
                style: String(chartStyle || "1"),
                locale: "in",
                toolbar_bg: isDark ? "#0b1420" : "#ffffff",
                enable_publishing: false,
                allow_symbol_change: true,
                container_id: containerId,
                hide_side_toolbar: false,
                hide_legend: false,
                save_image: true,
                withdateranges: false,
                details: false,
                hotlist: false,
                calendar: false,
                show_popup_button: false,
                popup_width: "1000",
                popup_height: "650",
                studies: cleanStudies,
                disabled_features: [
                    "header_saveload",
                    "display_market_status",
                    "popup_hints",
                    "caption_delayed_quotes",
                    "show_interval_dialog_on_key_press",
                    "timeframes_toolbar",
                    "go_to_date",
                ],
                overrides: {
                    "paneProperties.background": isDark ? "#0b1420" : "#ffffff",
                    "paneProperties.backgroundType": "solid",
                    "paneProperties.vertGridProperties.color": isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)",
                    "paneProperties.horzGridProperties.color": isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.04)",
                    "mainSeriesProperties.candleStyle.upColor": "#059669",
                    "mainSeriesProperties.candleStyle.downColor": "#e11d48",
                    "mainSeriesProperties.candleStyle.borderUpColor": "#059669",
                    "mainSeriesProperties.candleStyle.borderDownColor": "#e11d48",
                    "mainSeriesProperties.candleStyle.wickUpColor": "#059669",
                    "mainSeriesProperties.candleStyle.wickDownColor": "#e11d48",
                    "mainSeriesProperties.hollowCandleStyle.upColor": "#059669",
                    "mainSeriesProperties.hollowCandleStyle.downColor": "#e11d48",
                    "mainSeriesProperties.haStyle.upColor": "#059669",
                    "mainSeriesProperties.haStyle.downColor": "#e11d48",
                    "mainSeriesProperties.barStyle.upColor": "#059669",
                    "mainSeriesProperties.barStyle.downColor": "#e11d48",
                },
            });

            widgetRef.current = widget;
        } catch (err) {
            console.error("TradingView widget init error:", err);
        }

        return () => {
            try {
                if (widgetRef.current && typeof widgetRef.current.remove === "function") {
                    widgetRef.current.remove();
                }
            } catch {
                /* safe ignore */
            }
            widgetRef.current = null;
        };
    }, [loaded, symbol, interval, chartStyle, isDark, studiesKey]);

    if (loaded === false) {
        return (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-6 text-center text-xs text-rose-700">
                <span className="font-bold text-sm">Unable to connect to Chart Server</span>
                <span className="text-gray-500">Please check your internet connection.</span>
            </div>
        );
    }

    if (loaded === null) {
        return (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 bg-gray-50/60 dark:bg-[#0b1420] text-xs text-gray-500">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                <span className="font-semibold text-emerald-800 dark:text-emerald-400">Loading TradingView Terminal…</span>
            </div>
        );
    }

    return (
        <div
            className={`relative h-full w-full overflow-hidden bg-white dark:bg-[#0b1420] ${className}`}
            style={{ height: height || "100%", minHeight: "560px", width: "100%" }}
        >
            <style>{`
                .tradingview-widget-copyright { display: none !important; }
                .tv-embed-widget-wrapper__header { display: none !important; }
                #${containerId}, #${containerId} > div, #${containerId} iframe {
                    height: 100% !important;
                    min-height: 560px !important;
                    width: 100% !important;
                }
            `}</style>
            <div
                id={containerId}
                ref={containerRef}
                style={{ height: "100%", minHeight: "560px", width: "100%" }}
                className="h-full w-full"
            />
        </div>
    );
}
