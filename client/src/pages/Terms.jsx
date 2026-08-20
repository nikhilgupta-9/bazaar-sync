// pages/Terms.jsx — public T&C page, content managed via admin/src/pages/Terms.jsx.
import { useEffect, useState } from "react";
import { fetchContent } from "../services/contentApi";

export default function Terms() {
    const [content, setContent] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchContent("terms").then(setContent).catch((err) => setError(err.message));
    }, []);

    return (
        <div className="mx-auto max-w-3xl px-6 py-12">
            <h1 className="text-2xl font-bold text-gray-900">{content?.title || "Terms & Conditions"}</h1>

            {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {!content && !error && <div className="mt-10 text-center text-sm text-gray-400">Loading…</div>}
            {content && !content.content && (
                <div className="mt-10 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center text-sm text-gray-400">
                    Not published yet.
                </div>
            )}
            {content?.content && (
                <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{content.content}</div>
            )}
        </div>
    );
}
