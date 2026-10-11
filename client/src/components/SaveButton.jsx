import React from "react";
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
                className="rounded-xl border border-gray-300 dark:border-white/10 px-3 py-1.5 text-xs sm:text-[13px] font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-[#0b1420] hover:bg-gray-50 dark:hover:bg-white/5 shadow-xs transition"
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
                className="cursor-not-allowed rounded-xl border border-gray-200 dark:border-white/5 px-3 py-1.5 text-xs sm:text-[13px] font-semibold text-gray-400 dark:text-gray-600 bg-gray-50 dark:bg-white/[0.02]"
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
                        className="rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-[#070e17] px-2.5 py-1 text-xs sm:text-[13px] text-gray-900 dark:text-white outline-none focus:border-emerald-500"
                    />
                    <button
                        onClick={handleConfirm}
                        disabled={saving || !name.trim()}
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs sm:text-[13px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-xs transition"
                    >
                        {saving ? "Saving…" : "Confirm"}
                    </button>
                    <button onClick={() => setShowPrompt(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
                </>
            ) : (
                <button
                    onClick={() => setShowPrompt(true)}
                    className="rounded-xl bg-emerald-600 px-3 sm:px-4 py-1.5 text-xs sm:text-[13px] font-bold text-white hover:bg-emerald-500 shadow-xs transition"
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
