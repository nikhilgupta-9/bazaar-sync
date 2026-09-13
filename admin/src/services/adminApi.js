const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

async function handle(res) {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(body.error || `Request failed (${res.status})`);
        if (body.rowErrors) err.rowErrors = body.rowErrors;
        throw err;
    }
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

export async function fetchPlansAdmin(token) {
    return handle(await fetch(`${API_URL}/api/admin/plans`, authed(token)));
}

export async function createPlan(token, payload) {
    return handle(await fetch(`${API_URL}/api/admin/plans`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

export async function updatePlan(token, id, payload) {
    return handle(await fetch(`${API_URL}/api/admin/plans/${id}`, {
        method: "PUT",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

export async function setPlanActive(token, id, active) {
    return handle(await fetch(`${API_URL}/api/admin/plans/${id}`, {
        method: "PATCH",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
    }));
}

export async function deletePlan(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/plans/${id}`, { method: "DELETE", ...authed(token) }));
}

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

// --- Image uploads (Home Page editor) ---
// multipart/form-data — no Content-Type header set manually, the browser
// fills in the multipart boundary itself when the body is a FormData.
export async function uploadContentImage(token, file) {
    const form = new FormData();
    form.append("image", file);
    return handle(await fetch(`${API_URL}/api/content/uploads`, {
        method: "POST",
        headers: authed(token).headers,
        body: form,
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

// --- Lot Size History ---

export async function fetchLotSizeHistory(token, symbol) {
    const qs = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
    return handle(await fetch(`${API_URL}/api/admin/lot-size-history${qs}`, authed(token)));
}

export async function addLotSizeHistoryEntry(token, { symbol, lotSize, effectiveFrom, effectiveTo }) {
    return handle(await fetch(`${API_URL}/api/admin/lot-size-history`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, lotSize, effectiveFrom, effectiveTo }),
    }));
}

export async function removeLotSizeHistoryEntry(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/lot-size-history/${id}`, { method: "DELETE", ...authed(token) }));
}

export async function bulkImportLotSizeHistory(token, rows) {
    return handle(await fetch(`${API_URL}/api/admin/lot-size-history/bulk`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
    }));
}

// --- Data section: credentials, extraction jobs, coverage/expiry/Greeks, CSV import ---

export async function fetchEnvStatus(token) {
    return handle(await fetch(`${API_URL}/api/admin/data/env`, authed(token)));
}

export async function updateEnvValue(token, key, value) {
    return handle(await fetch(`${API_URL}/api/admin/data/env`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
    }));
}

export async function startExtractionJob(token, payload) {
    return handle(await fetch(`${API_URL}/api/admin/data/jobs`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }));
}

// Every symbol with real data (7 indices + ~200 F&O stocks) — same endpoint
// client/'s Select Asset dropdown and admin's other symbol-aware pages
// already use. Public (no admin auth needed), so no `authed(token)` here.
export async function fetchSymbolList() {
    return handle(await fetch(`${API_URL}/api/option-chain/symbols/list`));
}

export async function fetchExtractionJobs(token) {
    return handle(await fetch(`${API_URL}/api/admin/data/jobs`, authed(token)));
}

export async function fetchExtractionJob(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/data/jobs/${id}`, authed(token)));
}

export async function cancelExtractionJob(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/data/jobs/${id}/cancel`, { method: "POST", ...authed(token) }));
}

export async function failExtractionJob(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/data/jobs/${id}/fail`, { method: "POST", ...authed(token) }));
}

export async function deleteExtractionJob(token, id) {
    return handle(await fetch(`${API_URL}/api/admin/data/jobs/${id}`, { method: "DELETE", ...authed(token) }));
}

export async function fetchCoverageSummary(token, dataType) {
    return handle(await fetch(`${API_URL}/api/admin/data/coverage/summary?dataType=${dataType}`, authed(token)));
}

export async function fetchCoverageDetail(token, dataType, symbol) {
    return handle(await fetch(`${API_URL}/api/admin/data/coverage/detail?dataType=${dataType}&symbol=${encodeURIComponent(symbol)}`, authed(token)));
}

export async function refreshCoverageCache(token) {
    return handle(await fetch(`${API_URL}/api/admin/data/coverage/refresh`, { method: "POST", ...authed(token) }));
}

export async function fetchExpiryStatus(token, dataType) {
    return handle(await fetch(`${API_URL}/api/admin/data/expiry-status?dataType=${dataType}`, authed(token)));
}

export async function fetchGreeksCoverage(token) {
    return handle(await fetch(`${API_URL}/api/admin/data/greeks-coverage`, authed(token)));
}

export async function importData(token, table, rows) {
    return handle(await fetch(`${API_URL}/api/admin/data/import`, {
        method: "POST",
        headers: { ...authed(token).headers, "Content-Type": "application/json" },
        body: JSON.stringify({ table, rows }),
    }));
}
