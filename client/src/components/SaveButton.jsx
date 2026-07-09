import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Shared Save button behavior for Strategy Builder / Backtest, per the hard
// rule that Save is Pro-only. Handles all three states: logged out (send to
// login), logged in but free tier (explain why it's disabled), and Pro
// (prompt for a name, then call the provided onSave).
export default function SaveButton({ onSave, itemLabel = "item" }) {
    const { user, isPro, token } = useAuth();
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [showPrompt, setShowPrompt] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null); // { type: 'success'|'error', message }

    if (!user) {
        return (
            <button
                onClick={() => navigate("/login")}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
                Log in to save
            </button>
        );
    }

    if (!isPro) {
        return (
            <button
                disabled
                title="Saving requires a Pro subscription"
                className="cursor-not-allowed rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-400"
            >
                Save (Pro only)
            </button>
        );
    }

    async function handleConfirm() {
        setSaving(true);
        setStatus(null);
        try {
            await onSave(token, name);
            setStatus({ type: "success", message: `${itemLabel} saved.` });
            setShowPrompt(false);
            setName("");
        } catch (err) {
            setStatus({ type: "error", message: err.message });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="flex items-center gap-2">
            {showPrompt ? (
                <>
                    <input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={`Name this ${itemLabel}`}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                    />
                    <button
                        onClick={handleConfirm}
                        disabled={saving || !name.trim()}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                        {saving ? "Saving…" : "Confirm"}
                    </button>
                    <button onClick={() => setShowPrompt(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                </>
            ) : (
                <button
                    onClick={() => setShowPrompt(true)}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                >
                    Save {itemLabel}
                </button>
            )}
            {status && (
                <span className={`text-xs ${status.type === "success" ? "text-emerald-600" : "text-rose-600"}`}>
                    {status.message}
                </span>
            )}
        </div>
    );
}
