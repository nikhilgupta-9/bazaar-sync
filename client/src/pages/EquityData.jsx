import React from "react";
// pages/EquityData.jsx — Equity Data Hub Container supporting Market Map, 52W High/Low, Industry Momentum, and Most Active
import { useParams, Navigate } from "react-router-dom";
import MarketMap from "./equity/MarketMap";
import FiftyTwoWeekHighLow from "./equity/FiftyTwoWeekHighLow";
import IndustryMomentum from "./equity/IndustryMomentum";
import MostActive from "./equity/MostActive";

export default function EquityData() {
    const { tool } = useParams();

    // Default redirect to market-map if no specific tool path or on root
    if (!tool) {
        return <Navigate to="/equity-data/market-map" replace />;
    }

    return (
        <div className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-6 sm:py-6">
            {/* Tool switching lives in the top nav's "Equity Data" dropdown — no duplicate tab bar here */}

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
