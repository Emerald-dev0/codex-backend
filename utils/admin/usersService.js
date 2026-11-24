/**
 * Admin › Users: directory, user details, suspend / reinstate and forced
 * sign-out. Suspension reuses routes/admin.js#setBanned so the key-based
 * route and the panel behave identically (ban + token revocation).
 */
const mongoose = require('mongoose');
const User = require('../../models/User');
const Subscription = require('../../models/Subscription');
const Payment = require('../../models/Payment');
const Deployment = require('../../models/Deployment');
const AgentExecution = require('../../models/AgentExecution');
const UserActivityDay = require('../../models/UserActivityDay');
const authMiddleware = require('../../middleware/auth');
const { parsePage, pageMeta, searchRegex, tierLabel, addDays, pctChange } = require('./common');
const { COLLECTED_STATUSES } = require('./financeService');

const USER_FIELDS = 'fullName email profilePicture company isVerified isBanned bannedAt banReason platformRole authProvider createdAt lastLogin subscription onboardingCompleted';

function httpError(message, statusCode = 400, code = 'REQUEST_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function accountStatus(user) {
    if (user.isBanned) return 'suspended';
    if (!user.isVerified) return 'unverified';
    return 'active';
}

function userRow(user, sub) {
    return {
        id: String(user._id),
        name: user.fullName || '',
        email: user.email,
        profilePicture: user.profilePicture || null,
        company: user.company || '',
        status: accountStatus(user),
        platformRole: user.platformRole || null,
        authProvider: user.authProvider || 'local',
        plan: sub?.tier || 'developer',
        planLabel: tierLabel(sub?.tier || 'developer'),
        subscriptionStatus: sub?.status || null,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin || null,
    };
}

async function getSummary(now = new Date()) {
    const d30 = addDays(now, -30);
    const d60 = addDays(now, -60);
    const [total, newRecent, newPrev, suspended, unverified, active7] = await Promise.all([
        User.countDocuments({}),
        User.countDocuments({ createdAt: { $gte: d30 } }),
        User.countDocuments({ createdAt: { $gte: d60, $lt: d30 } }),
        User.countDocuments({ isBanned: true }),
        User.countDocuments({ isVerified: false, isBanned: { $ne: true } }),
        UserActivityDay.distinct('userId', { date: { $gte: addDays(now, -7) } }),
    ]);
    return {
        totalUsers: { count: total },
        newUsers: { count: newRecent, changePct: pctChange(newRecent, newPrev) },
        activeThisWeek: { count: active7.length },
        suspended: { count: suspended },
        unverified: { count: unverified },
    };
}

async function listUsers(query = {}) {
    const { page, limit, skip } = parsePage(query, { defaultLimit: 10, maxLimit: 100 });
    const filter = {};
    const rx = searchRegex(query.q);
    if (rx) filter.$or = [{ fullName: rx }, { email: rx }, { company: rx }];
    if (query.status === 'active') Object.assign(filter, { isBanned: { $ne: true }, isVerified: true });
    if (query.status === 'suspended') filter.isBanned = true;
    if (query.status === 'unverified') Object.assign(filter, { isBanned: { $ne: true }, isVerified: false });
    if (query.role === 'admin') filter.platformRole = { $in: ['admin', 'super_admin'] };

    if (query.plan && /^[a-z_]+$/.test(query.plan)) {
        const subs = await Subscription.find(query.plan === 'developer'
            ? { tier: { $ne: 'developer' }, status: { $in: ['active', 'trial', 'past_due'] } }
            : { tier: query.plan, status: { $in: ['active', 'trial', 'past_due'] } }).select('userId').lean();
        const ids = subs.map((s) => s.userId);
        filter._id = query.plan === 'developer' ? { $nin: ids } : { $in: ids };
    }

    const sortKey = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, name: { fullName: 1 }, last_login: { lastLogin: -1 } }[query.sort] || { createdAt: -1 };
    const [total, users] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter).select(USER_FIELDS).sort(sortKey).skip(skip).limit(limit).lean(),
    ]);
    const subs = await Subscription.find({ userId: { $in: users.map((u) => u._id) }, status: { $in: ['active', 'trial', 'past_due'] } })
        .select('userId tier status').lean();
    const subByUser = new Map(subs.map((s) => [String(s.userId), s]));
    return { users: users.map((u) => userRow(u, subByUser.get(String(u._id)))), ...pageMeta(total, page, limit) };
}

function assertId(id) {
    if (!mongoose.isValidObjectId(String(id))) throw httpError('Invalid user id', 400, 'INVALID_ID');
}

async function getUser(id) {
    assertId(id);
    const user = await User.findById(id).select(USER_FIELDS).lean();
    if (!user) throw httpError('User not found', 404, 'NOT_FOUND');
    const [sub, payments, deployments, agentRuns, activeDays] = await Promise.all([
        Subscription.findOne({ userId: user._id }).sort({ createdAt: -1 }).select('tier status pricing nextBillingDate endDate cancelAtPeriodEnd').lean(),
        Payment.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean(),
        Deployment.countDocuments({ userId: user._id }),
        AgentExecution.countDocuments({ userId: user._id }),
        UserActivityDay.countDocuments({ userId: user._id, date: { $gte: addDays(new Date(), -30) } }),
    ]);
    const totals = await Payment.aggregate([
        { $match: { userId: user._id, status: { $in: COLLECTED_STATUSES } } },
        { $group: { _id: '$currency', netMinor: { $sum: { $subtract: ['$amountMinor', '$refundedMinor'] } } } },
    ]);
    return {
        ...userRow(user, sub),
        banReason: user.isBanned ? (user.banReason || '') : '',
        bannedAt: user.bannedAt || null,
        onboardingCompleted: Boolean(user.onboardingCompleted),
        subscription: sub ? {
            id: String(sub._id),
            tier: sub.tier,
            planLabel: tierLabel(sub.tier),
            status: sub.status,
            amountMinor: Math.round((Number(sub.pricing?.amount) || 0) * 100),
            currency: sub.pricing?.currency || 'USD',
            interval: sub.pricing?.interval || 'monthly',
            nextBillingAt: sub.cancelAtPeriodEnd ? null : (sub.nextBillingDate || null),
        } : null,
        usage: { deployments, agentRuns, activeDaysLast30: activeDays },
        lifetimeValue: totals.map((t) => ({ currency: t._id, amountMinor: t.netMinor })),
        recentPayments: payments.map((p) => ({
            id: String(p._id),
            reference: p.reference,
            amountMinor: p.amountMinor,
            currency: p.currency,
            status: p.status,
            createdAt: p.paidAt || p.createdAt,
        })),
    };
}

function guardTarget(user, admin) {
    if (String(user._id) === String(admin.id)) throw httpError('You cannot perform this action on your own account', 400, 'SELF_ACTION');
    if (user.platformRole === 'super_admin' && admin.platformRole !== 'super_admin') {
        throw httpError('Only a super admin can manage another super admin', 403, 'FORBIDDEN');
    }
}

async function suspendUser(id, { reason } = {}, admin) {
    assertId(id);
    const note = String(reason || '').trim().slice(0, 500);
    if (!note) throw httpError('A suspension reason is required', 400, 'VALIDATION_ERROR');
    const existing = await User.findById(id).select('platformRole isBanned').lean();
    if (!existing) throw httpError('User not found', 404, 'NOT_FOUND');
    guardTarget(existing, admin);
    const { setBanned } = require('../../routes/admin');
    await setBanned(id, true, note);
    return getUser(id);
}

async function reinstateUser(id, admin) {
    assertId(id);
    const existing = await User.findById(id).select('platformRole').lean();
    if (!existing) throw httpError('User not found', 404, 'NOT_FOUND');
    guardTarget(existing, admin);
    const { setBanned } = require('../../routes/admin');
    await setBanned(id, false);
    return getUser(id);
}

/** Revoke every session (same mechanism as /api/auth/logout-all). */
async function signOutEverywhere(id, admin) {
    assertId(id);
    const user = await User.findById(id).select('platformRole tokenVersion');
    if (!user) throw httpError('User not found', 404, 'NOT_FOUND');
    guardTarget(user, admin);
    const normalize = typeof authMiddleware.normalizeTokenVersion === 'function'
        ? authMiddleware.normalizeTokenVersion
        : (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
    await User.updateOne({ _id: user._id }, { $set: { tokenVersion: normalize(user.tokenVersion) + 1 } });
    if (typeof authMiddleware.invalidateLivenessEverywhere === 'function') {
        await authMiddleware.invalidateLivenessEverywhere(user._id);
    }
    return getUser(id);
}

module.exports = { getSummary, listUsers, getUser, suspendUser, reinstateUser, signOutEverywhere, accountStatus, userRow };
