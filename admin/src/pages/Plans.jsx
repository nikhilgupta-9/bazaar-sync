import { useCallback, useEffect, useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchCoupons, createCoupon, setCouponActive, deleteCoupon } from "../services/adminApi";
import { formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

function formatDiscount(c) {
    return c.discount_type === "percent" ? `${Number(c.discount_value)}%` : `₹${Number(c.discount_value)}`;
}

export default function Plans() {
    const { token } = useAdminAuth();
    const [coupons, setCoupons] = useState(null);
    const [error, setError] = useState(null);
    const [form, setForm] = useState({ code: "", discountType: "percent", discountValue: "", maxRedemptions: "", expiresAt: "" });
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(() => {
        fetchCoupons(token).then((r) => setCoupons(r.coupons)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleCreate(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        try {
            await createCoupon(token, {
                code: form.code,
                discountType: form.discountType,
                discountValue: Number(form.discountValue),
                maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
                expiresAt: form.expiresAt || null,
            });
            setForm({ code: "", discountType: "percent", discountValue: "", maxRedemptions: "", expiresAt: "" });
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function toggleActive(c) {
        try {
            await setCouponActive(token, c.id, !c.active);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDelete(id) {
        try {
            await deleteCoupon(token, id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <div>
            <TopBar
                title="Plans & Coupons"
                subtitle="The Pro plan catalog (Starter/Pro Trader/Elite) stays fixed in paperTradeConfig.js — this manages discount coupon codes applied at checkout, not a second pricing system."
            />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <Card title="Create a coupon" className="mb-4">
                    <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Code</label>
                            <input
                                required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                                placeholder="WELCOME50"
                                className="w-36 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm uppercase text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Type</label>
                            <select
                                value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            >
                                <option value="percent">Percent off</option>
                                <option value="flat">Flat ₹ off</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Value</label>
                            <input
                                required type="number" min="0" step="0.01" value={form.discountValue}
                                onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                                placeholder={form.discountType === "percent" ? "50" : "100"}
                                className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Max redemptions</label>
                            <input
                                type="number" min="1" value={form.maxRedemptions}
                                onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
                                placeholder="unlimited"
                                className="w-32 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium text-gray-400">Expires (optional)</label>
                            <input
                                type="date" value={form.expiresAt}
                                onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            />
                        </div>
                        <button
                            type="submit" disabled={submitting}
                            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                            {submitting ? "Creating…" : "Create"}
                        </button>
                    </form>
                </Card>

                <Card title={`Coupons${coupons ? ` (${coupons.length})` : ""}`}>
                    {!coupons ? (
                        <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                    ) : coupons.length === 0 ? (
                        <div className="py-10 text-center text-xs text-gray-500">No coupons yet.</div>
                    ) : (
                        <table className="w-full border-collapse text-xs">
                            <thead>
                                <tr className="text-gray-600">
                                    <th className="pb-2 text-left font-medium">Code</th>
                                    <th className="pb-2 text-left font-medium">Discount</th>
                                    <th className="pb-2 text-right font-medium">Redemptions</th>
                                    <th className="pb-2 text-left font-medium">Expires</th>
                                    <th className="pb-2 text-center font-medium">Active</th>
                                    <th className="pb-2 text-right font-medium"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {coupons.map((c) => (
                                    <tr key={c.id}>
                                        <td className="py-2 font-mono font-semibold text-gray-200">{c.code}</td>
                                        <td className="py-2 text-gray-300">{formatDiscount(c)}</td>
                                        <td className="py-2 text-right tabular-nums text-gray-400">
                                            {c.redemption_count}{c.max_redemptions != null ? ` / ${c.max_redemptions}` : ""}
                                        </td>
                                        <td className="py-2 text-gray-500">{c.expires_at ? formatDateTime(c.expires_at) : "never"}</td>
                                        <td className="py-2 text-center">
                                            <button
                                                onClick={() => toggleActive(c)}
                                                className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${c.active ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-gray-500"}`}
                                            >
                                                {c.active ? "Active" : "Inactive"}
                                            </button>
                                        </td>
                                        <td className="py-2 text-right">
                                            <button onClick={() => handleDelete(c.id)} className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Delete">
                                                <FiTrash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Card>
            </div>
        </div>
    );
}
