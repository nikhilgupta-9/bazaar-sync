import React from "react";
// pages/EquityData.jsx — Equity Data Hub Container supporting Market Map, 52W High/Low, Industry Momentum, and Most Active
import { useParams, NavLink, Navigate } from "react-router-dom";
import MarketMap from "./equity/MarketMap";
import FiftyTwoWeekHighLow from "./equity/FiftyTwoWeekHighLow";
import IndustryMomentum from "./equity/IndustryMomentum";
import MostActive from "./equity/MostActive";
import { FiGrid, FiActivity, FiTrendingUp, FiBarChart2 } from "react-icons/fi";

const TABS = [
    { key: "market-map", label: "Market Map", icon: FiGrid },
    { key: "52-week-high-low", label: "52-Week High/Low", icon: FiActivity },
    { key: "industry-momentum", label: "Industry Momentum", icon: FiTrendingUp },
    { key: "most-active", label: "High Activity Options", icon: FiBarChart2 },
];

export default function EquityData() {
    const { tool } = useParams();

    // Default redirect to market-map if no specific tool path or on root
    if (!tool) {
        return <Navigate to="/equity-data/market-map" replace />;
    }

    return (
        <div className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-6 sm:py-6">
            {/* Top Navigation Tabs */}
            <div className="-mx-3 mb-5 flex items-center gap-2 overflow-x-auto border-b border-gray-200 px-3 pb-3 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 dark:border-gray-800">
                {TABS.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = tool === tab.key;
                    return (
                        <NavLink
                            key={tab.key}
                            to={`/equity-data/${tab.key}`}
                            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-xs font-semibold transition ${
                                isActive
                                    ? "bg-emerald-600 text-white shadow-xs"
                                    : "bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-800"
                            }`}
                        >
                            <Icon size={15} />
                            <span>{tab.label}</span>
                        </NavLink>
                    );
                })}

                <div className="ml-auto flex shrink-0 items-center gap-2">
                    <NavLink
                        to="/equity-data/sector-performance"
                        className="whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                        Sector Performance
                    </NavLink>
                    <NavLink
                        to="/equity-data/sector-rotation"
                        className="whitespace-nowrap rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                        Sector Rotation (RRG)
                    </NavLink>
                </div>
            </div>

            {/* Active Sub-Tool Rendering */}
            {tool === "market-map" && <MarketMap />}
            {tool === "52-week-high-low" && <FiftyTwoWeekHighLow />}
            {tool === "industry-momentum" && <IndustryMomentum />}
            {tool === "most-active" && <MostActive />}
            {!["market-map", "52-week-high-low", "industry-momentum", "most-active"].includes(tool) && (
                <Navigate to="/equity-data/market-map" replace />
            )}
        </div>
    );
}
