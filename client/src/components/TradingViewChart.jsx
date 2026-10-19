import React, { useEffect, useRef, useState } from "react";
// components/TradingViewChart.jsx — Standalone TradingView Charting Library
// Powered by local charting_library/ (no external TV CDN, 100% unrestricted NSE datafeed)
// Complete with all native drawing tools, 100+ indicators, multi-timeframe resolution,
// and persistent drawing preservation across chart styles and symbol switches.
import { useTheme } from "../context/ThemeContext";
import { createBazaarDatafeed } from "../lib/tvDatafeed";

const LOCAL_TV_SCRIPT = "/charting_library/charting_library.standalone.js";
const FALLBACK_TV_SCRIPT = "https://s3.tradingview.com/tv.js";

let scriptState = "idle"; // "idle" | "loading" | "ready" | "fallback_ready" | "error"
let scriptWaiters = [];
let isLocalLibrary = false;

function loadTvScript() {
    return new Promise((resolve) => {
        if (typeof window !== "undefined" && window.TradingView && window.TradingView.widget) {
            scriptState = isLocalLibrary ? "ready" : "fallback_ready";
            return resolve({ ok: true, isLocal: isLocalLibrary });
        }
        if (scriptState === "ready" || scriptState === "fallback_ready") {
            return resolve({ ok: true, isLocal: scriptState === "ready" });
        }
        if (scriptState === "error") {
            return resolve({ ok: false, isLocal: false });
        }

        scriptWaiters.push(resolve);
        if (scriptState === "loading") return;

        scriptState = "loading";
        const settle = (ok, isLocal) => {
            scriptState = ok ? (isLocal ? "ready" : "fallback_ready") : "error";
            isLocalLibrary = isLocal;
            const waiters = scriptWaiters;
            scriptWaiters = [];
            waiters.forEach((r) => r({ ok, isLocal }));
        };

        // 1. First attempt to load local standalone library
        const localScript = document.createElement("script");
        localScript.src = LOCAL_TV_SCRIPT;
        localScript.async = true;

        localScript.onload = () => {
            if (window.TradingView && window.TradingView.widget) {
                settle(true, true);
            } else {
                tryFallback();
            }
        };

        localScript.onerror = () => {
            tryFallback();
        };

        function tryFallback() {
            console.warn("[TradingViewChart] Local library unavailable, falling back to CDN widget.");
            const cdnScript = document.createElement("script");
            cdnScript.src = FALLBACK_TV_SCRIPT;
            cdnScript.async = true;
            cdnScript.onload = () => settle(!!(window.TradingView && window.TradingView.widget), false);
            cdnScript.onerror = () => settle(false, false);
            document.head.appendChild(cdnScript);
        }

        document.head.appendChild(localScript);
    });
}

let containerSeq = 0;

export default function TradingViewChart({
    symbol = "NIFTY",
    interval = "D",
    chartStyle = "1",
    studies = ["Volume@tv-basicstudies", "MASimple@tv-basicstudies", "RSI@tv-basicstudies"],
    height = "100%",
    className = "",
    compareSymbol = null, // overlaid via the library's Overlay study on its own scale (e.g. NIFTY on a strategy P&L chart)
}) {
    const { isDark } = useTheme();
    const containerRef = useRef(null);
    const widgetRef = useRef(null);
    const chartReadyRef = useRef(false);
    const pendingChartStyleRef = useRef(chartStyle);
    const pendingSymbolRef = useRef(symbol);
    const pendingIntervalRef = useRef(interval);
    const compareSymbolRef = useRef(compareSymbol);
    const [containerId] = useState(() => `tv_chart_${++containerSeq}`);
    const [libStatus, setLibStatus] = useState(null); // null (loading) | { ok: boolean, isLocal: boolean }

    useEffect(() => {
        let cancelled = false;
        loadTvScript().then((res) => {
            if (!cancelled) setLibStatus(res);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // Clean symbol for datafeed
    const cleanSymbol = (symbol || "NIFTY").trim().toUpperCase();

    // Map timeframe interval string to TradingView standard resolution
    const normalizedInterval = (() => {
        const i = String(interval || "D").toUpperCase();
        if (i === "1D" || i === "D") return "1D";
        if (i === "1W" || i === "W") return "1W";
        if (i === "1M" || i === "M") return "1M";
        return interval;
    })();

    pendingChartStyleRef.current = chartStyle;
    pendingSymbolRef.current = cleanSymbol;
    pendingIntervalRef.current = normalizedInterval;
    compareSymbolRef.current = compareSymbol;

    // 1. IN-PLACE CHART STYLE SWITCHER (CANDLE, HEIKIN ASHI, LINE) WITHOUT CLEARING DRAWINGS
    useEffect(() => {
        if (!widgetRef.current || !chartReadyRef.current) return;
        try {
            const chart = typeof widgetRef.current.activeChart === "function"
                ? widgetRef.current.activeChart()
                : (typeof widgetRef.current.chart === "function" ? widgetRef.current.chart() : null);
            if (chart && typeof chart.setChartType === "function") {
                chart.setChartType(Number(chartStyle || 1));
            }
        } catch (e) {
            console.warn("[TradingViewChart] setChartType error:", e);
        }
    }, [chartStyle]);

    // 2. IN-PLACE SYMBOL SWITCHER WITHOUT DESTROYING WIDGET (PRESERVES ALL DRAWINGS)
    useEffect(() => {
        if (!widgetRef.current || !chartReadyRef.current) return;
        try {
            if (typeof widgetRef.current.setSymbol === "function") {
                widgetRef.current.setSymbol(cleanSymbol, normalizedInterval);
            } else {
                const chart = typeof widgetRef.current.activeChart === "function"
                    ? widgetRef.current.activeChart()
                    : null;
                if (chart && typeof chart.setSymbol === "function") {
                    chart.setSymbol(cleanSymbol);
                }
            }
        } catch (e) {
            console.warn("[TradingViewChart] setSymbol error:", e);
        }
    }, [cleanSymbol]);

    // 3. IN-PLACE RESOLUTION SWITCHER
    useEffect(() => {
        if (!widgetRef.current || !chartReadyRef.current) return;
        try {
            const chart = typeof widgetRef.current.activeChart === "function"
                ? widgetRef.current.activeChart()
                : (typeof widgetRef.current.chart === "function" ? widgetRef.current.chart() : null);
            if (chart && typeof chart.setResolution === "function") {
                chart.setResolution(normalizedInterval);
            }
        } catch (e) {
            console.warn("[TradingViewChart] setResolution error:", e);
        }
    }, [normalizedInterval]);

    // 4. IN-PLACE THEME SWITCHER
    useEffect(() => {
        if (!widgetRef.current || !chartReadyRef.current) return;
        try {
            if (typeof widgetRef.current.changeTheme === "function") {
                widgetRef.current.changeTheme(isDark ? "dark" : "light");
            }
        } catch (e) {
            console.warn("[TradingViewChart] changeTheme error:", e);
        }
    }, [isDark]);

    // 5. MOUNT WIDGET ONCE (AND ONLY ONCE PER CONTAINER LIFECYCLE)
    useEffect(() => {
        if (!libStatus?.ok || !containerRef.current || !window.TradingView) return;

        // If widget already exists, do not recreate
        if (widgetRef.current) return;

        chartReadyRef.current = false;
        if (containerRef.current) {
            containerRef.current.innerHTML = "";
            containerRef.current.id = containerId;
        }

        const isLocal = libStatus.isLocal;

        try {
            let widget;
            if (isLocal) {
                // STANDALONE LOCAL TRADINGVIEW CHARTING LIBRARY
                // Connected directly to Bazaar Sync UDF Datafeed (from MySQL ohlcv_data)
                // & Binance for crypto. Zero restrictions, zero notifications!
                const datafeed = createBazaarDatafeed();

                widget = new window.TradingView.widget({
                    autosize: true,
                    symbol: cleanSymbol,
                    interval: normalizedInterval,
                    container: containerId,
                    datafeed: datafeed,
                    library_path: "/charting_library/",
                    locale: "en",
                    timezone: "Asia/Kolkata",
                    theme: isDark ? "dark" : "light",
                    fullscreen: false,
                    client_id: "bazaar_sync",
                    user_id: "public_trader",
                    auto_save_delay: 1,
                    symbol_search_request_delay: 150,
                    disabled_features: [
                        "header_saveload",
                        "display_market_status",
                    ],
                    enabled_features: [
                        "study_dialog_search_control",
                        "use_localstorage_for_settings",
                        "save_chart_properties_to_local_storage",
                        "items_favoriting",
                        // keep the full toolset in the library's own fullscreen mode too
                        "header_in_fullscreen_mode",
                        "side_toolbar_in_fullscreen_mode",
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

                widget.onChartReady(() => {
                    chartReadyRef.current = true;
                    try {
                        const chart = widget.activeChart();
                        // Always apply — the library restores the last-used chart
                        // type from localStorage, so a line-style strategy chart
                        // would otherwise turn the next candle chart into a line.
                        if (chart && pendingChartStyleRef.current) {
                            chart.setChartType(Number(pendingChartStyleRef.current));
                        }
                        if (chart && compareSymbolRef.current) {
                            Promise.resolve(
                                // "Overlay" keeps the main series on its own scale (₹ P&L) and
                                // gives the overlaid symbol a separate one; "Compare" would
                                // turn the whole chart into % change.
                                chart.createStudy("Overlay", false, false, { symbol: compareSymbolRef.current })
                            ).catch((e) => console.warn("[TradingViewChart] compare overlay failed:", e));
                        }
                    } catch {
                        /* safe */
                    }
                });
            } else {
                // FALLBACK CDN WIDGET
                const tvSymbol = cleanSymbol.startsWith("NSE:") ? cleanSymbol : `NSE:${cleanSymbol}`;
                widget = new window.TradingView.widget({
                    autosize: true,
                    symbol: tvSymbol,
                    interval: normalizedInterval,
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
                });
            }

            widgetRef.current = widget;
        } catch (err) {
            console.error("[TradingViewChart] Widget init error:", err);
        }

        return () => {
            try {
                if (widgetRef.current && typeof widgetRef.current.remove === "function") {
                    widgetRef.current.remove();
                }
            } catch {
                /* safe */
            }
            widgetRef.current = null;
            chartReadyRef.current = false;
        };
    }, [libStatus]);

    if (libStatus && !libStatus.ok) {
        return (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50/50 p-6 text-center text-xs text-rose-700">
                <span className="font-bold text-sm">Unable to connect to Chart Server</span>
                <span className="text-gray-500">Please check your internet connection or local library files.</span>
            </div>
        );
    }

    if (!libStatus) {
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
            style={{ height: height || "100%", width: "100%" }}
        >
            <style>{`
                .tradingview-widget-copyright { display: none !important; }
                .tv-embed-widget-wrapper__header { display: none !important; }
                #${containerId}, #${containerId} > div, #${containerId} iframe {
                    height: 100% !important;
                    min-height: 100% !important;
                    width: 100% !important;
                }
            `}</style>
            <div
                id={containerId}
                ref={containerRef}
                style={{ height: "100%", width: "100%" }}
                className="h-full w-full"
            />
        </div>
    );
}
