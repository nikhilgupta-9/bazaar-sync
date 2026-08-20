const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

// Public — no login needed. Returns { path, title: null, description: null,
// og_image: null } if nothing's been configured for that path.
export async function fetchSeoMeta(path) {
    return handle(await fetch(`${API_URL}/api/seo?path=${encodeURIComponent(path)}`));
}
