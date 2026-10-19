import React from "react";
// components/OptionChainSettingsDrawer.jsx
//
// Right-side slide-in drawer for the Option Chain page's gear icon. The
// settings differ per market: NSE/BSE chains have futures, VIX and
// previous-day change data; Delta Exchange (crypto) chains have none of those
// but do carry bid/ask, so each market only offers options that actually do
// something for it.
const STRIKE_RANGE_OPTIONS = [
    { label: "5", value: 5 },
    { label: "10", value: 10 },
    { label: "20", value: 20 },
    { label: "30", value: 30 },
    { label: "40", value: 40 },
    { label: "All", value: null },
];

const MARKET_CONFIG = {
    indian: {
        title: "NSE F&O Settings",
        badge: "🇮🇳 NSE F&O",
        source: "Angel One live feed · NSE/BSE",
        badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800/60",
        activeCls: "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
        accent: "accent-emerald-600",
        atmBasis: [
            ["spot", "Spot"],
            ["future", "Future"],
            ["synth", "Synth Future"],
        ],
        columnGroups: [
            { title: "Price", items: [["ltpChangePercent", "LTP Change %"]] },
            { title: "Open Interest", items: [["oi", "OI"], ["oiChangePercent", "OI Change %"], ["oiChange", "OI Change"], ["pcr", "PCR"]] },
            { title: "Volume", items: [["volume", "Volume"], ["volOi", "Vol/OI"], ["pcrVol", "PCR (Vol)"]] },
            { title: "Greeks", items: [["iv", "IV"], ["delta", "Delta"], ["gamma", "Gamma"], ["theta", "Theta"], ["vega", "Vega"]] },
        ],
        note: "Live ticks update LTP, Volume and OI in real time. Change % and OI change are against the previous trading session. Settings are saved for NSE F&O on this device.",
    },
    crypto: {
        title: "Crypto Settings",
        badge: "⚡ Crypto",
        source: "Delta Exchange · BTC / ETH options",
        badgeCls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60",
        activeCls: "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
        accent: "accent-amber-500",
        atmBasis: [
            ["spot", "Spot (index)"],
            ["synth", "Forward (put-call parity)"],
        ],
        columnGroups: [
            { title: "Price", items: [["bidAsk", "Bid / Ask"]] },
            { title: "Open Interest", items: [["oi", "OI"], ["pcr", "PCR"]] },
            { title: "Volume", items: [["volume", "Volume"], ["volOi", "Vol/OI"], ["pcrVol", "PCR (Vol)"]] },
            { title: "Greeks", items: [["iv", "Mark IV"], ["delta", "Delta"], ["gamma", "Gamma"], ["theta", "Theta"], ["vega", "Vega"]] },
        ],
        note: "Prices are Delta Exchange mark prices in USD; OI and volume are in contracts. Delta doesn't publish a previous-day change, so OI change and LTP change % aren't available here. Refreshes every 5s. Settings are saved for Crypto on this device.",
    },
};

export default function OptionChainSettingsDrawer({
    open,
    onClose,
    market = "indian",
    columns,
    onToggleColumn,
    onApplyPreset,
    atmBasis,
    onAtmBasisChange,
    strikesAroundAtm,
    onStrikesAroundAtmChange,
}) {
    if (!open) return null;
    const cfg = MARKET_CONFIG[market] || MARKET_CONFIG.indian;

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs" onClick={onClose} />
            <aside className="fixed right-0 top-0 z-50 h-full w-full max-w-80 overflow-y-auto bg-surface border-l border-line shadow-2xl">
                <div className="sticky top-0 z-10 border-b border-line bg-surface px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-bold text-fg">{cfg.title}</h2>
                        <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label="Close settings">
                            ✕
                        </button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-md border px-1.5 py-0.5 text-micro font-bold ${cfg.badgeCls}`}>{cfg.badge}</span>
                        <span className="text-label text-fg-subtle">{cfg.source}</span>
                    </div>
                </div>

                <div className="px-4 py-4 text-xs space-y-5">
                    <div>
                        <div className="mb-2 font-bold text-fg">Preferences</div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-fg-muted">Quick preset</div>
                            <div className="flex gap-2">
                                <button onClick={() => onApplyPreset("compact")} className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 font-semibold text-fg-muted hover:bg-surface-hover">
                                    LTP only
                                </button>
                                <button onClick={() => onApplyPreset("standard")} className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 font-semibold text-fg-muted hover:bg-surface-hover">
                                    Standard
                                </button>
                            </div>
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-fg-muted">ATM based on</div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                {cfg.atmBasis.map(([key, label]) => (
                                    <label key={key} className="flex items-center gap-1.5 text-fg cursor-pointer">
                                        <input type="radio" name={`oc-atm-basis-${market}`} checked={atmBasis === key} onChange={() => onAtmBasisChange(key)} className={cfg.accent} />
                                        <span>{label}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-fg-muted">Strikes around ATM</div>
                            <div className="flex flex-wrap gap-1.5">
                                {STRIKE_RANGE_OPTIONS.map((o) => (
                                    <button
                                        key={o.label}
                                        onClick={() => onStrikesAroundAtmChange(o.value)}
                                        className={`rounded-md border px-2 py-1 font-semibold ${
                                            strikesAroundAtm === o.value
                                                ? `${cfg.activeCls} font-bold shadow-xs`
                                                : "border-line text-fg-muted hover:bg-surface-hover"
                                        }`}
                                    >
                                        {o.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="mb-2 flex items-center justify-between border-t border-line pt-3">
                            <span className="font-bold text-fg">Column Visibility</span>
                        </div>

                        {cfg.columnGroups.map((group) => (
                            <div key={group.title} className="mb-3">
                                <div className="mb-1.5 font-semibold text-fg-muted">{group.title}</div>
                                {group.items.map(([key, label]) => (
                                    <label key={key} className="mb-1 flex items-center justify-between cursor-pointer">
                                        <span className="text-fg">{label}</span>
                                        <input type="checkbox" checked={!!columns[key]} onChange={() => onToggleColumn(key)} className={cfg.accent} />
                                    </label>
                                ))}
                            </div>
                        ))}
                    </div>

                    <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-label text-fg-subtle">{cfg.note}</div>
                </div>
            </aside>
        </>
    );
}
