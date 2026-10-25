import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import TopNav from "./components/TopNav";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import OptionChain from "./pages/OptionChain";
import StrategyBuilder from "./pages/StrategyBuilder";
import CryptoStrategyBuilder from "./pages/CryptoStrategyBuilder";
import Simulator from "./pages/Simulator";
import PaperTrade from "./pages/PaperTrade";
import HistoricalChart from "./pages/HistoricalChart";
import EquityData from "./pages/EquityData";
import SectorRotation from "./pages/SectorRotation";
import SectorPerformance from "./pages/SectorPerformance";
import Pricing from "./pages/Pricing";
import EventsPage from "./pages/Events";
import Terms from "./pages/Terms";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Profile from "./pages/Profile";
import { usePageSeo } from "./hooks/usePageSeo";

function App() {
    usePageSeo();
    const location = useLocation();
    const isChartPage = location.pathname.startsWith("/historical-chart");
    const isStrategyBuilderPage = location.pathname.startsWith("/strategy-builder");
    const isOptionChainPage = location.pathname.startsWith("/option-chain");
    const hideFooter = isChartPage || isStrategyBuilderPage || isOptionChainPage;

    return (
        <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900 transition-colors dark:bg-[#0b1420] dark:text-gray-100">
            <TopNav />
            <div className="flex-1 flex flex-col">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/option-chain" element={<Navigate to="/option-chain/nifty" replace />} />
                    <Route path="/option-chain/:symbol" element={<OptionChain />} />
                    <Route path="/option-chain/crypto" element={<Navigate to="/option-chain/crypto/btc" replace />} />
                    <Route path="/option-chain/crypto/:coin" element={<OptionChain />} />
                    <Route path="/strategy-builder" element={<StrategyBuilder />} />
                    <Route path="/strategy-builder/crypto" element={<CryptoStrategyBuilder />} />
                    <Route path="/simulator" element={<Simulator />} />
                    {/* Crypto backtester = the crypto Strategy Builder in historical-replay mode (real Delta Exchange history) */}
                    <Route path="/simulator/crypto" element={<CryptoStrategyBuilder key="historical" historical />} />
                    <Route path="/simulator/bitcoin" element={<Navigate to="/simulator/crypto" replace />} />
                    <Route path="/paper-trade" element={<PaperTrade />} />
                    <Route path="/historical-chart" element={<HistoricalChart />} />
                    <Route path="/equity-data" element={<EquityData />} />
                    <Route path="/equity-data/sector-rotation" element={<SectorRotation />} />
                    <Route path="/equity-data/sector-performance" element={<SectorPerformance />} />
                    <Route path="/equity-data/:tool" element={<EquityData />} />
                    <Route path="/pricing" element={<Pricing />} />
                    <Route path="/events" element={<EventsPage />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                    <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
                    <Route path="/login" element={<Auth />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="*" element={<Navigate to="/option-chain" replace />} />
                </Routes>
            </div>
            {!hideFooter && <Footer />}
        </div>
    );
}

export default App;
