import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchUsers, fetchUserDetail, addUserPaperBalance, updateUserPlan } from "../services/adminApi";
import { formatRupees, formatPrice, formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";
import { FiPlus, FiCalendar, FiClock, FiCheck, FiDollarSign, FiSearch, FiRefreshCw } from "react-icons/fi";

function RoleBadge({ role }) {
    return (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${role === "admin" ? "bg-violet-500/15 text-violet-300 border border-violet-500/30" : "bg-white/5 text-gray-400 border border-white/10"}`}>
            {role}
        </span>
    );
}

function TierBadge({ tier }) {
    return (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${tier === "pro" ? "bg-amber-500/15 text-amber-300 border border-amber-500/30" : "bg-white/5 text-gray-400 border border-white/10"}`}>
            {tier}
        </span>
    );
}

function Section({ title, children }) {
    return (
        <div className="mb-4 last:mb-0">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">{title}</div>
            {children}
        </div>
    );
}

function getPlanStatus(user) {
    if (!user || user.tier !== "pro") {
        return { label: "Free Tier", badgeClass: "bg-white/5 text-gray-400 border-white/10", active: false };
    }
    if (!user.pro_expires_at) {
        return { label: "Lifetime Pro", badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30", active: true };
    }
    const diff = new Date(user.pro_expires_at).getTime() - Date.now();
    if (diff > 0) {
        const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        return {
            label: `Pro Active (${days}d left)`,
            badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
            active: true,
            daysRemaining: days,
        };
    }
    return { label: "Pro Expired", badgeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30", active: false };
}

function UserDetail({ detail, token, onUserUpdated, onWalletUpdated }) {
    const { user, strategies, wallet, renewals, positions } = detail;
    const planStatus = getPlanStatus(user);

    // Plan Management state
    const [planLoading, setPlanLoading] = useState(false);
    const [planMsg, setPlanMsg] = useState(null);
    const [planError, setPlanError] = useState(null);
    const [customExpiry, setCustomExpiry] = useState("");

    // Paper Balance state
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [balanceMsg, setBalanceMsg] = useState(null);
    const [balanceError, setBalanceError] = useState(null);
    const [customAmount, setCustomAmount] = useState("");
    const [balanceNote, setBalanceNote] = useState("");

    const handleExtendPlan = async (days) => {
        setPlanLoading(true);
        setPlanMsg(null);
        setPlanError(null);
        try {
            const res = await updateUserPlan(token, user.id, { daysToAdd: days });
            setPlanMsg(`Extended Pro plan by ${days} days! New expiry: ${formatDateTime(res.user.pro_expires_at)}`);
            onUserUpdated(res.user);
            if (res.wallet) onWalletUpdated(res.wallet);
        } catch (err) {
            setPlanError(err.message || "Failed to extend plan");
        } finally {
            setPlanLoading(false);
        }
    };

    const handleSetCustomExpiry = async (e) => {
        e.preventDefault();
        if (!customExpiry) return;
        setPlanLoading(true);
        setPlanMsg(null);
        setPlanError(null);
        try {
            const dateObj = new Date(customExpiry + "T23:59:59");
            const res = await updateUserPlan(token, user.id, { proExpiresAt: dateObj.toISOString(), tier: "pro" });
            setPlanMsg(`Pro expiry updated to ${formatDateTime(res.user.pro_expires_at)}`);
            setCustomExpiry("");
            onUserUpdated(res.user);
            if (res.wallet) onWalletUpdated(res.wallet);
        } catch (err) {
            setPlanError(err.message || "Failed to update expiry date");
        } finally {
            setPlanLoading(false);
        }
    };

    const handleSetTier = async (newTier) => {
        setPlanLoading(true);
        setPlanMsg(null);
        setPlanError(null);
        try {
            const payload = { tier: newTier };
            if (newTier === "pro" && (!user.pro_expires_at || new Date(user.pro_expires_at) <= new Date())) {
                payload.daysToAdd = 30; // default to 30 days if making Pro
            }
            const res = await updateUserPlan(token, user.id, payload);
            setPlanMsg(newTier === "pro" ? `Set to Pro plan (${formatDateTime(res.user.pro_expires_at)})` : "Downgraded to Free tier");
            onUserUpdated(res.user);
            if (res.wallet) onWalletUpdated(res.wallet);
        } catch (err) {
            setPlanError(err.message || "Failed to change tier");
        } finally {
            setPlanLoading(false);
        }
    };

    const handleAddBalance = async (amountToAdd, note = "") => {
        const amt = Number(amountToAdd);
        if (!amt || isNaN(amt)) return;
        setBalanceLoading(true);
        setBalanceMsg(null);
        setBalanceError(null);
        try {
            const res = await addUserPaperBalance(token, user.id, {
                amount: amt,
                note: note || (amt >= 0 ? `Admin credit +₹${amt.toLocaleString("en-IN")}` : `Admin adjustment`),
            });
            setBalanceMsg(`Added ${formatRupees(amt)} to paper wallet! New balance: ${formatRupees(res.wallet.balance)}`);
            setCustomAmount("");
            setBalanceNote("");
            onWalletUpdated(res.wallet, res.ledger);
        } catch (err) {
            setBalanceError(err.message || "Failed to add balance");
        } finally {
            setBalanceLoading(false);
        }
    };

    return (
        <div className="space-y-5">
            {/* User Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-4">
                <div>
                    <div className="text-base font-bold text-white flex items-center gap-2">
                        {user.name}
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border ${planStatus.badgeClass}`}>
                            {planStatus.label}
                        </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{user.email} · ID #{user.id} · Joined {formatDateTime(user.created_at)}</div>
                </div>
                <div className="flex items-center gap-1.5">
                    <TierBadge tier={user.tier} />
                    <RoleBadge role={user.role} />
                </div>
            </div>

            {/* Plan / Subscription Management */}
            <Section title="Subscription & Plan Management">
                <div className="rounded-xl border border-white/10 bg-[#16161d] p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                            <span className="text-gray-400">Current Expiry:</span>
                            <span className="font-semibold text-white">
                                {user.pro_expires_at ? formatDateTime(user.pro_expires_at) : (user.tier === "pro" ? "Lifetime Pro" : "None (Free Tier)")}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {user.tier === "free" ? (
                                <button
                                    type="button"
                                    disabled={planLoading}
                                    onClick={() => handleSetTier("pro")}
                                    className="rounded-lg bg-amber-500/20 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                                >
                                    Activate Pro (30 Days)
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    disabled={planLoading}
                                    onClick={() => handleSetTier("free")}
                                    className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-1 text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
                                >
                                    Set to Free Tier
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Quick Extend Buttons */}
                    <div>
                        <div className="text-[11px] font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                            <FiClock className="text-violet-400" /> Quick Extend Plan Date:
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { label: "+30 Days (1 Mo)", days: 30 },
                                { label: "+90 Days (3 Mo)", days: 90 },
                                { label: "+180 Days (6 Mo)", days: 180 },
                                { label: "+365 Days (1 Yr)", days: 365 },
                            ].map((btn) => (
                                <button
                                    key={btn.days}
                                    type="button"
                                    disabled={planLoading}
                                    onClick={() => handleExtendPlan(btn.days)}
                                    className="rounded-lg border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 px-3 py-1.5 text-xs font-semibold text-violet-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                                >
                                    <FiPlus className="text-xs" /> {btn.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Custom Expiry Date */}
                    <form onSubmit={handleSetCustomExpiry} className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
                        <label className="text-[11px] text-gray-400 flex items-center gap-1">
                            <FiCalendar className="text-gray-400" /> Set Specific Expiry:
                        </label>
                        <input
                            type="date"
                            value={customExpiry}
                            onChange={(e) => setCustomExpiry(e.target.value)}
                            disabled={planLoading}
                            className="rounded-lg border border-white/10 bg-[#0d0d12] px-2.5 py-1 text-xs text-white focus:border-violet-500 focus:outline-none"
                        />
                        <button
                            type="submit"
                            disabled={planLoading || !customExpiry}
                            className="rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-1 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                        >
                            Save Date
                        </button>
                    </form>

                    {/* Plan Feedback */}
                    {planMsg && (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 flex items-center gap-1.5">
                            <FiCheck className="text-emerald-400 shrink-0" /> {planMsg}
                        </div>
                    )}
                    {planError && (
                        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
                            {planError}
                        </div>
                    )}
                </div>
            </Section>

            {/* Paper Wallet & Virtual Capital Refill */}
            <Section title="Paper Trade Wallet & Balance">
                <div className="rounded-xl border border-white/10 bg-[#16161d] p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <span className="text-[11px] text-gray-400 uppercase font-semibold">Available Virtual Balance</span>
                            <div className="text-xl font-bold tabular-nums text-emerald-400 mt-0.5">
                                {wallet ? formatRupees(wallet.balance) : "₹0.00 (No wallet yet)"}
                            </div>
                        </div>
                        {wallet?.trialExpiresAt && (
                            <div className="text-right text-xs">
                                <span className="text-gray-400">Trial Period Expires: </span>
                                <span className="text-gray-200 font-medium">{formatDateTime(wallet.trialExpiresAt)}</span>
                            </div>
                        )}
                    </div>

                    {/* Quick Add Balance Buttons */}
                    <div>
                        <div className="text-[11px] font-medium text-gray-400 mb-1.5 flex items-center gap-1">
                            <FiPlus className="text-emerald-400" /> Quick Add Balance:
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { label: "+₹50,000", amt: 50000 },
                                { label: "+₹1,00,000", amt: 100000 },
                                { label: "+₹5,00,000", amt: 500000 },
                                { label: "+₹10,00,000", amt: 1000000 },
                            ].map((chip) => (
                                <button
                                    key={chip.amt}
                                    type="button"
                                    disabled={balanceLoading}
                                    onClick={() => handleAddBalance(chip.amt)}
                                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors disabled:opacity-50"
                                >
                                    {chip.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Custom Amount Form */}
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleAddBalance(customAmount, balanceNote);
                        }}
                        className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/5"
                    >
                        <div className="w-36">
                            <input
                                type="number"
                                placeholder="₹ Custom Amount"
                                value={customAmount}
                                onChange={(e) => setCustomAmount(e.target.value)}
                                disabled={balanceLoading}
                                className="w-full rounded-lg border border-white/10 bg-[#0d0d12] px-2.5 py-1 text-xs text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                            />
                        </div>
                        <div className="flex-1 min-w-[140px]">
                            <input
                                type="text"
                                placeholder="Note (e.g. Virtual bonus)"
                                value={balanceNote}
                                onChange={(e) => setBalanceNote(e.target.value)}
                                disabled={balanceLoading}
                                className="w-full rounded-lg border border-white/10 bg-[#0d0d12] px-2.5 py-1 text-xs text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={balanceLoading || !customAmount || Number(customAmount) === 0}
                            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                        >
                            Add Funds
                        </button>
                    </form>

                    {/* Balance Feedback */}
                    {balanceMsg && (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 flex items-center gap-1.5">
                            <FiCheck className="text-emerald-400 shrink-0" /> {balanceMsg}
                        </div>
                    )}
                    {balanceError && (
                        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
                            {balanceError}
                        </div>
                    )}
                </div>
            </Section>

            {/* Saved Strategies */}
            <Section title={`Saved Strategies (${strategies.length})`}>
                {strategies.length === 0 ? (
                    <div className="text-xs text-gray-500">None saved.</div>
                ) : (
                    <div className="space-y-1">
                        {strategies.map((s) => (
                            <div key={s.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs">
                                <span className="font-medium text-gray-200">{s.name}</span>
                                <span className="text-gray-500">{s.underlying} · {formatDateTime(s.created_at)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            {/* Pro Renewal & Purchase History */}
            <Section title={`Pro Renewal History (${renewals.length})`}>
                {renewals.length === 0 ? (
                    <div className="text-xs text-gray-500">No Pro purchases yet.</div>
                ) : (
                    <div className="space-y-1">
                        {renewals.map((r, i) => (
                            <div key={i} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-2.5 py-1.5 text-xs">
                                <span className="text-gray-300">{formatDateTime(r.created_at)}</span>
                                <span className="font-medium tabular-nums text-emerald-400">+{formatRupees(r.amount)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </Section>

            {/* Paper Trade Log */}
            <Section title={`Paper Trade Log — Open (${positions.open.length}) / Closed (${positions.closed.length})`}>
                {positions.open.length === 0 && positions.closed.length === 0 ? (
                    <div className="text-xs text-gray-500">No trades yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-[11px]">
                            <thead>
                                <tr className="text-gray-500 border-b border-white/10">
                                    <th className="py-1.5 text-left font-medium">Contract</th>
                                    <th className="py-1.5 text-left font-medium">Side</th>
                                    <th className="py-1.5 text-right font-medium">Entry</th>
                                    <th className="py-1.5 text-right font-medium">Exit</th>
                                    <th className="py-1.5 text-right font-medium">P&L</th>
                                    <th className="py-1.5 text-center font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {[...positions.open, ...positions.closed].map((p) => (
                                    <tr key={p.id}>
                                        <td className="py-1.5 text-gray-300">{p.symbol} {p.strike} {p.opt_right}</td>
                                        <td className="py-1.5 capitalize text-gray-400">{p.side}</td>
                                        <td className="py-1.5 text-right tabular-nums text-gray-300">{formatPrice(p.entry_price)}</td>
                                        <td className="py-1.5 text-right tabular-nums text-gray-300">{p.exit_price != null ? formatPrice(p.exit_price) : "-"}</td>
                                        <td className={`py-1.5 text-right font-medium tabular-nums ${
                                            (p.status === "open" ? p.unrealizedPnl : p.realized_pnl) >= 0 ? "text-emerald-400" : "text-rose-400"
                                        }`}>
                                            {p.status === "open"
                                                ? (p.unrealizedPnl != null ? formatPrice(p.unrealizedPnl) : "-")
                                                : formatPrice(p.realized_pnl)}
                                        </td>
                                        <td className="py-1.5 text-center capitalize text-gray-400">{p.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Section>
        </div>
    );
}

export default function Users() {
    const { token } = useAdminAuth();
    const [users, setUsers] = useState(null);
    const [search, setSearch] = useState("");
    const [error, setError] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailError, setDetailError] = useState(null);

    const loadUsers = useCallback(() => {
        fetchUsers(token).then((res) => setUsers(res.users)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const selectUser = useCallback((id) => {
        setSelectedId(id);
        setDetail(null);
        setDetailError(null);
        fetchUserDetail(token, id).then(setDetail).catch((err) => setDetailError(err.message));
    }, [token]);

    const handleUserUpdated = useCallback((updatedUser) => {
        setUsers((prev) => (prev ? prev.map((u) => (u.id === updatedUser.id ? { ...u, ...updatedUser } : u)) : prev));
        setDetail((prev) => (prev ? { ...prev, user: { ...prev.user, ...updatedUser } } : prev));
    }, []);

    const handleWalletUpdated = useCallback((updatedWallet, newLedger) => {
        setUsers((prev) => (prev ? prev.map((u) => (u.id === selectedId ? { ...u, paper_balance: updatedWallet.balance } : u)) : prev));
        setDetail((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                wallet: updatedWallet,
                ledger: newLedger || prev.ledger,
            };
        });
    }, [selectedId]);

    const filteredUsers = users
        ? users.filter((u) => {
              if (!search.trim()) return true;
              const q = search.toLowerCase();
              return (u.name && u.name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q));
          })
        : [];

    return (
        <div>
            <TopBar title="Users" subtitle="Per-user strategies, paper wallet balance, plan extension, Pro renewal history, and paper-trade log." />
            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-4">
                {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 font-medium">{error}</div>}

                <div className="flex flex-col lg:flex-row gap-4">
                    {/* Left Panel: User List */}
                    <Card className="w-full lg:w-96 lg:shrink-0" bodyClassName="p-0">
                        {/* Search bar */}
                        <div className="p-3 border-b border-white/10">
                            <div className="relative">
                                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" />
                                <input
                                    type="text"
                                    placeholder="Search name or email..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="w-full rounded-lg border border-white/10 bg-[#0d0d12] pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:border-violet-500 focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="max-h-[75vh] overflow-y-auto divide-y divide-white/5">
                            {!users ? (
                                <div className="p-6 text-center text-xs text-gray-500">Loading users…</div>
                            ) : filteredUsers.length === 0 ? (
                                <div className="p-6 text-center text-xs text-gray-500">
                                    {search ? "No matching users found." : "No users yet."}
                                </div>
                            ) : (
                                filteredUsers.map((u) => (
                                    <button
                                        key={u.id}
                                        type="button"
                                        onClick={() => selectUser(u.id)}
                                        className={`flex w-full items-center justify-between px-4 py-3 text-left text-xs transition-colors ${
                                            selectedId === u.id ? "bg-violet-500/15 border-l-2 border-violet-500" : "hover:bg-white/5"
                                        }`}
                                    >
                                        <div className="truncate mr-2">
                                            <div className="font-semibold text-gray-200 truncate">{u.name}</div>
                                            <div className="text-gray-400 text-[11px] truncate">{u.email}</div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <div className="flex gap-1 items-center">
                                                <TierBadge tier={u.tier} />
                                                <RoleBadge role={u.role} />
                                            </div>
                                            {u.paper_balance != null && (
                                                <span className="text-[10px] font-mono font-semibold text-emerald-400">
                                                    {formatRupees(u.paper_balance)}
                                                </span>
                                            )}
                                            {u.tier === "pro" && u.pro_expires_at && (
                                                <span className="text-[10px] text-gray-500">
                                                    Exp: {new Date(u.pro_expires_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </Card>

                    {/* Right Panel: Selected User Detail */}
                    <Card className="flex-1">
                        {!selectedId ? (
                            <div className="py-24 text-center text-xs text-gray-500 flex flex-col items-center gap-2">
                                <FiSearch className="text-2xl text-gray-600" />
                                Select a user from the list to view and manage details.
                            </div>
                        ) : detailError ? (
                            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{detailError}</div>
                        ) : !detail ? (
                            <div className="py-24 text-center text-xs text-gray-500 flex flex-col items-center gap-2">
                                <FiRefreshCw className="text-xl animate-spin text-gray-600" />
                                Loading user details…
                            </div>
                        ) : (
                            <UserDetail
                                detail={detail}
                                token={token}
                                onUserUpdated={handleUserUpdated}
                                onWalletUpdated={handleWalletUpdated}
                            />
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}
