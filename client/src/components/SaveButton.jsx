import React from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Shared Save button behavior for Strategy Builder / Backtest, per the hard
// rule that Save is Pro-only. Handles all three states: logged out (send to
// login), logged in but free tier (explain why it's disabled), and Pro
// (prompt for a name, then call the provided onSave).
export default function SaveButton({ onSave, itemLabel = "item", className = "" }) {
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
                className={`rounded-lg border border-gray-300 dark:border-white/10 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-[#0b1420] hover:bg-gray-50 dark:hover:bg-white/5 shadow-xs transition ${className}`}
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
                className={`cursor-not-allowed rounded-lg border border-gray-200 dark:border-white/5 px-2.5 py-1 text-xs font-semibold text-gray-400 dark:text-gray-600 bg-gray-50 dark:bg-white/[0.02] ${className}`}
            >
                Save (Pro)
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
        <div className="flex items-center gap-1.5">
            {showPrompt ? (
                <>
                    <input
                        autoFocus
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={`Name ${itemLabel}…`}
                        className="rounded-lg border border-gray-300 dark:border-white/10 bg-white dark:bg-[#070e17] px-2 py-1 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-500 w-32"
                    />
                    <button
                        onClick={handleConfirm}
                        disabled={saving || !name.trim()}
                        className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-xs transition"
                    >
                        {saving ? "…" : "Confirm"}
                    </button>
                    <button onClick={() => setShowPrompt(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
                </>
            ) : (
                <button
                    onClick={() => setShowPrompt(true)}
                    className={`rounded-lg bg-[#00b96b] hover:bg-[#00a860] px-3 py-1.5 text-xs font-bold text-white shadow-xs transition flex items-center gap-1.5 cursor-pointer ${className}`}
                >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                    <span>Save</span>
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
