/**
 * Admin › Overview: platform snapshot composed from the other admin services
 * plus the configured AI model registry (Settings › AI Models).
 */
const User = require('../../models/User');
const Payment = require('../../models/Payment');
const SupportTicket = require('../../models/SupportTicket');
const AgentExecution = require('../../models/AgentExecution');
const UserActivityDay = require('../../models/UserActivityDay');
const { providerDefinitions } = require('../../config/aiProviders');
const { addDays, pctChange } = require('./common');
const billing = require('./billingService');
const disputes = require('./disputeService');

async function signupSeries(now = new Date()) {
    const year = now.getUTCFullYear();
    const rows = await User.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) } } },
        { $group: { _id: { $month: '$createdAt' }, count: { $sum: 1 } } },
    ]);
    const byMonth = new Map(rows.map((r) => [r._id, r.count]));
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: byMonth.get(i + 1) || 0 }));
    const cur = months[now.getUTCMonth()].count;
    const prev = now.getUTCMonth() > 0 ? months[now.getUTCMonth() - 1].count : 0;
    return { year, months, currentMonth: now.getUTCMonth() + 1, changePct: pctChange(cur, prev), hasData: rows.length > 0 };
}

async function activeUserSeries(now = new Date()) {
    const year = now.getUTCFullYear();
    const rows = await UserActivityDay.aggregate([
        { $match: { date: { $gte: new Date(Date.UTC(year, 0, 1)), $lt: new Date(Date.UTC(year + 1, 0, 1)) } } },
        { $group: { _id: { m: { $month: '$date' }, u: '$userId' } } },
        { $group: { _id: '$_id.m', users: { $sum: 1 } } },
    ]);
    const byMonth = new Map(rows.map((r) => [r._id, r.users]));
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, users: byMonth.get(i + 1) || 0 }));
    return { year, months, currentMonth: now.getUTCMonth() + 1, hasData: rows.length > 0 };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

function utcDay(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Resolve the Overview date range. Defaults to month-to-date ("Oct 1 – 27").
 * Accepts YYYY-MM-DD `from` / `to` (inclusive, UTC).
 */
function resolveRange({ from, to } = {}, now = new Date()) {
    const parse = (v) => {
        if (v === undefined || v === null || v === '') return null;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
            const error = new Error('Dates must be in YYYY-MM-DD format');
            error.statusCode = 400;
            error.code = 'VALIDATION_ERROR';
            throw error;
        }
        const d = new Date(`${v}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) {
            const error = new Error('Invalid date');
            error.statusCode = 400;
            error.code = 'VALIDATION_ERROR';
            throw error;
        }
        return d;
    };
    const today = utcDay(now);
    let end = parse(to) || today;
    if (end > today) end = today;
    const start = parse(from) || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const days = Math.round((end - start) / DAY_MS) + 1;
    if (days < 1 || days > MAX_RANGE_DAYS) {
        const error = new Error(`Choose a range between 1 and ${MAX_RANGE_DAYS} days`);
        error.statusCode = 400;
        error.code = 'VALIDATION_ERROR';
        throw error;
    }
    return { start, end, days };
}

/**
 * Daily active users across a range (Platform growth). `current` is the
 * distinct active users over the whole range; `changePct` compares it with
 * the immediately preceding range of equal length.
 */
async function activeUserDaily({ start, end, days }) {
    const endExclusive = new Date(end.getTime() + DAY_MS);
    const prevStart = new Date(start.getTime() - days * DAY_MS);
    const [daily, distinct, prevDistinct] = await Promise.all([
        UserActivityDay.aggregate([
            { $match: { date: { $gte: start, $lt: endExclusive } } },
            { $group: { _id: '$day', users: { $sum: 1 } } },
        ]),
        UserActivityDay.distinct('userId', { date: { $gte: start, $lt: endExclusive } }),
        UserActivityDay.distinct('userId', { date: { $gte: prevStart, $lt: start } }),
    ]);
    const byDay = new Map(daily.map((r) => [r._id, r.users]));
    const points = Array.from({ length: days }, (_, i) => {
        const day = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
        return { day, users: byDay.get(day) || 0 };
    });
    return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
        days: points,
        current: distinct.length,
        changePct: pctChange(distinct.length, prevDistinct.length),
        hasData: daily.length > 0,
    };
}

async function subscriptionMix() {
    const Subscription = require('../../models/Subscription');
    const { tierLabel } = require('./common');
    const [rows, totalUsers] = await Promise.all([
        Subscription.aggregate([
            { $match: { status: { $in: ['active', 'trial', 'past_due'] } } },
            { $group: { _id: '$tier', count: { $sum: 1 } } },
        ]),
        User.countDocuments({}),
    ]);
    const paid = rows.filter((r) => r._id !== 'developer');
    const paidTotal = paid.reduce((n, r) => n + r.count, 0);
    // Accounts without a paid subscription are on the free Developer plan.
    const free = Math.max(0, totalUsers - paidTotal);
    const plans = [...paid.map((r) => ({ tier: r._id, label: tierLabel(r._id), count: r.count })), { tier: 'developer', label: 'Developer (free)', count: free }]
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count)
        .map((p) => ({ ...p, pct: totalUsers ? Math.round((p.count / totalUsers) * 1000) / 10 : 0 }));
    return { totalAccounts: totalUsers, plans };
}

async function recentActivity(limit = 6) {
    const [users, payments, tickets] = await Promise.all([
        User.find({}).sort({ createdAt: -1 }).limit(limit).select('fullName email createdAt').lean(),
        Payment.find({}).sort({ createdAt: -1 }).limit(limit).lean(),
        SupportTicket.find({}).sort({ createdAt: -1 }).limit(limit).select('subject guestName guestEmail userId status createdAt disputeNumber').lean(),
    ]);
    const items = [
        ...users.map((u) => ({
            kind: 'signup',
            account: { name: u.fullName || u.email, email: u.email },
            activity: 'Created an account',
            status: 'new_account',
            link: `/users/${u._id}`,
            at: u.createdAt,
        })),
        ...payments.map((p) => ({
            kind: 'payment',
            account: { name: p.customerName || p.customerEmail || 'Customer', email: p.customerEmail || '' },
            activity: p.status === 'failed'
                ? `Payment failed · ${(p.amountMinor / 100).toFixed(2)} ${p.currency}`
                : (p.status === 'refunded' || p.status === 'partially_refunded'
                    ? `Refund issued · ${(p.refundedMinor / 100).toFixed(2)} ${p.currency}`
                    : `Payment ${p.status === 'pending' ? 'pending' : 'received'} · ${(p.amountMinor / 100).toFixed(2)} ${p.currency}`),
            status: p.status,
            link: `/finance/transactions/${p._id}`,
            at: p.paidAt || p.createdAt,
        })),
        ...tickets.map((t) => ({
            kind: 'dispute',
            account: { name: t.guestName || 'Customer', email: t.guestEmail || '' },
            activity: `Opened a case · ${t.subject}`,
            status: disputes.uiStatus(t.status) === 'resolved' ? 'resolved' : 'needs_review',
            link: `/disputes?case=${t._id}`,
            at: t.createdAt,
        })),
    ];
    return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

async function needsAttention(now = new Date(), adminId = null) {
    const AdminNotification = require('../../models/AdminNotification');
    const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const [unresolved, failedPayments, unread] = await Promise.all([
        SupportTicket.find({ status: { $in: ['open', 'in-progress'] } }).select('priority createdAt status messages.sender').lean(),
        Payment.countDocuments({ status: 'failed', createdAt: { $gte: addDays(now, -30) } }),
        adminId ? AdminNotification.countDocuments({ readBy: { $ne: adminId } }) : 0,
    ]);
    const nearSla = unresolved.filter((t) => disputes.awaitingResponse(t) && disputes.dueAt(t) <= soon);
    const overdue = nearSla.filter((t) => disputes.dueAt(t) <= now);
    const items = [];
    if (nearSla.length) {
        items.push({
            kind: 'sla',
            title: `${nearSla.length} dispute${nearSla.length === 1 ? '' : 's'} approaching SLA`,
            detail: overdue.length ? `${overdue.length} already past the response deadline` : 'Respond within the next 24 hours',
            link: '/disputes',
        });
    }
    if (failedPayments) {
        items.push({
            kind: 'failed_payments',
            title: `${failedPayments} failed subscription payment${failedPayments === 1 ? '' : 's'}`,
            detail: 'In the last 30 days',
            link: '/finance?status=failed',
        });
    }
    if (unread) {
        items.push({
            kind: 'notifications',
            title: `${unread} unread notification${unread === 1 ? '' : 's'}`,
            detail: 'Platform events waiting for review',
            link: '/notifications',
        });
    }
    return items;
}

async function getOverview(now = new Date(), adminId = null, query = {}) {
    const range = resolveRange(query, now);
    const Company = require('../../models/Company');
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const [
        totalUsers, newThisMonth, newLastMonth,
        workspaces, workspacesThisMonth,
        billingSummary, disputeSummary,
        growth, mix, activity, attention,
    ] = await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ createdAt: { $gte: monthStart } }),
        User.countDocuments({ createdAt: { $gte: prevMonthStart, $lt: monthStart } }),
        Company.countDocuments({}),
        Company.countDocuments({ createdAt: { $gte: monthStart } }),
        billing.getSummary(now),
        disputes.getSummary(now),
        activeUserDaily(range),
        subscriptionMix(),
        recentActivity(),
        needsAttention(now, adminId),
    ]);
    return {
        generatedAt: now,
        kpis: {
            totalUsers: { count: totalUsers, newThisMonth, changePct: pctChange(newThisMonth, newLastMonth) },
            mrr: billingSummary.mrr,
            activeWorkspaces: { count: workspaces, newThisMonth: workspacesThisMonth },
            openDisputes: { count: disputeSummary.openCases.count, dueToday: disputeSummary.awaitingResponse.dueToday },
        },
        growth,
        subscriptionMix: mix,
        recentActivity: activity,
        needsAttention: attention,
    };
}

async function getAiModels(now = new Date()) {
    const since = addDays(now, -30);
    const usage = await AgentExecution.aggregate([
        { $match: { createdAt: { $gte: since }, model: { $nin: [null, ''] } } },
        {
            $group: {
                _id: '$model',
                runs: { $sum: 1 },
                failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                lastUsedAt: { $max: '$createdAt' },
            },
        },
    ]);
    const byModel = new Map(usage.map((u) => [u._id, u]));
    const defs = providerDefinitions();
    const seen = new Set();
    const models = [];
    for (const [key, def] of Object.entries(defs)) {
        const entries = [{ model: def.model, role: 'primary' }, ...(def.fallbackModels || []).map((m) => ({ model: m, role: 'fallback' }))];
        for (const { model, role } of entries) {
            if (!model || seen.has(model)) continue;
            seen.add(model);
            const u = byModel.get(model);
            models.push({
                model,
                name: role === 'primary' ? def.name : model.split('/').pop(),
                provider: key,
                gateway: 'OpenRouter',
                role,
                available: Boolean(def.available),
                runsLast30: u?.runs || 0,
                failureRate: u?.runs ? Math.round((u.failed / u.runs) * 1000) / 10 : 0,
                lastUsedAt: u?.lastUsedAt || null,
            });
        }
    }
    // Models seen in usage but no longer configured (e.g. env overrides changed).
    for (const u of usage) {
        if (seen.has(u._id)) continue;
        models.push({
            model: u._id,
            name: String(u._id).split('/').pop(),
            provider: 'other',
            gateway: 'OpenRouter',
            role: 'unlisted',
            available: false,
            runsLast30: u.runs,
            failureRate: u.runs ? Math.round((u.failed / u.runs) * 1000) / 10 : 0,
            lastUsedAt: u.lastUsedAt,
        });
    }
    models.sort((a, b) => b.runsLast30 - a.runsLast30);
    return {
        gatewayConfigured: Object.values(defs).some((d) => d.available),
        totalRunsLast30: usage.reduce((s, u) => s + u.runs, 0),
        models,
    };
}

module.exports = { getOverview, getAiModels, signupSeries, activeUserSeries, activeUserDaily, resolveRange, subscriptionMix, recentActivity, needsAttention };
