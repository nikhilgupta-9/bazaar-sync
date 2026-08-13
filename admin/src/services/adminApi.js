const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
}

function authed(token) {
    return { headers: { Authorization: `Bearer ${token}` } };
}

export async function fetchOverview(token) {
    return handle(await fetch(`${API_URL}/api/admin/overview`, authed(token)));
}

export async function fetchUsers(token) {
    return handle(await fetch(`${API_URL}/api/admin/users`, authed(token)));
}

export async function fetchUserDetail(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/users/${id}`, authed(token)));
}

export async function fetchPayments(token) {
    return handle(await fetch(`${API_URL}/api/admin/payments`, authed(token)));
}

export async function fetchAllPositions(token) {
    return handle(await fetch(`${API_URL}/api/admin/positions`, authed(token)));
}

export async function fetchAllStrategies(token) {
    return handle(await fetch(`${API_URL}/api/admin/strategies`, authed(token)));
}
