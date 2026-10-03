import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
    FiPlay,
    FiPause,
    FiRotateCcw,
    FiTrendingUp,
    FiTrendingDown,
    FiActivity,
    FiDollarSign,
    FiPercent,
    FiClock,
    FiLayers,
    FiSettings,
    FiCpu,
    FiSliders,
    FiDownload,
    FiRefreshCw,
    FiCheck,
    FiAlertCircle,
    FiChevronRight,
    FiMaximize2,
    FiMinimize2,
    FiShield,
    FiZap,
    FiSearch,
    FiPlus,
    FiBarChart2,
    FiPieChart,
    FiCrosshair,
    FiTrendingUp as FiLong,
    FiTrendingDown as FiShort,
    FiInfo,
    FiAward,
} from "react-icons/fi";
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    LineChart,
    Line,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
    ReferenceLine,
    ComposedChart,
} from "recharts";

// Top Crypto Presets
const CRYPTO_ASSETS = [
    { symbol: "BTCUSDT", name: "Bitcoin", icon: "₿", color: "#f0b90b", basePrice: 65200 },
    { symbol: "ETHUSDT", name: "Ethereum", icon: "Ξ", color: "#627eea", basePrice: 3450 },
    { symbol: "SOLUSDT", name: "Solana", icon: "◎", color: "#14f195", basePrice: 155 },
    { symbol: "BNBUSDT", name: "BNB", icon: "⬡", color: "#f3ba2f", basePrice: 580 },
    { symbol: "DOGEUSDT", name: "Dogecoin", icon: "Ð", color: "#c2a633", basePrice: 0.14 },
    { symbol: "XRPUSDT", name: "Ripple", icon: "✕", color: "#00aae4", basePrice: 0.58 },
    { symbol: "AVAXUSDT", name: "Avalanche", icon: "▲", color: "#e84142", basePrice: 28.5 },
    { symbol: "LINKUSDT", name: "Chainlink", icon: "⬡", color: "#375bd2", basePrice: 13.2 },
    { symbol: "SUIUSDT", name: "Sui", icon: "💧", color: "#4da2ff", basePrice: 1.85 },
    { symbol: "NEARUSDT", name: "NEAR", icon: "Ⓝ", color: "#00ec97", basePrice: 5.2 },
];

const TIMEFRAMES = [
    { key: "1m", label: "1m" },
    { key: "5m", label: "5m" },
    { key: "15m", label: "15m" },
    { key: "1h", label: "1h" },
    { key: "4h", label: "4h" },
    { key: "1d", label: "1D" },
];

const STRATEGIES = [
    {
        id: "EMA_CROSS",
        name: "EMA Trend Crossover",
        desc: "Fast EMA crosses Slow EMA for directional trend riding.",
        badge: "Trend Following",
        params: { fastPeriod: 9, slowPeriod: 21 },
    },
    {
        id: "RSI_MEAN_REVERSION",
        name: "RSI Mean Reversion",
        desc: "Buys oversold extreme dips (<30) and shorts overbought peaks (>70).",
        badge: "Mean Reversion",
        params: { period: 14, oversold: 30, overbought: 70 },
    },
    {
        id: "BOLLINGER_BREAKOUT",
        name: "Bollinger Bands Volatility",
        desc: "Mean-reverting band touch with standard deviation expansion.",
        badge: "Volatility",
        params: { period: 20, stdDev: 2.0 },
    },
    {
        id: "GRID_DCA",
        name: "Martingale / Grid DCA",
        desc: "Scales in position on percentage pullbacks and harvests quick gains.",
        badge: "DCA Bot",
        params: { gridStepPct: 2.0, takeProfitPct: 3.5, maxOrders: 4 },
    },
];

const QUICK_PRESETS = [
    {
        name: "⚡ 5m Scalper",
        strategy: "EMA_CROSS",
        timeframe: "5m",
        leverage: 5,
        tradeSizePct: 25,
        stopLossPct: 1.2,
        takeProfitPct: 2.5,
        params: { fastPeriod: 9, slowPeriod: 21 },
    },
    {
        name: "🌊 1h Trend Swing",
        strategy: "EMA_CROSS",
        timeframe: "1h",
        leverage: 2,
        tradeSizePct: 35,
        stopLossPct: 2.5,
        takeProfitPct: 6.0,
        params: { fastPeriod: 20, slowPeriod: 50 },
    },
    {
        name: "🎯 RSI Dip Sniper",
        strategy: "RSI_MEAN_REVERSION",
        timeframe: "15m",
        leverage: 3,
        tradeSizePct: 30,
        stopLossPct: 2.0,
        takeProfitPct: 4.5,
        params: { period: 14, oversold: 28, overbought: 72 },
    },
    {
        name: "🛡️ Safe Spot DCA",
        strategy: "GRID_DCA",
        timeframe: "1h",
        leverage: 1,
        tradeSizePct: 20,
        stopLossPct: 5.0,
        takeProfitPct: 4.0,
        params: { gridStepPct: 2.5, takeProfitPct: 4.0, maxOrders: 4 },
    },
];

// Indicators Math
function calculateSMA(data, period) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push(null);
            continue;
        }
        let sum = 0;
        for (let j = 0; j < period; j++) sum += data[i - j].close;
        sma.push(sum / period);
    }
    return sma;
}

function calculateEMA(data, period) {
    const ema = [];
    const k = 2 / (period + 1);
    let prevEma = null;

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            ema.push(null);
            continue;
        }
        if (prevEma === null) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[i - j].close;
            prevEma = sum / period;
            ema.push(prevEma);
        } else {
            const currentEma = data[i].close * k + prevEma * (1 - k);
            ema.push(currentEma);
            prevEma = currentEma;
        }
    }
    return ema;
}

function calculateRSI(data, period = 14) {
    const rsi = [];
    let gains = 0;
    let losses = 0;

    for (let i = 0; i < data.length; i++) {
        if (i === 0) {
            rsi.push(null);
            continue;
        }
        const diff = data[i].close - data[i - 1].close;
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? Math.abs(diff) : 0;

        if (i < period) {
            gains += gain;
            losses += loss;
            rsi.push(null);
            continue;
        }
        if (i === period) {
            gains += gain;
            losses += loss;
            let avgGain = gains / period;
            let avgLoss = losses / period;
            let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
            rsi.push(100 - (100 / (1 + rs)));
            continue;
        }

        let avgGain = (gains * (period - 1) + gain) / period;
        let avgLoss = (losses * (period - 1) + loss) / period;
        gains = avgGain;
        losses = avgLoss;
        let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        rsi.push(100 - (100 / (1 + rs)));
    }
    return rsi;
}

function calculateBollingerBands(data, period = 20, stdDevMult = 2.0) {
    const sma = calculateSMA(data, period);
    const upper = [];
    const lower = [];

    for (let i = 0; i < data.length; i++) {
        if (sma[i] === null) {
            upper.push(null);
            lower.push(null);
            continue;
        }
        let varianceSum = 0;
        for (let j = 0; j < period; j++) {
            varianceSum += Math.pow(data[i - j].close - sma[i], 2);
        }
        const stdDev = Math.sqrt(varianceSum / period);
        upper.push(sma[i] + stdDevMult * stdDev);
        lower.push(sma[i] - stdDevMult * stdDev);
    }
    return { sma, upper, lower };
}

function generateFallbackCandles(symbol, count = 600, basePrice = 65000) {
    const candles = [];
    let price = basePrice;
    const now = Date.now();
    const intervalMs = 60 * 1000;

    for (let i = count; i >= 0; i--) {
        const time = new Date(now - i * intervalMs);
        const changePct = (Math.random() - 0.495) * 0.007;
        const open = price;
        const close = price * (1 + changePct);
        const high = Math.max(open, close) * (1 + Math.random() * 0.0025);
        const low = Math.min(open, close) * (1 - Math.random() * 0.0025);
        const volume = 15 + Math.random() * 95;
        price = close;

        candles.push({
            time: time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            timestamp: time.getTime(),
            dateStr: time.toISOString().split("T")[0],
            open: parseFloat(open.toFixed(2)),
            high: parseFloat(high.toFixed(2)),
            low: parseFloat(low.toFixed(2)),
            close: parseFloat(close.toFixed(2)),
            volume: parseFloat(volume.toFixed(2)),
        });
    }
    return candles;
}

export default function BitcoinSimulator() {
    // Controls State
    const [selectedAsset, setSelectedAsset] = useState("BTCUSDT");
    const [selectedTimeframe, setSelectedTimeframe] = useState("1m");
    const [selectedStrategy, setSelectedStrategy] = useState("EMA_CROSS");
    const [strategyParams, setStrategyParams] = useState(STRATEGIES[0].params);
    const [initialCapital, setInitialCapital] = useState(10000);
    const [tradeSizePct, setTradeSizePct] = useState(25);
    const [leverage, setLeverage] = useState(2);
    const [stopLossPct, setStopLossPct] = useState(2.0);
    const [takeProfitPct, setTakeProfitPct] = useState(4.0);
    const [tradeDirection, setTradeDirection] = useState("both"); // "long", "short", "both"
    const [customCoinInput, setCustomCoinInput] = useState("");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showIndicators, setShowIndicators] = useState(true);

    // Data & Backtest Results State
    const [candles, setCandles] = useState([]);
    const [loadingData, setLoadingData] = useState(true);
    const [backtestResult, setBacktestResult] = useState(null);
    const [activeTab, setActiveTab] = useState("chart"); // "chart", "equity", "trades", "analytics"
    const [tradeFilter, setTradeFilter] = useState("all"); // "all", "winners", "losers", "longs", "shorts"

    // Bar Replay Simulator State
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayIndex, setReplayIndex] = useState(0);
    const [replaySpeed, setReplaySpeed] = useState(150); // ms per step
    const replayTimerRef = useRef(null);

    // Current Coin Info
    const currentAssetInfo = useMemo(() => {
        return CRYPTO_ASSETS.find((c) => c.symbol === selectedAsset) || {
            symbol: selectedAsset,
            name: selectedAsset.replace("USDT", ""),
            icon: "🪙",
            color: "#f0b90b",
        };
    }, [selectedAsset]);

    // Fetch candles from Binance Public API
    const fetchCandles = useCallback(async () => {
        setLoadingData(true);
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${selectedAsset}&interval=${selectedTimeframe}&limit=600`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
            const raw = await res.json();

            const parsed = raw.map((k) => {
                const d = new Date(k[0]);
                return {
                    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                    timestamp: k[0],
                    dateStr: d.toISOString().split("T")[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                };
            });

            setCandles(parsed);
            setReplayIndex(parsed.length - 1);
        } catch (err) {
            console.warn("Binance fetch fallback notice:", err.message);
            const fallback = generateFallbackCandles(
                selectedAsset,
                600,
                currentAssetInfo.basePrice || (selectedAsset.startsWith("ETH") ? 3450 : selectedAsset.startsWith("SOL") ? 155 : 65000)
            );
            setCandles(fallback);
            setReplayIndex(fallback.length - 1);
        } finally {
            setLoadingData(false);
        }
    }, [selectedAsset, selectedTimeframe, currentAssetInfo.basePrice]);

    useEffect(() => {
        fetchCandles();
    }, [fetchCandles]);

    const handleSelectStrategy = (stratId) => {
        setSelectedStrategy(stratId);
        const st = STRATEGIES.find((s) => s.id === stratId);
        if (st) setStrategyParams(st.params);
    };

    const handleApplyPreset = (p) => {
        setSelectedStrategy(p.strategy);
        setSelectedTimeframe(p.timeframe);
        setLeverage(p.leverage);
        setTradeSizePct(p.tradeSizePct);
        setStopLossPct(p.stopLossPct);
        setTakeProfitPct(p.takeProfitPct);
        setStrategyParams(p.params);
    };

    const handleAddCustomCoin = () => {
        if (!customCoinInput.trim()) return;
        let s = customCoinInput.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (!s.endsWith("USDT") && !s.endsWith("BUSD") && !s.endsWith("USDC")) {
            s = `${s}USDT`;
        }
        setSelectedAsset(s);
        setCustomCoinInput("");
    };

    // Run Backtest Engine Computation
    const runBacktest = useCallback(() => {
        if (!candles || candles.length < 30) return;

        let equity = initialCapital;
        const equityCurve = [];
        const trades = [];
        let position = null;
        let peakEquity = initialCapital;
        let maxDrawdownPct = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        let grossProfit = 0;
        let grossLoss = 0;
        let maxConsecutiveWins = 0;
        let maxConsecutiveLosses = 0;
        let currentStreak = 0;
        let streakType = null;

        // Pre-compute indicators
        const fastEma = calculateEMA(candles, strategyParams.fastPeriod || 9);
        const slowEma = calculateEMA(candles, strategyParams.slowPeriod || 21);
        const rsi = calculateRSI(candles, strategyParams.period || 14);
        const { upper, lower, sma } = calculateBollingerBands(candles, strategyParams.period || 20, strategyParams.stdDev || 2.0);

        for (let i = 1; i < candles.length; i++) {
            const current = candles[i];
            const prev = candles[i - 1];

            // 1. Check Stop Loss / Take Profit
            if (position) {
                let exitPrice = null;
                let exitReason = null;

                if (position.type === "LONG") {
                    if (current.low <= position.stopPrice) {
                        exitPrice = position.stopPrice;
                        exitReason = "Stop Loss";
                    } else if (current.high >= position.targetPrice) {
                        exitPrice = position.targetPrice;
                        exitReason = "Take Profit";
                    }
                } else if (position.type === "SHORT") {
                    if (current.high >= position.stopPrice) {
                        exitPrice = position.stopPrice;
                        exitReason = "Stop Loss";
                    } else if (current.low <= position.targetPrice) {
                        exitPrice = position.targetPrice;
                        exitReason = "Take Profit";
                    }
                }

                if (exitPrice !== null) {
                    const priceDiff = position.type === "LONG" ? (exitPrice - position.entryPrice) : (position.entryPrice - exitPrice);
                    const pnlPercent = (priceDiff / position.entryPrice) * leverage;
                    const pnlUsdt = position.margin * pnlPercent;
                    const fee = position.positionValue * 0.0006; // 0.06% maker/taker fee
                    const netPnl = pnlUsdt - fee;

                    equity += netPnl;
                    if (netPnl > 0) {
                        winningTrades++;
                        grossProfit += netPnl;
                        if (streakType === "WIN") currentStreak++;
                        else { streakType = "WIN"; currentStreak = 1; }
                        if (currentStreak > maxConsecutiveWins) maxConsecutiveWins = currentStreak;
                    } else {
                        losingTrades++;
                        grossLoss += Math.abs(netPnl);
                        if (streakType === "LOSS") currentStreak++;
                        else { streakType = "LOSS"; currentStreak = 1; }
                        if (currentStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentStreak;
                    }

                    trades.push({
                        id: trades.length + 1,
                        type: position.type,
                        entryTime: position.entryTime,
                        exitTime: current.time,
                        entryPrice: position.entryPrice,
                        exitPrice: exitPrice,
                        amountUsdt: position.margin,
                        positionValue: position.positionValue,
                        pnlUsdt: netPnl,
                        pnlPct: (netPnl / position.margin) * 100,
                        reason: exitReason,
                        equityAfter: equity,
                    });

                    position = null;
                }
            }

            // 2. Evaluate Strategy Signals
            let signal = null; // "BUY" | "SELL"

            if (selectedStrategy === "EMA_CROSS") {
                if (fastEma[i] && slowEma[i] && fastEma[i - 1] && slowEma[i - 1]) {
                    if (fastEma[i - 1] <= slowEma[i - 1] && fastEma[i] > slowEma[i]) {
                        signal = "BUY";
                    } else if (fastEma[i - 1] >= slowEma[i - 1] && fastEma[i] < slowEma[i]) {
                        signal = "SELL";
                    }
                }
            } else if (selectedStrategy === "RSI_MEAN_REVERSION") {
                if (rsi[i] !== null && rsi[i - 1] !== null) {
                    const oversold = strategyParams.oversold || 30;
                    const overbought = strategyParams.overbought || 70;
                    if (rsi[i - 1] < oversold && rsi[i] >= oversold) {
                        signal = "BUY";
                    } else if (rsi[i - 1] > overbought && rsi[i] <= overbought) {
                        signal = "SELL";
                    }
                }
            } else if (selectedStrategy === "BOLLINGER_BREAKOUT") {
                if (lower[i] && upper[i]) {
                    if (current.close < lower[i]) {
                        signal = "BUY";
                    } else if (current.close > upper[i]) {
                        signal = "SELL";
                    }
                }
            } else if (selectedStrategy === "GRID_DCA") {
                const dropPct = ((current.close - prev.close) / prev.close) * 100;
                if (dropPct <= -(strategyParams.gridStepPct || 2.0)) {
                    signal = "BUY";
                }
            }

            // 3. Open New Position on Signal
            if (!position && signal) {
                const canLong = signal === "BUY" && (tradeDirection === "long" || tradeDirection === "both");
                const canShort = signal === "SELL" && (tradeDirection === "short" || tradeDirection === "both");

                if (canLong || canShort) {
                    const posType = canLong ? "LONG" : "SHORT";
                    const margin = (equity * (tradeSizePct / 100));
                    const positionValue = margin * leverage;
                    const entryPrice = current.close;
                    const slDist = entryPrice * (stopLossPct / 100);
                    const tpDist = entryPrice * (takeProfitPct / 100);

                    position = {
                        type: posType,
                        entryPrice,
                        margin,
                        positionValue,
                        entryTime: current.time,
                        entryIndex: i,
                        stopPrice: posType === "LONG" ? (entryPrice - slDist) : (entryPrice + slDist),
                        targetPrice: posType === "LONG" ? (entryPrice + tpDist) : (entryPrice - tpDist),
                    };
                }
            }

            if (equity > peakEquity) peakEquity = equity;
            const dd = ((peakEquity - equity) / peakEquity) * 100;
            if (dd > maxDrawdownPct) maxDrawdownPct = dd;

            equityCurve.push({
                time: current.time,
                price: current.close,
                fastEma: fastEma[i] ? parseFloat(fastEma[i].toFixed(2)) : null,
                slowEma: slowEma[i] ? parseFloat(slowEma[i].toFixed(2)) : null,
                bbUpper: upper[i] ? parseFloat(upper[i].toFixed(2)) : null,
                bbLower: lower[i] ? parseFloat(lower[i].toFixed(2)) : null,
                rsi: rsi[i] ? parseFloat(rsi[i].toFixed(1)) : null,
                equity: parseFloat(equity.toFixed(2)),
                drawdown: parseFloat(dd.toFixed(2)),
                hasTrade: position ? position.type : null,
            });
        }

        const totalTrades = winningTrades + losingTrades;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
        const netProfit = equity - initialCapital;
        const returnPct = (netProfit / initialCapital) * 100;
        const avgTradeProfit = totalTrades > 0 ? netProfit / totalTrades : 0;
        const avgWin = winningTrades > 0 ? grossProfit / winningTrades : 0;
        const avgLoss = losingTrades > 0 ? grossLoss / losingTrades : 0;
        const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99 : 0;

        setBacktestResult({
            initialCapital,
            finalEquity: equity,
            netProfit,
            returnPct,
            totalTrades,
            winningTrades,
            losingTrades,
            winRate,
            profitFactor,
            maxDrawdownPct,
            avgTradeProfit,
            avgWin,
            avgLoss,
            winLossRatio,
            maxConsecutiveWins,
            maxConsecutiveLosses,
            trades,
            equityCurve,
        });
    }, [candles, selectedStrategy, strategyParams, initialCapital, tradeSizePct, leverage, stopLossPct, takeProfitPct, tradeDirection]);

    useEffect(() => {
        runBacktest();
    }, [runBacktest]);

    // Replay simulation ticker
    useEffect(() => {
        if (isReplaying) {
            replayTimerRef.current = setInterval(() => {
                setReplayIndex((prev) => {
                    if (prev >= candles.length - 1) {
                        setIsReplaying(false);
                        return prev;
                    }
                    return prev + 1;
                });
            }, replaySpeed);
        } else {
            clearInterval(replayTimerRef.current);
        }
        return () => clearInterval(replayTimerRef.current);
    }, [isReplaying, replaySpeed, candles.length]);

    const activeCandle = candles[replayIndex] || candles[candles.length - 1] || {};
    const visibleData = useMemo(() => {
        if (!backtestResult?.equityCurve) return candles.slice(0, replayIndex + 1);
        return backtestResult.equityCurve.slice(0, replayIndex + 1);
    }, [backtestResult, replayIndex, candles]);

    const activeEquityItem = visibleData[visibleData.length - 1] || {};

    const filteredTrades = useMemo(() => {
        if (!backtestResult?.trades) return [];
        return backtestResult.trades.filter((t) => {
            if (tradeFilter === "winners") return t.pnlUsdt > 0;
            if (tradeFilter === "losers") return t.pnlUsdt <= 0;
            if (tradeFilter === "longs") return t.type === "LONG";
            if (tradeFilter === "shorts") return t.type === "SHORT";
            return true;
        });
    }, [backtestResult?.trades, tradeFilter]);

    return (
        <div className={`w-full min-h-screen bg-[#05060a] text-gray-100 font-sans antialiased selection:bg-amber-500/30 selection:text-amber-300 pb-20 ${
            isFullscreen ? "fixed inset-0 z-50 overflow-y-auto" : ""
        }`}>
            {/* 1. Full-Width Cyberpunk Terminal Top Navigation Bar */}
            <div className="w-full border-b border-amber-500/20 bg-gradient-to-r from-[#07090f] via-[#0d101a] to-[#080912] px-3 sm:px-6 2xl:px-8 py-3.5 shadow-2xl">
                <div className="w-full flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                    {/* Brand & Coin Status */}
                    <div className="flex items-center gap-3">
                        <div
                            className="h-11 w-11 rounded-2xl flex items-center justify-center text-black font-black text-2xl shadow-lg shadow-amber-500/20 transition-transform hover:scale-105"
                            style={{ backgroundColor: currentAssetInfo.color }}
                        >
                            {currentAssetInfo.icon}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-base sm:text-lg font-black text-white tracking-wide uppercase flex items-center gap-1.5">
                                    <span>{currentAssetInfo.name}</span>
                                    <span className="text-amber-400 font-mono">/ USDT</span>
                                </h1>
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-extrabold tracking-wider uppercase">
                                    Perpetual Simulator
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
                                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                    Binance Feed
                                </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs mt-0.5">
                                <span className="font-mono text-base font-black text-white">
                                    ${activeCandle.close?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                                <span className="text-gray-400 text-[11px] font-mono">
                                    24h Vol: <strong className="text-cyan-400">${(activeCandle.volume * (activeCandle.close || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong>
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Quick Coin Switcher & Custom Coin Input */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1 p-1 rounded-xl bg-black/60 border border-white/10 overflow-x-auto max-w-full">
                            {CRYPTO_ASSETS.map((asset) => (
                                <button
                                    key={asset.symbol}
                                    onClick={() => setSelectedAsset(asset.symbol)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shrink-0 ${
                                        selectedAsset === asset.symbol
                                            ? "bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-md shadow-amber-500/20"
                                            : "text-gray-400 hover:text-white hover:bg-white/5"
                                    }`}
                                >
                                    <span>{asset.icon}</span>
                                    <span>{asset.symbol.replace("USDT", "")}</span>
                                </button>
                            ))}
                        </div>

                        {/* Custom Coin Adder */}
                        <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-xl px-2 py-1">
                            <input
                                type="text"
                                placeholder="Any Pair (e.g. PEPE)"
                                value={customCoinInput}
                                onChange={(e) => setCustomCoinInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleAddCustomCoin()}
                                className="w-24 text-xs text-amber-300 placeholder-gray-500 uppercase font-mono font-bold bg-transparent focus:outline-none"
                            />
                            <button
                                onClick={handleAddCustomCoin}
                                className="p-1 rounded-md bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs"
                                title="Add Binance Pair"
                            >
                                <FiPlus size={12} />
                            </button>
                        </div>
                    </div>

                    {/* Right Controls: Timeframe, Reload & Fullscreen */}
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Timeframe selector */}
                        <div className="flex items-center gap-0.5 p-1 rounded-xl bg-black/60 border border-white/10 text-xs">
                            {TIMEFRAMES.map((tf) => (
                                <button
                                    key={tf.key}
                                    onClick={() => setSelectedTimeframe(tf.key)}
                                    className={`px-2.5 py-1 rounded-lg font-bold transition ${
                                        selectedTimeframe === tf.key
                                            ? "bg-cyan-500 text-black shadow-sm"
                                            : "text-gray-400 hover:text-white"
                                    }`}
                                >
                                    {tf.label}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => setShowIndicators(!showIndicators)}
                            className={`p-2 rounded-xl border transition text-xs font-bold flex items-center gap-1 ${
                                showIndicators
                                    ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                                    : "bg-white/5 border-white/10 text-gray-400"
                            }`}
                            title="Toggle Indicator Overlays"
                        >
                            <FiActivity size={14} />
                            <span className="hidden sm:inline">EMA/BB</span>
                        </button>

                        <button
                            onClick={fetchCandles}
                            disabled={loadingData}
                            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 transition"
                            title="Refresh Binance Data"
                        >
                            <FiRefreshCw className={loadingData ? "animate-spin text-amber-400" : ""} size={14} />
                        </button>

                        <button
                            onClick={() => setIsFullscreen(!isFullscreen)}
                            className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 transition"
                            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Pro View"}
                        >
                            {isFullscreen ? <FiMinimize2 size={14} /> : <FiMaximize2 size={14} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. Interactive Bar-by-Bar Replay Tape Toolbar */}
            <div className="w-full border-b border-white/5 bg-[#080a12] px-3 sm:px-6 2xl:px-8 py-2.5">
                <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    {/* Left: Replay Status & Controls */}
                    <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-extrabold text-[10px] uppercase tracking-wider">
                            1-Min Replay Tape
                        </span>

                        <button
                            onClick={() => setIsReplaying(!isReplaying)}
                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider transition ${
                                isReplaying
                                    ? "bg-rose-600 text-white shadow-lg shadow-rose-600/30"
                                    : "bg-gradient-to-r from-emerald-500 to-teal-500 text-black hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/20"
                            }`}
                        >
                            {isReplaying ? <FiPause size={13} /> : <FiPlay size={13} className="fill-current" />}
                            <span>{isReplaying ? "Pause" : "Play Tape"}</span>
                        </button>

                        <button
                            onClick={() => setReplayIndex((prev) => Math.max(0, prev - 1))}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                            title="Step -1 Bar"
                        >
                            ◀
                        </button>

                        <button
                            onClick={() => setReplayIndex((prev) => Math.min(candles.length - 1, prev + 1))}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
                            title="Step +1 Bar"
                        >
                            ▶
                        </button>

                        <button
                            onClick={() => setReplayIndex(candles.length - 1)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-[11px] font-bold"
                            title="Jump to Realtime Candle"
                        >
                            <FiRotateCcw size={11} />
                            <span>Live End</span>
                        </button>

                        <div className="flex items-center gap-1 text-[11px] text-gray-400">
                            <span>Speed:</span>
                            {[
                                { ms: 350, label: "0.5x" },
                                { ms: 150, label: "1x" },
                                { ms: 50, label: "3x" },
                                { ms: 15, label: "MAX" },
                            ].map((s) => (
                                <button
                                    key={s.label}
                                    onClick={() => setReplaySpeed(s.ms)}
                                    className={`px-1.5 py-0.5 rounded font-mono font-bold transition ${
                                        replaySpeed === s.ms ? "bg-amber-500 text-black" : "bg-white/5 text-gray-400 hover:text-white"
                                    }`}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Timeline Slider Bar */}
                    <div className="flex items-center gap-3 flex-1 max-w-xl mx-2">
                        <span className="font-mono text-[10px] text-gray-500 shrink-0">
                            Bar {replayIndex + 1}/{candles.length}
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={Math.max(0, candles.length - 1)}
                            value={replayIndex}
                            onChange={(e) => setReplayIndex(Number(e.target.value))}
                            className="w-full h-1.5 bg-black/60 rounded-lg appearance-none cursor-pointer accent-amber-500"
                        />
                        <span className="font-mono text-[11px] text-amber-400 shrink-0 font-bold">
                            {activeCandle.time || "00:00"}
                        </span>
                    </div>

                    {/* Live Simulated Position Badge */}
                    <div className="flex items-center gap-2 shrink-0">
                        {activeEquityItem.hasTrade ? (
                            <div className={`px-2.5 py-1 rounded-lg border font-mono font-bold text-xs flex items-center gap-1.5 ${
                                activeEquityItem.hasTrade === "LONG"
                                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                    : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                            }`}>
                                <span>{activeEquityItem.hasTrade === "LONG" ? "▲ IN LONG" : "▼ IN SHORT"}</span>
                                <span className="text-white">@ ${activeCandle.close?.toLocaleString()}</span>
                            </div>
                        ) : (
                            <div className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-gray-400 text-xs font-mono">
                                No Open Position
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 3. Full-Width Workspace Layout */}
            <div className="w-full px-3 sm:px-6 2xl:px-8 pt-5 space-y-5">
                {/* Top Metrics Neon HUD Bar */}
                {backtestResult && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
                        <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e111d] to-[#0a0c16] border border-white/10 relative overflow-hidden shadow-xl group hover:border-emerald-500/40 transition">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
                            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Net Strategy Profit</span>
                            <div className={`text-lg font-black font-mono mt-1 flex items-center gap-1 ${
                                backtestResult.netProfit >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}>
                                {backtestResult.netProfit >= 0 ? <FiTrendingUp size={16} /> : <FiTrendingDown size={16} />}
                                <span>{backtestResult.returnPct >= 0 ? "+" : ""}{backtestResult.returnPct.toFixed(2)}%</span>
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                                ${backtestResult.netProfit >= 0 ? "+" : ""}{backtestResult.netProfit.toFixed(2)} USDT
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e111d] to-[#0a0c16] border border-white/10 relative overflow-hidden shadow-xl group hover:border-cyan-500/40 transition">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-xl pointer-events-none" />
                            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Win Rate Accuracy</span>
                            <div className="text-lg font-black font-mono mt-1 text-cyan-400">
                                {backtestResult.winRate.toFixed(1)}%
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                                {backtestResult.winningTrades} Wins / {backtestResult.losingTrades} Losses ({backtestResult.totalTrades} Total)
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e111d] to-[#0a0c16] border border-white/10 relative overflow-hidden shadow-xl group hover:border-amber-500/40 transition">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl pointer-events-none" />
                            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Profit Factor (P/L)</span>
                            <div className="text-lg font-black font-mono mt-1 text-amber-400">
                                {backtestResult.profitFactor.toFixed(2)}
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                                Gross Gain / Loss Ratio
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e111d] to-[#0a0c16] border border-white/10 relative overflow-hidden shadow-xl group hover:border-rose-500/40 transition">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl pointer-events-none" />
                            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Max Portfolio Drawdown</span>
                            <div className="text-lg font-black font-mono mt-1 text-rose-400">
                                -{backtestResult.maxDrawdownPct.toFixed(2)}%
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                                Peak to Valley Risk
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e111d] to-[#0a0c16] border border-white/10 relative overflow-hidden shadow-xl group hover:border-purple-500/40 transition">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-xl pointer-events-none" />
                            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Simulated Portfolio</span>
                            <div className="text-lg font-black font-mono mt-1 text-white">
                                ${backtestResult.finalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                                Initial: ${initialCapital.toLocaleString()} USDT
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-gradient-to-br from-[#0e111d] to-[#0a0c16] border border-white/10 relative overflow-hidden shadow-xl group hover:border-yellow-500/40 transition">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-yellow-500/5 rounded-full blur-xl pointer-events-none" />
                            <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">Risk-Reward / Sizing</span>
                            <div className="text-lg font-black font-mono mt-1 text-purple-400">
                                {leverage}x / {tradeSizePct}%
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono mt-0.5 uppercase">
                                SL: {stopLossPct}% • TP: {takeProfitPct}%
                            </div>
                        </div>
                    </div>
                )}

                {/* Main Split Area: Left Strategy Control Dock (340px) & Right Pro Charts Station */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Left Panel: Strategy Rules & Risk Engine (4 cols) */}
                    <div className="lg:col-span-4 xl:col-span-3 space-y-4">
                        {/* 1-Click Quick Presets */}
                        <div className="rounded-2xl border border-white/10 bg-[#0a0c16] p-4 shadow-xl space-y-3">
                            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                                <FiZap className="text-amber-400" size={15} />
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Quick Presets</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                {QUICK_PRESETS.map((p) => (
                                    <button
                                        key={p.name}
                                        type="button"
                                        onClick={() => handleApplyPreset(p)}
                                        className="p-2.5 rounded-xl bg-white/5 hover:bg-amber-500/15 border border-white/5 hover:border-amber-500/30 text-left transition group cursor-pointer"
                                    >
                                        <div className="text-xs font-black text-white group-hover:text-amber-300 truncate">{p.name}</div>
                                        <div className="text-[10px] text-gray-400 mt-0.5 font-mono">{p.timeframe} • {p.leverage}x</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Strategy Architecture Config */}
                        <div className="rounded-2xl border border-white/10 bg-[#0a0c16] p-4 shadow-xl space-y-4">
                            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
                                <FiSliders className="text-cyan-400" size={15} />
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Algorithmic Model</h3>
                            </div>

                            {/* Strategy List */}
                            <div className="space-y-1.5">
                                {STRATEGIES.map((st) => (
                                    <button
                                        key={st.id}
                                        type="button"
                                        onClick={() => handleSelectStrategy(st.id)}
                                        className={`w-full p-3 rounded-xl border text-left transition cursor-pointer ${
                                            selectedStrategy === st.id
                                                ? "bg-gradient-to-r from-amber-500/20 to-orange-500/10 border-amber-500/50 shadow-md shadow-amber-500/10"
                                                : "bg-white/5 border-white/5 text-gray-400 hover:bg-white/10 hover:text-white"
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-black text-xs text-white">{st.name}</span>
                                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-amber-300 font-extrabold uppercase">
                                                {st.badge}
                                            </span>
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">{st.desc}</p>
                                    </button>
                                ))}
                            </div>

                            {/* Indicator Tuning Sliders */}
                            <div className="p-3 rounded-xl bg-black/50 border border-white/5 space-y-3">
                                <div className="text-[10px] font-extrabold uppercase text-gray-400 tracking-wider">
                                    Mathematical Inputs
                                </div>

                                {selectedStrategy === "EMA_CROSS" && (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400">Fast EMA Period:</span>
                                            <input
                                                type="number"
                                                value={strategyParams.fastPeriod || 9}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, fastPeriod: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-cyan-300 font-mono font-bold"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400">Slow EMA Period:</span>
                                            <input
                                                type="number"
                                                value={strategyParams.slowPeriod || 21}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, slowPeriod: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-amber-300 font-mono font-bold"
                                            />
                                        </div>
                                    </div>
                                )}

                                {selectedStrategy === "RSI_MEAN_REVERSION" && (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400">RSI Length:</span>
                                            <input
                                                type="number"
                                                value={strategyParams.period || 14}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, period: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-white font-mono font-bold"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-emerald-400">Oversold (Buy &lt;):</span>
                                            <input
                                                type="number"
                                                value={strategyParams.oversold || 30}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, oversold: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-emerald-400 font-mono font-bold"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-rose-400">Overbought (Short &gt;):</span>
                                            <input
                                                type="number"
                                                value={strategyParams.overbought || 70}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, overbought: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-rose-400 font-mono font-bold"
                                            />
                                        </div>
                                    </div>
                                )}

                                {selectedStrategy === "BOLLINGER_BREAKOUT" && (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400">SMA Period:</span>
                                            <input
                                                type="number"
                                                value={strategyParams.period || 20}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, period: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-white font-mono font-bold"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-purple-300">StdDev Multiplier:</span>
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={strategyParams.stdDev || 2.0}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, stdDev: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-purple-300 font-mono font-bold"
                                            />
                                        </div>
                                    </div>
                                )}

                                {selectedStrategy === "GRID_DCA" && (
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-center justify-between">
                                            <span className="text-gray-400">Grid Step Drop %:</span>
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={strategyParams.gridStepPct || 2.0}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, gridStepPct: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-cyan-300 font-mono font-bold"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-emerald-400">Take Profit %:</span>
                                            <input
                                                type="number"
                                                step="0.5"
                                                value={strategyParams.takeProfitPct || 3.5}
                                                onChange={(e) => setStrategyParams({ ...strategyParams, takeProfitPct: Number(e.target.value) })}
                                                className="w-16 px-2 py-1 rounded bg-white/5 border border-white/10 text-right text-emerald-400 font-mono font-bold"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Capital, Leverage & Risk Management Controls */}
                            <div className="space-y-3 pt-2">
                                <div className="text-[10px] font-extrabold uppercase text-gray-400 tracking-wider">
                                    Capital & Leverage Architecture
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <label className="text-[10px] text-gray-400">Initial USDT</label>
                                        <input
                                            type="number"
                                            value={initialCapital}
                                            onChange={(e) => setInitialCapital(Number(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono font-bold mt-1"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[10px] text-gray-400">Size / Trade (%)</label>
                                        <input
                                            type="number"
                                            value={tradeSizePct}
                                            onChange={(e) => setTradeSizePct(Number(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono font-bold mt-1"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[10px] text-amber-300">Leverage (x)</label>
                                        <select
                                            value={leverage}
                                            onChange={(e) => setLeverage(Number(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-amber-300 font-mono font-bold mt-1 focus:outline-none"
                                        >
                                            <option value={1} className="bg-[#0a0c16]">1x (Spot)</option>
                                            <option value={2} className="bg-[#0a0c16]">2x (Perp)</option>
                                            <option value={3} className="bg-[#0a0c16]">3x (Perp)</option>
                                            <option value={5} className="bg-[#0a0c16]">5x (Perp)</option>
                                            <option value={10} className="bg-[#0a0c16]">10x (Perp)</option>
                                            <option value={20} className="bg-[#0a0c16]">20x (Degen)</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[10px] text-gray-400">Direction</label>
                                        <select
                                            value={tradeDirection}
                                            onChange={(e) => setTradeDirection(e.target.value)}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-bold mt-1 focus:outline-none"
                                        >
                                            <option value="both" className="bg-[#0a0c16]">Long & Short</option>
                                            <option value="long" className="bg-[#0a0c16]">Long Only</option>
                                            <option value="short" className="bg-[#0a0c16]">Short Only</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[10px] text-rose-400">Stop Loss (%)</label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={stopLossPct}
                                            onChange={(e) => setStopLossPct(Number(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono font-bold mt-1"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[10px] text-emerald-400">Take Profit (%)</label>
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={takeProfitPct}
                                            onChange={(e) => setTakeProfitPct(Number(e.target.value))}
                                            className="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white font-mono font-bold mt-1"
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={runBacktest}
                                className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-black font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-2"
                            >
                                <FiCpu size={15} />
                                <span>Re-Compute Backtest</span>
                            </button>
                        </div>
                    </div>

                    {/* Right Panel: Interactive Pro Chart & Analysis Station (8 cols) */}
                    <div className="lg:col-span-8 xl:col-span-9 space-y-4">
                        {/* Upper Section: Tabbed Pro Chart Station */}
                        <div className="rounded-2xl border border-white/10 bg-[#0a0c16] p-4 shadow-2xl space-y-3">
                            {/* View Switcher Tabs */}
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                                <div className="flex items-center gap-2">
                                    {[
                                        { key: "chart", label: "Price & Indicator Tape", icon: FiActivity },
                                        { key: "equity", label: "Equity Growth Trajectory", icon: FiTrendingUp },
                                        { key: "trades", label: `Executed Trades (${backtestResult?.trades?.length || 0})`, icon: FiLayers },
                                        { key: "analytics", label: "Risk & Win/Loss Matrix", icon: FiPieChart },
                                    ].map((tab) => {
                                        const Icon = tab.icon;
                                        return (
                                            <button
                                                key={tab.key}
                                                onClick={() => setActiveTab(tab.key)}
                                                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                                                    activeTab === tab.key
                                                        ? "bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                                                        : "text-gray-400 hover:text-white hover:bg-white/5"
                                                }`}
                                            >
                                                <Icon size={13} />
                                                <span>{tab.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="flex items-center gap-3 text-[11px] font-mono text-gray-400">
                                    <span className="flex items-center gap-1 text-cyan-400">
                                        <span className="w-2 h-2 rounded-full bg-cyan-400" /> Fast EMA ({strategyParams.fastPeriod || 9})
                                    </span>
                                    <span className="flex items-center gap-1 text-amber-400">
                                        <span className="w-2 h-2 rounded-full bg-amber-400" /> Slow EMA ({strategyParams.slowPeriod || 21})
                                    </span>
                                </div>
                            </div>

                            {/* TAB 1: Main Interactive Price & Tape Chart */}
                            {activeTab === "chart" && (
                                <div className="w-full h-[460px] flex flex-col">
                                    <div className="flex-1 w-full min-h-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ComposedChart data={visibleData} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="cryptoPriceGlowFull" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={currentAssetInfo.color} stopOpacity={0.35} />
                                                        <stop offset="95%" stopColor={currentAssetInfo.color} stopOpacity={0.0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                                                <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 10 }} />
                                                <YAxis
                                                    domain={['auto', 'auto']}
                                                    stroke="#6b7280"
                                                    tick={{ fontSize: 10 }}
                                                    tickFormatter={(v) => `$${v >= 1000 ? v.toLocaleString() : v.toFixed(2)}`}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: "#080a12",
                                                        borderColor: "#f0b90b50",
                                                        borderRadius: "14px",
                                                        fontSize: "12px",
                                                        color: "#fff",
                                                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.8)",
                                                    }}
                                                />
                                                {/* Price Area */}
                                                <Area
                                                    type="monotone"
                                                    dataKey="price"
                                                    name="Price"
                                                    stroke={currentAssetInfo.color}
                                                    strokeWidth={2}
                                                    fillOpacity={1}
                                                    fill="url(#cryptoPriceGlowFull)"
                                                    isAnimationActive={false}
                                                />
                                                {/* Indicator Lines */}
                                                {showIndicators && (
                                                    <>
                                                        <Line
                                                            type="monotone"
                                                            dataKey="fastEma"
                                                            name="Fast EMA"
                                                            stroke="#00f2fe"
                                                            strokeWidth={1.5}
                                                            dot={false}
                                                            isAnimationActive={false}
                                                        />
                                                        <Line
                                                            type="monotone"
                                                            dataKey="slowEma"
                                                            name="Slow EMA"
                                                            stroke="#f0b90b"
                                                            strokeWidth={1.5}
                                                            dot={false}
                                                            isAnimationActive={false}
                                                        />
                                                    </>
                                                )}
                                            </ComposedChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}

                            {/* TAB 2: Equity Growth Curve */}
                            {activeTab === "equity" && (
                                <div className="w-full h-[460px] flex flex-col">
                                    <div className="flex items-center justify-between text-xs text-gray-400 pb-2 mb-2 border-b border-white/5">
                                        <span className="font-bold text-white flex items-center gap-1.5">
                                            <FiTrendingUp className="text-emerald-400" />
                                            Portfolio Cumulative Equity Growth (USDT)
                                        </span>
                                        <span className="font-mono text-emerald-400 font-bold">
                                            Starting: ${initialCapital.toLocaleString()} ➔ Peak: ${Math.max(initialCapital, ...(backtestResult?.equityCurve?.map(e => e.equity) || [0])).toFixed(0)}
                                        </span>
                                    </div>

                                    <div className="flex-1 w-full min-h-0">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={visibleData} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="equityGlowFull" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                                                <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 10 }} />
                                                <YAxis
                                                    domain={['auto', 'auto']}
                                                    stroke="#6b7280"
                                                    tick={{ fontSize: 10 }}
                                                    tickFormatter={(v) => `$${v.toLocaleString()}`}
                                                />
                                                <Tooltip
                                                    contentStyle={{
                                                        backgroundColor: "#080a12",
                                                        borderColor: "#10b98150",
                                                        borderRadius: "14px",
                                                        fontSize: "12px",
                                                        color: "#fff",
                                                    }}
                                                />
                                                <ReferenceLine y={initialCapital} stroke="#6b7280" strokeDasharray="4 4" label="Break Even" />
                                                <Area
                                                    type="monotone"
                                                    dataKey="equity"
                                                    name="Portfolio Equity"
                                                    stroke="#10b981"
                                                    strokeWidth={2.5}
                                                    fillOpacity={1}
                                                    fill="url(#equityGlowFull)"
                                                    isAnimationActive={false}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            )}

                            {/* TAB 3: Executed Trades Ledger */}
                            {activeTab === "trades" && (
                                <div className="w-full h-[460px] flex flex-col space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2">
                                        <div className="flex items-center gap-1.5 text-xs">
                                            {[
                                                { key: "all", label: `All (${backtestResult?.trades?.length || 0})` },
                                                { key: "winners", label: `🟢 Wins (${backtestResult?.winningTrades || 0})` },
                                                { key: "losers", label: `🔴 Losses (${backtestResult?.losingTrades || 0})` },
                                                { key: "longs", label: "Longs" },
                                                { key: "shorts", label: "Shorts" },
                                            ].map((f) => (
                                                <button
                                                    key={f.key}
                                                    onClick={() => setTradeFilter(f.key)}
                                                    className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition ${
                                                        tradeFilter === f.key
                                                            ? "bg-amber-500 text-black shadow-sm"
                                                            : "bg-white/5 text-gray-400 hover:text-white"
                                                    }`}
                                                >
                                                    {f.label}
                                                </button>
                                            ))}
                                        </div>

                                        <button
                                            onClick={() => {
                                                const csv = "TradeID,Type,EntryTime,ExitTime,EntryPrice,ExitPrice,MarginUSDT,PositionValue,PnLUSDT,PnLPct,ExitReason\n" +
                                                    filteredTrades.map(t => `${t.id},${t.type},${t.entryTime},${t.exitTime},${t.entryPrice},${t.exitPrice},${t.amountUsdt},${t.positionValue},${t.pnlUsdt},${t.pnlPct},${t.reason}`).join("\n");
                                                const blob = new Blob([csv], { type: "text/csv" });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement("a");
                                                a.href = url;
                                                a.download = `${selectedAsset}_${selectedStrategy}_trades.csv`;
                                                a.click();
                                            }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-xs font-bold transition"
                                        >
                                            <FiDownload size={12} />
                                            <span>Export CSV</span>
                                        </button>
                                    </div>

                                    <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
                                        {filteredTrades.length > 0 ? (
                                            filteredTrades.map((t) => (
                                                <div
                                                    key={t.id}
                                                    className="p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 flex items-center justify-between text-xs gap-3 transition"
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <span className="font-mono text-[10px] text-gray-500 font-bold">#{t.id}</span>
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                                            t.type === "LONG"
                                                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                                                : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                                        }`}>
                                                            {t.type}
                                                        </span>
                                                        <div className="min-w-0 font-mono">
                                                            <div className="text-white font-bold">
                                                                Entry: ${t.entryPrice?.toLocaleString()} ➔ Exit: ${t.exitPrice?.toLocaleString()}
                                                            </div>
                                                            <div className="text-[10px] text-gray-500 mt-0.5">
                                                                {t.entryTime} ➔ {t.exitTime} • Reason: <strong className="text-gray-300">{t.reason}</strong>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="text-right shrink-0 font-mono">
                                                        <div className={`font-bold ${t.pnlUsdt >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                                            {t.pnlUsdt >= 0 ? "+" : ""}${t.pnlUsdt.toFixed(2)} ({t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%)
                                                        </div>
                                                        <div className="text-[10px] text-gray-500">
                                                            Equity: ${t.equityAfter?.toFixed(0)}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-center py-24 text-gray-500 text-xs italic">
                                                No trade matches filter criteria.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* TAB 4: Risk Analytics & Win/Loss Matrix */}
                            {activeTab === "analytics" && (
                                <div className="w-full h-[460px] overflow-y-auto space-y-4 p-2 custom-scrollbar">
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                                            <span className="text-[10px] text-gray-400 font-bold uppercase">Average Win</span>
                                            <div className="text-base font-black font-mono text-emerald-400">
                                                +${backtestResult?.avgWin?.toFixed(2)}
                                            </div>
                                        </div>

                                        <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                                            <span className="text-[10px] text-gray-400 font-bold uppercase">Average Loss</span>
                                            <div className="text-base font-black font-mono text-rose-400">
                                                -${backtestResult?.avgLoss?.toFixed(2)}
                                            </div>
                                        </div>

                                        <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                                            <span className="text-[10px] text-gray-400 font-bold uppercase">Win/Loss Ratio</span>
                                            <div className="text-base font-black font-mono text-cyan-400">
                                                {backtestResult?.winLossRatio?.toFixed(2)}x
                                            </div>
                                        </div>

                                        <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                                            <span className="text-[10px] text-gray-400 font-bold uppercase">Max Win Streak</span>
                                            <div className="text-base font-black font-mono text-amber-400">
                                                {backtestResult?.maxConsecutiveWins} in a row
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-3">
                                        <div className="flex items-center gap-2 text-xs font-bold text-white uppercase">
                                            <FiAward className="text-amber-400" />
                                            <span>Algorithmic Backtest Executive Summary</span>
                                        </div>
                                        <p className="text-xs text-gray-400 leading-relaxed">
                                            Backtesting executed across <strong className="text-white">{candles.length}</strong> {selectedTimeframe} candles for <strong className="text-amber-300">{selectedAsset}</strong> using <strong className="text-cyan-300">{STRATEGIES.find(s => s.id === selectedStrategy)?.name}</strong> with <strong className="text-purple-300">{leverage}x leverage</strong>.
                                            The model achieved an expectancy of <strong className="text-emerald-400">${backtestResult?.avgTradeProfit?.toFixed(2)}/trade</strong> with a max historical drawdown of <strong className="text-rose-400">{backtestResult?.maxDrawdownPct?.toFixed(2)}%</strong>.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
