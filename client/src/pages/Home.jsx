// pages/Home.jsx — landing page, structured after stockmojo.in's homepage
// layout (Popular Tools row, All Trading Tools grid, About section, footer)
// per the reference screenshots, but with Bazaar Sync's own branding/copy
// and only linking to tools that actually exist in this app — StockMojo's
// real homepage lists 25+ tools (Sector Rotation, Smart OI, Gamma Exposure,
// FII/DII flow, etc.) that we haven't built, so those are intentionally not
// reproduced here rather than linking to pages that don't exist.
import { Link } from "react-router-dom";
import ToolIcon from "../components/ToolIcon";

const TOOLS = [
    { to: "/option-chain", title: "Option Chain", icon: "chain", desc: "Full chain with OI, buildup, Greeks" },
    { to: "/strategy-builder", title: "Strategy Builder", icon: "strategy", desc: "Multi-leg payoff + live Greeks" },
    { to: "/simulator", title: "Simulator", icon: "backtest", desc: "Replay a real past day minute by minute" },
    { to: "/max-pain", title: "Max Pain", icon: "maxpain", desc: "Option-writer payout by strike" },
    { to: "/put-call-ratio", title: "Put-Call Ratio", icon: "pcr", desc: "PCR vs spot, OI trend" },
    { to: "/iv-chart", title: "IV Chart", icon: "iv", desc: "IV smile + ATM IV trend" },
    { to: "/straddle-chart", title: "Straddle Chart", icon: "straddle", desc: "ATM straddle cost vs spot" },
    { to: "/oi-heatmap", title: "OI Heatmap", icon: "heatmap", desc: "Call vs Put OI by strike" },
    { to: "/backtest", title: "Backtest", icon: "backtest", desc: "Simulate strategies on real history" },
];

const POPULAR = ["/option-chain", "/strategy-builder", "/straddle-chart", "/max-pain", "/oi-heatmap"];

function SectionHeading({ children }) {
    return (
        <div className="mb-4 flex items-center gap-2">
            <span className="h-5 w-1 rounded bg-blue-600" />
            <h2 className="text-base font-bold text-gray-900">{children}</h2>
        </div>
    );
}

function ToolCard({ to, title, icon, desc, big }) {
    return (
        <Link
            to={to}
            className="group block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-blue-300 hover:shadow-md"
        >
            <div className={`flex items-center justify-center bg-gray-50 px-4 ${big ? "h-32" : "h-20"}`}>
                <ToolIcon name={icon} />
            </div>
            <div className="border-t border-gray-100 px-4 py-3">
                <div className="text-sm font-semibold text-gray-900 group-hover:text-blue-600">{title}</div>
                {desc && <div className="mt-0.5 text-xs text-gray-500">{desc}</div>}
            </div>
        </Link>
    );
}

export default function Home() {
    const popularTools = POPULAR.map((to) => TOOLS.find((t) => t.to === to)).filter(Boolean);

    return (
        <div className="mx-auto max-w-[1400px] px-6 py-8">
            <section className="mb-10">
                <SectionHeading>Popular Tools</SectionHeading>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                    {popularTools.map((t) => (
                        <ToolCard key={t.to} {...t} big />
                    ))}
                </div>
            </section>

            <section className="mb-10">
                <SectionHeading>All Trading Tools</SectionHeading>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {TOOLS.map((t) => (
                        <ToolCard key={t.to} {...t} />
                    ))}
                </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-3 text-lg font-bold text-gray-900">About Bazaar Sync</h2>
                <p className="mb-3 text-sm leading-relaxed text-gray-600">
                    Bazaar Sync is an options analytics and backtesting platform built for NSE F&amp;O traders.
                    It turns Nifty, BankNifty and FinNifty options data into the live dashboards and strategy
                    tools you'd otherwise have to build yourself in a spreadsheet.
                </p>
                <h3 className="mb-1 mt-4 text-sm font-bold text-gray-900">Core tools</h3>
                <p className="mb-3 text-sm leading-relaxed text-gray-600">
                    Live <Link to="/option-chain" className="text-blue-600 hover:underline">Option Chain</Link>,{" "}
                    <Link to="/max-pain" className="text-blue-600 hover:underline">Max Pain</Link>,{" "}
                    <Link to="/oi-heatmap" className="text-blue-600 hover:underline">OI Heatmap</Link> and{" "}
                    <Link to="/put-call-ratio" className="text-blue-600 hover:underline">Put-Call Ratio</Link> for
                    reading where the market is positioned. <Link to="/iv-chart" className="text-blue-600 hover:underline">IV Chart</Link> and{" "}
                    <Link to="/straddle-chart" className="text-blue-600 hover:underline">Straddle Chart</Link> for
                    volatility and premium. IV and Greeks (delta, gamma, theta, vega) are computed with our own
                    Black-Scholes engine, since the broker feed doesn't provide them.
                </p>
                <h3 className="mb-1 mt-4 text-sm font-bold text-gray-900">Strategy building and backtesting</h3>
                <p className="mb-3 text-sm leading-relaxed text-gray-600">
                    The <Link to="/strategy-builder" className="text-blue-600 hover:underline">Strategy Builder</Link> lets
                    you build multi-leg positions from the live chain, see the payoff diagram, breakevens and net
                    Greeks in real time, and start from ready-made templates like Iron Condor or Straddle. The{" "}
                    <Link to="/backtest" className="text-blue-600 hover:underline">Backtest</Link> engine replays a
                    strategy against real stored historical data, never live prices, so results don't move under you.
                </p>
                <h3 className="mb-1 mt-4 text-sm font-bold text-gray-900">Who it's for</h3>
                <p className="text-sm leading-relaxed text-gray-600">
                    Active NSE options traders who want live index and options analytics without a Bloomberg
                    terminal, and anyone who wants to test a strategy against real history before risking capital
                    on it.
                </p>
            </section>

            <footer className="mt-12 border-t border-gray-200 pt-8 text-sm text-gray-500">
                <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
                    <div>
                        <div className="flex items-center gap-1 text-base font-bold">
                            <span className="text-blue-600">Bazaar</span>
                            <span className="text-gray-900">Sync</span>
                        </div>
                        <div className="mt-2">Made in India</div>
                        <div className="mt-1">
                            Built by{" "}
                            <a href="https://nikhilworks.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                NikhilWorks
                            </a>
                        </div>
                    </div>
                    <div>
                        <div className="mb-2 font-semibold text-gray-900">Tools</div>
                        <ul className="space-y-1.5">
                            {TOOLS.map((t) => (
                                <li key={t.to}>
                                    <Link to={t.to} className="hover:text-blue-600">{t.title}</Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <div className="mb-2 font-semibold text-gray-900">Account</div>
                        <ul className="space-y-1.5">
                            <li><Link to="/login" className="hover:text-blue-600">Log in / Sign up</Link></li>
                        </ul>
                    </div>
                </div>
                <div className="mt-8 border-t border-gray-100 pt-4 text-xs text-gray-400">
                    © {new Date().getFullYear()} Bazaar Sync. All rights reserved.
                </div>
            </footer>
        </div>
    );
}
