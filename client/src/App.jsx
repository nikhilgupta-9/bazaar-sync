import { Routes, Route, Navigate } from "react-router-dom";
import TopNav from "./components/TopNav";
import Footer from "./components/Footer";
import Home from "./pages/Home";
import OptionChain from "./pages/OptionChain";
import StrategyBuilder from "./pages/StrategyBuilder";
import Simulator from "./pages/Simulator";
import PaperTrade from "./pages/PaperTrade";
import HistoricalChart from "./pages/HistoricalChart";
import EquityData from "./pages/EquityData";
import SectorRotation from "./pages/SectorRotation";
import Pricing from "./pages/Pricing";
import EventsPage from "./pages/Events";
import Terms from "./pages/Terms";
import Auth from "./pages/Auth";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import { usePageSeo } from "./hooks/usePageSeo";

function App() {
    usePageSeo();

    return (
        <div className="flex min-h-screen flex-col bg-gray-50">
            <TopNav />
            <div className="flex-1">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/option-chain" element={<Navigate to="/option-chain/nifty" replace />} />
                    <Route path="/option-chain/:symbol" element={<OptionChain />} />
                    <Route path="/strategy-builder" element={<StrategyBuilder />} />
                    <Route path="/simulator" element={<Simulator />} />
                    <Route path="/paper-trade" element={<PaperTrade />} />
                    <Route path="/historical-chart" element={<HistoricalChart />} />
                    <Route path="/equity-data" element={<EquityData />} />
                    <Route path="/equity-data/sector-rotation" element={<SectorRotation />} />
                    <Route path="/equity-data/:tool" element={<EquityData />} />
                    <Route path="/pricing" element={<Pricing />} />
                    <Route path="/events" element={<EventsPage />} />
                    <Route path="/terms" element={<Terms />} />
                    <Route path="/login" element={<Auth />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="*" element={<Navigate to="/option-chain" replace />} />
                </Routes>
            </div>
            <Footer />
        </div>
    );
}

export default App;
