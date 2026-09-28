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
            scriptWaiters.forEach((r) => r(ok));
            scriptWaiters = [];
        };

        const existing = document.querySelector(`script[src="${TV_SCRIPT_URL}"]`);
        if (existing) {
            existing.addEventListener("load", () => settle(!!(window.TradingView && window.TradingView.widget)));
            existing.addEventListener("error", () => settle(false));
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
};

function formatTvSymbol(rawSymbol) {
    if (!rawSymbol) return "NSE:NIFTY";
    const clean = String(rawSymbol).trim().toUpperCase();
    if (TV_SYMBOL_MAP[clean]) {
        return TV_SYMBOL_MAP[clean];
    }
    if (clean.startsWith("NSE:") || clean.startsWith("BSE:") || clean.startsWith("INDEX:")) {
        return clean;
    }
    const sanitized = clean.replace(/&/g, "_").replace(/-/g, "_");
    return `NSE:${sanitized}`;
}

let containerSeq = 0;

export default function TradingViewChart({
    symbol = "NIFTY",
    interval = "D",
    chartStyle = "1",
    studies = ["STD;EMA", "STD;RSI", "STD;MACD", "STD;Bollinger_Bands"],
    height = "100%",
    className = "",
}) {
    const { isDark } = useTheme();
    const containerRef = useRef(null);
    const widgetRef = useRef(null);
    const [containerId] = useState(() => `tradingview_dhan_${++containerSeq}`);
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

    useEffect(() => {
        if (!loaded || !containerRef.current || !window.TradingView) return;

        // Clear container content before mounting new instance
        if (containerRef.current) {
            containerRef.current.innerHTML = "";
        }

        const formattedSymbol = formatTvSymbol(symbol);

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
                withdateranges: true,
                details: true,
                hotlist: true,
                calendar: true,
                show_popup_button: true,
                popup_width: "1000",
                popup_height: "650",
                studies: Array.isArray(studies) ? studies : [],
                drawings_access: {
                    type: "black",
                    tools: [],
                },
                disabled_features: [
                    "use_localstorage_for_settings",
                    "header_saveload",
                ],
                enabled_features: [
                    "study_templates",
                    "side_toolbar_in_fullscreen_mode",
                    "header_in_fullscreen_mode",
                    "show_symbol_logos",
                    "show_symbol_logo_in_legend",
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
    }, [loaded, symbol, interval, chartStyle, isDark, containerId, studies]);

    if (loaded === false) {
        return (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-6 text-center text-xs text-rose-700">
                <span className="font-bold text-sm">Unable to connect to TradingView Cloud Feed</span>
                <span className="text-gray-500">Please check your internet connection or switch to "Bazaar Sync Stored Data Engine".</span>
            </div>
        );
    }

    if (loaded === null) {
        return (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 text-xs text-gray-500">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                <span className="font-semibold text-emerald-800">Initializing Dhan-Style TradingView Pro Terminal…</span>
            </div>
        );
    }

    return (
        <div className={`relative h-full w-full overflow-hidden rounded-xl bg-white shadow-inner dark:bg-[#0b1420] ${className}`}>
            <div
                id={containerId}
                ref={containerRef}
                style={{ height: height || "100%", width: "100%" }}
                className="h-full w-full min-h-[450px]"
            />
        </div>
    );
}
