import React from "react";
// utils/symbolIcons.jsx — Stock & Index Logos / Color Badges for StockMojo-standard UI

// Brand colors and initials for major Indian Indices & F&O stocks
const SYMBOL_CONFIG = {
    // Indices
    NIFTY: { label: "N50", name: "NIFTY 50", bg: "bg-blue-600 text-white", border: "border-blue-500", glow: "shadow-blue-500/20", icon: "📈", type: "Index" },
    BANKNIFTY: { label: "BN", name: "BANK NIFTY", bg: "bg-indigo-600 text-white", border: "border-indigo-500", glow: "shadow-indigo-500/20", icon: "🏦", type: "Index" },
    FINNIFTY: { label: "FN", name: "FIN NIFTY", bg: "bg-violet-600 text-white", border: "border-violet-500", glow: "shadow-violet-500/20", icon: "💳", type: "Index" },
    MIDCPNIFTY: { label: "MC", name: "MIDCAP NIFTY", bg: "bg-teal-600 text-white", border: "border-teal-500", glow: "shadow-teal-500/20", icon: "📊", type: "Index" },
    SENSEX: { label: "SX", name: "BSE SENSEX", bg: "bg-sky-600 text-white", border: "border-sky-500", glow: "shadow-sky-500/20", icon: "🏛️", type: "Index" },
    INDIAVIX: { label: "VIX", name: "INDIA VIX", bg: "bg-amber-600 text-white", border: "border-amber-500", glow: "shadow-amber-500/20", icon: "⚡", type: "Volatility" },

    // Bluechip F&O Stocks
    RELIANCE: { label: "R", name: "Reliance Industries", bg: "bg-blue-800 text-white", border: "border-blue-700", icon: "⛽" },
    HDFCBANK: { label: "H", name: "HDFC Bank Ltd", bg: "bg-blue-700 text-white", border: "border-blue-600", icon: "🏦" },
    ICICIBANK: { label: "IC", name: "ICICI Bank Ltd", bg: "bg-orange-600 text-white", border: "border-orange-500", icon: "🏦" },
    TCS: { label: "TCS", name: "Tata Consultancy Services", bg: "bg-blue-900 text-white", border: "border-blue-800", icon: "💻" },
    INFY: { label: "INF", name: "Infosys Ltd", bg: "bg-blue-500 text-white", border: "border-blue-400", icon: "💻" },
    SBIN: { label: "SBI", name: "State Bank of India", bg: "bg-sky-700 text-white", border: "border-sky-600", icon: "🏦" },
    BHARTIARTL: { label: "AIR", name: "Bharti Airtel Ltd", bg: "bg-red-600 text-white", border: "border-red-500", icon: "📡" },
    ITC: { label: "ITC", name: "ITC Ltd", bg: "bg-amber-700 text-white", border: "border-amber-600", icon: "🌿" },
    KOTAKBANK: { label: "K", name: "Kotak Mahindra Bank", bg: "bg-red-700 text-white", border: "border-red-600", icon: "🏦" },
    LT: { label: "L&T", name: "Larsen & Toubro", bg: "bg-yellow-700 text-white", border: "border-yellow-600", icon: "🏗️" },
    AXISBANK: { label: "AX", name: "Axis Bank Ltd", bg: "bg-rose-700 text-white", border: "border-rose-600", icon: "🏦" },
    HINDUNILVR: { label: "HUL", name: "Hindustan Unilever", bg: "bg-blue-600 text-white", border: "border-blue-500", icon: "🧼" },
    BAJFINANCE: { label: "BF", name: "Bajaj Finance Ltd", bg: "bg-sky-800 text-white", border: "border-sky-700", icon: "💳" },
    MARUTI: { label: "MS", name: "Maruti Suzuki India", bg: "bg-indigo-700 text-white", border: "border-indigo-600", icon: "🚗" },
    TATAMOTORS: { label: "TM", name: "Tata Motors Ltd", bg: "bg-blue-700 text-white", border: "border-blue-600", icon: "🚙" },
    TATASTEEL: { label: "TS", name: "Tata Steel Ltd", bg: "bg-blue-800 text-white", border: "border-blue-700", icon: "🔩" },
    SUNPHARMA: { label: "SUN", name: "Sun Pharma Ind", bg: "bg-orange-700 text-white", border: "border-orange-600", icon: "💊" },
    NTPC: { label: "NTPC", name: "NTPC Limited", bg: "bg-emerald-700 text-white", border: "border-emerald-600", icon: "⚡" },
    POWERGRID: { label: "PG", name: "Power Grid Corp", bg: "bg-emerald-800 text-white", border: "border-emerald-700", icon: "🔌" },
    ONGC: { label: "ONGC", name: "ONGC Ltd", bg: "bg-red-800 text-white", border: "border-red-700", icon: "🛢️" },
    TITAN: { label: "TTN", name: "Titan Company Ltd", bg: "bg-amber-600 text-white", border: "border-amber-500", icon: "⌚" },
    WIPRO: { label: "WIP", name: "Wipro Ltd", bg: "bg-purple-700 text-white", border: "border-purple-600", icon: "💻" },
    HCLTECH: { label: "HCL", name: "HCL Technologies", bg: "bg-indigo-800 text-white", border: "border-indigo-700", icon: "💻" },
    COALINDIA: { label: "CIL", name: "Coal India Ltd", bg: "bg-zinc-700 text-white", border: "border-zinc-600", icon: "⛏️" },
    JSWSTEEL: { label: "JSW", name: "JSW Steel Ltd", bg: "bg-cyan-800 text-white", border: "border-cyan-700", icon: "🏗️" },
    ADANIENT: { label: "ADE", name: "Adani Enterprises", bg: "bg-teal-700 text-white", border: "border-teal-600", icon: "🌐" },
    ADANIPORTS: { label: "ADP", name: "Adani Ports & SEZ", bg: "bg-teal-800 text-white", border: "border-teal-700", icon: "⚓" },
};

// Generates fallback initials and consistent dynamic colors for any symbol
function getDynamicBadge(sym) {
    const s = (sym || "").toUpperCase();
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
        "bg-blue-600 text-white",
        "bg-indigo-600 text-white",
        "bg-emerald-600 text-white",
        "bg-violet-600 text-white",
        "bg-rose-600 text-white",
        "bg-amber-600 text-white",
        "bg-teal-600 text-white",
        "bg-cyan-700 text-white",
        "bg-fuchsia-700 text-white",
    ];
    const bg = colors[Math.abs(hash) % colors.length];
    const label = s.length <= 4 ? s : s.slice(0, 3);
    return { label, name: s, bg, icon: "📈" };
}

/**
 * Symbol Logo Badge Component
 */
export function SymbolLogo({ symbol, size = "md", className = "" }) {
    const sym = (symbol || "").toUpperCase();
    const config = SYMBOL_CONFIG[sym] || getDynamicBadge(sym);

    const sizeClasses = {
        xs: "h-5 w-5 text-[9px] rounded-sm",
        sm: "h-6 w-6 text-[10px] rounded-md font-bold",
        md: "h-7 w-7 text-xs rounded-lg font-black shadow-xs",
        lg: "h-9 w-9 text-sm rounded-xl font-black shadow-sm",
    };

    return (
        <span
            className={`inline-flex shrink-0 items-center justify-center font-mono select-none tracking-tighter ${sizeClasses[size] || sizeClasses.md} ${config.bg} ${className}`}
            title={config.name || sym}
        >
            {config.label}
        </span>
    );
}

export function getSymbolMeta(sym) {
    return SYMBOL_CONFIG[sym?.toUpperCase()] || getDynamicBadge(sym);
}
