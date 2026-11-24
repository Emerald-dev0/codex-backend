/**
 * Admin › Insights: engagement, activation, deployments, ARPU, plan mix,
 * AI model usage and weekly signup-cohort retention.
 *
 * Activity comes from UserActivityDay (one row per user per active UTC day).
 */
const User = require('../../models/User');
const UserActivityDay = require('../../models/UserActivityDay');
const Deployment = require('../../models/Deployment');
const AgentExecution = require('../../models/AgentExecution');
const Payment = require('../../models/Payment');
const Subscription = require('../../models/Subscription');
const { addDays, startOfDay, startOfMonth, pctChange, pct, tierLabel, DAY_MS } = require('./common');
const { COLLECTED_STATUSES, REPORTING_CURRENCY } = require('./financeService');

const COHORT_WEEKS = 6;
const RETENTION_WEEKS = 5;

/** Monday 00:00 UTC of the week containing `date`. */
function weekStart(date) {
    const d = startOfDay(date);
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    return addDays(d, -dow);
}

async function distinctActive(from, to) {
    const rows = await UserActivityDay.aggregate([
        { $match: { date: { $gte: from, $lt: to } } },
        { $group: { _id: '$userId' } },
        { $count: 'n' },
    ]);
    return rows[0]?.n || 0;
}

async function monthlyEngagement(year) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));
    const rows = await UserActivityDay.aggregate([
        { $match: { date: { $gte: from, $lt: to } } },
        { $group: { _id: { m: { $month: '$date' }, u: '$userId' } } },
        { $group: { _id: '$_id.m', users: { $sum: 1 } } },
    ]);
    const byMonth = new Map(rows.map((r) => [r._id, r.users]));
    return Array.from({ length: 12 }, (_, i) => ({ month: i + 1, users: byMonth.get(i + 1) || 0 }));
}

/**
 * Pure cohort computation (unit-tested).
 * cohorts: [{ start: Date, userIds: string[] }]
 * activity: Map<userId, Set<'YYYY-MM-DD'>>
 * Week n (1..RETENTION_WEEKS) = share of the cohort active during days
 * [start + 7n, start + 7(n+1)). Weeks that have not fully started are null.
 */
function computeRetention(cohorts, activity, now = new Date(), weeks = RETENTION_WEEKS) {
    return cohorts.map(({ start, userIds }) => {
        const size = userIds.length;
        const retention = [];
        for (let n = 1; n <= weeks; n += 1) {
            const wStart = addDays(start, 7 * n);
            if (wStart > now) {
                retention.push(null);
                continue;
            }
            if (size === 0) {
                retention.push(0);
                continue;
            }
            const days = Array.from({ length: 7 }, (_, i) => addDays(wStart, i).toISOString().slice(0, 10));
            const active = userIds.filter((id) => {
                const set = activity.get(String(id));
                return set && days.some((d) => set.has(d));
            }).length;
            retention.push(Math.round((active / size) * 100));
        }
        return { weekStart: start.toISOString().slice(0, 10), users: size, retention };
    });
}

async function retentionCohorts(now = new Date()) {
    const thisWeek = weekStart(now);
    const firstWeek = addDays(thisWeek, -7 * (COHORT_WEEKS - 1));
    const users = await User.find({ createdAt: { $gte: firstWeek, $lt: addDays(thisWeek, 7) } }).select('_id createdAt').lean();
    if (!users.length) return { cohorts: [], hasData: false };
    const cohorts = Array.from({ length: COHORT_WEEKS }, (_, i) => ({ start: addDays(firstWeek, 7 * i), userIds: [] }));
    for (const u of users) {
        const idx = Math.floor((weekStart(new Date(u.createdAt)) - firstWeek) / (7 * DAY_MS));
        if (cohorts[idx]) cohorts[idx].userIds.push(String(u._id));
    }
    const rows = await UserActivityDay.find({ userId: { $in: users.map((u) => u._id) }, date: { $gte: addDays(firstWeek, 7) } })
        .select('userId day')
        .lean();
    const activity = new Map();
    for (const r of rows) {
        const key = String(r.userId);
        if (!activity.has(key)) activity.set(key, new Set());
        activity.get(key).add(r.day);
    }
    return { cohorts: computeRetention(cohorts, activity, now), hasData: true };
}

async function getInsights(now = new Date()) {
    const d30 = addDays(now, -30);
    const d60 = addDays(now, -60);
    const monthStart = startOfMonth(now);

    const [
        mau, mauPrev,
        signups30, activated30, signupsPrev, activatedPrev,
        deploymentsTotal, deploymentsMonth,
        revenueRows,
        engagement,
        planRows,
        modelRows,
        retention,
    ] = await Promise.all([
        distinctActive(d30, now),
        distinctActive(d60, d30),
        User.countDocuments({ createdAt: { $gte: d30 } }),
        User.countDocuments({ createdAt: { $gte: d30 }, onboardingCompleted: true }),
        User.countDocuments({ createdAt: { $gte: d60, $lt: d30 } }),
        User.countDocuments({ createdAt: { $gte: d60, $lt: d30 }, onboardingCompleted: true }),
        Deployment.countDocuments({ status: 'success' }),
        Deployment.countDocuments({ status: 'success', createdAt: { $gte: monthStart } }),
        Payment.aggregate([
            { $match: { status: { $in: COLLECTED_STATUSES }, currency: REPORTING_CURRENCY, paidAt: { $gte: d60 } } },
            {
                $group: {
                    _id: { $cond: [{ $gte: ['$paidAt', d30] }, 'current', 'previous'] },
                    netMinor: { $sum: { $subtract: ['$amountMinor', '$refundedMinor'] } },
                },
            },
        ]),
        monthlyEngagement(now.getUTCFullYear()),
        Subscription.aggregate([
            { $match: { status: { $in: ['active', 'trial', 'past_due'] } } },
            { $group: { _id: '$tier', count: { $sum: 1 } } },
        ]),
        AgentExecution.aggregate([
            { $match: { model: { $nin: [null, ''] } } },
            { $group: { _id: '$model', runs: { $sum: 1 } } },
            { $sort: { runs: -1 } },
            { $limit: 5 },
        ]),
        retentionCohorts(now),
    ]);

    const revenue = Object.fromEntries(revenueRows.map((r) => [r._id, r.netMinor]));
    const arpu = mau ? Math.round((revenue.current || 0) / mau) : null;
    const arpuPrev = mauPrev ? Math.round((revenue.previous || 0) / mauPrev) : null;
    const activation = signups30 ? pct(activated30, signups30) : null;
    const activationPrev = signupsPrev ? pct(activatedPrev, signupsPrev) : null;

    const planTotal = planRows.reduce((s, r) => s + r.count, 0);
    const order = ['team_premium', 'team_standard', 'pro_plus', 'pro', 'enterprise', 'developer'];
    const plans = planRows
        .map((r) => ({ tier: r._id, label: tierLabel(r._id), count: r.count, pct: pct(r.count, planTotal) }))
        .sort((a, b) => b.count - a.count || order.indexOf(a.tier) - order.indexOf(b.tier));
    const newPaidThisMonth = await Subscription.countDocuments({
        tier: { $ne: 'developer' }, createdAt: { $gte: monthStart }, status: { $in: ['active', 'past_due'] },
    });

    const topRuns = modelRows[0]?.runs || 0;
    const engagementTotal = engagement[now.getUTCMonth()]?.users || 0;
    const engagementPrev = now.getUTCMonth() > 0 ? engagement[now.getUTCMonth() - 1].users : 0;

    return {
        generatedAt: now,
        monthlyActiveUsers: { count: mau, changePct: pctChange(mau, mauPrev) },
        activationRate: {
            pct: activation,
            changePts: activation != null && activationPrev != null ? Math.round((activation - activationPrev) * 10) / 10 : null,
            definition: 'Share of users who signed up in the last 30 days and completed onboarding',
        },
        deployedProjects: { total: deploymentsTotal, thisMonth: deploymentsMonth },
        revenuePerUser: { amountMinor: arpu, currency: REPORTING_CURRENCY, changePct: arpu != null && arpuPrev != null ? pctChange(arpu, arpuPrev) : null },
        engagement: {
            year: now.getUTCFullYear(),
            months: engagement,
            currentMonth: now.getUTCMonth() + 1,
            changePct: pctChange(engagementTotal, engagementPrev),
            hasData: engagement.some((m) => m.users > 0),
        },
        topPlans: { total: planTotal, plans, newPaidThisMonth },
        aiModels: {
            models: modelRows.map((r) => ({ model: r._id, runs: r.runs, pctOfTop: pct(r.runs, topRuns) })),
            hasData: modelRows.length > 0,
        },
        retention,
    };
}

module.exports = { getInsights, computeRetention, weekStart, retentionCohorts };
