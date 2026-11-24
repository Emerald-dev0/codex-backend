/**
 * Shared helpers for the admin panel services (utils/admin/*).
 */
const Subscription = require('../../models/Subscription');

const TIER_LABELS = Object.freeze({
    developer: 'Developer',
    pro: 'Pro',
    pro_plus: 'Pro +',
    team_standard: 'Team Standard',
    team_premium: 'Team Premium',
    enterprise: 'Enterprise',
});
const PAID_TIERS = ['pro', 'pro_plus', 'team_standard', 'team_premium', 'enterprise'];
const DAY_MS = 24 * 60 * 60 * 1000;

function tierLabel(tier) {
    return TIER_LABELS[tier] || 'Developer';
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

function parsePage(query = {}, { defaultLimit = 10, maxLimit = 100 } = {}) {
    const limit = clampInt(query.limit, defaultLimit, 1, maxLimit);
    const page = clampInt(query.page, 1, 1, 100000);
    return { page, limit, skip: (page - 1) * limit };
}

function pageMeta(total, page, limit) {
    return {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
    };
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchRegex(q) {
    const term = String(q || '').trim().slice(0, 100);
    return term ? new RegExp(escapeRegex(term), 'i') : null;
}

function startOfDay(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, days) {
    return new Date(date.getTime() + days * DAY_MS);
}

function startOfMonth(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date, months) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function endOfMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);
}

/** Percent change, or null when there is no baseline to compare with. */
function pctChange(current, previous) {
    const cur = Number(current) || 0;
    const prev = Number(previous) || 0;
    if (prev === 0) return cur === 0 ? 0 : null;
    return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function pct(part, whole) {
    const w = Number(whole) || 0;
    if (w === 0) return 0;
    return Math.round(((Number(part) || 0) / w) * 1000) / 10;
}

function parseDate(value, fallback) {
    if (!value) return fallback;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Monthly recurring value of a subscription in USD minor units.
 * Uses the stored USD price when present, otherwise the canonical tier price
 * (regional rails store local amounts that are not summable with USD).
 */
function monthlyValueMinor(sub) {
    if (!sub || !PAID_TIERS.includes(sub.tier)) return 0;
    const pricing = sub.pricing || {};
    const canonical = Subscription.tierConfigs?.[sub.tier]?.amount;
    let amount = String(pricing.currency || 'USD').toUpperCase() === 'USD' && Number(pricing.amount) > 0
        ? Number(pricing.amount)
        : Number(canonical) || 0;
    if (pricing.interval === 'yearly' && String(pricing.currency || 'USD').toUpperCase() === 'USD' && Number(pricing.amount) > 0) {
        amount /= 12;
    }
    return Math.round(amount * 100);
}

/** Whether a subscription was a paying, live subscription at `date`. */
function wasActiveAt(sub, date) {
    if (!sub || !PAID_TIERS.includes(sub.tier)) return false;
    const started = sub.startDate || sub.createdAt;
    if (!started || new Date(started) > date) return false;
    if (sub.status === 'active' || sub.status === 'past_due') return true;
    const ended = sub.endDate || sub.cancelledAt || sub.updatedAt;
    return Boolean(ended && new Date(ended) > date);
}

function displayName(user) {
    return user?.fullName || user?.email || 'Unknown user';
}

module.exports = {
    TIER_LABELS,
    PAID_TIERS,
    DAY_MS,
    tierLabel,
    clampInt,
    parsePage,
    pageMeta,
    escapeRegex,
    searchRegex,
    startOfDay,
    addDays,
    startOfMonth,
    addMonths,
    endOfMonth,
    pctChange,
    pct,
    parseDate,
    monthlyValueMinor,
    wasActiveAt,
    displayName,
};
