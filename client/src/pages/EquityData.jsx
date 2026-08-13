// pages/EquityData.jsx — shared placeholder for every Equity Data submenu
// item (sector rotation, sector performance, market map, 52-week high/low,
// industry momentum, most active). One dynamic route instead of 6 nearly
// identical files; each becomes a real page in a later phase once a data
// source for these (none of them come from Angel One) is decided.
import { useParams } from "react-router-dom";

const TOOLS = {
    "sector-rotation": {
        title: "Sector Rotation",
        desc: "See which sectors are gaining or losing relative strength over time.",
    },
    "sector-performance": {
        title: "Sector Performance",
        desc: "Compare sector-wise returns across timeframes.",
    },
    "market-map": {
        title: "Market Map",
        desc: "A heatmap of stock performance across the market, sized by market cap.",
    },
    "52-week-high-low": {
        title: "52 Week High/Low",
        desc: "Stocks currently trading near their 52-week highs or lows.",
    },
    "industry-momentum": {
        title: "Industry Momentum Stocks",
        desc: "Momentum ranking of stocks within their industry group.",
    },
    "most-active": {
        title: "Most Active",
        desc: "Stocks with the highest traded volume/value today.",
    },
};

export default function EquityData() {
    const { tool } = useParams();
    const meta = TOOLS[tool];

    if (!meta) {
        return (
            <div className="mx-auto max-w-3xl px-6 py-16 text-center">
                <h1 className="text-xl font-bold text-gray-900">Equity Data</h1>
                <p className="mt-2 text-sm text-gray-500">Pick a tool from the Equity Data menu above.</p>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl px-6 py-16 text-center">
            <h1 className="text-xl font-bold text-gray-900">{meta.title}</h1>
            <p className="mt-2 text-sm text-gray-500">{meta.desc}</p>
            <div className="mt-6 inline-block rounded-full bg-amber-100 px-4 py-1.5 text-xs font-semibold text-amber-700">
                Coming soon
            </div>
        </div>
    );
}
