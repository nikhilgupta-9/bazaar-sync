import { useCallback, useEffect, useState } from "react";
import { FiTrash2, FiEdit2 } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import {
    fetchPlansAdmin, createPlan, updatePlan, setPlanActive, deletePlan,
    fetchCoupons, createCoupon, setCouponActive, deleteCoupon,
} from "../services/adminApi";
import { formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

function formatDiscount(c) {
    return c.discount_type === "percent" ? `${Number(c.discount_value)}%` : `₹${Number(c.discount_value)}`;
}

const EMPTY_PLAN_FORM = { id: "", name: "", durationLabel: "", days: "", priceInRupees: "", badge: "", sortOrder: "" };

function PlansSection({ token }) {
    const [plans, setPlans] = useState(null);
    const [error, setError] = useState(null);
    const [form, setForm] = useState(EMPTY_PLAN_FORM);
    const [editingId, setEditingId] = useState(null); // null = create mode
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(() => {
        fetchPlansAdmin(token).then((r) => setPlans(r.plans)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    function startEdit(p) {
        setEditingId(p.id);
        setForm({
            id: p.id, name: p.name, durationLabel: p.duration_label,
            days: String(p.days), priceInRupees: String(p.price_in_paise / 100),
            badge: p.badge || "", sortOrder: String(p.sort_order),
        });
    }

    function cancelEdit() {
        setEditingId(null);
        setForm(EMPTY_PLAN_FORM);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);
        const payload = {
            id: form.id.trim().toLowerCase(),
            name: form.name.trim(),
            durationLabel: form.durationLabel.trim(),
            days: Number(form.days),
            priceInPaise: Math.round(Number(form.priceInRupees) * 100),
            badge: form.badge.trim() || null,
            sortOrder: form.sortOrder === "" ? 0 : Number(form.sortOrder),
        };
        try {
            if (editingId) {
                await updatePlan(token, editingId, payload);
            } else {
                await createPlan(token, payload);
            }
            cancelEdit();
            load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    }

    async function toggleActive(p) {
        try {
            await setPlanActive(token, p.id, !p.active);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    async function handleDelete(id) {
        try {
            await deletePlan(token, id);
            load();
        } catch (err) {
            setError(err.message);
        }
    }

    return (
        <>
            {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

            <Card title={editingId ? `Edit plan "${editingId}"` : "Create a plan"} className="mb-4">
                <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
                    <div className="w-28">
                        <label className="mb-1 block text-xs font-medium text-gray-400">ID (slug)</label>
                        <input
                            required disabled={!!editingId} value={form.id}
                            onChange={(e) => setForm({ ...form, id: e.target.value })}
                            placeholder="3m"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500 disabled:opacity-50"
                        />
                    </div>
                    <div className="w-32">
                        <label className="mb-1 block text-xs font-medium text-gray-400">Name</label>
                        <input
                            required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="Starter"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>
                    <div className="w-32">
                        <label className="mb-1 block text-xs font-medium text-gray-400">Duration label</label>
                        <input
                            required value={form.durationLabel} onChange={(e) => setForm({ ...form, durationLabel: e.target.value })}
                            placeholder="1 Month"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>
                    <div className="w-20">
                        <label className="mb-1 block text-xs font-medium text-gray-400">Days</label>
                        <input
                            required type="number" min="1" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })}
                            placeholder="30"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>
                    <div className="w-24">
                        <label className="mb-1 block text-xs font-medium text-gray-400">Price (₹)</label>
                        <input
                            required type="number" min="1" step="0.01" value={form.priceInRupees}
                            onChange={(e) => setForm({ ...form, priceInRupees: e.target.value })}
                            placeholder="499"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>
                    <div className="w-28">
                        <label className="mb-1 block text-xs font-medium text-gray-400">Badge (optional)</label>
                        <input
                            value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })}
                            placeholder="Trending"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>
                    <div className="w-20">
                        <label className="mb-1 block text-xs font-medium text-gray-400">Sort</label>
                        <input
                            type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                            placeholder="0"
                            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                        />
                    </div>
                    <button
                        type="submit" disabled={submitting}
                        className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                        {submitting ? "Saving…" : editingId ? "Update" : "Create"}
                    </button>
                    {editingId && (
                        <button type="button" onClick={cancelEdit} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 hover:bg-white/5">
                            Cancel
                        </button>
                    )}
                </form>
            </Card>

            <Card title={`Plans${plans ? ` (${plans.length})` : ""}`} className="mb-6">
                {!plans ? (
                    <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                ) : plans.length === 0 ? (
                    <div className="py-10 text-center text-xs text-gray-500">No plans yet — the Pricing page will show nothing until one is created.</div>
                ) : (
                    <table className="w-full border-collapse text-xs">
                        <thead>
                            <tr className="text-gray-600">
                                <th className="pb-2 text-left font-medium">ID</th>
                                <th className="pb-2 text-left font-medium">Name</th>
                                <th className="pb-2 text-left font-medium">Duration</th>
                                <th className="pb-2 text-right font-medium">Days</th>
                                <th className="pb-2 text-right font-medium">Price</th>
                                <th className="pb-2 text-left font-medium">Badge</th>
                                <th className="pb-2 text-center font-medium">Active</th>
                                <th className="pb-2 text-right font-medium"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {plans.map((p) => (
                                <tr key={p.id}>
                                    <td className="py-2 font-mono font-semibold text-gray-200">{p.id}</td>
                                    <td className="py-2 text-gray-300">{p.name}</td>
                                    <td className="py-2 text-gray-400">{p.duration_label}</td>
                                    <td className="py-2 text-right tabular-nums text-gray-400">{p.days}</td>
                                    <td className="py-2 text-right tabular-nums text-gray-300">₹{Math.round(p.price_in_paise / 100).toLocaleString("en-IN")}</td>
                                    <td className="py-2 text-gray-500">{p.badge || "—"}</td>
                                    <td className="py-2 text-center">
                                        <button
                                            onClick={() => toggleActive(p)}
                                            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${p.active ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-gray-500"}`}
                                        >
                                            {p.active ? "Active" : "Inactive"}
                                        </button>
                                    </td>
                                    <td className="py-2 text-right">
                                        <button onClick={() => startEdit(p)} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/10 hover:text-gray-200" aria-label="Edit">
                                            <FiEdit2 className="h-3.5 w-3.5" />
                                        </button>
                                        <button onClick={() => handleDelete(p.id)} className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400" aria-label="Delete">
                                            <FiTrash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>
        </>
    );
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
                subtitle="Manage the Pro plan catalog shown on the public Pricing page, and discount coupon codes applied at checkout."
            />
            <div className="p-6">
                <PlansSection token={token} />

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
