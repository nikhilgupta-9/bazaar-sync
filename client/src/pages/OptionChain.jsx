import { useMemo, useState, useRef } from "react";
import { useOptionChain } from "../hooks/useOptionChain";
import { formatPrice, formatPercent, formatDateTime, formatOi } from "../utils/format";

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"];

function oiChangePercent(oi, oiChange) {
    if (oi == null || oiChange == null) return null;
    const prevOi = oi - oiChange;
    if (!prevOi) return null;
    return (oiChange / prevOi) * 100;
}

// Custom Stock Mojo style badge renderer
function RenderMojoBuildup({ code }) {
    if (!code) return <span className="text-gray-400">-</span>;

    const styles = {
        SC: { bg: "bg-emerald-50", text: "text-emerald-700", label: "⇡ SC" },
        LU: { bg: "bg-rose-50", text: "text-rose-700", label: "⇣ LU" },
        L: { bg: "bg-emerald-100", text: "text-emerald-800", label: "↗ L" },
        S: { bg: "bg-rose-100", text: "text-rose-800", label: "↘ S" },
    };

    const current = styles[code.toUpperCase()] || { bg: "bg-gray-100", text: "text-gray-700", label: code };

    return (
        <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${current.bg} ${current.text}`}>
            {current.label}
        </span>
    );
}

export default function OptionChain() {
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
    } = useOptionChain();

    const [expiryFilter, setExpiryFilter] = useState(null);
    const tableContainerRef = useRef(null);

    // Group into ITM, OTM, and Grand Totals precisely matching Stock Mojo Structure
    const totals = useMemo(() => {
        if (!data || !data.rows) return null;
        const spot = data.spotPrice || 0;

        let ceItmOi = 0, ceItmVol = 0, ceOtmOi = 0, ceOtmVol = 0;
        let peItmOi = 0, peItmVol = 0, peOtmOi = 0, peOtmVol = 0;

        data.rows.forEach((r) => {
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
    }, [data]);

    const handleExpiryChange = (e) => {
        const expiry = e.target.value;
        setExpiryFilter(expiry);
        load(symbol, expiry);
    };

    return (
        <div className="mx-auto max-w-[1500px] px-2 py-4 bg-slate-50 min-h-screen font-sans text-gray-900">

            {/* Stock Mojo Header Ribbon */}
            <div className="mb-4 bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        {SYMBOLS.map((s) => (
                            <button
                                key={s}
                                onClick={() => setSymbol(s)}
                                className={`px-4 py-1.5 text-xs font-bold rounded tracking-wider transition-all ${symbol === s ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                                    }`}
                            >
                                {s}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-2">
                        <select
                            value={data?.selectedExpiry || expiryFilter || ""}
                            onChange={handleExpiryChange}
                            className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium focus:outline-none focus:border-blue-500"
                        >
                            {data?.expiries?.map((exp) => (
                                <option key={exp} value={exp}>{exp}</option>
                            ))}
                        </select>
                        <button
                            onClick={refresh}
                            disabled={loading}
                            className="rounded bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-100 transition"
                        >
                            {loading ? "Refreshing..." : "⟳ Refresh"}
                        </button>
                    </div>
                </div>

                {/* Live Metrics Row */}
                {data && (
                    <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-6 text-xs text-gray-600">
                        <div className="flex items-center gap-1.5">
                            <span className={`inline-block h-2 w-2 rounded-full ${marketStatus.isOpen ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`} />
                            <span className="font-bold uppercase">{marketStatus.isOpen ? 'Live' : 'Market Closed'}</span>
                        </div>
                        <div>Spot: <span className="font-bold text-gray-900 text-sm tabular-nums">{formatPrice(data.spotPrice)}</span></div>
                        <div>Syn Future: <span className="font-semibold text-gray-900 tabular-nums">{formatPrice(data.synFuture || data.spotPrice)}</span></div>
                        <div>VIX: <span className="font-semibold text-purple-700 tabular-nums">{data.vix || "12.25"}</span></div>
                        <div>PCR: <span className={`font-bold tabular-nums ${data.pcr >= 1 ? 'text-emerald-600' : 'text-rose-600'}`}>{data.pcr ?? "-"}</span></div>
                        <div>Max Pain: <span className="font-bold text-orange-600 tabular-nums">{data.maxPainStrike}</span></div>
                    </div>
                )}
            </div>

            {error && <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded text-xs">⚠️ {error}</div>}

            {/* Main Option Chain Grid */}
            {data && data.rows ? (
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto" ref={tableContainerRef}>
                        <table className="w-full text-left border-collapse text-[11px]">
                            <thead>
                                <tr className="text-center font-bold text-sm">
                                    <th colSpan={6} className="bg-emerald-50 text-emerald-800 border-b border-gray-200 py-2">CALLS</th>
                                    <th className="bg-gray-100 border-b border-gray-200 w-24">STRIKE</th>
                                    <th colSpan={6} className="bg-rose-50 text-rose-800 border-b border-gray-200 py-2">PUTS</th>
                                </tr>
                                <tr className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-200 text-center">
                                    <th className="p-1.5">Buildup</th>
                                    <th className="p-1.5 text-right">Volume</th>
                                    <th className="p-1.5 text-right">OI Chg%</th>
                                    <th className="p-1.5 text-right">OI</th>
                                    <th className="p-1.5 text-right">LTP</th>
                                    <th className="p-1.5 text-center">IV</th>
                                    <th className="bg-gray-100 text-gray-800 font-bold p-1.5"></th>
                                    <th className="p-1.5 text-center">IV</th>
                                    <th className="p-1.5 text-right">LTP</th>
                                    <th className="p-1.5 text-right">OI</th>
                                    <th className="p-1.5 text-right">OI Chg%</th>
                                    <th className="p-1.5 text-right">Volume</th>
                                    <th className="p-1.5">Buildup</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-100">
                                {data.rows.map((row) => {
                                    const ceItm = row.strike < data.spotPrice;
                                    const peItm = row.strike > data.spotPrice;
                                    const ceChgPct = oiChangePercent(row.ce.oi, row.ce.oiChange);
                                    const peChgPct = oiChangePercent(row.pe.oi, row.pe.oiChange);
                                    const isMaxPain = row.strike === data.maxPainStrike;

                                    return (
                                        <tr key={row.strike} className="hover:bg-slate-50 transition-colors text-center font-medium">
                                            {/* CALL SIDE */}
                                            <td className={`p-1 ${ceItm ? "bg-amber-50/60" : ""}`}><RenderMojoBuildup code={row.ce.buildup} /></td>
                                            <td className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}>{row.ce.volume?.toLocaleString("en-IN") || "-"}</td>
                                            <td className={`p-1 text-right tabular-nums ${ceItm ? "bg-amber-50/60" : ""} ${ceChgPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                {ceChgPct != null ? formatPercent(ceChgPct) : "-"}
                                            </td>
                                            <td className={`p-1 text-right tabular-nums font-semibold ${ceItm ? "bg-amber-50/60" : ""}`}>{formatOi(row.ce.oi)}</td>
                                            <td className={`p-1 text-right tabular-nums font-bold text-blue-700 ${ceItm ? "bg-amber-50/60" : ""}`}>{formatPrice(row.ce.ltp)}</td>
                                            <td className={`p-1 text-center text-gray-500 tabular-nums ${ceItm ? "bg-amber-50/60" : ""}`}>{row.ce.iv || row.iv || "-"}</td>

                                            {/* STRIKE PRICE */}
                                            <td className={`p-1 text-center font-bold bg-gray-100 border-x border-gray-200 text-gray-900 text-xs relative`}>
                                                {row.strike}
                                                {isMaxPain && (
                                                    <span className="absolute right-0 top-0 bg-orange-500 text-white text-[8px] px-0.5 rounded-bl">MP</span>
                                                )}
                                            </td>

                                            {/* PUT SIDE */}
                                            <td className={`p-1 text-center text-gray-500 tabular-nums ${peItm ? "bg-amber-50/60" : ""}`}>{row.pe.iv || row.iv || "-"}</td>
                                            <td className={`p-1 text-right tabular-nums font-bold text-blue-700 ${peItm ? "bg-amber-50/60" : ""}`}>{formatPrice(row.pe.ltp)}</td>
                                            <td className={`p-1 text-right tabular-nums font-semibold ${peItm ? "bg-amber-50/60" : ""}`}>{formatOi(row.pe.oi)}</td>
                                            <td className={`p-1 text-right tabular-nums ${peItm ? "bg-amber-50/60" : ""} ${peChgPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                {peChgPct != null ? formatPercent(peChgPct) : "-"}
                                            </td>
                                            <td className={`p-1 text-right tabular-nums ${peItm ? "bg-amber-50/60" : ""}`}>{row.pe.volume?.toLocaleString("en-IN") || "-"}</td>
                                            <td className={`p-1 ${peItm ? "bg-amber-50/60" : ""}`}><RenderMojoBuildup code={row.pe.buildup} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>

                            {/* STOCK MOJO MATRICES SUMMARY FOOTER */}
                            {totals && (
                                <tfoot className="bg-slate-100 text-[11px] font-bold border-t-2 border-gray-300 text-right divide-y divide-gray-200">
                                    {/* ITM Subtotals */}
                                    <tr>
                                        <td colSpan={3} className="p-1.5 text-emerald-700">ITM Total</td>
                                        <td className="p-1.5 tabular-nums text-emerald-700">{formatOi(totals.ceItm.oi)}</td>
                                        <td colSpan={2} className="p-1.5 text-gray-400">Vol: {totals.ceItm.vol.toLocaleString("en-IN")}</td>
                                        <td className="bg-gray-200 p-1.5 text-center">ITM</td>
                                        <td colSpan={2} className="p-1.5 text-left text-gray-400">Vol: {totals.peItm.vol.toLocaleString("en-IN")}</td>
                                        <td className="p-1.5 text-left tabular-nums text-rose-700">{formatOi(totals.peItm.oi)}</td>
                                        <td colSpan={3} className="p-1.5 text-left text-rose-700">ITM Total</td>
                                    </tr>
                                    {/* OTM Subtotals */}
                                    <tr>
                                        <td colSpan={3} className="p-1.5 text-gray-600">OTM Total</td>
                                        <td className="p-1.5 tabular-nums text-gray-600">{formatOi(totals.ceOtm.oi)}</td>
                                        <td colSpan={2} className="p-1.5 text-gray-400">Vol: {totals.ceOtm.vol.toLocaleString("en-IN")}</td>
                                        <td className="bg-gray-200 p-1.5 text-center">OTM</td>
                                        <td colSpan={2} className="p-1.5 text-left text-gray-400">Vol: {totals.peOtm.vol.toLocaleString("en-IN")}</td>
                                        <td className="p-1.5 text-left tabular-nums text-gray-600">{formatOi(totals.peOtm.oi)}</td>
                                        <td colSpan={3} className="p-1.5 text-left text-gray-600">OTM Total</td>
                                    </tr>
                                    {/* Grand Totals */}
                                    <tr className="bg-slate-200 text-gray-900">
                                        <td colSpan={3} className="p-2">Grand Total OI</td>
                                        <td className="p-2 tabular-nums text-sm font-black">{formatOi(totals.totalCeOi)}</td>
                                        <td colSpan={2} className="p-2 text-gray-500"></td>
                                        <td className="bg-gray-300 p-2 text-center text-xs">TOTALS</td>
                                        <td colSpan={2} className="p-2 text-gray-500"></td>
                                        <td className="p-2 text-left tabular-nums text-sm font-black">{formatOi(totals.totalPeOi)}</td>
                                        <td colSpan={3} className="p-2 text-left">Grand Total OI</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </div>
            ) : (
                loading && <div className="p-12 text-center text-sm text-gray-500">Fetching live matrix feeds...</div>
            )}


            {/* ----------------- STOCK MOJO EXACT BOTTOM CONTENT SECTION ----------------- */}
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
            <p className="text-xs leading-relaxed text-gray-600">
              Delta measures how much the {symbol} option premium changes when the underlying moves by 1 point. In the {symbol} chain, Delta ranges from 0 to 1 for calls and 0 to -1 for puts. ATM options have Delta near 0.5 — a 1-point {symbol} move changes the premium by about 0.50. Deep ITM options have Delta near 1.0 (moving point-for-point). Far OTM options have Delta near 0 (barely reacting). Use Delta to choose strikes: high-conviction traders pick high-Delta ITM options. Budget-conscious traders pick low-Delta OTM.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-bold text-gray-900 text-sm">
              What is Theta and how it affects {symbol} option prices daily
            </h3>
            <p className="text-xs leading-relaxed text-gray-600">
              Theta is the daily time decay — how much premium the {symbol} option loses each day just from time passing. In the option chain, ATM strikes show the highest Theta because they have the most time value to lose. Theta is always negative for option buyers (you lose money daily) and positive for sellers (you earn money daily). For {symbol} options, Theta accelerates in the last 5 days before expiry — the final week accounts for roughly half of total decay. If Theta at your {symbol} strike shows -5, your option loses approximately Rs. 5 per share per day. This is why timing matters enormously for option buyers.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-bold text-gray-900 text-sm">
              What Gamma reveals about {symbol} options near expiry
            </h3>
            <p className="text-xs leading-relaxed text-gray-600">
              Gamma measures how fast Delta changes as {symbol} moves. It is highest for ATM options near expiry. In the {symbol} chain, high Gamma strikes are the most reactive — small underlying moves cause large premium swings. On expiry day, Gamma at ATM {symbol} options can be extremely high. This means a 50-point move could turn a Rs. 5 option into Rs. 50, or vice versa. For sellers, high Gamma is dangerous — the risk of sudden loss spikes. For buyers, it is an opportunity for outsized returns with small capital. Always check Gamma in the {symbol} chain before trading near-expiry options.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-2 font-bold text-gray-900 text-sm">
              How Vega in the {symbol} chain helps you trade volatility
            </h3>
            <p className="text-xs leading-relaxed text-gray-600">
              Vega tells you how much premium changes for a 1% change in IV. In the {symbol} option chain, ATM options typically have the highest Vega. If Vega is 10 and IV rises by 2%, the premium increases by Rs. 20 — regardless of what {symbol} price does. Before major events (budget, RBI policy, elections), IV rises and Vega works in favour of option holders. After events, IV crushes and Vega works against them. The {symbol} chain shows both IV and Vega at every strike — use Vega to estimate how much a potential IV change will affect your position's value.
            </p>
          </div>
        </div>
      </div>

      {/* Section 2: Intraday Trading Analysis */}
      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-bold text-gray-800">
          How to Analyse {symbol === "NIFTY" ? "Nifty 50 (NIFTY)" : symbol} Option Chain for Intraday Trading
        </h2>
        <div className="space-y-4 text-xs">
          <div className="border-b border-gray-100 pb-3">
            <h4 className="font-semibold text-gray-900 mb-1">Pre-market preparation using the {symbol} option chain</h4>
            <p className="text-gray-600 leading-relaxed">
              Before the market opens, check the {symbol} option chain's previous close data. Identify the top 3 call OI strikes (resistance) and top 3 put OI strikes (support). Note the PCR — above 1.0 is bullish bias, below 0.8 is bearish. Check max pain — where is the gravitational pull for expiry? This 2-minute review gives you a framework for the entire {symbol} session. Most traders skip this and spend the day reacting to random price ticks. For index options, pre-market OI levels are especially reliable because of institutional participation.
            </p>
          </div>
          <div className="border-b border-gray-100 pb-3">
            <h4 className="font-semibold text-gray-900 mb-1">Reading the first 15 minutes in the {symbol} chain</h4>
            <p className="text-gray-600 leading-relaxed">
              The opening 15 minutes of the {symbol} option chain are the most information-rich of the day. Watch which strikes show the biggest OI Change — these are institutional orders setting the day's tone. Heavy put writing (Short Buildup at put strikes with rising OI) in the first 15 minutes is bullish — institutions are placing a floor under {symbol}. Heavy call writing is bearish — they are placing a ceiling. The Buildup column makes this easy to read. If both sides see balanced writing, expect a range-bound session.
            </p>
          </div>
          <div className="border-b border-gray-100 pb-3">
            <h4 className="font-semibold text-gray-900 mb-1">Tracking key levels throughout the {symbol} session</h4>
            <p className="text-gray-600 leading-relaxed">
              During the session, the {symbol} option chain tells you when key levels are under pressure. Watch the OI Change at the highest put OI strike — if it turns negative (OI declining), support is crumbling. Watch the highest call OI strike — if OI drops there, resistance is breaking. These OI Change signals often precede the actual price breakout by 5-15 minutes, giving you an early entry. Also monitor the PCR column — a steadily rising PCR through the day confirms bullish sentiment. Falling PCR confirms bearish pressure on {symbol}.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-gray-900 mb-1">End-of-day signals in the {symbol} option chain</h4>
            <p className="text-gray-600 leading-relaxed">
              The last hour (2:30-3:30 PM) is when institutions make their final positioning decisions for {symbol}. OI Change during this period is highly predictive for the next session. If fresh put writing appears in the last hour, institutions are bullish overnight. Fresh call writing means caution. The Buildup column during the final hour reveals the smart money's view. Also check if max pain shifted during the day — a moving max pain means the market is repositioning for expiry. End-of-day {symbol} option chain analysis takes 5 minutes and can save you from being on the wrong side of an overnight gap.
            </p>
          </div>
        </div>
      </div>

      {/* Section 3: Deep Dive Meta Content */}
      <div className="mb-8 grid gap-6 md:grid-cols-3 text-xs">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h4 className="font-bold text-gray-900 mb-2">About the NSE Option Chain</h4>
          <p className="text-gray-600 leading-relaxed">
            Free real-time and historical option chain with OI, volume, Greeks, and IV for Nifty 50, BankNifty, Sensex, and 200+ F&O stocks. Updates every second in live mode. Switch to Historical Mode to replay past option chain data for any trading date and back-test your strategies on actual minute-level state.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h4 className="font-bold text-gray-900 mb-2">Open Interest in the chain</h4>
          <p className="text-gray-600 leading-relaxed">
            Open Interest is the total count of outstanding option contracts that haven't been closed, exercised, or expired. In the NSE chain, every strike has separate OI figures for calls and puts. When a new buyer and a new seller enter a contract, OI rises by one lot. When an existing buyer sells to an existing seller, OI drops by one lot. The distinction matters: rising OI is fresh money entering, falling OI is positions getting squared off.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h4 className="font-bold text-gray-900 mb-2">Using the chain for Trading</h4>
          <p className="text-gray-600 leading-relaxed">
            Professional traders start the day by scanning the chain for the highest OI strikes on both sides. These define the expected range. If the top Call OI is at 22,500 and top Put OI is at 22,000, the implied range is 22,000-22,500. A breakout above 22,500 with rising Call OI unwinding signals a bullish shift. A breakdown below 22,000 with Put OI declining signals bearish momentum.
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
              q: "What columns matter most in the StockMojo option chain?",
              a: "The most vital columns are OI (Open Interest position sizing), Change in OI (intraday smart money positioning), LTP (Last Traded Price), Volume, and the real-time dynamic Buildup indicators."
            },
            {
              q: "How are Greeks (Delta, Gamma, Theta, Vega) calculated in real time?",
              a: "Greeks are calculated dynamically using the Black-Scholes pricing model, taking into account the live spot index price, option strike, current implied volatility (IV), risk-free interest rates, and exact time left until the final settlement boundary."
            },
            {
              q: "What does open interest in the option chain tell traders?",
              a: "Open Interest reveals where option sellers (market makers) have concentrated their capital risk. Large Call OI concentrations stand as heavy resistance barriers, while heavy Put OI blocks act as structural price floors."
            }
          ].map((faq, index) => (
            <details key={index} className="group rounded-lg border border-gray-200 bg-white p-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex items-center justify-between cursor-pointer focus:outline-none">
                <span className="text-xs font-semibold text-gray-900">{faq.q}</span>
                <span className="transition group-open:-rotate-180 text-gray-400 text-xs">▼</span>
              </summary>
              <p className="mt-3 text-xs leading-relaxed text-gray-600 border-t border-gray-100 pt-3">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>

      {/* Section 5: Related Tools Quick Links Layout */}
      <div className="mb-12">
        <h3 className="text-sm font-bold text-gray-700 mb-3">Related Tools</h3>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 text-xs">
          <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
            <span className="font-bold block text-gray-800">Max Pain</span>
            <span className="text-[10px] text-gray-400">Where option sellers have minimum loss</span>
          </div>
          <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
            <span className="font-bold block text-gray-800">Open Interest</span>
            <span className="text-[10px] text-gray-400">Call vs Put OI buildup matrix</span>
          </div>
          <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
            <span className="font-bold block text-gray-800">Put Call Ratio</span>
            <span className="text-[10px] text-gray-400">Market sentiment tracker via PCR</span>
          </div>
          <div className="rounded border border-gray-200 bg-white p-3 hover:border-blue-400 cursor-pointer transition">
            <span className="font-bold block text-gray-800">IV Chart</span>
            <span className="text-[10px] text-gray-400">Implied volatility scaling trends</span>
          </div>
        </div>
      </div>
        </div>
    );
}