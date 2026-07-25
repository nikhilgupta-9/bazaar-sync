import { Routes, Route, Navigate } from "react-router-dom";
import TopNav from "./components/TopNav";
import Home from "./pages/Home";
import OptionChain from "./pages/OptionChain";
import MaxPain from "./pages/MaxPain";
import PutCallRatio from "./pages/PutCallRatio";
import IvChart from "./pages/IvChart";
import StraddleChart from "./pages/StraddleChart";
import OiHeatmap from "./pages/OiHeatmap";
import StrategyBuilder from "./pages/StrategyBuilder";
import Simulator from "./pages/Simulator";
import Backtest from "./pages/Backtest";
import Auth from "./pages/Auth";

function App() {
    return (
        <div className="min-h-screen bg-gray-50">
            <TopNav />
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/option-chain" element={<OptionChain />} />
                <Route path="/strategy-builder" element={<StrategyBuilder />} />
                <Route path="/simulator" element={<Simulator />} />
                <Route path="/max-pain" element={<MaxPain />} />
                <Route path="/put-call-ratio" element={<PutCallRatio />} />
                <Route path="/iv-chart" element={<IvChart />} />
                <Route path="/straddle-chart" element={<StraddleChart />} />
                <Route path="/oi-heatmap" element={<OiHeatmap />} />
                <Route path="/backtest" element={<Backtest />} />
                <Route path="/login" element={<Auth />} />
                <Route path="*" element={<Navigate to="/option-chain" replace />} />
            </Routes>
        </div>
    );
}

export default App;
