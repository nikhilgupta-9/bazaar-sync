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

// --- Institute Access (IP allowlist) ---

export async function fetchInstituteIps(token) {
    return handle(await fetch(`${API_URL}/api/admin/institute-ips`, authed(token)));
}

export async function addInstituteIp(token, { ipOrCidr, label }) {
    return handle(await fetch(`${API_URL}/api/admin/institute-ips`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ipOrCidr, label }),
    }));
}

export async function removeInstituteIp(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/institute-ips/${id}`, { method: "DELETE", ...authed(token) }));
}

// --- Plans & Coupons ---

export async function fetchCoupons(token) {
    return handle(await fetch(`${API_URL}/api/admin/coupons`, authed(token)));
}

export async function createCoupon(token, payload) {
    return handle(await fetch(`${API_URL}/api/admin/coupons`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

export async function setCouponActive(token, id, active) {
    return handle(await fetch(`${API_URL}/api/admin/coupons/${id}`, {
        method: "PATCH",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
    }));
}

export async function deleteCoupon(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/coupons/${id}`, { method: "DELETE", ...authed(token) }));
}

// --- Events ---

export async function fetchAllEvents(token) {
    return handle(await fetch(`${API_URL}/api/events/admin/all`, authed(token)));
}

export async function createEvent(token, payload) {
    return handle(await fetch(`${API_URL}/api/events/admin`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

export async function updateEvent(token, id, payload) {
    return handle(await fetch(`${API_URL}/api/events/admin/${id}`, {
        method: "PUT",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

export async function deleteEvent(token, id) {
    return handle(await fetch(`${API_URL}/api/events/admin/${id}`, { method: "DELETE", ...authed(token) }));
}

// --- T&C content ---

export async function fetchContent(token, slug) {
    return handle(await fetch(`${API_URL}/api/content/${slug}`, authed(token)));
}

export async function saveContent(token, slug, payload) {
    return handle(await fetch(`${API_URL}/api/content/${slug}`, {
        method: "PUT",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

// --- SEO meta ---

export async function fetchAllSeoMeta(token) {
    return handle(await fetch(`${API_URL}/api/seo/admin/all`, authed(token)));
}

export async function upsertSeoMeta(token, payload) {
    return handle(await fetch(`${API_URL}/api/seo/admin`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

export async function deleteSeoMeta(token, id) {
    return handle(await fetch(`${API_URL}/api/seo/admin/${id}`, { method: "DELETE", ...authed(token) }));
}
