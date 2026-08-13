const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

// Reuses the SAME /api/auth/login every regular user goes through — an
// "admin account" is just a normal user row with role='admin' (see
// requireAdmin.js). This app never registers accounts; admins are promoted
// by hand in MySQL, same bootstrap convention as the Pro tier before
// Razorpay existed.
export async function login(email, password) {
    const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    return handle(res);
}

export async function fetchMe(token) {
    const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return handle(res);
}
