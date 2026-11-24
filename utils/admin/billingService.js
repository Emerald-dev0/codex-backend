/**
 * Admin › Billing and Plans: subscriber metrics, subscription performance,
 * subscriber list/details and the plan catalogue.
 */
const mongoose = require('mongoose');
const Subscription = require('../../models/Subscription');
const User = require('../../models/User');
const Payment = require('../../models/Payment');
const {
    PAID_TIERS, TIER_LABELS, tierLabel, parsePage, pageMeta, searchRegex, startOfMonth, addMonths,
    endOfMonth, pctChange, pct, wasActiveAt, monthlyValueMinor,
} = require('./common');
const { computeMrr, COLLECTED_STATUSES, REPORTING_CURRENCY } = require('./financeService');

let annualMultiple = 10;
try {
    annualMultiple = Number(require('../../docs/regionalPricing.json').annual_multiple) || 10;
} catch {
    // Keep the documented default.
}

const PLAN_COPY = Object.freeze({
    developer: 'Open-source contributors, students',
    pro: 'Solo developers coding daily',
    pro_plus: 'Power users running continuous agents, large refactors',
    team_standard: 'Small teams shipping together',
    team_premium: 'High-throughput orgs with heavy agent workflows',
    enterprise: 'Large regulated organisations needing custom security & SLAs',
});
const PLAN_ORDER = ['developer', 'pro', 'pro_plus', 'team_standard', 'team_premium', 'enterprise'];
const ACTIVE_STATUSES = ['active', 'trial', 'past_due'];

function httpError(message, statusCode = 400, code = 'REQUEST_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function durationOf(sub) {
    const interval = sub.pricing?.interval;
    if (interval === 'yearly') return 'annual';
    if (interval === 'custom') return 'custom';
    return 'monthly';
}

async function getSummary(now = new Date()) {
    const monthStart = startOfMonth(now);
    const paid = { tier: { $in: PAID_TIERS } };
    const [total, totalPrev, active, expired, mrr] = await Promise.all([
        Subscription.countDocuments(paid),
        Subscription.countDocuments({ ...paid, createdAt: { $lt: monthStart } }),
        Subscription.countDocuments({ ...paid, status: { $in: ['active', 'past_due'] } }),
        Subscription.countDocuments({ ...paid, status: { $in: ['expired', 'cancelled'] } }),
        computeMrr(now),
    ]);
    return {
        totalSubscribers: { count: total, changePct: pctChange(total, totalPrev) },
        activeSubscriptions: { count: active, pctOfAll: pct(active, total) },
        mrr: { amountMinor: mrr.mrrMinor, changePct: mrr.changePct, currency: REPORTING_CURRENCY },
        expiredSubscriptions: { count: expired, pctOfAll: pct(expired, total) },
    };
}

async function getPerformance({ months } = {}, now = new Date()) {
    const span = Math.min(Math.max(Number.parseInt(months, 10) || 12, 3), 24);
    const subs = await Subscription.find({ tier: { $in: PAID_TIERS } })
        .select('tier status startDate endDate cancelledAt createdAt updatedAt')
        .lean();
    const first = addMonths(startOfMonth(now), -(span - 1));
    const series = [];
    for (let i = 0; i < span; i += 1) {
        const monthStart = addMonths(first, i);
        const isCurrent = i === span - 1;
        const at = isCurrent ? now : endOfMonth(monthStart);
        const count = subs.reduce((n, s) => n + (wasActiveAt(s, at) ? 1 : 0), 0);
        series.push({ month: monthStart.toISOString().slice(0, 7), count });
    }
    const current = series[series.length - 1]?.count || 0;
    const previous = series[series.length - 2]?.count || 0;
    return { series, current, changePct: pctChange(current, previous), hasData: subs.length > 0 };
}

async function getByPlan() {
    const rows = await Subscription.aggregate([
        { $match: { tier: { $in: PAID_TIERS }, status: { $in: ['active', 'past_due'] } } },
        { $group: { _id: '$tier', count: { $sum: 1 } } },
    ]);
    const total = rows.reduce((s, r) => s + r.count, 0);
    const plans = rows
        .map((r) => ({ tier: r._id, label: tierLabel(r._id), count: r.count, pct: pct(r.count, total) }))
        .sort((a, b) => b.count - a.count);
    return { total, plans };
}

async function userIdsMatching(q) {
    const rx = searchRegex(q);
    if (!rx) return null;
    const users = await User.find({ $or: [{ fullName: rx }, { email: rx }] }).select('_id').limit(500).lean();
    return users.map((u) => u._id);
}

function subscriberRow(sub, user) {
    return {
        id: String(sub._id),
        subscriptionId: `SUB-${String(sub._id).slice(-5).toUpperCase()}`,
        user: {
            id: user ? String(user._id) : String(sub.userId),
            name: user?.fullName || 'Unknown user',
            email: user?.email || '',
            profilePicture: user?.profilePicture || null,
        },
        tier: sub.tier,
        planLabel: tierLabel(sub.tier),
        amountMinor: Math.round((Number(sub.pricing?.amount) || 0) * 100),
        currency: sub.pricing?.currency || 'USD',
        duration: durationOf(sub),
        status: sub.status,
        nextBillingAt: ['active', 'trial', 'past_due'].includes(sub.status) && !sub.cancelAtPeriodEnd
            ? (sub.nextBillingDate || sub.endDate || null)
            : null,
        cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
    };
}

async function listSubscribers(query = {}) {
    const { page, limit, skip } = parsePage(query, { defaultLimit: 7, maxLimit: 100 });
    const filter = { tier: { $in: PAID_TIERS } };
    if (query.plan && PAID_TIERS.includes(query.plan)) filter.tier = query.plan;
    const statusMap = {
        active: ['active'],
        trial: ['trial'],
        past_due: ['past_due'],
        expired: ['expired', 'cancelled'],
    };
    if (query.status && statusMap[query.status]) filter.status = { $in: statusMap[query.status] };
    if (query.duration === 'monthly') filter['pricing.interval'] = { $in: ['monthly', 'trial', null] };
    if (query.duration === 'annual') filter['pricing.interval'] = 'yearly';
    if (query.duration === 'custom') filter['pricing.interval'] = 'custom';

    if (query.q) {
        const q = String(query.q).trim();
        const ids = await userIdsMatching(q);
        const or = [{ userId: { $in: ids || [] } }];
        const subMatch = q.match(/^SUB-([A-F0-9]{1,24})$/i);
        if (mongoose.isValidObjectId(q)) or.push({ _id: q });
        if (subMatch) {
            // The SUB-xxxxx label is the last 5 hex chars of the id.
            const tail = subMatch[1].toLowerCase();
            or.push({ $expr: { $eq: [{ $substrCP: [{ $toString: '$_id' }, 19, 5] }, tail] } });
        }
        filter.$or = or;
    }

    const [total, subs] = await Promise.all([
        Subscription.countDocuments(filter),
        Subscription.find(filter)
            .select('userId tier status pricing nextBillingDate endDate cancelAtPeriodEnd createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
    ]);
    const users = await User.find({ _id: { $in: subs.map((s) => s.userId) } }).select('fullName email profilePicture').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return { subscribers: subs.map((s) => subscriberRow(s, byId.get(String(s.userId)))), ...pageMeta(total, page, limit) };
}

async function getSubscriber(id) {
    if (!mongoose.isValidObjectId(String(id))) throw httpError('Invalid subscription id', 400, 'INVALID_ID');
    const sub = await Subscription.findById(id).lean();
    if (!sub) throw httpError('Subscription not found', 404, 'NOT_FOUND');
    const [user, payments] = await Promise.all([
        User.findById(sub.userId).select('fullName email profilePicture company').lean(),
        Payment.find({ userId: sub.userId }).sort({ createdAt: -1 }).limit(12).lean(),
    ]);
    const paid = payments.filter((p) => COLLECTED_STATUSES.includes(p.status));
    const totalPaidMinor = paid.reduce((s, p) => s + p.amountMinor - (p.refundedMinor || 0), 0);
    const last = payments[0];
    const row = subscriberRow(sub, user);
    return {
        ...row,
        company: user?.company || '',
        startDate: sub.startDate || sub.createdAt,
        currentPeriod: {
            start: sub.startDate || sub.createdAt,
            end: sub.endDate || sub.nextBillingDate || null,
        },
        endDate: sub.endDate || sub.nextBillingDate || null,
        renewal: {
            automatic: !sub.cancelAtPeriodEnd && ['active', 'past_due'].includes(sub.status),
            nextRenewalAt: row.nextBillingAt,
            amountMinor: row.amountMinor,
        },
        trialEndsAt: sub.trialEndsAt || null,
        paymentMethod: last ? {
            provider: last.provider,
            method: last.paymentMethod || '',
            email: last.customerEmail || user?.email || '',
        } : { provider: sub.paymentProvider || null, method: '', email: user?.email || '' },
        recentBilling: payments.map((p) => ({
            id: String(p._id),
            date: p.paidAt || p.createdAt,
            invoiceNumber: p.invoiceNumber,
            amountMinor: p.amountMinor,
            currency: p.currency,
            status: p.status,
        })),
        totalPaidMinor,
        totalPaidCurrency: paid[0]?.currency || row.currency,
    };
}

async function getPlans(query = {}) {
    const [subRows, revenueRows] = await Promise.all([
        Subscription.aggregate([
            { $match: { status: { $in: ACTIVE_STATUSES } } },
            { $group: { _id: '$tier', count: { $sum: 1 } } },
        ]),
        Payment.aggregate([
            { $match: { status: { $in: COLLECTED_STATUSES }, currency: REPORTING_CURRENCY } },
            { $group: { _id: '$plan', grossMinor: { $sum: '$amountMinor' }, refundedMinor: { $sum: '$refundedMinor' } } },
        ]),
    ]);
    const subscribers = new Map(subRows.map((r) => [r._id, r.count]));
    const revenue = new Map(revenueRows.map((r) => [r._id, r.grossMinor - r.refundedMinor]));
    const configs = Subscription.tierConfigs || {};

    let plans = PLAN_ORDER.map((tier) => {
        const cfg = configs[tier] || {};
        const custom = cfg.amount == null;
        const monthlyMinor = custom ? null : Math.round(Number(cfg.amount || 0) * 100);
        return {
            id: tier,
            name: TIER_LABELS[tier],
            description: PLAN_COPY[tier],
            monthlyPriceMinor: monthlyMinor,
            annualPriceMinor: custom ? null : monthlyMinor * annualMultiple,
            currency: cfg.currency || 'USD',
            billingCycles: custom ? ['custom'] : (monthlyMinor === 0 ? ['free'] : ['monthly', 'annual']),
            subscribers: subscribers.get(tier) || 0,
            amountGeneratedMinor: revenue.get(tier) || 0,
            status: 'active',
            limits: {
                monthlyCredits: cfg.monthlyCreditLimit ?? null,
                cloudComputeHours: cfg.cloudComputeHours ?? null,
                maxConcurrentJobs: cfg.maxConcurrentJobs ?? null,
                maxDeployments: cfg.maxDeployments ?? null,
                maxDebugHostRooms: cfg.maxDebugHostRooms ?? null,
                dataRetentionDays: cfg.dataRetentionDays ?? null,
                specEngineLevel: cfg.specEngineLevel || null,
                webrtcEnabled: Boolean(cfg.webrtcEnabled),
            },
            features: Object.entries(cfg.features || {}).filter(([, on]) => on).map(([key]) => key),
        };
    });
    const stats = {
        total: plans.length,
        active: plans.filter((p) => p.status === 'active').length,
        draft: plans.filter((p) => p.status === 'draft').length,
        archived: plans.filter((p) => p.status === 'archived').length,
    };
    const rx = searchRegex(query.q);
    if (rx) plans = plans.filter((p) => rx.test(p.name) || rx.test(p.id) || rx.test(p.description));
    if (query.status && ['active', 'draft', 'archived'].includes(query.status)) plans = plans.filter((p) => p.status === query.status);
    if (query.cycle && ['monthly', 'annual', 'custom', 'free'].includes(query.cycle)) plans = plans.filter((p) => p.billingCycles.includes(query.cycle));
    return { stats, plans, source: 'code', annualMultiple };
}

module.exports = {
    getSummary,
    getPerformance,
    getByPlan,
    listSubscribers,
    getSubscriber,
    getPlans,
    subscriberRow,
    monthlyValueMinor,
};
