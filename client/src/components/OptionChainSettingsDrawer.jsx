import React from "react";
// components/OptionChainSettingsDrawer.jsx
//
// Right-side slide-in drawer for the Option Chain page's gear icon.
const STRIKE_RANGE_OPTIONS = [
    { label: "5", value: 5 },
    { label: "10", value: 10 },
    { label: "20", value: 20 },
    { label: "30", value: 30 },
    { label: "40", value: 40 },
    { label: "All", value: null },
];

export default function OptionChainSettingsDrawer({
    open,
    onClose,
    columns,
    onToggleColumn,
    onApplyPreset,
    atmBasis,
    onAtmBasisChange,
    strikesAroundAtm,
    onStrikesAroundAtmChange,
}) {
    if (!open) return null;

    return (
        <>
            <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs" onClick={onClose} />
            <aside className="fixed right-0 top-0 z-50 h-full w-80 overflow-y-auto bg-surface border-l border-line shadow-2xl">
                <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
                    <h2 className="text-sm font-bold text-fg">Option Chain Settings</h2>
                    <button onClick={onClose} className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg" aria-label="Close settings">
                        ✕
                    </button>
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
                            <div className="flex gap-3">
                                {[["spot", "Spot"], ["future", "Future"], ["synth", "Synth Future"]].map(([key, label]) => (
                                    <label key={key} className="flex items-center gap-1.5 text-fg cursor-pointer">
                                        <input type="radio" name="oc-atm-basis" checked={atmBasis === key} onChange={() => onAtmBasisChange(key)} className="accent-emerald-600" />
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
                                                ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-bold shadow-xs"
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

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-fg-muted">Price</div>
                            <label className="mb-1 flex items-center justify-between cursor-pointer">
                                <span className="text-fg">LTP Change %</span>
                                <input type="checkbox" checked={columns.ltpChangePercent} onChange={() => onToggleColumn("ltpChangePercent")} className="accent-emerald-600" />
                            </label>
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-fg-muted">Open Interest</div>
                            {[["oi", "OI"], ["oiChangePercent", "OI Change %"], ["oiChange", "OI Change"], ["pcr", "PCR"]].map(([key, label]) => (
                                <label key={key} className="mb-1 flex items-center justify-between cursor-pointer">
                                    <span className="text-fg">{label}</span>
                                    <input type="checkbox" checked={columns[key]} onChange={() => onToggleColumn(key)} className="accent-emerald-600" />
                                </label>
                            ))}
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-fg-muted">Volume</div>
                            {[["volume", "Volume"], ["volOi", "Vol/OI"], ["pcrVol", "PCR (Vol)"]].map(([key, label]) => (
                                <label key={key} className="mb-1 flex items-center justify-between cursor-pointer">
                                    <span className="text-fg">{label}</span>
                                    <input type="checkbox" checked={columns[key]} onChange={() => onToggleColumn(key)} className="accent-emerald-600" />
                                </label>
                            ))}
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-fg-muted">Greeks</div>
                            {[["iv", "IV"], ["delta", "Delta"], ["gamma", "Gamma"], ["theta", "Theta"], ["vega", "Vega"]].map(([key, label]) => (
                                <label key={key} className="mb-1 flex items-center justify-between cursor-pointer">
                                    <span className="text-fg">{label}</span>
                                    <input type="checkbox" checked={columns[key]} onChange={() => onToggleColumn(key)} className="accent-emerald-600" />
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-micro text-fg-subtle">
                        Live ticks update LTP, Volume and OI in real time. Settings persist for your active session.
                    </div>
                </div>
            </aside>
        </>
    );
}
