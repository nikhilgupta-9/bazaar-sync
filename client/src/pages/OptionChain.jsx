// pages/OptionChain.jsx
import { useMemo, useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useOptionChain } from "../hooks/useOptionChain";
import { useAuth } from "../context/AuthContext";
import { formatPrice, formatPercent, formatDateTime, formatOi } from "../utils/format";
import { fetchSymbolList } from "../services/optionChainApi";
import ContractChartModal from "../components/ContractChartModal";
import OiBar from "../components/OiBar";
import OptionChainSettingsDrawer from "../components/OptionChainSettingsDrawer";
import PremiumFeaturesModal from "../components/PremiumFeaturesModal";
import { FiSettings, FiSearch, FiCheck, FiChevronDown } from "react-icons/fi";
import { TbReload } from "react-icons/tb";
import { MdOutlineWatchLater } from "react-icons/md";
import { IoIosArrowBack } from "react-icons/io";
import { IoIosArrowForward } from "react-icons/io";
import { FiLock } from "react-icons/fi";


// Fallback shown for the brief moment before /symbols/list resolves (or if
// it fails) — the 3 symbols the live worker actually covers.
const FALLBACK_SYMBOLS = { indices: ["NIFTY", "BANKNIFTY", "FINNIFTY"], stocks: [], liveSymbols: ["NIFTY", "BANKNIFTY", "FINNIFTY"] };

// Format Greeks with proper decimal places
function formatGreek(value, decimals = 2) {
    if (value == null || isNaN(value)) return "-";
    return Number(value).toFixed(decimals);
}

// Ratio helper for the Vol/OI column — how much of today's open interest
// traded hands today, a liquidity/freshness signal stockmojo shows per row.
function formatRatio(volume, oi) {
    if (!oi) return "-";
    return ((volume || 0) / oi).toFixed(2);
}

// Per-strike PCR / PCR(Vol) — the ratio at THIS strike only (not the chain-
// wide PCR shown in the header), matching stockmojo's middle-zone columns.
// Guards against near-empty-OI strikes producing meaningless triple-digit
// ratios (e.g. 5 contracts of OI on one side) — below MIN_BASE it's noise,
// not a real ratio, so show "-" instead of a distorted number.
const MIN_RATIO_BASE = 10;
function formatStrikeRatio(numerator, denominator) {
    if (!denominator || denominator < MIN_RATIO_BASE) return "-";
    return (numerator / denominator).toFixed(2);
}

// Big value on top, small colored %-change underneath — the LTP/IV cell
// pattern stockmojo uses everywhere (e.g. "364.00" / "-14%").
function ValueWithChange({ value, change, formatValue = formatPrice, align = "right" }) {
    return (
        <div className={`flex flex-col ${align === "right" ? "items-end" : "items-center"} leading-tight`}>
            <span className="tabular-nums">{formatValue(value)}</span>
            <span className={`text-chain tabular-nums ${change >= 0 ? "text-emerald-600" : change < 0 ? "text-rose-600" : "text-gray-300"}`}>
                {change != null ? formatPercent(change) : "-"}
            </span>
        </div>
    );
}

// Heatmap background for Volume/OI-Chg cells — intensity scales with
// magnitude relative to the max seen in the currently loaded chain, mirrors
// stockmojo's darker-green-for-bigger-numbers treatment.
function heatStyle(value, maxAbs) {
    if (value == null || !maxAbs) return {};
    const intensity = Math.min(1, Math.abs(value) / maxAbs);
    if (intensity < 0.05) return {};
    const alpha = 0.12 + intensity * 0.45;
    const color = value >= 0 ? `rgba(16,185,129,${alpha.toFixed(2)})` : `rgba(244,63,94,${alpha.toFixed(2)})`;
    return { backgroundColor: color };
}

// Table columns the user can individually show/hide via the settings
// drawer — defaults match the table's original always-on layout, so turning
// this feature on doesn't change what anyone already sees. Gamma/Theta/Vega
// are new (backend already computes them, just wasn't rendered here before).
const DEFAULT_COLUMNS = {
    ltpChangePercent: true,
    oi: true, oiChangePercent: true, oiChange: true, pcr: true,
    volume: true, volOi: true, pcrVol: true,
    iv: true, delta: true, gamma: false, theta: false, vega: false,
};
const LTP_PRESET_COLUMNS = Object.fromEntries(Object.keys(DEFAULT_COLUMNS).map((k) => [k, false]));
const ALL_COLUMNS = Object.fromEntries(Object.keys(DEFAULT_COLUMNS).map((k) => [k, true]));

export default function OptionChain() {
    const { symbol: urlSymbol } = useParams();
    const navigate = useNavigate();
    const { user, isPro } = useAuth();

    const {
        symbol,
        data,
        loading,
        error,
        marketStatus,
        isLive,
        lastUpdated,
        setSymbol,
        load,
        refresh,
    } = useOptionChain(urlSymbol ? urlSymbol.toUpperCase() : "NIFTY");

    const [expiryFilter, setExpiryFilter] = useState(null);
    const [chartTarget, setChartTarget] = useState(null); // { strike, right } | null
    const [symbolList, setSymbolList] = useState(FALLBACK_SYMBOLS);
    const tableContainerRef = useRef(null);
    const atmRowRef = useRef(null);

    // Symbol search badge (pill → editable search box) + prev/next arrows.
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerQuery, setPickerQuery] = useState("");

    // Settings drawer state.
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [columns, setColumns] = useState(DEFAULT_COLUMNS);
    const [atmBasis, setAtmBasis] = useState("spot"); // 'spot' | 'future' | 'synth'
    const [strikesAroundAtm, setStrikesAroundAtm] = useState(20); // null = All

    // Live/Historical strip — Historical is Pro-gated (see CLAUDE.md hard
    // rule: Free tier cannot access full history) and bridges to Simulator,
    // which already does real per-minute historical browsing, rather than
    // half-building a second historical picker inside this page.
    const [premiumModalOpen, setPremiumModalOpen] = useState(false);

    function toggleColumn(key) {
        setColumns((prev) => ({ ...prev, [key]: !prev[key] }));
    }
    function applyColumnPreset(preset) {
        setColumns(preset === "ltp" ? LTP_PRESET_COLUMNS : ALL_COLUMNS);
    }

    function goHistorical(extraParams) {
        if (!user || !isPro) {
            setPremiumModalOpen(true);
            return;
        }
        const qs = new URLSearchParams({ symbol, ...extraParams }).toString();
        navigate(`/simulator?${qs}`);
    }

    // The "Previous day" select is a stateless action menu (like Historical's
    // button, just for a specific relative day) — it resets to its
    // placeholder after every pick rather than staying on the chosen option.
    function handleHistoricalDaySelect(e) {
        const value = e.target.value;
        e.target.value = "";
        if (value === "prev") goHistorical({ jump: "prev" });
    }

    // Every symbol with real historical data (indices + 200+ F&O stocks from
    // Bhavcopy/Breeze) — fetched once, not the old hardcoded 3-index list.
    useEffect(() => {
        let cancelled = false;
        fetchSymbolList()
            .then((list) => {
                if (!cancelled) setSymbolList(list);
            })
            .catch(() => {
                /* keep FALLBACK_SYMBOLS — the dropdown still works with just the 3 live symbols */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    // Keep the URL (/option-chain/:symbol) in sync with whichever symbol is
    // actually loaded — covers both directions: picking a new symbol here
    // pushes a new URL, and landing on a URL directly seeds useOptionChain's
    // initial symbol above.
    useEffect(() => {
        if (symbol && symbol.toLowerCase() !== urlSymbol) {
            navigate(`/option-chain/${symbol.toLowerCase()}`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol]);

    const allSymbols = useMemo(
        () => [...symbolList.indices, ...symbolList.stocks],
        [symbolList]
    );
    const filteredIndices = useMemo(
        () => symbolList.indices.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );
    const filteredStocks = useMemo(
        () => symbolList.stocks.filter((s) => s.toLowerCase().includes(pickerQuery.toLowerCase())),
        [symbolList, pickerQuery]
    );

    function cycleSymbol(dir) {
        if (allSymbols.length < 2) return;
        const idx = allSymbols.indexOf(symbol);
        const base = idx >= 0 ? idx : 0;
        setSymbol(allSymbols[(base + dir + allSymbols.length) % allSymbols.length]);
    }
    function pickSymbol(sym) {
        setSymbol(sym);
        setPickerOpen(false);
        setPickerQuery("");
    }

    // Which strike counts as ATM depends on the chosen reference price
    // (Spot / Future / Synthetic Future via put-call parity) — ITM/OTM
    // shading still uses raw spot (moneyness doesn't change), only the ATM
    // highlight/tag/Go-to-ATM target moves. Same formula as StrategyBuilder.jsx.
    const effectiveAtmPrice = useMemo(() => {
        if (!data) return null;
        if (atmBasis === "future") return data.futurePrice ?? data.spotPrice;
        if (atmBasis === "synth") {
            const atmRow = data.rows?.find((r) => r.strike === data.atmStrike);
            const synth = atmRow && atmRow.ce?.ltp != null && atmRow.pe?.ltp != null
                ? data.atmStrike + atmRow.ce.ltp - atmRow.pe.ltp
                : null;
            return synth ?? data.spotPrice;
        }
        return data.spotPrice;
    }, [atmBasis, data]);

    const effectiveAtmStrike = useMemo(() => {
        if (!data?.rows?.length || effectiveAtmPrice == null) return data?.atmStrike ?? null;
        return data.rows.reduce(
            (best, r) => (Math.abs(r.strike - effectiveAtmPrice) < Math.abs(best.strike - effectiveAtmPrice) ? r : best)
        ).strike;
    }, [data, effectiveAtmPrice]);

    // "Strikes around ATM" trims the full chain to N rows either side of the
    // effective ATM strike (null = show everything, the previous behavior).
    const displayRows = useMemo(() => {
        if (!data?.rows) return [];
        if (strikesAroundAtm == null || effectiveAtmStrike == null) return data.rows;
        const idx = data.rows.findIndex((r) => r.strike === effectiveAtmStrike);
        if (idx < 0) return data.rows;
        return data.rows.slice(Math.max(0, idx - strikesAroundAtm), idx + strikesAroundAtm + 1);
    }, [data, strikesAroundAtm, effectiveAtmStrike]);

    function scrollToAtm() {
        atmRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    // Group into ITM, OTM, and Grand Totals — scoped to the currently VISIBLE
    // strikes (respects "Strikes around ATM"), not the full stored chain.
    const totals = useMemo(() => {
        if (!displayRows.length) return null;
        const spot = data?.spotPrice || 0;

        let ceItmOi = 0, ceItmVol = 0, ceOtmOi = 0, ceOtmVol = 0;
        let peItmOi = 0, peItmVol = 0, peOtmOi = 0, peOtmVol = 0;

        displayRows.forEach((r) => {
            if (r.strike < spot) {
                ceItmOi += r.ce.oi || 0;
                ceItmVol += r.ce.volume || 0;
                peOtmOi += r.pe.oi || 0;
                peOtmVol += r.pe.volume || 0;
            } else {
                ceOtmOi += r.ce.oi || 0;
                ceOtmVol += r.ce.volume || 0;
                peItmOi += r.pe.oi || 0;
                peItmVol += r.pe.volume || 0;
            }
        });

        return {
            ceItm: { oi: ceItmOi, vol: ceItmVol },
            ceOtm: { oi: ceOtmOi, vol: ceOtmVol },
            peItm: { oi: peItmOi, vol: peItmVol },
            peOtm: { oi: peOtmOi, vol: peOtmVol },
            totalCeOi: ceItmOi + ceOtmOi,
            totalPeOi: peItmOi + peOtmOi,
        };
    }, [displayRows, data]);

    // Scaling references for the OI inline bars and the Volume/OI-Chg heatmap
    // shading — recomputed whenever the visible chain changes, shared across
    // both call and put sides so the two halves of the table stay visually
    // comparable (a bigger bar always means a bigger number, same scale).
    const scale = useMemo(() => {
        if (!displayRows.length) return { maxOi: 0, maxVolume: 0, maxOiChange: 0 };
        let maxOi = 0, maxVolume = 0, maxOiChange = 0;
        displayRows.forEach((r) => {
            maxOi = Math.max(maxOi, r.ce.oi || 0, r.pe.oi || 0);
            maxVolume = Math.max(maxVolume, r.ce.volume || 0, r.pe.volume || 0);
            maxOiChange = Math.max(maxOiChange, Math.abs(r.ce.oiChange || 0), Math.abs(r.pe.oiChange || 0));
        });
        return { maxOi, maxVolume, maxOiChange };
    }, [displayRows]);

    // Real visible-column counts, driven by the settings drawer's toggles —
    // used only for the CALLS/PUTS grouping row's colSpan so that row stays
    // aligned with whichever columns are actually rendered below it. (The
    // Totals footer's colSpans are left as fixed approximations, same as
    // before this feature existed — they were never pixel-exact against the
    // real header to begin with.)
    const ceColCount =
        1 /* LTP */ +
        (columns.delta ? 1 : 0) + (columns.volOi ? 1 : 0) +
        (columns.volume ? 1 : 0) + (columns.oiChangePercent ? 1 : 0) + (columns.oiChange ? 1 : 0) +
        (columns.oi ? 1 : 0) +
        (columns.theta ? 1 : 0) + (columns.vega ? 1 : 0) + (columns.gamma ? 1 : 0);
    const midColCount = 1 /* Strike */ + (columns.iv ? 1 : 0) + (columns.pcr ? 1 : 0) + (columns.pcrVol ? 1 : 0);
    const peColCount =
        1 /* LTP */ + (columns.oi ? 1 : 0) + (columns.oiChange ? 1 : 0) +
        (columns.oiChangePercent ? 1 : 0) + (columns.theta ? 1 : 0) + (columns.vega ? 1 : 0) + (columns.gamma ? 1 : 0) +
        (columns.delta ? 1 : 0);

    const handleExpiryChange = (e) => {
        const expiry = e.target.value;
        setExpiryFilter(expiry);
        load(symbol, expiry);
    };

    return (
        <div className="mx-auto max-w-[1500px] px-2 py-2 bg-slate-50 min-h-screen font-sans text-gray-900">

            {/* Header Ribbon */}
            <div className="mb-2 bg-white p-2 rounded-lg shadow-sm border border-gray-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-0.5 relative rounded-lg border border-gray-200 bg-white p-0.5">
                        <button
                            onClick={() => cycleSymbol(-1)}
                            disabled={allSymbols.length < 2}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
                            aria-label="Previous symbol"
                        >
                            <IoIosArrowBack size={20} />
                        </button>

                        <button
                            onClick={() => setPickerOpen((v) => !v)}
                            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${pickerOpen ? "bg-blue-50" : "hover:bg-gray-50"}`}
                        >
                            {data?.lotSize && (
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-chain font-bold text-gray-500">
                                    {data.lotSize}
                                </span>
                            )}
                            <span className="text-sm font-bold text-gray-900">{symbol}</span>
                            <FiChevronDown size={14} className={`text-gray-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
                        </button>

                        <button
                            onClick={() => cycleSymbol(1)}
                            disabled={allSymbols.length < 2}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
                            aria-label="Next symbol"
                        >
                            <IoIosArrowForward size={20} />
                        </button>

                        {pickerOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
                                <div className="absolute left-0 top-full z-20 mt-2 w-72 max-h-96 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl text-chain">
                                    <div className="sticky top-0 border-b border-gray-100 bg-white p-2">
                                        <div className="relative">
                                            <FiSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                autoFocus
                                                value={pickerQuery}
                                                onChange={(e) => setPickerQuery(e.target.value)}
                                                placeholder="Search symbol…"
                                                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-2 text-chain outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                                            />
                                        </div>
                                    </div>
                                    {filteredIndices.length > 0 && (
                                        <div className="py-1">
                                            <div className="px-3 pt-2 pb-1 text-chain font-bold uppercase tracking-wide text-gray-400">Index</div>
                                            {filteredIndices.map((s) => (
                                                <button
                                                    key={s}
                                                    onClick={() => pickSymbol(s)}
                                                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-medium hover:bg-gray-50 ${s === symbol ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
                                                >
                                                    <span className="flex items-center gap-1.5">
                                                        {s}
                                                        {!symbolList.liveSymbols.includes(s) && (
                                                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-chain font-semibold text-gray-400">Historical</span>
                                                        )}
                                                    </span>
                                                    {s === symbol && <FiCheck size={14} className="shrink-0 text-blue-600" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {filteredStocks.length > 0 && (
                                        <div className="border-t border-gray-100 py-1">
                                            <div className="px-3 pt-2 pb-1 text-chain font-bold uppercase tracking-wide text-gray-400">Stocks</div>
                                            {filteredStocks.map((s) => (
                                                <button
                                                    key={s}
                                                    onClick={() => pickSymbol(s)}
                                                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-medium hover:bg-gray-50 ${s === symbol ? "bg-blue-50 text-blue-700" : "text-gray-700"}`}
                                                >
                                                    {s}
                                                    {s === symbol && <FiCheck size={14} className="shrink-0 text-blue-600" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {!filteredIndices.length && !filteredStocks.length && (
                                        <div className="px-3 py-8 text-center text-gray-400">No matches</div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="relative inline-block rounded-lg border border-gray-200 bg-white p-0.5">
                        <select
                            value={data?.selectedExpiry || expiryFilter || ""}
                            onChange={handleExpiryChange}
                            className="rounded-md bg-transparent px-2 py-1 text-chain font-medium text-gray-700 outline-none"
                        >
                            {data?.expiries?.map((exp) => (
                                <option key={exp} value={exp}>
                                    {exp}{data.daysToExpiry != null && exp === data.selectedExpiry ? ` (${data.daysToExpiry}d)` : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {data && (
                            <div className="flex items-center gap-3 text-chain text-gray-400 mr-1">
                                <span>
                                    Spot : <span className="font-bold text-gray-900 tabular-nums">{formatPrice(data.spotPrice)}</span>
                                    {data.spotChangePercent != null && (
                                        <span className={`ml-1 tabular-nums ${data.spotChange >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                            {data.spotChange >= 0 ? "+" : ""}{data.spotChange} ({data.spotChange >= 0 ? "+" : ""}{data.spotChangePercent}%)
                                        </span>
                                    )}
                                </span>
                                <span className="text-gray-200">|</span>
                                <span>
                                    {atmBasis === "synth" ? "Syn Future" : "Future"}{" "}
                                    <span className="font-bold text-gray-900 tabular-nums">{data.futurePrice != null ? formatPrice(data.futurePrice) : "—"}</span>
                                </span>
                                <span className="text-gray-200">|</span>
                                <span>VIX <span className="font-bold text-gray-900 tabular-nums">{data.vix != null ? Number(data.vix).toFixed(2) : "—"}</span></span>
                                <span className="text-gray-200">|</span>
                                <span>PCR <span className={`font-bold tabular-nums ${data.pcr >= 1 ? "text-emerald-600" : "text-rose-600"}`}>{data.pcr ?? "-"}</span></span>
                            </div>
                        )}
                        <button
                            onClick={refresh}
                            disabled={loading}
                            className="flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-1.5 text-chain font-semibold text-blue-600 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? (
                                "Refreshing..."
                            ) : (
                                <>
                                    <TbReload size={16} />
                                    <span>Refresh</span>
                                </>
                            )}
                        </button>
                        <button
                            onClick={() => setSettingsOpen(true)}
                            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            aria-label="Option chain settings"
                            title="Option Chain Settings"
                        >
                            <FiSettings size={20} />
                        </button>
                    </div>
                </div>

                {/* Live/Historical strip */}
                <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                        <button
                            className="rounded-md bg-blue-600 px-3 py-1 text-chain font-bold text-white shadow-sm"
                        >
                            Live
                        </button>

                        <button
                            onClick={() => goHistorical()}
                            className="flex items-center gap-1 rounded-md px-3 py-1 text-chain font-semibold text-gray-500 transition hover:bg-white hover:text-gray-700"
                            title={
                                !user || !isPro
                                    ? "Pro feature — subscribe to unlock"
                                    : "Browse this day minute-by-minute in the Simulator"
                            }
                        >
                            Historical

                            {!user || !isPro ? (
                                <FiLock size={12} />
                            ) : null}
                        </button>
                    </div>

                    <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                        <select
                            defaultValue=""
                            onChange={handleHistoricalDaySelect}
                            className="rounded-md bg-transparent px-2 py-1 text-chain font-semibold text-gray-500 outline-none hover:bg-white hover:text-gray-700"
                            title={!user || !isPro ? "Pro feature — subscribe to unlock" : "Jump to a specific historical day in the Simulator"}
                        >
                            <option value="" disabled>Jump to…</option>
                            <option value="prev">Previous day{!user || !isPro ? " 🔒" : ""}</option>
                        </select>
                    </div>
                    </div>

                    <div className="flex items-center gap-2 text-chain text-gray-500">
                        <span
                            className={`inline-block h-2 w-2 rounded-full ${
                                marketStatus.isOpen && marketStatus.feedConnected && isLive
                                    ? "bg-green-500 animate-pulse"
                                    : marketStatus.isOpen
                                        ? "bg-amber-500"
                                        : "bg-gray-400"
                            }`}
                            title={marketStatus.isOpen ? (isLive ? "Live feed connected" : "Market open, feed stale") : "Market closed"}
                        />
                        <span className="font-medium">
                            {marketStatus.isOpen ? (isLive ? "Live" : "Feed stale") : "Market closed"}
                        </span>
                        <span className="text-gray-300">·</span>
                        <MdOutlineWatchLater size={16} />
                        <span className="tabular-nums">{lastUpdated ? formatDateTime(lastUpdated) : "—"}</span>
                    </div>
                </div>
            </div>

            {premiumModalOpen && <PremiumFeaturesModal onClose={() => setPremiumModalOpen(false)} />}

            <OptionChainSettingsDrawer
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                columns={columns}
                onToggleColumn={toggleColumn}
                onApplyPreset={applyColumnPreset}
                atmBasis={atmBasis}
                onAtmBasisChange={setAtmBasis}
                strikesAroundAtm={strikesAroundAtm}
                onStrikesAroundAtmChange={setStrikesAroundAtm}
            />

            {error && <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded text-chain">⚠️ {error}</div>}

            {chartTarget && data && (
                <ContractChartModal
                    symbol={data.symbol}
                    strike={chartTarget.strike}
                    expiry={data.selectedExpiry}
                    right={chartTarget.right}
                    onClose={() => setChartTarget(null)}
                />
            )}

            {/* Main Option Chain Grid with Greeks */}
            {data && data.rows ? (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto" ref={tableContainerRef}>
                        <table className="w-full text-left border-collapse text-chain">
                            <thead>
                                <tr className="text-center font-bold text-sm">
                                    <th colSpan={ceColCount} className="bg-emerald-50 text-emerald-800 border-b border-gray-200 py-2">CALLS</th>
                                    <th colSpan={midColCount} className="bg-gray-100 border-b border-gray-200"></th>
                                    <th colSpan={peColCount} className="bg-rose-50 text-rose-800 border-b border-gray-200 py-2">PUTS</th>
                                </tr>
                                <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-200 text-center">
                                    {columns.theta && <th className="p-1.5">Theta</th>}
                                    {columns.vega && <th className="p-1.5">Vega</th>}
                                    {columns.gamma && <th className="p-1.5">Gamma</th>}
                                    {columns.delta && <th className="p-1.5">Delta</th>}
                                    {columns.volOi && <th className="p-1.5 text-right">Vol/OI</th>}
                                    {columns.volume && <th className="p-1.5 text-right">Volume</th>}
                                    {columns.oiChangePercent && <th className="p-1.5 text-right">OI Chg%</th>}
                                    {columns.oiChange && <th className="p-1.5 text-right">OI Chg</th>}
                                    {columns.oi && <th className="p-1.5 text-right">OI</th>}
                                    <th className="p-1.5 text-right">LTP</th>
                                    <th className="bg-gray-100 text-gray-800 font-bold p-1.5">Strike</th>
                                    {columns.iv && <th className="p-1.5 text-right">IV</th>}
                                    {columns.pcr && <th className="p-1.5 text-right">PCR</th>}
                                    {columns.pcrVol && <th className="p-1.5 text-right">PCR(Vol)</th>}
                                    <th className="p-1.5 text-right">LTP</th>
                                    {columns.oi && <th className="p-1.5 text-right">OI</th>}
                                    {columns.oiChange && <th className="p-1.5 text-right">OI Chg</th>}
                                    {columns.oiChangePercent && <th className="p-1.5 text-right">OI Chg%</th>}
                                    {columns.theta && <th className="p-1.5">Theta</th>}
                                    {columns.vega && <th className="p-1.5">Vega</th>}
                                    {columns.gamma && <th className="p-1.5">Gamma</th>}
                                    {columns.delta && <th className="p-1.5">Delta</th>}
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-100">
                                {displayRows.map((row) => {
                                    const ceItm = row.strike < data.spotPrice;
                                    const peItm = row.strike > data.spotPrice;
                                    const isMaxPain = row.strike === data.maxPainStrike;
                                    const isAtm = row.strike === effectiveAtmStrike;

                                    return (
                                        <tr
                                            key={row.strike}
                                            ref={isAtm ? atmRowRef : null}
                                            className={`hover:bg-slate-50 transition-colors text-center font-medium ${
                                                isAtm ? "ring-1 ring-inset ring-blue-400" : ""
                                            }`}
                                        >
                                            {/* CALL SIDE */}
                                            {columns.theta && <td className={`p-1 tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/60" : ""}`}>{formatGreek(row.ce.theta)}</td>}
                                            {columns.vega && <td className={`p-1 tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/60" : ""}`}>{formatGreek(row.ce.vega)}</td>}
                                            {columns.gamma && <td className={`p-1 tabular-nums text-gray-400 ${ceItm ? "bg-amber-50/60" : ""}`}>{formatGreek(row.ce.gamma, 4)}</td>}
                                            {columns.delta && (
                                                <td className={`p-1 tabular-nums font-mono ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                    {formatGreek(row.ce.delta)}
                                                </td>
                                            )}
                                            {columns.volOi && (
                                                <td className={`p-1 text-right tabular-nums text-gray-500 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                    {formatRatio(row.ce.volume, row.ce.oi)}
                                                </td>
                                            )}
                                            {columns.volume && (
                                                <td
                                                    className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}
                                                    style={heatStyle(row.ce.volume, scale.maxVolume)}
                                                >
                                                    {formatOi(row.ce.volume)}
                                                </td>
                                            )}
                                            {columns.oiChangePercent && (
                                                <td
                                                    className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""} ${
                                                        row.ce.oiChangePercent >= 0 ? "text-emerald-600" : "text-rose-600"
                                                    }`}
                                                >
                                                    {row.ce.oiChangePercent != null ? formatPercent(row.ce.oiChangePercent) : "-"}
                                                </td>
                                            )}
                                            {columns.oiChange && (
                                                <td
                                                    className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}
                                                    style={heatStyle(row.ce.oiChange, scale.maxOiChange)}
                                                >
                                                    {row.ce.oiChange != null ? formatOi(row.ce.oiChange) : "-"}
                                                </td>
                                            )}
                                            {columns.oi && (
                                                <td className={`p-1 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                    <OiBar value={row.ce.oi} max={scale.maxOi} side="ce" />
                                                </td>
                                            )}
                                            <td className={`p-1 ${ceItm ? "bg-amber-50/60" : ""}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => setChartTarget({ strike: row.strike, right: "CE" })}
                                                    title="View candlestick chart"
                                                    className="inline-flex w-full items-center justify-end gap-1 rounded hover:bg-blue-50/70"
                                                >
                                                    {row.ce.ltp == null ? (
                                                        <span title="No trade in this contract — illiquid" className="text-amber-500">⚠</span>
                                                    ) : (
                                                        <ValueWithChange value={row.ce.ltp} change={columns.ltpChangePercent ? row.ce.changePercent : null} />
                                                    )}
                                                </button>
                                            </td>

                                            {/* STRIKE PRICE */}
                                            <td className="p-1 text-center font-bold bg-gray-100 border-x border-gray-200 text-gray-900 text-chain relative min-w-[70px]">
                                                {row.strike}
                                                {isMaxPain && (
                                                    <span className="block text-chain font-bold text-orange-600 leading-tight">Max Pain</span>
                                                )}
                                            </td>

                                            {/* NEUTRAL MIDDLE ZONE — one combined IV per strike (avg of CE/PE IV), plus per-strike PCR */}
                                            {columns.iv && <td className="p-1 text-right tabular-nums text-gray-600">{row.iv ?? "-"}</td>}
                                            {columns.pcr && <td className="p-1 text-right tabular-nums text-gray-600">{formatStrikeRatio(row.pe.oi, row.ce.oi)}</td>}
                                            {columns.pcrVol && <td className="p-1 text-right tabular-nums text-gray-600">{formatStrikeRatio(row.pe.volume, row.ce.volume)}</td>}

                                            {/* PUT SIDE */}
                                            <td className={`p-1 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => setChartTarget({ strike: row.strike, right: "PE" })}
                                                    title="View candlestick chart"
                                                    className="inline-flex w-full items-center justify-start gap-1 rounded hover:bg-blue-50/70"
                                                >
                                                    {row.pe.ltp == null ? (
                                                        <span title="No trade in this contract — illiquid" className="text-amber-500">⚠</span>
                                                    ) : (
                                                        <ValueWithChange value={row.pe.ltp} change={columns.ltpChangePercent ? row.pe.changePercent : null} />
                                                    )}
                                                </button>
                                            </td>
                                            {columns.oi && (
                                                <td className={`p-1 ${peItm ? "bg-amber-50/60" : ""}`}>
                                                    <OiBar value={row.pe.oi} max={scale.maxOi} side="pe" />
                                                </td>
                                            )}
                                            {columns.oiChange && (
                                                <td
                                                    className={`p-1 text-right tabular-nums ${peItm ? "bg-amber-50/60" : ""}`}
                                                    style={heatStyle(row.pe.oiChange, scale.maxOiChange)}
                                                >
                                                    {row.pe.oiChange != null ? formatOi(row.pe.oiChange) : "-"}
                                                </td>
                                            )}
                                            {columns.oiChangePercent && (
                                                <td
                                                    className={`p-1 text-right tabular-nums ${peItm ? "bg-amber-50/60" : ""} ${
                                                        row.pe.oiChangePercent >= 0 ? "text-emerald-600" : "text-rose-600"
                                                    }`}
                                                >
                                                    {row.pe.oiChangePercent != null ? formatPercent(row.pe.oiChangePercent) : "-"}
                                                </td>
                                            )}
                                            {columns.theta && <td className={`p-1 tabular-nums text-gray-400 ${peItm ? "bg-amber-50/60" : ""}`}>{formatGreek(row.pe.theta)}</td>}
                                            {columns.vega && <td className={`p-1 tabular-nums text-gray-400 ${peItm ? "bg-amber-50/60" : ""}`}>{formatGreek(row.pe.vega)}</td>}
                                            {columns.gamma && <td className={`p-1 tabular-nums text-gray-400 ${peItm ? "bg-amber-50/60" : ""}`}>{formatGreek(row.pe.gamma, 4)}</td>}
                                            {columns.delta && (
                                                <td className={`p-1 tabular-nums font-mono ${peItm ? "bg-amber-50/60" : ""}`}>
                                                    {formatGreek(row.pe.delta)}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>

                            {/* Totals Footer */}
                            {totals && (
                                <tfoot className="bg-slate-100 text-chain font-bold border-t-2 border-gray-300 text-right divide-y divide-gray-200">
                                    <tr>
                                        <td colSpan={3} className="p-1.5 text-emerald-700 text-left">ITM Total</td>
                                        <td colSpan={6} className="p-1.5 text-emerald-700">{formatOi(totals.ceItm.oi)}</td>
                                        <td className="bg-gray-200 p-1.5 text-center">ITM</td>
                                        <td colSpan={3} className="p-1.5 text-left text-rose-700">{formatOi(totals.peItm.oi)}</td>
                                        <td colSpan={5} className="p-1.5 text-left text-rose-700">ITM Total</td>
                                    </tr>
                                    <tr>
                                        <td colSpan={3} className="p-1.5 text-gray-600 text-left">OTM Total</td>
                                        <td colSpan={6} className="p-1.5 text-gray-600">{formatOi(totals.ceOtm.oi)}</td>
                                        <td className="bg-gray-200 p-1.5 text-center">OTM</td>
                                        <td colSpan={3} className="p-1.5 text-left text-gray-600">{formatOi(totals.peOtm.oi)}</td>
                                        <td colSpan={5} className="p-1.5 text-left text-gray-600">OTM Total</td>
                                    </tr>
                                    <tr className="bg-slate-200 text-gray-900">
                                        <td colSpan={3} className="p-2 text-left">Grand Total OI</td>
                                        <td colSpan={6} className="p-2 text-sm font-black">{formatOi(totals.totalCeOi)}</td>
                                        <td className="bg-gray-300 p-2 text-center text-chain">TOTALS</td>
                                        <td colSpan={3} className="p-2 text-sm font-black">{formatOi(totals.totalPeOi)}</td>
                                        <td colSpan={5} className="p-2 text-left">Grand Total OI</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>

                    <button
                        onClick={scrollToAtm}
                        className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-gray-900/85 px-3 py-1.5 text-chain font-semibold text-white shadow-lg hover:bg-gray-900"
                    >
                        Go to ATM
                    </button>
                </div>
            ) : (
                loading && <div className="p-12 text-center text-sm text-gray-500">Fetching live matrix feeds...</div>
            )}

            {/* Bottom Content Sections */}
            <hr className="my-8 border-gray-200" />

            {/* Section 1: Options Greeks Explanation */}
            <div className="mb-8">
                <h2 className="mb-4 text-xl font-bold text-gray-800">
                    {symbol === "NIFTY" ? "Nifty 50 (NIFTY)" : symbol} Option Chain: Greeks — Delta, Theta, Gamma, Vega
                </h2>
                <div className="grid gap-6 md:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            What is Delta in the {symbol} option chain?
                        </h3>
                        <p className="text-chain leading-relaxed text-gray-600">
                            Delta measures how much the {symbol} option premium changes when the underlying moves by 1 point. In the {symbol} chain, Delta ranges from 0 to 1 for calls and 0 to -1 for puts. ATM options have Delta near 0.5 — a 1-point {symbol} move changes the premium by about 0.50. Deep ITM options have Delta near 1.0 (moving point-for-point). Far OTM options have Delta near 0 (barely reacting).
                        </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            What is Theta and how it affects {symbol} option prices daily
                        </h3>
                        <p className="text-chain leading-relaxed text-gray-600">
                            Theta is the daily time decay — how much premium the {symbol} option loses each day just from time passing. In the option chain, ATM strikes show the highest Theta because they have the most time value to lose. Theta is always negative for option buyers (you lose money daily) and positive for sellers.
                        </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            What Gamma reveals about {symbol} options near expiry
                        </h3>
                        <p className="text-chain leading-relaxed text-gray-600">
                            Gamma measures how fast Delta changes as {symbol} moves. It is highest for ATM options near expiry. In the {symbol} chain, high Gamma strikes are the most reactive — small underlying moves cause large premium swings. On expiry day, Gamma at ATM {symbol} options can be extremely high.
                        </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h3 className="mb-2 font-bold text-gray-900 text-sm">
                            How Vega in the {symbol} chain helps you trade volatility
                        </h3>
                        <p className="text-chain leading-relaxed text-gray-600">
                            Vega tells you how much premium changes for a 1% change in IV. In the {symbol} option chain, ATM options typically have the highest Vega. If Vega is 10 and IV rises by 2%, the premium increases by Rs. 20 — regardless of what {symbol} price does.
                        </p>
                    </div>
                </div>
            </div>

            {/* Section 2: Intraday Trading Analysis */}
            <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-bold text-gray-800">
                    How to Analyse {symbol === "NIFTY" ? "Nifty 50 (NIFTY)" : symbol} Option Chain for Intraday Trading
                </h2>
                <div className="space-y-4 text-chain">
                    <div className="border-b border-gray-100 pb-3">
                        <h4 className="font-semibold text-gray-900 mb-1">Pre-market preparation</h4>
                        <p className="text-gray-600 leading-relaxed">
                            Before the market opens, check the {symbol} option chain's previous close data. Identify the top 3 call OI strikes (resistance) and top 3 put OI strikes (support). Note the PCR — above 1.0 is bullish bias, below 0.8 is bearish. Check max pain — where is the gravitational pull for expiry?
                        </p>
                    </div>
                    <div className="border-b border-gray-100 pb-3">
                        <h4 className="font-semibold text-gray-900 mb-1">Reading the first 15 minutes</h4>
                        <p className="text-gray-600 leading-relaxed">
                            The opening 15 minutes of the {symbol} option chain are the most information-rich of the day. Watch which strikes show the biggest OI Change — these are institutional orders setting the day's tone. Heavy put writing (Short Buildup at put strikes with rising OI) in the first 15 minutes is bullish.
                        </p>
                    </div>
                    <div className="border-b border-gray-100 pb-3">
                        <h4 className="font-semibold text-gray-900 mb-1">Tracking key levels throughout the session</h4>
                        <p className="text-gray-600 leading-relaxed">
                            During the session, the {symbol} option chain tells you when key levels are under pressure. Watch the OI Change at the highest put OI strike — if it turns negative (OI declining), support is crumbling. Watch the highest call OI strike — if OI drops there, resistance is breaking.
                        </p>
                    </div>
                    <div>
                        <h4 className="font-semibold text-gray-900 mb-1">End-of-day signals</h4>
                        <p className="text-gray-600 leading-relaxed">
                            The last hour (2:30-3:30 PM) is when institutions make their final positioning decisions. OI Change during this period is highly predictive for the next session. If fresh put writing appears in the last hour, institutions are bullish overnight.
                        </p>
                    </div>
                </div>
            </div>

            {/* Section 3: Deep Dive Meta Content */}
            <div className="mb-8 grid gap-6 md:grid-cols-3 text-chain">
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-2">About the NSE Option Chain</h4>
                    <p className="text-gray-600 leading-relaxed">
                        Free real-time and historical option chain with OI, volume, Greeks, and IV for Nifty 50, BankNifty, Sensex, and 200+ F&O stocks. Updates every second in live mode.
                    </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-2">Open Interest in the chain</h4>
                    <p className="text-gray-600 leading-relaxed">
                        Open Interest is the total count of outstanding option contracts. In the NSE chain, every strike has separate OI figures for calls and puts. Rising OI is fresh money entering, falling OI is positions getting squared off.
                    </p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h4 className="font-bold text-gray-900 mb-2">Using the chain for Trading</h4>
                    <p className="text-gray-600 leading-relaxed">
                        Professional traders start the day by scanning the chain for the highest OI strikes on both sides. These define the expected range. If the top Call OI is at 22,500 and top Put OI is at 22,000, the implied range is 22,000-22,500.
                    </p>
                </div>
            </div>

            {/* Section 4: Accordion FAQs */}
            <div className="mb-8">
                <h2 className="mb-4 text-xl font-bold text-gray-800">Frequently Asked Questions</h2>
                <div className="space-y-3">
                    {[
                        {
                            q: "What is an option chain and how do you read it?",
                            a: "An option chain is a matrix listing all available strike prices for a stock or index, along with their corresponding Call and Put premiums, Open Interest (OI), and Volatility metrics. You read it by checking Calls on the left and Puts on the right, mapped directly against the centralized Strike prices."
                        },
                        {
                            q: "What columns matter most in the option chain?",
                            a: "The most vital columns are OI (Open Interest position sizing), Change in OI (intraday smart money positioning), LTP (Last Traded Price), Volume, and the real-time dynamic Buildup indicators."
                        },
                        {
                            q: "How are Greeks calculated in real time?",
                            a: "Greeks are calculated dynamically using the Black-Scholes pricing model, taking into account the live spot index price, option strike, current implied volatility (IV), risk-free interest rates, and exact time left until the final settlement boundary."
                        },
                        {
                            q: "What does open interest tell traders?",
                            a: "Open Interest reveals where option sellers have concentrated their capital risk. Large Call OI concentrations stand as heavy resistance barriers, while heavy Put OI blocks act as structural price floors."
                        }
                    ].map((faq, index) => (
                        <details key={index} className="group rounded-lg border border-gray-200 bg-white p-4 [&_summary::-webkit-details-marker]:hidden">
                            <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                                <span className="text-chain font-semibold text-gray-900">{faq.q}</span>
                                <span className="transition group-open:-rotate-180 text-gray-400 text-chain">▼</span>
                            </summary>
                            <p className="mt-3 text-chain leading-relaxed text-gray-600 border-t border-gray-100 pt-3">
                                {faq.a}
                            </p>
                        </details>
                    ))}
                </div>
            </div>

            {/* Section 5: Related Tools */}
            <div className="mb-12">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Related Tools</h3>
                <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 text-chain">
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">Max Pain</span>
                        <span className="text-chain text-gray-400">Where option sellers have minimum loss</span>
                    </div>
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">Open Interest</span>
                        <span className="text-chain text-gray-400">Call vs Put OI buildup matrix</span>
                    </div>
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">Put Call Ratio</span>
                        <span className="text-chain text-gray-400">Market sentiment tracker via PCR</span>
                    </div>
                    <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
                        <span className="font-bold block text-gray-800">IV Chart</span>
                        <span className="text-chain text-gray-400">Implied volatility scaling trends</span>
                    </div>
                </div>
            </div>
        </div>
    );
}