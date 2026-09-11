// components/TradingViewChart.jsx — mounts the TradingView Charting Library
// (all its native drawing tools + 100+ indicators) against our own stored
// data via lib/tvDatafeed.js -> /api/tv/*.
//
// The library files are NOT in this repo (licensed, obtained from
// TradingView — see client/public/charting_library/README.md). Until they're
// dropped into client/public/charting_library/, this component detects the
// missing script and falls back to the built-in HistoricalPriceChart, so the
// page keeps working either way.
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { createBazaarDatafeed } from "../lib/tvDatafeed";
import HistoricalPriceChart from "./HistoricalPriceChart";

const LIB_PATH = "/charting_library/";
const LIB_SCRIPT = `${LIB_PATH}charting_library.standalone.js`;

// Module-level so multiple mounts share one load attempt.
let scriptState = "idle"; // idle | loading | ready | missing
let scriptWaiters = [];

function loadLibraryScript() {
    return new Promise((resolve) => {
        if (scriptState === "ready") return resolve(true);
        if (scriptState === "missing") return resolve(false);
        scriptWaiters.push(resolve);
        if (scriptState === "loading") return;
        scriptState = "loading";
        const settle = (ok) => {
            scriptState = ok ? "ready" : "missing";
            scriptWaiters.forEach((r) => r(ok));
            scriptWaiters = [];
        };
        const s = document.createElement("script");
        s.src = LIB_SCRIPT;
        s.async = true;
        s.onload = () => settle(!!(window.TradingView && window.TradingView.widget));
        s.onerror = () => settle(false);
        document.head.appendChild(s);
    });
}

let containerSeq = 0;

export default function TradingViewChart({ symbol, points, rangeLabel }) {
    const { isDark } = useTheme();
    const containerRef = useRef(null);
    const widgetRef = useRef(null);
    const [containerId] = useState(() => `tv_chart_${++containerSeq}`);
    const [libOk, setLibOk] = useState(
        scriptState === "ready" ? true : scriptState === "missing" ? false : null
    );

    useEffect(() => {
        let cancelled = false;
        loadLibraryScript().then((ok) => !cancelled && setLibOk(ok));
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!libOk || !containerRef.current || !window.TradingView) return;

        const widget = new window.TradingView.widget({
            symbol: `NSE:${symbol}`,
            interval: "1D",
            container: containerRef.current,
            container_id: containerId,
            datafeed: createBazaarDatafeed(),
            library_path: LIB_PATH,
            locale: "en",
            timezone: "Asia/Kolkata",
            theme: isDark ? "dark" : "light",
            autosize: true,
            fullscreen: false,
            debug: false,
            // "All tools": don't strip anything; turn a few extras on.
            disabled_features: ["use_localstorage_for_settings"],
            enabled_features: [
                "study_templates",
                "side_toolbar_in_fullscreen_mode",
                "header_in_fullscreen_mode",
                "chart_property_page_trading",
                "show_symbol_logos",
            ],
            custom_css_url: undefined,
            loading_screen: { backgroundColor: isDark ? "#0b1420" : "#ffffff" },
        });
        widgetRef.current = widget;

        return () => {
            try {
                widget.remove();
            } catch {
                /* widget may already be torn down */
            }
            widgetRef.current = null;
        };
    }, [libOk, symbol, isDark, containerId]);

    if (libOk === false) {
        return (
            <div>
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
                    <b>TradingView Charting Library not installed</b> — showing Bazaar Sync's built-in chart below.
                    Drop the library folder into <code className="rounded bg-amber-100 px-1">client/public/charting_library/</code>{" "}
                    to unlock the full TradingView drawing-tool + indicator set. See that folder's{" "}
                    <code className="rounded bg-amber-100 px-1">README.md</code> for the exact steps.
                </div>
                <HistoricalPriceChart points={points} symbol={symbol} rangeLabel={rangeLabel} />
            </div>
        );
    }

    if (libOk === null) {
        return (
            <div className="flex h-[62vh] min-h-[420px] items-center justify-center text-xs text-gray-400">
                Loading TradingView Charting Library…
            </div>
        );
    }

    return <div id={containerId} ref={containerRef} className="h-[74vh] min-h-[480px] w-full" />;
}
