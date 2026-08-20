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
