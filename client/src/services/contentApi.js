const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

// Public — no login needed. Returns { slug, title: null, content: null,
// updated_at: null } if nothing's been published yet for that slug.
export async function fetchContent(slug) {
    return handle(await fetch(`${API_URL}/api/content/${slug}`));
}

// The 'home' slug's `content` column stores a JSON blob (hero/about/tools
// overrides — see data/homeContentDefaults.js), unlike 'terms' which stores
// plain text. Parses it, returning null on anything unexpected (never-saved,
// empty, or corrupt) so the caller can fall back to defaults rather than
// throwing on a page load.
export async function fetchHomeContent() {
    const row = await fetchContent("home");
    if (!row?.content) return null;
    try {
        return JSON.parse(row.content);
    } catch {
        return null;
    }
}

// Uploaded images are stored as server-relative paths ("/uploads/xyz.png",
// see middleware/upload.js) so the same JSON blob works in any environment
// — this resolves one against the current API origin for an <img src>.
export function resolveImageUrl(path) {
    if (!path) return null;
    if (/^https?:\/\//i.test(path)) return path;
    return `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}
