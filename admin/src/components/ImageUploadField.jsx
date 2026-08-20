// components/ImageUploadField.jsx — reusable image upload+preview control
// for the Home Page editor (Hero/About/tool-card images). Uploads straight
// to POST /api/content/uploads on pick (no separate "Save" step for the
// file itself — only the resulting URL needs to be included when the page
// content is saved), then hands the returned URL back via onChange.
import { useRef, useState } from "react";
import { FiUpload, FiX } from "react-icons/fi";
import { uploadContentImage } from "../services/adminApi";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

function resolveUrl(path) {
    if (!path) return null;
    return /^https?:\/\//i.test(path) ? path : `${API_URL}${path}`;
}

export default function ImageUploadField({ label, value, onChange, token }) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    async function handleFile(e) {
        const file = e.target.files?.[0];
        e.target.value = ""; // allow re-picking the same file later
        if (!file) return;
        setError(null);
        setUploading(true);
        try {
            const res = await uploadContentImage(token, file);
            onChange(res.url);
        } catch (err) {
            setError(err.message);
        } finally {
            setUploading(false);
        }
    }

    return (
        <div>
            {label && <label className="mb-1 block text-xs font-medium text-gray-400">{label}</label>}
            <div className="flex items-center gap-3">
                {value ? (
                    <div className="relative h-16 w-28 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                        <img src={resolveUrl(value)} alt="" className="h-full w-full object-cover" />
                        <button
                            type="button"
                            onClick={() => onChange(null)}
                            aria-label="Remove image"
                            className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-rose-600"
                        >
                            <FiX className="h-3 w-3" />
                        </button>
                    </div>
                ) : (
                    <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/15 text-[10px] text-gray-500">
                        No image
                    </div>
                )}
                <button
                    type="button"
                    disabled={uploading}
                    onClick={() => inputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 disabled:opacity-50"
                >
                    <FiUpload className="h-3.5 w-3.5" />
                    {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
                </button>
                <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </div>
            {error && <div className="mt-1 text-[11px] text-rose-400">{error}</div>}
        </div>
    );
}
