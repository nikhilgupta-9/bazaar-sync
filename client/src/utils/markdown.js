// utils/markdown.js — markdown -> sanitized HTML, shared by the public /terms page's
// render and (a byte-for-byte copy in admin/src/utils/markdown.js) the admin Terms
// editor's live Preview, so a preview there is never a lie about what visitors see.
// `breaks: true` keeps a single newline behaving like the old plain-text/pre-wrap
// display (each line break shows), on top of real markdown syntax (**bold**, ## headings,
// - lists, [text](url) links, blank-line paragraphs) for anyone who wants it. DOMPurify
// strips anything script-like even though only admins can write this content — content
// that ends up rendered site-wide is worth sanitizing regardless of who authored it.
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(text) {
    return DOMPurify.sanitize(marked.parse(text || ""));
}
