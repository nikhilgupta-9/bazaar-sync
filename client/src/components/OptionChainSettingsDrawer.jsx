// components/OptionChainSettingsDrawer.jsx
//
// Right-side slide-in drawer for the Option Chain page's gear icon. Scoped
// to fields the backend actually returns (see optionChainService.js) —
// Intrinsic/Time Value/PP Ratio/Open-High-Low/OI Diff aren't computed
// anywhere in this codebase yet, so they're intentionally left out rather
// than wired to fake data. Gamma/Theta/Vega ARE already computed per-row by
// the backend (same Black-Scholes pass that produces Delta/IV) but weren't
// previously rendered in this table — added here as new optional columns.
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
            <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
            <aside className="fixed right-0 top-0 z-50 h-full w-80 overflow-y-auto bg-white shadow-2xl">
                <div className="sticky top-0 flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
                    <h2 className="text-sm font-bold text-gray-900">Option Chain Settings</h2>
                    <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close settings">
                        ✕
                    </button>
                </div>

                <div className="px-4 py-4 text-xs">
                    <div className="mb-5">
                        <div className="mb-2 font-bold text-gray-700">Preferences</div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-gray-600">Quick preset</div>
                            <div className="flex gap-2">
                                <button onClick={() => onApplyPreset("ltp")} className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 font-semibold text-gray-600 hover:bg-gray-50">
                                    LTP only
                                </button>
                                <button onClick={() => onApplyPreset("all")} className="flex-1 rounded-md border border-gray-200 px-2 py-1.5 font-semibold text-gray-600 hover:bg-gray-50">
                                    All columns
                                </button>
                            </div>
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-gray-600">ATM based on</div>
                            <div className="flex gap-3">
                                {[["spot", "Spot"], ["future", "Future"], ["synth", "Synth Future"]].map(([key, label]) => (
                                    <label key={key} className="flex items-center gap-1 text-gray-700 cursor-pointer">
                                        <input type="radio" name="oc-atm-basis" checked={atmBasis === key} onChange={() => onAtmBasisChange(key)} />
                                        {label}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-gray-600">Strikes around ATM</div>
                            <div className="flex flex-wrap gap-1.5">
                                {STRIKE_RANGE_OPTIONS.map((o) => (
                                    <button
                                        key={o.label}
                                        onClick={() => onStrikesAroundAtmChange(o.value)}
                                        className={`rounded-md border px-2 py-1 font-semibold ${
                                            strikesAroundAtm === o.value
                                                ? "border-blue-400 bg-blue-50 text-blue-700"
                                                : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                        }`}
                                    >
                                        {o.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <span className="font-bold text-gray-700">Column Visibility</span>
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-gray-600">Price</div>
                            <label className="mb-1 flex items-center justify-between cursor-pointer">
                                <span className="text-gray-700">LTP Change %</span>
                                <input type="checkbox" checked={columns.ltpChangePercent} onChange={() => onToggleColumn("ltpChangePercent")} />
                            </label>
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-gray-600">Open Interest</div>
                            {[["oi", "OI"], ["oiChangePercent", "OI Change %"], ["oiChange", "OI Change"], ["pcr", "PCR"]].map(([key, label]) => (
                                <label key={key} className="mb-1 flex items-center justify-between cursor-pointer">
                                    <span className="text-gray-700">{label}</span>
                                    <input type="checkbox" checked={columns[key]} onChange={() => onToggleColumn(key)} />
                                </label>
                            ))}
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-gray-600">Volume</div>
                            {[["volume", "Volume"], ["volOi", "Vol/OI"], ["pcrVol", "PCR (Vol)"]].map(([key, label]) => (
                                <label key={key} className="mb-1 flex items-center justify-between cursor-pointer">
                                    <span className="text-gray-700">{label}</span>
                                    <input type="checkbox" checked={columns[key]} onChange={() => onToggleColumn(key)} />
                                </label>
                            ))}
                        </div>

                        <div className="mb-3">
                            <div className="mb-1.5 font-semibold text-gray-600">Greeks</div>
                            {[["iv", "IV"], ["delta", "Delta"], ["gamma", "Gamma"], ["theta", "Theta"], ["vega", "Vega"]].map(([key, label]) => (
                                <label key={key} className="mb-1 flex items-center justify-between cursor-pointer">
                                    <span className="text-gray-700">{label}</span>
                                    <input type="checkbox" checked={columns[key]} onChange={() => onToggleColumn(key)} />
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="mt-5 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-[10px] text-gray-400">
                        Font size, Lots/Qty display, full OI-Vol numbers, and totals-row position are planned but not built yet.
                    </div>
                </div>
            </aside>
        </>
    );
}
