const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];
const STRIKE_RANGES = [
    { label: "All", value: null },
    { label: "5", value: 5 },
    { label: "10", value: 10 },
    { label: "20", value: 20 },
];

// Shared left-panel layout used by the "Options Lab" style pages (Max Pain,
// PCR, IV chart, Straddle chart) — matches stockmojo.in's Settings sidebar,
// as distinct from the control-bar-on-top layout used for Option Chain.
export default function SettingsSidebar({
    symbol, onSymbolChange,
    expiries, selectedExpiry, onExpiryChange,
    strikeRange, onStrikeRangeChange,
}) {
    return (
        <aside className="w-64 shrink-0 rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">Settings</h3>

            <div className="mb-4 flex items-center gap-1">
                {SYMBOLS.map((s) => (
                    <button
                        key={s}
                        onClick={() => onSymbolChange(s)}
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            symbol === s ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                    >
                        {s}
                    </button>
                ))}
            </div>

            {expiries?.length > 0 && (
                <div className="mb-4">
                    <label className="mb-1 block text-xs font-medium text-gray-500">Expiry</label>
                    <select
                        value={selectedExpiry}
                        onChange={(e) => onExpiryChange(e.target.value)}
                        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                    >
                        {expiries.map((exp) => (
                            <option key={exp} value={exp}>{exp}</option>
                        ))}
                    </select>
                </div>
            )}

            {onStrikeRangeChange && (
                <div>
                    <label className="mb-1 block text-xs font-medium text-gray-500">Strikes above/below ATM</label>
                    <div className="flex gap-1">
                        {STRIKE_RANGES.map((r) => (
                            <button
                                key={r.label}
                                onClick={() => onStrikeRangeChange(r.value)}
                                className={`flex-1 rounded-md border px-2 py-1 text-xs font-medium ${
                                    strikeRange === r.value
                                        ? "border-blue-400 bg-blue-50 text-blue-700"
                                        : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                }`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </aside>
    );
}
