// hooks/useOptionChain.js
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOptionChain, refreshOptionChain, createWebSocketConnection } from "../services/optionChainApi";

// Polling intervals (in milliseconds)
const POLLING_INTERVALS = {
    MARKET_OPEN: 10000,    // 10 seconds when market is open
    MARKET_CLOSED: 300000, // 5 minutes when market is closed
    EXTENDED_HOURS: 60000, // 1 minute during pre/post market
};

/**
 * Shared fetch logic for every page built on top of /api/option-chain
 * (Option Chain, Max Pain, PCR, IV chart, Straddle chart). Guards against
 * out-of-order responses — React StrictMode double-invokes effects in dev,
 * and without this a slow, superseded request could overwrite a newer,
 * already-rendered result.
 * 
 * Enhanced with market awareness, WebSocket streaming, and auto-polling.
 */
export function useOptionChain(initialSymbol = "NIFTY") {
    const [symbol, setSymbol] = useState(initialSymbol);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [marketStatus, setMarketStatus] = useState({
        isOpen: false,
        nextOpen: null,
        timestamp: null,
    });
    const [isLive, setIsLive] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    
    const requestIdRef = useRef(0);
    const wsRef = useRef(null);
    const pollingIntervalRef = useRef(null);
    const reconnectTimeoutRef = useRef(null);

    /**
     * Core load function - maintains the original behavior with enhancements
     */
    const load = useCallback(async (sym, expiry, forceLive = false) => {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        
        try {
            const d = await fetchOptionChain(sym, expiry, forceLive);
            
            // Guard against out-of-order responses
            if (requestId !== requestIdRef.current) return;
            
            setData(d);
            setMarketStatus(d.marketStatus || { isOpen: false });
            setIsLive(!d.isHistorical);
            setLastUpdated(new Date().toISOString());
            setError(null);
            
            // Setup WebSocket or polling based on market status
            if (d.marketStatus?.isOpen) {
                setupWebSocket(sym);
            } else {
                closeWebSocket();
                setupPolling(sym, expiry);
            }
            
        } catch (e) {
            if (requestId !== requestIdRef.current) return;
            setError(e.message);
            setData(null);
        } finally {
            if (requestId === requestIdRef.current) {
                setLoading(false);
            }
        }
    }, []);

    /**
     * Setup WebSocket connection for live updates
     */
    const setupWebSocket = useCallback((sym) => {
        // Close existing connection
        closeWebSocket();
        
        const ws = createWebSocketConnection(
            sym,
            // On message - update specific strikes in real-time
            (tick) => {
                if (tick.type === 'live_tick') {
                    setData(prevData => {
                        if (!prevData) return prevData;
                        
                        // Update the specific strike
                        const updatedRows = prevData.rows.map(row => {
                            if (row.strike === tick.data.strike) {
                                return {
                                    ...row,
                                    ce: {
                                        ...row.ce,
                                        ltp: tick.data.ceLtp ?? row.ce.ltp,
                                        oi: tick.data.ceOi ?? row.ce.oi,
                                        changePercent: tick.data.ceChangePercent ?? row.ce.changePercent,
                                        oiChange: tick.data.ceOiChange ?? row.ce.oiChange,
                                    },
                                    pe: {
                                        ...row.pe,
                                        ltp: tick.data.peLtp ?? row.pe.ltp,
                                        oi: tick.data.peOi ?? row.pe.oi,
                                        changePercent: tick.data.peChangePercent ?? row.pe.changePercent,
                                        oiChange: tick.data.peOiChange ?? row.pe.oiChange,
                                    },
                                };
                            }
                            return row;
                        });
                        
                        return {
                            ...prevData,
                            rows: updatedRows,
                            spotPrice: tick.data.spotPrice ?? prevData.spotPrice,
                            timestamp: new Date().toISOString(),
                        };
                    });
                    setLastUpdated(new Date().toISOString());
                }
            },
            // On error - attempt to reconnect
            (error) => {
                console.error('[WebSocket Error]', error);
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                }
                reconnectTimeoutRef.current = setTimeout(() => {
                    if (marketStatus.isOpen) {
                        setupWebSocket(sym);
                    }
                }, 5000);
            },
            // On close - attempt to reconnect
            () => {
                console.log('[WebSocket] Closed, reconnecting...');
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                }
                reconnectTimeoutRef.current = setTimeout(() => {
                    if (marketStatus.isOpen) {
                        setupWebSocket(sym);
                    }
                }, 3000);
            }
        );
        
        wsRef.current = ws;
    }, [marketStatus.isOpen]);

    /**
     * Close WebSocket connection
     */
    const closeWebSocket = useCallback(() => {
        if (wsRef.current) {
            try {
                wsRef.current.close();
            } catch (err) {
                console.error('[WebSocket] Close error:', err);
            }
            wsRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
    }, []);

    /**
     * Setup polling for when market is closed
     */
    const setupPolling = useCallback((sym, expiry) => {
        // Clear existing polling
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
        
        // Determine polling interval based on market status
        let interval = POLLING_INTERVALS.MARKET_CLOSED;
        if (marketStatus.isOpen) {
            interval = POLLING_INTERVALS.MARKET_OPEN;
        } else if (marketStatus.extendedHours) {
            interval = POLLING_INTERVALS.EXTENDED_HOURS;
        }
        
        pollingIntervalRef.current = setInterval(async () => {
            try {
                const result = await fetchOptionChain(sym, expiry);
                
                // Only update if data has changed
                if (result.timestamp !== data?.timestamp) {
                    setData(result);
                    setMarketStatus(result.marketStatus || { isOpen: false });
                    setLastUpdated(new Date().toISOString());
                }
            } catch (err) {
                console.error('[Polling] Error:', err);
            }
        }, interval);
    }, [data?.timestamp, marketStatus.isOpen, marketStatus.extendedHours]);

    /**
     * Manual refresh - forces live data fetch and updates cache
     */
    const refresh = useCallback(async () => {
        try {
            await refreshOptionChain(symbol);
            // Reload data with forceLive=true
            await load(symbol, data?.selectedExpiry, true);
            return true;
        } catch (err) {
            setError(err.message);
            return false;
        }
    }, [symbol, data?.selectedExpiry, load]);

    /**
     * Change expiry - maintains original behavior
     */
    const changeExpiry = useCallback((expiry) => {
        load(symbol, expiry);
    }, [symbol, load]);

    /**
     * Change symbol - maintains original behavior
     */
    const changeSymbol = useCallback((newSymbol) => {
        if (newSymbol !== symbol) {
            setSymbol(newSymbol);
            closeWebSocket();
            load(newSymbol);
        }
    }, [symbol, load, closeWebSocket]);

    /**
     * Force disconnect WebSocket (useful for cleanup)
     */
    const disconnect = useCallback(() => {
        closeWebSocket();
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
        }
    }, [closeWebSocket]);

    // Initial load - maintains original behavior
    useEffect(() => {
        load(initialSymbol);
        
        // Cleanup on unmount
        return () => {
            closeWebSocket();
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [initialSymbol, load, closeWebSocket]);

    // Reconnect WebSocket when market opens
    useEffect(() => {
        if (marketStatus.isOpen && data) {
            setupWebSocket(symbol);
        }
    }, [marketStatus.isOpen, symbol, data, setupWebSocket]);

    // Return enhanced API while maintaining backward compatibility
    return {
        // Original fields (maintains compatibility)
        symbol,
        setSymbol: changeSymbol,
        data,
        loading,
        error,
        load: changeExpiry,
        
        // New fields for enhanced functionality
        marketStatus,
        isLive,
        lastUpdated,
        refresh,
        disconnect,
        closeWebSocket, // Exposed for manual control if needed
    };
}