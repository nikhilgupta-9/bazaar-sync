// pages/LotSizeHistory.jsx — admin-entered historical F&O lot sizes,
// effective-dated. NSE revises lot sizes periodically (SEBI-driven review,
// roughly every 6 months) — Simulator/Backtest need the lot size that was
// actually in effect on a historical trade date, not today's, and none of
// our data sources (Bhavcopy/Breeze/Upstox, Angel One's scrip master) carry
// that historically. See server/services/lotSizeHistoryService.js's header
// comment: this is deliberately admin-entered from NSE's own published
// lot-size-revision circulars, not auto-populated or guessed.
import { useCallback, useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchLotSizeHistory, addLotSizeHistoryEntry, removeLotSizeHistoryEntry } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

export default function LotSizeHistory() {
    const { token } = useAdminAuth();
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState(null);
    const [symbol, setSymbol] = useState("");
    const [lotSize, setLotSize] = useState("");
    const [effectiveFrom, setEffectiveFrom] = useState("");
    const [effectiveTo, setEffectiveTo] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(() => {
        fetchLotSizeHistory(token).then((r) => setEntries(r.entries)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleAdd(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await addLotSizeHistoryEntry(token, {
                symbol: symbol.trim(),
                lotSize: Number(lotSize),
                effectiveFrom,
                effectiveTo: effectiveTo || null,
            });
            setSymbol("");
            setLotSize("");
            setEffectiveFrom("");
            setEffectiveTo("");
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRemove(id) {
        try {
            await removeLotSizeHistoryEntry(token, id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div>
            <TopBar
                title="Lot Size History"
                subtitle="Real historical F&O lot sizes, effective-dated — Simulator and Backtest use the value in effect on the historical trade date, not today's. Enter these from NSE's own published lot-size-revision circulars only; nothing here is auto-populated or guessed."
            />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="Add an entry" className="mb-4">
                    <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
                        <div className="min-w-[120px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Symbol</label>
                            <input
                                required value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                placeholder="NIFTY"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="min-w-[100px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Lot size</label>
                            <input
                                required type="number" min="1" value={lotSize} onChange={(e) => setLotSize(e.target.value)}
                                placeholder="75"
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="min-w-[160px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Effective from</label>
                            <input
                                required type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div className="min-w-[160px]">
                            <label className="mb-1 block text-xs font-medium text-gray-400">Effective to (optional)</label>
                            <input
                                type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <button
                            type="submit" disabled={submitting}
                            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                            {submitting ? "Adding…" : "Add"}
                        </button>
                    </form>
                </Card>

                <Card title={`Entries${entries ? ` (${entries.length})` : ""}`}>
                    {!entries ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : entries.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500">
                            No entries yet — Simulator/Backtest fall back to today's live scrip-master lot size until real historical coverage is entered here.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {entries.map((e) => (
                                <div key={e.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm">
                                    <div>
                                        <span className="font-mono font-medium text-gray-200">{e.symbol}</span>
                                        <span className="ml-2 text-gray-300">lot {e.lot_size}</span>
                                        <div className="text-xs text-gray-500">
                                            {e.effective_from} → {e.effective_to || "present"}
                                        </div>
                                    </div>
                                    <button onClick={() => handleRemove(e.id)} className="rounded-lg p-2 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Remove">
                                        <FiTrash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
