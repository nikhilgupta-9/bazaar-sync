// services/proPlanService.js — the Pricing page's plan catalog (name/duration/
// price/badge), admin-managed since 2026-09-13 (superseding the old fixed
// PRO_PLANS constant in paperTradeConfig.js — that constant and PRO_PRICE_PAISE/
// PRO_DURATION_DAYS still exist there as fallback defaults only, see below).
// See schema.sql's pro_plans table header for the `id`-stability requirement
// (it's what a Razorpay order's notes.planId points at).
const { pool } = require("../config/db");
const { PRO_DURATION_DAYS, PRO_PRICE_PAISE } = require("../config/paperTradeConfig");

function badRequest(message) {
    const err = new Error(message);
    err.status = 400;
    return err;
}

function toPublicShape(row) {
    return {
        id: row.id,
        name: row.name,
        duration: row.duration_label,
        days: row.days,
        priceInPaise: row.price_in_paise,
        badge: row.badge,
    };
}

// Public — /api/subscription/plans and the coupon-preview endpoint. Only
// active plans, ordered the way they should display.
async function listActivePlans() {
    const [rows] = await pool.query(
        "SELECT * FROM pro_plans WHERE active = 1 ORDER BY sort_order ASC, id ASC"
    );
    return rows.map(toPublicShape);
}

// Admin — every plan, active or not, so a hidden plan can still be found and
// reactivated instead of having to be recreated from scratch.
async function listAllPlansAdmin() {
    const [rows] = await pool.query("SELECT * FROM pro_plans ORDER BY sort_order ASC, id ASC");
    return rows;
}

// Used at order-creation and payment-verify time — including inactive plans,
// since an order placed while a plan was active must still verify correctly
// even if an admin deactivates that plan in the meantime.
async function getPlan(id) {
    if (!id) return null;
    const [[row]] = await pool.query("SELECT * FROM pro_plans WHERE id = ?", [id]);
    return row ? toPublicShape(row) : null;
}

// Safety net for verifyProPayment: an order's notes.planId should always
// resolve (see above), but if a plan was hard-deleted between order-creation
// and payment, fall back to a real, currently-active plan rather than crash
// mid-payment-verification — the paperTradeConfig defaults if even that's empty.
async function getPlanOrFallback(id) {
    const plan = await getPlan(id);
    if (plan) return plan;
    const [active] = await listActivePlans();
    if (active) return active;
    return { id: "1m", name: "Pro", duration: `${PRO_DURATION_DAYS} days`, days: PRO_DURATION_DAYS, priceInPaise: PRO_PRICE_PAISE, badge: null };
}

const ID_RE = /^[a-z0-9-]{1,20}$/;

function validateFields({ id, name, durationLabel, days, priceInPaise, badge, sortOrder }, { requireId }) {
    if (requireId) {
        const cleanId = String(id || "").trim().toLowerCase();
        if (!ID_RE.test(cleanId)) throw badRequest("id must be 1-20 lowercase letters/digits/hyphens");
        id = cleanId;
    }
    if (!String(name || "").trim()) throw badRequest("name is required");
    if (!String(durationLabel || "").trim()) throw badRequest("durationLabel is required");
    const daysNum = Number(days);
    if (!Number.isInteger(daysNum) || daysNum <= 0) throw badRequest("days must be a positive whole number");
    const priceNum = Number(priceInPaise);
    if (!Number.isInteger(priceNum) || priceNum <= 0) throw badRequest("priceInPaise must be a positive whole number");
    const sortNum = sortOrder === undefined || sortOrder === null || sortOrder === "" ? 0 : Number(sortOrder);
    if (!Number.isInteger(sortNum)) throw badRequest("sortOrder must be a whole number");

    return {
        id, name: String(name).trim(), durationLabel: String(durationLabel).trim(),
        days: daysNum, priceInPaise: priceNum, badge: badge ? String(badge).trim() : null, sortOrder: sortNum,
    };
}

async function createPlan(fields) {
    const p = validateFields(fields, { requireId: true });
    const [[existing]] = await pool.query("SELECT id FROM pro_plans WHERE id = ?", [p.id]);
    if (existing) throw badRequest(`a plan with id "${p.id}" already exists`);

    await pool.query(
        `INSERT INTO pro_plans (id, name, duration_label, days, price_in_paise, badge, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [p.id, p.name, p.durationLabel, p.days, p.priceInPaise, p.badge, p.sortOrder]
    );
    return p.id;
}

async function updatePlan(id, fields) {
    const p = validateFields({ ...fields, id }, { requireId: false });
    const [result] = await pool.query(
        `UPDATE pro_plans SET name = ?, duration_label = ?, days = ?, price_in_paise = ?, badge = ?, sort_order = ? WHERE id = ?`,
        [p.name, p.durationLabel, p.days, p.priceInPaise, p.badge, p.sortOrder, id]
    );
    if (result.affectedRows === 0) throw badRequest("plan not found");
}

async function setPlanActive(id, active) {
    const [result] = await pool.query("UPDATE pro_plans SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
    if (result.affectedRows === 0) throw badRequest("plan not found");
}

async function deletePlan(id) {
    await pool.query("DELETE FROM pro_plans WHERE id = ?", [id]);
}

module.exports = {
    listActivePlans, listAllPlansAdmin, getPlan, getPlanOrFallback,
    createPlan, updatePlan, setPlanActive, deletePlan,
};
