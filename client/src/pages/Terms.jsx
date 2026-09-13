// pages/Terms.jsx — public T&C page, content managed via admin/src/pages/Terms.jsx
// (its MarkdownEditor). Content is markdown text, rendered here through the same
// renderMarkdown() the admin's live Preview uses (see utils/markdown.js's header
// comment) so this page never disagrees with what the admin saw before saving.
import { useEffect, useState } from "react";
import { fetchContent } from "../services/contentApi";
import { renderMarkdown } from "../utils/markdown";
import PageShell from "../components/PageShell";

export default function Terms() {
    const [content, setContent] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchContent("terms").then(setContent).catch((err) => setError(err.message));
    }, []);

    return (
        <PageShell>
            <h1 className="text-2xl font-bold text-gray-900">{content?.title || "Terms & Conditions"}</h1>

            {error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {!content && !error && <div className="mt-10 text-center text-sm text-gray-400">Loading…</div>}
            {content && !content.content && (
                <div className="mt-10 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center text-sm text-gray-400">
                    Not published yet.
                </div>
            )}
            {content?.content && (
                <>
                    <style>{`
                        .md-content h1, .md-content h2, .md-content h3 { font-weight: 700; color: #111827; }
                        .md-content h1 { font-size: 1.35rem; margin: 0.9em 0 0.4em; }
                        .md-content h2 { font-size: 1.2rem; margin: 0.9em 0 0.4em; }
                        .md-content h3 { font-size: 1.05rem; margin: 0.8em 0 0.35em; }
                        .md-content p { margin: 0.7em 0; }
                        .md-content ul, .md-content ol { margin: 0.6em 0; padding-left: 1.4em; }
                        .md-content li { margin: 0.25em 0; }
                        .md-content a { color: #2563eb; text-decoration: underline; }
                        .md-content strong { font-weight: 700; color: #111827; }
                        .md-content blockquote { border-left: 3px solid #e5e7eb; padding-left: 0.75em; color: #6b7280; margin: 0.7em 0; }
                        .md-content code { background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.9em; }
                    `}</style>
                    <div
                        className="md-content mt-6 max-w-3xl text-sm leading-relaxed text-gray-700"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(content.content) }}
                    />
                </>
            )}
        </PageShell>
    );
}
