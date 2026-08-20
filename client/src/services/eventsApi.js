const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

// Public — published events only, no login needed.
export async function fetchEvents() {
    return handle(await fetch(`${API_URL}/api/events`));
}
