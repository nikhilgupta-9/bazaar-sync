// pages/DataSettings.jsx — view/update the broker/data-source credentials
// that live in .env files, from the admin panel instead of hand-editing
// files over SSH (Next Steps: "admin se hi .env ke sare access token ...
// update kr paye"). Scoped to the 4 data sources this whole Data section is
// about (Angel One / Kotak / Upstox / ICICI Breeze) — see
// server/services/envSettingsService.js's header for why this is
// deliberately NOT a generic .env editor (DB/JWT/Razorpay/SMTP stay
// SSH-only).
import { useCallback, useEffect, useState } from "react";
import { FiKey, FiCheckCircle, FiAlertTriangle, FiEdit2 } from "react-icons/fi";
import { useAdminAuth } from "../context/AdminAuthContext";
import { fetchEnvStatus, updateEnvValue } from "../services/adminApi";
import TopBar from "../components/TopBar";
import Card from "../components/Card";

const SOURCE_LABELS = {
    angelone: "Angel One SmartAPI (live data)",
    kotak: "Kotak Neo (second live source)",
    upstox: "Upstox (recent-window backfill)",
    icici_breeze: "ICICI Breeze (deep historical backfill)",
};

function EditRow({ item, onSave }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [savedNote, setSavedNote] = useState(null);

    async function submit(e) {
        e.preventDefault();
        setSaving(true);
        setError(null);
        try {
            const result = await onSave(item.key, value);
            setEditing(false);
            setValue("");
            setSavedNote(result.restartNote || `updated in ${result.updatedFiles} file${result.updatedFiles === 1 ? "" : "s"}`);
            setTimeout(() => setSavedNote(null), 6000);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-gray-200">{item.key}</span>
                        <span className="text-xs text-gray-500">— {item.label}</span>
                        {!item.inSync && (
                            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                                <FiAlertTriangle className="h-3 w-3" /> out of sync across files
                            </span>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
                        {item.files.map((f) => (
                            <span key={f.file} className="font-mono">
                                {f.file}: {f.isSet ? <span className="text-gray-300">{f.preview}</span> : <span className="text-rose-400">not set</span>}
                            </span>
                        ))}
                    </div>
                    {item.restartNote && <div className="mt-1 text-[11px] text-amber-400">{item.restartNote}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {item.isSet ? (
                        <FiCheckCircle className="h-4 w-4 text-emerald-400" title="set" />
                    ) : (
                        <FiAlertTriangle className="h-4 w-4 text-rose-400" title="not set" />
                    )}
                    <button
                        onClick={() => { setEditing((v) => !v); setError(null); }}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-200 hover:bg-white/10"
                    >
                        <FiEdit2 className="h-3.5 w-3.5" /> {item.isSet ? "Update" : "Set"}
                    </button>
                </div>
            </div>

            {editing && (
                <form onSubmit={submit} className="mt-2.5 flex items-center gap-2">
                    <input
                        autoFocus
                        type="text"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder={`new value for ${item.key}`}
                        className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-xs text-white outline-none focus:border-violet-500"
                    />
                    <button
                        type="submit"
                        disabled={saving || !value.trim()}
                        className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                        {saving ? "Saving…" : "Save"}
                    </button>
                </form>
            )}
            {error && <div className="mt-2 text-xs text-rose-400">{error}</div>}
            {savedNote && <div className="mt-2 text-xs text-emerald-400">Saved — {savedNote}</div>}
        </div>
    );
}

export default function DataSettings() {
    const { token } = useAdminAuth();
    const [sources, setSources] = useState(null);
    const [error, setError] = useState(null);

    const load = useCallback(() => {
        fetchEnvStatus(token).then((r) => setSources(r.sources)).catch((err) => setError(err.message));
    }, [token]);

    useEffect(load, [load]);

    async function handleSave(key, value) {
        const result = await updateEnvValue(token, key, value);
        load();
        return result;
    }

    return (
        <div>
            <TopBar
                title="Credentials"
                subtitle="Broker/data-source access tokens for Angel One, Kotak, Upstox, and ICICI Breeze — written directly to the relevant .env file(s). Values are never shown in full, only a masked preview."
            />
            <div className="p-6">
                {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</div>}

                {!sources ? (
                    <div className="py-10 text-center text-xs text-gray-500">Loading…</div>
                ) : (
                    Object.entries(sources).map(([source, items]) => (
                        <Card key={source} title={SOURCE_LABELS[source] || source} className="mb-4" action={<FiKey className="h-4 w-4 text-gray-500" />}>
                            <div className="space-y-2">
                                {items.map((item) => (
                                    <EditRow key={item.key} item={item} onSave={handleSave} />
                                ))}
                            </div>
                        </Card>
                    ))
                )}

                <div className="mt-2 text-xs text-gray-500">
                    ICICI Breeze's session token expires daily and has no automatic refresh — get a fresh one via the login URL in{" "}
                    <code className="rounded bg-white/10 px-1 py-0.5 text-gray-300">data-downloader/README.md</code>, then paste it here.
                </div>
            </div>
        </div>
    );
}
