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
        <div className="flex items-center gap-2">
            <span
                className={`flex items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm ${isSm ? "h-7 w-7" : "h-9 w-9"}`}
            >
                <svg viewBox="0 0 24 24" className={isSm ? "h-4 w-4" : "h-5 w-5"} fill="none">
                    <rect x="4" y="13" width="3.4" height="7" rx="0.8" fill="currentColor" opacity="0.65" />
                    <rect x="10.3" y="8" width="3.4" height="12" rx="0.8" fill="currentColor" opacity="0.85" />
                    <rect x="16.6" y="4" width="3.4" height="16" rx="0.8" fill="currentColor" />
                </svg>
            </span>
            <div className="leading-tight">
                <div className={`flex items-center gap-1 font-bold ${isSm ? "text-sm" : "text-lg"}`}>
                    <span className="text-blue-600">Bazaar</span>
                    <span className="text-gray-900">Sync</span>
                </div>
                {showTagline && (
                    <div className="text-xs font-medium text-gray-400">NSE Options Analytics &amp; Backtesting</div>
                )}
            </div>
        </div>
    );
}
