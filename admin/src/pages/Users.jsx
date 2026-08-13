import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchUsers, fetchUserDetail } from "../services/adminApi";
import { formatRupees, formatPrice, formatDateTime } from "../utils/format";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

function RoleBadge({ role }) {
    return (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${role === "admin" ? "bg-violet-500/15 text-violet-300" : "bg-white/5 text-gray-400"}`}>
            {role}
        </span>
    );
}

function TierBadge({ tier }) {
    return (
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${tier === "pro" ? "bg-amber-500/15 text-amber-300" : "bg-white/5 text-gray-400"}`}>
            {tier}
        </span>
    );
}

function Section({ title, children }) {
    return (
        <div className="mb-4 last:mb-0">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-600">{title}</div>
            {children}
        </div>
    );
}

function UserDetail({ detail }) {
    const { user, strategies, wallet, renewals, positions } = detail;

    return (
        <div>
            <div className="mb-4 flex items-center justify-between">
                <div>
                    <div className="text-sm font-bold text-white">{user.name}</div>
                    <div className="text-xs text-gray-500">{user.email}</div>
                </div>
                <div className="flex gap-1.5">
                    <TierBadge tier={user.tier} />
                    <RoleBadge role={user.role} />
                </div>
            </div>

            <Section title={`Saved Strategies (${strategies.length})`}>
                {strategies.length === 0 ? (
                    <div className="text-xs text-gray-600">None saved.</div>
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

            <Section title="Paper Wallet">
                {!wallet ? (
                    <div className="text-xs text-gray-600">Never touched Paper Trade — no wallet yet.</div>
                ) : (
                    <div className="rounded-lg border border-white/5 bg-white/5 px-2.5 py-2 text-xs">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-500">Balance</span>
                            <span className="font-bold tabular-nums text-white">{formatRupees(wallet.balance)}</span>
                        </div>
                        {wallet.trialExpiresAt && (
                            <div className="mt-1 flex items-center justify-between">
                                <span className="text-gray-500">Trial expires</span>
                                <span className="text-gray-300">{formatDateTime(wallet.trialExpiresAt)}</span>
                            </div>
                        )}
                    </div>
                )}
            </Section>

            <Section title={`Pro Renewal History (${renewals.length})`}>
                {renewals.length === 0 ? (
                    <div className="text-xs text-gray-600">No Pro purchases yet.</div>
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

            <Section title={`Paper Trade Log — Open (${positions.open.length}) / Closed (${positions.closed.length})`}>
                {positions.open.length === 0 && positions.closed.length === 0 ? (
                    <div className="text-xs text-gray-600">No trades yet.</div>
                ) : (
                    <table className="w-full border-collapse text-[11px]">
                        <thead>
                            <tr className="text-gray-600">
                                <th className="py-1 text-left font-medium">Contract</th>
                                <th className="py-1 text-left font-medium">Side</th>
                                <th className="py-1 text-right font-medium">Entry</th>
                                <th className="py-1 text-right font-medium">Exit</th>
                                <th className="py-1 text-right font-medium">P&L</th>
                                <th className="py-1 text-center font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {[...positions.open, ...positions.closed].map((p) => (
                                <tr key={p.id}>
                                    <td className="py-1 text-gray-300">{p.symbol} {p.strike} {p.opt_right}</td>
                                    <td className="py-1 capitalize text-gray-500">{p.side}</td>
                                    <td className="py-1 text-right tabular-nums text-gray-400">{formatPrice(p.entry_price)}</td>
                                    <td className="py-1 text-right tabular-nums text-gray-400">{p.exit_price != null ? formatPrice(p.exit_price) : "-"}</td>
                                    <td className={`py-1 text-right font-medium tabular-nums ${
                                        (p.status === "open" ? p.unrealizedPnl : p.realized_pnl) >= 0 ? "text-emerald-400" : "text-rose-400"
                                    }`}>
                                        {p.status === "open"
                                            ? (p.unrealizedPnl != null ? formatPrice(p.unrealizedPnl) : "-")
                                            : formatPrice(p.realized_pnl)}
                                    </td>
                                    <td className="py-1 text-center capitalize text-gray-500">{p.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>
        </div>
    );
}

export default function Users() {
    const { token } = useAdminAuth();
    const [users, setUsers] = useState(null);
    const [error, setError] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailError, setDetailError] = useState(null);

    useEffect(() => {
        fetchUsers(token).then((res) => setUsers(res.users)).catch((err) => setError(err.message));
    }, [token]);

    const selectUser = useCallback((id) => {
        setSelectedId(id);
        setDetail(null);
        setDetailError(null);
        fetchUserDetail(token, id).then(setDetail).catch((err) => setDetailError(err.message));
    }, [token]);

    return (
        <div>
            <TopBar title="Users" subtitle="Per-user strategies, paper wallet balance, Pro renewal history, and paper-trade log." />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                <div className="flex gap-4">
                    <Card className="w-96 shrink-0 !p-0">
                        <div className="max-h-[75vh] overflow-y-auto">
                            {!users ? (
                                <div className="p-6 text-center text-xs text-gray-500">Loading users…</div>
                            ) : users.length === 0 ? (
                                <div className="p-6 text-center text-xs text-gray-500">No users yet.</div>
                            ) : (
                                users.map((u) => (
                                    <button
                                        key={u.id}
                                        onClick={() => selectUser(u.id)}
                                        className={`flex w-full items-center justify-between border-b border-white/5 px-4 py-3 text-left text-xs transition-colors last:border-0 ${
                                            selectedId === u.id ? "bg-violet-500/10" : "hover:bg-white/5"
                                        }`}
                                    >
                                        <div>
                                            <div className="font-semibold text-gray-200">{u.name}</div>
                                            <div className="text-gray-500">{u.email}</div>
                                        </div>
                                        <div className="flex gap-1.5">
                                            <TierBadge tier={u.tier} />
                                            <RoleBadge role={u.role} />
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </Card>

                    <Card className="flex-1">
                        {!selectedId ? (
                            <div className="py-16 text-center text-xs text-gray-500">Select a user to view details.</div>
                        ) : detailError ? (
                            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{detailError}</div>
                        ) : !detail ? (
                            <div className="py-16 text-center text-xs text-gray-500">Loading…</div>
                        ) : (
                            <UserDetail detail={detail} />
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}
