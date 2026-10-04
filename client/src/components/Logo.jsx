import React from "react";
// components/Logo.jsx — shared brand mark, used by both TopNav.jsx (header)
// and Footer.jsx so the two never drift out of sync with each other. Colors
// are plain Tailwind utility classes (bg-blue-600, text-gray-900, ...) —
// under this app's CSS-variable-driven dark theme (see index.css's `.dark`
// block) those automatically re-theme site-wide with no per-component dark:
// classes needed, so the badge/wordmark stay correct in both themes for
// free. The glyph itself uses fill="currentColor" so it always matches the
// badge's own text color rather than a hardcoded hex.
export default function Logo({ size = "md", showTagline = false }) {
    const isSm = size === "sm";
    return (
        <div className="flex items-center gap-2.5 select-none">
            <span
                className={`flex items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 text-white shadow-md shadow-emerald-500/20 ring-1 ring-emerald-400/30 shrink-0 ${isSm ? "h-7 w-7" : "h-9 w-9"}`}
            >
                <svg viewBox="0 0 24 24" className={isSm ? "h-4 w-4" : "h-5 w-5"} fill="none">
                    <rect x="4" y="13" width="3.4" height="7" rx="0.8" fill="currentColor" opacity="0.75" />
                    <rect x="10.3" y="8" width="3.4" height="12" rx="0.8" fill="currentColor" opacity="0.9" />
                    <rect x="16.6" y="4" width="3.4" height="16" rx="0.8" fill="currentColor" />
                </svg>
            </span>
            <div className="leading-tight">
                <div className={`flex items-center gap-1 font-black tracking-tight ${isSm ? "text-base" : "text-xl"}`}>
                    <span className="text-emerald-600 dark:text-emerald-400">Bazaar</span>
                    <span className="text-gray-900 dark:text-white">Sync</span>
                </div>
                {showTagline && (
                    <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">NSE Options Analytics &amp; Backtesting</div>
                )}
            </div>
        </div>
    );
}
