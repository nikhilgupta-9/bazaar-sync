// components/MarkdownEditor.jsx — a small markdown toolbar + Edit/Preview toggle for
// long-form admin content fields (Terms & Conditions today; written generically enough
// to reuse for Events/Home copy later if those ever need real formatting too). Content
// is stored as plain markdown text — no DB shape change — and rendered through the same
// marked+DOMPurify pipeline the public page uses (see client/src/utils/markdown.js), so
// what you see in Preview here is exactly what a visitor gets.
import { useRef, useState } from "react";
import { FiBold, FiItalic, FiHash, FiList, FiLink, FiEye, FiEdit2 } from "react-icons/fi";
import { renderMarkdown } from "../utils/markdown";

function wrapSelection(value, start, end, before, after) {
    const selected = value.slice(start, end) || "text";
    return {
        next: value.slice(0, start) + before + selected + after + value.slice(end),
        selStart: start + before.length,
        selEnd: start + before.length + selected.length,
    };
}

function prefixLine(value, pos, prefix) {
    const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
    return {
        next: value.slice(0, lineStart) + prefix + value.slice(lineStart),
        selStart: pos + prefix.length,
        selEnd: pos + prefix.length,
    };
}

function ToolbarButton({ icon: Icon, label, onClick }) {
    return (
        <button
            type="button" onClick={onClick} title={label} aria-label={label}
            className="rounded-md p-1.5 text-gray-300 hover:bg-white/10 hover:text-white"
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
    );
}

export default function MarkdownEditor({ value, onChange, rows = 18, placeholder }) {
    const textareaRef = useRef(null);
    const [mode, setMode] = useState("edit"); // "edit" | "preview"

    function apply(fn) {
        const el = textareaRef.current;
        if (!el) return;
        const { next, selStart, selEnd } = fn(value, el.selectionStart, el.selectionEnd);
        onChange(next);
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(selStart, selEnd);
        });
    }

    function insertLink() {
        const el = textareaRef.current;
        if (!el) return;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const url = window.prompt("Link URL", "https://");
        if (!url) return;
        const selected = value.slice(start, end) || "link text";
        const md = `[${selected}](${url})`;
        const next = value.slice(0, start) + md + value.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(start + md.length, start + md.length);
        });
    }

    return (
        <div className="overflow-hidden rounded-lg border border-white/10">
            <style>{`
                .md-preview h1, .md-preview h2, .md-preview h3 { font-weight: 700; color: #f5f7fa; }
                .md-preview h1 { font-size: 1.4rem; margin: 0.7em 0 0.35em; }
                .md-preview h2 { font-size: 1.2rem; margin: 0.7em 0 0.35em; }
                .md-preview h3 { font-size: 1.05rem; margin: 0.6em 0 0.3em; }
                .md-preview p { margin: 0.6em 0; line-height: 1.6; }
                .md-preview ul, .md-preview ol { margin: 0.5em 0; padding-left: 1.4em; }
                .md-preview li { margin: 0.2em 0; }
                .md-preview a { color: #c4b5fd; text-decoration: underline; }
                .md-preview strong { font-weight: 700; color: #f5f7fa; }
                .md-preview blockquote { border-left: 3px solid rgba(255,255,255,0.15); padding-left: 0.75em; color: #9ca3af; margin: 0.6em 0; }
                .md-preview code { background: rgba(255,255,255,0.08); padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.85em; }
            `}</style>

            <div className="flex flex-wrap items-center gap-1 border-b border-white/10 bg-white/5 px-2 py-1.5">
                <ToolbarButton icon={FiBold} label="Bold" onClick={() => apply((v, s, e) => wrapSelection(v, s, e, "**", "**"))} />
                <ToolbarButton icon={FiItalic} label="Italic" onClick={() => apply((v, s, e) => wrapSelection(v, s, e, "_", "_"))} />
                <ToolbarButton icon={FiHash} label="Heading" onClick={() => apply((v, s) => prefixLine(v, s, "## "))} />
                <ToolbarButton icon={FiList} label="Bullet list" onClick={() => apply((v, s) => prefixLine(v, s, "- "))} />
                <ToolbarButton icon={FiLink} label="Link" onClick={insertLink} />

                <div className="ml-auto flex overflow-hidden rounded-md border border-white/10">
                    <button
                        type="button" onClick={() => setMode("edit")}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${mode === "edit" ? "bg-violet-600 text-white" : "text-gray-400 hover:bg-white/10"}`}
                    >
                        <FiEdit2 className="h-3 w-3" /> Edit
                    </button>
                    <button
                        type="button" onClick={() => setMode("preview")}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${mode === "preview" ? "bg-violet-600 text-white" : "text-gray-400 hover:bg-white/10"}`}
                    >
                        <FiEye className="h-3 w-3" /> Preview
                    </button>
                </div>
            </div>

            {mode === "edit" ? (
                <textarea
                    ref={textareaRef} rows={rows} value={value} onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className="w-full resize-y bg-transparent px-3 py-2 font-mono text-xs text-white outline-none"
                />
            ) : (
                <div
                    className="md-preview px-3 py-3 text-sm text-gray-200"
                    style={{ minHeight: `${rows * 1.4}em` }}
                    dangerouslySetInnerHTML={{
                        __html: value ? renderMarkdown(value) : "<p style='color:#6b7280'>Nothing to preview yet.</p>",
                    }}
                />
            )}
        </div>
    );
}
