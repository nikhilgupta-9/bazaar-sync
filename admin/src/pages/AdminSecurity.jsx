// admin/src/pages/AdminSecurity.jsx — Admin IP Restriction & Security Control
import { useCallback, useEffect, useState } from "react";
import {
    FiShield,
    FiLock,
    FiUnlock,
    FiPlus,
    FiTrash2,
    FiCheckCircle,
    FiAlertTriangle,
    FiGlobe,
    FiRefreshCw,
    FiInfo,
} from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import {
    fetchAdminSecurityStatus,
    toggleAdminIpRestriction,
    addAdminAllowedIp,
    removeAdminAllowedIp,
} from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

export default function AdminSecurity() {
    const { token } = useAdminAuth();
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState(false);
    const [error, setError] = useState(null);
    const [successMsg, setSuccessMsg] = useState(null);

    // Form inputs
    const [ipOrCidr, setIpOrCidr] = useState("");
    const [label, setLabel] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const loadStatus = useCallback(async () => {
        try {
            setError(null);
            const data = await fetchAdminSecurityStatus(token);
            setStatus(data);
        } catch (err) {
            setError(err.message || "Failed to load security status");
        } finally {
            setLoading(false);
        }
    }, [token]);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    async function handleToggle(enable) {
        if (enable && status?.allowedIps?.length === 0 && !status?.clientIp) {
            if (!window.confirm("Warning: No allowed IPs found. Enabling this may lock you out. Proceed?")) {
                return;
            }
        }
        setToggling(true);
        setError(null);
        setSuccessMsg(null);
        try {
            const res = await toggleAdminIpRestriction(token, enable);
            setSuccessMsg(
                enable
                    ? "Admin IP Whitelist enforcement is now ACTIVE! Only allowed IPs can access Admin."
                    : "Admin IP Restriction has been DISABLED. Admin is now open to all IPs with valid credentials."
            );
            await loadStatus();
        } catch (err) {
            setError(err.message || "Failed to toggle IP restriction");
        } finally {
            setToggling(false);
        }
    }

    async function handleAdd(e) {
        if (e) e.preventDefault();
        if (!ipOrCidr.trim()) return;
        setError(null);
        setSuccessMsg(null);
        setSubmitting(true);
        try {
            await addAdminAllowedIp(token, { ipOrCidr: ipOrCidr.trim(), label: label.trim() });
            setSuccessMsg(`IP '${ipOrCidr.trim()}' added to authorized whitelist.`);
            setIpOrCidr("");
            setLabel("");
            await loadStatus();
        } catch (err) {
            setError(err.message || "Failed to add IP entry");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleAddCurrentIp() {
        if (!status?.clientIp) return;
        setError(null);
        setSuccessMsg(null);
        setSubmitting(true);
        try {
            await addAdminAllowedIp(token, {
                ipOrCidr: status.clientIp,
                label: "Current Admin IP (Auto)",
            });
            setSuccessMsg(`Your current IP (${status.clientIp}) has been whitelisted!`);
            await loadStatus();
        } catch (err) {
            setError(err.message || "Failed to add current IP");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleRemove(id, entryIp) {
        if (status?.isRestricted && (entryIp === status?.clientIp || entryIp === "127.0.0.1" || entryIp === "::1")) {
            const proceed = window.confirm(
                `Warning: You are removing '${entryIp}' which matches your current or local connection while IP restriction is ACTIVE. You might lock yourself out. Are you sure?`
            );
            if (!proceed) return;
        }

        try {
            setError(null);
            setSuccessMsg(null);
            await removeAdminAllowedIp(token, id);
            setSuccessMsg(`IP entry removed from whitelist.`);
            await loadStatus();
        } catch (err) {
            setError(err.message || "Failed to remove IP");
        }
    }

    const isCurrentIpWhitelisted =
        status?.allowedIps?.some((item) => item.ip_or_cidr === status?.clientIp) ||
        status?.clientIp === "127.0.0.1" ||
        status?.clientIp === "::1";

    return (
        <div>
            <TopBar
                title="Admin Security & IP Whitelist"
                subtitle="Configure IP address access control for the Admin Console. Only allow connections from verified IP addresses or subnets."
            />

            <div className="p-3.5 sm:p-6 max-w-7xl mx-auto space-y-6">
                {/* Alerts */}
                {error && (
                    <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                        <FiAlertTriangle className="shrink-0 text-sm" />
                        <span>{error}</span>
                    </div>
                )}
                {successMsg && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-300">
                        <FiCheckCircle className="shrink-0 text-sm" />
                        <span>{successMsg}</span>
                    </div>
                )}

                {/* Status Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Restriction Status Card */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-[#0b1420]/80 p-5 shadow-xl backdrop-blur-md">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div
                                    className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg ${
                                        status?.isRestricted
                                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-lg shadow-emerald-500/10"
                                            : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                                    }`}
                                >
                                    {status?.isRestricted ? <FiLock /> : <FiUnlock />}
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-white">IP Enforcement Mode</h3>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        {status?.isRestricted
                                            ? "Strict Whitelist Active: Only authorized IPs can open Admin."
                                            : "Open Access: Anyone with admin credentials can log in."}
                                    </p>
                                </div>
                            </div>
                            <span
                                className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ${
                                    status?.isRestricted
                                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                        : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                }`}
                            >
                                {status?.isRestricted ? "Strict Lock ON" : "Enforcement OFF"}
                            </span>
                        </div>

                        <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                            <span className="text-xs text-gray-400">
                                {status?.isRestricted
                                    ? "Turn off restriction to allow access from any IP"
                                    : "Enable restriction to enforce IP protection"}
                            </span>
                            <button
                                type="button"
                                disabled={toggling || loading}
                                onClick={() => handleToggle(!status?.isRestricted)}
                                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 ${
                                    status?.isRestricted
                                        ? "bg-rose-600/90 text-white hover:bg-rose-600 shadow-rose-900/30"
                                        : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-900/30"
                                }`}
                            >
                                {toggling ? "Updating..." : status?.isRestricted ? "Disable Restriction" : "Enable IP Restriction"}
                            </button>
                        </div>
                    </div>

                    {/* Detected IP Card */}
                    <div className="rounded-2xl border border-emerald-500/20 bg-[#0b1420]/80 p-5 shadow-xl backdrop-blur-md">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/30 text-lg">
                                    <FiGlobe />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-white">Your Current Network IP</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <code className="rounded bg-black/40 px-2 py-0.5 text-xs font-mono font-bold text-emerald-400 border border-emerald-500/20">
                                            {status?.clientIp || "Detecting..."}
                                        </code>
                                        {isCurrentIpWhitelisted ? (
                                            <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                                                <FiCheckCircle /> Whitelisted
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
                                                <FiAlertTriangle /> Not in Whitelist
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                            <span className="text-xs text-gray-400">Add your active IP with one click</span>
                            <button
                                type="button"
                                disabled={submitting || isCurrentIpWhitelisted || !status?.clientIp}
                                onClick={handleAddCurrentIp}
                                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition-all active:scale-95 disabled:opacity-40"
                            >
                                {isCurrentIpWhitelisted ? "Already Whitelisted" : "+ Add My Current IP"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Add New IP Form */}
                <Card title="Add Authorized IP or Subnet Range">
                    <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                        <div className="md:col-span-5">
                            <label className="mb-1 block text-xs font-medium text-gray-400">
                                IP Address or CIDR Range
                            </label>
                            <input
                                type="text"
                                required
                                value={ipOrCidr}
                                onChange={(e) => setIpOrCidr(e.target.value)}
                                placeholder="e.g. 122.161.45.10 or 103.21.244.0/24"
                                className="w-full rounded-xl border border-emerald-500/20 bg-[#070e17]/80 px-3.5 py-2.5 text-xs text-white placeholder-gray-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
                            />
                        </div>
                        <div className="md:col-span-5">
                            <label className="mb-1 block text-xs font-medium text-gray-400">
                                Label / Description (Optional)
                            </label>
                            <input
                                type="text"
                                value={label}
                                onChange={(e) => setLabel(e.target.value)}
                                placeholder="e.g. Office Static IP, Admin Home, Cloud VPN"
                                className="w-full rounded-xl border border-emerald-500/20 bg-[#070e17]/80 px-3.5 py-2.5 text-xs text-white placeholder-gray-500 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30"
                            />
                        </div>
                        <div className="md:col-span-2">
                            <button
                                type="submit"
                                disabled={submitting || !ipOrCidr.trim()}
                                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 transition-all shadow-md shadow-emerald-950/40 active:scale-95 disabled:opacity-50"
                            >
                                <FiPlus className="text-sm" />
                                {submitting ? "Adding..." : "Add IP"}
                            </button>
                        </div>
                    </form>
                </Card>

                {/* Authorized IPs Table */}
                <Card
                    title={`Whitelisted IP Addresses (${status?.allowedIps?.length || 0})`}
                    action={
                        <button
                            type="button"
                            onClick={loadStatus}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-emerald-400 transition"
                        >
                            <FiRefreshCw className="text-xs" /> Refresh
                        </button>
                    }
                >
                    {loading ? (
                        <div className="py-8 text-center text-xs text-gray-500">Loading IP whitelist...</div>
                    ) : status?.allowedIps?.length === 0 ? (
                        <div className="py-8 text-center text-xs text-gray-500">
                            No IP addresses in whitelist yet.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-white/5 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                                        <th className="pb-3 pl-2">IP / Subnet CIDR</th>
                                        <th className="pb-3">Label / Device</th>
                                        <th className="pb-3">Match Status</th>
                                        <th className="pb-3">Added Date</th>
                                        <th className="pb-3 pr-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5">
                                    {status.allowedIps.map((entry) => {
                                        const isCurrent =
                                            entry.ip_or_cidr === status.clientIp ||
                                            (status.clientIp === "::1" && entry.ip_or_cidr === "127.0.0.1") ||
                                            (status.clientIp === "127.0.0.1" && entry.ip_or_cidr === "::1");

                                        return (
                                            <tr key={entry.id} className="hover:bg-white/[0.02] transition">
                                                <td className="py-3 pl-2">
                                                    <span className="font-mono font-bold text-white">
                                                        {entry.ip_or_cidr}
                                                    </span>
                                                </td>
                                                <td className="py-3 text-gray-300">
                                                    {entry.label || <span className="text-gray-600">—</span>}
                                                </td>
                                                <td className="py-3">
                                                    {isCurrent ? (
                                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                                                            <FiCheckCircle className="text-[10px]" /> Matches Your IP
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] text-gray-500">Other Network</span>
                                                    )}
                                                </td>
                                                <td className="py-3 text-gray-400 text-[11px]">
                                                    {entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}
                                                </td>
                                                <td className="py-3 pr-2 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemove(entry.id, entry.ip_or_cidr)}
                                                        className="rounded-lg p-1.5 text-gray-500 hover:bg-rose-500/10 hover:text-rose-400 transition"
                                                        title="Delete from whitelist"
                                                    >
                                                        <FiTrash2 className="h-4 w-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                {/* Explanatory Info Card */}
                <div className="rounded-2xl border border-white/5 bg-[#0b1420]/40 p-4 flex items-start gap-3 text-xs text-gray-400">
                    <FiInfo className="mt-0.5 shrink-0 text-emerald-400 text-base" />
                    <div className="space-y-1">
                        <div className="font-bold text-gray-200">How Admin IP Restriction Works:</div>
                        <p>
                            • When IP restriction is enabled, both the Admin login endpoint and all Admin internal APIs reject incoming connections with <code className="text-emerald-400">HTTP 403 Forbidden</code> unless their IP is listed above.
                        </p>
                        <p>
                            • Standard website visitors, traders, and public APIs are unaffected. This security layer exclusively protects the Admin console.
                        </p>
                        <p>
                            • In case of an accidental lockout, administrators can run <code className="text-emerald-400">node server/scripts/resetAdminPassword.js</code> or modify the <code className="text-emerald-400">admin_security_settings</code> table directly in MySQL.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
